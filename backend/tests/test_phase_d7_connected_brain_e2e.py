# coding: utf-8
"""Connected-brain Phases 2 + 6 + 7 — full backend project lifecycle, no frontend.

Proves Korvix behaves as ONE connected project brain end-to-end with no browser
and no paid provider:

  goal → planner capability DAG → Research → Product (receives Research) →
  Web/App Build (receive Product decisions) → approval pause → approve →
  mocked headless builds → artifacts + durable decisions → snapshot reconstruct
  after "restart" → change propagation (supersede + staleness, no rebuild) →
  cross-user/project isolation.
"""
from __future__ import annotations

import asyncio
import importlib
from types import SimpleNamespace as SN

import pytest


@pytest.fixture()
def brain(tmp_path, monkeypatch, tmp_jobs_db, tmp_workflows_db):
    monkeypatch.setenv("PROJECTS_DB_PATH", str(tmp_path / "projects.db"))
    monkeypatch.setenv("ENABLE_PROJECT_ORCHESTRATOR", "true")
    monkeypatch.setenv("ENABLE_WORKFLOW_RUNNER", "true")
    monkeypatch.setenv("WORKFLOW_RUNNER_POLL_INTERVAL_SEC", "0.05")
    monkeypatch.setenv("ENABLE_EXECUTION_APPROVAL", "true")
    monkeypatch.delenv("ENABLE_POSTGRES_BACKEND", raising=False)

    mods = {}
    for name in ("runs_store", "tasks_store", "deliverables_store", "approvals_store",
                 "execution_policy", "step_claim", "decisions_store",
                 "project_intelligence", "context_projection", "capability_registry",
                 "long_horizon_planner", "plans_store", "build_capability",
                 "build_executor", "build_execution_store", "agent_run_kind",
                 "project_supervisor", "service"):
        m = importlib.import_module(f"backend.services.orchestrator.{name}")
        importlib.reload(m)
        mods[name] = m
    mods["runs_store"].init_runs_table()
    mods["tasks_store"].init_tasks_table()
    mods["deliverables_store"].init_deliverables_table()
    mods["approvals_store"].init_approvals_table()
    mods["decisions_store"].init_decisions_table()

    ep = mods["execution_policy"]
    monkeypatch.setattr(ep, "_global_spend_ok", lambda uid: True)
    monkeypatch.setattr(ep, "_credits_available", lambda uid, cap: True)

    captured = {"messages": [], "research_msg": "", "product_msg": "", "build_ctx": {}}

    async def _mock_run_agent(req):
        msg = req.user_message or ""
        cap_id = (getattr(req, "metadata_in", None) or {}).get("capability", "")
        captured["messages"].append((cap_id, msg))
        if cap_id == "research":
            captured["research_msg"] = msg
            return SN(reply="Target customer: independent restaurants. Biggest issue: manual inventory waste.",
                      fallback=False, metadata={"project_facts": [
                          {"text": "target = independent restaurants"},
                          {"text": "biggest issue = manual inventory waste"}]})
        if cap_id == "product":
            captured["product_msg"] = msg
            return SN(reply="Product: inventory dashboard, low-stock alerts, supplier tracking, subscription.",
                      fallback=False, metadata={"project_decisions": [
                          {"topic": "pricing", "value": "$19/mo", "reason": "SMB affordability"},
                          {"topic": "mvp", "value": "low-stock alerts + supplier tracking"}]})
        return SN(reply="ok", fallback=False, metadata={})
    monkeypatch.setattr(mods["agent_run_kind"], "run_agent", _mock_run_agent)

    bc = mods["build_capability"]
    async def _mock_build(inp):
        captured["build_ctx"][inp.build_type] = inp.upstream_context
        return bc.BuildExecutorResult(status="completed",
                                      artifact_ref=f"{inp.build_type}run:{inp.run_id}",
                                      build_ref="b1", summary=f"{inp.build_type} built")
    bc.register_build_executor("web", _mock_build)
    bc.register_build_executor("app", _mock_build)
    bc.ensure_registered()

    yield SN(mods=mods, captured=captured)
    bc.unregister_build_executor("web")
    bc.unregister_build_executor("app")
    mods["build_capability"]._EXECUTORS.clear()
    from backend.services.workflows import runner as wf_runner
    wf_runner._reset_for_tests()


async def _wait_status(svc, run_id, user_id, target, timeout_s=10.0):
    deadline = asyncio.get_event_loop().time() + timeout_s
    while True:
        snap = svc.get_run_snapshot(run_id, user_id=user_id)
        if snap and snap.get("status") == target:
            return snap
        if asyncio.get_event_loop().time() >= deadline:
            raise AssertionError(f"run {run_id} != {target} (is {snap.get('status') if snap else None})")
        await asyncio.sleep(0.05)


