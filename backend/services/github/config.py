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


__all__ = [
    "is_enabled", "app_id", "private_key", "default_installation_id",
    "webhook_secret", "webhook_max_bytes", "api_base", "request_timeout_s",
    "sync_page_size", "sync_max_pages", "configured",
]
