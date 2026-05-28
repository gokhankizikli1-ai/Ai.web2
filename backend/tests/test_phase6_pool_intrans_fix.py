# coding: utf-8
"""Phase 6 production-fix regression tests.

Two things this PR fixes that we need to lock in with tests:

  1. The psycopg `configure` callback used to run `SET statement_timeout`
     on every new connection, which started an implicit transaction
     (psycopg3 defaults to autocommit=False) that the callback exited
     without committing. The pool detected INTRANS and discarded every
     connection it tried to build. Log: "connection left in status
     INTRANS discarded". The fix: pass the timeout via libpq's
     `options` connection parameter so no SET command runs.

  2. When Postgres is enabled but unreachable, the dispatcher used to
     re-raise — fine on day 1 (operator must see the failure) but
     production is hurt more by a downed app than by a brief
     dual-write inconsistency. The fix: fall back to SQLite by
     default; the new `MEMORY_PLANE_POSTGRES_REQUIRED=true` env makes
     the strict behaviour opt-in.

These tests do NOT require a live Postgres — they monkeypatch the
engine seam.
"""
from __future__ import annotations

import asyncio
import inspect

import pytest

from backend.services.db import engine
from backend.services.db.errors import DBConfigError, DBUnavailable
from backend.services.memory_plane import store as mp_store
from backend.services.memory_plane.types import MemoryRecord


# ── 1. INTRANS leak regression ─────────────────────────────────────────────

class TestPoolConfigureNoLongerSets:
    """The previous bug was a `configure=` callback that ran
    `SET statement_timeout = ...` on every new connection. That left
    the connection INTRANS → pool discarded it → no connections ever
    landed → "error connecting in 'pool-1'". The fix passes the
    timeout via libpq `options` so no SET command runs.

    We don't have a real Postgres to verify the wire-level behaviour
    against, so we lock in the fix at the source-code seam: the
    ConnectionPool is constructed WITHOUT a `configure` arg and the
    libpq `options` string contains the statement_timeout.
    """

    def test_sync_pool_uses_options_not_configure(self, monkeypatch):
        """The sync pool must hand the timeout to libpq via `options`,
        not via a `configure` callback that runs SET."""
        monkeypatch.setenv("DATABASE_URL", "postgresql://stub@host/db")
        monkeypatch.setenv("ENABLE_POSTGRES_BACKEND", "true")
        monkeypatch.setenv("DB_STATEMENT_TIMEOUT_MS", "9999")

        # Reset the cached pool so the next call rebuilds.
        engine._SYNC_POOL = None

        captured = {}

        class _FakePool:
            def __init__(self, *_, conninfo=None, min_size=None,
                         max_size=None, timeout=None,
                         kwargs=None, open=None,
                         configure=None):
                captured["conninfo"] = conninfo
                captured["kwargs"] = kwargs or {}
                captured["open"] = open
                captured["configure"] = configure

            def open(self, wait=True):  # noqa: A003 — mirror psycopg api
                captured["opened"] = True

            def close(self):
                pass

        # Patch the lazy psycopg_pool import target.
        import sys, types
        fake_mod = types.ModuleType("psycopg_pool")
        fake_mod.ConnectionPool = _FakePool
        monkeypatch.setitem(sys.modules, "psycopg_pool", fake_mod)

        pool = engine.get_sync_pool()
        assert pool is not None

        # Critical assertions for the INTRANS fix:
        assert captured.get("configure") is None, (
            "configure callback must NOT be set — it leaks INTRANS"
        )
        opts = captured["kwargs"].get("options", "")
        assert "statement_timeout=9999" in opts, (
            f"libpq options must carry the timeout, got: {opts!r}"
        )
        # Non-blocking startup: open=False so the constructor doesn't
        # wait on min_size connections.
        assert captured.get("open") is False
        assert captured.get("opened") is True

        # Cleanup
        engine._SYNC_POOL = None

    def test_async_pool_uses_server_settings_not_init_callback(self, monkeypatch):
        """The async pool must pass statement_timeout via
        `server_settings`, not via an `init=` callback that runs SET."""
        monkeypatch.setenv("DATABASE_URL", "postgresql://stub@host/db")
        monkeypatch.setenv("ENABLE_POSTGRES_BACKEND", "true")
        monkeypatch.setenv("DB_STATEMENT_TIMEOUT_MS", "8888")
        monkeypatch.setenv("DB_POOL_TIMEOUT_SEC", "2")

        engine._POOL = None

        captured = {}

        async def _fake_create_pool(*args, **kwargs):
            captured.update(kwargs)
            class _P:
                async def close(self):
                    pass
            return _P()

        # Patch asyncpg.create_pool.
        import sys, types
        fake_asyncpg = types.ModuleType("asyncpg")
        fake_asyncpg.create_pool = _fake_create_pool
        monkeypatch.setitem(sys.modules, "asyncpg", fake_asyncpg)

        pool = asyncio.run(engine.get_pool())
        assert pool is not None

        assert "init" not in captured or captured.get("init") is None, (
            "init callback must NOT be set — it leaks INTRANS on asyncpg too"
        )
        ss = captured.get("server_settings") or {}
        assert ss.get("statement_timeout") == "8888", (
            f"server_settings must carry the timeout, got: {ss!r}"
        )

        # Cleanup
        engine._POOL = None


