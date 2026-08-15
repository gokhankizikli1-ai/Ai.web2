# coding: utf-8
"""Vercel connector — integration OAuth (server-side authorization-code flow).

FLOW
----
    install_url(state)                          [browser → Vercel authorization]
        │  user picks a personal account or a TEAM, and which projects the
        │  integration may access
        ▼
    Vercel redirects to the integration's REGISTERED Redirect URL with
    ?code=&state= (and ?teamId= when the installation is team-scoped)
        │  exchange_code(code)  (POST token endpoint, client secret backend-side)
        ▼
    { access_token, installation_id, user_id, team_id }
        │  the access token is used with the Vercel REST API (read-only)
        ▼
    api.vercel.com  (GET only — see `vercel.client`)

TEAM SCOPE
----------
A team installation returns `team_id`. EVERY subsequent API call must carry that
same scope (`?teamId=`) or Vercel answers for the personal account instead —
which would silently bind the wrong projects. The team id is therefore returned
here, stored on the connection, and applied by the client on every request.

NO REFRESH TOKEN
----------------
Unlike Google, a Vercel integration issues a single long-lived access token and
no refresh token, so there is no refresh path (and no `access`-style provider
module): the stored token IS the credential. It is encrypted at rest by the
existing credential authority and a 401/403 means "reconnect required".

SECRET DISCIPLINE
-----------------
The client secret, authorization code, and access token are NEVER logged. Errors
surface Vercel's machine-readable error code only (e.g. "bad_request"), never
token or secret material. All network calls use stdlib `urllib` (no new
dependency; matches `github.client` / `gmail.oauth`).
"""
from __future__ import annotations

import json
import logging
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any, Dict, Optional

from backend.services.vercel import config as vc_config
from backend.services.vercel.errors import (
    VercelConfigError, VercelOAuthError, VercelServerError,
)

logger = logging.getLogger(__name__)

_USER_AGENT = "KorvixAI-Vercel-Connector/1.0"
_MAX_RESPONSE_BYTES = 256 * 1024  # token/identity responses are tiny JSON docs


@dataclass(frozen=True)
class TokenResponse:
    access_token: str
    installation_id: str      # Vercel's integration configuration id ("icfg_…")
    user_id: str              # the Vercel user who installed the integration
    team_id: str              # "" for a personal-account installation
    token_type: str


def build_authorization_url(state: str) -> str:
    """The Vercel install/authorization URL the browser is sent to. Raises
    VercelConfigError when the integration is unconfigured."""
    if not vc_config.oauth_configured():
        raise VercelConfigError("Vercel integration OAuth is not configured")
    return vc_config.install_url(state)


# ── token endpoint ───────────────────────────────────────────────────────────

def _post_token(fields: Dict[str, str]) -> Dict[str, Any]:
    """POST form-encoded fields to Vercel's token endpoint. Returns the parsed
    JSON. Raises VercelOAuthError on a 4xx rejection (carrying Vercel's error
    code), VercelServerError on 5xx/transport failure."""
    data = urllib.parse.urlencode(fields).encode("utf-8")
    req = urllib.request.Request(
        vc_config.token_endpoint(),
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
            "User-Agent": _USER_AGENT,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=vc_config.request_timeout_s()) as resp:
            raw = resp.read(_MAX_RESPONSE_BYTES + 1)
            if len(raw) > _MAX_RESPONSE_BYTES:
                raise VercelServerError("token response exceeded size cap")
            return json.loads(raw.decode("utf-8", errors="replace"))
    except urllib.error.HTTPError as e:
        status = e.code
        reason = _extract_oauth_error(e)
        if 400 <= status < 500:
            # Bad/expired/reused code, redirect mismatch, unknown client. Not
            # retryable without user action. Never include the code/secret.
            raise VercelOAuthError(
                f"Vercel rejected the OAuth request (HTTP {status})",
                status=status, reason=reason,
            )
        raise VercelServerError(f"Vercel token endpoint {status}")
    except urllib.error.URLError as e:
        raise VercelServerError(f"Network error contacting token endpoint: {e.reason}")
    except json.JSONDecodeError:
        raise VercelServerError("Malformed JSON from token endpoint")


