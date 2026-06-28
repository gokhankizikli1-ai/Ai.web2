# coding: utf-8
"""Phase A.1 — Workflow DAG Runner.

Re-entrant async executor for `WorkflowRecord`s. Reads the typed step
graph from `steps_json`, resolves eligible steps via topological
order, dispatches each to either a job (`JobsClient`) or an agent
task (`AgentTasksClient`), polls for completion, and advances the
workflow's `status` / `current_step` / `progress` until it reaches a
terminal state.

Design (matches the approved PR #1 design document):

  * Re-entrant: every decision derives from current DB state. A driver
    that dies mid-run can be safely re-started — `sweep_orphans()`
    re-attaches drivers to workflows whose `status == "running"` after
    process restart.

  * Per-workflow `asyncio.Lock`: a second `run_workflow(id)` call
    while a driver is alive raises `WorkflowAlreadyRunningError`
    (mapped to 409 by the route).

  * Polling-only completion observation: both jobs and agent_tasks are
    observed by periodic store reads (default 1s). Avoids the
    subscribe-after-publish race and keeps the runner free of
    event-bus coupling.

  * Failure handling: when any step fails, the workflow transitions to
    `failed`. Pending steps whose dependencies include the failed one
    are marked `skipped`. In-flight spawned jobs/tasks are cancelled
    best-effort.

  * Cancel: an external `cancel_workflow(workflow_id)` flips the
    workflow's status to `cancelled`. The driver detects this on its
    next poll tick and stops; in-flight spawned resources are cancelled
    best-effort.
"""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Optional

from backend.services.workflows import store as wf_store
from backend.services.workflows.events import CompletionEvent
from backend.services.workflows.steps import (
    MAX_PARALLEL_PER_RUN_HARD_CAP,
    MAX_STEPS_HARD_CAP,
    STEP_STATUS_COMPLETED,
    STEP_STATUS_DISPATCHED,
    STEP_STATUS_FAILED,
    STEP_STATUS_PENDING,
    STEP_STATUS_RUNNING,
    STEP_STATUS_SKIPPED,
    Step,
    StepsParseError,
    eligible_step_ids,
    parse_steps,
    steps_to_json,
    validate_for_run,
)
from backend.services.workflows.types import (
    STATUS_CANCELLED,
    STATUS_COMPLETED,
    STATUS_FAILED,
    STATUS_RUNNING,
    TERMINAL_WORKFLOW_STATUSES,
)


logger = logging.getLogger(__name__)


# ── Errors ──────────────────────────────────────────────────────────────────

class WorkflowRunnerDisabled(RuntimeError):
    code = "workflow_runner_disabled"


class WorkflowNotFound(LookupError):
    code = "workflow_not_found"


class WorkflowAlreadyTerminalError(RuntimeError):
    code = "workflow_already_terminal"


class WorkflowAlreadyRunningError(RuntimeError):
    code = "workflow_already_running"


# ── Env ─────────────────────────────────────────────────────────────────────

def is_enabled() -> bool:
    """Master gate for the runner.

    Defaults `false`. When off, `run_workflow` raises
    WorkflowRunnerDisabled, the route returns 503, and `sweep_orphans`
    is a no-op so the runner has zero blast radius on production until
    the flag is flipped.
    """
    return os.getenv("ENABLE_WORKFLOW_RUNNER", "false").strip().lower() == "true"


def _poll_interval_sec() -> float:
    try:
        v = float(os.getenv("WORKFLOW_RUNNER_POLL_INTERVAL_SEC", "1.0") or 1.0)
        return max(0.1, min(v, 30.0))
    except Exception:
        return 1.0


def _max_parallel_per_run() -> int:
    try:
        v = int(os.getenv("WORKFLOW_MAX_PARALLEL_PER_RUN",
                          str(MAX_PARALLEL_PER_RUN_HARD_CAP)) or
                MAX_PARALLEL_PER_RUN_HARD_CAP)
        return max(1, min(v, MAX_PARALLEL_PER_RUN_HARD_CAP))
    except Exception:
        return MAX_PARALLEL_PER_RUN_HARD_CAP


def _max_steps() -> int:
    try:
        v = int(os.getenv("WORKFLOW_MAX_STEPS",
                          str(MAX_STEPS_HARD_CAP)) or MAX_STEPS_HARD_CAP)
        return max(1, min(v, MAX_STEPS_HARD_CAP))
    except Exception:
        return MAX_STEPS_HARD_CAP


