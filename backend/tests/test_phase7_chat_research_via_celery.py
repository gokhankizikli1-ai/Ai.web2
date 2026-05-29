# coding: utf-8
"""Phase 7 closure — chat → Celery routing for web_research.

Locks in the fix that closes the bypass discovered after slice 5:

  Symptom: chat-triggered research never reached the worker. Jobs
  panel stayed empty. Worker logs showed startup only.

  Root cause: build_web_search_context_block ran the web_research
  tool INLINE. The research.deep Celery handler shipped in slice 3
  was orphaned.

  Fix: when WEB_RESEARCH_VIA_CELERY=true (+ ENABLE_JOB_QUEUE=true +
  JOB_QUEUE_RESEARCH=true), build_web_search_context_block dispatches
  a research.deep job + awaits the bus, then falls through to the
  existing block-formatting path.

These tests cover:
  1. Routing flag is off by default
  2. Flag on + queue off → inline path (graceful)
  3. Flag on + queue on → calls jobs_client.create with research.deep
  4. Celery success → produces same block shape as inline
  5. Celery timeout → returns None so caller falls back inline
  6. Celery job failure → returns inline-compatible unavailable envelope
"""
from __future__ import annotations

import asyncio
import os
from typing import Optional
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.services.tool_extraction import web_search_intent as wsi


# ── Routing flag predicate ──────────────────────────────────────────────────

class TestRoutingFlag:
    def test_off_by_default(self, monkeypatch):
        monkeypatch.delenv("WEB_RESEARCH_VIA_CELERY", raising=False)
        assert wsi._route_research_via_celery() is False

    def test_requires_all_three_flags(self, monkeypatch):
        monkeypatch.setenv("WEB_RESEARCH_VIA_CELERY", "true")
        # Missing the queue flag → off
        monkeypatch.delenv("ENABLE_JOB_QUEUE", raising=False)
        monkeypatch.delenv("JOB_QUEUE_RESEARCH", raising=False)
        assert wsi._route_research_via_celery() is False

        monkeypatch.setenv("ENABLE_JOB_QUEUE", "true")
        # Still missing per-handler gate → off
        assert wsi._route_research_via_celery() is False

        monkeypatch.setenv("JOB_QUEUE_RESEARCH", "true")
        # All three → on
        assert wsi._route_research_via_celery() is True

    def test_read_dynamically_per_call(self, monkeypatch):
        """Railway env flips must be live without an app restart."""
        monkeypatch.setenv("WEB_RESEARCH_VIA_CELERY", "true")
        monkeypatch.setenv("ENABLE_JOB_QUEUE", "true")
        monkeypatch.setenv("JOB_QUEUE_RESEARCH", "true")
        assert wsi._route_research_via_celery() is True
        monkeypatch.setenv("WEB_RESEARCH_VIA_CELERY", "false")
        assert wsi._route_research_via_celery() is False


# ── Celery dispatch path ────────────────────────────────────────────────────

class _FakeJobRecord:
    def __init__(self, id, status, result=None, error=None):
        self.id = id
        self.status = status
        self.result = result
        self.error = error


