# coding: utf-8
"""
Phase 7 — Built-in job kinds tests.

Each handler is exercised with a synthetic JobContext so we don't
depend on the runner. No pytest-asyncio in the test env; async
helpers use asyncio.run.
"""
from __future__ import annotations

import asyncio

import pytest

from backend.services.jobs.kinds import (
    echo, sleep_progress, memory_consolidation_stub,
    public_kinds, is_public_kind,
)
from backend.services.jobs.registry import JobContext
from backend.services.jobs.types import JobRecord


def _make_ctx(record: JobRecord):
    progress_log: list = []
    cancelled = {"val": False}

    async def _report(pct: int, label):
        progress_log.append((pct, label))

    async def _is_cancelled() -> bool:
        return cancelled["val"]

    return JobContext(record=record, report_progress=_report,
                      is_cancelled=_is_cancelled), progress_log, cancelled


# ── Allowlist ────────────────────────────────────────────────────────────────

def test_public_kinds_contains_all_demo_kinds():
    assert "echo" in public_kinds()
    assert "sleep_progress" in public_kinds()
    assert "memory_consolidation_stub" in public_kinds()


def test_is_public_kind_case_insensitive():
    assert is_public_kind("ECHO") is True
    assert is_public_kind("  echo  ") is True
    assert is_public_kind("not_a_thing") is False


# ── echo ─────────────────────────────────────────────────────────────────────

def test_echo_returns_payload():
    rec = JobRecord(kind="echo", user_id="u1", payload={"a": 1, "b": "x"})
    ctx, log, _ = _make_ctx(rec)
    async def _drive():
        out = await echo(ctx)
        assert out == {"echo": {"a": 1, "b": "x"}, "user_id": "u1", "kind": "echo"}
        assert log == [(50, "echoing")]
    asyncio.run(_drive())


# ── sleep_progress ───────────────────────────────────────────────────────────

def test_sleep_progress_reports_each_step():
    rec = JobRecord(kind="sleep_progress", user_id="u1",
                    payload={"steps": 3, "step_delay_s": 0.0, "label": "go"})
    ctx, log, _ = _make_ctx(rec)
    async def _drive():
        out = await sleep_progress(ctx)
        assert out["completed_steps"] == 3
        pcts = [p for p, _ in log]
        assert pcts == [33, 67, 100]
    asyncio.run(_drive())


def test_sleep_progress_respects_cancellation():
    rec = JobRecord(kind="sleep_progress", user_id="u1",
                    payload={"steps": 5, "step_delay_s": 0.0})
    ctx, log, _ = _make_ctx(rec)
    call_count = {"n": 0}
    async def _is_cancelled():
        call_count["n"] += 1
        return call_count["n"] > 1
    object.__setattr__(ctx, "is_cancelled", _is_cancelled)

    async def _drive():
        out = await sleep_progress(ctx)
        assert out["cancelled_mid_flight"] is True
        assert out["completed_steps"] < 5
    asyncio.run(_drive())


def test_sleep_progress_clamps_inputs():
    rec = JobRecord(kind="sleep_progress", user_id="u1",
                    payload={"steps": 1000, "step_delay_s": 99})
    ctx, log, _ = _make_ctx(rec)
    async def _drive():
        out = await sleep_progress(ctx)
        assert out["completed_steps"] == 50    # clamped from 1000
    asyncio.run(_drive())


# ── memory_consolidation_stub ────────────────────────────────────────────────

def test_memory_consolidation_stub_reports_zero_for_new_user():
    rec = JobRecord(kind="memory_consolidation_stub", user_id="brand-new-user")
    ctx, log, _ = _make_ctx(rec)
    async def _drive():
        out = await memory_consolidation_stub(ctx)
        assert out["user_id"] == "brand-new-user"
        assert out["total_memories"] == 0
        assert out["by_kind"] == {}
        # Crucial: the stub is non-destructive.
        assert out["would_consolidate"] == 0
        assert "Phase 7 stub" in out["note"]
    asyncio.run(_drive())


def test_memory_consolidation_stub_reads_existing_memories(tmp_memory_plane_db):
    from backend.services.memory_plane import client as mp_client
    mp_client.create(user_id="u1", content="A", kind="fact")
    mp_client.create(user_id="u1", content="B", kind="preference")

    rec = JobRecord(kind="memory_consolidation_stub", user_id="u1")
    ctx, log, _ = _make_ctx(rec)
    async def _drive():
        out = await memory_consolidation_stub(ctx)
        assert out["total_memories"] == 2
        assert out["by_kind"]["fact"] == 1
        assert out["by_kind"]["preference"] == 1
        # No memories were deleted.
        items = mp_client.list_user("u1")
        assert len(items) == 2
    asyncio.run(_drive())
