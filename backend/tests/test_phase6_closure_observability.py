# coding: utf-8
"""Phase 6 closure — DB observability + memory consolidation tests.

Covers:
  1. metrics.time_query — counters, latency buckets, slow-query trigger
  2. metrics.snapshot — public-safe shape
  3. health probe includes metrics + pool stats
  4. consolidation.consolidate_duplicates — cosine dedup correctness
  5. consolidation.decay_importance — bounded by floor
  6. memory_consolidate CLI parser + arg validation
"""
from __future__ import annotations

import asyncio
import time

import pytest

from backend.services.db import metrics
from backend.services.memory_plane import store as mp_store, consolidation
from backend.services.memory_plane.types import MemoryRecord


# ── Metrics primitives ─────────────────────────────────────────────────────

class TestMetrics:
    def setup_method(self):
        metrics.reset()

    def test_time_query_records_count_and_latency(self):
        with metrics.time_query("test.q"):
            time.sleep(0.005)   # 5ms — comfortably > resolution
        snap = metrics.snapshot()
        assert snap["queries_total"] == 1
        assert snap["queries_failed"] == 0
        labels = {row["label"] for row in snap["by_label_top"]}
        assert "test.q" in labels

    def test_failed_query_increments_fails(self):
        with pytest.raises(RuntimeError):
            with metrics.time_query("test.fail"):
                raise RuntimeError("boom")
        snap = metrics.snapshot()
        assert snap["queries_failed"] == 1
        by = {r["label"]: r for r in snap["by_label_top"]}
        assert by["test.fail"]["fails"] == 1

    def test_slow_query_bumps_slow_counter(self, monkeypatch):
        # metrics._slow_threshold_ms clamps to >=50ms (50ms is the
        # smallest "interesting" slow threshold). Sleep above the
        # floor to trigger the slow-query path.
        monkeypatch.setenv("DB_SLOW_QUERY_MS", "50")
        with metrics.time_query("test.slow"):
            time.sleep(0.060)
        snap = metrics.snapshot()
        assert snap["slow_queries"] >= 1
        assert "test.slow" in snap["last_slow_query"]

    def test_acquire_recorded(self):
        metrics.acquire_recorded(12.5, ok=True)
        metrics.acquire_recorded(50.0, ok=True)
        metrics.acquire_recorded(0.5,  ok=False)
        snap = metrics.snapshot()
        assert snap["acquires_total"] == 2
        assert snap["acquires_failed"] == 1
        assert snap["acquire_avg_ms"] > 0

    def test_snapshot_shape_is_public_safe(self):
        with metrics.time_query("a"): pass
        snap = metrics.snapshot()
        # No internal-looking keys (no underscores, no objects)
        for k in snap:
            assert not k.startswith("_"), f"leaked internal key: {k}"
        # by_label_top is bounded
        assert len(snap["by_label_top"]) <= 8


# ── Health probe includes metrics ──────────────────────────────────────────

class TestHealthEnriched:
    def test_health_includes_metrics_block(self, monkeypatch):
        monkeypatch.delenv("DATABASE_URL", raising=False)
        monkeypatch.delenv("ENABLE_POSTGRES_BACKEND", raising=False)
        from backend.services.db.health import health_check
        out = asyncio.run(health_check())
        assert "metrics" in out
        assert isinstance(out["metrics"], dict)
        assert "queries_total" in out["metrics"]


# ── Consolidation: dedup correctness ──────────────────────────────────────

class TestConsolidateDuplicates:
    def _insert(self, user_id, content, emb, *, importance=0.5, kind="fact"):
        from backend.services.memory_plane import store_sqlite
        return store_sqlite.insert(MemoryRecord(
            user_id=user_id, content=content, kind=kind,
            embedding=emb, importance=importance,
        ))

    def test_dedups_near_identical(self, tmp_memory_plane_db, monkeypatch):
        monkeypatch.delenv("DATABASE_URL", raising=False)
        # Three identical vectors → cluster of size 3
        v = [1.0] + [0.0] * 1535
        self._insert("u1", "first",  v, importance=0.4)
        self._insert("u1", "second", v, importance=0.7)   # ← survivor (highest)
        self._insert("u1", "third",  v, importance=0.5)

        result = consolidation.consolidate_duplicates(
            "u1", similarity_threshold=0.99,
        )
        assert result.scanned == 3
        assert result.deduped == 2
        assert result.survivors == 1

        # Survivor (the highest-importance row) should still be active.
        from backend.services.memory_plane import store_sqlite
        active = store_sqlite.list_for_user("u1", limit=10)
        assert len(active) == 1
        assert active[0].content == "second"
        # Survivor importance was bumped (was 0.7, now slightly higher)
        assert active[0].importance > 0.7

    def test_dissimilar_not_deduped(self, tmp_memory_plane_db, monkeypatch):
        monkeypatch.delenv("DATABASE_URL", raising=False)
        a = [1.0, 0.0, 0.0] + [0.0] * 1533
        b = [0.0, 1.0, 0.0] + [0.0] * 1533
        c = [0.0, 0.0, 1.0] + [0.0] * 1533
        self._insert("u1", "A", a)
        self._insert("u1", "B", b)
        self._insert("u1", "C", c)
        result = consolidation.consolidate_duplicates(
            "u1", similarity_threshold=0.5,
        )
        # All orthogonal → no cluster of size > 1
        assert result.deduped == 0
        assert result.survivors == 0

    def test_cross_user_no_dedup(self, tmp_memory_plane_db, monkeypatch):
        """A user's dedup pass MUST NOT touch another user's rows even
        when embeddings are identical."""
        monkeypatch.delenv("DATABASE_URL", raising=False)
        v = [1.0] + [0.0] * 1535
        self._insert("u1", "u1-only", v)
        self._insert("u2", "u2-only", v)
        self._insert("u2", "u2-dupe", v)
        # u1 runs consolidation. u2's pair must remain untouched.
        consolidation.consolidate_duplicates("u1", similarity_threshold=0.99)
        from backend.services.memory_plane import store_sqlite
        u2_rows = store_sqlite.list_for_user("u2", limit=10)
        assert len(u2_rows) == 2

    def test_idempotent(self, tmp_memory_plane_db, monkeypatch):
        monkeypatch.delenv("DATABASE_URL", raising=False)
        v = [1.0] + [0.0] * 1535
        self._insert("u1", "a", v, importance=0.4)
        self._insert("u1", "b", v, importance=0.6)
        consolidation.consolidate_duplicates("u1", similarity_threshold=0.99)
        # Second run — no surviving duplicates → no-op
        r2 = consolidation.consolidate_duplicates("u1", similarity_threshold=0.99)
        assert r2.deduped == 0


