# coding: utf-8
"""
Billing checkout — backend dispatcher (PR 7). SQLite default / Postgres when
enabled, with SQLite fallback unless BILLING_POSTGRES_REQUIRED=true.
"""
from __future__ import annotations

import logging
from typing import Any

from backend.services.db import engine
from backend.services.db.errors import DBConfigError, DBUnavailable
from backend.services.billing.checkout import config as checkout_config


logger = logging.getLogger(__name__)


def current_backend() -> str:
    return "postgres" if engine.is_enabled() else "sqlite"


def _dispatch(fn_name: str, *args, **kwargs) -> Any:
    if not engine.is_enabled():
        from backend.services.billing.checkout import store_sqlite
        return getattr(store_sqlite, fn_name)(*args, **kwargs)
    try:
        from backend.services.billing.checkout import store_pg
        return getattr(store_pg, fn_name)(*args, **kwargs)
    except (DBConfigError, DBUnavailable) as exc:
        if checkout_config.strict_postgres():
            raise
        logger.warning("[billing.checkout] Postgres unavailable, falling back to SQLite for %s: %s", fn_name, exc)
        from backend.services.billing.checkout import store_sqlite
        return getattr(store_sqlite, fn_name)(*args, **kwargs)


def init() -> None:
    _dispatch("init")


def _reset_for_tests() -> None:
    try:
        from backend.services.billing.checkout import store_sqlite
        store_sqlite._reset_for_tests()
    except Exception:  # pragma: no cover
        pass
    try:
        if engine.is_enabled():
            from backend.services.billing.checkout import store_pg
            store_pg._reset_for_tests()
    except Exception:  # pragma: no cover
        pass


def get_by_idempotency(user_id: str, key: str):
    return _dispatch("get_by_idempotency", user_id, key)


def insert(record):
    return _dispatch("insert", record)


def list_recent(**kwargs):
    return _dispatch("list_recent", **kwargs)


def store_stats() -> dict:
    out = _dispatch("store_stats")
    if isinstance(out, dict):
        out["backend"] = current_backend()
    return out


def table_counts() -> dict:
    return _dispatch("table_counts")


__all__ = [
    "init", "_reset_for_tests", "current_backend",
    "get_by_idempotency", "insert", "list_recent",
    "store_stats", "table_counts",
]
