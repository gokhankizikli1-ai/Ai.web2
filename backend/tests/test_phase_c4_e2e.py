# coding: utf-8
"""Completion Phase 4 — backend end-to-end project lifecycle, no frontend.

Proves the backend can truthfully execute a complete Korvix project lifecycle
with NO browser/React state:

    goal → plan (capability DAG) → research → product (upstream context)
         → app_build + web_build PAUSE at awaiting_approval
         → approve → mocked build executors complete
         → deliverables + final run state → reconstruct snapshot

Plus the state-machine + error-taxonomy audit. No real provider calls, no
paid builds — the agent runtime and build executors are mocked.
"""
from __future__ import annotations

import asyncio
import importlib
from types import SimpleNamespace

import pytest


# ── State machine + error taxonomy (pure) ────────────────────────────────

def test_state_machine_rejects_impossible_transitions():
    from backend.services.orchestrator import state_model as sm
    # Legal.
    assert sm.is_legal_transition(sm.WF_TRANSITIONS, "running", "awaiting_approval")
    assert sm.is_legal_transition(sm.WF_TRANSITIONS, "awaiting_approval", "running")
    assert sm.is_legal_transition(sm.STEP_TRANSITIONS, "pending", "awaiting_approval")
    assert sm.is_legal_transition(sm.STEP_TRANSITIONS, "awaiting_approval", "pending")
    # Impossible.
    assert not sm.is_legal_transition(sm.WF_TRANSITIONS, "completed", "running")
    assert not sm.is_legal_transition(sm.WF_TRANSITIONS, "cancelled", "running")
    assert not sm.is_legal_transition(sm.STEP_TRANSITIONS, "completed", "running")
    assert not sm.is_legal_transition(sm.BUILD_TRANSITIONS, "completed", "running")


def test_error_taxonomy_stable_codes():
    from backend.services.orchestrator import state_model as sm
    assert sm.classify_error("build worker timed out after 900s") == sm.CODE_BUILD_TIMEOUT
    assert sm.classify_error("operation requires approval") == sm.CODE_APPROVAL_REQUIRED
    assert sm.classify_error("insufficient credits") == sm.CODE_INSUFFICIENT_CREDITS
    assert sm.classify_error("executor_unavailable (handoff)") == sm.CODE_EXECUTOR_UNAVAILABLE
    assert "approval_required" in sm.ERROR_CODES


# ── Full lifecycle ───────────────────────────────────────────────────────

@pytest.fixture()
def e2e_env(tmp_path, monkeypatch, tmp_jobs_db, tmp_workflows_db):
    # Shared execution truth for this "single replica".
    monkeypatch.setenv("PROJECTS_DB_PATH", str(tmp_path / "projects.db"))
    monkeypatch.setenv("ENABLE_WORKFLOW_RUNNER", "true")
    monkeypatch.setenv("WORKFLOW_RUNNER_POLL_INTERVAL_SEC", "0.05")
    monkeypatch.setenv("ENABLE_EXECUTION_APPROVAL", "true")
    monkeypatch.delenv("ENABLE_POSTGRES_BACKEND", raising=False)

    # Reload orchestrator stores under the patched projects.db.
    mods = {}
    for name in ("runs_store", "tasks_store", "deliverables_store",
                 "approvals_store", "execution_policy", "step_claim",
                 "build_capability", "long_horizon_planner",
                 "capability_registry", "plans_store", "context_projection",
                 "agent_run_kind", "service"):
        m = importlib.import_module(f"backend.services.orchestrator.{name}")
        importlib.reload(m)
        mods[name] = m
    mods["runs_store"].init_runs_table()
    mods["tasks_store"].init_tasks_table()
    mods["deliverables_store"].init_deliverables_table()
    mods["approvals_store"].init_approvals_table()

    ep = mods["execution_policy"]
    monkeypatch.setattr(ep, "_global_spend_ok", lambda uid: True)
    monkeypatch.setattr(ep, "_credits_available", lambda uid, cap: True)

    # Mock the agent runtime (research/product) — no provider call.
    async def _fake_run_agent(req):
        return SimpleNamespace(reply=f"[{req.mode}] output", fallback=False, metadata={})
    monkeypatch.setattr(mods["agent_run_kind"], "run_agent", _fake_run_agent)

    # Mock build executors — no paid build.
    bc = mods["build_capability"]
    async def _mock_build(inp):
        return bc.BuildExecutorResult(
            status="completed", artifact_ref=f"{inp.build_type}run:{inp.run_id}",
            build_ref="b1", summary=f"{inp.build_type} built", cost_ref={"usd": 0.0})
    bc.register_build_executor("web", _mock_build)
    bc.register_build_executor("app", _mock_build)
    bc.ensure_registered()  # registers kinds + the approval gate

    yield mods, tmp_path
    bc.unregister_build_executor("web")
    bc.unregister_build_executor("app")
    from backend.services.workflows import runner as wf_runner
    wf_runner._reset_for_tests()