# ── Consolidation: importance decay ───────────────────────────────────────

class TestDecayImportance:
    def test_decay_skips_recent_rows(self, tmp_memory_plane_db, monkeypatch):
        monkeypatch.delenv("DATABASE_URL", raising=False)
        from backend.services.memory_plane import store_sqlite
        rec = store_sqlite.insert(MemoryRecord(
            user_id="u-recent", content="brand new", importance=0.8,
        ))
        # Decay newer-than-1-day rows → no-op since just inserted
        result = consolidation.decay_importance(
            "u-recent", decay_days=1, factor=0.5,
        )
        assert result.decayed == 0
        got = store_sqlite.get(rec.id or "")
        assert got is not None
        assert abs(got.importance - 0.8) < 0.01

    def test_decay_respects_floor(self, tmp_memory_plane_db, monkeypatch):
        monkeypatch.delenv("DATABASE_URL", raising=False)
        from backend.services.memory_plane import store_sqlite
        rec = store_sqlite.insert(MemoryRecord(
            user_id="u-floor", content="low", importance=0.04,
        ))
        # Force the row to look old by hand-rolling created_at.
        # (test-only direct write — simulates an old row)
        from backend.services.memory_plane.store_sqlite import _conn
        with _conn() as c:
            c.execute(
                "UPDATE memory_items SET created_at='2020-01-01T00:00:00+00:00' "
                "WHERE id=?",
                (rec.id,),
            )
        result = consolidation.decay_importance(
            "u-floor", decay_days=30, factor=0.5, floor=0.05,
        )
        # Already below floor → skipped, no UPDATE issued
        assert result.decayed == 0

    def test_decay_rejects_bad_factor(self, tmp_memory_plane_db, monkeypatch):
        monkeypatch.delenv("DATABASE_URL", raising=False)
        result = consolidation.decay_importance(
            "u-x", decay_days=30, factor=1.0,
        )
        assert "factor" in result.reason


# ── CLI parser + validation ───────────────────────────────────────────────

class TestConsolidateCLI:
    def test_requires_target(self):
        from backend.scripts.memory_consolidate import _build_parser
        with pytest.raises(SystemExit):
            _build_parser().parse_args([])

    def test_user_id_alone(self):
        from backend.scripts.memory_consolidate import _build_parser
        ns = _build_parser().parse_args(["--user-id", "u1"])
        assert ns.user_id == "u1"
        assert ns.all_users is False

    def test_all_users_alone(self):
        from backend.scripts.memory_consolidate import _build_parser
        ns = _build_parser().parse_args(["--all-users"])
        assert ns.all_users is True

    def test_mutually_exclusive(self):
        from backend.scripts.memory_consolidate import _build_parser
        with pytest.raises(SystemExit):
            _build_parser().parse_args(["--user-id", "u1", "--all-users"])

    def test_rejects_bad_similarity(self, monkeypatch):
        from backend.scripts import memory_consolidate
        rc = memory_consolidate.main(
            ["--user-id", "u1", "--similarity", "2.5"]
        )
        assert rc == 1

    def test_rejects_bad_decay_factor(self):
        from backend.scripts import memory_consolidate
        rc = memory_consolidate.main(
            ["--user-id", "u1", "--decay-factor", "1.5"]
        )
        assert rc == 1

    def test_no_users_returns_2(self, monkeypatch):
        # No memory rows exist + --all-users → exit code 2
        monkeypatch.delenv("DATABASE_URL", raising=False)
        monkeypatch.delenv("ENABLE_POSTGRES_BACKEND", raising=False)
        # Point to a fresh empty SQLite
        import tempfile
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tf:
            monkeypatch.setenv("MEMORY_PLANE_DB_PATH", tf.name)
        from backend.services.memory_plane import store
        store._reset_for_tests()
        from backend.scripts import memory_consolidate
        rc = memory_consolidate.main(["--all-users"])
        assert rc == 2