# ── Module-level coordination ──────────────────────────────────────────────

# Per-workflow asyncio.Lock — a second `run_workflow(id)` call while a
# driver is alive will see the lock held and raise
# WorkflowAlreadyRunningError. Cleaned up when the driver finishes.
_WORKFLOW_LOCKS: dict[str, asyncio.Lock] = {}

# Per-workflow live driver task — used by `sweep_orphans` to tell
# resumable workflows apart from those with an in-process driver
# already attached.
_LIVE_DRIVERS: dict[str, asyncio.Task] = {}


def _get_or_create_lock(workflow_id: str) -> asyncio.Lock:
    lock = _WORKFLOW_LOCKS.get(workflow_id)
    if lock is None:
        lock = asyncio.Lock()
        _WORKFLOW_LOCKS[workflow_id] = lock
    return lock


def _reset_for_tests() -> None:
    """Reset module-level state between tests. Cancels any in-flight
    driver tasks so the next test starts on a clean slate."""
    for task in list(_LIVE_DRIVERS.values()):
        try:
            task.cancel()
        except Exception:
            pass
    _LIVE_DRIVERS.clear()
    _WORKFLOW_LOCKS.clear()


# ── Helpers ─────────────────────────────────────────────────────────────────

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _persist_steps(workflow_id: str, steps: list[Step]) -> None:
    """Write the typed step list back to `workflows.steps_json`.

    Also recomputes derived counters (`current_step`, `progress`) so
    the existing REST API surface (`GET /v2/workflows/{id}`) keeps
    returning a meaningful progress percentage.
    """
    total = max(1, len(steps))
    completed = sum(1 for s in steps if s.status == STEP_STATUS_COMPLETED)
    in_flight = sum(1 for s in steps if s.is_in_flight)
    current_step = completed + in_flight  # "we've moved past this many"
    progress = int(round(100 * completed / total))
    wf_store.update_steps(
        workflow_id,
        steps=steps_to_json(steps),
        current_step=min(current_step, total),
        progress=min(progress, 100),
    )


# ── Public entry points ────────────────────────────────────────────────────

async def run_workflow(workflow_id: str, *, user_id: Optional[str] = None) -> dict:
    """Start a driver for `workflow_id`.

    Returns a snapshot of the workflow's initial state immediately
    (drives in the background). Raises:
      - WorkflowRunnerDisabled    (flag off)
      - WorkflowNotFound          (id unknown OR belongs to other user)
      - WorkflowAlreadyTerminalError
      - WorkflowAlreadyRunningError
      - StepsParseError           (bad steps_json OR cycle OR cap exceed)

    Re-entry: if a driver is already alive for this workflow_id, the
    second caller raises WorkflowAlreadyRunningError. This is detected
    via the per-workflow asyncio.Lock — NOT by inspecting workflow
    status (status can be `running` legitimately after a server restart
    with no driver attached, which is what `resume_workflow` handles).
    """
    if not is_enabled():
        raise WorkflowRunnerDisabled(
            "Workflow runner is disabled. Set ENABLE_WORKFLOW_RUNNER=true."
        )

    rec = wf_store.get(workflow_id)
    if rec is None:
        raise WorkflowNotFound(workflow_id)
    if user_id is not None and rec.user_id != str(user_id):
        # Hide the existence of cross-user records — match the
        # convention used by other v2 routes.
        raise WorkflowNotFound(workflow_id)
    if rec.status in TERMINAL_WORKFLOW_STATUSES:
        raise WorkflowAlreadyTerminalError(
            f"workflow {workflow_id} is already {rec.status}"
        )

    lock = _get_or_create_lock(workflow_id)
    if lock.locked():
        raise WorkflowAlreadyRunningError(
            f"workflow {workflow_id} already has a live driver"
        )

    # Parse steps now so the caller gets cycle / cap errors synchronously
    # before we spawn the driver task. Persisted typed shape (so legacy
    # `list[str]` workflows get promoted on first run).
    try:
        steps = parse_steps(rec.steps)
        validate_for_run(steps, max_steps=_max_steps())
    except StepsParseError:
        raise

    # Persist the (possibly promoted) typed shape so the driver and any
    # observer reads the same data.
    _persist_steps(workflow_id, steps)
    wf_store.update(workflow_id, status=STATUS_RUNNING)

    # CRITICAL — acquire the per-workflow lock SYNCHRONOUSLY (within
    # `run_workflow`) so that by the time we return, a second
    # concurrent caller sees `lock.locked() == True` and raises
    # WorkflowAlreadyRunningError. If we let the driver task acquire
    # the lock on its first tick, there's a race window where the
    # second call can sneak through before the task is scheduled.
    await lock.acquire()
    # Build the driver task. The driver loop is responsible for
    # releasing the lock in its `finally` block. We register the task
    # in _LIVE_DRIVERS before awaiting anything so a fast-failing
    # driver doesn't leave a stale registry entry.
    task = asyncio.create_task(
        _driver_loop(workflow_id, lock),
        name=f"workflow-runner-{workflow_id}",
    )
    _LIVE_DRIVERS[workflow_id] = task

    # Return a snapshot now — caller can poll GET /v2/workflows/{id}
    # for progress.
    fresh = wf_store.get(workflow_id)
    return _snapshot_for_response(fresh, steps)


