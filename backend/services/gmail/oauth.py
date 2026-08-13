# coding: utf-8
"""Gmail connector — Google OAuth 2.0 authorization-code flow (server-side).

FLOW (Web Application, offline access)
--------------------------------------
    build_authorization_url(state)                 [browser → Google consent]
        │  user consents to gmail.readonly
        ▼
    Google redirects to our callback with ?code&state
        │  exchange_code(code)  (POST token endpoint, client secret backend-side)
        ▼
    { access_token, refresh_token, expires_in, scope }
        │  refresh_access_token(refresh_token) whenever the access token expires
        ▼
    Gmail REST API (read-only)

SECRET DISCIPLINE
-----------------
The client secret, authorization code, access token, and refresh token are
NEVER logged. Errors surface Google's machine-readable `error` field only
(e.g. "invalid_grant"), never the token or secret. All network calls use
stdlib `urllib` (no new dependency; matches `github.client`).

READ-ONLY
---------
The only scope requested is gmail.readonly (see `config.scopes`). This module
performs token exchange/refresh/revoke and reads the connected account's own
address via `users.getProfile` — it never sends, modifies, or deletes mail.
"""
from __future__ import annotations

import json
import logging
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any, Dict, Optional

from backend.services.gmail import config as gm_config
from backend.services.gmail.errors import (
    GmailConfigError, GmailOAuthError, GmailServerError,
)

logger = logging.getLogger(__name__)

_USER_AGENT = "KorvixAI-Gmail-Connector/1.0"
_MAX_RESPONSE_BYTES = 256 * 1024  # token/profile responses are tiny JSON docs


@dataclass(frozen=True)
class TokenResponse:
    access_token: str
    refresh_token: str          # "" when Google did not return one (refresh grant)
    expires_in: int             # seconds until the access token expires
    scope: str
    token_type: str


# ── authorization URL ────────────────────────────────────────────────────────

def build_authorization_url(state: str) -> str:
    """Build the Google authorization URL the browser is sent to.

    `access_type=offline` + `prompt=consent` guarantee a refresh token is
    issued even on a reconnect (Google otherwise omits it on repeat consent).
    `include_granted_scopes=true` keeps previously-granted scopes. The redirect
    URI is the EXACT pre-registered value from config (never request-derived).
    Raises GmailConfigError when the client is unconfigured."""
    if not gm_config.oauth_configured():
        raise GmailConfigError("Gmail OAuth client is not configured")
    params = {
        "client_id": gm_config.client_id(),
        "redirect_uri": gm_config.redirect_uri(),
        "response_type": "code",
        "scope": gm_config.scope_param(),
        "access_type": "offline",
        "prompt": "consent",
        "include_granted_scopes": "true",
        "state": state,
    }
    return f"{gm_config.auth_endpoint()}?{urllib.parse.urlencode(params)}"


# ── token endpoint ───────────────────────────────────────────────────────────

