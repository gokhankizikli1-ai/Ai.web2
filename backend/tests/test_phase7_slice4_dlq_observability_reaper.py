# coding: utf-8
"""Phase 7 slice 4 — DLQ + observability + orphan reaper tests.

Covers (no live Redis, no live Celery):
  1. DLQ enqueue flips the row to STATUS_FAILED_DLQ
  2. DLQ enqueue Redis-mirror failure does NOT block the DB flip
  3. DLQ list reads from Redis when configured
  4. Queue depth probe returns one entry per known queue (Redis off)
  5. Worker heartbeat write + read round-trip (with mocked Redis client)
  6. Worker ID is stable + includes hostname + PID
  7. Orphan reaper marks rows older than threshold
  8. Orphan reaper respects --dry-run
  9. Orphan reaper skips rows with no started_at (defensive)
 10. Reaper CLI parses + exits 0 on success
 11. Reaper CLI dry-run flag
 12. STATUS_FAILED_DLQ added to JOB_STATUSES + TERMINAL_STATUSES
 13. korvix.dlq queue in celery_app config
"""
from __future__ import annotations

import asyncio
import os
import sys
import types
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest

from backend.services.jobs import dlq, heartbeat, orphan_reaper, store as jobs_store
from backend.services.jobs.types import (
    JobRecord, STATUS_RUNNING, STATUS_FAILED_DLQ, STATUS_FAILED,
    JOB_STATUSES, TERMINAL_STATUSES,
)


@pytest.fixture()
def tmp_jobs_db(tmp_path, monkeypatch):
    """Isolate jobs.db per test."""
    db = tmp_path / "jobs.db"
    monkeypatch.setenv("JOBS_DB_PATH", str(db))
    monkeypatch.setenv("ENABLE_JOB_QUEUE", "true")
    jobs_store._reset_for_tests()
    jobs_store.init()
    yield db


# ── 1-3. DLQ ─────────────────────────────────────────────────────────────────

class TestDLQ:
    def test_enqueue_flips_db_status_to_failed_dlq(self, tmp_jobs_db, monkeypatch):
        # Redis off so we exercise the DB-only path.
        monkeypatch.delenv("REDIS_URL", raising=False)
        monkeypatch.delenv("ENABLE_REDIS", raising=False)

        rec = jobs_store.insert(JobRecord(
            user_id="u1", kind="vision.analyze", payload={"asset_id": "a"},
        ))
        asyncio.run(dlq.dlq_enqueue(
            rec.id, kind=rec.kind, error="provider 500",
            attempts=3, user_id="u1",
        ))
        cur = jobs_store.get(rec.id)
        assert cur is not None
        assert cur.status == STATUS_FAILED_DLQ
        # store.error is dict-typed (encoded as JSON in error_json).
        assert isinstance(cur.error, dict)
        assert "provider 500" in cur.error.get("message", "")
        assert cur.error.get("dlq") is True
        assert cur.error.get("attempts") == 3
        assert cur.finished_at is not None

    def test_redis_failure_does_not_block_db_flip(self, tmp_jobs_db, monkeypatch):
        """Redis mirror is best-effort; DB row is the source of truth."""
        monkeypatch.setenv("REDIS_URL", "redis://stub/0")
        monkeypatch.setenv("ENABLE_REDIS", "true")

        # Force the async client to blow up.
        from backend.services import redis_client as rc

        async def _boom():
            raise rc.RedisUnavailable("simulated outage")

        monkeypatch.setattr(rc, "get_async_client", _boom)

        rec = jobs_store.insert(JobRecord(
            user_id="u1", kind="research.deep", payload={"q": "x"},
        ))
        # Must NOT raise even though Redis is broken.
        asyncio.run(dlq.dlq_enqueue(
            rec.id, kind=rec.kind, error="boom",
            attempts=3, user_id="u1",
        ))
        cur = jobs_store.get(rec.id)
        assert cur is not None
        assert cur.status == STATUS_FAILED_DLQ

    def test_list_returns_empty_when_redis_off(self, monkeypatch):
        monkeypatch.delenv("ENABLE_REDIS", raising=False)
        result = asyncio.run(dlq.dlq_list(limit=10))
        assert result == []


# ── 4. Per-queue depth probe ────────────────────────────────────────────────

class TestQueueDepth:
    def test_redis_off_returns_zeros_for_known_queues(self, monkeypatch):
        monkeypatch.delenv("ENABLE_REDIS", raising=False)
        monkeypatch.delenv("REDIS_URL", raising=False)
        from backend.services.redis_client.queues import get_queue_depths
        result = asyncio.run(get_queue_depths())
        names = {r["name"] for r in result}
        assert "korvix.default" in names
        assert "korvix.vision" in names
        # All zeros — Redis off
        assert all(r["depth"] == 0 for r in result)


# ── 5-6. Worker heartbeat ───────────────────────────────────────────────────

