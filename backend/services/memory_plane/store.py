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

Postgres failure handling (Phase 6 production fix):
  Env: MEMORY_PLANE_POSTGRES_REQUIRED (default "false")
    "false" (default) → if Postgres is enabled but a call raises
                        DBConfigError/DBUnavailable, the dispatcher
                        falls back to SQLite for that call. Keeps the
                        app serving traffic during PG outages /
                        misconfiguration. Logs a WARNING on each
                        fallback so the operator notices.
    "true"            → strict mode. Postgres failures propagate.
                        Use this when SQLite has been retired and PG
                        is the sole source of truth.

  The default is deliberately permissive because production gets
  hurt more by a downed app than by a brief dual-write inconsistency
  (and PG hasn't been a source-of-truth long enough to justify
  strictness on day 1). Once the migration has been stable for a
  cycle, flip MEMORY_PLANE_POSTGRES_REQUIRED=true on Railway.

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
import os
from typing import Any, Callable, Optional

from backend.services.db import engine
from backend.services.db.errors import DBConfigError, DBUnavailable
from backend.services.memory_plane.types import MemoryQuery, MemoryRecord


logger = logging.getLogger(__name__)


def _strict_pg() -> bool:
    """When True, postgres failures propagate. When False (default),
    the dispatcher falls back to SQLite on DBConfigError/DBUnavailable.
    Read dynamically so a Railway env flip is live without a restart."""
    return os.getenv("MEMORY_PLANE_POSTGRES_REQUIRED", "false").strip().lower() == "true"


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


def _dispatch(fn_name: str, *args, **kwargs) -> Any:
    """Route one call to the active backend. On a Postgres
    config/unavailable error, fall back to SQLite (unless strict mode
    is on).

    The fallback path catches ONLY DB-foundation errors — programmer
    errors (ValueError on missing user_id, etc.) still propagate.
    """
    if not engine.is_enabled():
        from backend.services.memory_plane import store_sqlite
        return getattr(store_sqlite, fn_name)(*args, **kwargs)

    try:
        from backend.services.memory_plane import store_pg
        return getattr(store_pg, fn_name)(*args, **kwargs)
    except (DBConfigError, DBUnavailable) as exc:
        if _strict_pg():
            raise
        logger.warning(
            "[memory_plane] Postgres unavailable, falling back to SQLite "
            "for %s: %s",
            fn_name, exc,
        )
        from backend.services.memory_plane import store_sqlite
        return getattr(store_sqlite, fn_name)(*args, **kwargs)


# ── Lifecycle ──────────────────────────────────────────────────────────────

def init() -> None:
    _dispatch("init")


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
    return _dispatch("insert", record)


def update_embedding(record_id: str, embedding: list[float]) -> bool:
    return _dispatch("update_embedding", record_id, embedding)


def update_importance(record_id: str, importance: float) -> bool:
    return _dispatch("update_importance", record_id, importance)


# ── Reads ──────────────────────────────────────────────────────────────────

def get(record_id: str) -> Optional[MemoryRecord]:
    return _dispatch("get", record_id)


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
    return _dispatch(
        "list_for_user",
        user_id,
        project_id=project_id, agent_id=agent_id, kind=kind,
        include_expired=include_expired, limit=limit, offset=offset,
    )


def search_text(query: MemoryQuery) -> list[MemoryRecord]:
    return _dispatch("search_text", query)


def semantic_recall(
    user_id: str,
    embedding: list[float],
    *,
    k: int = 10,
    project_id: Optional[str] = None,
    agent_id: Optional[str] = None,
    kind: Optional[str] = None,
    include_expired: bool = False,
    candidate_pool: int = 500,
) -> list[tuple]:
    """Phase 6 slice 3 — cosine-similarity recall over stored vectors.

    Returns a list of (record, similarity_score) tuples sorted by
    score DESC. SQLite ranks in Python; Postgres uses pgvector when
    the column has been upgraded (db_migrate vector-upgrade) and
    falls back to Python cosine otherwise.
    """
    return _dispatch(
        "semantic_recall",
        user_id, embedding,
        k=k, project_id=project_id, agent_id=agent_id, kind=kind,
        include_expired=include_expired, candidate_pool=candidate_pool,
    )


# ── Deletes ────────────────────────────────────────────────────────────────

def soft_delete(record_id: str, *, user_id: Optional[str] = None) -> bool:
    return _dispatch("soft_delete", record_id, user_id=user_id)


def hard_delete(record_id: str) -> bool:
    return _dispatch("hard_delete", record_id)


def expire_due(*, now: Optional[str] = None) -> int:
    return _dispatch("expire_due", now=now)


def wipe_user(user_id: str) -> int:
    return _dispatch("wipe_user", user_id)


# ── Observability ──────────────────────────────────────────────────────────

def store_stats() -> dict:
    out = _dispatch("store_stats")
    out["backend"] = current_backend()
    return out


def table_counts() -> dict:
    return _dispatch("table_counts")


__all__ = [
    "init", "_reset_for_tests", "current_backend",
    "insert", "update_embedding", "update_importance",
    "get", "list_for_user", "search_text", "semantic_recall",
    "soft_delete", "hard_delete", "expire_due", "wipe_user",
    "store_stats", "table_counts",
]
