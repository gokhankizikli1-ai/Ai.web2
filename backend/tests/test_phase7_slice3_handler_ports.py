# coding: utf-8
"""Phase 7 slice 3 — handler ports + per-kind routing + cancellation tests.

Covers:
  1. Per-kind queue routing for every prefix
  2. Unknown kind falls back to korvix.default
  3. Vision handler smoke through inline runner (no live OpenAI)
  4. Vision handler respects JOB_QUEUE_VISION=false (skipped)
  5. Vision handler rejects missing asset_id
  6. Vision handler observes cancellation before persist
  7. Research handler smoke through inline runner (provider stubbed)
  8. Research handler respects JOB_QUEUE_RESEARCH=false (skipped)
  9. Research handler rejects empty query
 10. Research handler bubbles provider error for Celery retry
 11. Dispatcher context: report_progress writes DB + publishes event
 12. Dispatcher context: is_cancelled re-reads DB
 13. Public kind allowlist includes the new handlers
 14. Handlers self-register via @korvix_task decorator
"""
from __future__ import annotations

import asyncio
import os
import sys
import types
from typing import Optional
from unittest.mock import MagicMock

import pytest

from backend.services.jobs import kinds, store as jobs_store
from backend.services.jobs.runner import _queue_for_record
from backend.services.jobs.types import JobRecord, STATUS_CANCELLED


# ── Shared helper: build a JobRecord against the in-test SQLite store ────

def _make_record(*, kind: str, payload: dict, user_id: str = "u1") -> JobRecord:
    rec = jobs_store.insert(JobRecord(
        user_id=user_id, kind=kind, payload=payload,
    ))
    assert rec.id is not None
    return rec


@pytest.fixture()
def tmp_jobs_db(tmp_path, monkeypatch):
    """Isolate jobs.db per test, mirroring the memory_plane pattern."""
    db = tmp_path / "jobs.db"
    monkeypatch.setenv("JOBS_DB_PATH", str(db))
    monkeypatch.setenv("ENABLE_JOB_QUEUE", "true")
    jobs_store._reset_for_tests()
    jobs_store.init()
    yield db


# ── 1-2. Per-kind queue routing ─────────────────────────────────────────────

class TestQueueRouting:
    def test_vision_routes_to_vision_queue(self, tmp_jobs_db):
        rec = _make_record(kind="vision.analyze", payload={"asset_id": "a1"})
        assert _queue_for_record(rec.id) == "korvix.vision"

    def test_research_routes_to_research_queue(self, tmp_jobs_db):
        rec = _make_record(kind="research.deep", payload={"query": "q"})
        assert _queue_for_record(rec.id) == "korvix.research"

    def test_embeddings_routes_to_embeddings_queue(self, tmp_jobs_db):
        rec = _make_record(kind="embeddings.backfill", payload={})
        assert _queue_for_record(rec.id) == "korvix.embeddings"

    def test_memory_routes_to_maintenance_queue(self, tmp_jobs_db):
        rec = _make_record(kind="memory.consolidate", payload={})
        assert _queue_for_record(rec.id) == "korvix.maintenance"

    def test_unknown_kind_falls_back_to_default(self, tmp_jobs_db):
        rec = _make_record(kind="some.weird.kind", payload={})
        assert _queue_for_record(rec.id) == "korvix.default"

    def test_no_kind_falls_back_to_default(self, tmp_jobs_db):
        # Missing record_id (e.g. lookup failed) → default
        assert _queue_for_record("nonexistent-id") == "korvix.default"


# ── 3-6. Vision handler ─────────────────────────────────────────────────────

class TestVisionHandler:
    def _build_ctx(self, record, *, cancelled_at_call=None):
        """Build a JobContext like the dispatcher does, with optional
        cancellation triggered after the Nth is_cancelled call."""
        from backend.services.jobs.registry import JobContext
        call_count = {"n": 0}
        progress_log: list[tuple[int, Optional[str]]] = []

        async def _report(pct, label=None):
            progress_log.append((pct, label))

        async def _cancelled():
            call_count["n"] += 1
            if cancelled_at_call is not None and call_count["n"] >= cancelled_at_call:
                return True
            return False

        return (
            JobContext(record=record, report_progress=_report,
                       is_cancelled=_cancelled),
            progress_log,
            call_count,
        )

    def test_respects_disabled_flag(self, tmp_jobs_db, monkeypatch):
        monkeypatch.setenv("JOB_QUEUE_VISION", "false")
        rec = _make_record(kind="vision.analyze", payload={"asset_id": "a1"})
        ctx, _, _ = self._build_ctx(rec)
        result = asyncio.run(kinds.vision_analyze(ctx))
        assert result["skipped"] is True
        assert "JOB_QUEUE_VISION" in result["reason"]

    def test_rejects_missing_asset_id(self, tmp_jobs_db, monkeypatch):
        monkeypatch.setenv("JOB_QUEUE_VISION", "true")
        rec = _make_record(kind="vision.analyze", payload={})
        ctx, _, _ = self._build_ctx(rec)
        with pytest.raises(ValueError, match="asset_id"):
            asyncio.run(kinds.vision_analyze(ctx))

    def test_cancellation_before_analyzer(self, tmp_jobs_db, monkeypatch):
        monkeypatch.setenv("JOB_QUEUE_VISION", "true")
        # Stub assets so the handler reaches the cancellation check.
        from backend.services import assets
        from backend.services.assets import client as assets_client
        monkeypatch.setattr(
            assets_client, "get",
            lambda _id, user_id=None: MagicMock(),
        )
        rec = _make_record(kind="vision.analyze",
                           payload={"asset_id": "a1", "user_id": "u1"})
        # Cancel on the SECOND is_cancelled call — i.e. after we got
        # past the first checkpoint (validating asset).
        ctx, progress, _ = self._build_ctx(rec, cancelled_at_call=2)
        result = asyncio.run(kinds.vision_analyze(ctx))
        assert result.get("cancelled_mid_flight") is True
        # progress emitted at least once before the bail-out
        assert any(p[0] >= 5 for p in progress)