def _post_token(fields: Dict[str, str]) -> Dict[str, Any]:
    """POST form-encoded fields to Google's token endpoint. Returns the parsed
    JSON. Raises GmailOAuthError on a 4xx OAuth rejection (carrying Google's
    `error`), GmailServerError on 5xx/transport failure."""
    data = urllib.parse.urlencode(fields).encode("utf-8")
    req = urllib.request.Request(
        gm_config.token_endpoint(),
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
            "User-Agent": _USER_AGENT,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=gm_config.request_timeout_s()) as resp:
            raw = resp.read(_MAX_RESPONSE_BYTES + 1)
            if len(raw) > _MAX_RESPONSE_BYTES:
                raise GmailServerError("token response exceeded size cap")
            return json.loads(raw.decode("utf-8", errors="replace"))
    except urllib.error.HTTPError as e:
        status = e.code
        reason = _extract_oauth_error(e)
        if 400 <= status < 500:
            # invalid_grant / invalid_client / redirect mismatch etc. Not
            # retryable without user action. Never include the code/secret.
            raise GmailOAuthError(
                f"Google rejected the OAuth request (HTTP {status})",
                status=status, reason=reason,
            )
        raise GmailServerError(f"Google token endpoint {status}")
    except urllib.error.URLError as e:
        raise GmailServerError(f"Network error contacting token endpoint: {e.reason}")
    except json.JSONDecodeError:
        raise GmailServerError("Malformed JSON from token endpoint")


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
        raise GmailOAuthError("token response missing access_token")
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
    stays backend-only). Raises GmailConfigError when unconfigured,
    GmailOAuthError when Google rejects the code."""
    code = (code or "").strip()
    if not code:
        raise GmailOAuthError("missing authorization code", reason="missing_code")
    if not gm_config.oauth_configured():
        raise GmailConfigError("Gmail OAuth client is not configured")
    payload = _post_token({
        "code": code,
        "client_id": gm_config.client_id(),
        "client_secret": gm_config.client_secret(),
        "redirect_uri": gm_config.redirect_uri(),
        "grant_type": "authorization_code",
    })
    return _to_token_response(payload)


def refresh_access_token(refresh_token: str) -> TokenResponse:
    """Exchange a refresh token for a fresh access token. Google usually does
    NOT return a new refresh token here, so `TokenResponse.refresh_token` is
    typically "". Raises GmailOAuthError (reason often "invalid_grant") when the
    refresh token is revoked/expired — the caller marks the connection revoked."""
    refresh_token = (refresh_token or "").strip()
    if not refresh_token:
        raise GmailOAuthError("missing refresh token", reason="missing_refresh_token")
    if not gm_config.oauth_configured():
        raise GmailConfigError("Gmail OAuth client is not configured")
    payload = _post_token({
        "client_id": gm_config.client_id(),
        "client_secret": gm_config.client_secret(),
        "refresh_token": refresh_token,
        "grant_type": "refresh_token",
    })
    return _to_token_response(payload)


# ── account identity (within gmail.readonly, no extra scope) ─────────────────

def fetch_account_email(access_token: str) -> str:
    """Read the connected account's own email address via users.getProfile.
    This is covered by gmail.readonly — no openid/email scope is requested.
    Returns "" if the address can't be determined (non-fatal for connect)."""
    access_token = (access_token or "").strip()
    if not access_token:
        return ""
    url = f"{gm_config.api_base()}/gmail/v1/users/me/profile"
    req = urllib.request.Request(
        url,
        method="GET",
        headers={
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/json",
            "User-Agent": _USER_AGENT,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=gm_config.request_timeout_s()) as resp:
            raw = resp.read(_MAX_RESPONSE_BYTES + 1)
            payload = json.loads(raw.decode("utf-8", errors="replace"))
        if isinstance(payload, dict):
            return str(payload.get("emailAddress") or "").strip()
    except Exception:
        # Identity is a nice-to-have on connect; failing to read it must not
        # abort a successful token exchange.
        return ""
    return ""


# ── revoke ───────────────────────────────────────────────────────────────────

def revoke_token(token: str) -> bool:
    """Best-effort revoke of a refresh/access token at Google's revoke endpoint.
    Returns True on a 200, False otherwise. Never raises — disconnect must
    always be able to delete local credential material even if the remote revoke
    is unreachable."""
    token = (token or "").strip()
    if not token:
        return False
    data = urllib.parse.urlencode({"token": token}).encode("utf-8")
    req = urllib.request.Request(
        gm_config.revoke_endpoint(),
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": _USER_AGENT,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=gm_config.request_timeout_s()) as resp:
            return 200 <= resp.status < 300
    except urllib.error.HTTPError as e:
        # 400 "already revoked/invalid" is effectively success for our purpose.
        return e.code == 400
    except Exception:
        return False


__all__ = [
    "TokenResponse", "build_authorization_url", "exchange_code",
    "refresh_access_token", "fetch_account_email", "revoke_token",
]
