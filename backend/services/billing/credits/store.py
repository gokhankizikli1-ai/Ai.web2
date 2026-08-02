# coding: utf-8
"""
Billing credits — backend dispatcher.

ONE authoritative credit backend per deployment — NO split-brain:

  * Shared DB engine DISABLED  → SQLite is the explicitly selected local
    backend (single-process / dev / SQLite-only deployments).
  * Shared DB engine ENABLED   → Postgres is the AUTHORITATIVE credit backend.
    When Postgres is selected but unavailable or misconfigured, credit
    operations FAIL CLOSED (raise `CreditStoreUnavailable`). The dispatcher
    NEVER falls back to the local SQLite store after a Postgres failure —
    doing so in a multi-instance deployment would create independent
    authoritative balances and allow split-brain / double-spend.

This fail-closed invariant is UNCONDITIONAL: it does not depend on
`BILLING_POSTGRES_REQUIRED` being set correctly. (That legacy flag still
governs the OTHER billing subsystems' fallback behaviour; it is intentionally
ignored here and left untouched elsewhere.)

Only bounded exception TYPES are logged — never connection strings,
credentials, SQL, user ids, transaction metadata or secret values.
"""
from __future__ import annotations

import logging
from typing import Any

from backend.services.db import engine
from backend.services.db.errors import DBConfigError, DBUnavailable
from backend.services.billing.credits.errors import (
    CreditStoreError, CreditStoreUnavailable,
)


logger = logging.getLogger(__name__)


def current_backend() -> str:
    """The selected AUTHORITATIVE credit backend for this deployment."""
    return "postgres" if engine.is_enabled() else "sqlite"


def _dispatch(fn_name: str, *args, **kwargs) -> Any:
    """Route a store call to the single authoritative backend.

    SQLite path (engine disabled): the local store is authoritative; its own
    operational failures already surface as typed `CreditStoreError`.

    Postgres path (engine enabled): the Postgres store is authoritative. Any
    unavailability/misconfiguration fails closed as `CreditStoreUnavailable`.
    There is deliberately NO SQLite fallback here — a downed/misconfigured
    Postgres must stop credit operations, not silently spawn a second
    authoritative balance store.
    """
    if not engine.is_enabled():
        from backend.services.billing.credits import store_sqlite
        return getattr(store_sqlite, fn_name)(*args, **kwargs)

    from backend.services.billing.credits import store_pg
    try:
        return getattr(store_pg, fn_name)(*args, **kwargs)
    except CreditStoreError:
        # Already the typed credit contract (e.g. CreditStoreUnavailable). Do
        # NOT fall back to SQLite — fail closed on the authoritative backend.
        raise
    except (DBConfigError, DBUnavailable) as exc:
        # Postgres selected but unreachable/misconfigured. Fail closed; never
        # dispatch into the local SQLite store as a fallback.
        logger.warning(
            "[billing.credits] Postgres authoritative store unavailable for %s: %s",
            fn_name, type(exc).__name__,
        )
        raise CreditStoreUnavailable("credit store unavailable") from exc


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
