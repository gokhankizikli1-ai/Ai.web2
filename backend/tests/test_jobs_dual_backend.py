# coding: utf-8
"""Phase 2 (shared jobs) — dual-backend dispatcher + Postgres SQL-contract.

Verifies:
  * the dispatcher routes to store_sqlite / store_pg by env, exactly like
    the billing + memory_plane dual-backend stores;
  * SQLite is the fallback when Postgres is disabled or DATABASE_URL is
    missing;
  * FAIL-CLOSED — when Postgres is the SELECTED backend but transiently
    unavailable, operations RAISE rather than silently forking onto a
    per-replica SQLite file (no split-brain);
  * the Postgres backend's SQL contract (atomic ON CONFLICT idempotency,
    stale-worker resurrection guard, bump_max_attempts) via a mocked
    `engine.acquire_sync()` — NO live Postgres in this environment.

CODE-VERIFIED (mocked connection). NOT LIVE-POSTGRES verified — the real
data path is exercised on Railway per the PR notes.
"""
from __future__ import annotations

import contextlib

import pytest

from backend.services.jobs import store as jobs_store
from backend.services.jobs import store_sqlite, store_pg
from backend.services.jobs.errors import JobIdempotencyConflict
from backend.services.jobs.types import JobRecord, STATUS_RUNNING


# ── Dispatcher routing ─────────────────────────────────────────────────────

class TestDispatcher:
    def test_defaults_to_sqlite(self, monkeypatch, tmp_jobs_db):
        monkeypatch.delenv("DATABASE_URL", raising=False)
        monkeypatch.delenv("ENABLE_POSTGRES_BACKEND", raising=False)
        assert jobs_store.current_backend() == "sqlite"
        assert jobs_store._backend() is store_sqlite

    def test_picks_postgres_when_both_env_vars_set(self, monkeypatch):
        monkeypatch.setenv("DATABASE_URL", "postgresql://stub@host/db")
        monkeypatch.setenv("ENABLE_POSTGRES_BACKEND", "true")
        assert jobs_store.current_backend() == "postgres"
        assert jobs_store._backend() is store_pg

    def test_flag_off_overrides_url(self, monkeypatch):
        # An operator can disable Postgres without unsetting DATABASE_URL.
        monkeypatch.setenv("DATABASE_URL", "postgresql://stub@host/db")
        monkeypatch.setenv("ENABLE_POSTGRES_BACKEND", "false")
        assert jobs_store.current_backend() == "sqlite"
        assert jobs_store._backend() is store_sqlite

    def test_missing_database_url_falls_back_to_sqlite(self, monkeypatch):
        # Flag on but no URL → Postgres is NOT enabled → SQLite (dev default).
        monkeypatch.setenv("ENABLE_POSTGRES_BACKEND", "true")
        monkeypatch.delenv("DATABASE_URL", raising=False)
        assert jobs_store.current_backend() == "sqlite"
        assert jobs_store._backend() is store_sqlite

    def test_public_surface_matches_sqlite(self):
        """Every public function the SQLite store exposes must also be
        callable through the dispatcher (parity — otherwise a caller
        breaks the moment we flip the flag)."""
        sqlite_public = {n for n in store_sqlite.__all__ if not n.startswith("_")}
        dispatcher_public = {n for n in jobs_store.__all__ if not n.startswith("_")}
        missing = sqlite_public - dispatcher_public
        assert not missing, f"dispatcher missing: {missing}"

    def test_public_surface_matches_pg(self):
        pg_public = {n for n in store_pg.__all__ if not n.startswith("_")}
        dispatcher_public = {n for n in jobs_store.__all__ if not n.startswith("_")}
        missing = pg_public - dispatcher_public
        assert not missing, f"dispatcher missing: {missing}"

    def test_stats_reports_active_backend(self, monkeypatch, tmp_jobs_db):
        monkeypatch.delenv("DATABASE_URL", raising=False)
        monkeypatch.delenv("ENABLE_POSTGRES_BACKEND", raising=False)
        s = jobs_store.store_stats()
        assert s["backend"] == "sqlite"


# ── SQLite fallback round-trip through the dispatcher ──────────────────────

class TestSqliteFallbackRoundTrip:
    def test_insert_get_through_dispatcher(self, monkeypatch, tmp_jobs_db):
        monkeypatch.delenv("DATABASE_URL", raising=False)
        rec = jobs_store.insert(JobRecord(kind="echo", user_id="u-disp"))
        assert rec.id is not None
        got = jobs_store.get(rec.id)
        assert got is not None and got.user_id == "u-disp"

    def test_progress_result_update_through_dispatcher(self, monkeypatch, tmp_jobs_db):
        monkeypatch.delenv("DATABASE_URL", raising=False)
        rec = jobs_store.insert(JobRecord(kind="echo", user_id="u-disp"))
        jobs_store.update(rec.id, status=STATUS_RUNNING, progress=40)
        jobs_store.update(rec.id, status="succeeded", result={"ok": True})
        got = jobs_store.get(rec.id)
        assert got.status == "succeeded"
        assert got.result == {"ok": True}


# ── FAIL-CLOSED (no split-brain) ───────────────────────────────────────────

