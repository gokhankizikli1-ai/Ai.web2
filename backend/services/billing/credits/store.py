# coding: utf-8
"""
Billing credits — backend dispatcher (PR 8). SQLite default / Postgres when
enabled, with SQLite fallback unless BILLING_POSTGRES_REQUIRED=true.
"""
from __future__ import annotations

import logging
from typing import Any

from backend.services.db import engine
from backend.services.db.errors import DBConfigError, DBUnavailable
from backend.services.billing.credits import config as credits_config


logger = logging.getLogger(__name__)


def current_backend() -> str:
    return "postgres" if engine.is_enabled() else "sqlite"


def _dispatch(fn_name: str, *args, **kwargs) -> Any:
    if not engine.is_enabled():
        from backend.services.billing.credits import store_sqlite
        return getattr(store_sqlite, fn_name)(*args, **kwargs)
    try:
        from backend.services.billing.credits import store_pg
        return getattr(store_pg, fn_name)(*args, **kwargs)
    except (DBConfigError, DBUnavailable) as exc:
        if credits_config.strict_postgres():
            raise
        logger.warning("[billing.credits] Postgres unavailable, falling back to SQLite for %s: %s", fn_name, exc)
        from backend.services.billing.credits import store_sqlite
        return getattr(store_sqlite, fn_name)(*args, **kwargs)


def init() -> None:
    _dispatch("init")


def _reset_for_tests() -> None:
    try:
        from backend.services.billing.credits import store_sqlite
        store_sqlite._reset_for_tests()
    except Exception:  # pragma: no cover
        pass
    try:
        if engine.is_enabled():
            from backend.services.billing.credits import store_pg
            store_pg._reset_for_tests()
    except Exception:  # pragma: no cover
        pass


def get_account(user_id: str):
    return _dispatch("get_account", user_id)


def get_balance(user_id: str) -> int:
    return _dispatch("get_balance", user_id)


def get_by_reference(user_id: str, reference: str):
    return _dispatch("get_by_reference", user_id, reference)


def list_transactions(user_id: str, **kwargs):
    return _dispatch("list_transactions", user_id, **kwargs)


def sum_ledger(user_id: str) -> int:
    return _dispatch("sum_ledger", user_id)


def apply(**kwargs):
    return _dispatch("apply", **kwargs)


def store_stats() -> dict:
    out = _dispatch("store_stats")
    if isinstance(out, dict):
        out["backend"] = current_backend()
    return out


def table_counts() -> dict:
    return _dispatch("table_counts")


__all__ = [
    "init", "_reset_for_tests", "current_backend",
    "get_account", "get_balance", "get_by_reference", "list_transactions",
    "sum_ledger", "apply", "store_stats", "table_counts",
]
