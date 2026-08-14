# coding: utf-8
"""GitHub connector — runtime configuration (live-read).

MIRRORS THE BILLING CONFIG PATTERN
----------------------------------
`backend.services.billing.config` reads env vars live on every call so a
Railway flag flip is effective without a restart. This module does the same
for the GitHub connector: the canonical names + defaults are also declared in
`backend.core.config.Config` for discoverability + startup validation, but the
RUNTIME source of truth is here (read dynamically), matching
`routing_mode()` / `billing.config.is_enabled()`.

SECRETS — the private key and webhook secret are read here and NEVER logged,
returned to the frontend, or placed in an observation payload. Callers treat
them as opaque.

PRIVATE KEY NEWLINES — Railway (and most secret stores) store a PEM as a single
line with literal ``\n`` escape sequences. `private_key()` un-escapes those so
the PEM parses. A key pasted with real newlines is left untouched.
"""
from __future__ import annotations

import os
from typing import Optional


def _env(name: str, default: str = "") -> str:
    return (os.getenv(name, default) or "").strip()


# ── Master gate ─────────────────────────────────────────────────────────────

def is_enabled() -> bool:
    """Master kill-switch. Default OFF so merging is behaviourally inert until
    an operator flips it (matches every other subsystem in core.config)."""
    return _env("ENABLE_GITHUB_CONNECTOR", "false").lower() == "true"


# ── GitHub App credentials ──────────────────────────────────────────────────

def app_id() -> str:
    """The numeric GitHub App id (App settings → About). Not secret, but only
    meaningful paired with the private key."""
    return _env("GITHUB_APP_ID")


def private_key() -> str:
    """The App's PEM private key, with escaped ``\\n`` sequences restored to
    real newlines so the PEM parses whether stored one-line-escaped (Railway)
    or multi-line. Returns "" when unset. SECRET — never logged."""
    raw = os.getenv("GITHUB_APP_PRIVATE_KEY", "") or ""
    if not raw.strip():
        return ""
    # A PEM never legitimately contains a literal backslash-n, so restoring
    # every escaped sequence to a real newline is safe and covers the common
    # one-line-escaped secret-store form. A genuinely multi-line PEM has no
    # `\n` escapes and is passed through unchanged.
    return raw.replace("\\n", "\n").strip() + "\n"


def default_installation_id() -> str:
    """OPTIONAL development/default installation id. During development the
    account has a single installation; this lets a project be connected
    without the operator hand-copying the id. NOT a production architecture —
    real connections carry their own installation id in the connection store,
    so multi-user installations are never blocked. Empty ⇒ no default."""
    return _env("GITHUB_DEFAULT_INSTALLATION_ID")


# ── Webhook ────────────────────────────────────────────────────────────────

def webhook_secret() -> str:
    """The webhook signing secret configured in the GitHub App. SECRET —
    never logged. Empty ⇒ the webhook endpoint fails closed (503) because it
    cannot authenticate deliveries (mirrors the billing webhook contract)."""
    return _env("GITHUB_APP_WEBHOOK_SECRET")


def webhook_max_bytes() -> int:
    """Hard request-body cap for the webhook endpoint. GitHub payloads are
    small JSON documents; 1 MiB is a generous ceiling that still refuses a
    hostile client trying to exhaust memory."""
    try:
        return int(os.getenv("GITHUB_WEBHOOK_MAX_BYTES", str(1024 * 1024)) or (1024 * 1024))
    except (TypeError, ValueError):
        return 1024 * 1024


# ── HTTP / provider bounds ──────────────────────────────────────────────────

def api_base() -> str:
    """GitHub REST base. Overridable for tests / GitHub Enterprise."""
    return _env("GITHUB_API_BASE", "https://api.github.com").rstrip("/") or "https://api.github.com"


def request_timeout_s() -> float:
    try:
        return float(os.getenv("GITHUB_REQUEST_TIMEOUT_S", "10") or 10)
    except (TypeError, ValueError):
        return 10.0


def sync_page_size() -> int:
    """Per-resource page size for the bounded initial sync. Clamped [1, 100]
    (100 is GitHub's per_page max)."""
    try:
        n = int(os.getenv("GITHUB_SYNC_PAGE_SIZE", "20") or 20)
    except (TypeError, ValueError):
        n = 20
    return max(1, min(n, 100))


def sync_max_pages() -> int:
    """Hard cap on pages fetched per resource during initial sync — the guard
    that makes the backfill BOUNDED (never crawls full history). Clamped
    [1, 5]."""
    try:
        n = int(os.getenv("GITHUB_SYNC_MAX_PAGES", "1") or 1)
    except (TypeError, ValueError):
        n = 1
    return max(1, min(n, 5))


def configured() -> bool:
    """True iff the App credentials are present (id + key). Auth/sync can only
    run when this holds; the webhook additionally needs the secret."""
    return bool(app_id() and private_key())


# ── GitHub App installation UX (Phase 1 — real install flow) ─────────────────

