# coding: utf-8
"""
Phase 7 — Inline runner + manager + lifecycle tests.

These tests drive the manager directly (not the route). They cover:

  * Successful job execution (echo) → status, progress, result land
    in the DB and an SSE-style event sequence is emitted on the bus.
  * Handler error → status=failed, error field populated.
  * Retry — handler raises once, succeeds on second attempt; final
    status=succeeded, attempts=2.
  * Cancellation — long-running job is cancelled mid-flight; final
    status=cancelled and handler observes is_cancelled().
  * Timeout — handler exceeds timeout_s; status=failed, error=JOB_TIMEOUT.
  * Idempotency dedup — duplicate (user, kind, key) returns the same row.
  * Unknown kind rejection at create time.
  * Payload-too-large rejection.
  * Cross-user `get` returns None (ownership guard).
  * Owner override (`by_owner=True`) bypasses ownership in get/cancel/retry.

The project doesn't ship pytest-asyncio, so each async test wraps its
body in an inner `async def _drive():` and dispatches via
`asyncio.run(...)` — the same convention test_phase32_event_bus.py uses.
"""
from __future__ import annotations

import asyncio
import time

import pytest

from backend.services.jobs import client as jobs_client
from backend.services.jobs import store as jobs_store
from backend.services.jobs.errors import (
    JobInvalidTransition, JobKindUnknown,
    JobNotFound, JobValidationError,
)
from backend.services.jobs.events import get_bus
from backend.services.jobs.registry import _reset_for_tests as _registry_reset
from backend.services.jobs.types import (
    STATUS_SUCCEEDED, STATUS_FAILED, STATUS_CANCELLED,
    STATUS_RUNNING, STATUS_QUEUED,
)


# ── Helper: poll until terminal ──────────────────────────────────────────────

async def _wait_terminal(job_id: str, *, timeout_s: float = 5.0):
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        rec = jobs_store.get(job_id)
        if rec is not None and rec.is_terminal:
            return rec
        await asyncio.sleep(0.02)
    return jobs_store.get(job_id)


def _reload_builtin_kinds():
    """Re-import the kinds module so its @korvix_task side effects
    re-register the built-in handlers (echo / sleep_progress / etc.)
    after the registry has been reset."""
    from backend.services.jobs import kinds as _builtin_kinds
    from importlib import reload
    reload(_builtin_kinds)


# ── Built-in `echo` happy path ───────────────────────────────────────────────

def test_echo_succeeds_and_returns_payload(tmp_jobs_db):
    async def _drive():
        rec = await jobs_client.create(
            user_id="u1", kind="echo",
            payload={"message": "hello"},
        )
        final = await _wait_terminal(rec.id or "")
        assert final is not None
        assert final.status == STATUS_SUCCEEDED
        assert final.result == {"echo": {"message": "hello"},
                                "user_id": "u1", "kind": "echo"}
        assert final.progress == 100
        assert final.attempts == 1
        assert final.finished_at is not None
    asyncio.run(_drive())


def test_sleep_progress_succeeds(tmp_jobs_db):
    async def _drive():
        rec = await jobs_client.create(
            user_id="u1", kind="sleep_progress",
            payload={"steps": 3, "step_delay_s": 0.05},
        )
        final = await _wait_terminal(rec.id or "", timeout_s=3.0)
        assert final is not None
        assert final.status == STATUS_SUCCEEDED
        assert final.result["completed_steps"] == 3
        assert final.progress == 100
    asyncio.run(_drive())


# ── Handler error path ───────────────────────────────────────────────────────

def test_handler_raises_marks_job_failed(tmp_jobs_db):
    async def _drive():
        _registry_reset()
        _reload_builtin_kinds()

        from backend.services.jobs.registry import register_job

        @register_job("test_always_fails")
        async def _always_fails(ctx):
            raise RuntimeError("intentional test failure")

        # Manager-direct (bypasses public-kinds allowlist) for
        # internal-only test handlers.
        from backend.services.jobs.manager import manager
        rec = await manager.create(user_id="u1", kind="test_always_fails")
        final = await _wait_terminal(rec.id or "")
        assert final is not None
        assert final.status == STATUS_FAILED
        assert final.error is not None
        assert final.error["code"] == "JOB_HANDLER_ERROR"
        assert "intentional" in final.error["message"]
    asyncio.run(_drive())


# ── Retry semantics ──────────────────────────────────────────────────────────

def test_retry_succeeds_on_second_attempt(tmp_jobs_db):
    async def _drive():
        _registry_reset()
        _reload_builtin_kinds()

        from backend.services.jobs.registry import register_job
        attempts = {"n": 0}

        @register_job("test_flaky")
        async def _flaky(ctx):
            attempts["n"] += 1
            if attempts["n"] < 2:
                raise RuntimeError("first attempt fails")
            return {"attempt": attempts["n"]}

        from backend.services.jobs.manager import manager
        rec = await manager.create(
            user_id="u1", kind="test_flaky", max_attempts=2,
        )
        final = await _wait_terminal(rec.id or "", timeout_s=10.0)
        assert final is not None
        assert final.status == STATUS_SUCCEEDED
        assert final.attempts == 2
        assert final.result == {"attempt": 2}
    asyncio.run(_drive())