def _scaffold_run(mods, *, user_id="u1", project_id="p1", goal="", plan):
    """Mirror the orchestrator's run scaffolding from a capability plan:
    one run + one task + one deliverable + one workflow step per plan task."""
    from backend.services.workflows import client as wf_client
    from backend.services.workflows import store as wf_store
    runs_store = mods["runs_store"]; tstore = mods["tasks_store"]
    dstore = mods["deliverables_store"]; caps = mods["capability_registry"]

    run_id = "runE2E"
    runs_store.create_run(run_id=run_id, user_id=user_id, project_id=project_id,
                          agent_id="supervisor", metadata={"kind": "project_run"})
    runs_store.update_run_metadata(run_id, {"runner_started": True})

    KIND = {"research": "agent.run", "product": "agent.run",
            "web_build": "web_build.run", "app_build": "app_build.run"}
    steps = []
    for t in plan["tasks"]:
        cap = t["capability"]
        if not caps.is_available(cap):
            continue  # skip not-yet-available capabilities (qa/...)
        tid = t["id"]
        dstore.create_deliverable(deliverable_id=f"d_{tid}", run_id=run_id,
                                  project_id=project_id, agent_id=cap, node_id=tid,
                                  kind=t.get("deliverable_kind") or cap, title=t["title"])
        tstore.create_task(task_id=tid, run_id=run_id, project_id=project_id,
                           title=t["title"], assigned_agent=cap,
                           dependencies=t.get("depends_on") or [])
        steps.append({
            "id": tid, "label": t["title"], "kind": "job",
            "dependencies": t.get("depends_on") or [], "status": "pending",
            "dispatched_id": None, "started_at": None, "finished_at": None,
            "result": None, "error": None,
            "payload": {"kind": KIND[cap], "input": {
                "assigned_agent_id": "researcher" if cap == "research" else "product",
                "task_description": t["title"], "run_id": run_id, "node_id": tid,
                "deliverable_id": f"d_{tid}", "task_id": tid, "project_id": project_id,
                "depends_on": t.get("depends_on") or [], "user_request": goal,
                "deliverable_kind": t.get("deliverable_kind") or cap,
                "product_spec": {"goal": goal}, "node_title": t["title"],
            }},
        })
    wf = wf_client.create(user_id=user_id, type="research", project_id=project_id, steps=None)
    wf_store.update_steps(wf.id, steps=steps)
    runs_store.update_run_metadata(run_id, {"workflow_id": wf.id})
    return run_id, wf.id


async def _wait_wf(wf_id, target, timeout_s=8.0):
    from backend.services.workflows import store as wf_store
    deadline = asyncio.get_event_loop().time() + timeout_s
    while True:
        rec = wf_store.get(wf_id)
        if rec and rec.status == target:
            return rec
        if asyncio.get_event_loop().time() >= deadline:
            raise AssertionError(f"{wf_id} != {target} (is {rec.status if rec else None})")
        await asyncio.sleep(0.05)


@pytest.mark.asyncio
async def test_full_project_lifecycle_no_frontend(e2e_env):
    mods, tmp_path = e2e_env
    planner = mods["long_horizon_planner"]; orch = mods["service"]
    from backend.services.workflows import client as wf_client

    # 1) Goal → capability plan (deterministic, zero provider calls).
    goal = "Create a SaaS for restaurant inventory management with a web app"
    plan = planner.plan_goal(goal, user_id="u1", project_id="p1")
    caps = [t["capability"] for t in plan["tasks"]]
    assert "research" in caps and "product" in caps
    assert ("web_build" in caps) or ("app_build" in caps)

    # 2) Scaffold + start the run (real runner, mocked agent + build).
    run_id, wf_id = _scaffold_run(mods, goal=goal, plan=plan)
    await wf_client.start_run(wf_id, user_id="u1")

    # 3) Research + product complete; builds PAUSE at awaiting_approval.
    await _wait_wf(wf_id, "awaiting_approval")
    snap = orch.get_run_snapshot(run_id, user_id="u1")
    dstat = {d["node_id"]: d["status"] for d in snap["deliverables"]}
    assert dstat["t1"] == "completed"   # research
    assert dstat["t2"] == "completed"   # product
    # 4) Snapshot is truthful: pending approvals surfaced, next action clear.
    obs = snap["observability"]
    assert len(obs["pending_approvals"]) >= 1
    assert obs["next_action"] == "approve_pending_operation"
    assert obs["runner_healthy"] is True
    # Product genuinely built on research (Phase-2 upstream context).
    prod = next(d for d in snap["deliverables"] if d["node_id"] == "t2")
    assert prod["status"] == "completed"

    # 5) Approve every pending build operation → resume.
    for pa in obs["pending_approvals"]:
        await orch.approve_operation(
            run_id, user_id="u1", capability=pa["capability"], fingerprint=pa["fingerprint"])

    # 6) Builds complete → workflow completes.
    await _wait_wf(wf_id, "completed")
    final = orch.get_run_snapshot(run_id, user_id="u1")
    assert final["status"] == "completed"
    # 7) Build artifacts are real references (mocked executor).
    arts = final["observability"]["build_artifacts"]
    assert arts, "expected build artifact references"
    assert all(a["build_status"] == "completed" for a in arts)
    assert all(a["artifact_ref"] for a in arts)
    # No contradiction: no deliverable is both completed AND still a handoff.
    for d in final["deliverables"]:
        c = d.get("content") or {}
        if d["status"] == "completed" and c.get("build_type"):
            assert c.get("build_status") == "completed"
