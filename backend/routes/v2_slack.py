# coding: utf-8
"""/v2/slack — Slack connector (READ-ONLY source of Business Brain observations).

Two surfaces, both gated behind `ENABLE_SLACK_CONNECTOR` (503 when off, so the
route ships dormant and is turned on with a single env flip):

  Project-scoped (authenticated, ownership-enforced — a caller may only touch a
  project they own, resolved from `projects.get_project(...).owner_user_id`):
    POST   /v2/slack/projects/{project_id}/connect/start     begin the Slack
                                                              install flow
    GET    /v2/slack/projects/{project_id}/connection        read safe status
    GET    /v2/slack/projects/{project_id}/pending-channels  the channels this
                                                              installation can
                                                              actually see
    POST   /v2/slack/projects/{project_id}/connect/select    bind one or more
    POST   /v2/slack/projects/{project_id}/sync              run the bounded read
    DELETE /v2/slack/projects/{project_id}/connection        disconnect (local)

  Public OAuth callback (state-authenticated, NOT user-authenticated — Slack
  redirects the browser here):
    GET    /v2/slack/oauth/callback                          finish the install

The connector is READ-ONLY toward Slack: none of these routes can post, edit or
delete a message, create/archive/rename a channel, invite or remove a member,
add or remove a reaction, read a file, read a user profile, or change any
workspace setting. The client is GET-only across four read methods; disconnect
removes LOCAL credential/binding state and never calls Slack at all.

SECURITY INVARIANTS
  * The client secret + bot token never leave the backend; no API returns a
    token. Status carries safe metadata only.
  * OAuth state is one-time, TTL-bound, and ownership-bound; the callback trusts
    ONLY the (user, project) stored with the state — never a query param — so a
    callback cannot attach Slack to another user's Korvix project, and a replay
    is rejected.
  * The workspace identity comes from the TOKEN EXCHANGE RESPONSE, never from a
    callback query param (which is attacker-supplied).
  * A client-supplied channel id is validated against the server-stored pending
    set AND re-verified live against Slack under this installation's own token
    before it is ever bound — and a channel the bot cannot actually read
    (`is_member=false`, or invisible to `conversations.info`) is REFUSED rather
    than bound as if it were readable.
  * The callback redirects only to a FIXED, server-configured frontend base —
    never a URL from the request — so it can't be turned into an open redirect.

SHARED WORKSPACE INSTALLATIONS
  Slack installs an app ONCE PER WORKSPACE, so two Korvix projects that connect
  the same workspace are backed by the SAME installation. Disconnect is
  therefore deliberately LOCAL-ONLY (no `auth.revoke` exists in this package):
  removing one project's connection can never break another project's, and the
  response says truthfully whether the workspace installation survives.
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
from backend.services.slack import config as sl_config
from backend.services.slack import oauth as sl_oauth
from backend.services.slack import setup_state as sl_setup
from backend.services.slack import store as sl_store
from backend.services.slack import sync as sl_sync
from backend.services.slack.client import SlackClient, channel_identity
from backend.services.slack.errors import (
    CredentialEncryptionError, SlackAccessError, SlackAuthError,
    SlackConfigError, SlackError, SlackOAuthError, SlackRateLimitError,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v2/slack", tags=["slack-connector"])

_NO_STORE = {"Cache-Control": "no-store, no-cache, must-revalidate, private"}


def _ensure_enabled() -> None:
    if not sl_config.is_enabled():
        raise HTTPException(
            status_code=503,
            detail={
                "code": "SLACK_CONNECTOR_DISABLED",
                "message": "Slack connector is disabled. Set ENABLE_SLACK_CONNECTOR=true.",
                "rollback": "Unset ENABLE_SLACK_CONNECTOR to disable.",
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
    the Slack app OAuth client must be configured AND credential encryption must
    be available (else the bot token could not be stored safely)."""
    if not sl_config.oauth_configured():
        raise HTTPException(
            status_code=503,
            detail={"code": "SLACK_OAUTH_NOT_CONFIGURED",
                    "message": "Slack app is not configured (SLACK_CLIENT_ID / "
                               "SLACK_CLIENT_SECRET / SLACK_OAUTH_REDIRECT_URI)."},
        )
    if not sl_config.encryption_configured():
        raise HTTPException(
            status_code=503,
            detail={"code": "CREDENTIAL_ENCRYPTION_NOT_CONFIGURED",
                    "message": "Credential encryption is not configured "
                               "(KORVIX_CREDENTIAL_ENCRYPTION_KEY). Refusing to "
                               "start the Slack install without encryption at rest."},
        )