# ── 2. Postgres-down fallback to SQLite ────────────────────────────────────

class TestPostgresFallback:
    """When PG is enabled but a call raises DBConfigError/DBUnavailable,
    the dispatcher must fall back to SQLite by default. Production safety
    rule — keep the app serving traffic during a PG outage.
    """

    def test_default_is_permissive(self, monkeypatch):
        monkeypatch.delenv("MEMORY_PLANE_POSTGRES_REQUIRED", raising=False)
        assert mp_store._strict_pg() is False

    def test_strict_opt_in(self, monkeypatch):
        monkeypatch.setenv("MEMORY_PLANE_POSTGRES_REQUIRED", "true")
        assert mp_store._strict_pg() is True

    def test_falls_back_to_sqlite_when_pg_unavailable(
        self, monkeypatch, tmp_memory_plane_db,
    ):
        """PG enabled but every store_pg call raises DBUnavailable.
        Dispatcher must transparently insert into SQLite instead, and
        the caller sees the SQLite-backed result with no exception."""
        monkeypatch.setenv("DATABASE_URL", "postgresql://stub@host/db")
        monkeypatch.setenv("ENABLE_POSTGRES_BACKEND", "true")
        monkeypatch.delenv("MEMORY_PLANE_POSTGRES_REQUIRED", raising=False)

        # Force every store_pg function we touch to surface DBUnavailable.
        from backend.services.memory_plane import store_pg

        def _explode(*_a, **_kw):
            raise DBUnavailable("postgres down (simulated)")

        monkeypatch.setattr(store_pg, "insert", _explode)
        monkeypatch.setattr(store_pg, "get",    _explode)
        monkeypatch.setattr(store_pg, "list_for_user", _explode)

        rec = mp_store.insert(MemoryRecord(
            user_id="u-fallback", content="fallback write"
        ))
        assert rec.id is not None
        # Round-trip through dispatcher — second call ALSO hits the
        # exploding store_pg + falls back. Proves we don't cache a
        # broken backend.
        got = mp_store.get(rec.id)
        assert got is not None
        assert got.content == "fallback write"

    def test_strict_mode_re_raises(
        self, monkeypatch, tmp_memory_plane_db,
    ):
        monkeypatch.setenv("DATABASE_URL", "postgresql://stub@host/db")
        monkeypatch.setenv("ENABLE_POSTGRES_BACKEND", "true")
        monkeypatch.setenv("MEMORY_PLANE_POSTGRES_REQUIRED", "true")

        from backend.services.memory_plane import store_pg

        def _explode(*_a, **_kw):
            raise DBUnavailable("postgres down (simulated)")

        monkeypatch.setattr(store_pg, "insert", _explode)

        with pytest.raises(DBUnavailable):
            mp_store.insert(MemoryRecord(
                user_id="u-strict", content="strict write"
            ))

    def test_programmer_errors_still_propagate(
        self, monkeypatch, tmp_memory_plane_db,
    ):
        """Programmer-level errors (missing user_id / empty content)
        must propagate from BOTH backends — falling back to SQLite
        would also raise, so we just propagate immediately. Verifies
        the dispatcher doesn't swallow ValueError."""
        monkeypatch.delenv("DATABASE_URL", raising=False)
        monkeypatch.delenv("ENABLE_POSTGRES_BACKEND", raising=False)
        with pytest.raises(ValueError):
            mp_store.insert(MemoryRecord(user_id="", content="x"))


# ── 3. Engine.is_enabled is non-blocking + lazy ────────────────────────────

class TestEngineNonBlocking:
    """get_sync_pool must NOT block on connection establishment —
    the previous open=True meant the constructor waited on min_size
    real connections, blocking app startup."""

    def test_pool_returns_without_blocking_on_connect(self, monkeypatch):
        monkeypatch.setenv("DATABASE_URL", "postgresql://stub@host/db")
        monkeypatch.setenv("ENABLE_POSTGRES_BACKEND", "true")
        engine._SYNC_POOL = None

        called = {"open_wait": None}

        class _FakePool:
            def __init__(self, **kwargs):
                pass

            def open(self, wait=True):
                # Capture wait= so we can assert non-blocking startup.
                called["open_wait"] = wait

            def close(self):
                pass

        import sys, types
        fake_mod = types.ModuleType("psycopg_pool")
        fake_mod.ConnectionPool = _FakePool
        monkeypatch.setitem(sys.modules, "psycopg_pool", fake_mod)

        engine.get_sync_pool()
        assert called["open_wait"] is False, (
            "pool.open(wait=False) is required so startup doesn't block "
            "on min_size connections"
        )
        engine._SYNC_POOL = None
