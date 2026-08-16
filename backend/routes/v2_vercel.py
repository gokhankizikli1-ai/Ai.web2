# coding: utf-8
"""/v2/vercel — Vercel connector (READ-ONLY source of Business Brain observations).

Two surfaces, both gated behind `ENABLE_VERCEL_CONNECTOR` (503 when off, so the
route ships dormant and is turned on with a single env flip):

  Project-scoped (authenticated, ownership-enforced — a caller may only touch a
  project they own, resolved from `projects.get_project(...).owner_user_id`):
    POST   /v2/vercel/projects/{project_id}/connect/start     begin the install/
                                                              authorization flow
    GET    /v2/vercel/projects/{project_id}/connection        read safe status
    GET    /v2/vercel/projects/{project_id}/pending-projects  the Vercel projects
                                                              this authorization
                                                              can actually see
    POST   /v2/vercel/projects/{project_id}/connect/select    bind ONE of them
    POST   /v2/vercel/projects/{project_id}/sync              run the bounded read
    DELETE /v2/vercel/projects/{project_id}/connection        disconnect (local)

  Public OAuth callback (state-authenticated, NOT user-authenticated — Vercel
  redirects the browser here):
    GET    /v2/vercel/oauth/callback                          finish authorization

The connector is READ-ONLY toward Vercel: none of these routes can deploy,
redeploy, promote, roll back, cancel a build, mutate env vars or domains, or
change project configuration. The client is GET-only; disconnect removes LOCAL
credential/binding state and never mutates anything at Vercel.

SECURITY INVARIANTS
  * The client secret + access token never leave the backend; no API returns a
    token. Status carries safe metadata only.
  * OAuth state is one-time, TTL-bound, and ownership-bound; the callback trusts
    ONLY the (user, project) stored with the state — never a query param — so a
    callback cannot attach Vercel to another user's Korvix project, and a replay
    is rejected.
  * The team scope comes from the TOKEN EXCHANGE RESPONSE, never from the
    callback's `teamId` query param (which is attacker-supplied).
  * A client-supplied Vercel project id is validated against the server-stored
    pending set AND re-verified live against Vercel under the token's own scope
    before it is ever bound.
  * The callback redirects only to a FIXED, server-configured frontend base —
    never a URL from the request (Vercel's `next` param is deliberately
    ignored) — so it can't be turned into an open redirect.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from backend.core.deps import require_auth
from backend.core.responses import ok as envelope_ok
from backend.services.auth.identity import User
from backend.services.projects import store as projects_store
from backend.services.vercel import config as vc_config
from backend.services.vercel import normalize as vc_normalize
from backend.services.vercel import oauth as vc_oauth
from backend.services.vercel import setup_state as vc_setup
from backend.services.vercel import store as vc_store
from backend.services.vercel import sync as vc_sync
from backend.services.vercel.client import VercelClient
from backend.services.vercel.errors import (
    CredentialEncryptionError, VercelAuthError, VercelConfigError, VercelError,
    VercelOAuthError,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v2/vercel", tags=["vercel-connector"])

_NO_STORE = {"Cache-Control": "no-store, no-cache, must-revalidate, private"}


def _ensure_enabled() -> None:
    if not vc_config.is_enabled():
        raise HTTPException(
            status_code=503,
            detail={
                "code": "VERCEL_CONNECTOR_DISABLED",
                "message": "Vercel connector is disabled. Set ENABLE_VERCEL_CONNECTOR=true.",
                "rollback": "Unset ENABLE_VERCEL_CONNECTOR to disable.",
            },
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


def _ensure_connect_configured() -> None:
    """Fail closed BEFORE starting the flow if the connector can't complete it:
    the integration OAuth client must be configured AND credential encryption
    must be available (else an access token could not be stored safely)."""
    if not vc_config.oauth_configured():
        raise HTTPException(
            status_code=503,
            detail={"code": "VERCEL_OAUTH_NOT_CONFIGURED",
                    "message": "Vercel integration is not configured "
                               "(VERCEL_OAUTH_CLIENT_ID / VERCEL_OAUTH_CLIENT_SECRET / "
                               "VERCEL_OAUTH_REDIRECT_URI / VERCEL_INTEGRATION_SLUG)."},
        )
    if not vc_config.encryption_configured():
        raise HTTPException(
            status_code=503,
            detail={"code": "CREDENTIAL_ENCRYPTION_NOT_CONFIGURED",
                    "message": "Credential encryption is not configured "
                               "(KORVIX_CREDENTIAL_ENCRYPTION_KEY). Refusing to "
                               "start authorization without encryption at rest."},
        )


# ── Connect (start) ──────────────────────────────────────────────────────────

@router.post("/projects/{project_id}/connect/start")
def connect_start(
    project_id: str = Path(..., max_length=64),
    user: User = Depends(require_auth),
) -> Dict[str, Any]:
    """Begin the Vercel integration flow for a project the caller owns. Mints a
    one-time, ownership-bound state and returns the Vercel install/authorization
    URL for the browser to navigate to. No secret is returned; the client secret
    stays backend-side, and no Vercel project id is chosen client-side."""
    _ensure_enabled()
    _ensure_connect_configured()
    proj = _require_owned_project(project_id, user)

    # Opportunistic housekeeping of stale states (best-effort).
    try:
        vc_setup.purge_expired()
    except Exception:  # pragma: no cover — never block the connect
        pass

    state = vc_setup.create_state(owner_user_id=proj.owner_user_id, project_id=proj.id)
    try:
        auth_url = vc_oauth.build_authorization_url(state)
    except VercelConfigError:
        raise HTTPException(
            status_code=503,
            detail={"code": "VERCEL_OAUTH_NOT_CONFIGURED",
                    "message": "Vercel integration is not configured."},
        )
    return envelope_ok(
        data={"authorization_url": auth_url, "state": state},
        user_id=user.id,
    )


# ── OAuth callback (state-authenticated) ─────────────────────────────────────

def _result_redirect(**params: Any) -> RedirectResponse:
    """Redirect the browser back to the FIXED frontend result page (never a URL
    from the request — Vercel's `next` param is ignored on purpose). Outcome is
    conveyed via query params the SPA reads."""
    base = vc_config.frontend_result_base()
    path = vc_config.frontend_result_path()
    sep = "&" if "?" in path else "?"
    url = f"{base}{path}{sep}{urlencode({k: v for k, v in params.items() if v is not None})}"
    return RedirectResponse(url=url, status_code=302, headers=_NO_STORE)


@router.get("/oauth/callback")
def oauth_callback(
    state: Optional[str] = Query(default=None, max_length=512),
    code: Optional[str] = Query(default=None, max_length=2048),
    error: Optional[str] = Query(default=None, max_length=200),
) -> RedirectResponse:
    """Finish the Vercel authorization. Vercel redirects the browser here.

    Identity/target come ONLY from the one-time state — never from a query
    param. The team scope comes ONLY from the token-exchange response (Vercel
    also echoes a `teamId` query param; it is deliberately NOT read here, since
    anything in the query string is attacker-supplied). `next`/`configurationId`
    are likewise ignored."""
    if not vc_config.is_enabled():
        # Dormant: bounce to the frontend with a generic error (no 503 page for
        # a browser redirect).
        return _result_redirect(vercel="error", reason="disabled")

    # 1. Consume the state FIRST (one-time; ownership-bound). An invalid /
    #    expired / replayed state is rejected before we touch the code, and we
    #    do not know a project, so we bounce to the fixed frontend base only.
    consumed = vc_setup.consume(state or "")
    if consumed is None:
        return _result_redirect(vercel="error", reason="invalid_state")

    project_id = consumed.project_id
    # An ACCOUNT-LEVEL authorization carries no project: the user is connecting
    # Vercel to their Korvix account. Which Korvix project reads which Vercel
    # project stays a separate, explicit act.
    account_level = not project_id

    # 2. Denied consent / provider error (state was valid, so we can report the
    #    project context back).
    if error:
        return _result_redirect(vercel="error", reason="access_denied",
                                project_id=project_id or None)
    if not code:
        return _result_redirect(vercel="error", reason="missing_code",
                                project_id=project_id or None)

    # 3. Re-validate that the owning project still exists + belongs to the
    #    state's user (defence-in-depth against a project deleted/reassigned
    #    mid-flow). Skipped for an account-level flow — there is no project.
    if not account_level:
        proj = projects_store.get_project(project_id)
        if proj is None or proj.owner_user_id != consumed.owner_user_id:
            return _result_redirect(vercel="error", reason="ownership_mismatch",
                                    project_id=project_id)

    # 4. Exchange the code server-side (client secret backend-only).
    try:
        tokens = vc_oauth.exchange_code(code)
    except VercelOAuthError:
        return _result_redirect(vercel="error", reason="exchange_failed",
                                project_id=project_id or None)
    except (VercelConfigError, VercelError):
        return _result_redirect(vercel="error", reason="server_error",
                                project_id=project_id or None)

    # 5. One bounded identity read for a display label (never fatal).
    account_label = vc_oauth.fetch_account_label(tokens.access_token,
                                                 team_id=tokens.team_id)

    # 6. Persist the authorization with the access token ENCRYPTED at rest. A
    #    missing encryption key fails closed (no plaintext ever written). The
    #    connection lands in `pending_selection`: nothing syncs until the user
    #    explicitly chooses WHICH Vercel project belongs to this Korvix project.
    try:
        if account_level:
            # Account-level: store the authorization ONLY. Nothing syncs, and no
            # project is exposed to Vercel, until the user binds one.
            auth = vc_store.authorize_account(
                owner_user_id=consumed.owner_user_id,   # authoritative — from state
                access_token=tokens.access_token,
                account_label=account_label,
                team_id=tokens.team_id,                 # authoritative — from token
                installation_id=tokens.installation_id,
                vercel_user_id=tokens.user_id,
            )
            if auth is None:
                return _result_redirect(vercel="error", reason="store_failed")
            return _result_redirect(vercel="authorized")
        conn = vc_store.upsert_authorization(
            project_id=project_id,
            owner_user_id=consumed.owner_user_id,   # authoritative — from state
            access_token=tokens.access_token,
            account_label=account_label,
            team_id=tokens.team_id,                 # authoritative — from token
            installation_id=tokens.installation_id,
            vercel_user_id=tokens.user_id,
        )
    except CredentialEncryptionError:
        return _result_redirect(vercel="error", reason="encryption_unavailable",
                                project_id=project_id or None)
    if conn is None:
        return _result_redirect(vercel="error", reason="store_failed",
                                project_id=project_id)

    # 7. Populate the bounded pending-project set so the SPA can render a
    #    picker immediately. A provider hiccup here is NOT fatal — the
    #    pending-projects endpoint re-reads live when the set is empty.
    try:
        _refresh_pending(conn)
    except Exception:  # pragma: no cover — best-effort pre-population
        pass

    return _result_redirect(vercel="authorized", project_id=project_id)


# ── Pending Vercel projects (server-authoritative picker source) ─────────────

def _refresh_pending(conn: vc_store.VercelConnection) -> List[vc_setup.PendingProject]:
    """Read the projects THIS authorization can actually see (bounded, under the
    connection's own team scope) and replace the stored pending set.

    This is the authoritative "which Vercel projects may this connection touch"
    answer — the picker never invents ids, and a stale set can never widen
    access. Raises the client's typed errors on a provider failure."""
    client = VercelClient(conn)
    projects = client.list_projects()
    payload = []
    for p in projects:
        ident = vc_normalize.project_identity(p)
        if not ident["id"]:
            continue
        payload.append({
            "vercel_project_id": ident["id"],
            "name": ident["name"],
            "framework": ident["framework"],
        })
    return vc_setup.replace_pending_projects(
        project_id=conn.project_id, owner_user_id=conn.owner_user_id,
        projects=payload,
    )


@router.get("/projects/{project_id}/pending-projects")
def pending_projects(
    project_id: str = Path(..., max_length=64),
    refresh: bool = Query(default=False),
    user: User = Depends(require_auth),
) -> Dict[str, Any]:
    """The Vercel projects the caller may bind to this Korvix project.

    Owner-only; returns token-free display metadata for the picker. The stored
    set is re-read live from Vercel when it is empty/expired, or when `refresh`
    is requested (the "change project" path) — so the picker is always a
    faithful mirror of what the authorization currently grants."""
    _ensure_enabled()
    _require_owned_project(project_id, user)
    conn = vc_store.get_connection(project_id)
    if conn is None:
        raise HTTPException(
            status_code=409,
            detail={"code": "NOT_AUTHORIZED",
                    "message": "Vercel is not authorized for this project. "
                               "Start the connect flow first."},
        )
    if conn.is_revoked:
        raise HTTPException(
            status_code=409,
            detail={"code": "CONNECTION_REVOKED",
                    "message": "Vercel authorization is no longer valid. Reconnect."},
        )

    pending = vc_setup.list_pending_projects(project_id, owner_user_id=user.id)
    if refresh or not pending:
        try:
            pending = _refresh_pending(conn)
        except VercelAuthError:
            raise HTTPException(
                status_code=409,
                detail={"code": "CONNECTION_REVOKED",
                        "message": "Vercel authorization is no longer valid. Reconnect."},
            )
        except CredentialEncryptionError:
            raise HTTPException(
                status_code=503,
                detail={"code": "CREDENTIAL_ENCRYPTION_NOT_CONFIGURED",
                        "message": "Credential encryption is unavailable; cannot "
                                   "read the stored token."},
            )
        except VercelError:
            raise HTTPException(
                status_code=502,
                detail={"code": "VERCEL_UNAVAILABLE",
                        "message": "Could not list Vercel projects for this authorization."},
            )
    return envelope_ok(
        data={"projects": [p.public_view() for p in pending], "count": len(pending)},
        user_id=user.id,
    )


class SelectProjectBody(BaseModel):
    vercel_project_id: str = Field(..., min_length=1, max_length=128,
                                   description="A Vercel project id from the "
                                               "server-provided pending list.")


@router.post("/projects/{project_id}/connect/select")
def connect_select(
    project_id: str = Path(..., max_length=64),
    body: SelectProjectBody = ...,
    user: User = Depends(require_auth),
) -> Dict[str, Any]:
    """Finalize the connection: bind ONE Vercel project to this Korvix project.

    The supplied id is validated TWICE and trusted at neither step alone:
      1. it must match a currently-pending, owner-bound row (client input is
         checked against the server-stored set, never accepted on its own);
      2. it is then re-verified LIVE against Vercel under the connection's own
         token/team scope — so a stale pending row can never bind a project the
         authorization no longer covers."""
    _ensure_enabled()
    _require_owned_project(project_id, user)
    conn = vc_store.get_connection(project_id)
    if conn is None:
        raise HTTPException(
            status_code=409,
            detail={"code": "NOT_AUTHORIZED",
                    "message": "Vercel is not authorized for this project. "
                               "Start the connect flow first."},
        )
    if conn.is_revoked:
        raise HTTPException(
            status_code=409,
            detail={"code": "CONNECTION_REVOKED",
                    "message": "Vercel authorization is no longer valid. Reconnect."},
        )

    requested = (body.vercel_project_id or "").strip()
    pending = vc_setup.get_pending_project(
        project_id, owner_user_id=user.id, vercel_project_id=requested)
    if pending is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "NO_PENDING_PROJECT",
                    "message": "That Vercel project is not in this project's "
                               "available list. Refresh the list and try again."},
        )

    # Live server-side revalidation under the connection's own scope.
    try:
        project = VercelClient(conn).get_project(pending.vercel_project_id)
    except VercelAuthError:
        raise HTTPException(
            status_code=409,
            detail={"code": "CONNECTION_REVOKED",
                    "message": "Vercel authorization is no longer valid. Reconnect."},
        )
    except CredentialEncryptionError:
        raise HTTPException(
            status_code=503,
            detail={"code": "CREDENTIAL_ENCRYPTION_NOT_CONFIGURED",
                    "message": "Credential encryption is unavailable; cannot read "
                               "the stored token."},
        )
    except VercelError:
        raise HTTPException(
            status_code=502,
            detail={"code": "VERCEL_UNAVAILABLE",
                    "message": "Could not verify the project against Vercel."},
        )

    ident = vc_normalize.project_identity(project)
    if not ident["id"] or ident["id"] != pending.vercel_project_id:
        # Vercel answered, but not with the project we asked for (or with no id):
        # refuse rather than bind something unverified.
        raise HTTPException(
            status_code=400,
            detail={"code": "PROJECT_NOT_ACCESSIBLE",
                    "message": "That Vercel project is not accessible under this "
                               "authorization."},
        )

    conn = vc_store.bind_project(
        project_id=project_id, vercel_project_id=ident["id"], name=ident["name"],
        framework=ident["framework"], production_url=ident["production_url"],
    )
    if conn is None:
        raise HTTPException(
            status_code=409,
            detail={"code": "BIND_FAILED",
                    "message": "Could not bind the Vercel project. Reconnect and try again."},
        )
    vc_setup.delete_pending_projects(project_id)
    return envelope_ok(data={"connection": conn.public_view()}, user_id=user.id)


