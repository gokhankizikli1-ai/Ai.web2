# coding: utf-8
"""Phase 6 — async Postgres engine + pool, env-driven.

Single chokepoint for any caller that wants a Postgres connection.
The pool is created lazily on first `get_pool()` and reused — we never
open a connection per call. asyncpg's pool is async-safe and handles
the wire protocol details.

Env contract:
  DATABASE_URL                    postgres://user:pass@host:5432/db
  ENABLE_POSTGRES_BACKEND=true    master kill-switch
  DB_POOL_MIN_SIZE=2              optional pool tuning
  DB_POOL_MAX_SIZE=10
  DB_POOL_TIMEOUT_SEC=10          connect timeout
  DB_STATEMENT_TIMEOUT_MS=15000   per-statement cap (server-enforced)

Backward compatibility:
  When DATABASE_URL is unset OR ENABLE_POSTGRES_BACKEND is off, this
  module reports `is_enabled() == False`. The 10 existing SQLite stores
  do NOT consult this engine — they keep using their own sqlite3
  connections. Future PRs will dual-path them: prefer Postgres when
  enabled, fall back to SQLite when not.

asyncpg is loaded LAZILY so the API boots cleanly when the package
isn't installed (tests / dev environments without the dep).
"""
from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, Optional

from backend.services.db.errors import DBConfigError, DBUnavailable


logger = logging.getLogger(__name__)


# ── Module state ────────────────────────────────────────────────────────────
#
# Single shared pool per process. Cached after first successful build,
# nulled by close_pool().
_POOL: Any = None                # asyncpg.Pool when initialised
_POOL_LOCK = asyncio.Lock()

# Phase 6 slice 2 — sync pool via psycopg3. The 10 existing stores are
# all sync (raw sqlite3 + threading locks); they can't await on asyncpg
# without a per-call event loop. psycopg3 ships with both sync and
# async APIs from one package — we use the sync ConnectionPool here.
_SYNC_POOL: Any = None
import threading as _threading                  # local alias avoids a top-level rename
_SYNC_POOL_LOCK = _threading.Lock()


# ── Env helpers ─────────────────────────────────────────────────────────────

def _flag(key: str) -> bool:
    """Read a boolean env flag dynamically. Mirrors tool_registry._flag
    so toggles propagate without a restart."""
    return os.getenv(key, "false").strip().lower() == "true"


def _database_url() -> str:
    """Normalise to `postgresql://` — asyncpg accepts both spellings but
    SQLAlchemy-style URLs sometimes use `postgres://`."""
    raw = (os.getenv("DATABASE_URL") or "").strip()
    if not raw:
        return ""
    if raw.startswith("postgres://"):
        return "postgresql://" + raw[len("postgres://"):]
    return raw


def is_enabled() -> bool:
    """True when Postgres is BOTH configured AND switched on. Read
    dynamically so a Railway env flip takes effect on the next call."""
    return _flag("ENABLE_POSTGRES_BACKEND") and bool(_database_url())


def current_backend() -> str:
    """Coarse backend label for logging / health / dialect selection.
    Returns 'postgres' when the engine is enabled, 'sqlite' otherwise —
    SQLite is the system-wide fallback for every store today."""
    return "postgres" if is_enabled() else "sqlite"


# ── Pool lifecycle ──────────────────────────────────────────────────────────

async def get_pool():
    """Return the shared asyncpg pool. Raises DBConfigError when the
    env isn't set up; raises DBUnavailable on connect failure.

    Safe to call concurrently — the first caller builds the pool, the
    rest await the same future via the lock.
    """
    global _POOL
    if _POOL is not None:
        return _POOL

    if not is_enabled():
        raise DBConfigError(
            "Postgres backend disabled. "
            "Set DATABASE_URL and ENABLE_POSTGRES_BACKEND=true."
        )

    try:
        import asyncpg  # noqa: PLC0415
    except ImportError as exc:
        raise DBConfigError(
            "asyncpg is not installed. Add `asyncpg` to requirements.txt "
            "and reinstall."
        ) from exc

    async with _POOL_LOCK:
        if _POOL is not None:                  # someone built it while we waited
            return _POOL

        dsn = _database_url()
        min_size = int(os.getenv("DB_POOL_MIN_SIZE", "2") or 2)
        max_size = int(os.getenv("DB_POOL_MAX_SIZE", "10") or 10)
        timeout  = float(os.getenv("DB_POOL_TIMEOUT_SEC", "10") or 10.0)
        stmt_timeout_ms = int(os.getenv("DB_STATEMENT_TIMEOUT_MS", "15000") or 15000)

        async def _init_conn(conn):
            # Server-side per-statement cap so a runaway query can't
            # tie up a worker — set as session GUC after connect.
            await conn.execute(
                f"SET statement_timeout = {stmt_timeout_ms}"
            )

        try:
            pool = await asyncio.wait_for(
                asyncpg.create_pool(
                    dsn=dsn,
                    min_size=min_size,
                    max_size=max_size,
                    init=_init_conn,
                ),
                timeout=timeout,
            )
        except (asyncio.TimeoutError, OSError) as exc:
            raise DBUnavailable(f"connect failed: {exc}") from exc
        except Exception as exc:
            # asyncpg surfaces auth errors as a subclass of
            # PostgresError — surface as DBUnavailable so the route
            # returns 503; operator sees the real reason in the log.
            logger.warning("postgres pool init failed: %s", exc)
            raise DBUnavailable(f"pool init: {exc}") from exc

        logger.info(
            "[DB] postgres pool ready min=%d max=%d timeout=%.1fs stmt_timeout=%dms",
            min_size, max_size, timeout, stmt_timeout_ms,
        )
        _POOL = pool
        return _POOL


