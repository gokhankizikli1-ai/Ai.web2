# coding: utf-8
"""
Billing — webhook inbox backend dispatcher (PR 1).

Stable public surface every caller imports:

    from backend.services.billing import store
    store.insert_idempotent(event) / store.get(id) / store.list_events(...)

Dispatches each call to `store_sqlite` (default — preserves the
volume-less Railway boot) or `store_pg` (Postgres via psycopg3 sync,
activated when ENABLE_POSTGRES_BACKEND=true + DATABASE_URL are set). Backend
selection is re-read on every call so a Railway env flip is live without a
restart.

Postgres failure handling (mirrors memory_plane):
  BILLING_POSTGRES_REQUIRED (default "false")
    "false" → on a DBConfigError/DBUnavailable, fall back to SQLite for that
              call and log a WARNING. A downed Postgres must NEVER take the
              webhook endpoint offline — a 5xx makes Lemon Squeezy retry, but
              a durable SQLite write keeps the delivery.
    "true"  → strict mode; Postgres failures propagate.

The fallback catches ONLY DB-foundation errors — programmer errors
(ValueError on a missing dedup_key) still propagate.
"""
from __future__ import annotations

import logging
from typing import Any

from backend.services.db import engine
from backend.services.db.errors import DBConfigError, DBUnavailable
from backend.services.billing import config as billing_config


logger = logging.getLogger(__name__)


def current_backend() -> str:
    """Coarse label for diagnostics — 'postgres' when the engine is enabled,
    else 'sqlite' (the system-wide fallback)."""
    return "postgres" if engine.is_enabled() else "sqlite"


def _dispatch(fn_name: str, *args, **kwargs) -> Any:
    if not engine.is_enabled():
        from backend.services.billing import store_sqlite
        return getattr(store_sqlite, fn_name)(*args, **kwargs)

    try:
        from backend.services.billing import store_pg
        return getattr(store_pg, fn_name)(*args, **kwargs)
    except (DBConfigError, DBUnavailable) as exc:
        if billing_config.strict_postgres():
            raise
        logger.warning(
            "[billing] Postgres unavailable, falling back to SQLite for %s: %s",
            fn_name, exc,
        )
        from backend.services.billing import store_sqlite
        return getattr(store_sqlite, fn_name)(*args, **kwargs)


# ── Lifecycle ────────────────────────────────────────────────────────────────

def init() -> None:
    _dispatch("init")


def _reset_for_tests() -> None:
    """Reset BOTH backends so test fixtures don't leak across cases."""
    try:
        from backend.services.billing import store_sqlite
        store_sqlite._reset_for_tests()
    except Exception:  # pragma: no cover
        pass
    try:
        if engine.is_enabled():
            from backend.services.billing import store_pg
            store_pg._reset_for_tests()
    except Exception:  # pragma: no cover
        pass


# ── Writes ───────────────────────────────────────────────────────────────────

def insert_idempotent(event):
    return _dispatch("insert_idempotent", event)


def mark_processing(event_id: str) -> bool:
    return _dispatch("mark_processing", event_id)


def mark_processed(event_id: str) -> bool:
    return _dispatch("mark_processed", event_id)


def mark_failed(event_id: str, error: str) -> bool:
    return _dispatch("mark_failed", event_id, error)


# ── Reads ────────────────────────────────────────────────────────────────────

def get(event_id: str):
    return _dispatch("get", event_id)


def get_by_dedup(provider: str, dedup_key: str):
    return _dispatch("get_by_dedup", provider, dedup_key)


def list_events(**kwargs):
    return _dispatch("list_events", **kwargs)


# ── Observability ────────────────────────────────────────────────────────────

def stats() -> dict:
    out = _dispatch("stats")
    out["backend"] = current_backend()
    return out


def store_stats() -> dict:
    out = _dispatch("store_stats")
    out["backend"] = current_backend()
    return out


def table_counts() -> dict:
    return _dispatch("table_counts")


__all__ = [
    "init", "_reset_for_tests", "current_backend",
    "insert_idempotent", "mark_processing", "mark_processed", "mark_failed",
    "get", "get_by_dedup", "list_events",
    "stats", "store_stats", "table_counts",
]
