# coding: utf-8
"""Vercel connector — runtime configuration (live-read).

MIRRORS THE GMAIL / GITHUB / BILLING CONFIG PATTERN
---------------------------------------------------
Env vars are read live on every call so a Railway flag flip is effective
without a restart. The canonical names + defaults are ALSO declared in
`backend.core.config.Config` for discoverability + startup validation, but the
RUNTIME source of truth is here (read dynamically), matching
`gmail.config.is_enabled()` / `github.config.is_enabled()`.

READ-ONLY — no scope is requested beyond what an integration installation
grants, and the client (`vercel.client`) is GET-only. The connector cannot
deploy, redeploy, roll back, or mutate env vars / domains / project settings.

SECRETS — the OAuth client secret and the credential-encryption key are read
here and NEVER logged, returned to the frontend, or placed in an observation.
The encryption key is read through the EXISTING credential authority's env name
(`KORVIX_CREDENTIAL_ENCRYPTION_KEY`), not a Vercel-specific key.
"""
from __future__ import annotations

import os
import urllib.parse

# Vercel's public endpoints (overridable for tests).
_DEFAULT_API_BASE = "https://api.vercel.com"
_DEFAULT_HTML_BASE = "https://vercel.com"
# The integration OAuth token endpoint (api host, NOT the web host).
_DEFAULT_TOKEN_PATH = "/v2/oauth/access_token"


def _env(name: str, default: str = "") -> str:
    return (os.getenv(name, default) or "").strip()


# ── Master gate ─────────────────────────────────────────────────────────────

def is_enabled() -> bool:
    """Master kill-switch. Default OFF so merging is behaviourally inert until
    an operator flips it (matches every other subsystem in core.config)."""
    return _env("ENABLE_VERCEL_CONNECTOR", "false").lower() == "true"


# ── Vercel integration OAuth credentials ────────────────────────────────────

def client_id() -> str:
    """The Vercel integration's OAuth Client ID (Vercel dashboard → Integrations
    → your integration → OAuth). Not secret on its own."""
    return _env("VERCEL_OAUTH_CLIENT_ID")


def client_secret() -> str:
    """The Vercel integration's OAuth Client Secret. SECRET — never logged,
    never returned to the frontend. Empty ⇒ the connector fails closed."""
    return _env("VERCEL_OAUTH_CLIENT_SECRET")


def redirect_uri() -> str:
    """The EXACT Redirect URL registered on the Vercel integration.

    Read from env rather than derived from the request Host on purpose:
    deriving a redirect_uri from an attacker-controllable Host is an
    open-redirect / host-injection hazard, and Vercel requires an exact match
    against the pre-registered value anyway. Empty ⇒ the connector fails closed.

    The value MUST equal `<backend-public-base>/v2/vercel/oauth/callback`.
    """
    return _env("VERCEL_OAUTH_REDIRECT_URI")


def integration_slug() -> str:
    """The integration's URL slug (`vercel.com/integrations/<slug>`), used to
    build the install/authorization URL the browser is sent to. Empty ⇒ the
    connect route fails closed (503) unless a full URL override is set."""
    return _env("VERCEL_INTEGRATION_SLUG")


def html_base() -> str:
    """Vercel's web (non-API) base, for the install URL. Overridable for tests."""
    return _env("VERCEL_HTML_BASE", _DEFAULT_HTML_BASE).rstrip("/") or _DEFAULT_HTML_BASE


def install_url(state: str) -> str:
    """The URL that starts a Vercel integration **installation / authorization**.

    Vercel echoes `state` back to the integration's registered Redirect URL
    (together with a short-lived `code`, and `teamId` when the user installs on
    a team), which is how we tie the redirect back to the initiating Korvix
    user + project. We deliberately do NOT pass a `redirect_uri` query param —
    Vercel uses the integration's registered Redirect URL, keeping the redirect
    target server-fixed (no open redirect via query param).

    A full override (`VERCEL_OAUTH_INSTALL_URL`) wins for unusual setups."""
    override = _env("VERCEL_OAUTH_INSTALL_URL")
    base = override or f"{html_base()}/integrations/{integration_slug()}/new"
    sep = "&" if "?" in base else "?"
    return f"{base}{sep}{urllib.parse.urlencode({'state': state})}"


def token_endpoint() -> str:
    """The integration OAuth token endpoint used for the server-side code
    exchange. Overridable for tests."""
    return _env("VERCEL_OAUTH_TOKEN_ENDPOINT", f"{api_base()}{_DEFAULT_TOKEN_PATH}") \
        or f"{api_base()}{_DEFAULT_TOKEN_PATH}"


def api_base() -> str:
    """Vercel REST base. Overridable for tests."""
    return _env("VERCEL_API_BASE", _DEFAULT_API_BASE).rstrip("/") or _DEFAULT_API_BASE


# ── Frontend redirect target (safe, fixed) ──────────────────────────────────

