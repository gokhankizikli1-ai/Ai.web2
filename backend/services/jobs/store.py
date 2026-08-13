# coding: utf-8
"""Phase 2 (shared jobs) — dual-backend jobs store dispatcher.

The canonical jobs-store API every caller speaks (client / manager / runner /
dlq / orphan_reaper / routes). It routes to ONE backend:

  * Postgres (`store_pg`) — the shared, cross-replica-durable production
    authority — when `ENABLE_POSTGRES_BACKEND` + `DATABASE_URL` are set
    (`engine.is_enabled()`).
  * SQLite (`store_sqlite`) — local/single-node/development fallback —
    otherwise.

The public API + JobRecord shapes are identical across backends, so callers
never branch on storage. This mirrors the existing billing dual-backend
pattern (`store` dispatcher over `store_pg`/`store_sqlite`), reusing the
`db.engine` sync pool — no new DB framework.

FAIL-CLOSED (no split-brain): when Postgres is the SELECTED backend but is
transiently unavailable, operations RAISE (DBUnavailable) rather than silently
falling back to a LOCAL SQLite file — a per-replica fallback would fork the
shared job truth and defeat cross-replica idempotency/observation. (A missing
DATABASE_URL simply means Postgres isn't enabled → SQLite, the dev default.)
This matches the credits-ledger policy for shared, correctness-critical state.
"""
from __future__ import annotations

import logging
from typing import Any

from backend.services.db import engine
from backend.services.jobs import store_sqlite

logger = logging.getLogger(__name__)


def current_backend() -> str:
    return "postgres" if engine.is_enabled() else "sqlite"


def _backend():
    if engine.is_enabled():
        from backend.services.jobs import store_pg
        return store_pg
    return store_sqlite


def _dispatch(fn_name: str, *args, **kwargs) -> Any:
    return getattr(_backend(), fn_name)(*args, **kwargs)


# ── Lifecycle ────────────────────────────────────────────────────────────

def init() -> None:
    _dispatch("init")


def _reset_for_tests() -> None:
    """Reset BOTH backends so test fixtures don't leak across cases."""
    try:
        store_sqlite._reset_for_tests()
    except Exception:
        pass
    try:
        from backend.services.jobs import store_pg
        store_pg._reset_for_tests()
    except Exception:
        pass


# ── Writes ───────────────────────────────────────────────────────────────

def insert(record):
    return _dispatch("insert", record)


def update(record_id: str, **fields):
    return _dispatch("update", record_id, **fields)


def bump_max_attempts(record_id: str, new_max: int) -> bool:
    return _dispatch("bump_max_attempts", record_id, new_max)


# ── Reads ────────────────────────────────────────────────────────────────

def get(record_id: str):
    return _dispatch("get", record_id)


def get_by_idempotency_key(*, user_id: str, kind: str, idempotency_key: str):
    return _dispatch("get_by_idempotency_key", user_id=user_id, kind=kind,
                     idempotency_key=idempotency_key)


def list_for_user(user_id: str, **kwargs):
    return _dispatch("list_for_user", user_id, **kwargs)


def list_all(**kwargs):
    return _dispatch("list_all", **kwargs)


# ── Deletes ──────────────────────────────────────────────────────────────

def delete(record_id: str) -> bool:
    return _dispatch("delete", record_id)


def wipe_user(user_id: str) -> int:
    return _dispatch("wipe_user", user_id)


# ── Health ───────────────────────────────────────────────────────────────

def store_stats() -> dict:
    out = _dispatch("store_stats")
    if isinstance(out, dict):
        out.setdefault("backend", current_backend())
    return out


def table_counts() -> dict:
    return _dispatch("table_counts")


__all__ = [
    "init", "_reset_for_tests", "current_backend",
    "insert", "update", "bump_max_attempts", "get",
    "get_by_idempotency_key", "list_for_user", "list_all",
    "delete", "wipe_user",
    "store_stats", "table_counts",
]
