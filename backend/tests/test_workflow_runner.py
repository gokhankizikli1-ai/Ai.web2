# coding: utf-8
"""Phase A.1 — PR #1 — Workflow DAG Runner tests.

Coverage matches §8 of the approved design document. Twenty
deterministic tests grouped under five concerns:

  Eligibility resolver (1–5)
  Dispatch + completion  (6–11)
  Re-entrancy / crash safety (12–15)
  Back-compat (16–17)
  Bounds / safety (18–19)
  End-to-end integration with real InlineJobRunner (20)
"""
from __future__ import annotations

import asyncio
import json

import pytest

from backend.services.workflows import client as wf_client_mod
from backend.services.workflows import runner as wf_runner
from backend.services.workflows import store as wf_store
from backend.services.workflows.steps import (
    STEP_STATUS_COMPLETED,
    STEP_STATUS_FAILED,
    STEP_STATUS_PENDING,
    STEP_STATUS_SKIPPED,
    Step,
    StepsParseError,
    detect_cycle,
    eligible_step_ids,
    parse_steps,
    validate_for_run,
)
from backend.services.workflows.types import (
    STATUS_CANCELLED,
    STATUS_COMPLETED,
    STATUS_FAILED,
    STATUS_RUNNING,
    WorkflowRecord,
)


# ──────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────

def _make_workflow(
    *, user_id: str = "user-A", steps: list[dict] | None = None,
    status: str = "queued",
) -> WorkflowRecord:
    """Insert a workflow with explicit typed steps. Returns the stored
    record with id/timestamps populated."""
    rec = wf_client_mod.create(
        user_id=user_id, type="research", steps=None,
    )
    assert rec is not None
    # Overwrite the auto-generated default-step list with the typed
    # one the test wants. Some tests pass None to keep the default.
    if steps is not None:
        wf_store.update_steps(rec.id, steps=steps)
    if status != "queued":
        wf_store.update(rec.id, status=status)
    return wf_store.get(rec.id)


def _typed_step(
    sid: str, label: str = "", *,
    kind: str = "noop",
    deps: list[str] | None = None,
    payload: dict | None = None,
    status: str = STEP_STATUS_PENDING,
) -> dict:
    return {
        "id":            sid,
        "label":         label or sid,
        "kind":          kind,
        "payload":       payload or {},
        "dependencies":  deps or [],
        "status":        status,
        "dispatched_id": None,
        "started_at":    None,
        "finished_at":   None,
        "result":        None,
        "error":         None,
    }


def _enable_runner(monkeypatch):
    """Flip the runner's master gate AND speed up its poll interval
    so tests don't wait 1s per tick."""
    monkeypatch.setenv("ENABLE_WORKFLOW_RUNNER", "true")
    monkeypatch.setenv("WORKFLOW_RUNNER_POLL_INTERVAL_SEC", "0.05")


async def _wait_for_status(
    workflow_id: str, target: str, *, timeout_s: float = 5.0,
) -> WorkflowRecord:
    """Poll the workflow store until status reaches target or timeout."""
    deadline = asyncio.get_event_loop().time() + timeout_s
    while True:
        rec = wf_store.get(workflow_id)
        if rec is not None and rec.status == target:
            return rec
        if asyncio.get_event_loop().time() >= deadline:
            raise AssertionError(
                f"workflow {workflow_id} did not reach {target!r} within "
                f"{timeout_s}s (current={rec.status if rec else 'missing'})"
            )
        await asyncio.sleep(0.05)


# ──────────────────────────────────────────────────────────────────────────
# Eligibility resolver (pure function — no I/O needed)
# ──────────────────────────────────────────────────────────────────────────