def frontend_result_base() -> str:
    """The SPA origin the callback redirects the browser back to after the
    exchange. FIXED server-side (never taken from a query param) so the callback
    can never be turned into an open redirect. Reuses PUBLIC_APP_URL (the same
    origin Gmail/GitHub use); a Vercel-specific override wins when set."""
    base = _env("VERCEL_FRONTEND_RESULT_URL") or _env("PUBLIC_APP_URL", "https://korvixai.com")
    return base.rstrip("/")


def frontend_result_path() -> str:
    """The SPA route (a HashRouter fragment) the browser lands on. The final
    redirect is `<frontend_result_base><path>?vercel=authorized|error&...`."""
    return _env("VERCEL_FRONTEND_RESULT_PATH", "/#/settings/integrations")


# ── Credential-at-rest encryption ───────────────────────────────────────────

def encryption_configured() -> bool:
    """True iff the EXISTING credential-encryption authority can encrypt right
    now. Delegates to `gmail.crypto` (the single credential authority, keyed by
    KORVIX_CREDENTIAL_ENCRYPTION_KEY) — this connector adds no second key, no
    second cipher, and no plaintext fallback."""
    from backend.services.gmail import crypto as credential_crypto
    return credential_crypto.is_configured()


# ── Bounds ──────────────────────────────────────────────────────────────────

def request_timeout_s() -> float:
    try:
        return float(os.getenv("VERCEL_REQUEST_TIMEOUT_S", "10") or 10)
    except (TypeError, ValueError):
        return 10.0


def state_ttl_s() -> int:
    """How long an unconsumed OAuth state stays valid. Short by design — an
    install round-trip is seconds; 10 minutes leaves headroom for a slow
    authorization screen without keeping a CSRF token alive indefinitely.
    Clamped [60, 1800]."""
    try:
        n = int(os.getenv("VERCEL_OAUTH_STATE_TTL_S", "600") or 600)
    except (TypeError, ValueError):
        n = 600
    return max(60, min(n, 1800))


def pending_ttl_s() -> int:
    """How long a VERIFIED pending Vercel project (awaiting the user's choice)
    stays valid. Longer than the state TTL because the user is picking a project
    in the UI. Clamped [60, 3600]."""
    try:
        n = int(os.getenv("VERCEL_PENDING_TTL_S", "900") or 900)
    except (TypeError, ValueError):
        n = 900
    return max(60, min(n, 3600))


def pending_projects_max() -> int:
    """Hard cap on Vercel projects listed for the connect picker (bounded read).
    Clamped [1, 200]."""
    try:
        n = int(os.getenv("VERCEL_PENDING_PROJECTS_MAX", "100") or 100)
    except (TypeError, ValueError):
        n = 100
    return max(1, min(n, 200))


def sync_page_size() -> int:
    """Items requested per page during a bounded read. Clamped [1, 100]
    (100 is Vercel's per-request maximum for the deployments endpoint)."""
    try:
        n = int(os.getenv("VERCEL_SYNC_PAGE_SIZE", "20") or 20)
    except (TypeError, ValueError):
        n = 20
    return max(1, min(n, 100))


def sync_max_pages() -> int:
    """Pages of deployments followed during an INCREMENTAL (already backfilled)
    sync. 1 by default — the newest window is enough once the initial import has
    run. Clamped [1, 5]."""
    try:
        n = int(os.getenv("VERCEL_SYNC_MAX_PAGES", "1") or 1)
    except (TypeError, ValueError):
        n = 1
    return max(1, min(n, 5))


def sync_initial_max_pages() -> int:
    """Pages of deployments followed on the FIRST sync of a connection (the
    initial import), so a newly connected project pulls enough recent history in
    ONE click instead of forcing repeated "Sync now" presses — while still
    enforcing a hard ceiling (at most this many × `sync_page_size`, never a
    full-history crawl). Clamped [1, 5]; default 3."""
    try:
        n = int(os.getenv("VERCEL_SYNC_INITIAL_MAX_PAGES", "3") or 3)
    except (TypeError, ValueError):
        n = 3
    return max(1, min(n, 5))


# ── Readiness ───────────────────────────────────────────────────────────────

def oauth_configured() -> bool:
    """True iff the OAuth client credentials + redirect URI are present AND
    there is a way to build the install URL. Connect can only run when this
    holds."""
    return bool(
        client_id() and client_secret() and redirect_uri()
        and (integration_slug() or _env("VERCEL_OAUTH_INSTALL_URL"))
    )


__all__ = [
    "is_enabled", "client_id", "client_secret", "redirect_uri",
    "integration_slug", "html_base", "install_url", "token_endpoint",
    "api_base", "frontend_result_base", "frontend_result_path",
    "encryption_configured", "request_timeout_s", "state_ttl_s",
    "pending_ttl_s", "pending_projects_max", "sync_page_size",
    "sync_max_pages", "sync_initial_max_pages", "oauth_configured",
]
