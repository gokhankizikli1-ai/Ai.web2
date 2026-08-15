# coding: utf-8
"""Google Calendar connector — Google OAuth 2.0 authorization-code flow.

FLOW (Web Application, offline access)
--------------------------------------
    build_authorization_url(state)                 [browser → Google consent]
        │  user consents to calendar.events.readonly
        ▼
    Google redirects to OUR CALENDAR callback with ?code&state
        │  exchange_code(code)  (POST token endpoint, client secret backend-side)
        ▼
    { access_token, refresh_token, expires_in, scope }
        │  refresh_access_token(refresh_token) whenever the access token expires
        ▼
    Google Calendar REST API (read-only events)

SAME GOOGLE CLIENT AS GMAIL, DELIBERATELY DIFFERENT FLOW
--------------------------------------------------------
This module reuses the existing Google OAuth client config (see `config`) but is
NOT a second Google auth system layered on Gmail's: it has its own redirect URI,
its own state table, its own connection table, and — critically — it does NOT
send `include_granted_scopes=true`.

Gmail's flow sets that flag (incremental authorization), which makes Google mint
a token carrying every scope the user has already granted. Sending it here would
hand the Calendar connection a token that also carries `gmail.readonly` — silent
scope creep across a connector boundary. Omitting it keeps the Calendar refresh
token scoped to exactly `calendar.events.readonly`, which is what the connector
stores and what an auditor sees on the connection row.

SECRET DISCIPLINE
-----------------
The client secret, authorization code, access token, and refresh token are NEVER
logged. Errors surface Google's machine-readable `error` field only (e.g.
"invalid_grant"), never the token or secret. All network calls use stdlib
`urllib` (no new dependency; matches `gmail.oauth` / `github.client`).

READ-ONLY
---------
The only scope requested is `calendar.events.readonly`. This module performs
token exchange/refresh/revoke and one bounded identity probe (`events.list`
with maxResults=1) — it never creates, edits, moves, or deletes an event, and
there is no helper here that could.
"""
from __future__ import annotations

import json
import logging
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any, Dict, Optional

from backend.services.google_calendar import config as cal_config
from backend.services.google_calendar.errors import (
    CalendarConfigError, CalendarOAuthError, CalendarServerError,
)

logger = logging.getLogger(__name__)

_USER_AGENT = "KorvixAI-Calendar-Connector/1.0"
_MAX_RESPONSE_BYTES = 256 * 1024  # token/probe responses are small JSON docs


@dataclass(frozen=True)
class TokenResponse:
    access_token: str
    refresh_token: str          # "" when Google did not return one (refresh grant)
    expires_in: int             # seconds until the access token expires
    scope: str
    token_type: str


@dataclass(frozen=True)
class CalendarIdentity:
    """The small display identity the connect flow can learn WITHIN the
    events-only scope: the primary calendar's label (for a primary calendar
    Google returns the account's email address) and its IANA timezone."""
    google_email: str
    calendar_id: str
    time_zone: str


# ── authorization URL ────────────────────────────────────────────────────────

def build_authorization_url(state: str) -> str:
    """Build the Google authorization URL the browser is sent to.

    `access_type=offline` + `prompt=consent` guarantee a refresh token is issued
    even on a reconnect (Google otherwise omits it on repeat consent).
    `include_granted_scopes` is deliberately NOT sent — see the module docstring:
    it would let the Calendar token inherit Gmail's scope. The redirect URI is
    the EXACT pre-registered CALENDAR value from config (never request-derived).
    Raises CalendarConfigError when the client is unconfigured."""
    if not cal_config.oauth_configured():
        raise CalendarConfigError("Google Calendar OAuth client is not configured")
    params = {
        "client_id": cal_config.client_id(),
        "redirect_uri": cal_config.redirect_uri(),
        "response_type": "code",
        "scope": cal_config.scope_param(),
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    }
    return f"{cal_config.auth_endpoint()}?{urllib.parse.urlencode(params)}"


# ── token endpoint ───────────────────────────────────────────────────────────

def _post_token(fields: Dict[str, str]) -> Dict[str, Any]:
    """POST form-encoded fields to Google's token endpoint. Returns the parsed
    JSON. Raises CalendarOAuthError on a 4xx OAuth rejection (carrying Google's
    `error`), CalendarServerError on 5xx/transport failure."""
    data = urllib.parse.urlencode(fields).encode("utf-8")
    req = urllib.request.Request(
        cal_config.token_endpoint(),
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
            "User-Agent": _USER_AGENT,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=cal_config.request_timeout_s()) as resp:
            raw = resp.read(_MAX_RESPONSE_BYTES + 1)
            if len(raw) > _MAX_RESPONSE_BYTES:
                raise CalendarServerError("token response exceeded size cap")
            return json.loads(raw.decode("utf-8", errors="replace"))
    except urllib.error.HTTPError as e:
        status = e.code
        reason = _extract_oauth_error(e)
        if 400 <= status < 500:
            # invalid_grant / invalid_client / redirect mismatch etc. Not
            # retryable without user action. Never include the code/secret.
            raise CalendarOAuthError(
                f"Google rejected the OAuth request (HTTP {status})",
                status=status, reason=reason,
            )
        raise CalendarServerError(f"Google token endpoint {status}")
    except urllib.error.URLError as e:
        raise CalendarServerError(f"Network error contacting token endpoint: {e.reason}")
    except json.JSONDecodeError:
        raise CalendarServerError("Malformed JSON from token endpoint")


