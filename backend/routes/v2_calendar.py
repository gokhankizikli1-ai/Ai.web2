# coding: utf-8
"""/v2/calendar — Google Calendar connector (READ-ONLY source of observations).

Two surfaces, both gated behind `ENABLE_CALENDAR_CONNECTOR` (503 when off, so the
route ships dormant and is turned on with a single env flip):

  Project-scoped (authenticated, ownership-enforced — a caller may only touch a
  project they own, resolved from `projects.get_project(...).owner_user_id`):
    POST   /v2/calendar/projects/{project_id}/connect/start  begin OAuth (returns
                                                             the Google auth URL)
    GET    /v2/calendar/projects/{project_id}/connection     read safe status
    DELETE /v2/calendar/projects/{project_id}/connection     disconnect
    POST   /v2/calendar/projects/{project_id}/sync           run the bounded read

  Public OAuth callback (state-authenticated, NOT user-authenticated — Google
  redirects the browser here):
    GET    /v2/calendar/oauth/callback                       finish OAuth

The connector is READ-ONLY toward Google Calendar: none of these routes can
create, edit, move, or delete an event (the read client is GET-only and the sole
requested scope is calendar.events.readonly).

SECURITY INVARIANTS  (identical to the Gmail/Vercel connector routes)
  * The client secret + refresh token never leave the backend; no API returns a
    token. Status carries safe metadata only.
  * OAuth state is one-time, TTL-bound, and ownership-bound; the callback trusts
    ONLY the (user, project) stored with the state — never a query param — so a
    callback cannot attach a calendar to another user's project, and a replay is
    rejected.
  * The callback redirects only to a FIXED, server-configured frontend base —
    never a URL from the request — so it can't be turned into an open redirect.

GMAIL ISOLATION
  Calendar and Gmail may share ONE Google OAuth client, but they are separate
  connections: separate state table, separate connection table, separate refresh
  token, separate scope. Disconnect here deletes ONLY the Calendar row, and the
  optional remote token revoke is gated by `google_grant.remote_revoke_is_safe`
  so it can never destroy a live Gmail grant.
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
from backend.services.google_calendar import config as cal_config
from backend.services.google_calendar import oauth as cal_oauth
from backend.services.google_calendar import state_store as cal_state
from backend.services.google_calendar import store as cal_store
from backend.services.google_calendar import sync as cal_sync
from backend.services.google_calendar.errors import (
    CalendarAuthError, CalendarConfigError, CalendarError, CalendarOAuthError,
    CredentialEncryptionError,
)
from backend.services.projects import store as projects_store

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v2/calendar", tags=["calendar-connector"])

_NO_STORE = {"Cache-Control": "no-store, no-cache, must-revalidate, private"}


def _ensure_enabled() -> None:
    if not cal_config.is_enabled():
        raise HTTPException(
            status_code=503,
            detail={
                "code": "CALENDAR_CONNECTOR_DISABLED",
                "message": "Google Calendar connector is disabled. Set ENABLE_CALENDAR_CONNECTOR=true.",
                "rollback": "Unset ENABLE_CALENDAR_CONNECTOR to disable.",
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
    """Fail closed BEFORE starting OAuth if the connector can't complete it: the
    OAuth client must be configured AND credential encryption must be available
    (else a refresh token could not be stored safely)."""
    if not cal_config.oauth_configured():
        raise HTTPException(
            status_code=503,
            detail={"code": "CALENDAR_OAUTH_NOT_CONFIGURED",
                    "message": "Google Calendar OAuth client is not configured "
                               "(GMAIL_OAUTH_CLIENT_ID / GMAIL_OAUTH_CLIENT_SECRET "
                               "or CALENDAR_OAUTH_CLIENT_ID / "
                               "CALENDAR_OAUTH_CLIENT_SECRET, plus "
                               "CALENDAR_OAUTH_REDIRECT_URI)."},
        )
    if not cal_config.credential_encryption_configured():
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
        cal_state.purge_expired()
    except Exception:  # pragma: no cover — never block the connect
        pass

    state = cal_state.create_state(owner_user_id=proj.owner_user_id, project_id=proj.id)
    try:
        auth_url = cal_oauth.build_authorization_url(state)
    except CalendarConfigError:
        raise HTTPException(
            status_code=503,
            detail={"code": "CALENDAR_OAUTH_NOT_CONFIGURED",
                    "message": "Google Calendar OAuth client is not configured."},
        )
    return envelope_ok(
        data={"authorization_url": auth_url, "state": state,
              "scopes": cal_config.scopes()},
        user_id=user.id,
    )


# ── OAuth callback (state-authenticated) ─────────────────────────────────────

def _result_redirect(**params: Any) -> RedirectResponse:
    """Redirect the browser back to the FIXED frontend result page (never a URL
    from the request). Outcome is conveyed via query params the SPA reads."""
    base = cal_config.frontend_result_base()
    path = cal_config.frontend_result_path()
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
    if not cal_config.is_enabled():
        # Dormant: bounce to the frontend with a generic error (no 503 page for
        # a browser redirect).
        return _result_redirect(calendar="error", reason="disabled")

    # 1. Consume the state FIRST (one-time; ownership-bound). An invalid /
    #    expired / replayed state is rejected before we touch the code, and we
    #    do not know a project, so we bounce to the fixed frontend base only.
    consumed = cal_state.consume(state or "")
    if consumed is None:
        return _result_redirect(calendar="error", reason="invalid_state")

    project_id = consumed.project_id
    # An ACCOUNT-LEVEL authorization carries no project: the user is connecting
    # Calendar to their Korvix account, and binding it to a project is a
    # separate, explicit act.
    account_level = not project_id

    # 2. Denied consent / provider error (state was valid, so we can report the
    #    project context back).
    if error:
        return _result_redirect(calendar="error", reason="access_denied",
                                project_id=project_id or None)
    if not code:
        return _result_redirect(calendar="error", reason="missing_code",
                                project_id=project_id or None)

    # 3. Re-validate that the owning project still exists + belongs to the
    #    state's user (defence-in-depth against a project deleted/reassigned
    #    mid-flow). Skipped for an account-level flow — there is no project.
    if not account_level:
        proj = projects_store.get_project(project_id)
        if proj is None or proj.owner_user_id != consumed.owner_user_id:
            return _result_redirect(calendar="error", reason="ownership_mismatch",
                                    project_id=project_id)

    # 4. Exchange the code server-side (client secret backend-only).
    try:
        tokens = cal_oauth.exchange_code(code)
    except CalendarOAuthError:
        return _result_redirect(calendar="error", reason="exchange_failed",
                                project_id=project_id or None)
    except (CalendarConfigError, CalendarError):
        return _result_redirect(calendar="error", reason="server_error",
                                project_id=project_id or None)

    # 5. A first-time connect MUST yield a refresh token (offline access). If
    #    Google omitted it, require a real reconnect rather than storing a
    #    connection we can't refresh — unless we already hold one for this
    #    project (reconnect keeps it). Only the CALENDAR connection is consulted;
    #    a Gmail refresh token is never reused here (different scope, different
    #    consent).
    refresh_token = tokens.refresh_token
    if not refresh_token:
        # Reuse the credential we already hold for THIS OWNER'S CALENDAR
        # authorization. A Gmail refresh token is still never reused here
        # (different scope, different consent) — this reads the calendar
        # provider's own authorization only.
        existing_auth = cal_store.get_authorization_for_owner(consumed.owner_user_id)
        if existing_auth is not None and not existing_auth.is_revoked:
            try:
                refresh_token = existing_auth.decrypt("refresh_token")
            except CredentialEncryptionError:
                refresh_token = ""
        if not refresh_token:
            return _result_redirect(calendar="error", reason="no_refresh_token",
                                    project_id=project_id or None)

    # 6. Read the connected calendar's label + timezone (a bounded events.list
    #    probe — within the granted scope, no extra scope requested). Best
    #    effort: failing here must not abort a successful token exchange.
    identity = cal_oauth.fetch_calendar_identity(tokens.access_token)

    # 7. Persist the connection with the refresh token ENCRYPTED at rest. A
    #    missing encryption key fails closed (no plaintext ever written). This
    #    writes ONLY calendar_connections.
    from datetime import datetime, timedelta
    access_expires = (datetime.utcnow() + timedelta(seconds=max(0, tokens.expires_in))).isoformat() + "Z"
    try:
        if account_level:
            # Account-level: store the authorization ONLY. No project is exposed
            # to Calendar by connecting it — a binding is a separate act.
            auth = cal_store.authorize_account(
                owner_user_id=consumed.owner_user_id,   # authoritative — from state
                google_email=identity.google_email,
                scopes=tokens.scope or cal_config.scope_param(),
                refresh_token=refresh_token,
                access_token=tokens.access_token,
                access_token_expires=access_expires,
            )
            if auth is None:
                return _result_redirect(calendar="error", reason="store_failed")
            return _result_redirect(calendar="connected")
        conn = cal_store.upsert_connection(
            project_id=project_id,
            owner_user_id=consumed.owner_user_id,   # authoritative — from state
            google_email=identity.google_email,
            calendar_id=identity.calendar_id,
            time_zone=identity.time_zone,
            scopes=tokens.scope or cal_config.scope_param(),
            refresh_token=refresh_token,
            access_token=tokens.access_token,
            access_token_expires=access_expires,
        )
    except CredentialEncryptionError:
        return _result_redirect(calendar="error", reason="encryption_unavailable",
                                project_id=project_id or None)
    if conn is None:
        return _result_redirect(calendar="error", reason="store_failed",
                                project_id=project_id)

    return _result_redirect(calendar="connected", project_id=project_id)


# ── Status ───────────────────────────────────────────────────────────────────

@router.get("/projects/{project_id}/connection")
def get_connection(
    project_id: str = Path(..., max_length=64),
    user: User = Depends(require_auth),
) -> Dict[str, Any]:
    """Safe connection metadata only — NEVER a token/secret."""
    _ensure_enabled()
    _require_owned_project(project_id, user)
    conn = cal_store.get_connection(project_id)
    return envelope_ok(
        data={"connection": conn.public_view() if conn else None,
              "connected": bool(conn and conn.status == cal_store.STATUS_CONNECTED)},
        user_id=user.id,
    )


# ── Sync (bounded read) ──────────────────────────────────────────────────────

@router.post("/projects/{project_id}/sync")
def sync_project(
    project_id: str = Path(..., max_length=64),
    user: User = Depends(require_auth),
) -> Dict[str, Any]:
    """Run the bounded, read-only Calendar read for a connected project. Records
    observations only — never creates a task/decision/run, never calls a model.
    Partial / auth failure is reported truthfully."""
    _ensure_enabled()
    _require_owned_project(project_id, user)
    conn = cal_store.get_connection(project_id)
    if conn is None:
        raise HTTPException(
            status_code=409,
            detail={"code": "NOT_CONNECTED",
                    "message": "Project is not connected to Google Calendar. "
                               "Start the connect flow first."},
        )
    if conn.is_revoked:
        raise HTTPException(
            status_code=409,
            detail={"code": "CONNECTION_REVOKED",
                    "message": "Google Calendar authorization was revoked. Reconnect to sync."},
        )
    try:
        report = cal_sync.sync_connection(conn)
    except CalendarAuthError:
        # Refresh failed / grant revoked mid-sync — the connection is now marked
        # revoked by the access provider. Surface a clean reconnect signal.
        raise HTTPException(
            status_code=409,
            detail={"code": "CONNECTION_REVOKED",
                    "message": "Google Calendar authorization is no longer valid. "
                               "Reconnect to sync."},
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
    """Delete all locally stored Calendar credential material for this project,
    and revoke the grant at Google ONLY when that is provably safe.

    Local deletion is unconditional and is what actually ends Korvix's access.
    The remote revoke is gated by `google_grant.remote_revoke_is_safe` because
    Gmail and Calendar may share one Google OAuth client, and Google merges such
    consents into a SINGLE grant per (client, user) — an ungated revoke here
    would silently break the project's Gmail connection. When the revoke is
    skipped, `revoked_remotely` says so truthfully and the UI tells the user how
    to remove the grant entirely at their Google account.

    Ownership-enforced. Touches NO Gmail row under any circumstance."""
    _ensure_enabled()
    _require_owned_project(project_id, user)
    conn = cal_store.get_connection(project_id)
    if conn is None:
        return envelope_ok(
            data={"removed": False, "connected": False, "revoked_remotely": False},
            user_id=user.id)

    # Decide BEFORE deleting, so this connection's own row is the only one
    # excluded from the sibling scan.
    revoke_safe = google_grant.remote_revoke_is_safe(
        provider=google_grant.PROVIDER_CALENDAR,
        google_email=conn.google_email,
        project_id=project_id,
    )
    revoked_remotely = False
    if revoke_safe:
        try:
            rt = cal_store.decrypt_refresh_token(conn)
            if rt:
                revoked_remotely = cal_oauth.revoke_token(rt)
        except Exception:  # pragma: no cover — revoke is best-effort
            revoked_remotely = False

    removed = cal_store.delete_connection(project_id)
    return envelope_ok(
        data={"removed": removed, "connected": False,
              "revoked_remotely": revoked_remotely},
        user_id=user.id,
    )


__all__ = ["router"]