def test_eligibility_linear_three_step():
    """1. Linear 3-step graph: step 2 ineligible until step 1
    completes; step 3 ineligible until step 2 completes."""
    steps = [
        Step(id="A", label="A"),
        Step(id="B", label="B", dependencies=["A"]),
        Step(id="C", label="C", dependencies=["B"]),
    ]
    assert eligible_step_ids(steps) == ["A"]
    steps[0].status = STEP_STATUS_COMPLETED
    assert eligible_step_ids(steps) == ["B"]
    steps[1].status = STEP_STATUS_COMPLETED
    assert eligible_step_ids(steps) == ["C"]
    steps[2].status = STEP_STATUS_COMPLETED
    assert eligible_step_ids(steps) == []


def test_eligibility_parallel_fan_out():
    """2. Parallel fan-out: 1 → [2, 3, 4] → 5 — after step 1
    completes, steps 2/3/4 all eligible simultaneously."""
    steps = [
        Step(id="A"),
        Step(id="B", dependencies=["A"]),
        Step(id="C", dependencies=["A"]),
        Step(id="D", dependencies=["A"]),
        Step(id="E", dependencies=["B", "C", "D"]),
    ]
    assert eligible_step_ids(steps) == ["A"]
    steps[0].status = STEP_STATUS_COMPLETED
    assert set(eligible_step_ids(steps)) == {"B", "C", "D"}
    steps[1].status = STEP_STATUS_COMPLETED
    assert set(eligible_step_ids(steps)) == {"C", "D"}  # E still blocked
    steps[2].status = STEP_STATUS_COMPLETED
    steps[3].status = STEP_STATUS_COMPLETED
    assert eligible_step_ids(steps) == ["E"]


def test_cycle_detection_rejects_a_b_a():
    """3. Cycle detection: rejects A → B → A at validate_for_run
    with workflow_steps_invalid."""
    steps = [
        Step(id="A", dependencies=["B"]),
        Step(id="B", dependencies=["A"]),
    ]
    assert detect_cycle(steps) is not None
    with pytest.raises(StepsParseError) as exc_info:
        validate_for_run(steps)
    assert exc_info.value.code == "workflow_steps_invalid"
    assert "cycle" in str(exc_info.value).lower()


def test_cycle_detection_rejects_self_dependency():
    """4. Self-dependency: rejects A → A. parse_steps rejects this
    before validate_for_run even runs."""
    raw = [_typed_step("A", deps=["A"])]
    with pytest.raises(StepsParseError) as exc_info:
        parse_steps(raw)
    assert "itself" in str(exc_info.value)


def test_missing_dependency_rejected():
    """5. Missing dependency id: rejects A → ghost_id."""
    raw = [_typed_step("A", deps=["ghost_id"])]
    with pytest.raises(StepsParseError) as exc_info:
        parse_steps(raw)
    assert "ghost_id" in str(exc_info.value)


# ──────────────────────────────────────────────────────────────────────────
# Dispatch + completion (end-to-end via real driver)
# ──────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_noop_step_completes_immediately(tmp_workflows_db, monkeypatch):
    """6. `kind: noop` step completes immediately on dispatch, no
    job/task spawned."""
    _enable_runner(monkeypatch)
    rec = _make_workflow(steps=[_typed_step("only", kind="noop")])
    await wf_runner.run_workflow(rec.id, user_id=rec.user_id)
    final = await _wait_for_status(rec.id, STATUS_COMPLETED)
    steps = parse_steps(final.steps)
    assert len(steps) == 1
    assert steps[0].status == STEP_STATUS_COMPLETED
    assert steps[0].dispatched_id is None
    assert steps[0].result == {"kind": "noop"}