def _require_live_connection(project_id: str, user: User) -> sl_store.SlackConnection:
    """The connection for a project, or a typed 409 when it is missing, revoked,
    or owned by a different account than the authenticated caller.

    Project ownership must already have been checked by the caller. The extra
    owner check here closes a second, subtler gap: `owner_user_id` on the
    connection row is what scopes every observation this connector ingests, so if
    it ever diverged from the project's current owner (there is no ownership
    transfer in the product today, but a stale row must not be trusted on faith)
    a sync would file this project's Slack activity under a user who no longer
    owns it. Rather than bind or ingest under a stale identity, every read/write
    path fails closed and asks for a reconnect — disconnect deliberately does NOT
    use this gate, so the owner always has a way to clear the stale row."""
    conn = sl_store.get_connection(project_id)
    if conn is None:
        raise HTTPException(
            status_code=409,
            detail={"code": "NOT_CONNECTED",
                    "message": "Slack is not connected for this project. "
                               "Start the connect flow first."},
        )
    if conn.is_revoked:
        raise HTTPException(
            status_code=409,
            detail={"code": "CONNECTION_REVOKED",
                    "message": "Slack authorization is no longer valid. Reconnect."},
        )
    if conn.owner_user_id != user.id:
        raise HTTPException(
            status_code=409,
            detail={"code": "CONNECTION_OWNER_MISMATCH",
                    "message": "This Slack connection was made by a different "
                               "account. Disconnect it and connect Slack again."},
        )
    return conn


# ── Connect (start) ──────────────────────────────────────────────────────────

@router.post("/projects/{project_id}/connect/start")
def connect_start(
    project_id: str = Path(..., max_length=64),
    user: User = Depends(require_auth),
) -> Dict[str, Any]:
    """Begin the Slack install flow for a project the caller owns. Mints a
    one-time, ownership-bound state and returns the Slack authorization URL for
    the browser to navigate to. No secret is returned; the client secret stays
    backend-side, and no channel is chosen client-side."""
    _ensure_enabled()
    _ensure_connect_configured()
    proj = _require_owned_project(project_id, user)

    # Opportunistic housekeeping of stale states (best-effort).
    try:
        sl_setup.purge_expired()
    except Exception:  # pragma: no cover — never block the connect
        pass

    state = sl_setup.create_state(owner_user_id=proj.owner_user_id, project_id=proj.id)
    try:
        auth_url = sl_oauth.build_authorization_url(state)
    except SlackConfigError:
        raise HTTPException(
            status_code=503,
            detail={"code": "SLACK_OAUTH_NOT_CONFIGURED",
                    "message": "Slack app is not configured."},
        )
    return envelope_ok(
        data={"authorization_url": auth_url, "state": state,
              "scopes": sl_config.scopes()},
        user_id=user.id,
    )


# ── OAuth callback (state-authenticated) ─────────────────────────────────────

def _result_redirect(**params: Any) -> RedirectResponse:
    """Redirect the browser back to the FIXED frontend result page (never a URL
    from the request). Outcome is conveyed via query params the SPA reads."""
    base = sl_config.frontend_result_base()
    path = sl_config.frontend_result_path()
    sep = "&" if "?" in path else "?"
    url = f"{base}{path}{sep}{urlencode({k: v for k, v in params.items() if v is not None})}"
    return RedirectResponse(url=url, status_code=302, headers=_NO_STORE)


