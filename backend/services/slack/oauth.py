# coding: utf-8
"""Slack connector — Slack OAuth v2 (server-side authorization-code flow).

FLOW
----
    build_authorization_url(state)          [browser → Slack install screen]
        │  the user picks a WORKSPACE and approves the bot scopes
        ▼
    Slack redirects to the app's REGISTERED Redirect URL with ?code=&state=
        │  exchange_code(code)  (POST oauth.v2.access, client secret backend-side)
        ▼
    { access_token (xoxb bot token), team.id, team.name, bot_user_id, app_id,
      scope }
        │  the bot token is used with the Slack Web API (read-only)
        ▼
    slack.com/api  (see `slack.client` — four read methods, nothing else)

BOT TOKEN ONLY
--------------
`user_scope` is never requested, so Slack issues no user token and
`authed_user.access_token` is absent. Only `access_token` (the workspace's BOT
token) is read here; the `authed_user` block is deliberately NOT returned by
this module, so no user identity can end up on the connection row.

WORKSPACE IDENTITY COMES FROM THE EXCHANGE RESPONSE
---------------------------------------------------
`team.id` / `team.name` are read from the token-exchange body, never from the
callback query string (which is attacker-supplied). That makes the stored
workspace binding provably the one Slack authorized. No extra `auth.test` or
`team.info` call is made — the exchange already carries everything needed, so
connect costs exactly ONE provider request.

NO REFRESH GRANT (AND NO ROTATION)
----------------------------------
The Slack app does not enable token rotation, so `oauth.v2.access` returns a
long-lived bot token with no refresh token: the stored token IS the credential
(same shape as the Vercel connector, hence no `access`-style provider module).
If an operator ever enables rotation at Slack, the issued token expires and the
API starts answering `token_expired` — which this connector surfaces as
`SlackAuthError` ("reconnect required"), never as an empty read.

NO REVOKE HELPER — ON PURPOSE
-----------------------------
There is deliberately no `auth.revoke` helper in this module. A Slack app is
installed ONCE PER WORKSPACE, so two Korvix projects that connect the same
workspace hold the SAME installation's bot token; revoking it on one project's
disconnect would silently break every other project bound to that workspace (and
would also be a mutation of the customer's Slack workspace). Disconnect is
LOCAL-ONLY — see `slack.store.delete_connection` and the disconnect route. The
user removes Korvix entirely from Slack → Manage apps, which the UI says.

SECRET DISCIPLINE
-----------------
The client secret, authorization code, and bot token are NEVER logged. Errors
surface Slack's machine-readable `error` code only (e.g. "invalid_code"), never
token or secret material. All network calls use stdlib `urllib` (no new
dependency; matches `vercel.oauth` / `gmail.oauth`).
"""
from __future__ import annotations

import json
import logging
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any, Dict, Optional

from backend.services.slack import config as sl_config
from backend.services.slack.errors import (
    SlackConfigError, SlackOAuthError, SlackServerError,
)

logger = logging.getLogger(__name__)

_USER_AGENT = "KorvixAI-Slack-Connector/1.0"
_MAX_RESPONSE_BYTES = 256 * 1024  # token responses are small JSON docs


@dataclass(frozen=True)
class TokenResponse:
    """The bounded, explicitly-picked result of `oauth.v2.access`.

    NOTE what is absent: no user token, no `authed_user` block, no enterprise
    payload. Only what the connection legitimately needs."""
    access_token: str      # the workspace BOT token (xoxb-…)
    team_id: str           # authoritative workspace id (from the response body)
    team_name: str         # workspace display name
    bot_user_id: str       # the installed bot's user id (identity, not a token)
    app_id: str
    scope: str             # comma-delimited granted bot scopes
    token_type: str


def build_authorization_url(state: str) -> str:
    """Build the Slack install/authorization URL the browser is sent to.

    Requests ONLY the configured bot scopes and sends NO `user_scope`, so Slack
    cannot issue a user token. The redirect URI is the EXACT pre-registered
    value from config (never request-derived). Raises SlackConfigError when the
    app is unconfigured."""
    if not sl_config.oauth_configured():
        raise SlackConfigError("Slack OAuth client is not configured")
    params = {
        "client_id": sl_config.client_id(),
        "scope": sl_config.scope_param(),
        # Explicitly empty: Korvix never asks for a user token.
        "user_scope": "",
        "redirect_uri": sl_config.redirect_uri(),
        "state": state,
    }
    return f"{sl_config.authorize_endpoint()}?{urllib.parse.urlencode(params)}"