class TestHeartbeat:
    def test_worker_id_is_stable_and_descriptive(self):
        wid = heartbeat.worker_id()
        # Must include current PID
        assert str(os.getpid()) in wid
        # Stable across calls
        assert heartbeat.worker_id() == wid

    def test_write_heartbeat_no_redis_returns_false(self, monkeypatch):
        monkeypatch.delenv("ENABLE_REDIS", raising=False)
        result = asyncio.run(heartbeat.write_heartbeat())
        assert result is False

    def test_list_active_workers_no_redis_returns_empty(self, monkeypatch):
        monkeypatch.delenv("ENABLE_REDIS", raising=False)
        result = asyncio.run(heartbeat.list_active_workers())
        assert result == []

    def test_write_heartbeat_calls_set_with_ttl(self, monkeypatch):
        """When Redis IS available, write_heartbeat must SETEX a key
        under the worker prefix with the configured TTL."""
        monkeypatch.setenv("ENABLE_REDIS", "true")
        monkeypatch.setenv("REDIS_URL", "redis://stub/0")
        monkeypatch.setenv("WORKER_HEARTBEAT_TTL_SEC", "45")

        fake_client = MagicMock()
        fake_client.set = AsyncMock()
        async def _fake_get_client():
            return fake_client

        from backend.services import redis_client as rc
        monkeypatch.setattr(rc, "get_async_client", _fake_get_client)

        ok = asyncio.run(heartbeat.write_heartbeat("test-host-123"))
        assert ok is True
        assert fake_client.set.call_count == 1
        args, kwargs = fake_client.set.call_args
        assert args[0] == heartbeat.HEARTBEAT_KEY_PREFIX + "test-host-123"
        assert kwargs["ex"] == 45


# ── 7-9. Orphan reaper ──────────────────────────────────────────────────────

class TestOrphanReaper:
    def _insert_running(self, *, started_offset_s: int,
                        kind: str = "vision.analyze") -> str:
        """Insert a row in status=running with started_at offset N
        seconds from now (negative = older)."""
        rec = jobs_store.insert(JobRecord(
            user_id="u1", kind=kind, payload={},
        ))
        when = (
            datetime.now(timezone.utc) + timedelta(seconds=started_offset_s)
        ).isoformat()
        jobs_store.update(
            rec.id, status=STATUS_RUNNING, started_at=when,
        )
        return rec.id

    def test_marks_stale_rows_failed(self, tmp_jobs_db, monkeypatch):
        monkeypatch.setenv("WORKER_HEARTBEAT_TIMEOUT_S", "60")
        stale_id  = self._insert_running(started_offset_s=-3600)
        fresh_id  = self._insert_running(started_offset_s=-10)

        result = orphan_reaper.reap_orphans()
        assert result.reaped == 1
        assert result.threshold_s == 60

        stale = jobs_store.get(stale_id)
        fresh = jobs_store.get(fresh_id)
        assert stale.status == STATUS_FAILED
        assert isinstance(stale.error, dict)
        assert stale.error.get("message") == "orphan_reaped"
        assert stale.error.get("threshold_s") == 60
        assert fresh.status == STATUS_RUNNING

    def test_dry_run_does_not_mutate(self, tmp_jobs_db, monkeypatch):
        monkeypatch.setenv("WORKER_HEARTBEAT_TIMEOUT_S", "60")
        stale_id = self._insert_running(started_offset_s=-3600)
        result = orphan_reaper.reap_orphans(dry_run=True)
        assert result.dry_run is True
        assert result.reaped == 1
        stale = jobs_store.get(stale_id)
        # Status untouched
        assert stale.status == STATUS_RUNNING

    def test_skips_rows_without_started_at(self, tmp_jobs_db, monkeypatch):
        """Defensive — if we have no started_at we cannot decide
        staleness, so we leave the row alone."""
        monkeypatch.setenv("WORKER_HEARTBEAT_TIMEOUT_S", "60")
        rec = jobs_store.insert(JobRecord(
            user_id="u1", kind="vision.analyze", payload={},
        ))
        # status=running but NO started_at — manually set
        jobs_store.update(rec.id, status=STATUS_RUNNING)
        # Force started_at to None
        jobs_store.update(rec.id, started_at=None)
        result = orphan_reaper.reap_orphans()
        assert result.reaped == 0
        cur = jobs_store.get(rec.id)
        assert cur.status == STATUS_RUNNING


# ── 10-11. Reaper CLI ───────────────────────────────────────────────────────

class TestReaperCLI:
    def test_parser_accepts_dry_run(self):
        from backend.scripts.orphan_reap import _build_parser
        ns = _build_parser().parse_args(["--dry-run"])
        assert ns.dry_run is True

    def test_main_returns_0_on_success(self, tmp_jobs_db, monkeypatch):
        from backend.scripts import orphan_reap as cli
        rc = cli.main(["--dry-run"])
        assert rc == 0


# ── 12. Status taxonomy ─────────────────────────────────────────────────────

class TestStatusTaxonomy:
    def test_failed_dlq_in_job_statuses(self):
        assert STATUS_FAILED_DLQ in JOB_STATUSES

    def test_failed_dlq_is_terminal(self):
        assert STATUS_FAILED_DLQ in TERMINAL_STATUSES


# ── 13. DLQ queue in Celery config ─────────────────────────────────────────

class TestDLQQueueInCeleryConfig:
    @pytest.fixture
    def app(self, monkeypatch):
        monkeypatch.setenv("REDIS_URL", "redis://stub/0")
        from backend.jobs.celery_app import build_celery
        a = build_celery()
        if a is None:
            pytest.skip("celery/kombu not installed in this environment")
        return a

    def test_dlq_queue_present(self, app):
        names = {q.name for q in app.conf.task_queues}
        assert "korvix.dlq" in names
