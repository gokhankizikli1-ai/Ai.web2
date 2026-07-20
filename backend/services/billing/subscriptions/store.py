# coding: utf-8
"""
Billing subscriptions — backend dispatcher (PR 3).

Routes to store_sqlite (default) or store_pg (when ENABLE_POSTGRES_BACKEND +
DATABASE_URL are set), re-read per call so a Railway flip is live. Same
Postgres-failure fallback policy as the inbox (BILLING_POSTGRES_REQUIRED): a
downed Postgres falls back to SQLite unless strict mode is on, so projection
never hard-fails the consumer.
"""
from __future__ import annotations

import logging
from typing import Any

from backend.services.db import engine
from backend.services.db.errors import DBConfigError, DBUnavailable
from backend.services.billing import config as billing_config


logger = logging.getLogger(__name__)


def current_backend() -> str:
    return "postgres" if engine.is_enabled() else "sqlite"


def _dispatch(fn_name: str, *args, **kwargs) -> Any:
    if not engine.is_enabled():
        from backend.services.billing.subscriptions import store_sqlite
        return getattr(store_sqlite, fn_name)(*args, **kwargs)
    try:
        from backend.services.billing.subscriptions import store_pg
        return getattr(store_pg, fn_name)(*args, **kwargs)
    except (DBConfigError, DBUnavailable) as exc:
        if billing_config.strict_postgres():
            raise
        logger.warning(
            "[billing.subscriptions] Postgres unavailable, falling back to SQLite for %s: %s",
            fn_name, exc,
        )
        from backend.services.billing.subscriptions import store_sqlite
        return getattr(store_sqlite, fn_name)(*args, **kwargs)


def init() -> None:
    _dispatch("init")


def _reset_for_tests() -> None:
    try:
        from backend.services.billing.subscriptions import store_sqlite
        store_sqlite._reset_for_tests()
    except Exception:  # pragma: no cover
        pass
    try:
        if engine.is_enabled():
            from backend.services.billing.subscriptions import store_pg
            store_pg._reset_for_tests()
    except Exception:  # pragma: no cover
        pass


def upsert(sub):
    return _dispatch("upsert", sub)


def get(provider: str, subscription_id: str):
    return _dispatch("get", provider, subscription_id)


def list_subscriptions(**kwargs):
    return _dispatch("list_subscriptions", **kwargs)


def count_by_status() -> dict:
    out = _dispatch("count_by_status")
    if isinstance(out, dict):
        out["backend"] = current_backend()
    return out


def store_stats() -> dict:
    out = _dispatch("store_stats")
    if isinstance(out, dict):
        out["backend"] = current_backend()
    return out


def table_counts() -> dict:
    return _dispatch("table_counts")


__all__ = [
    "init", "_reset_for_tests", "current_backend",
    "upsert", "get", "list_subscriptions",
    "count_by_status", "store_stats", "table_counts",
]
