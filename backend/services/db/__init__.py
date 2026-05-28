# coding: utf-8
"""Phase 6 — Database foundation package.

Public surface every caller speaks. The 10 existing SQLite stores keep
working unchanged in this slice; this package is the new chokepoint
that future PRs will route them through.

  from backend.services.db import (
      engine, dialect, errors, pgvector_supported, health_check,
  )

  pool = await engine.get_pool()
  async with engine.acquire() as conn:
      row = await conn.fetchrow("SELECT 1")

Backend selection is env-driven:
  DATABASE_URL (postgres://… or postgresql://…)  → Postgres via asyncpg
  unset                                          → no pool; routes that
                                                   require Postgres return
                                                   503 cleanly. Existing
                                                   SQLite stores keep
                                                   working.

ENABLE_POSTGRES_BACKEND=true is the master kill-switch — even when
DATABASE_URL is set, Postgres is only initialised when the flag is on,
so we can ship the wiring to prod and roll it forward in a single env
flip rather than a deploy.
"""
from backend.services.db.engine import (
    get_pool, acquire, close_pool,
    get_sync_pool, acquire_sync, close_sync_pool,
    is_enabled, current_backend,
)
from backend.services.db.health import health_check
from backend.services.db.pgvector import (
    is_pgvector_available, ensure_pgvector, encode_vector, decode_vector,
)
from backend.services.db import dialect
from backend.services.db.errors import DBUnavailable, DBConfigError

__all__ = [
    "get_pool", "acquire", "close_pool",
    "get_sync_pool", "acquire_sync", "close_sync_pool",
    "is_enabled", "current_backend",
    "health_check",
    "is_pgvector_available", "ensure_pgvector", "encode_vector", "decode_vector",
    "dialect",
    "DBUnavailable", "DBConfigError",
]