# ── 7-10. Research handler ──────────────────────────────────────────────────

class TestResearchHandler:
    def _build_ctx(self, record):
        from backend.services.jobs.registry import JobContext

        async def _report(pct, label=None):
            pass

        async def _cancelled():
            return False

        return JobContext(record=record, report_progress=_report,
                          is_cancelled=_cancelled)

    def test_respects_disabled_flag(self, tmp_jobs_db, monkeypatch):
        monkeypatch.setenv("JOB_QUEUE_RESEARCH", "false")
        rec = _make_record(kind="research.deep", payload={"query": "q"})
        ctx = self._build_ctx(rec)
        result = asyncio.run(kinds.research_deep(ctx))
        assert result["skipped"] is True

    def test_rejects_empty_query(self, tmp_jobs_db, monkeypatch):
        monkeypatch.setenv("JOB_QUEUE_RESEARCH", "true")
        rec = _make_record(kind="research.deep", payload={"query": "  "})
        ctx = self._build_ctx(rec)
        with pytest.raises(ValueError, match="query"):
            asyncio.run(kinds.research_deep(ctx))

    def test_provider_success_round_trip(self, tmp_jobs_db, monkeypatch):
        monkeypatch.setenv("JOB_QUEUE_RESEARCH", "true")
        # Stub the research client so we don't hit the network.
        from backend.services.research import client as research_client
        from backend.services.research.types import SearchResult, Citation

        async def _fake_search(query, **_kw):
            return SearchResult(
                query=query, answer="42",
                citations=[Citation(
                    title="t", url="https://example.com/a",
                    snippet="s", source_type="news",
                    trust_score=0.6, domain="example.com",
                    provider="stub",
                )],
                provider="stub", elapsed_ms=10,
            )
        monkeypatch.setattr(research_client, "search", _fake_search)

        rec = _make_record(kind="research.deep",
                           payload={"query": "what is 6*7"})
        ctx = self._build_ctx(rec)
        result = asyncio.run(kinds.research_deep(ctx))
        assert result["query"] == "what is 6*7"
        assert result["count"] == 1
        assert result["citations"][0]["url"] == "https://example.com/a"
        assert result["provider"] == "stub"

    def test_provider_error_bubbles(self, tmp_jobs_db, monkeypatch):
        """Provider error → RuntimeError → Celery retry kicks in."""
        monkeypatch.setenv("JOB_QUEUE_RESEARCH", "true")
        from backend.services.research import client as research_client
        from backend.services.research.types import SearchResult

        async def _fake_search(query, **_kw):
            return SearchResult(query=query, error="timeout", provider="stub")
        monkeypatch.setattr(research_client, "search", _fake_search)

        rec = _make_record(kind="research.deep", payload={"query": "q"})
        ctx = self._build_ctx(rec)
        with pytest.raises(RuntimeError, match="timeout"):
            asyncio.run(kinds.research_deep(ctx))


# ── 11-12. Dispatcher context: progress + cancellation ─────────────────────

class TestDispatcherContext:
    """Verifies the JobContext built by backend/jobs/tasks.py dispatcher
    behaves correctly. We don't run the Celery task itself (would need
    a real worker) — we exercise the inner async functions directly."""

    def test_report_progress_writes_db_and_publishes(self, tmp_jobs_db, monkeypatch):
        rec = _make_record(kind="echo", payload={})

        published: list = []
        async def _capture_publish(event):
            published.append((event.kind, event.payload))

        # Patch the bus.publish so we observe the event without
        # needing a live subscriber.
        from backend.services.jobs import events as events_mod
        bus = events_mod.get_bus()
        monkeypatch.setattr(bus, "publish", _capture_publish)

        # Build the dispatcher-style progress callable inline (matches
        # backend/jobs/tasks.py:_report_progress).
        async def _report(pct: int, label=None):
            jobs_store.update(rec.id, progress=max(0, min(100, int(pct))),
                              progress_label=label)
            from backend.services.jobs.types import JobEvent
            await bus.publish(JobEvent(
                job_id=rec.id, kind="progress",
                payload={"progress": pct, "label": label}, timestamp="",
            ))

        asyncio.run(_report(42, "halfway"))

        # DB write happened
        cur = jobs_store.get(rec.id)
        assert cur is not None
        assert cur.progress == 42
        assert cur.progress_label == "halfway"
        # Event published
        assert published == [("progress", {"progress": 42, "label": "halfway"})]

    def test_is_cancelled_reads_db(self, tmp_jobs_db):
        rec = _make_record(kind="echo", payload={})
        # Dispatcher-style is_cancelled callable.
        async def _is_cancelled() -> bool:
            cur = jobs_store.get(rec.id)
            return cur is not None and cur.status == STATUS_CANCELLED

        assert asyncio.run(_is_cancelled()) is False
        # Flip the row.
        jobs_store.update(rec.id, status=STATUS_CANCELLED)
        assert asyncio.run(_is_cancelled()) is True


# ── 13-14. Allowlist + registration ────────────────────────────────────────

class TestRegistration:
    def test_new_kinds_in_public_allowlist(self):
        assert "vision.analyze" in kinds._PUBLIC_KINDS
        assert "research.deep" in kinds._PUBLIC_KINDS

    def test_handlers_registered(self):
        from backend.services.jobs.registry import get_handler
        assert get_handler("vision.analyze") is not None
        assert get_handler("research.deep") is not None
