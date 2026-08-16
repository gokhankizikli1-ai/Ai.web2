# coding: utf-8
"""/v2/connectors — the ACCOUNT-LEVEL connector surface.

WHAT THIS ROUTER IS FOR
-----------------------
"Connected accounts and tools for my Korvix account", plus the explicit act of
letting a project use one of them. It is the account half of the model; the
per-provider routers (`/v2/gmail`, `/v2/calendar`, `/v2/github`, `/v2/vercel`,
`/v2/slack`) keep owning the provider-specific work — OAuth exchange, live
resource listing, server-side revalidation of a chosen resource, and the bounded
read.

    /v2/connectors                     the account's authorizations + usage
    /v2/connectors/{p}/connect/start    authorize a provider ONCE (no project)
    /v2/connectors/{p}/projects         which projects use it, and with what
    PUT    …/projects/{project_id}      let a project use it (start binding)
    DELETE …/projects/{project_id}      stop letting a project use it
    DELETE /v2/connectors/{p}           disconnect the provider account entirely
    POST   /v2/connectors/{p}/sync      run the bounded read for every bound project

WHY BINDING IS TWO STEPS FOR SOME PROVIDERS
-------------------------------------------
Providers are not interchangeable (see `connectors.registry`). Gmail binds the
whole authorized mailbox, so `PUT …/projects/{id}` is the whole act. GitHub,
Vercel and Slack bind a NAMED resource (a repo, a Vercel project, a set of
channels); for those, `PUT` attaches the authorization to the project in
`pending_selection` and the user then picks resources through the provider's
OWN, already-hardened selection routes, which re-verify every id live against the
provider. This router deliberately does NOT reimplement that validation.

SECURITY
--------
* Identity is ALWAYS the authenticated server identity (`require_auth`). No
  route reads an owner id from the client.
* Every project id is checked against `projects.get_project(...).owner_user_id`
  and 404s otherwise (existence-hidden).
* Every authorization is looked up BY OWNER; an authorization id is never
  accepted from the client, so there is no cross-owner binding surface at all.
* No response carries token material — projections come from the stores'
  `public_view()`, which never include credentials.

AUTHORIZING A PROVIDER EXPOSES IT TO NOTHING. A project reads a provider only
after an explicit binding; there is no "use everywhere" default anywhere in this
file.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Path
from pydantic import BaseModel, Field

from backend.core.deps import require_auth
from backend.core.responses import ok as envelope_ok
from backend.services.auth.identity import User
from backend.services.connectors import registry
from backend.services.connectors import store as shared
from backend.services.projects import store as projects_store

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v2/connectors", tags=["connectors"])


# ── provider plumbing (delegation only — no provider logic lives here) ───────

def _provider_modules(provider: str):
    """(config, store) for a provider, imported lazily so a disabled connector
    never costs anything at import time."""
    if provider == registry.PROVIDER_GMAIL:
        from backend.services.gmail import config as cfg, store as st
    elif provider == registry.PROVIDER_CALENDAR:
        from backend.services.google_calendar import config as cfg, store as st
    elif provider == registry.PROVIDER_GITHUB:
        from backend.services.github import config as cfg, store as st
    elif provider == registry.PROVIDER_VERCEL:
        from backend.services.vercel import config as cfg, store as st
    elif provider == registry.PROVIDER_SLACK:
        from backend.services.slack import config as cfg, store as st
    else:
        raise HTTPException(
            status_code=404,
            detail={"code": "UNKNOWN_PROVIDER", "message": "Unknown connector."},
        )
    return cfg, st


def _require_known(provider: str) -> registry.ProviderSpec:
    spec = registry.spec(provider)
    if spec is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "UNKNOWN_PROVIDER", "message": "Unknown connector."},
        )
    return spec


def _require_enabled(provider: str) -> None:
    cfg, _ = _provider_modules(provider)
    if not cfg.is_enabled():
        raise HTTPException(
            status_code=503,
            detail={"code": "CONNECTOR_DISABLED",
                    "message": f"The {provider} connector is disabled on this deployment."},
        )


def _require_owned_project(project_id: str, user: User):
    """Return the project IFF `user` owns it, else 404 (never reveal the
    existence of another user's project). The cross-user isolation gate."""
    proj = projects_store.get_project(project_id)
    if proj is None or proj.owner_user_id != user.id:
        raise HTTPException(
            status_code=404,
            detail={"code": "PROJECT_NOT_FOUND", "message": "Project not found."},
        )
    return proj


def _owner_authorization(provider: str, user: User) -> shared.Authorization:
    auth = shared.find_authorization(owner_user_id=user.id, provider=provider)
    if auth is None:
        raise HTTPException(
            status_code=409,
            detail={"code": "NOT_AUTHORIZED",
                    "message": f"{provider} is not connected to your account yet."},
        )
    if auth.is_revoked:
        raise HTTPException(
            status_code=409,
            detail={"code": "AUTHORIZATION_REVOKED",
                    "message": f"The {provider} authorization is no longer valid. Reconnect."},
        )
    return auth


# ── account overview ─────────────────────────────────────────────────────────

def _project_names(user: User) -> Dict[str, str]:
    try:
        return {p.id: p.name for p in projects_store.list_projects(user.id)}
    except Exception:
        return {}


def _authorization_summary(auth: shared.Authorization,
                           names: Dict[str, str]) -> Dict[str, Any]:
    bindings = shared.list_authorization_bindings(auth.id)
    by_project: Dict[str, List[shared.Binding]] = {}
    for b in bindings:
        by_project.setdefault(b.project_id, []).append(b)
    view = auth.public_view()
    view["project_count"] = len(by_project)
    view["projects"] = [
        {
            "project_id": pid,
            "project_name": names.get(pid, ""),
            "status": rows[0].status,
            "resources": [r.public_view() for r in rows if r.resource_id],
            "resource_count": sum(1 for r in rows if r.resource_id),
            "last_sync_at": max((r.last_sync_at for r in rows), default="") or None,
        }
        for pid, rows in sorted(by_project.items(), key=lambda kv: names.get(kv[0], kv[0]).lower())
    ]
    return view


@router.get("")
def list_connectors(user: User = Depends(require_auth)) -> Dict[str, Any]:
    """Every connector Korvix ships, with THIS ACCOUNT's authorization state and
    which of the caller's projects use it. Never carries token material.

    A provider that is disabled on the deployment is still listed (with
    `enabled: false`) so the UI can explain the state instead of silently
    hiding a card the user connected earlier."""
    names = _project_names(user)
    out: List[Dict[str, Any]] = []
    for spec in registry.all_specs():
        try:
            cfg, _ = _provider_modules(spec.provider)
            enabled = bool(cfg.is_enabled())
        except Exception:  # pragma: no cover — a broken provider must not 500 the page
            enabled = False
        auth = shared.find_authorization(owner_user_id=user.id, provider=spec.provider)
        out.append({
            "provider": spec.provider,
            "label": spec.label,
            "resource_kind": spec.resource_kind,
            "resource_noun": spec.resource_noun,
            "requires_resource_selection": spec.requires_resource_selection,
            "enabled": enabled,
            "authorization": _authorization_summary(auth, names) if auth else None,
        })
    return envelope_ok(data={"connectors": out}, user_id=user.id)


@router.get("/{provider}")
def get_connector(
    provider: str = Path(..., max_length=32),
    user: User = Depends(require_auth),
) -> Dict[str, Any]:
    """One connector's account-level state (same shape as a row of the list)."""
    spec = _require_known(provider)
    try:
        cfg, _ = _provider_modules(provider)
        enabled = bool(cfg.is_enabled())
    except Exception:  # pragma: no cover
        enabled = False
    auth = shared.find_authorization(owner_user_id=user.id, provider=provider)
    return envelope_ok(
        data={
            "provider": spec.provider,
            "label": spec.label,
            "resource_kind": spec.resource_kind,
            "resource_noun": spec.resource_noun,
            "requires_resource_selection": spec.requires_resource_selection,
            "enabled": enabled,
            "authorization": _authorization_summary(auth, _project_names(user)) if auth else None,
        },
        user_id=user.id,
    )


# ── authorize once (account level, no project) ───────────────────────────────

@router.post("/{provider}/connect/start")
def connect_start(
    provider: str = Path(..., max_length=32),
    user: User = Depends(require_auth),
) -> Dict[str, Any]:
    """Begin the provider's OAuth/install flow for the ACCOUNT — no project
    involved, so the user never repeats OAuth per project.

    The one-time state is minted with an EMPTY project id and is still bound to
    the authenticated user, so the callback attributes the resulting
    authorization to exactly this account and nothing else."""
    _require_known(provider)
    _require_enabled(provider)
    install_url = ""

    if provider == registry.PROVIDER_GMAIL:
        from backend.services.gmail import (
            config as cfg, crypto as gm_crypto, oauth as oauth_mod, state_store as states)
        _require_credential_encryption(gm_crypto)
        _require_oauth_configured(cfg)
        state = states.create_state(owner_user_id=user.id, project_id="")
        url = oauth_mod.build_authorization_url(state)
        scopes = cfg.scopes()
    elif provider == registry.PROVIDER_CALENDAR:
        from backend.services.gmail import crypto as gm_crypto
        from backend.services.google_calendar import (
            config as cfg, oauth as oauth_mod, state_store as states)
        _require_credential_encryption(gm_crypto)
        _require_oauth_configured(cfg)
        state = states.create_state(owner_user_id=user.id, project_id="")
        url = oauth_mod.build_authorization_url(state)
        scopes = cfg.scopes()
    elif provider == registry.PROVIDER_GITHUB:
        # GitHub's flow is a USER authorization first (so we can list which App
        # installations this human actually has), exactly as the project-scoped
        # route does — `config.authorize_url` is that entry point.
        from backend.services.github import config as cfg, setup_state as states
        if not cfg.user_auth_configured():
            raise HTTPException(
                status_code=503,
                detail={"code": "OAUTH_NOT_CONFIGURED",
                        "message": "The GitHub App OAuth client is not configured "
                                   "on the server."},
            )
        state = states.create_state(owner_user_id=user.id, project_id="")
        url = cfg.authorize_url(state)
        # A user who authorizes us but has NOT installed the App on any account
        # comes back as `needs_install`, and re-running the authorize URL would
        # just loop them. Hand the install URL back alongside it so the caller
        # has a real way forward. Both are server-built (never a request value).
        install_url = cfg.install_url(state) if cfg.install_configured() else ""
        scopes = []
    elif provider == registry.PROVIDER_VERCEL:
        from backend.services.gmail import crypto as gm_crypto
        from backend.services.vercel import config as cfg, oauth as oauth_mod, setup_state as states
        _require_credential_encryption(gm_crypto)
        _require_oauth_configured(cfg)
        state = states.create_state(owner_user_id=user.id, project_id="")
        url = oauth_mod.build_authorization_url(state)
        scopes = []
    else:  # slack
        from backend.services.gmail import crypto as gm_crypto
        from backend.services.slack import config as cfg, oauth as oauth_mod, setup_state as states
        _require_credential_encryption(gm_crypto)
        _require_oauth_configured(cfg)
        state = states.create_state(owner_user_id=user.id, project_id="")
        url = oauth_mod.build_authorization_url(state)
        scopes = cfg.scopes()

    return envelope_ok(
        data={"authorization_url": url, "state": state, "scopes": list(scopes or []),
              **({"install_url": install_url} if install_url else {})},
        user_id=user.id,
    )


def _require_credential_encryption(crypto_mod) -> None:
    """Fail closed BEFORE starting OAuth when a credential could not be stored
    safely — a refresh/bot token must never reach disk unencrypted."""
    if not crypto_mod.is_configured():
        raise HTTPException(
            status_code=503,
            detail={"code": "CREDENTIAL_ENCRYPTION_NOT_CONFIGURED",
                    "message": "Credential encryption is not configured "
                               "(KORVIX_CREDENTIAL_ENCRYPTION_KEY). Refusing to "
                               "start OAuth without encryption at rest."},
        )


def _require_oauth_configured(cfg) -> None:
    checker = getattr(cfg, "oauth_configured", None) or getattr(cfg, "is_configured", None)
    if checker is not None and not checker():
        raise HTTPException(
            status_code=503,
            detail={"code": "OAUTH_NOT_CONFIGURED",
                    "message": "This connector's OAuth client is not configured "
                               "on the server."},
        )


# ── project bindings ─────────────────────────────────────────────────────────

@router.get("/{provider}/projects")
def list_provider_projects(
    provider: str = Path(..., max_length=32),
    user: User = Depends(require_auth),
) -> Dict[str, Any]:
    """Every project the caller owns, annotated with whether it currently uses
    this connector and which resources it reads. This is what the Manage surface
    renders as "Use in projects"."""
    _require_known(provider)
    auth = shared.find_authorization(owner_user_id=user.id, provider=provider)
    try:
        owned = projects_store.list_projects(user.id)
    except Exception:
        owned = []
    bound: Dict[str, List[shared.Binding]] = {}
    if auth is not None:
        for b in shared.list_authorization_bindings(auth.id):
            bound.setdefault(b.project_id, []).append(b)
    return envelope_ok(
        data={
            "authorized": auth is not None and not auth.is_revoked,
            "projects": [
                {
                    "project_id": p.id,
                    "project_name": p.name,
                    "bound": p.id in bound,
                    "status": (bound[p.id][0].status if p.id in bound else None),
                    "resources": [r.public_view() for r in bound.get(p.id, []) if r.resource_id],
                }
                for p in owned
            ],
        },
        user_id=user.id,
    )


class BindBody(BaseModel):
    #: Optional resource ids for MULTI providers, when the caller already knows
    #: them. Every id is still revalidated by the provider's own selection route,
    #: which is the only thing that may mark a binding connected.
    resource_ids: Optional[List[str]] = Field(default=None, max_length=200)


@router.put("/{provider}/projects/{project_id}")
def bind_project(
    provider: str = Path(..., max_length=32),
    project_id: str = Path(..., max_length=64),
    body: Optional[BindBody] = None,
    user: User = Depends(require_auth),
) -> Dict[str, Any]:
    """Let a project use the account's authorization for this provider.

    NO OAUTH IS INVOLVED — that is the point of the account-level model: the
    second, third and tenth project reuse the one authorization the user already
    granted.

    For a whole-account provider (Gmail) the binding is complete immediately. For
    a resource provider (GitHub / Vercel / Slack) the binding starts as
    `pending_selection`; the caller then picks resources through the provider's
    own selection routes, which re-verify each id LIVE against the provider. A
    resource id supplied here is never trusted to complete a binding."""
    spec = _require_known(provider)
    _require_enabled(provider)
    _require_owned_project(project_id, user)
    auth = _owner_authorization(provider, user)
    _, st = _provider_modules(provider)

    if spec.resource_kind == registry.RESOURCE_ACCOUNT:
        conn = st.bind_project(
            project_id=project_id, owner_user_id=user.id, authorization_id=auth.id)
    elif provider == registry.PROVIDER_CALENDAR:
        conn = st.bind_project(
            project_id=project_id, owner_user_id=user.id, authorization_id=auth.id)
    else:
        conn = st.start_project_binding(
            project_id=project_id, owner_user_id=user.id, authorization_id=auth.id)
        if conn is not None and provider == registry.PROVIDER_GITHUB:
            # Seed the project's pending-installation set from the account
            # authorization so the EXISTING repository picker (which validates
            # against that server-stored set, then re-verifies live) works
            # without a second GitHub round-trip.
            _seed_github_pending(auth, project_id, user.id)

    if conn is None:
        raise HTTPException(
            status_code=409,
            detail={"code": "BIND_FAILED",
                    "message": "Could not use this connector in the project. "
                               "Reconnect the provider and try again."},
        )
    return envelope_ok(
        data={"connection": conn.public_view(),
              "requires_resource_selection": spec.requires_resource_selection},
        user_id=user.id,
    )


def _seed_github_pending(auth: shared.Authorization, project_id: str,
                         owner_user_id: str) -> None:
    from backend.services.github import setup_state as gh_setup
    # Prefer the FULL verified installation list recorded at authorization time,
    # so a user with several accounts/orgs still sees every one in the picker.
    recorded = auth.metadata.get("installations")
    installations = []
    if isinstance(recorded, list):
        for item in recorded:
            iid = str((item or {}).get("installation_id") or "").strip()
            if iid:
                installations.append({
                    "installation_id": iid,
                    "account_login": str((item or {}).get("account_login") or ""),
                    "account_type": str((item or {}).get("account_type") or ""),
                })
    if not installations:
        installation_id = str(auth.metadata.get("installation_id") or auth.account_key or "")
        if not installation_id:
            return
        installations = [{
            "installation_id": installation_id,
            "account_login": str(auth.metadata.get("account_login") or ""),
            "account_type": str(auth.metadata.get("account_type") or ""),
        }]
    try:
        gh_setup.replace_pending_installations(
            project_id=project_id, owner_user_id=owner_user_id,
            installations=installations,
        )
    except Exception as exc:  # pragma: no cover — best effort; the picker can refresh
        logger.warning("connectors: could not seed GitHub pending set: %s", type(exc).__name__)


@router.delete("/{provider}/projects/{project_id}")
def unbind_project(
    provider: str = Path(..., max_length=32),
    project_id: str = Path(..., max_length=64),
    user: User = Depends(require_auth),
) -> Dict[str, Any]:
    """REMOVE FROM PROJECT — drop ONE project's binding.

    This is NOT a disconnect: the provider authorization survives, every other
    project keeps working, and no token is revoked anywhere. (The only exception
    is the degenerate case where this was the account's last binding, in which
    case the provider store also drops the now-unused authorization — the same
    behaviour a single-project user had before.)"""
    _require_known(provider)
    _require_owned_project(project_id, user)
    auth = shared.find_authorization(owner_user_id=user.id, provider=provider)
    binding = shared.get_binding(project_id, provider)
    if binding is None:
        return envelope_ok(data={"removed": False, "bound": False}, user_id=user.id)
    if auth is None or binding.authorization_id != auth.id:
        # The binding is not on this owner's authorization — refuse rather than
        # touch a row that is not ours to touch.
        raise HTTPException(
            status_code=404,
            detail={"code": "BINDING_NOT_FOUND", "message": "Connector binding not found."},
        )
    _, st = _provider_modules(provider)
    removed = bool(st.delete_connection(project_id))
    remaining = shared.count_project_bindings(auth.id)
    return envelope_ok(
        data={"removed": removed, "bound": False,
              "authorization_still_connected": remaining > 0,
              "remaining_projects": remaining},
        user_id=user.id,
    )


# ── account-level disconnect ─────────────────────────────────────────────────

@router.delete("/{provider}")
def disconnect_account(
    provider: str = Path(..., max_length=32),
    user: User = Depends(require_auth),
) -> Dict[str, Any]:
    """DISCONNECT PROVIDER ACCOUNT — remove the authorization and EVERY project
    binding on it. This is the destructive one; the UI must confirm it and say
    how many projects it affects (that count is returned here too).

    Remote revocation is deliberately conservative and provider-specific:
      * Google (Gmail / Calendar) — Korvix's two Google connectors may share ONE
        OAuth client, and Google merges such consents into a SINGLE grant per
        (client, user). The remote revoke therefore runs only when
        `google_grant` can prove no sibling Google authorization for the same
        account survives. Skipping it is safe: the local credential is deleted
        either way, which is what actually ends Korvix's access.
      * GitHub — an App INSTALLATION is not ours to uninstall; the user removes
        it from GitHub. We only forget our mapping.
      * Vercel / Slack — the installation is shared with anything else the user
        connected it to, so this is local-only by design (there is no
        `auth.revoke` call anywhere in those packages)."""
    _require_known(provider)
    auth = shared.find_authorization(owner_user_id=user.id, provider=provider)
    if auth is None:
        return envelope_ok(
            data={"removed": False, "authorized": False, "revoked_remotely": False,
                  "projects_affected": 0},
            user_id=user.id,
        )
    projects_affected = shared.count_project_bindings(auth.id)
    revoked_remotely = False

    if provider in (registry.PROVIDER_GMAIL, registry.PROVIDER_CALENDAR):
        revoked_remotely = _revoke_google_if_safe(provider, auth)

    _, st = _provider_modules(provider)
    removed = bool(st.delete_authorization(auth.id))
    return envelope_ok(
        data={"removed": removed, "authorized": False,
              "revoked_remotely": revoked_remotely,
              "projects_affected": projects_affected},
        user_id=user.id,
    )


def _revoke_google_if_safe(provider: str, auth: shared.Authorization) -> bool:
    """Best-effort remote revoke, gated by the shared Google-grant authority."""
    from backend.services import google_grant
    from backend.services.gmail import crypto as gm_crypto  # noqa: F401  (fail-closed import)
    if not google_grant.remote_revoke_is_safe_for_authorization(
            provider=provider, google_email=auth.account_label or auth.account_key,
            authorization_id=auth.id):
        return False
    try:
        refresh_token = auth.decrypt("refresh_token")
    except Exception:
        return False
    if not refresh_token:
        return False
    try:
        if provider == registry.PROVIDER_GMAIL:
            from backend.services.gmail import oauth as oauth_mod
        else:
            from backend.services.google_calendar import oauth as oauth_mod
        return bool(oauth_mod.revoke_token(refresh_token))
    except Exception:  # pragma: no cover — revoke is best-effort
        return False


# ── sync every bound project ─────────────────────────────────────────────────

@router.post("/{provider}/sync")
def sync_all(
    provider: str = Path(..., max_length=32),
    user: User = Depends(require_auth),
) -> Dict[str, Any]:
    """Run the provider's EXISTING bounded read once per bound project.

    Sync stays BINDING-level even though authorization is account-level: each
    project reads only its own bound resources, and each observation is recorded
    under (that project, its owner). An account-level authorization never
    produces account-global observations — there is no code path here that could
    write one."""
    spec = _require_known(provider)
    _require_enabled(provider)
    auth = _owner_authorization(provider, user)
    _, st = _provider_modules(provider)
    sync_mod = _sync_module(provider)

    results: List[Dict[str, Any]] = []
    seen_projects = []
    for binding in shared.list_authorization_bindings(auth.id):
        if binding.project_id in seen_projects:
            continue
        seen_projects.append(binding.project_id)
        # Defence in depth: re-check ownership of every project we are about to
        # read into, instead of trusting the binding's denormalized owner.
        proj = projects_store.get_project(binding.project_id)
        if proj is None or proj.owner_user_id != user.id:
            continue
        conn = st.get_connection(binding.project_id)
        if conn is None or getattr(conn, "is_revoked", False):
            results.append({"project_id": binding.project_id, "ok": False,
                            "reason": "not_connected"})
            continue
        if spec.requires_resource_selection and getattr(conn, "is_connected", True) is False:
            results.append({"project_id": binding.project_id, "ok": False,
                            "reason": "needs_resource_selection"})
            continue
        try:
            report = sync_mod.sync_connection(conn)
            results.append({"project_id": binding.project_id, "ok": True,
                            "sync": report.as_dict()})
        except Exception as exc:
            results.append({"project_id": binding.project_id, "ok": False,
                            "reason": type(exc).__name__})
    return envelope_ok(
        data={"results": results, "projects": len(results)},
        user_id=user.id,
    )


def _sync_module(provider: str):
    if provider == registry.PROVIDER_GMAIL:
        from backend.services.gmail import sync as mod
    elif provider == registry.PROVIDER_CALENDAR:
        from backend.services.google_calendar import sync as mod
    elif provider == registry.PROVIDER_GITHUB:
        from backend.services.github import sync as mod
    elif provider == registry.PROVIDER_VERCEL:
        from backend.services.vercel import sync as mod
    else:
        from backend.services.slack import sync as mod
    return mod


__all__ = ["router"]
