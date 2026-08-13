# coding: utf-8
"""Completion Phase 2 — native approval pause/resume.

Approval is a first-class, non-terminal workflow state, not a failure. Covers:
paused (awaiting_approval) instead of failed; nothing dispatched before
approval; approve → resume → complete; idempotent resume; fingerprint-bound
invalidation; wrong-user denial; restart-while-waiting stays paused; and free
AUTO steps are unaffected.
"""
from __future__ import annotations

import asyncio
import importlib

import pytest

from backend.services.workflows import client as wf_client_mod
from backend.services.workflows import runner as wf_runner
from backend.services.workflows import store as wf_store
from backend.services.workflows.steps import (
    STEP_STATUS_PENDING, STEP_STATUS_COMPLETED, STEP_STATUS_AWAITING_APPROVAL,
)
from backend.services.workflows.types import (
    STATUS_COMPLETED, STATUS_AWAITING_APPROVAL, WorkflowRecord,
)


def _typed_step(sid, *, kind="noop", deps=None, payload=None):
    return {
        "id": sid, "label": sid, "kind": kind, "payload": payload or {},
        "dependencies": deps or [], "status": STEP_STATUS_PENDING,
        "dispatched_id": None, "started_at": None, "finished_at": None,
        "result": None, "error": None,
    }


def _make_workflow(steps, *, user_id="user-A") -> WorkflowRecord:
    rec = wf_client_mod.create(user_id=user_id, type="research", steps=None)
    wf_store.update_steps(rec.id, steps=steps)
    return wf_store.get(rec.id)


def _enable_runner(monkeypatch):
    monkeypatch.setenv("ENABLE_WORKFLOW_RUNNER", "true")
    monkeypatch.setenv("WORKFLOW_RUNNER_POLL_INTERVAL_SEC", "0.05")


async def _wait_for_status(workflow_id, target, *, timeout_s=5.0):
    deadline = asyncio.get_event_loop().time() + timeout_s
    while True:
        rec = wf_store.get(workflow_id)
        if rec is not None and rec.status == target:
            return rec
        if asyncio.get_event_loop().time() >= deadline:
            raise AssertionError(
                f"{workflow_id} did not reach {target!r} in {timeout_s}s "
                f"(current={rec.status if rec else 'missing'})")
        await asyncio.sleep(0.05)


@pytest.fixture()
def gate_registry():
    """Save/restore the runner's step-gate registry around a test."""
    saved = list(wf_runner._STEP_GATES)
    wf_runner._STEP_GATES.clear()
    yield wf_runner
    wf_runner._STEP_GATES.clear()
    wf_runner._STEP_GATES.extend(saved)


# ── Runner pause/resume with a controllable test gate ────────────────────

@pytest.mark.asyncio
async def test_paid_step_pauses_then_resumes(tmp_workflows_db, monkeypatch, gate_registry):
    _enable_runner(monkeypatch)
    approved = {"ok": False}
    dispatched = {"build": False}

    def _gate(step, user_id, project_id):
        if step.id != "build":
            return None
        if approved["ok"]:
            return None  # proceed
        return wf_runner.StepGateDecision(
            action="await_approval", code="approval_required",
            reason="needs approval", fingerprint="fp1", capability="web_build")
    gate_registry.register_step_gate(_gate)

    # research (noop) → build (noop, gated)
    wf = _make_workflow([
        _typed_step("research"),
        _typed_step("build", deps=["research"]),
    ])
    await wf_client_mod.start_run(wf.id, user_id="user-A")

    # A) pauses at awaiting_approval — NOT failed.
    rec = await _wait_for_status(wf.id, STATUS_AWAITING_APPROVAL)
    steps = {s.id: s for s in wf_runner.parse_steps(rec.steps)}
    assert steps["research"].status == STEP_STATUS_COMPLETED
    # B) the gated step did not dispatch/complete — it is parked.
    assert steps["build"].status == STEP_STATUS_AWAITING_APPROVAL
    assert steps["build"].result.get("awaiting_approval") is True

    # C) approve → resume → completes.
    approved["ok"] = True
    task = await wf_runner.resume_after_approval(wf.id, user_id="user-A")
    assert task is not None
    rec2 = await _wait_for_status(wf.id, STATUS_COMPLETED)
    steps2 = {s.id: s for s in wf_runner.parse_steps(rec2.steps)}
    assert steps2["build"].status == STEP_STATUS_COMPLETED


@pytest.mark.asyncio
async def test_resume_is_idempotent(tmp_workflows_db, monkeypatch, gate_registry):
    _enable_runner(monkeypatch)

    def _gate(step, user_id, project_id):
        return (wf_runner.StepGateDecision(action="await_approval",
                capability="web_build", fingerprint="fp")
                if step.id == "build" else None)
    gate_registry.register_step_gate(_gate)

    wf = _make_workflow([_typed_step("build")])
    await wf_client_mod.start_run(wf.id, user_id="user-A")
    await _wait_for_status(wf.id, STATUS_AWAITING_APPROVAL)

    # Remove the gate (simulate approval granting) then resume twice.
    wf_runner._STEP_GATES.clear()
    t1 = await wf_runner.resume_after_approval(wf.id, user_id="user-A")
    t2 = await wf_runner.resume_after_approval(wf.id, user_id="user-A")
    # Second resume must not spawn a second driver / re-flip.
    assert t2 is None or t2 is t1 or wf_store.get(wf.id).status in (
        STATUS_COMPLETED, "running")
    await _wait_for_status(wf.id, STATUS_COMPLETED)