def app_slug() -> str:
    """The GitHub App's URL slug (App settings → the `github.com/apps/<slug>`
    handle). Needed to build the install URL the user is redirected to. Empty ⇒
    the install-flow start route fails closed (503)."""
    return _env("GITHUB_APP_SLUG")


def github_html_base() -> str:
    """GitHub's web (non-API) base, for the install URL. Overridable for tests /
    GitHub Enterprise."""
    return _env("GITHUB_HTML_BASE", "https://github.com").rstrip("/") or "https://github.com"


def app_client_id() -> str:
    """The GitHub App's OAuth **Client ID** (App settings → About → Client ID) —
    distinct from the numeric App id. Used for the user-to-server OAuth exchange
    that proves the installing GitHub user's identity. Empty ⇒ the install flow
    fails closed."""
    return _env("GITHUB_APP_CLIENT_ID")


def app_client_secret() -> str:
    """The GitHub App's OAuth **Client Secret**. SECRET — never logged, never
    returned to the frontend. Empty ⇒ the install flow fails closed."""
    return _env("GITHUB_APP_CLIENT_SECRET")


def oauth_token_url() -> str:
    """GitHub's user-to-server OAuth token endpoint. Overridable for tests /
    Enterprise."""
    return _env("GITHUB_OAUTH_TOKEN_URL", f"{github_html_base()}/login/oauth/access_token") \
        or f"{github_html_base()}/login/oauth/access_token"


def user_auth_configured() -> bool:
    """True iff the App's OAuth Client id + secret are present — required to
    verify the installing user's identity during the install flow."""
    return bool(app_client_id() and app_client_secret())


def install_url(state: str) -> str:
    """The URL that starts a NEW installation of our App. GitHub echoes the
    `state` param to the App's configured Setup URL after install, which is how
    we tie the callback back to the initiating user+project. A full override
    (GITHUB_APP_INSTALL_URL) wins for unusual setups."""
    import urllib.parse
    override = _env("GITHUB_APP_INSTALL_URL")
    base = override or f"{github_html_base()}/apps/{app_slug()}/installations/new"
    sep = "&" if "?" in base else "?"
    return f"{base}{sep}{urllib.parse.urlencode({'state': state})}"


def frontend_result_base() -> str:
    """SPA origin the setup callback redirects the browser back to. FIXED
    server-side (never taken from a query param) so the callback can never be an
    open redirect. Reuses PUBLIC_APP_URL (same origin the Gmail connector uses);
    a GitHub-specific override wins when set."""
    base = _env("GITHUB_FRONTEND_RESULT_URL") or _env("PUBLIC_APP_URL", "https://korvixai.com")
    return base.rstrip("/")


def frontend_result_path() -> str:
    """The SPA route (a HashRouter fragment) the browser lands on after install."""
    return _env("GITHUB_FRONTEND_RESULT_PATH", "/#/settings/integrations")


def setup_state_ttl_s() -> int:
    """How long an unconsumed install-start state stays valid (CSRF token life).
    Clamped [60, 1800]."""
    try:
        n = int(os.getenv("GITHUB_SETUP_STATE_TTL_S", "600") or 600)
    except (TypeError, ValueError):
        n = 600
    return max(60, min(n, 1800))


def pending_ttl_s() -> int:
    """How long a VERIFIED pending installation (installation_id + owner +
    project, awaiting repo selection) stays valid. Longer than the state TTL
    because the user is picking a repo in the UI. Clamped [60, 3600]."""
    try:
        n = int(os.getenv("GITHUB_PENDING_TTL_S", "900") or 900)
    except (TypeError, ValueError):
        n = 900
    return max(60, min(n, 3600))


def install_repos_max() -> int:
    """Hard cap on repositories listed for a pending installation (bounded read).
    Clamped [1, 300]."""
    try:
        n = int(os.getenv("GITHUB_INSTALL_REPOS_MAX", "100") or 100)
    except (TypeError, ValueError):
        n = 100
    return max(1, min(n, 300))


def install_configured() -> bool:
    """True iff the install flow can run end-to-end: App credentials present, a
    slug (or full install-URL override) to build the redirect, AND the OAuth
    Client id/secret needed to VERIFY the installing user's identity. Requiring
    user auth here is what makes the flow fail closed rather than fall back to
    trusting the setup callback's installation_id alone."""
    return bool(
        configured()
        and (app_slug() or _env("GITHUB_APP_INSTALL_URL"))
        and user_auth_configured()
    )


__all__ = [
    "is_enabled", "app_id", "private_key", "default_installation_id",
    "webhook_secret", "webhook_max_bytes", "api_base", "request_timeout_s",
    "sync_page_size", "sync_max_pages", "configured",
    "app_slug", "github_html_base", "install_url", "frontend_result_base",
    "frontend_result_path", "setup_state_ttl_s", "pending_ttl_s",
    "install_repos_max", "install_configured",
    "app_client_id", "app_client_secret", "oauth_token_url", "user_auth_configured",
]
