# coding: utf-8
"""Gmail connector — runtime configuration (live-read).

MIRRORS THE GITHUB / BILLING CONFIG PATTERN
-------------------------------------------
Env vars are read live on every call so a Railway flag flip is effective
without a restart. The canonical names + defaults are ALSO declared in
`backend.core.config.Config` for discoverability + startup validation, but the
RUNTIME source of truth is here (read dynamically), matching
`github.config.is_enabled()` / `billing.config.is_enabled()`.

SCOPE — read-only, minimum
--------------------------
This pass requests exactly ONE Gmail scope:
    https://www.googleapis.com/auth/gmail.readonly
That scope is sufficient to read message metadata AND to read the connected
account's own email address (via users.getProfile), so NO additional identity
scope (openid/email/profile) is requested. The connector can never send,
modify, delete, archive, or label mail with this scope.

SECRETS — the OAuth client secret and the credential-encryption key are read
here and NEVER logged, returned to the frontend, or placed in an observation.
"""
from __future__ import annotations

import os
from typing import List

# The single, minimum scope this pass requires. Read-only.
GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly"

# Google OAuth 2.0 endpoints (overridable for tests).
_DEFAULT_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
_DEFAULT_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
_DEFAULT_REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke"
_DEFAULT_GMAIL_API_BASE = "https://gmail.googleapis.com"


def _env(name: str, default: str = "") -> str:
    return (os.getenv(name, default) or "").strip()


# ── Master gate ─────────────────────────────────────────────────────────────

def is_enabled() -> bool:
    """Master kill-switch. Default OFF so merging is behaviourally inert until
    an operator flips it (matches every other subsystem in core.config)."""
    return _env("ENABLE_GMAIL_CONNECTOR", "false").lower() == "true"


# ── Google OAuth client credentials ─────────────────────────────────────────

def client_id() -> str:
    """The Google OAuth Web Application client id. Reuses the existing
    GOOGLE_CLIENT_ID convention (already used by the Google *login* verifier in
    routes/auth.py) so a single Google project id is shared; falls back to a
    Gmail-specific override when present."""
    return _env("GMAIL_OAUTH_CLIENT_ID") or _env("GOOGLE_CLIENT_ID")


def client_secret() -> str:
    """The Google OAuth Web Application client secret. SECRET — never logged,
    never returned to the frontend. Empty ⇒ the connector fails closed."""
    return _env("GMAIL_OAUTH_CLIENT_SECRET") or _env("GOOGLE_CLIENT_SECRET")


def redirect_uri() -> str:
    """The EXACT Authorized redirect URI registered in Google Cloud.

    This is read from env rather than derived from the request Host header on
    purpose: deriving redirect_uri from an attacker-controllable Host is an
    open-redirect / host-injection hazard, and Google requires an exact match
    against a pre-registered value anyway. Empty ⇒ the connector fails closed.

    The value MUST equal `<backend-public-base>/v2/gmail/oauth/callback`.
    """
    return _env("GMAIL_OAUTH_REDIRECT_URI")


def scopes() -> List[str]:
    """The minimum scope set requested. Read-only, single scope."""
    return [GMAIL_READONLY_SCOPE]


def scope_param() -> str:
    """Space-delimited scope string for the authorization URL."""
    return " ".join(scopes())


# ── Frontend redirect target (safe, fixed) ──────────────────────────────────

def frontend_result_base() -> str:
    """The SPA origin the callback redirects the browser back to after the
    exchange. FIXED server-side (never taken from a query param) so the callback
    can never be turned into an open redirect. Reuses PUBLIC_APP_URL (the same
    origin the email-verification link uses); a Gmail-specific override wins
    when set."""
    base = _env("GMAIL_FRONTEND_RESULT_URL") or _env("PUBLIC_APP_URL", "https://korvixai.com")
    return base.rstrip("/")


def frontend_result_path() -> str:
    """The SPA route (a HashRouter fragment) the browser lands on. The final
    redirect is `<frontend_result_base><path>?gmail=connected|error&...`."""
    return _env("GMAIL_FRONTEND_RESULT_PATH", "/#/settings/integrations")