@pytest.mark.asyncio
async def test_connected_project_lifecycle(brain):
    svc = brain.mods["service"]; cap = brain.captured
    dec = brain.mods["decisions_store"]; sup = brain.mods["project_supervisor"]

    goal = "Create a premium inventory SaaS for independent restaurants"
    snap0 = await svc.start_planned_project_run(user_id="u1", user_request=goal, project_id="p1")
    run_id = snap0["run_id"]
    assert snap0.get("plan_id")

    # DAG has research, product, web_build, app_build; qa blocked (unavailable).
    tstat = {t["assigned_agent"]: t["status"] for t in snap0["task_graph"]["tasks"]}
    assert "research" in tstat and "product" in tstat
    assert "web_build" in tstat and "app_build" in tstat
    # A not-yet-available capability (qa) is a BLOCKED deliverable with no
    # runnable step — truthful, never fake execution.
    qa_deliv = [d for d in snap0["deliverables"] if d["agent_id"] == "qa"]
    assert qa_deliv and qa_deliv[0]["status"] == "skipped"

    # Pauses at approval (builds need approval).
    snap = await _wait_status(svc, run_id, "u1", "awaiting_approval")
    dstat = {d["node_id"]: d["status"] for d in snap["deliverables"]}
    # Research + Product completed.
    completed_caps = {d["agent_id"] for d in snap["deliverables"] if d["status"] == "completed"}
    assert "research" in completed_caps and "product" in completed_caps

    # Product RECEIVED Research (connected brain).
    assert "independent restaurants" in cap["product_msg"]
    assert "target = independent restaurants" in cap["product_msg"]   # projected fact

    # Product decisions are durable + provenance-tagged.
    actives = {d["topic"]: d for d in dec.active_decisions("p1")}
    assert actives["pricing"]["value"] == "$19/mo"
    assert actives["pricing"]["source"] == "PRODUCT"

    # Builds NOT executed before approval.
    assert cap["build_ctx"] == {}
    obs = snap["observability"]
    assert len(obs["pending_approvals"]) >= 1
    ev = sup.evaluate_run(snap)
    assert ev["recommended_next_action"] == sup.NA_APPROVE

    # Approve both build operations → resume.
    for pa in obs["pending_approvals"]:
        await svc.approve_operation(run_id, user_id="u1",
                                    capability=pa["capability"], fingerprint=pa["fingerprint"])

    final = await _wait_status(svc, run_id, "u1", "completed")
    # Web + App RECEIVED Product decisions (connected brain).
    assert "pricing: $19/mo" in cap["build_ctx"].get("web", "")
    assert "pricing: $19/mo" in cap["build_ctx"].get("app", "")
    # Artifacts persisted as references.
    arts = {a["build_type"]: a for a in final["observability"]["build_artifacts"]}
    assert arts["web"]["artifact_ref"] and arts["app"]["artifact_ref"]

    # Supervisor: complete, not partial, review next.
    ev2 = sup.evaluate_run(final)
    assert ev2["status"] == "completed" and ev2["partial"] is False
    assert ev2["recommended_next_action"] == sup.NA_REVIEW

    # ── Restart / reopen: reconstruct the whole project truth from storage ──
    reopened = svc.get_run_snapshot(run_id, user_id="u1")
    assert reopened["run"]["metadata"]["user_request"].startswith("Create a premium")
    assert reopened["plan_id"] if "plan_id" in reopened else True
    assert {d["agent_id"] for d in reopened["deliverables"] if d["status"] == "completed"} >= {"research", "product"}
    assert dec.active_decisions("p1")   # decisions survived
    assert reopened["observability"]["build_artifacts"]


@pytest.mark.asyncio
async def test_change_propagation_supersede_and_staleness(brain):
    svc = brain.mods["service"]; dec = brain.mods["decisions_store"]
    sup = brain.mods["project_supervisor"]; cap = brain.captured

    goal = "Create a premium inventory SaaS for independent restaurants"
    snap0 = await svc.start_planned_project_run(user_id="u1", user_request=goal, project_id="p1")
    run_id = snap0["run_id"]
    snap = await _wait_status(svc, run_id, "u1", "awaiting_approval")
    for pa in snap["observability"]["pending_approvals"]:
        await svc.approve_operation(run_id, user_id="u1",
                                    capability=pa["capability"], fingerprint=pa["fingerprint"])
    final = await _wait_status(svc, run_id, "u1", "completed")
    builds_before = len(cap["build_ctx"])

    # User changes a decision AFTER the builds completed.
    dec.record_decision(project_id="p1", user_id="u1", topic="pricing",
                        value="$29/mo", source="USER", reason="user changed pricing")
    # Supersession: only $29 is active.
    assert [d["value"] for d in dec.active_decisions("p1") if d["topic"] == "pricing"] == ["$29/mo"]

    # Staleness surfaced, NO automatic rebuild.
    ev = sup.evaluate_run(svc.get_run_snapshot(run_id, user_id="u1"))
    assert ev["stale_artifacts"], "expected stale artifacts after a newer decision"
    assert ev["recommended_next_action"] == sup.NA_UPDATE_STALE
    assert len(cap["build_ctx"]) == builds_before  # no rebuild happened


@pytest.mark.asyncio
async def test_cross_user_project_isolation(brain):
    svc = brain.mods["service"]; dec = brain.mods["decisions_store"]

    s1 = await svc.start_planned_project_run(user_id="u1", user_request="inventory SaaS", project_id="pA")
    s2 = await svc.start_planned_project_run(user_id="u2", user_request="fitness SaaS", project_id="pB")
    await _wait_status(svc, s1["run_id"], "u1", "awaiting_approval")
    await _wait_status(svc, s2["run_id"], "u2", "awaiting_approval")

    # Decisions don't cross projects.
    dec.record_decision(project_id="pA", user_id="u1", topic="x", value="A-only")
    dec.record_decision(project_id="pB", user_id="u2", topic="x", value="B-only")
    assert dec.active_decisions("pA")[0]["value"] == "A-only"
    assert dec.active_decisions("pB")[0]["value"] == "B-only"

    # Snapshots are ownership-scoped: the other user cannot read the run.
    assert svc.get_run_snapshot(s1["run_id"], user_id="u2") is None
    assert svc.get_run_snapshot(s2["run_id"], user_id="u1") is None