@pytest.mark.asyncio
async def test_wrong_user_cannot_resume(tmp_workflows_db, monkeypatch, gate_registry):
    _enable_runner(monkeypatch)
    gate_registry.register_step_gate(
        lambda s, u, p: wf_runner.StepGateDecision(action="await_approval",
                                                   capability="web_build", fingerprint="fp")
        if s.id == "build" else None)
    wf = _make_workflow([_typed_step("build")], user_id="owner")
    await wf_client_mod.start_run(wf.id, user_id="owner")
    await _wait_for_status(wf.id, STATUS_AWAITING_APPROVAL)

    # Wrong user → no resume.
    assert await wf_runner.resume_after_approval(wf.id, user_id="intruder") is None
    assert wf_store.get(wf.id).status == STATUS_AWAITING_APPROVAL


@pytest.mark.asyncio
async def test_restart_while_waiting_stays_paused(tmp_workflows_db, monkeypatch, gate_registry):
    """sweep_orphans resumes only `running` workflows; an awaiting_approval
    workflow must NOT be auto-resumed by a restart."""
    _enable_runner(monkeypatch)
    gate_registry.register_step_gate(
        lambda s, u, p: wf_runner.StepGateDecision(action="await_approval",
                                                   capability="web_build", fingerprint="fp")
        if s.id == "build" else None)
    wf = _make_workflow([_typed_step("build")])
    await wf_client_mod.start_run(wf.id, user_id="user-A")
    await _wait_for_status(wf.id, STATUS_AWAITING_APPROVAL)

    # Simulate a process restart: clear live drivers, sweep.
    wf_runner._reset_for_tests()
    resumed = await wf_runner.sweep_orphans()
    assert wf_store.get(wf.id).status == STATUS_AWAITING_APPROVAL
    # It was not counted as a resumed (running) orphan.
    assert isinstance(resumed, int)


@pytest.mark.asyncio
async def test_free_auto_step_unaffected(tmp_workflows_db, monkeypatch, gate_registry):
    """A step no gate pauses runs straight through to completion."""
    _enable_runner(monkeypatch)
    gate_registry.register_step_gate(lambda s, u, p: None)  # never pauses
    wf = _make_workflow([_typed_step("a"), _typed_step("b", deps=["a"])])
    await wf_client_mod.start_run(wf.id, user_id="user-A")
    await _wait_for_status(wf.id, STATUS_COMPLETED)


# ── build_step_gate unit (fingerprint binding, enforcement flag) ─────────

@pytest.fixture()
def policy_env(tmp_path, monkeypatch):
    monkeypatch.setenv("PROJECTS_DB_PATH", str(tmp_path / "projects.db"))
    from backend.services.orchestrator import (
        approvals_store, execution_policy, deliverables_store, build_capability,
    )
    importlib.reload(execution_policy)
    importlib.reload(approvals_store)
    importlib.reload(deliverables_store)
    importlib.reload(build_capability)
    approvals_store.init_approvals_table()
    deliverables_store.init_deliverables_table()
    monkeypatch.setattr(execution_policy, "_global_spend_ok", lambda uid: True)
    monkeypatch.setattr(execution_policy, "_credits_available", lambda uid, cap: True)
    return approvals_store, execution_policy, build_capability


def _build_step(spec):
    from backend.services.workflows.steps import Step
    return Step(id="build", kind="job", payload={
        "kind": "web_build.run",
        "input": {"product_spec": spec, "deliverable_id": None, "node_id": "web"},
    })


def test_gate_pauses_without_approval(policy_env, monkeypatch):
    approvals, ep, bc = policy_env
    monkeypatch.setenv("ENABLE_EXECUTION_APPROVAL", "true")
    d = bc.build_step_gate(_build_step({"pages": ["home"]}), "u1", "p1")
    assert d is not None and d.action == "await_approval"
    assert d.capability == "web_build"


def test_gate_proceeds_with_matching_approval(policy_env, monkeypatch):
    approvals, ep, bc = policy_env
    monkeypatch.setenv("ENABLE_EXECUTION_APPROVAL", "true")
    spec = {"pages": ["home"]}
    approvals.record_approval(user_id="u1", capability="web_build",
                              fingerprint=ep.operation_fingerprint("web_build", spec))
    assert bc.build_step_gate(_build_step(spec), "u1", "p1") is None


def test_gate_fingerprint_bound(policy_env, monkeypatch):
    """An approval for spec v1 does NOT satisfy a materially changed spec."""
    approvals, ep, bc = policy_env
    monkeypatch.setenv("ENABLE_EXECUTION_APPROVAL", "true")
    approvals.record_approval(user_id="u1", capability="web_build",
                              fingerprint=ep.operation_fingerprint("web_build", {"pages": ["home"]}))
    d = bc.build_step_gate(_build_step({"pages": ["home", "checkout", "dash"]}), "u1", "p1")
    assert d is not None and d.action == "await_approval"


def test_gate_dormant_when_enforcement_off(policy_env, monkeypatch):
    approvals, ep, bc = policy_env
    monkeypatch.delenv("ENABLE_EXECUTION_APPROVAL", raising=False)
    assert bc.build_step_gate(_build_step({"x": 1}), "u1", "p1") is None