@router.get("/oauth/callback")
def oauth_callback(
    state: Optional[str] = Query(default=None, max_length=512),
    code: Optional[str] = Query(default=None, max_length=2048),
    error: Optional[str] = Query(default=None, max_length=200),
) -> RedirectResponse:
    """Finish the Slack install. Slack redirects the browser here.

    Identity/target come ONLY from the one-time state — never from a query
    param — and the workspace comes ONLY from the token-exchange response. The
    authorization CODE is used once for the exchange and never persisted."""
    if not sl_config.is_enabled():
        # Dormant: bounce to the frontend with a generic error (no 503 page for
        # a browser redirect).
        return _result_redirect(slack="error", reason="disabled")

    # 1. Consume the state FIRST (one-time; ownership-bound). An invalid /
    #    expired / replayed state is rejected before we touch the code, and we
    #    do not know a project, so we bounce to the fixed frontend base only.
    consumed = sl_setup.consume(state or "")
    if consumed is None:
        return _result_redirect(slack="error", reason="invalid_state")

    project_id = consumed.project_id
    # An ACCOUNT-LEVEL install carries no project: the user is installing the
    # Korvix app into their Slack workspace. Which Korvix project reads which
    # channels stays a separate, explicit act.
    account_level = not project_id

    # 2. Denied consent / provider error (state was valid, so we can report the
    #    project context back).
    if error:
        return _result_redirect(slack="error", reason="access_denied",
                                project_id=project_id or None)
    if not code:
        return _result_redirect(slack="error", reason="missing_code",
                                project_id=project_id or None)

    # 3. Re-validate that the owning project still exists + belongs to the
    #    state's user (defence-in-depth against a project deleted/reassigned
    #    mid-flow). Skipped for an account-level flow — there is no project.
    if not account_level:
        proj = projects_store.get_project(project_id)
        if proj is None or proj.owner_user_id != consumed.owner_user_id:
            return _result_redirect(slack="error", reason="ownership_mismatch",
                                    project_id=project_id)

    # 4. Exchange the code server-side (client secret backend-only). The code
    #    itself is never stored — it lives only as this call's argument.
    try:
        tokens = sl_oauth.exchange_code(code)
    except SlackOAuthError:
        return _result_redirect(slack="error", reason="exchange_failed",
                                project_id=project_id or None)
    except (SlackConfigError, SlackError):
        return _result_redirect(slack="error", reason="server_error",
                                project_id=project_id or None)

    # 5. Persist the installation with the BOT token ENCRYPTED at rest. A
    #    missing encryption key fails closed (no plaintext ever written). The
    #    connection lands in `pending_selection`: nothing syncs until the user
    #    explicitly chooses WHICH channels belong to this Korvix project.
    try:
        if account_level:
            # Account-level: store the workspace authorization ONLY. No channel
            # is read, and no project is exposed, until the user binds one.
            auth = sl_store.authorize_account(
                owner_user_id=consumed.owner_user_id,   # authoritative — from state
                bot_token=tokens.access_token,
                team_id=tokens.team_id,                 # authoritative — from token
                team_name=tokens.team_name,
                bot_user_id=tokens.bot_user_id,
                app_id=tokens.app_id,
                scopes=tokens.scope,
            )
            if auth is None:
                return _result_redirect(slack="error", reason="store_failed")
            return _result_redirect(slack="authorized")
        conn = sl_store.upsert_installation(
            project_id=project_id,
            owner_user_id=consumed.owner_user_id,   # authoritative — from state
            bot_token=tokens.access_token,
            team_id=tokens.team_id,                 # authoritative — from token
            team_name=tokens.team_name,
            bot_user_id=tokens.bot_user_id,
            app_id=tokens.app_id,
            scopes=tokens.scope,
        )
    except CredentialEncryptionError:
        return _result_redirect(slack="error", reason="encryption_unavailable",
                                project_id=project_id or None)
    if conn is None:
        return _result_redirect(slack="error", reason="store_failed",
                                project_id=project_id)

    # 6. Populate the bounded pending-channel set so the SPA can render a picker
    #    immediately. A provider hiccup here is NOT fatal — the pending-channels
    #    endpoint re-reads live when the set is empty.
    try:
        _refresh_pending(conn)
    except Exception:  # pragma: no cover — best-effort pre-population
        pass

    return _result_redirect(slack="authorized", project_id=project_id)


# ── Pending channels (server-authoritative picker source) ────────────────────

def _refresh_pending(conn: sl_store.SlackConnection) -> List[sl_setup.PendingChannel]:
    """Read the channels THIS installation can actually see (bounded, read-only)
    and replace the stored pending set.

    This is the authoritative "which Slack channels may this connection touch"
    answer — the picker never invents ids, and a stale set can never widen
    access. Slack's own `is_member` flag is carried through untouched, because a
    bot can only read the history of a conversation it belongs to. Raises the
    client's typed errors on a provider failure."""
    client = SlackClient(conn)
    payload = []
    for raw in client.list_channels():
        ident = channel_identity(raw)
        if not ident["id"] or ident["is_archived"]:
            continue
        payload.append({
            "channel_id": ident["id"],
            "name": ident["name"],
            "is_private": ident["is_private"],
            "is_member": ident["is_member"],
        })
    return sl_setup.replace_pending_channels(
        project_id=conn.project_id, owner_user_id=conn.owner_user_id,
        channels=payload,
    )