# ── Credential-at-rest encryption ───────────────────────────────────────────

def encryption_keys_raw() -> str:
    """The raw KORVIX_CREDENTIAL_ENCRYPTION_KEY env value (one or more
    comma-separated Fernet keys; the first is primary for encryption, all are
    tried for decryption to support rotation). SECRET — never logged. Empty ⇒
    credential encryption is UNCONFIGURED and the connector fails closed."""
    return _env("KORVIX_CREDENTIAL_ENCRYPTION_KEY")


# ── OAuth endpoints (test-overridable) ──────────────────────────────────────

def auth_endpoint() -> str:
    return _env("GMAIL_OAUTH_AUTH_ENDPOINT", _DEFAULT_AUTH_ENDPOINT).rstrip("/") or _DEFAULT_AUTH_ENDPOINT


def token_endpoint() -> str:
    return _env("GMAIL_OAUTH_TOKEN_ENDPOINT", _DEFAULT_TOKEN_ENDPOINT) or _DEFAULT_TOKEN_ENDPOINT


def revoke_endpoint() -> str:
    return _env("GMAIL_OAUTH_REVOKE_ENDPOINT", _DEFAULT_REVOKE_ENDPOINT) or _DEFAULT_REVOKE_ENDPOINT


def api_base() -> str:
    return _env("GMAIL_API_BASE", _DEFAULT_GMAIL_API_BASE).rstrip("/") or _DEFAULT_GMAIL_API_BASE


# ── Bounds ──────────────────────────────────────────────────────────────────

def request_timeout_s() -> float:
    try:
        return float(os.getenv("GMAIL_REQUEST_TIMEOUT_S", "10") or 10)
    except (TypeError, ValueError):
        return 10.0


def state_ttl_s() -> int:
    """How long an unconsumed OAuth state stays valid. Short by design — a
    login round-trip is seconds; 10 minutes leaves headroom for a slow consent
    screen without keeping a CSRF token alive indefinitely. Clamped [60, 1800]."""
    try:
        n = int(os.getenv("GMAIL_OAUTH_STATE_TTL_S", "600") or 600)
    except (TypeError, ValueError):
        n = 600
    return max(60, min(n, 1800))


def sync_max_messages() -> int:
    """Hard cap on messages pulled per sync — the guard that makes the backfill
    BOUNDED (never crawls the whole mailbox). Clamped [1, 100]."""
    try:
        n = int(os.getenv("GMAIL_SYNC_MAX_MESSAGES", "25") or 25)
    except (TypeError, ValueError):
        n = 25
    return max(1, min(n, 100))


def sync_query() -> str:
    """Optional Gmail search query bounding the backfill window (e.g.
    "newer_than:30d"). Default limits to recent mail so a first sync of a huge
    mailbox stays cheap and relevant. Empty string ⇒ no query filter."""
    val = os.getenv("GMAIL_SYNC_QUERY", "newer_than:30d")
    return "" if val is None else val.strip()


def snippet_max_chars() -> int:
    """Upper bound on the snippet length copied into an observation payload — a
    metadata evidence trail, never a full-body dump. Clamped [0, 1000]."""
    try:
        n = int(os.getenv("GMAIL_SNIPPET_MAX_CHARS", "300") or 300)
    except (TypeError, ValueError):
        n = 300
    return max(0, min(n, 1000))


# ── Readiness ───────────────────────────────────────────────────────────────

def oauth_configured() -> bool:
    """True iff the OAuth client credentials + redirect URI are present. Connect
    can only run when this holds."""
    return bool(client_id() and client_secret() and redirect_uri())


__all__ = [
    "GMAIL_READONLY_SCOPE",
    "is_enabled", "client_id", "client_secret", "redirect_uri", "scopes",
    "scope_param", "frontend_result_base", "frontend_result_path",
    "encryption_keys_raw", "auth_endpoint", "token_endpoint",
    "revoke_endpoint", "api_base", "request_timeout_s", "state_ttl_s",
    "sync_max_messages", "sync_query", "snippet_max_chars", "oauth_configured",
]