# ── token endpoint ───────────────────────────────────────────────────────────

def _post_oauth_access(fields: Dict[str, str]) -> Dict[str, Any]:
    """POST form-encoded fields to `oauth.v2.access`. Returns the parsed JSON.

    Slack answers HTTP 200 with `{"ok": false, "error": …}` for a rejected code,
    so the `ok` flag is checked by the caller — an HTTP-only check would read a
    rejection as success."""
    data = urllib.parse.urlencode(fields).encode("utf-8")
    req = urllib.request.Request(
        f"{sl_config.api_base()}/oauth.v2.access",
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
            "Accept": "application/json",
            "User-Agent": _USER_AGENT,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=sl_config.request_timeout_s()) as resp:
            raw = resp.read(_MAX_RESPONSE_BYTES + 1)
            if len(raw) > _MAX_RESPONSE_BYTES:
                raise SlackServerError("token response exceeded size cap")
            return json.loads(raw.decode("utf-8", errors="replace"))
    except urllib.error.HTTPError as e:
        status = e.code
        reason = _extract_oauth_error(e)
        if 400 <= status < 500:
            # Bad/expired/reused code, redirect mismatch, unknown client. Not
            # retryable without user action. Never include the code/secret.
            raise SlackOAuthError(
                f"Slack rejected the OAuth request (HTTP {status})",
                status=status, reason=reason,
            )
        raise SlackServerError(f"Slack oauth.v2.access {status}", status=status)
    except urllib.error.URLError as e:
        raise SlackServerError(f"Network error contacting Slack OAuth: {e.reason}")
    except json.JSONDecodeError:
        raise SlackServerError("Malformed JSON from Slack OAuth")


def _extract_oauth_error(e: "urllib.error.HTTPError") -> Optional[str]:
    """Pull Slack's machine-readable `error` from an error body. Never returns
    token/secret material."""
    try:
        body = e.read(_MAX_RESPONSE_BYTES)
        payload = json.loads(body.decode("utf-8", errors="replace"))
        if isinstance(payload, dict):
            err = payload.get("error")
            return str(err) if err else None
    except Exception:
        return None
    return None


def exchange_code(code: str, *, redirect_uri: Optional[str] = None) -> TokenResponse:
    """Exchange a Slack authorization code for the workspace bot token
    (server-side; the client secret stays backend-only).

    Raises SlackConfigError when unconfigured, SlackOAuthError when Slack
    rejects the code (including a REUSED code — Slack codes are single-use, so a
    replayed callback fails here even before our own state replay guard), or
    when the response is not a bot-token grant."""
    code = (code or "").strip()
    if not code:
        raise SlackOAuthError("missing authorization code", reason="missing_code")
    if not sl_config.oauth_configured():
        raise SlackConfigError("Slack OAuth client is not configured")

    payload = _post_oauth_access({
        "code": code,
        "client_id": sl_config.client_id(),
        "client_secret": sl_config.client_secret(),
        "redirect_uri": redirect_uri or sl_config.redirect_uri(),
    })

    if not isinstance(payload, dict) or not payload.get("ok"):
        reason = str((payload or {}).get("error") or "invalid_response") \
            if isinstance(payload, dict) else "invalid_response"
        raise SlackOAuthError("Slack rejected the authorization code", reason=reason)

    access_token = str(payload.get("access_token") or "")
    if not access_token:
        # A user-token-only grant (or a malformed body) is refused rather than
        # stored: this connector operates exclusively with a bot token.
        raise SlackOAuthError("token response carries no bot access_token",
                              reason="missing_bot_token")

    team = payload.get("team") if isinstance(payload.get("team"), dict) else {}
    team_id = str(team.get("id") or "")
    if not team_id:
        # Without an authoritative workspace id the connection could not be
        # scoped or audited — fail closed rather than invent one.
        raise SlackOAuthError("token response carries no team id",
                              reason="missing_team_id")

    return TokenResponse(
        access_token=access_token,
        team_id=team_id,
        team_name=str(team.get("name") or "")[:200],
        bot_user_id=str(payload.get("bot_user_id") or ""),
        app_id=str(payload.get("app_id") or ""),
        scope=str(payload.get("scope") or ""),
        token_type=str(payload.get("token_type") or "bot"),
    )


__all__ = ["TokenResponse", "build_authorization_url", "exchange_code"]
