# coding: utf-8
"""
Billing — dynamic configuration accessors (PR 1).

These read the environment on EVERY call (not at import time) so a Railway
env flip — enabling billing, rotating the webhook secret, raising the size
cap — takes effect on the very next request without a process restart. This
mirrors the memory_plane / jobs subsystems, which read their kill-switches
dynamically for the same reason.

The canonical documentation for each variable lives on `backend.core.config
.Config` (ENABLE_BILLING, LEMON_SQUEEZY_WEBHOOK_SECRET, …). We re-read the
raw env here rather than importing the import-time `settings` singleton
precisely because those values must be live, not frozen at boot.
"""
from __future__ import annotations

import os

from backend.core.paths import resolve_db_path


# Default body cap kept in one place; mirrors Config.LEMON_SQUEEZY_WEBHOOK_MAX_BYTES.
_DEFAULT_MAX_BYTES = 512 * 1024


def is_enabled() -> bool:
    """Master gate for the /v2/billing/* webhook surface. Default OFF."""
    return os.getenv("ENABLE_BILLING", "false").strip().lower() == "true"


def webhook_secret() -> str:
    """Lemon Squeezy signing secret. Empty ⇒ the endpoint fails closed.

    NEVER log the return value of this function.
    """
    return (os.getenv("LEMON_SQUEEZY_WEBHOOK_SECRET", "") or "").strip()


def max_body_bytes() -> int:
    """Hard cap on the webhook request body. Falls back to the default on a
    malformed / non-positive override so a bad env value can never disable
    the limit."""
    raw = os.getenv("LEMON_SQUEEZY_WEBHOOK_MAX_BYTES", "")
    try:
        val = int(raw) if raw.strip() else _DEFAULT_MAX_BYTES
    except (TypeError, ValueError):
        return _DEFAULT_MAX_BYTES
    return val if val > 0 else _DEFAULT_MAX_BYTES


def db_path() -> str:
    """Resolve the SQLite inbox path (durable-volume aware). Read dynamically
    so tests can point BILLING_DB_PATH at a tmp file per case."""
    return resolve_db_path("billing.db", "BILLING_DB_PATH")


def strict_postgres() -> bool:
    """When True, Postgres failures propagate instead of falling back to
    SQLite. Default False (permissive) — a downed Postgres must never take
    the webhook endpoint offline, because a 5xx makes Lemon Squeezy retry
    and the delivery is not lost. Flip to true only once SQLite has been
    retired and Postgres is the sole source of truth. Mirrors
    MEMORY_PLANE_POSTGRES_REQUIRED."""
    return os.getenv("BILLING_POSTGRES_REQUIRED", "false").strip().lower() == "true"


__all__ = [
    "is_enabled", "webhook_secret", "max_body_bytes", "db_path",
    "strict_postgres",
]