class TestCeleryDispatchPath:
    def _enable_routing(self, monkeypatch):
        monkeypatch.setenv("WEB_RESEARCH_VIA_CELERY", "true")
        monkeypatch.setenv("ENABLE_JOB_QUEUE", "true")
        monkeypatch.setenv("JOB_QUEUE_RESEARCH", "true")

    def _stub_jobs(self, monkeypatch, *, create_side_effect=None,
                    get_returns=None, bus_event=None):
        """Patch jobs_client + JobEventBus so we don't touch real DB."""
        from backend.services.jobs import client as jobs_client
        from backend.services.jobs.events import get_bus
        from backend.services.jobs.types import JobEvent

        if create_side_effect is None:
            async def _default_create(*_a, **_kw):
                return _FakeJobRecord("job-test", "queued")
            create_side_effect = _default_create
        monkeypatch.setattr(jobs_client, "create", create_side_effect)

        if get_returns is not None:
            monkeypatch.setattr(
                jobs_client, "get",
                lambda *_a, **_kw: get_returns,
            )

        if bus_event is not None:
            bus = get_bus()

            async def _fake_consume(job_id, heartbeat_s=5.0):
                yield bus_event
            monkeypatch.setattr(bus, "consume", _fake_consume)

    def test_create_called_with_research_deep_kind(self, monkeypatch):
        self._enable_routing(monkeypatch)

        captured = {}
        async def _capture_create(**kwargs):
            captured.update(kwargs)
            return _FakeJobRecord("job-1", "queued")

        from backend.services.jobs.events import get_bus
        from backend.services.jobs.types import JobEvent
        bus = get_bus()
        async def _bus_consume(jid, heartbeat_s=5.0):
            yield JobEvent(job_id=jid, kind="done", payload={}, timestamp="t")
        monkeypatch.setattr(bus, "consume", _bus_consume)

        self._stub_jobs(monkeypatch, create_side_effect=_capture_create,
                        get_returns=_FakeJobRecord(
                            "job-1", "succeeded",
                            result={"query": "q", "answer": "42",
                                    "citations": [{"title": "t",
                                                    "url": "https://x.test",
                                                    "snippet": "s",
                                                    "published_date": "2026-01-01"}],
                                    "count": 1,
                                    "provider": "tavily",
                                    "cached": False, "elapsed_ms": 100}))

        result = asyncio.run(wsi._run_research_via_celery(
            user_id="u1", query="research nvidia",
            project_id=None, correlation_id="cid-1",
        ))
        assert result is not None
        assert result["status"] == "available"
        assert captured["kind"] == "research.deep"
        assert captured["payload"]["query"] == "research nvidia"
        assert captured["user_id"] == "u1"
        # metadata carries the chat_auto correlation
        assert captured["metadata"]["caller"] == "chat_auto"
        assert captured["metadata"]["correlation_id"] == "cid-1"

    def test_returns_available_envelope_on_success(self, monkeypatch):
        self._enable_routing(monkeypatch)

        from backend.services.jobs.events import get_bus
        from backend.services.jobs.types import JobEvent

        bus = get_bus()
        async def _bus_consume(jid, heartbeat_s=5.0):
            yield JobEvent(job_id=jid, kind="done", payload={}, timestamp="t")
        monkeypatch.setattr(bus, "consume", _bus_consume)

        async def _create(**kw):
            return _FakeJobRecord("job-1", "queued")

        get_returns = _FakeJobRecord(
            "job-1", "succeeded",
            result={
                "query": "q", "answer": "ans",
                "citations": [{"title": "t", "url": "https://x.test",
                               "snippet": "s"}],
                "count": 1, "provider": "stub",
                "cached": False, "elapsed_ms": 50,
            },
        )
        self._stub_jobs(monkeypatch, create_side_effect=_create,
                        get_returns=get_returns)

        env = asyncio.run(wsi._run_research_via_celery(
            user_id="u1", query="q", project_id=None, correlation_id=None,
        ))
        assert env["status"] == "available"
        assert env["provider"] == "stub"
        assert env["data"]["answer"] == "ans"
        assert env["data"]["citations"][0]["url"] == "https://x.test"

    def test_returns_unavailable_envelope_on_job_failure(self, monkeypatch):
        self._enable_routing(monkeypatch)

        from backend.services.jobs.events import get_bus
        from backend.services.jobs.types import JobEvent

        bus = get_bus()
        async def _bus_consume(jid, heartbeat_s=5.0):
            yield JobEvent(job_id=jid, kind="error",
                           payload={"error": {"message": "provider down"}},
                           timestamp="t")
        monkeypatch.setattr(bus, "consume", _bus_consume)

        async def _create(**kw):
            return _FakeJobRecord("job-2", "queued")

        # DB row reads as failed with a dict error
        get_returns = _FakeJobRecord(
            "job-2", "failed",
            error={"message": "provider down"},
        )
        self._stub_jobs(monkeypatch, create_side_effect=_create,
                        get_returns=get_returns)

        env = asyncio.run(wsi._run_research_via_celery(
            user_id="u1", query="q", project_id=None, correlation_id=None,
        ))
        assert env is not None
        assert env["status"] == "unavailable"
        assert "provider down" in env["message"]

    def test_timeout_returns_none(self, monkeypatch):
        self._enable_routing(monkeypatch)

        # Shorten timeout so the test is fast.
        monkeypatch.setattr(wsi, "_CELERY_WAIT_TIMEOUT_S", 0.1)

        from backend.services.jobs.events import get_bus

        bus = get_bus()
        async def _hang(jid, heartbeat_s=5.0):
            # Never yield — simulates worker that didn't respond
            await asyncio.sleep(10.0)
            yield None     # pragma: no cover
        monkeypatch.setattr(bus, "consume", _hang)

        async def _create(**kw):
            return _FakeJobRecord("job-3", "queued")
        self._stub_jobs(monkeypatch, create_side_effect=_create)

        env = asyncio.run(wsi._run_research_via_celery(
            user_id="u1", query="q", project_id=None, correlation_id=None,
        ))
        # None signals caller to fall back to inline
        assert env is None

    def test_queue_disabled_returns_none(self, monkeypatch):
        """JobQueueDisabled is the operator-visible 'queue off' signal —
        we must fall back inline rather than crash chat."""
        self._enable_routing(monkeypatch)

        from backend.services.jobs.errors import JobQueueDisabled
        from backend.services.jobs import client as jobs_client

        async def _create(**kw):
            raise JobQueueDisabled("simulated")
        monkeypatch.setattr(jobs_client, "create", _create)

        env = asyncio.run(wsi._run_research_via_celery(
            user_id="u1", query="q", project_id=None, correlation_id=None,
        ))
        assert env is None