async def resume_workflow(workflow_id: str) -> Optional[asyncio.Task]:
    """Attach a driver to a workflow that was `status=running` but has
    no live driver. Used by `sweep_orphans` at startup.

    Idempotent: if a driver is already alive for this workflow, returns
    that task without spawning a new one. Returns None if the workflow
    is terminal, missing, or has malformed steps.
    """
    if not is_enabled():
        return None
    rec = wf_store.get(workflow_id)
    if rec is None or rec.status in TERMINAL_WORKFLOW_STATUSES:
        return None
    existing = _LIVE_DRIVERS.get(workflow_id)
    if existing is not None and not existing.done():
        return existing
    try:
        steps = parse_steps(rec.steps)
        validate_for_run(steps, max_steps=_max_steps())
    except StepsParseError as exc:
        logger.warning(
            "workflow_runner.resume_workflow: invalid steps for %s — "
            "marking failed: %s", workflow_id, exc,
        )
        wf_store.update(
            workflow_id, status=STATUS_FAILED,
            result={"error": "driver_died_during_run", "detail": str(exc)},
        )
        return None
    _persist_steps(workflow_id, steps)
    lock = _get_or_create_lock(workflow_id)
    if lock.locked():
        # Another caller already attached a driver in the gap between
        # our resume check and now. Yield to that driver — don't try
        # to double-attach.
        return _LIVE_DRIVERS.get(workflow_id)
    # Same synchronous-acquire pattern as `run_workflow`.
    await lock.acquire()
    task = asyncio.create_task(
        _driver_loop(workflow_id, lock),
        name=f"workflow-runner-{workflow_id}",
    )
    _LIVE_DRIVERS[workflow_id] = task
    logger.info("workflow_runner.resume_workflow | resumed %s", workflow_id)
    return task


async def sweep_orphans() -> int:
    """Resume drivers for every workflow that is `status=running` but
    has no live driver in this process. Returns the number of
    workflows that were resumed.

    Called once at API startup (see backend/api.py). Safe to call
    repeatedly — re-entrant via `resume_workflow`. No-op when the
    runner flag is off.
    """
    if not is_enabled():
        return 0
    try:
        rows = wf_store.list_running()
    except Exception as exc:
        logger.warning("workflow_runner.sweep_orphans list error: %s", exc)
        return 0
    resumed = 0
    for row in rows:
        if row.id is None:
            continue
        existing = _LIVE_DRIVERS.get(row.id)
        if existing is not None and not existing.done():
            continue
        task = await resume_workflow(row.id)
        if task is not None:
            resumed += 1
    if resumed:
        logger.info("workflow_runner.sweep_orphans | resumed %d workflows", resumed)
    return resumed


# ── Driver loop ─────────────────────────────────────────────────────────────

async def _driver_loop(workflow_id: str, lock: asyncio.Lock) -> None:
    """The actual executor. The per-workflow lock is acquired by
    `run_workflow` (or `resume_workflow`) BEFORE the task is spawned,
    so by the time this function starts, `lock.locked()` is already
    True. The driver is only responsible for releasing the lock in
    its `finally` block so a crash or cancel never leaves stale state.
    """
    try:
        await _driver_loop_inner(workflow_id)
    except asyncio.CancelledError:
        # External cancel (e.g. from sweep_orphans replacement OR
        # test_reset). Persist current state and let the cancel
        # propagate. Workflow status is left as-is — the next run /
        # resume will pick up from current step state.
        logger.info("workflow_runner | driver cancelled for %s", workflow_id)
        raise
    except Exception as exc:                                    # pragma: no cover
        logger.exception(
            "workflow_runner | driver crashed for %s: %s", workflow_id, exc,
        )
        try:
            wf_store.update(
                workflow_id, status=STATUS_FAILED,
                result={"error": "driver_died_during_run", "detail": str(exc)},
            )
        except Exception:
            pass
    finally:
        # Order matters: drop the live-driver pointer BEFORE releasing
        # the lock so a `run_workflow` call that fires the instant the
        # lock releases sees `_LIVE_DRIVERS` consistent with the
        # workflow's now-terminal state.
        _LIVE_DRIVERS.pop(workflow_id, None)
        try:
            lock.release()
        except RuntimeError:                                    # pragma: no cover
            pass