# ── Status ───────────────────────────────────────────────────────────────────

@router.get("/projects/{project_id}/connection")
def get_connection(
    project_id: str = Path(..., max_length=64),
    user: User = Depends(require_auth),
) -> Dict[str, Any]:
    """Safe connection metadata only — NEVER a token/secret."""
    _ensure_enabled()
    _require_owned_project(project_id, user)
    conn = vc_store.get_connection(project_id)
    return envelope_ok(
        data={"connection": conn.public_view() if conn else None,
              "connected": bool(conn and conn.is_connected)},
        user_id=user.id,
    )


# ── Sync (bounded read) ──────────────────────────────────────────────────────

@router.post("/projects/{project_id}/sync")
def sync_project(
    project_id: str = Path(..., max_length=64),
    user: User = Depends(require_auth),
) -> Dict[str, Any]:
    """Run the bounded Vercel read for a connected project. Records observations
    only — never creates a task/decision/run, never calls a model, never mutates
    anything at Vercel. Partial / auth failure is reported truthfully."""
    _ensure_enabled()
    _require_owned_project(project_id, user)
    conn = vc_store.get_connection(project_id)
    if conn is None:
        raise HTTPException(
            status_code=409,
            detail={"code": "NOT_CONNECTED",
                    "message": "Project is not connected to Vercel. Start the connect flow first."},
        )
    if conn.is_revoked:
        raise HTTPException(
            status_code=409,
            detail={"code": "CONNECTION_REVOKED",
                    "message": "Vercel authorization is no longer valid. Reconnect to sync."},
        )
    if not conn.is_connected:
        raise HTTPException(
            status_code=409,
            detail={"code": "PROJECT_SELECTION_REQUIRED",
                    "message": "Choose which Vercel project belongs to this project first."},
        )
    try:
        report = vc_sync.sync_connection(conn)
    except VercelAuthError:  # pragma: no cover — sync records auth errors itself
        raise HTTPException(
            status_code=409,
            detail={"code": "CONNECTION_REVOKED",
                    "message": "Vercel authorization is no longer valid. Reconnect to sync."},
        )
    except CredentialEncryptionError:
        raise HTTPException(
            status_code=503,
            detail={"code": "CREDENTIAL_ENCRYPTION_NOT_CONFIGURED",
                    "message": "Credential encryption is unavailable; cannot read stored token."},
        )
    # A 401 mid-sync is recorded as a resource error by the sync (partial-failure
    # semantics) AND wipes the dead credential in the client. Re-read the
    # connection so a token that died mid-sync surfaces as the actionable
    # "reconnect" signal rather than as an opaque partial failure.
    latest = vc_store.get_connection(project_id)
    if latest is not None and latest.is_revoked:
        raise HTTPException(
            status_code=409,
            detail={"code": "CONNECTION_REVOKED",
                    "message": "Vercel authorization is no longer valid. Reconnect to sync."},
        )
    return envelope_ok(data={"sync": report.as_dict()}, user_id=user.id)


# ── Disconnect ───────────────────────────────────────────────────────────────

@router.delete("/projects/{project_id}/connection")
def disconnect_project(
    project_id: str = Path(..., max_length=64),
    user: User = Depends(require_auth),
) -> Dict[str, Any]:
    """Delete ALL local credential + binding state for this project.

    Ownership-enforced, and deliberately LOCAL-ONLY: it never calls Vercel, so
    it cannot uninstall an integration, delete a project, or affect any other
    Korvix project's connector. To fully revoke access, the user removes the
    integration in their Vercel dashboard (the UI says so)."""
    _ensure_enabled()
    _require_owned_project(project_id, user)
    vc_setup.delete_pending_projects(project_id)
    conn = vc_store.get_connection(project_id)
    if conn is None:
        return envelope_ok(data={"removed": False, "connected": False}, user_id=user.id)
    removed = vc_store.delete_connection(project_id)
    return envelope_ok(data={"removed": removed, "connected": False}, user_id=user.id)


__all__ = ["router"]
