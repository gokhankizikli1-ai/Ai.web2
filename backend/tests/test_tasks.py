# coding: utf-8
"""
Phase 4b background-task queue tests.

These run real asyncio queues — no mocking — so they exercise the
exact code path that ships to Railway. Each test builds a fresh
TaskQueue (force-enabled regardless of env) so the global singleton
doesn't bleed state between tests.

Coverage:
  - submit returns False when queue is disabled
  - submit when no event loop is running fails gracefully
  - worker drains sync tasks
  - worker drains async tasks
  - failed task doesn't crash the worker
  - failure counters update + last_error captured
  - bounded queue with overflow=drop returns False on full
  - bounded queue with overflow=raise raises QueueFull
  - stop() drains pending work within the grace window
  - queue_stats() snapshot is internally consistent
  - /v2/health.metadata.background_tasks structure
"""
from __future__ import annotations

import asyncio

import pytest

from backend.services.tasks.queue import TaskQueue
from backend.services.tasks.types import QueueStats


# ── Helpers ────────────────────────────────────────────────────────────────

class _Counter:
    """Async-safe counter for tracking how many times a task ran."""
    def __init__(self) -> None:
        self.value = 0


def _sync_inc(c: _Counter) -> None:
    c.value += 1


async def _async_inc(c: _Counter) -> None:
    c.value += 1


def _sync_boom() -> None:
    raise RuntimeError("intentional test failure")


# ── Tests that don't need a running event loop ─────────────────────────────

def test_disabled_queue_returns_false_on_submit():
    q = TaskQueue(enabled=False)
    assert q.submit(lambda: None, name="t1") is False
    s = q.stats()
    assert s.enabled is False
    assert s.submitted_total == 0


def test_submit_outside_event_loop_returns_false():
    q = TaskQueue(enabled=True)
    # No running loop yet — submit must fail gracefully, not crash.
    assert q.submit(lambda: None, name="t1") is False
    assert q.stats().overflow_dropped == 1


# ── Async tests (require an event loop) ───────────────────────────────────

def test_worker_drains_sync_task():
    asyncio.run(_test_worker_drains_sync_task())

async def _test_worker_drains_sync_task():
    q = TaskQueue(enabled=True)
    c = _Counter()
    await q.start()
    try:
        assert q.submit(_sync_inc, c, name="sync_inc") is True
        # Let the worker pick it up.
        for _ in range(50):
            if c.value > 0:
                break
            await asyncio.sleep(0.005)
        assert c.value == 1
        s = q.stats()
        assert s.processed_total == 1
        assert s.failed_total == 0
        assert s.last_task_name == "sync_inc"
    finally:
        await q.stop(drain_timeout_s=1.0)


def test_worker_drains_async_task():
    asyncio.run(_test_worker_drains_async_task())

async def _test_worker_drains_async_task():
    q = TaskQueue(enabled=True)
    c = _Counter()
    await q.start()
    try:
        assert q.submit(_async_inc, c, name="async_inc") is True
        for _ in range(50):
            if c.value > 0:
                break
            await asyncio.sleep(0.005)
        assert c.value == 1
    finally:
        await q.stop(drain_timeout_s=1.0)


def test_failed_task_does_not_crash_worker():
    asyncio.run(_test_failed_task_does_not_crash_worker())

async def _test_failed_task_does_not_crash_worker():
    q = TaskQueue(enabled=True)
    c = _Counter()
    await q.start()
    try:
        assert q.submit(_sync_boom, name="boom") is True
        assert q.submit(_sync_inc, c, name="recover") is True
        for _ in range(50):
            if c.value > 0:
                break
            await asyncio.sleep(0.005)
        # Recovery task still ran AFTER the failure.
        assert c.value == 1
        s = q.stats()
        assert s.failed_total == 1
        assert s.processed_total == 1
        assert "boom" in s.last_error.lower() or "boom" in s.last_task_name.lower() or "runtime" in s.last_error.lower()
    finally:
        await q.stop(drain_timeout_s=1.0)


def test_bounded_queue_overflow_drop():
    asyncio.run(_test_bounded_queue_overflow_drop())

async def _test_bounded_queue_overflow_drop():
    # max_size=1, no worker, so submits queue up and the second one
    # hits the bound. Don't start the worker so we control timing.
    q = TaskQueue(enabled=True, max_size=1)
    # Force-create the asyncio.Queue without starting the worker.
    await q._ensure_queue()
    assert q.submit(lambda: None, name="first") is True
    assert q.submit(lambda: None, name="second") is False
    s = q.stats()
    assert s.submitted_total == 1
    assert s.overflow_dropped == 1


def test_bounded_queue_overflow_raise():
    asyncio.run(_test_bounded_queue_overflow_raise())

async def _test_bounded_queue_overflow_raise():
    q = TaskQueue(enabled=True, max_size=1)
    await q._ensure_queue()
    assert q.submit(lambda: None, name="first") is True
    with pytest.raises(asyncio.QueueFull):
        q.submit(lambda: None, name="second", on_overflow="raise")


def test_stop_drains_pending_work():
    asyncio.run(_test_stop_drains_pending_work())

async def _test_stop_drains_pending_work():
    q = TaskQueue(enabled=True)
    c = _Counter()
    await q.start()
    for _ in range(5):
        q.submit(_sync_inc, c, name="bulk")
    # Stop with a generous grace window — all 5 should land.
    await q.stop(drain_timeout_s=2.0)
    assert c.value == 5
    s = q.stats()
    assert s.processed_total == 5


def test_stats_snapshot_is_internally_consistent():
    asyncio.run(_test_stats_snapshot_is_internally_consistent())

async def _test_stats_snapshot_is_internally_consistent():
    q = TaskQueue(enabled=True, max_size=4)
    c = _Counter()
    await q.start()
    try:
        for _ in range(3):
            q.submit(_sync_inc, c, name="snap")
        await asyncio.sleep(0.05)   # let the worker chew through them
        s = q.stats()
        assert isinstance(s, QueueStats)
        assert s.processed_total >= 1
        assert s.submitted_total == 3
        assert s.failed_total == 0
        assert s.enabled is True
        assert s.worker_alive is True
        assert s.max_queue_size == 4
    finally:
        await q.stop(drain_timeout_s=1.0)


# ── Health-endpoint integration ────────────────────────────────────────────

def test_v2_health_includes_background_tasks_block(client):
    body = client.get("/v2/health").json()
    bt = body["metadata"]["background_tasks"]
    assert isinstance(bt, dict)
    for key in [
        "enabled", "worker_alive",
        "queue_size", "max_queue_size",
        "submitted_total", "processed_total", "failed_total",
        "overflow_dropped",
        "last_task_name", "last_task_ms", "last_error",
    ]:
        assert key in bt, f"missing background_tasks.{key}"


def test_legacy_chat_route_still_mounts_after_phase_4b(app):
    paths = {getattr(r, "path", None) for r in app.routes}
    assert "/chat" in paths, "/chat route missing — phase 4b regression"