def _extract_oauth_error(e: "urllib.error.HTTPError") -> Optional[str]:
    """Pull Google's machine-readable `error` (e.g. "invalid_grant") from an
    error body. Never returns token/secret material."""
    try:
        body = e.read(_MAX_RESPONSE_BYTES)
        payload = json.loads(body.decode("utf-8", errors="replace"))
        if isinstance(payload, dict):
            err = payload.get("error")
            return str(err) if err else None
    except Exception:
        return None
    return None


def _to_token_response(payload: Dict[str, Any]) -> TokenResponse:
    if not isinstance(payload, dict) or not payload.get("access_token"):
        raise CalendarOAuthError("token response missing access_token")
    try:
        expires_in = int(payload.get("expires_in") or 0)
    except (TypeError, ValueError):
        expires_in = 0
    return TokenResponse(
        access_token=str(payload.get("access_token")),
        refresh_token=str(payload.get("refresh_token") or ""),
        expires_in=expires_in,
        scope=str(payload.get("scope") or ""),
        token_type=str(payload.get("token_type") or "Bearer"),
    )


def exchange_code(code: str) -> TokenResponse:
    """Exchange an authorization code for tokens (server-side; the client secret
    stays backend-only). Raises CalendarConfigError when unconfigured,
    CalendarOAuthError when Google rejects the code."""
    code = (code or "").strip()
    if not code:
        raise CalendarOAuthError("missing authorization code", reason="missing_code")
    if not cal_config.oauth_configured():
        raise CalendarConfigError("Google Calendar OAuth client is not configured")
    payload = _post_token({
        "code": code,
        "client_id": cal_config.client_id(),
        "client_secret": cal_config.client_secret(),
        "redirect_uri": cal_config.redirect_uri(),
        "grant_type": "authorization_code",
    })
    return _to_token_response(payload)


def refresh_access_token(refresh_token: str) -> TokenResponse:
    """Exchange a refresh token for a fresh access token. Google usually does
    NOT return a new refresh token here, so `TokenResponse.refresh_token` is
    typically "". Raises CalendarOAuthError (reason often "invalid_grant") when
    the refresh token is revoked/expired — the caller marks the connection
    revoked."""
    refresh_token = (refresh_token or "").strip()
    if not refresh_token:
        raise CalendarOAuthError("missing refresh token", reason="missing_refresh_token")
    if not cal_config.oauth_configured():
        raise CalendarConfigError("Google Calendar OAuth client is not configured")
    payload = _post_token({
        "client_id": cal_config.client_id(),
        "client_secret": cal_config.client_secret(),
        "refresh_token": refresh_token,
        "grant_type": "refresh_token",
    })
    return _to_token_response(payload)


# ── account identity (WITHIN calendar.events.readonly, no extra scope) ────────

def fetch_calendar_identity(access_token: str) -> CalendarIdentity:
    """Read the connected primary calendar's label + timezone.

    `calendar.events.readonly` does NOT grant the Calendars / CalendarList
    resources, so this deliberately does not call `calendars.get`. Instead it
    issues a MINIMAL `events.list` (maxResults=1) whose response envelope
    carries `summary` (for the primary calendar, the account's email address)
    and `timeZone`. That keeps the requested scope at the documented minimum.

    Returns empty fields if the probe fails — identity is a nice-to-have on
    connect and must never abort a successful token exchange (mirrors
    `gmail.oauth.fetch_account_email`)."""
    cal_id = cal_config.PRIMARY_CALENDAR_ID
    empty = CalendarIdentity(google_email="", calendar_id=cal_id, time_zone="")
    access_token = (access_token or "").strip()
    if not access_token:
        return empty
    url = (f"{cal_config.api_base()}/calendar/v3/calendars/"
           f"{urllib.parse.quote(cal_id, safe='')}/events?"
           + urllib.parse.urlencode({"maxResults": 1, "showDeleted": "false"}))
    req = urllib.request.Request(
        url,
        method="GET",  # READ-ONLY
        headers={
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/json",
            "User-Agent": _USER_AGENT,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=cal_config.request_timeout_s()) as resp:
            raw = resp.read(_MAX_RESPONSE_BYTES + 1)
            payload = json.loads(raw.decode("utf-8", errors="replace"))
        if isinstance(payload, dict):
            return CalendarIdentity(
                google_email=str(payload.get("summary") or "").strip()[:200],
                calendar_id=cal_id,
                time_zone=str(payload.get("timeZone") or "").strip()[:80],
            )
    except Exception:
        return empty
    return empty


# ── revoke ───────────────────────────────────────────────────────────────────

def revoke_token(token: str) -> bool:
    """Best-effort revoke of a refresh/access token at Google's revoke endpoint.
    Returns True on a 200, False otherwise. Never raises — disconnect must always
    be able to delete local credential material even if the remote revoke is
    unreachable.

    CALLERS MUST GATE THIS. On a shared Google OAuth client, Google merges the
    Gmail and Calendar consents into ONE grant per (client, user), so revoking
    here can also invalidate Gmail. `backend.services.google_grant.remote_revoke_is_safe`
    is the authority that decides whether this may be called."""
    token = (token or "").strip()
    if not token:
        return False
    data = urllib.parse.urlencode({"token": token}).encode("utf-8")
    req = urllib.request.Request(
        cal_config.revoke_endpoint(),
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": _USER_AGENT,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=cal_config.request_timeout_s()) as resp:
            return 200 <= resp.status < 300
    except urllib.error.HTTPError as e:
        # 400 "already revoked/invalid" is effectively success for our purpose.
        return e.code == 400
    except Exception:
        return False


__all__ = [
    "TokenResponse", "CalendarIdentity", "build_authorization_url",
    "exchange_code", "refresh_access_token", "fetch_calendar_identity",
    "revoke_token",
]