@router.get("/projects/{project_id}/pending-channels")
def pending_channels(
    project_id: str = Path(..., max_length=64),
    refresh: bool = Query(default=False),
    user: User = Depends(require_auth),
) -> Dict[str, Any]:
    """The Slack channels the caller may bind to this Korvix project.

    Owner-only; returns token-free display metadata for the picker, including
    Slack's `is_member` truth so the UI can explain why a channel is not
    connectable yet. The stored set is re-read live from Slack when it is
    empty/expired, or when `refresh` is requested (the "change channels" path) —
    so the picker is always a faithful mirror of what the installation currently
    sees. `max_selected` tells the client the server-enforced selection cap."""
    _ensure_enabled()
    _require_owned_project(project_id, user)
    conn = _require_live_connection(project_id, user)

    pending = sl_setup.list_pending_channels(project_id, owner_user_id=user.id)
    if refresh or not pending:
        try:
            pending = _refresh_pending(conn)
        except SlackAuthError:
            raise HTTPException(
                status_code=409,
                detail={"code": "CONNECTION_REVOKED",
                        "message": "Slack authorization is no longer valid. Reconnect."},
            )
        except SlackRateLimitError:
            # Slack throttles per method; say so instead of reporting an empty
            # workspace, so the user retries rather than concluding there are no
            # channels.
            raise HTTPException(
                status_code=429,
                detail={"code": "SLACK_RATE_LIMITED",
                        "message": "Slack is rate limiting this workspace. "
                                   "Wait a moment and refresh the list."},
            )
        except CredentialEncryptionError:
            raise HTTPException(
                status_code=503,
                detail={"code": "CREDENTIAL_ENCRYPTION_NOT_CONFIGURED",
                        "message": "Credential encryption is unavailable; cannot "
                                   "read the stored token."},
            )
        except SlackError:
            raise HTTPException(
                status_code=502,
                detail={"code": "SLACK_UNAVAILABLE",
                        "message": "Could not list Slack channels for this installation."},
            )
    return envelope_ok(
        data={"channels": [p.public_view() for p in pending],
              "count": len(pending),
              "max_selected": sl_config.max_selected_channels()},
        user_id=user.id,
    )


class SelectChannelsBody(BaseModel):
    channel_ids: List[str] = Field(
        ..., min_length=1, max_length=25,
        description="Slack channel ids from the server-provided pending list.")