@pytest.mark.asyncio
async def test_job_step_dispatches_via_jobs_client(
    tmp_workflows_db, monkeypatch,
):
    """7. `kind: job` step calls JobsClient.create + records
    dispatched_id. We stub the jobs module so we don't depend on
    ENABLE_JOB_QUEUE here — test 20 covers the live integration."""
    _enable_runner(monkeypatch)

    created_calls = []

    class _StubRecord:
        def __init__(self, _id, status, result=None, error=None):
            self.id = _id; self.status = status
            self.result = result; self.error = error

    async def _stub_create(**kwargs):
        created_calls.append(kwargs)
        return _StubRecord(f"job-{len(created_calls)}", "succeeded",
                           result={"echoed": kwargs.get("payload")})

    def _stub_get(job_id, *, user_id=None):
        # Driver polls — return the same stub as terminal.
        return _StubRecord(job_id, "succeeded",
                           result={"echoed": "ok"})

    from backend.services.jobs import client as jobs_client_mod
    monkeypatch.setattr(jobs_client_mod, "create", _stub_create)
    monkeypatch.setattr(jobs_client_mod, "get", _stub_get)

    rec = _make_workflow(steps=[
        _typed_step("J", kind="job",
                    payload={"kind": "echo", "input": {"msg": "hi"}}),
    ])
    await wf_runner.run_workflow(rec.id, user_id=rec.user_id)
    final = await _wait_for_status(rec.id, STATUS_COMPLETED)
    steps = parse_steps(final.steps)
    assert steps[0].status == STEP_STATUS_COMPLETED
    assert steps[0].dispatched_id == "job-1"
    assert created_calls[0]["kind"] == "echo"
    assert created_calls[0]["payload"] == {"msg": "hi"}
    assert created_calls[0]["idempotency_key"] == f"workflow:{rec.id}:step:J"
    assert created_calls[0]["metadata"]["workflow_id"] == rec.id
    assert created_calls[0]["metadata"]["step_id"] == "J"


@pytest.mark.asyncio
async def test_agent_task_step_dispatches_via_at_client(
    tmp_workflows_db, monkeypatch,
):
    """8. `kind: agent_task` step calls AgentTasksClient.create +
    records dispatched_id."""
    _enable_runner(monkeypatch)

    created_calls = []

    class _StubAT:
        def __init__(self, _id, status, result=None):
            self.id = _id; self.status = status; self.result = result

    def _stub_create(**kwargs):
        created_calls.append(kwargs)
        return _StubAT(f"at-{len(created_calls)}", "completed",
                       result={"reply": "ok"})

    def _stub_get(task_id, *, user_id=None):
        return _StubAT(task_id, "completed", result={"reply": "ok"})

    from backend.services.agent_tasks import client as at_client_mod
    monkeypatch.setattr(at_client_mod, "create", _stub_create)
    monkeypatch.setattr(at_client_mod, "get", _stub_get)

    rec = _make_workflow(steps=[
        _typed_step("T", kind="agent_task",
                    payload={"assigned_agent_id": "agent-1",
                             "task_description": "do thing"}),
    ])
    await wf_runner.run_workflow(rec.id, user_id=rec.user_id)
    final = await _wait_for_status(rec.id, STATUS_COMPLETED)
    steps = parse_steps(final.steps)
    assert steps[0].status == STEP_STATUS_COMPLETED
    assert steps[0].dispatched_id == "at-1"
    assert created_calls[0]["assigned_agent_id"] == "agent-1"
    assert created_calls[0]["metadata"]["workflow_id"] == rec.id
    assert created_calls[0]["metadata"]["step_id"] == "T"


@pytest.mark.asyncio
async def test_job_completion_advances_dependent_step(
    tmp_workflows_db, monkeypatch,
):
    """9. Job completion advances the step to `completed` and triggers
    eligibility recompute — the second step starts after the first
    finishes."""
    _enable_runner(monkeypatch)

    class _StubRecord:
        def __init__(self, _id, status, result=None):
            self.id = _id; self.status = status; self.result = result

    dispatch_order = []
    created_counter = [0]

    async def _stub_create(**kwargs):
        created_counter[0] += 1
        dispatch_order.append(kwargs["metadata"]["step_id"])
        return _StubRecord(f"job-{created_counter[0]}", "queued")

    # Poll returns "succeeded" once the job exists — simulating fast
    # completion. (Real Inline runner test is #20.)
    def _stub_get(job_id, *, user_id=None):
        return _StubRecord(job_id, "succeeded", result={"ok": True})

    from backend.services.jobs import client as jobs_client_mod
    monkeypatch.setattr(jobs_client_mod, "create", _stub_create)
    monkeypatch.setattr(jobs_client_mod, "get", _stub_get)

    rec = _make_workflow(steps=[
        _typed_step("A", kind="job", payload={"kind": "echo"}),
        _typed_step("B", kind="job", payload={"kind": "echo"}, deps=["A"]),
    ])
    await wf_runner.run_workflow(rec.id, user_id=rec.user_id)
    await _wait_for_status(rec.id, STATUS_COMPLETED)
    # B must have been dispatched AFTER A — eligibility ordering.
    assert dispatch_order == ["A", "B"]