# ── Cancellation ─────────────────────────────────────────────────────────────

def test_cancel_running_job(tmp_jobs_db):
    async def _drive():
        rec = await jobs_client.create(
            user_id="u1", kind="sleep_progress",
            payload={"steps": 20, "step_delay_s": 0.1},
        )
        await asyncio.sleep(0.05)
        cancelled = await jobs_client.cancel(rec.id or "", user_id="u1")
        assert cancelled.status == STATUS_CANCELLED
        final = await _wait_terminal(rec.id or "", timeout_s=3.0)
        assert final is not None
        assert final.status == STATUS_CANCELLED
    asyncio.run(_drive())


def test_cancel_terminal_raises(tmp_jobs_db):
    async def _drive():
        rec = await jobs_client.create(
            user_id="u1", kind="echo", payload={"x": 1},
        )
        await _wait_terminal(rec.id or "")
        with pytest.raises(JobInvalidTransition):
            await jobs_client.cancel(rec.id or "", user_id="u1")
    asyncio.run(_drive())


# ── Timeout ──────────────────────────────────────────────────────────────────

def test_job_timeout(tmp_jobs_db):
    async def _drive():
        rec = await jobs_client.create(
            user_id="u1", kind="sleep_progress",
            payload={"steps": 100, "step_delay_s": 0.1},
            timeout_s=1,
        )
        final = await _wait_terminal(rec.id or "", timeout_s=4.0)
        assert final is not None
        assert final.status == STATUS_FAILED
        assert final.error["code"] == "JOB_TIMEOUT"
    asyncio.run(_drive())


# ── Idempotency ──────────────────────────────────────────────────────────────

def test_idempotency_returns_existing_row(tmp_jobs_db):
    async def _drive():
        a = await jobs_client.create(
            user_id="u1", kind="echo", payload={"x": 1},
            idempotency_key="abc",
        )
        b = await jobs_client.create(
            user_id="u1", kind="echo", payload={"x": 2},
            idempotency_key="abc",
        )
        assert a.id == b.id
    asyncio.run(_drive())


def test_idempotency_isolated_per_user(tmp_jobs_db):
    async def _drive():
        a = await jobs_client.create(
            user_id="alice", kind="echo", idempotency_key="k1",
        )
        b = await jobs_client.create(
            user_id="bob", kind="echo", idempotency_key="k1",
        )
        assert a.id != b.id
    asyncio.run(_drive())


# ── Validation ───────────────────────────────────────────────────────────────

def test_unknown_kind_rejected(tmp_jobs_db):
    async def _drive():
        with pytest.raises(JobKindUnknown):
            await jobs_client.create(user_id="u1", kind="not_a_real_kind")
    asyncio.run(_drive())


def test_payload_too_large_rejected(tmp_jobs_db):
    async def _drive():
        huge = {"data": "x" * (260 * 1024)}
        with pytest.raises(JobValidationError) as e:
            await jobs_client.create(user_id="u1", kind="echo", payload=huge)
        assert e.value.code == "PAYLOAD_TOO_LARGE"
    asyncio.run(_drive())


# ── Ownership guard ──────────────────────────────────────────────────────────

def test_get_cross_user_returns_none(tmp_jobs_db):
    async def _drive():
        rec = await jobs_client.create(user_id="alice", kind="echo")
        await _wait_terminal(rec.id or "")
        assert jobs_client.get(rec.id or "", user_id="bob") is None
        assert jobs_client.get(rec.id or "", user_id="alice") is not None
    asyncio.run(_drive())


def test_owner_can_get_any_user_job(tmp_jobs_db):
    async def _drive():
        rec = await jobs_client.create(user_id="alice", kind="echo")
        await _wait_terminal(rec.id or "")
        got = jobs_client.get(rec.id or "")
        assert got is not None
    asyncio.run(_drive())


# ── Event bus ────────────────────────────────────────────────────────────────

def test_event_bus_emits_done(tmp_jobs_db):
    async def _drive():
        rec = await jobs_client.create(
            user_id="u1", kind="sleep_progress",
            payload={"steps": 2, "step_delay_s": 0.05},
        )
        bus = get_bus()
        events = []

        async def _consume():
            async for ev in bus.consume(rec.id or "", heartbeat_s=2.0):
                events.append(ev)
                if ev.kind in {"done", "error"}:
                    return

        try:
            await asyncio.wait_for(_consume(), timeout=3.0)
        except asyncio.TimeoutError:
            pass

        kinds = [e.kind for e in events]
        assert "done" in kinds
    asyncio.run(_drive())