@router.post("/projects/{project_id}/connect/select")
def connect_select(
    project_id: str = Path(..., max_length=64),
    body: SelectChannelsBody = ...,
    user: User = Depends(require_auth),
) -> Dict[str, Any]:
    """Finalize the connection: bind one or more Slack channels to this Korvix
    project.

    Every supplied id is validated THREE times and trusted at no step alone:
      1. it must match a currently-pending, owner-bound row (client input is
         checked against the server-stored set, never accepted on its own);
      2. it is re-verified LIVE against Slack under this installation's own bot
         token, so a stale pending row can never bind a channel the
         installation no longer covers (a private channel the bot is not in is
         invisible to Slack's own lookup and is therefore rejected here);
      3. Slack's live `is_member` must be true — a bot can only read the history
         of a conversation it belongs to, so binding a non-member channel would
         claim access Korvix does not have.

    The count is capped at `SLACK_MAX_SELECTED_CHANNELS`; an over-long request
    is REFUSED rather than silently truncated."""
    _ensure_enabled()
    _require_owned_project(project_id, user)
    conn = _require_live_connection(project_id, user)

    requested: List[str] = []
    for raw in body.channel_ids:
        cid = str(raw or "").strip()
        if cid and cid not in requested:
            requested.append(cid)
    cap = sl_config.max_selected_channels()
    if not requested:
        raise HTTPException(
            status_code=422,
            detail={"code": "NO_CHANNELS", "message": "Choose at least one channel."},
        )
    if len(requested) > cap:
        raise HTTPException(
            status_code=400,
            detail={"code": "TOO_MANY_CHANNELS",
                    "message": f"Choose at most {cap} channels for one project."},
        )

    client = SlackClient(conn)
    resolved: List[Dict[str, Any]] = []
    for cid in requested:
        pending = sl_setup.get_pending_channel(
            project_id, owner_user_id=user.id, channel_id=cid)
        if pending is None:
            # 400, not 404: the caller has already proved they own this project,
            # so this is a REQUEST-BODY validation failure ("that id is not in
            # the list we gave you"), not a hidden resource. Using 404 here would
            # also collide with the project-not-found 404 that every connector
            # client renders as "this project is not available on the server yet",
            # which would be a misleading thing to show for a stale channel list.
            raise HTTPException(
                status_code=400,
                detail={"code": "NO_PENDING_CHANNEL",
                        "message": "That channel is not in this project's available "
                                   "list. Refresh the list and try again."},
            )
        # Live server-side revalidation under this installation's own token.
        try:
            channel = client.get_channel(pending.channel_id)
        except SlackAuthError:
            raise HTTPException(
                status_code=409,
                detail={"code": "CONNECTION_REVOKED",
                        "message": "Slack authorization is no longer valid. Reconnect."},
            )
        except SlackAccessError:
            raise HTTPException(
                status_code=400,
                detail={"code": "CHANNEL_NOT_ACCESSIBLE",
                        "message": "That channel is not accessible to Korvix in Slack."},
            )
        except SlackRateLimitError:
            raise HTTPException(
                status_code=429,
                detail={"code": "SLACK_RATE_LIMITED",
                        "message": "Slack is rate limiting this workspace. "
                                   "Wait a moment and try again."},
            )
        except CredentialEncryptionError:
            raise HTTPException(
                status_code=503,
                detail={"code": "CREDENTIAL_ENCRYPTION_NOT_CONFIGURED",
                        "message": "Credential encryption is unavailable; cannot read "
                                   "the stored token."},
            )
        except SlackError:
            raise HTTPException(
                status_code=502,
                detail={"code": "SLACK_UNAVAILABLE",
                        "message": "Could not verify the channel against Slack."},
            )

        ident = channel_identity(channel)
        if not ident["id"] or ident["id"] != pending.channel_id or ident["is_archived"]:
            # Slack answered, but not with the channel we asked for (or with an
            # archived one): refuse rather than bind something unverified.
            raise HTTPException(
                status_code=400,
                detail={"code": "CHANNEL_NOT_ACCESSIBLE",
                        "message": "That channel is not accessible to Korvix in Slack."},
            )
        if not ident["is_member"]:
            # Truthful refusal: without membership every history read would
            # answer `not_in_channel`, so this connection would report an empty
            # channel forever.
            raise HTTPException(
                status_code=400,
                detail={"code": "CHANNEL_NOT_JOINED",
                        "message": "Invite Korvix to that channel in Slack first, "
                                   "then refresh the list."},
            )
        resolved.append({"channel_id": ident["id"], "name": ident["name"],
                         "is_private": ident["is_private"]})

    conn = sl_store.set_selected_channels(
        project_id=project_id, owner_user_id=conn.owner_user_id, channels=resolved)
    if conn is None:
        raise HTTPException(
            status_code=409,
            detail={"code": "BIND_FAILED",
                    "message": "Could not bind the Slack channels. Reconnect and try again."},
        )
    sl_setup.delete_pending_channels(project_id)
    return envelope_ok(data={"connection": conn.public_view()}, user_id=user.id)


# ── Status ───────────────────────────────────────────────────────────────────