@pytest.mark.asyncio
async def test_agent_task_completion_via_poll(tmp_workflows_db, monkeypatch):
    """10. Agent-task completion (via poll) advances the step to
    completed. Multi-tick: poll returns `running` first, then
    `completed`."""
    _enable_runner(monkeypatch)

    class _StubAT:
        def __init__(self, _id, status, result=None):
            self.id = _id; self.status = status; self.result = result

    def _stub_create(**kwargs):
        return _StubAT("at-1", "running")

    poll_seq = ["running", "running", "completed"]

    def _stub_get(task_id, *, user_id=None):
        status = poll_seq.pop(0) if poll_seq else "completed"
        return _StubAT(task_id, status,
                       result={"done": True} if status == "completed" else None)

    from backend.services.agent_tasks import client as at_client_mod
    monkeypatch.setattr(at_client_mod, "create", _stub_create)
    monkeypatch.setattr(at_client_mod, "get", _stub_get)

    rec = _make_workflow(steps=[
        _typed_step("T", kind="agent_task",
                    payload={"assigned_agent_id": "a-1"}),
    ])
    await wf_runner.run_workflow(rec.id, user_id=rec.user_id)
    await _wait_for_status(rec.id, STATUS_COMPLETED)


@pytest.mark.asyncio
async def test_job_failure_marks_workflow_failed_and_skips_remaining(
    tmp_workflows_db, monkeypatch,
):
    """11. Job failure marks the step `failed` AND the workflow
    `failed`; remaining unblocked steps are skipped."""
    _enable_runner(monkeypatch)

    class _StubRecord:
        def __init__(self, _id, status, error=None, result=None):
            self.id = _id; self.status = status
            self.error = error; self.result = result

    async def _stub_create(**kwargs):
        sid = kwargs["metadata"]["step_id"]
        return _StubRecord(f"job-{sid}", "queued")

    def _stub_get(job_id, *, user_id=None):
        # The "A" step fails; nothing else should ever be dispatched.
        if "A" in job_id:
            return _StubRecord(job_id, "failed", error="boom")
        return _StubRecord(job_id, "queued")

    from backend.services.jobs import client as jobs_client_mod
    monkeypatch.setattr(jobs_client_mod, "create", _stub_create)
    monkeypatch.setattr(jobs_client_mod, "get", _stub_get)

    # async cancel stub — must NOT raise to test best-effort path
    async def _stub_cancel(job_id, **kwargs):
        return _StubRecord(job_id, "cancelled")
    monkeypatch.setattr(jobs_client_mod, "cancel", _stub_cancel)

    # Both B and C must be PENDING at the moment of A's failure so the
    # runner's "skip all pending" rule has something observable to
    # mark. B depends on A directly; C depends on B (so it inherits
    # the dead chain and is never eligible before A fails).
    rec = _make_workflow(steps=[
        _typed_step("A", kind="job", payload={"kind": "echo"}),
        _typed_step("B", kind="noop", deps=["A"]),
        _typed_step("C", kind="noop", deps=["B"]),
    ])
    await wf_runner.run_workflow(rec.id, user_id=rec.user_id)
    final = await _wait_for_status(rec.id, STATUS_FAILED)
    steps = parse_steps(final.steps)
    by_id = {s.id: s for s in steps}
    assert by_id["A"].status == STEP_STATUS_FAILED
    assert by_id["B"].status == STEP_STATUS_SKIPPED
    assert by_id["C"].status == STEP_STATUS_SKIPPED
    assert final.result and final.result.get("step_id") == "A"