# ── build_web_search_context_block routing ─────────────────────────────────

class TestBuildBlockRouting:
    def test_routing_off_uses_inline_path(self, monkeypatch):
        """When the flag is off, the function MUST go through the
        existing inline code path. We verify by spying on
        _run_research_via_celery — it should NEVER be called."""
        monkeypatch.delenv("WEB_RESEARCH_VIA_CELERY", raising=False)

        called = []
        async def _spy(**kwargs):
            called.append(kwargs)
            return None
        monkeypatch.setattr(wsi, "_run_research_via_celery", _spy)

        # Tool registry is off → inline path returns early
        monkeypatch.delenv("ENABLE_WEB_RESEARCH", raising=False)
        monkeypatch.delenv("ENABLE_TOOLS", raising=False)

        result, payload = asyncio.run(wsi.build_web_search_context_block(
            user_id="u1", query="q", triggers=("test",),
        ))
        assert called == []
        assert result is None  # tool disabled → no block

    def test_routing_on_calls_celery_helper(self, monkeypatch):
        monkeypatch.setenv("WEB_RESEARCH_VIA_CELERY", "true")
        monkeypatch.setenv("ENABLE_JOB_QUEUE", "true")
        monkeypatch.setenv("JOB_QUEUE_RESEARCH", "true")

        called = []
        async def _spy(**kwargs):
            called.append(kwargs)
            return {
                "status": "available",
                "provider": "stub",
                "data": {
                    "query": "q", "answer": "ans",
                    "citations": [{"title": "t", "url": "https://x.test",
                                   "snippet": "s"}],
                    "count": 1, "provider": "stub",
                    "cached": False, "elapsed_ms": 50,
                },
            }
        monkeypatch.setattr(wsi, "_run_research_via_celery", _spy)

        block, payload = asyncio.run(wsi.build_web_search_context_block(
            user_id="u1", query="research NVIDIA", triggers=("test",),
        ))
        assert len(called) == 1
        assert called[0]["query"] == "research NVIDIA"
        # Block must include the same DO-NOT-REFUSE header the inline
        # path produces.
        assert block is not None
        assert "KORVIX WEB SEARCH RESULTS" in block
        assert payload["fetched"] is True
        assert payload["count"] == 1

    def test_routing_on_falls_back_inline_when_celery_returns_none(
        self, monkeypatch,
    ):
        """Celery helper returns None (timeout / queue disabled). The
        function MUST fall through to the inline path rather than
        producing an empty block."""
        monkeypatch.setenv("WEB_RESEARCH_VIA_CELERY", "true")
        monkeypatch.setenv("ENABLE_JOB_QUEUE", "true")
        monkeypatch.setenv("JOB_QUEUE_RESEARCH", "true")

        async def _none(**kwargs):
            return None
        monkeypatch.setattr(wsi, "_run_research_via_celery", _none)

        # Inline path is also off (tool registry off) → both paths
        # return their idle envelope. We verify the function FELL
        # THROUGH (didn't crash, didn't return mid-flight).
        monkeypatch.delenv("ENABLE_TOOLS", raising=False)
        result, payload = asyncio.run(wsi.build_web_search_context_block(
            user_id="u1", query="q", triggers=("test",),
        ))
        # When inline is also unavailable, we get the inline path's
        # signal. The test confirms no crash + payload shape.
        assert isinstance(payload, dict)