@router.get("/projects/{project_id}/connection")
def get_connection(
    project_id: str = Path(..., max_length=64),
    user: User = Depends(require_auth),
) -> Dict[str, Any]:
    """Safe connection metadata only — NEVER a token/secret.

    OWNER DRIFT IS REDACTED, NOT ERRORED
    Every other read/write path (`pending-channels`, `connect/select`, `sync`)
    goes through `_require_live_connection`, which refuses outright when the
    stored `owner_user_id` no longer matches the project's current owner. A
    STATUS endpoint cannot do that: the UI needs an answer here to know it should
    offer Reconnect / Disconnect, and a 409 (or a bare `null`) would strand the
    stale row with no way to clean it up.

    So this path fails SAFE rather than closed — it answers, but through
    `owner_mismatch_view()`, which withholds the workspace identity (`team_id`,
    `team_name`, `bot_user_id`, `scopes`) and every bound channel name. Those
    belong to the previous owner; a project changing hands must not disclose them
    to the new one."""
    _ensure_enabled()
    _require_owned_project(project_id, user)
    conn = sl_store.get_connection(project_id)
    if conn is not None and conn.owner_user_id != user.id:
        return envelope_ok(
            data={"connection": conn.owner_mismatch_view(), "connected": False},
            user_id=user.id,
        )
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
    """Run the bounded, read-only Slack read for a connected project. Records
    observations only — never creates a task/decision/run, never calls a model,
    never mutates anything in Slack. Partial / auth failure is reported
    truthfully."""
    _ensure_enabled()
    _require_owned_project(project_id, user)
    conn = _require_live_connection(project_id, user)
    if not conn.is_connected:
        raise HTTPException(
            status_code=409,
            detail={"code": "CHANNEL_SELECTION_REQUIRED",
                    "message": "Choose which Slack channels belong to this project first."},
        )
    try:
        report = sl_sync.sync_connection(conn)
    except SlackAuthError:  # pragma: no cover — sync records auth errors itself
        raise HTTPException(
            status_code=409,
            detail={"code": "CONNECTION_REVOKED",
                    "message": "Slack authorization is no longer valid. Reconnect to sync."},
        )
    except CredentialEncryptionError:
        raise HTTPException(
            status_code=503,
            detail={"code": "CREDENTIAL_ENCRYPTION_NOT_CONFIGURED",
                    "message": "Credential encryption is unavailable; cannot read stored token."},
        )
    # An auth failure mid-sync is recorded as a resource error by the sync
    # (partial-failure semantics) AND wipes the dead credential in the client.
    # Re-read the connection so a token that died mid-sync surfaces as the
    # actionable "reconnect" signal rather than as an opaque partial failure.
    latest = sl_store.get_connection(project_id)
    if latest is not None and latest.is_revoked:
        raise HTTPException(
            status_code=409,
            detail={"code": "CONNECTION_REVOKED",
                    "message": "Slack authorization is no longer valid. Reconnect to sync."},
        )
    return envelope_ok(data={"sync": report.as_dict()}, user_id=user.id)


# ── Disconnect ───────────────────────────────────────────────────────────────

@router.delete("/projects/{project_id}/connection")
def disconnect_project(
    project_id: str = Path(..., max_length=64),
    user: User = Depends(require_auth),
) -> Dict[str, Any]:
    """Delete ALL local Slack credential + channel-binding state for this
    project.

    Ownership-enforced, and deliberately LOCAL-ONLY: it never calls Slack, so it
    cannot uninstall the app, leave a channel, or affect any other Korvix
    project's connector. That is not a limitation but a REQUIREMENT — Slack
    installs an app once per workspace, so a remote revoke here would silently
    break every other Korvix project bound to the same workspace.

    `workspace_still_connected` reports truthfully whether another live Korvix
    connection remains for this workspace, so the UI can explain what did and did
    not change. To remove Korvix from Slack entirely the user does it in Slack →
    Manage apps (the UI says so).

    THE ONE DELIBERATE OWNER-DRIFT EXEMPTION
    This is the ONLY path that reads the connection without the owner-drift gate,
    and that is required: if the stored `owner_user_id` ever diverged from the
    project's current owner, this is the route that lets the current owner CLEAN
    THE STALE ROW UP. Gating it would make a stale connection permanently
    undeletable. Disclosure is not a concern here because the response carries
    three booleans and no workspace identity — `team_id` is only read locally to
    count siblings, and is never returned."""
    _ensure_enabled()
    _require_owned_project(project_id, user)
    sl_setup.delete_pending_channels(project_id)
    conn = sl_store.get_connection(project_id)
    if conn is None:
        return envelope_ok(
            data={"removed": False, "connected": False,
                  "workspace_still_connected": False},
            user_id=user.id)

    # Counted BEFORE the delete, excluding this project's own row, so the answer
    # is "does anyone ELSE still hold this workspace".
    siblings = sl_store.count_connected_for_team(
        conn.team_id, exclude_project_id=project_id)
    removed = sl_store.delete_connection(project_id)
    return envelope_ok(
        data={"removed": removed, "connected": False,
              "workspace_still_connected": siblings > 0},
        user_id=user.id,
    )


__all__ = ["router"]