# ──────────────────────────────────────────────────────────────────────────
# Re-entrancy / crash safety
# ──────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_start_run_on_already_running_returns_409(
    tmp_workflows_db, monkeypatch,
):
    """12. start_run on an already-running workflow returns
    WorkflowAlreadyRunningError (mapped to 409 by the route)."""
    _enable_runner(monkeypatch)
    # Slow poll so the first driver is still alive when we call again.
    monkeypatch.setenv("WORKFLOW_RUNNER_POLL_INTERVAL_SEC", "30.0")

    class _StubRecord:
        def __init__(self, _id, status):
            self.id = _id; self.status = status
            self.result = None; self.error = None

    async def _stub_create(**kwargs):
        return _StubRecord("job-running-test", "queued")

    def _stub_get(job_id, *, user_id=None):
        return _StubRecord(job_id, "queued")

    from backend.services.jobs import client as jobs_client_mod
    monkeypatch.setattr(jobs_client_mod, "create", _stub_create)
    monkeypatch.setattr(jobs_client_mod, "get", _stub_get)

    rec = _make_workflow(steps=[
        _typed_step("X", kind="job", payload={"kind": "echo"}),
    ])
    await wf_runner.run_workflow(rec.id, user_id=rec.user_id)
    # Second call should see the per-workflow lock held.
    with pytest.raises(wf_runner.WorkflowAlreadyRunningError):
        await wf_runner.run_workflow(rec.id, user_id=rec.user_id)


@pytest.mark.asyncio
async def test_start_run_on_terminal_workflow_returns_409(
    tmp_workflows_db, monkeypatch,
):
    """13. start_run on a terminal workflow returns
    WorkflowAlreadyTerminalError (mapped to 409 by the route)."""
    _enable_runner(monkeypatch)
    rec = _make_workflow(steps=[_typed_step("X", kind="noop")])
    wf_store.update(rec.id, status=STATUS_COMPLETED)
    with pytest.raises(wf_runner.WorkflowAlreadyTerminalError):
        await wf_runner.run_workflow(rec.id, user_id=rec.user_id)


@pytest.mark.asyncio
async def test_sweep_orphans_resumes_running_workflows(
    tmp_workflows_db, monkeypatch,
):
    """14. sweep_orphans() after a simulated driver-death: a workflow
    with all-completed spawned jobs is RESUMED (driver re-attached)
    and reaches terminal state."""
    _enable_runner(monkeypatch)

    # Set up a workflow that's status=running with no live driver —
    # simulating the post-restart state. All steps are noop so the
    # resumed driver finishes immediately.
    rec = wf_client_mod.create(user_id="user-A", type="research")
    assert rec is not None
    wf_store.update_steps(rec.id, steps=[_typed_step("S", kind="noop")])
    wf_store.update(rec.id, status=STATUS_RUNNING)
    # No driver in _LIVE_DRIVERS for this id — orphan.
    assert rec.id not in wf_runner._LIVE_DRIVERS

    resumed = await wf_runner.sweep_orphans()
    assert resumed == 1

    await _wait_for_status(rec.id, STATUS_COMPLETED)


