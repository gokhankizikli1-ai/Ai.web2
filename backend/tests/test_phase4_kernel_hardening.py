# coding: utf-8
"""Phase 4 — execution-kernel hardening.

Two guarantees:

  1. Idempotent step dispatch. A step's job is created with a STABLE
     idempotency key `wf:{workflow_id}:step:{step_id}`. If dispatch runs
     twice (a re-entrant driver, or two runner instances racing on the same
     orphaned running workflow after a restart), the jobs layer's UNIQUE
     idempotency index means the second create returns the EXISTING job —
     no duplicate paid execution.

  2. Step watchdog. A step that never reaches a terminal state (the known
     agent_task trap) is failed once it exceeds the watchdog threshold, so
     a workflow can never hang forever.
"""
from __future__ import annotations

import asyncio

import pytest

from backend.services.workflows import runner as wf_runner
from backend.services.workflows.steps import (
    Step, STEP_STATUS_DISPATCHED, STEP_STATUS_FAILED,
)


def test_idempotency_key_is_stable_and_scoped():
    k1 = wf_runner._step_idempotency_key("wfA", "s1")
    k2 = wf_runner._step_idempotency_key("wfA", "s1")
    assert k1 == k2 == "wf:wfA:step:s1"
    # Different step / workflow → different key.
    assert wf_runner._step_idempotency_key("wfA", "s2") != k1
    assert wf_runner._step_idempotency_key("wfB", "s1") != k1


def test_dispatch_uses_idempotency_key_and_dedups(tmp_jobs_db):
    """Dispatching the SAME step twice must create exactly one job — the
    second create returns the existing record via the idempotency index.

    Uses the REAL jobs client (tmp_jobs_db wires the store + manager and
    registers the `echo` kind), so the jobs UNIQUE idempotency index is
    genuinely exercised end-to-end."""
    from backend.services.jobs import store as jobs_store

    step = Step(id="s1", label="build", kind="job",
                payload={"kind": "echo", "input": {"msg": "hi"}})

    async def _run_twice():
        await wf_runner._dispatch_step("u1", "proj1", "wfX", step)
        first_id = step.dispatched_id
        # Simulate a second driver re-dispatching the same step (restart /
        # replica race): reset dispatch bookkeeping and dispatch again.
        step.status = "pending"
        step.dispatched_id = None
        await wf_runner._dispatch_step("u1", "proj1", "wfX", step)
        return first_id, step.dispatched_id

    first_id, second_id = asyncio.run(_run_twice())

    assert first_id is not None
    # Both dispatches resolved to the SAME job — no duplicate dispatch.
    assert first_id == second_id
    # And exactly one job carries the stable step idempotency key.
    existing = jobs_store.get_by_idempotency_key(
        user_id="u1", kind="echo", idempotency_key="wf:wfX:step:s1",
    )
    assert existing is not None
    assert existing.id == first_id


def test_watchdog_fails_stuck_step():
    """A step in-flight past the watchdog threshold is failed, not left
    hanging."""
    from datetime import datetime, timezone, timedelta

    step = Step(id="s1", label="t", kind="agent_task", payload={})
    step.status = STEP_STATUS_DISPATCHED
    step.dispatched_id = "at_1"
    # Dispatched well beyond the watchdog window.
    old = datetime.now(timezone.utc) - timedelta(
        seconds=wf_runner._STEP_WATCHDOG_SEC + 60
    )
    step.started_at = old.isoformat()

    changed = asyncio.run(wf_runner._reconcile_in_flight("u1", [step]))
    assert changed is True
    assert step.status == STEP_STATUS_FAILED
    assert "timed out" in (step.error or "")


def test_watchdog_leaves_fresh_step_running(monkeypatch):
    """A freshly-dispatched step is NOT failed by the watchdog; it polls
    normally (poll returns None → still in-flight)."""
    step = Step(id="s1", label="t", kind="agent_task", payload={})
    step.status = STEP_STATUS_DISPATCHED
    step.dispatched_id = "at_1"
    step.started_at = wf_runner._now_iso()

    # Poll returns None (still queued/running) → no change.
    monkeypatch.setattr(wf_runner, "_poll_agent_task",
                        lambda user_id, tid: (None, None, None))
    changed = asyncio.run(wf_runner._reconcile_in_flight("u1", [step]))
    assert changed is False
    assert step.status == STEP_STATUS_DISPATCHED


def test_elapsed_survives_naive_timestamp():
    """started_at without a tz offset must still be handled (treated UTC),
    so a persisted/legacy step is watchdog-covered after restart."""
    from datetime import datetime, timezone, timedelta
    step = Step(id="s1", label="t", kind="job", payload={})
    naive = (datetime.now(timezone.utc) - timedelta(seconds=100)).replace(tzinfo=None)
    step.started_at = naive.isoformat()
    elapsed = wf_runner._step_elapsed_sec(step)
    assert elapsed is not None and 90 < elapsed < 200
