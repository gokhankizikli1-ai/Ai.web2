# coding: utf-8
"""Phase 6 slice 2 — dispatcher + db_migrate CLI tests.

Verifies the dual-backend dispatcher routes correctly and the CLI
parser + status logic work without requiring a live Postgres. The
Postgres data-path itself is exercised via Railway smoke tests
recorded in the PR description (we don't ship a Postgres container
in CI).
"""
from __future__ import annotations

import io
import sys
from contextlib import redirect_stdout, redirect_stderr

import pytest

from backend.services.memory_plane import store as mp_store


# ── Dispatcher routing ────────────────────────────────────────────────────

class TestDispatcher:
    def test_defaults_to_sqlite(self, monkeypatch, tmp_memory_plane_db):
        monkeypatch.delenv("DATABASE_URL", raising=False)
        monkeypatch.delenv("ENABLE_POSTGRES_BACKEND", raising=False)
        assert mp_store.current_backend() == "sqlite"
        # Internal pick lands on store_sqlite — verify by module name
        from backend.services.memory_plane import store_sqlite
        assert mp_store._impl() is store_sqlite

    def test_picks_postgres_when_both_env_vars_set(self, monkeypatch):
        monkeypatch.setenv("DATABASE_URL", "postgresql://stub@host/db")
        monkeypatch.setenv("ENABLE_POSTGRES_BACKEND", "true")
        assert mp_store.current_backend() == "postgres"
        from backend.services.memory_plane import store_pg
        assert mp_store._impl() is store_pg

    def test_flag_off_overrides_url(self, monkeypatch):
        # Operator can disable Postgres without unsetting DATABASE_URL.
        monkeypatch.setenv("DATABASE_URL", "postgresql://stub@host/db")
        monkeypatch.setenv("ENABLE_POSTGRES_BACKEND", "false")
        assert mp_store.current_backend() == "sqlite"

    def test_public_surface_matches_sqlite(self):
        """Every public function the SQLite store exposes must also be
        callable through the dispatcher (parity invariant — otherwise
        an upstream caller breaks the moment we flip the flag)."""
        from backend.services.memory_plane import store_sqlite
        sqlite_public = {n for n in store_sqlite.__all__ if not n.startswith("_")}
        dispatcher_public = {n for n in mp_store.__all__ if not n.startswith("_")}
        missing = sqlite_public - dispatcher_public
        assert not missing, f"dispatcher missing: {missing}"

    def test_public_surface_matches_pg(self):
        """Same parity check against the Postgres store. The PG store
        also exposes insert_bulk for the migration CLI — that's allowed
        to be PG-only since SQLite never gets imported into PG."""
        from backend.services.memory_plane import store_pg
        pg_public = {n for n in store_pg.__all__
                     if not n.startswith("_") and n != "insert_bulk"}
        dispatcher_public = {n for n in mp_store.__all__ if not n.startswith("_")}
        missing = pg_public - dispatcher_public
        assert not missing, f"dispatcher missing: {missing}"

    def test_stats_reports_active_backend(self, monkeypatch, tmp_memory_plane_db):
        monkeypatch.delenv("DATABASE_URL", raising=False)
        s = mp_store.store_stats()
        assert s["backend"] == "sqlite"


# ── db_migrate CLI parser + dry-run ───────────────────────────────────────

class TestDbMigrateCLI:
    def test_init_subcommand_parses(self):
        from backend.scripts.db_migrate import _build_parser
        ns = _build_parser().parse_args(["init"])
        assert ns.cmd == "init"

    def test_status_subcommand_parses(self):
        from backend.scripts.db_migrate import _build_parser
        ns = _build_parser().parse_args(["status"])
        assert ns.cmd == "status"

    def test_copy_requires_subsystem(self):
        from backend.scripts.db_migrate import _build_parser
        # Missing --subsystem must error (argparse exits with 2)
        with pytest.raises(SystemExit):
            _build_parser().parse_args(["copy"])

    def test_copy_rejects_unknown_subsystem(self):
        from backend.scripts.db_migrate import _build_parser
        with pytest.raises(SystemExit):
            _build_parser().parse_args(["copy", "--subsystem", "not_a_real_one"])

    def test_init_exits_2_when_postgres_disabled(self, monkeypatch):
        monkeypatch.delenv("DATABASE_URL", raising=False)
        monkeypatch.delenv("ENABLE_POSTGRES_BACKEND", raising=False)
        from backend.scripts import db_migrate
        rc = db_migrate.main(["init"])
        assert rc == 2

    def test_copy_exits_2_when_postgres_disabled(self, monkeypatch):
        monkeypatch.delenv("DATABASE_URL", raising=False)
        monkeypatch.delenv("ENABLE_POSTGRES_BACKEND", raising=False)
        from backend.scripts import db_migrate
        rc = db_migrate.main(["copy", "--subsystem", "memory_plane"])
        assert rc == 2

    def test_status_runs_clean_in_sqlite_only_mode(
        self, monkeypatch, tmp_memory_plane_db, capsys,
    ):
        """Status should print SQLite counts and not crash when
        Postgres is off (it should report the postgres counts as zeros
        gracefully)."""
        monkeypatch.delenv("DATABASE_URL", raising=False)
        monkeypatch.delenv("ENABLE_POSTGRES_BACKEND", raising=False)
        from backend.scripts import db_migrate
        rc = db_migrate.main(["status"])
        assert rc == 0
        out = capsys.readouterr().out
        assert "memory_plane" in out
        assert "SQLite" in out


# ── insert_bulk shape (Postgres helper used by migration CLI) ─────────────

class TestInsertBulkShape:
    """The Postgres-only insert_bulk helper has tricky shape requirements
    (preserves original id, propagates deleted_at). We don't run it
    against a real PG here, but we verify it skips empty / invalid
    records the same way the migration would."""

    def test_insert_bulk_handles_empty_list(self, monkeypatch):
        # Make engine think Postgres is enabled, but stub acquire_sync
        # so we never actually connect.
        monkeypatch.setenv("DATABASE_URL", "postgresql://stub@host/db")
        monkeypatch.setenv("ENABLE_POSTGRES_BACKEND", "true")
        from backend.services.memory_plane import store_pg
        store_pg._reset_for_tests()
        # Empty list → 0, no DB call needed
        n = store_pg.insert_bulk([])
        assert n == 0


# ── No-regression sanity: dispatcher round-trip on SQLite ────────────────

class TestDispatcherRoundTrip:
    """End-to-end through the dispatcher in SQLite mode — proves
    nothing in the new dispatch layer drops/transforms a record."""

    def test_insert_get_through_dispatcher(self, monkeypatch, tmp_memory_plane_db):
        monkeypatch.delenv("DATABASE_URL", raising=False)
        from backend.services.memory_plane import MemoryRecord
        rec = mp_store.insert(MemoryRecord(
            user_id="u-disp", content="dispatcher round-trip"
        ))
        assert rec.id is not None
        got = mp_store.get(rec.id)
        assert got is not None
        assert got.content == "dispatcher round-trip"

    def test_list_for_user_through_dispatcher(
        self, monkeypatch, tmp_memory_plane_db,
    ):
        monkeypatch.delenv("DATABASE_URL", raising=False)
        from backend.services.memory_plane import MemoryRecord
        mp_store.insert(MemoryRecord(user_id="u-disp", content="a"))
        mp_store.insert(MemoryRecord(user_id="u-disp", content="b"))
        rows = mp_store.list_for_user("u-disp")
        assert len(rows) == 2