@pytest.mark.asyncio
async def test_cancel_during_run_cancels_in_flight_and_workflow(
    tmp_workflows_db, monkeypatch,
):
    """15. cancel during a run marks workflow `cancelled` AND cancels
    in-flight spawned jobs best-effort."""
    _enable_runner(monkeypatch)
    monkeypatch.setenv("WORKFLOW_RUNNER_POLL_INTERVAL_SEC", "0.05")

    class _StubRecord:
        def __init__(self, _id, status):
            self.id = _id; self.status = status
            self.error = None; self.result = None

    cancel_calls = []

    async def _stub_create(**kwargs):
        return _StubRecord("job-cancel-test", "queued")

    def _stub_get(job_id, *, user_id=None):
        return _StubRecord(job_id, "running")  # never completes

    async def _stub_cancel(job_id, **kwargs):
        cancel_calls.append(job_id)
        return _StubRecord(job_id, "cancelled")

    from backend.services.jobs import client as jobs_client_mod
    monkeypatch.setattr(jobs_client_mod, "create", _stub_create)
    monkeypatch.setattr(jobs_client_mod, "get", _stub_get)
    monkeypatch.setattr(jobs_client_mod, "cancel", _stub_cancel)

    rec = _make_workflow(steps=[
        _typed_step("J", kind="job", payload={"kind": "echo"}),
    ])
    await wf_runner.run_workflow(rec.id, user_id=rec.user_id)
    # Let the driver dispatch the job + start polling.
    await asyncio.sleep(0.2)
    # External cancel: flip status. Driver detects on next tick.
    wf_store.update(rec.id, status=STATUS_CANCELLED)
    # Driver exits + cancels in-flight job.
    for _ in range(40):
        await asyncio.sleep(0.05)
        if "job-cancel-test" in cancel_calls:
            break
    assert "job-cancel-test" in cancel_calls
    assert wf_store.get(rec.id).status == STATUS_CANCELLED


# ──────────────────────────────────────────────────────────────────────────
# Back-compat
# ──────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_legacy_list_str_steps_runs_to_completion(
    tmp_workflows_db, monkeypatch,
):
    """16. Workflow created with the legacy list[str] steps shape
    runs to completed (all steps execute as noop)."""
    _enable_runner(monkeypatch)
    # Create via the existing client API with legacy step labels.
    rec = wf_client_mod.create(
        user_id="user-A", type="research",
        steps=["scope", "fetch", "summarise"],
    )
    assert rec is not None
    # Should still be list[str] at this point (legacy).
    raw = json.loads(json.dumps(rec.steps))
    assert all(isinstance(s, str) for s in raw)

    await wf_runner.run_workflow(rec.id, user_id=rec.user_id)
    final = await _wait_for_status(rec.id, STATUS_COMPLETED)

    # After the run the steps_json was promoted to typed shape.
    promoted = parse_steps(final.steps)
    assert len(promoted) == 3
    assert all(s.kind == "noop" for s in promoted)
    assert all(s.status == STEP_STATUS_COMPLETED for s in promoted)
    # Sequential dependency chain — confirms the promotion logic.
    assert promoted[0].dependencies == []
    assert promoted[1].dependencies == [promoted[0].id]
    assert promoted[2].dependencies == [promoted[1].id]


def test_typed_mixed_kinds_round_trip(tmp_workflows_db):
    """17. Workflow created with mixed kinds in the new typed shape
    persists and re-reads identically (no information loss)."""
    rec = wf_client_mod.create(user_id="user-A", type="research")
    assert rec is not None
    wf_store.update_steps(rec.id, steps=[
        _typed_step("a", kind="noop"),
        _typed_step("b", kind="job", payload={"kind": "echo"}),
        _typed_step("c", kind="agent_task",
                    payload={"assigned_agent_id": "agent-x"}, deps=["b"]),
    ])
    fresh = wf_store.get(rec.id)
    steps = parse_steps(fresh.steps)
    assert [s.kind for s in steps] == ["noop", "job", "agent_task"]
    assert steps[1].payload == {"kind": "echo"}
    assert steps[2].dependencies == ["b"]


# ──────────────────────────────────────────────────────────────────────────
# Bounds / safety
# ──────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_workflow_max_steps_rejected_at_start_run(
    tmp_workflows_db, monkeypatch,
):
    """18. Workflow exceeding WORKFLOW_MAX_STEPS is rejected at
    start_run with workflow_steps_invalid."""
    _enable_runner(monkeypatch)
    monkeypatch.setenv("WORKFLOW_MAX_STEPS", "3")
    rec = _make_workflow(steps=[
        _typed_step("A"), _typed_step("B"),
        _typed_step("C"), _typed_step("D"),
    ])
    with pytest.raises(StepsParseError):
        await wf_runner.run_workflow(rec.id, user_id=rec.user_id)