def _extract_oauth_error(e: "urllib.error.HTTPError") -> Optional[str]:
    """Pull Vercel's machine-readable error code from an error body. Vercel
    returns either `{"error": "..."} ` or `{"error": {"code": "..."}}`. Never
    returns token/secret material."""
    try:
        body = e.read(_MAX_RESPONSE_BYTES)
        payload = json.loads(body.decode("utf-8", errors="replace"))
        if isinstance(payload, dict):
            err = payload.get("error")
            if isinstance(err, dict):
                code = err.get("code") or err.get("message")
                return str(code) if code else None
            return str(err) if err else None
    except Exception:
        return None
    return None


def exchange_code(code: str, *, redirect_uri: Optional[str] = None) -> TokenResponse:
    """Exchange a Vercel authorization code for an access token (server-side;
    the client secret stays backend-only).

    Raises VercelConfigError when unconfigured, VercelOAuthError when Vercel
    rejects the code (including a REUSED code — Vercel codes are single-use, so
    a replayed callback fails here even before our own state replay guard)."""
    code = (code or "").strip()
    if not code:
        raise VercelOAuthError("missing authorization code", reason="missing_code")
    if not vc_config.oauth_configured():
        raise VercelConfigError("Vercel integration OAuth is not configured")
    payload = _post_token({
        "code": code,
        "client_id": vc_config.client_id(),
        "client_secret": vc_config.client_secret(),
        "redirect_uri": redirect_uri or vc_config.redirect_uri(),
    })
    if not isinstance(payload, dict) or not payload.get("access_token"):
        raise VercelOAuthError("token response missing access_token")
    return TokenResponse(
        access_token=str(payload.get("access_token")),
        installation_id=str(payload.get("installation_id") or ""),
        user_id=str(payload.get("user_id") or ""),
        team_id=str(payload.get("team_id") or ""),
        token_type=str(payload.get("token_type") or "Bearer"),
    )


# ── minimum identity read (display label only) ──────────────────────────────

def _get_json(path: str, access_token: str) -> Optional[Dict[str, Any]]:
    """One authenticated GET against the Vercel API, size- and time-bounded.
    Returns None on ANY failure — identity is a display nicety, never a reason
    to fail a successful token exchange."""
    url = f"{vc_config.api_base()}{path}"
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
        with urllib.request.urlopen(req, timeout=vc_config.request_timeout_s()) as resp:
            raw = resp.read(_MAX_RESPONSE_BYTES + 1)
            payload = json.loads(raw.decode("utf-8", errors="replace"))
        return payload if isinstance(payload, dict) else None
    except Exception:
        return None


def fetch_account_label(access_token: str, *, team_id: str = "") -> str:
    """A human-readable label for the connected Vercel account — the TEAM's
    name/slug for a team installation, else the user's username/email.

    This is the ONLY identity read performed at connect time (one bounded GET).
    Returns "" when it can't be determined; failing to read a display label must
    never abort a successful token exchange."""
    access_token = (access_token or "").strip()
    if not access_token:
        return ""
    team_id = (team_id or "").strip()
    if team_id:
        data = _get_json(f"/v2/teams/{urllib.parse.quote(team_id, safe='')}", access_token)
        if isinstance(data, dict):
            return str(data.get("name") or data.get("slug") or "").strip()[:200]
        return ""
    data = _get_json("/v2/user", access_token)
    user = (data or {}).get("user") if isinstance(data, dict) else None
    if not isinstance(user, dict):
        user = data if isinstance(data, dict) else {}
    return str(user.get("username") or user.get("name") or user.get("email") or "").strip()[:200]


__all__ = [
    "TokenResponse", "build_authorization_url", "exchange_code",
    "fetch_account_label",
]