async def _driver_loop_inner(workflow_id: str) -> None:
    """Repeatedly: load state → check cancel → dispatch eligible
    steps → poll in-flight → advance terminal state. Exits when the
    workflow reaches a terminal status.

    Failure semantics:
      - On any step `failed`, mark workflow `failed`, skip pending
        steps that transitively depended on the failure, cancel
        in-flight spawned jobs/tasks best-effort, exit.
      - On user cancel (workflow status flipped externally to
        `cancelled`), cancel in-flight resources, exit. Workflow
        status stays `cancelled`.
      - On all steps `completed`, mark workflow `completed` and exit.
    """
    poll_interval = _poll_interval_sec()
    parallel_cap = _max_parallel_per_run()

    while True:
        rec = wf_store.get(workflow_id)
        if rec is None:
            logger.warning(
                "workflow_runner | %s vanished during driver loop", workflow_id,
            )
            return
        if rec.status == STATUS_CANCELLED:
            await _cancel_in_flight(rec.user_id, parse_steps(rec.steps))
            return
        if rec.status in TERMINAL_WORKFLOW_STATUSES:
            return

        steps = parse_steps(rec.steps)

        # Reconcile in-flight steps from store state. This is what makes
        # the loop polling-based: we re-read the job / agent_task status
        # for every dispatched step every tick. When a spawned resource
        # has reached a terminal status, we mark the step accordingly.
        any_change = await _reconcile_in_flight(rec.user_id, steps)

        # Did any step fail? Transition workflow to failed.
        failed = next(
            (s for s in steps if s.status == STEP_STATUS_FAILED), None,
        )
        if failed is not None:
            # Skip pending steps that transitively depended on the
            # failure. Conservative: skip ALL pending so the workflow
            # finishes deterministically; transitive-only would require
            # graph walking and adds complexity for marginal benefit.
            for s in steps:
                if s.status == STEP_STATUS_PENDING:
                    s.status = STEP_STATUS_SKIPPED
                    s.finished_at = _now_iso()
            _persist_steps(workflow_id, steps)
            await _cancel_in_flight(rec.user_id, steps)
            wf_store.update(
                workflow_id, status=STATUS_FAILED,
                result={
                    "error":   "step_failed",
                    "step_id": failed.id,
                    "label":   failed.label,
                    "detail":  failed.error or "step failed without detail",
                },
            )
            return

        # All steps terminal AND none failed → success.
        if all(s.is_terminal for s in steps):
            _persist_steps(workflow_id, steps)
            wf_store.update(
                workflow_id, status=STATUS_COMPLETED,
                result={"steps": [s.to_dict() for s in steps]},
            )
            return

        # Dispatch eligible steps up to the parallel cap.
        in_flight = sum(1 for s in steps if s.is_in_flight)
        capacity = max(0, parallel_cap - in_flight)
        if capacity > 0:
            for step_id in eligible_step_ids(steps)[:capacity]:
                step = next(s for s in steps if s.id == step_id)
                await _dispatch_step(rec.user_id, rec.project_id, workflow_id, step)
                any_change = True

        if any_change:
            _persist_steps(workflow_id, steps)

        await asyncio.sleep(poll_interval)


# ── Dispatch ────────────────────────────────────────────────────────────────