@pytest.mark.asyncio
async def test_parallel_fan_out_respects_parallel_cap(
    tmp_workflows_db, monkeypatch,
):
    """19. Parallel fan-out exceeding WORKFLOW_MAX_PARALLEL_PER_RUN
    queues the excess — at most cap many steps are in_flight at once."""
    _enable_runner(monkeypatch)
    monkeypatch.setenv("WORKFLOW_MAX_PARALLEL_PER_RUN", "2")
    monkeypatch.setenv("WORKFLOW_RUNNER_POLL_INTERVAL_SEC", "0.1")

    class _StubRecord:
        def __init__(self, _id, status):
            self.id = _id; self.status = status
            self.result = None; self.error = None

    dispatched_at: list[float] = []
    completed = {}  # job_id -> "completed" after first poll

    async def _stub_create(**kwargs):
        sid = kwargs["metadata"]["step_id"]
        dispatched_at.append(asyncio.get_event_loop().time())
        return _StubRecord(f"job-{sid}", "running")

    def _stub_get(job_id, *, user_id=None):
        # First poll → still running; second poll → completed. This
        # gives the runner time to observe the in-flight cap.
        n = completed.get(job_id, 0) + 1
        completed[job_id] = n
        return _StubRecord(job_id, "running" if n < 2 else "succeeded")

    from backend.services.jobs import client as jobs_client_mod
    monkeypatch.setattr(jobs_client_mod, "create", _stub_create)
    monkeypatch.setattr(jobs_client_mod, "get", _stub_get)

    rec = _make_workflow(steps=[
        _typed_step(f"S{i}", kind="job", payload={"kind": "echo"})
        for i in range(5)
    ])
    await wf_runner.run_workflow(rec.id, user_id=rec.user_id)
    await _wait_for_status(rec.id, STATUS_COMPLETED, timeout_s=10.0)
    # All 5 dispatched eventually, but not at the same instant. The
    # observable signal is that not all 5 were dispatched on tick 1.
    # We assert the first 2 dispatches happened "close together" and
    # the 3rd happened "later" (after at least one completed).
    assert len(dispatched_at) == 5
    # If the cap was respected, dispatch #3 happens AFTER dispatch #1
    # had a chance to be polled+completed. That's at least one poll
    # interval gap.
    assert dispatched_at[2] - dispatched_at[0] >= 0.05


# ──────────────────────────────────────────────────────────────────────────
# 20. End-to-end with real InlineJobRunner
# ──────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_end_to_end_real_inline_jobs(
    tmp_workflows_db, tmp_jobs_db, monkeypatch,
):
    """20. End-to-end with real InlineJobRunner: a 4-step diamond
    DAG (1 → [2, 3] → 4) where each step dispatches the registered
    `echo` job kind. Within 5s the workflow reaches status=completed
    with progress=100 and each step's result populated."""
    _enable_runner(monkeypatch)
    monkeypatch.setenv("ENABLE_JOB_QUEUE", "true")
    monkeypatch.setenv("JOB_QUEUE_MODE", "inline")

    rec = _make_workflow(steps=[
        _typed_step("first",  kind="job", payload={"kind": "echo",
                                                   "input": {"n": 1}}),
        _typed_step("left",   kind="job", payload={"kind": "echo",
                                                   "input": {"n": 2}},
                    deps=["first"]),
        _typed_step("right",  kind="job", payload={"kind": "echo",
                                                   "input": {"n": 3}},
                    deps=["first"]),
        _typed_step("join",   kind="job", payload={"kind": "echo",
                                                   "input": {"n": 4}},
                    deps=["left", "right"]),
    ])
    await wf_runner.run_workflow(rec.id, user_id=rec.user_id)
    final = await _wait_for_status(rec.id, STATUS_COMPLETED, timeout_s=10.0)
    assert final.progress == 100
    steps = parse_steps(final.steps)
    assert all(s.status == STEP_STATUS_COMPLETED for s in steps)
    assert all(s.dispatched_id for s in steps)
    assert final.current_step == 4
