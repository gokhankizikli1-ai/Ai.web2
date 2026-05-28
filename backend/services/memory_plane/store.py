# coding: utf-8
"""Phase 6 slice 2 — Memory Plane backend dispatcher.

This module is the stable public surface every caller still imports
unchanged:

    from backend.services.memory_plane import store
    store.insert(...) / store.get(...) / store.list_for_user(...)

It dispatches each call to either `store_sqlite` (default — preserves
production behaviour exactly) or `store_pg` (Postgres via psycopg3 sync,
activated only when both env vars are set on Railway).

Backend selection (re-read on every call so a Railway env flip is live
without a restart):
  ENABLE_POSTGRES_BACKEND=true + DATABASE_URL set  → store_pg
  anything else                                    → store_sqlite

Failure handling:
  When Postgres is enabled but actually unreachable (DBUnavailable),
  the operator should see the failure surface — we do NOT silently
  fall back to SQLite. Falling back would lose write durability
  invisibly the moment the network blipped. The store re-raises, the
  caller's existing error handling sees the same exception it always
  saw, and the operator notices via the same logs. This is the
  honest-failure rule we used everywhere else in the codebase.

Why this shape (module-level dispatch functions instead of class):
  - Every existing caller already does `from … import store` then
    `store.insert(...)`. Preserving that shape avoids touching every
    callsite.
  - The dispatcher functions are one-liners (cheap; ~µs cost).
  - The two backends live in separate files so the diff for each
    is clean (rename old → store_sqlite.py, new store_pg.py).
"""
from __future__ import annotations

import logging
from typing import Optional

from backend.services.db import engine
from backend.services.memory_plane.types import MemoryQuery, MemoryRecord


logger = logging.getLogger(__name__)


def _impl():
    """Pick the backend module per call. Lazy import keeps boot-time
    light when Postgres isn't installed."""
    if engine.is_enabled():
        from backend.services.memory_plane import store_pg
        return store_pg
    from backend.services.memory_plane import store_sqlite
    return store_sqlite


def current_backend() -> str:
    """Coarse label for /tools/health and the diagnostic route."""
    return "postgres" if engine.is_enabled() else "sqlite"


# ── Lifecycle ──────────────────────────────────────────────────────────────

def init() -> None:
    _impl().init()


def _reset_for_tests() -> None:
    """Reset BOTH backends so test fixtures don't leak across cases.
    The Postgres backend's init flag is module-level; the SQLite one
    is module-level too. We reset whichever is reachable."""
    try:
        from backend.services.memory_plane import store_sqlite
        store_sqlite._reset_for_tests()
    except Exception:                                          # pragma: no cover
        pass
    try:
        # Only attempt PG reset when the engine is configured — otherwise
        # importing store_pg pulls in psycopg even when we don't need it.
        if engine.is_enabled():
            from backend.services.memory_plane import store_pg
            store_pg._reset_for_tests()
    except Exception:                                          # pragma: no cover
        pass


# ── Writes ─────────────────────────────────────────────────────────────────

def insert(record: MemoryRecord) -> MemoryRecord:
    return _impl().insert(record)


def update_embedding(record_id: str, embedding: list[float]) -> bool:
    return _impl().update_embedding(record_id, embedding)


def update_importance(record_id: str, importance: float) -> bool:
    return _impl().update_importance(record_id, importance)


# ── Reads ──────────────────────────────────────────────────────────────────

def get(record_id: str) -> Optional[MemoryRecord]:
    return _impl().get(record_id)


def list_for_user(
    user_id: str,
    *,
    project_id: Optional[str] = None,
    agent_id: Optional[str] = None,
    kind: Optional[str] = None,
    include_expired: bool = False,
    limit: int = 50,
    offset: int = 0,
) -> list[MemoryRecord]:
    return _impl().list_for_user(
        user_id,
        project_id=project_id, agent_id=agent_id, kind=kind,
        include_expired=include_expired, limit=limit, offset=offset,
    )


def search_text(query: MemoryQuery) -> list[MemoryRecord]:
    return _impl().search_text(query)


# ── Deletes ────────────────────────────────────────────────────────────────

def soft_delete(record_id: str, *, user_id: Optional[str] = None) -> bool:
    return _impl().soft_delete(record_id, user_id=user_id)


def hard_delete(record_id: str) -> bool:
    return _impl().hard_delete(record_id)


def expire_due(*, now: Optional[str] = None) -> int:
    return _impl().expire_due(now=now)


def wipe_user(user_id: str) -> int:
    return _impl().wipe_user(user_id)


# ── Observability ──────────────────────────────────────────────────────────

def store_stats() -> dict:
    out = _impl().store_stats()
    out["backend"] = current_backend()
    return out


def table_counts() -> dict:
    return _impl().table_counts()


__all__ = [
    "init", "_reset_for_tests", "current_backend",
    "insert", "update_embedding", "update_importance",
    "get", "list_for_user", "search_text",
    "soft_delete", "hard_delete", "expire_due", "wipe_user",
    "store_stats", "table_counts",
]
