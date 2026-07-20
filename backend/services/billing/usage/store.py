# coding: utf-8
"""
Billing usage — backend dispatcher (PR 6).

Routes to store_sqlite (default) or store_pg (Postgres when enabled), re-read
per call. On a Postgres error, falls back to SQLite unless
BILLING_POSTGRES_REQUIRED=true — a downed PG must never break a quota check.
"""
from __future__ import annotations

import logging
from typing import Any

from backend.services.db import engine
from backend.services.db.errors import DBConfigError, DBUnavailable
from backend.services.billing.usage import config as usage_config


logger = logging.getLogger(__name__)


def current_backend() -> str:
    return "postgres" if engine.is_enabled() else "sqlite"


def _dispatch(fn_name: str, *args, **kwargs) -> Any:
    if not engine.is_enabled():
        from backend.services.billing.usage import store_sqlite
        return getattr(store_sqlite, fn_name)(*args, **kwargs)
    try:
        from backend.services.billing.usage import store_pg
        return getattr(store_pg, fn_name)(*args, **kwargs)
    except (DBConfigError, DBUnavailable) as exc:
        if usage_config.strict_postgres():
            raise
        logger.warning(
            "[billing.usage] Postgres unavailable, falling back to SQLite for %s: %s",
            fn_name, exc,
        )
        from backend.services.billing.usage import store_sqlite
        return getattr(store_sqlite, fn_name)(*args, **kwargs)


def init() -> None:
    _dispatch("init")


def _reset_for_tests() -> None:
    try:
        from backend.services.billing.usage import store_sqlite
        store_sqlite._reset_for_tests()
    except Exception:  # pragma: no cover
        pass
    try:
        if engine.is_enabled():
            from backend.services.billing.usage import store_pg
            store_pg._reset_for_tests()
    except Exception:  # pragma: no cover
        pass


def get_used(user_id: str, metric: str, period: str) -> int:
    return _dispatch("get_used", user_id, metric, period)


def list_for_user(user_id: str, **kwargs):
    return _dispatch("list_for_user", user_id, **kwargs)


def consume(user_id: str, metric: str, period: str, amount, limit):
    return _dispatch("consume", user_id, metric, period, amount, limit)


def refund(user_id: str, metric: str, period: str, amount) -> int:
    return _dispatch("refund", user_id, metric, period, amount)


def reset(user_id: str, metric: str, period=None) -> int:
    return _dispatch("reset", user_id, metric, period)


def store_stats() -> dict:
    out = _dispatch("store_stats")
    if isinstance(out, dict):
        out["backend"] = current_backend()
    return out


def table_counts() -> dict:
    return _dispatch("table_counts")


__all__ = [
    "init", "_reset_for_tests", "current_backend",
    "get_used", "list_for_user", "consume", "refund", "reset",
    "store_stats", "table_counts",
]