async def _dispatch_step(
    user_id: str,
    project_id: Optional[str],
    workflow_id: str,
    step: Step,
) -> None:
    """Mark step `dispatched`. For `noop`, also mark `completed`
    immediately (no underlying resource). For `job` / `agent_task`,
    spawn the underlying resource and record its id."""
    step.started_at = _now_iso()
    if step.kind == "noop":
        step.status = STEP_STATUS_COMPLETED
        step.finished_at = step.started_at
        step.result = {"kind": "noop"}
        return
    if step.kind == "job":
        try:
            from backend.services.jobs.client import client as jobs_client
        except Exception as exc:
            step.status = STEP_STATUS_FAILED
            step.error = f"jobs client import failed: {exc}"
            step.finished_at = _now_iso()
            return
        job_kind = (step.payload or {}).get("kind")
        if not job_kind:
            step.status = STEP_STATUS_FAILED
            step.error = "job step payload missing required `kind` field"
            step.finished_at = _now_iso()
            return
        try:
            record = await jobs_client.create(
                user_id=    user_id,
                kind=       str(job_kind),
                payload=    (step.payload or {}).get("input") or {},
                project_id= project_id,
                metadata=   {
                    "workflow_id": workflow_id,
                    "step_id":     step.id,
                },
            )
        except Exception as exc:
            step.status = STEP_STATUS_FAILED
            step.error = f"job dispatch failed: {exc}"
            step.finished_at = _now_iso()
            return
        step.dispatched_id = record.id
        step.status = STEP_STATUS_DISPATCHED
        return
    if step.kind == "agent_task":
        try:
            from backend.services.agent_tasks.client import client as at_client
        except Exception as exc:
            step.status = STEP_STATUS_FAILED
            step.error = f"agent_tasks client import failed: {exc}"
            step.finished_at = _now_iso()
            return
        assigned = (step.payload or {}).get("assigned_agent_id")
        description = (step.payload or {}).get("task_description") or step.label
        if not assigned:
            step.status = STEP_STATUS_FAILED
            step.error = (
                "agent_task step payload missing required "
                "`assigned_agent_id` field"
            )
            step.finished_at = _now_iso()
            return
        try:
            record = at_client.create(
                user_id=           user_id,
                assigned_agent_id= str(assigned),
                task_description=  str(description),
                project_id=        project_id,
                payload=           (step.payload or {}).get("input") or {},
                metadata=          {
                    "workflow_id": workflow_id,
                    "step_id":     step.id,
                },
            )
        except Exception as exc:
            step.status = STEP_STATUS_FAILED
            step.error = f"agent_task dispatch failed: {exc}"
            step.finished_at = _now_iso()
            return
        if record is None:
            # Most likely cause: ENABLE_AGENT_ORCHESTRATION=false.
            step.status = STEP_STATUS_FAILED
            step.error = (
                "agent_task dispatch returned None — likely "
                "ENABLE_AGENT_ORCHESTRATION=false"
            )
            step.finished_at = _now_iso()
            return
        step.dispatched_id = record.id
        step.status = STEP_STATUS_DISPATCHED
        return
    # Unknown kind — parse_steps would have already rejected this, but
    # defensively mark the step failed instead of looping forever.
    step.status = STEP_STATUS_FAILED
    step.error = f"unknown step kind: {step.kind}"
    step.finished_at = _now_iso()


# ── Completion reconciliation ──────────────────────────────────────────────

async def _reconcile_in_flight(user_id: str, steps: list[Step]) -> bool:
    """For each in-flight step, poll its spawned job / agent_task and
    update the step's status if the underlying resource has reached a
    terminal state. Returns True if any step changed.

    Errors during polling are logged and ignored — the next tick will
    retry. We do NOT mark a step failed just because its lookup
    transiently errored.
    """
    any_change = False
    for step in steps:
        if not step.is_in_flight:
            continue
        if step.dispatched_id is None:
            # Shouldn't happen; defensively mark failed so the
            # workflow doesn't hang forever.
            step.status = STEP_STATUS_FAILED
            step.error = "in-flight step has no dispatched_id"
            step.finished_at = _now_iso()
            any_change = True
            continue
        if step.kind == "job":
            new_status, result, error = await _poll_job(user_id, step.dispatched_id)
        elif step.kind == "agent_task":
            new_status, result, error = _poll_agent_task(user_id, step.dispatched_id)
        else:
            continue  # noop steps are never in-flight
        if new_status is None:
            continue
        if new_status != step.status:
            step.status = new_status
            if new_status in (STEP_STATUS_COMPLETED, STEP_STATUS_FAILED):
                step.finished_at = _now_iso()
                step.result = result
                step.error = error
            any_change = True
    return any_change