@asynccontextmanager
async def acquire() -> AsyncIterator[Any]:
    """Yield an asyncpg connection from the shared pool.

    Usage:
        async with acquire() as conn:
            row = await conn.fetchrow("SELECT 1")
    """
    pool = await get_pool()
    async with pool.acquire() as conn:
        yield conn


async def close_pool() -> None:
    """Close the pool — for graceful shutdown + test cleanup."""
    global _POOL
    if _POOL is None:
        return
    pool = _POOL
    _POOL = None
    try:
        await pool.close()
    except Exception as exc:                                  # pragma: no cover
        logger.warning("postgres pool close failed: %s", exc)


# ── Sync pool (psycopg3) ────────────────────────────────────────────────────
#
# For the 10 existing sync stores. Same DSN, same env flags. Lazy-imported
# so the API process boots cleanly without psycopg installed (and so the
# test runner doesn't need it for SQLite-only paths).

def get_sync_pool():
    """Return the shared psycopg3 ConnectionPool. Raises DBConfigError
    when the env isn't set up; DBUnavailable on connect failure.

    Thread-safe — the threading lock protects the build-once invariant.
    """
    global _SYNC_POOL
    if _SYNC_POOL is not None:
        return _SYNC_POOL

    if not is_enabled():
        raise DBConfigError(
            "Postgres backend disabled. "
            "Set DATABASE_URL and ENABLE_POSTGRES_BACKEND=true."
        )

    try:
        from psycopg_pool import ConnectionPool   # noqa: PLC0415
    except ImportError as exc:
        raise DBConfigError(
            "psycopg / psycopg_pool not installed. "
            "Add `psycopg[binary,pool]` to requirements.txt and reinstall."
        ) from exc

    with _SYNC_POOL_LOCK:
        if _SYNC_POOL is not None:
            return _SYNC_POOL

        dsn = _database_url()
        min_size = int(os.getenv("DB_POOL_MIN_SIZE", "2") or 2)
        max_size = int(os.getenv("DB_POOL_MAX_SIZE", "10") or 10)
        timeout  = float(os.getenv("DB_POOL_TIMEOUT_SEC", "10") or 10.0)
        stmt_timeout_ms = int(os.getenv("DB_STATEMENT_TIMEOUT_MS", "15000") or 15000)

        # psycopg3's session-level options go on each new connection
        # through `configure`. We set statement_timeout the same way
        # the async pool does so behavior matches between paths.
        def _configure(conn):
            with conn.cursor() as cur:
                cur.execute(f"SET statement_timeout = {stmt_timeout_ms}")

        try:
            pool = ConnectionPool(
                conninfo=dsn,
                min_size=min_size,
                max_size=max_size,
                timeout=timeout,
                configure=_configure,
                open=True,
            )
        except Exception as exc:
            logger.warning("postgres sync pool init failed: %s", exc)
            raise DBUnavailable(f"sync pool init: {exc}") from exc

        logger.info(
            "[DB] postgres sync pool ready min=%d max=%d timeout=%.1fs stmt_timeout=%dms",
            min_size, max_size, timeout, stmt_timeout_ms,
        )
        _SYNC_POOL = pool
        return _SYNC_POOL


from contextlib import contextmanager as _contextmanager


@_contextmanager
def acquire_sync():
    """Yield a psycopg3 connection from the shared sync pool.

    Usage:
        with acquire_sync() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
    """
    pool = get_sync_pool()
    with pool.connection() as conn:
        yield conn


def close_sync_pool() -> None:
    """Close the sync pool — for graceful shutdown + test cleanup."""
    global _SYNC_POOL
    if _SYNC_POOL is None:
        return
    pool = _SYNC_POOL
    _SYNC_POOL = None
    try:
        pool.close()
    except Exception as exc:                                  # pragma: no cover
        logger.warning("postgres sync pool close failed: %s", exc)


__all__ = [
    "get_pool", "acquire", "close_pool",
    "get_sync_pool", "acquire_sync", "close_sync_pool",
    "is_enabled", "current_backend",
]