class TestFailClosed:
    def test_pg_unavailable_raises_not_silent_sqlite(self, monkeypatch):
        """When Postgres is the SELECTED backend but the pool can't
        connect, the dispatcher must RAISE — never silently fork onto a
        local SQLite file (that would split the shared job truth)."""
        from backend.services.db import engine
        from backend.services.db.errors import DBUnavailable
        monkeypatch.setenv("DATABASE_URL", "postgresql://stub@host/db")
        monkeypatch.setenv("ENABLE_POSTGRES_BACKEND", "true")
        store_pg._reset_for_tests()

        @contextlib.contextmanager
        def _boom():
            raise DBUnavailable("connect failed")
            yield  # pragma: no cover

        monkeypatch.setattr(engine, "acquire_sync", _boom)
        # Selected backend is Postgres…
        assert jobs_store._backend() is store_pg
        # …and a transient outage propagates rather than falling back.
        with pytest.raises(DBUnavailable):
            jobs_store.get("any-id")


# ── Postgres SQL contract (mocked connection) ──────────────────────────────

class _FakeCursor:
    def __init__(self, conn):
        self.conn = conn

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, sql, params=()):
        self.conn.calls.append((sql, tuple(params)))

    def fetchone(self):
        return self.conn.fetchone_result

    def fetchall(self):
        return self.conn.fetchall_result

    @property
    def rowcount(self):
        return self.conn.rowcount


class _FakeConn:
    def __init__(self):
        self.calls = []
        self.fetchone_result = None
        self.fetchall_result = []
        self.rowcount = 1

    def cursor(self, **kw):
        return _FakeCursor(self)

    def commit(self):
        pass


def _bind_fake_conn(monkeypatch, conn):
    from backend.services.db import engine

    @contextlib.contextmanager
    def _acq():
        yield conn

    monkeypatch.setattr(engine, "acquire_sync", _acq)
    # Skip the CREATE-schema round-trip; we assert on the data-path SQL only.
    monkeypatch.setattr(store_pg, "_INITIALIZED", True, raising=False)


def _full_row(**overrides) -> dict:
    row = {
        "id": "job-1", "kind": "echo", "user_id": "u1",
        "project_id": None, "agent_id": None, "status": "running",
        "payload_json": "{}", "result_json": None, "error_json": None,
        "progress": 0, "progress_label": None, "idempotency_key": None,
        "attempts": 0, "max_attempts": 1, "timeout_s": None,
        "metadata_json": "{}", "created_at": "2026-01-01T00:00:00+00:00",
        "queued_at": "2026-01-01T00:00:00+00:00", "started_at": None,
        "finished_at": None, "cancelled_at": None,
        "updated_at": "2026-01-01T00:00:00+00:00",
    }
    row.update(overrides)
    return row


class TestPostgresSqlContract:
    def test_insert_uses_atomic_on_conflict(self, monkeypatch):
        conn = _FakeConn()
        conn.fetchone_result = {"id": "job-1"}  # RETURNING id → row present
        _bind_fake_conn(monkeypatch, conn)

        rec = store_pg.insert(JobRecord(kind="echo", user_id="u1",
                                        idempotency_key="k1"))
        assert rec.id is not None
        sql, params = conn.calls[-1]
        assert "INSERT INTO jobs" in sql
        assert "ON CONFLICT" in sql
        assert "idempotency_key IS NOT NULL" in sql
        assert "DO NOTHING" in sql
        assert "RETURNING id" in sql
        # 19 columns bound.
        assert len(params) == 19
        assert "k1" in params  # idempotency_key carried into the write

    def test_insert_conflict_raises(self, monkeypatch):
        conn = _FakeConn()
        conn.fetchone_result = None  # ON CONFLICT DO NOTHING → no row returned
        _bind_fake_conn(monkeypatch, conn)
        with pytest.raises(JobIdempotencyConflict):
            store_pg.insert(JobRecord(kind="echo", user_id="u1",
                                      idempotency_key="dup"))

    def test_update_to_running_carries_resurrection_guard(self, monkeypatch):
        conn = _FakeConn()
        conn.fetchone_result = _full_row(status="running")
        _bind_fake_conn(monkeypatch, conn)
        store_pg.update("job-1", status="running")
        update_sql = next(s for s, _ in conn.calls if s.startswith("UPDATE jobs SET"))
        assert "status NOT IN" in update_sql  # terminal→running blocked

    def test_update_to_terminal_has_no_guard(self, monkeypatch):
        conn = _FakeConn()
        conn.fetchone_result = _full_row(status="succeeded")
        _bind_fake_conn(monkeypatch, conn)
        store_pg.update("job-1", status="succeeded", result={"ok": True})
        update_sql = next(s for s, _ in conn.calls if s.startswith("UPDATE jobs SET"))
        assert "status NOT IN" not in update_sql

    def test_bump_max_attempts_sql(self, monkeypatch):
        conn = _FakeConn()
        _bind_fake_conn(monkeypatch, conn)
        assert store_pg.bump_max_attempts("job-1", 5) is True
        sql, params = conn.calls[-1]
        assert "UPDATE jobs SET max_attempts=" in sql
        assert 5 in params
        assert "job-1" in params

    def test_get_by_idempotency_key_sql(self, monkeypatch):
        conn = _FakeConn()
        conn.fetchone_result = _full_row(idempotency_key="k1")
        _bind_fake_conn(monkeypatch, conn)
        got = store_pg.get_by_idempotency_key(user_id="u1", kind="echo",
                                              idempotency_key="k1")
        assert got is not None and got.idempotency_key == "k1"
        sql, params = conn.calls[-1]
        assert "WHERE user_id=%s AND kind=%s AND idempotency_key=%s" in sql
        assert params == ("u1", "echo", "k1")