async def _poll_job(user_id: str, job_id: str) -> tuple[Optional[str], Optional[dict], Optional[str]]:
    """Return (step_status, result, error) reading the job's current
    DB status. Returns (None, None, None) if the job is still in a
    non-terminal state (driver keeps polling)."""
    try:
        from backend.services.jobs.client import client as jobs_client
        from backend.services.jobs.types import (
            STATUS_SUCCEEDED, STATUS_FAILED as JOB_FAILED,
            STATUS_CANCELLED as JOB_CANCELLED, STATUS_FAILED_DLQ,
            STATUS_RUNNING as JOB_RUNNING,
        )
    except Exception:                                            # pragma: no cover
        return None, None, None
    try:
        record = jobs_client.get(job_id, user_id=user_id)
    except Exception:
        return None, None, None
    if record is None:
        return STEP_STATUS_FAILED, None, "spawned job disappeared from store"
    if record.status == STATUS_SUCCEEDED:
        return STEP_STATUS_COMPLETED, getattr(record, "result", None), None
    if record.status in (JOB_FAILED, STATUS_FAILED_DLQ):
        err = getattr(record, "error", None) or "job failed"
        return STEP_STATUS_FAILED, None, str(err)
    if record.status == JOB_CANCELLED:
        return STEP_STATUS_FAILED, None, "job cancelled externally"
    if record.status == JOB_RUNNING:
        return STEP_STATUS_RUNNING, None, None
    # queued, retrying — keep waiting.
    return None, None, None


def _poll_agent_task(user_id: str, task_id: str) -> tuple[Optional[str], Optional[dict], Optional[str]]:
    """Return (step_status, result, error) reading the agent_task's
    current DB status. Mirror of `_poll_job` for the agent-task path."""
    try:
        from backend.services.agent_tasks.client import client as at_client
        from backend.services.agent_tasks.types import (
            STATUS_COMPLETED as AT_COMPLETED,
            STATUS_FAILED    as AT_FAILED,
            STATUS_CANCELLED as AT_CANCELLED,
            STATUS_RUNNING   as AT_RUNNING,
        )
    except Exception:                                            # pragma: no cover
        return None, None, None
    try:
        record = at_client.get(task_id, user_id=user_id)
    except Exception:
        return None, None, None
    if record is None:
        return STEP_STATUS_FAILED, None, "spawned agent_task disappeared from store"
    if record.status == AT_COMPLETED:
        return STEP_STATUS_COMPLETED, getattr(record, "result", None), None
    if record.status == AT_FAILED:
        err = (getattr(record, "result", None) or {}).get("error") or "agent_task failed"
        return STEP_STATUS_FAILED, None, str(err)
    if record.status == AT_CANCELLED:
        return STEP_STATUS_FAILED, None, "agent_task cancelled externally"
    if record.status == AT_RUNNING:
        return STEP_STATUS_RUNNING, None, None
    return None, None, None


async def _cancel_in_flight(user_id: str, steps: list[Step]) -> None:
    """Best-effort cancellation of every in-flight spawned job / task.

    Failures are logged and swallowed — the workflow is already
    transitioning to a terminal state; we don't want a flaky cancel
    to leak an exception out of the driver loop.
    """
    for step in steps:
        if not step.is_in_flight or step.dispatched_id is None:
            continue
        if step.kind == "job":
            try:
                from backend.services.jobs.client import client as jobs_client
                await jobs_client.cancel(step.dispatched_id, user_id=user_id)
            except Exception as exc:
                logger.warning(
                    "workflow_runner | job cancel failed step=%s job=%s err=%s",
                    step.id, step.dispatched_id, exc,
                )
        elif step.kind == "agent_task":
            try:
                from backend.services.agent_tasks.client import client as at_client
                at_client.cancel(step.dispatched_id, user_id=user_id)
            except Exception as exc:
                logger.warning(
                    "workflow_runner | agent_task cancel failed step=%s task=%s err=%s",
                    step.id, step.dispatched_id, exc,
                )


# ── Snapshot helper for the API response ───────────────────────────────────

def _snapshot_for_response(rec, steps: list[Step]) -> dict:
    """Trim a Step list to the FE-relevant fields. Keeps the response
    body small even for max-step workflows."""
    return {
        "workflow_id": rec.id if rec else None,
        "status":      rec.status if rec else None,
        "progress":    rec.progress if rec else 0,
        "steps":       [
            {
                "id":            s.id,
                "label":         s.label,
                "kind":          s.kind,
                "status":        s.status,
                "dependencies":  list(s.dependencies),
            }
            for s in steps
        ],
    }


__all__ = [
    "is_enabled",
    "run_workflow", "resume_workflow", "sweep_orphans",
    "WorkflowRunnerDisabled", "WorkflowNotFound",
    "WorkflowAlreadyTerminalError", "WorkflowAlreadyRunningError",
    "_reset_for_tests",
]
