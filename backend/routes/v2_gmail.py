# coding: utf-8
"""/v2/gmail — Gmail connector (READ-ONLY source of Business Brain observations).

Two surfaces, both gated behind `ENABLE_GMAIL_CONNECTOR` (503 when off, so the
route ships dormant and is turned on with a single env flip):

  Project-scoped (authenticated, ownership-enforced — a caller may only touch a
  project they own, resolved from `projects.get_project(...).owner_user_id`):
    POST   /v2/gmail/projects/{project_id}/connect/start  begin OAuth (returns
                                                           the Google auth URL)
    GET    /v2/gmail/projects/{project_id}/connection     read safe status
    DELETE /v2/gmail/projects/{project_id}/connection     revoke + disconnect
    POST   /v2/gmail/projects/{project_id}/sync           run the bounded read

  Public OAuth callback (state-authenticated, NOT user-authenticated — Google
  redirects the browser here):
    GET    /v2/gmail/oauth/callback                        finish OAuth

The connector is READ-ONLY toward Gmail: none of these routes can send, reply,
draft, delete, archive, or relabel mail (the read client is GET-only and only
requests the gmail.readonly scope).

SECURITY INVARIANTS
  * The client secret + refresh token never leave the backend; no API returns a
    token. Status carries safe metadata only.
  * OAuth state is one-time, TTL-bound, and ownership-bound; the callback trusts
    ONLY the (user, project) stored with the state — never a query param — so a
    callback cannot attach Gmail to another user's project, and a replay is
    rejected.
  * The callback redirects only to a FIXED, server-configured frontend base —
    never a URL from the request — so it can't be turned into an open redirect.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from fastapi.responses import RedirectResponse

from backend.core.deps import require_auth
from backend.core.responses import ok as envelope_ok
from backend.services import google_grant
from backend.services.auth.identity import User
from backend.services.gmail import access as gm_access
from backend.services.gmail import config as gm_config
from backend.services.gmail import crypto as gm_crypto
from backend.services.gmail import oauth as gm_oauth
from backend.services.gmail import state_store as gm_state
from backend.services.gmail import store as gm_store
from backend.services.gmail import sync as gm_sync
from backend.services.gmail.errors import (
    CredentialEncryptionError, GmailAuthError, GmailConfigError, GmailError,
    GmailOAuthError,
)
from backend.services.projects import store as projects_store

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v2/gmail", tags=["gmail-connector"])

_NO_STORE = {"Cache-Control": "no-store, no-cache, must-revalidate, private"}


def _ensure_enabled() -> None:
    if not gm_config.is_enabled():
        raise HTTPException(
            status_code=503,
            detail={
                "code": "GMAIL_CONNECTOR_DISABLED",
                "message": "Gmail connector is disabled. Set ENABLE_GMAIL_CONNECTOR=true.",
                "rollback": "Unset ENABLE_GMAIL_CONNECTOR to disable.",
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
    """Fail closed BEFORE starting OAuth if the connector can't complete it:
    the OAuth client must be configured AND credential encryption must be
    available (else a refresh token could not be stored safely)."""
    if not gm_config.oauth_configured():
        raise HTTPException(
            status_code=503,
            detail={"code": "GMAIL_OAUTH_NOT_CONFIGURED",
                    "message": "Gmail OAuth client is not configured "
                               "(GMAIL_OAUTH_CLIENT_ID / GMAIL_OAUTH_CLIENT_SECRET / "
                               "GMAIL_OAUTH_REDIRECT_URI)."},
        )
    if not gm_crypto.is_configured():
        raise HTTPException(
            status_code=503,
            detail={"code": "CREDENTIAL_ENCRYPTION_NOT_CONFIGURED",
                    "message": "Credential encryption is not configured "
                               "(KORVIX_CREDENTIAL_ENCRYPTION_KEY). Refusing to "
                               "start OAuth without encryption at rest."},
        )


# ── Connect (start) ──────────────────────────────────────────────────────────

@router.post("/projects/{project_id}/connect/start")
def connect_start(
    project_id: str = Path(..., max_length=64),
    user: User = Depends(require_auth),
) -> Dict[str, Any]:
    """Begin the OAuth flow for a project the caller owns. Mints a one-time,
    ownership-bound state and returns the Google authorization URL for the
    browser to navigate to. No secret is returned; the client secret stays
    backend-side."""
    _ensure_enabled()
    _ensure_connect_configured()
    proj = _require_owned_project(project_id, user)

    # Opportunistic housekeeping of stale states (best-effort).
    try:
        gm_state.purge_expired()
    except Exception:  # pragma: no cover — never block the connect
        pass

    state = gm_state.create_state(owner_user_id=proj.owner_user_id, project_id=proj.id)
    try:
        auth_url = gm_oauth.build_authorization_url(state)
    except GmailConfigError:
        raise HTTPException(
            status_code=503,
            detail={"code": "GMAIL_OAUTH_NOT_CONFIGURED",
                    "message": "Gmail OAuth client is not configured."},
        )
    return envelope_ok(
        data={"authorization_url": auth_url, "state": state,
              "scopes": gm_config.scopes()},
        user_id=user.id,
    )


# ── OAuth callback (state-authenticated) ─────────────────────────────────────

def _result_redirect(**params: Any) -> RedirectResponse:
    """Redirect the browser back to the FIXED frontend result page (never a
    URL from the request). Outcome is conveyed via query params the SPA reads."""
    base = gm_config.frontend_result_base()
    path = gm_config.frontend_result_path()
    sep = "&" if "?" in path else "?"
    url = f"{base}{path}{sep}{urlencode({k: v for k, v in params.items() if v is not None})}"
    return RedirectResponse(url=url, status_code=302, headers=_NO_STORE)


@router.get("/oauth/callback")
def oauth_callback(
    state: Optional[str] = Query(default=None, max_length=512),
    code: Optional[str] = Query(default=None, max_length=2048),
    error: Optional[str] = Query(default=None, max_length=200),
) -> RedirectResponse:
    """Finish the OAuth flow. Google redirects the browser here. Identity/target
    come ONLY from the one-time state — never from a query param."""
    if not gm_config.is_enabled():
        # Dormant: bounce to the frontend with a generic error (no 503 page for
        # a browser redirect).
        return _result_redirect(gmail="error", reason="disabled")

    # 1. Consume the state FIRST (one-time; ownership-bound). An invalid /
    #    expired / replayed state is rejected before we touch the code, and we
    #    do not know a project, so we bounce to the fixed frontend base only.
    consumed = gm_state.consume(state or "")
    if consumed is None:
        return _result_redirect(gmail="error", reason="invalid_state")

    project_id = consumed.project_id
    # An ACCOUNT-LEVEL authorization carries no project: the user is connecting
    # Gmail to their Korvix account, and binding it to a project is a separate,
    # explicit act. `project_id` is then empty for the whole callback.
    account_level = not project_id

    # 2. Denied consent / provider error (state was valid, so we can report the
    #    project context back).
    if error:
        return _result_redirect(gmail="error", reason="access_denied",
                                project_id=project_id or None)
    if not code:
        return _result_redirect(gmail="error", reason="missing_code",
                                project_id=project_id or None)

    # 3. Re-validate that the owning project still exists + belongs to the
    #    state's user (defence-in-depth against a project deleted/reassigned
    #    mid-flow). Skipped for an account-level flow — there is no project.
    if not account_level:
        proj = projects_store.get_project(project_id)
        if proj is None or proj.owner_user_id != consumed.owner_user_id:
            return _result_redirect(gmail="error", reason="ownership_mismatch",
                                    project_id=project_id)

    # 4. Exchange the code server-side (client secret backend-only).
    try:
        tokens = gm_oauth.exchange_code(code)
    except GmailOAuthError:
        return _result_redirect(gmail="error", reason="exchange_failed",
                                project_id=project_id)
    except (GmailConfigError, GmailError):
        return _result_redirect(gmail="error", reason="server_error",
                                project_id=project_id)

    # 5. A first-time connect MUST yield a refresh token (offline access). If
    #    Google omitted it (e.g. a prior grant without prompt=consent), require
    #    a real reconnect rather than storing a connection we can't refresh —
    #    unless we already hold one for this project (reconnect keeps it).
    refresh_token = tokens.refresh_token
    if not refresh_token:
        # Reuse the credential we already hold for THIS OWNER'S Gmail
        # authorization (account-level), which covers both the reconnect of an
        # existing project and a re-consent with no project in flight.
        existing_auth = gm_store.get_authorization_for_owner(consumed.owner_user_id)
        if existing_auth is not None and not existing_auth.is_revoked:
            try:
                refresh_token = existing_auth.decrypt("refresh_token")
            except CredentialEncryptionError:
                refresh_token = ""
        if not refresh_token:
            return _result_redirect(gmail="error", reason="no_refresh_token",
                                    project_id=project_id or None)

    # 6. Read the connected account's own address (within gmail.readonly).
    google_email = gm_oauth.fetch_account_email(tokens.access_token)

    # 7. Persist the connection with the refresh token ENCRYPTED at rest. A
    #    missing encryption key fails closed (no plaintext ever written).
    from datetime import datetime, timedelta
    access_expires = (datetime.utcnow() + timedelta(seconds=max(0, tokens.expires_in))).isoformat() + "Z"
    try:
        if account_level:
            # Account-level: store the authorization ONLY. No project is exposed
            # to Gmail by connecting it — a binding is a separate, explicit act.
            auth = gm_store.authorize_account(
                owner_user_id=consumed.owner_user_id,   # authoritative — from state
                google_email=google_email,
                scopes=tokens.scope or gm_config.scope_param(),
                refresh_token=refresh_token,
                access_token=tokens.access_token,
                access_token_expires=access_expires,
            )
            if auth is None:
                return _result_redirect(gmail="error", reason="store_failed")
            return _result_redirect(gmail="connected")
        conn = gm_store.upsert_connection(
            project_id=project_id,
            owner_user_id=consumed.owner_user_id,   # authoritative — from state
            google_email=google_email,
            scopes=tokens.scope or gm_config.scope_param(),
            refresh_token=refresh_token,
            access_token=tokens.access_token,
            access_token_expires=access_expires,
        )
    except CredentialEncryptionError:
        return _result_redirect(gmail="error", reason="encryption_unavailable",
                                project_id=project_id or None)
    if conn is None:
        return _result_redirect(gmail="error", reason="store_failed",
                                project_id=project_id)

    return _result_redirect(gmail="connected", project_id=project_id)


# ── Status ───────────────────────────────────────────────────────────────────

@router.get("/projects/{project_id}/connection")
def get_connection(
    project_id: str = Path(..., max_length=64),
    user: User = Depends(require_auth),
) -> Dict[str, Any]:
    """Safe connection metadata only — NEVER a token/secret."""
    _ensure_enabled()
    _require_owned_project(project_id, user)
    conn = gm_store.get_connection(project_id)
    return envelope_ok(
        data={"connection": conn.public_view() if conn else None,
              "connected": bool(conn and conn.status == gm_store.STATUS_CONNECTED)},
        user_id=user.id,
    )


# ── Sync (bounded read) ──────────────────────────────────────────────────────

@router.post("/projects/{project_id}/sync")
def sync_project(
    project_id: str = Path(..., max_length=64),
    user: User = Depends(require_auth),
) -> Dict[str, Any]:
    """Run the bounded Gmail read for a connected project. Records observations
    only — never creates a task/decision/run, never calls a model. Partial /
    auth failure is reported truthfully."""
    _ensure_enabled()
    _require_owned_project(project_id, user)
    conn = gm_store.get_connection(project_id)
    if conn is None:
        raise HTTPException(
            status_code=409,
            detail={"code": "NOT_CONNECTED",
                    "message": "Project is not connected to Gmail. Start the connect flow first."},
        )
    if conn.is_revoked:
        raise HTTPException(
            status_code=409,
            detail={"code": "CONNECTION_REVOKED",
                    "message": "Gmail authorization was revoked. Reconnect to sync."},
        )
    try:
        report = gm_sync.sync_connection(conn)
    except GmailAuthError:
        # Refresh failed / grant revoked mid-sync — the connection is now marked
        # revoked by the access provider. Surface a clean reconnect signal.
        raise HTTPException(
            status_code=409,
            detail={"code": "CONNECTION_REVOKED",
                    "message": "Gmail authorization is no longer valid. Reconnect to sync."},
        )
    except CredentialEncryptionError:
        raise HTTPException(
            status_code=503,
            detail={"code": "CREDENTIAL_ENCRYPTION_NOT_CONFIGURED",
                    "message": "Credential encryption is unavailable; cannot read stored token."},
        )
    return envelope_ok(data={"sync": report.as_dict()}, user_id=user.id)


# ── Disconnect ───────────────────────────────────────────────────────────────

@router.delete("/projects/{project_id}/connection")
def disconnect_project(
    project_id: str = Path(..., max_length=64),
    user: User = Depends(require_auth),
) -> Dict[str, Any]:
    """Delete all local Gmail credential material and revoke the grant at Google
    when that is provably safe. Ownership-enforced.

    Local deletion is unconditional and is what actually ends Korvix's access.
    The remote revoke is now gated by `google_grant.remote_revoke_is_safe`:
    Korvix's Google connectors (Gmail + Google Calendar) may share ONE Google
    OAuth client, and Google merges such consents into a SINGLE grant per
    (client, user) — so an ungated revoke here would silently break a live
    Calendar connection for the same account. The gate is a pure read and is a
    no-op for the common case (no sibling Google connection ⇒ revoke as before).
    Touches NO Calendar row under any circumstance."""
    _ensure_enabled()
    _require_owned_project(project_id, user)
    conn = gm_store.get_connection(project_id)
    if conn is None:
        return envelope_ok(
            data={"removed": False, "connected": False, "revoked_remotely": False},
            user_id=user.id)

    # Decide BEFORE deleting, so this connection's own row is the only one
    # excluded from the sibling scan.
    revoke_safe = google_grant.remote_revoke_is_safe(
        provider=google_grant.PROVIDER_GMAIL,
        google_email=conn.google_email,
        project_id=project_id,
    )
    revoked_remotely = False
    if revoke_safe:
        # Best-effort remote revoke using the stored refresh token. A missing
        # encryption key just skips it; the row is deleted either way
        # (disconnect must always succeed locally).
        try:
            rt = gm_store.decrypt_refresh_token(conn)
            if rt:
                revoked_remotely = bool(gm_oauth.revoke_token(rt))
        except Exception:  # pragma: no cover — revoke is best-effort
            revoked_remotely = False

    removed = gm_store.delete_connection(project_id)
    return envelope_ok(
        data={"removed": removed, "connected": False,
              "revoked_remotely": revoked_remotely},
        user_id=user.id,
    )


__all__ = ["router"]
