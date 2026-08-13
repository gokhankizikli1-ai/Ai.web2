# coding: utf-8
"""Phase 6 — long-horizon planner + capability registry.

Covers: coordinator stays the cheap fast path (planner not invoked there);
simple goal → minimal plan; project goal → multi-step capability DAG;
unsupported capability → honest blocked task; the planner is bounded to
exactly ONE call; plan edits invalidate affected approvals.
"""
from __future__ import annotations

import importlib

import pytest


@pytest.fixture()
def planner_env(tmp_path, monkeypatch):
    monkeypatch.setenv("PROJECTS_DB_PATH", str(tmp_path / "projects.db"))
    from backend.services.orchestrator import (
        capability_registry, execution_policy, approvals_store, plans_store,
        long_horizon_planner,
    )
    importlib.reload(execution_policy)
    importlib.reload(capability_registry)
    importlib.reload(approvals_store)
    importlib.reload(plans_store)
    importlib.reload(long_horizon_planner)
    approvals_store.init_approvals_table()
    plans_store.init_plans_table()
    long_horizon_planner.reset_planner()
    yield capability_registry, execution_policy, approvals_store, plans_store, long_horizon_planner
    long_horizon_planner.reset_planner()


# ── Capability registry ──────────────────────────────────────────────────

def test_registry_available_and_future(planner_env):
    caps, ep, *_ = planner_env
    assert caps.is_available("research")
    assert caps.is_available("web_build")
    assert caps.is_available("app_build")
    # Future capabilities are declared but NOT available.
    assert not caps.is_available("qa")
    assert not caps.is_available("launch")
    assert not caps.is_available("growth")
    assert caps.get("nonexistent") is None
    # Paid capabilities carry APPROVAL_REQUIRED via the policy layer.
    assert caps.get("web_build").approval_required is True
    assert caps.get("research").approval_required is False


# ── Planning ─────────────────────────────────────────────────────────────

def test_simple_goal_minimal_plan(planner_env):
    *_, planner = planner_env
    plan = planner.plan_goal("summarize the latest AI news", user_id="u1",
                             persist=False)
    # Non-project goal → a single cheap research task.
    assert len(plan["tasks"]) == 1
    assert plan["tasks"][0]["capability"] == "research"


def test_project_goal_multi_step_dag(planner_env):
    *_, planner = planner_env
    plan = planner.plan_goal(
        "Create a restaurant inventory SaaS", user_id="u1", persist=False,
    )
    caps = [t["capability"] for t in plan["tasks"]]
    assert "research" in caps
    assert "product" in caps
    assert ("web_build" in caps) or ("app_build" in caps)
    # Dependencies form a real chain: product depends on research.
    product = next(t for t in plan["tasks"] if t["capability"] == "product")
    assert "t1" in product["depends_on"]


def test_unsupported_capability_is_blocked_not_runnable(planner_env):
    *_, planner = planner_env
    plan = planner.plan_goal("Build a mobile inventory app", user_id="u1",
                             persist=False)
    qa = [t for t in plan["tasks"] if t["capability"] == "qa"]
    assert qa, "expected a qa task in the plan"
    assert qa[0]["available"] is False
    assert qa[0]["status"] == "blocked"


def test_planner_is_bounded_to_one_call(planner_env):
    *_, planner = planner_env
    calls = {"n": 0}

    def _counting(goal, context):
        calls["n"] += 1
        from backend.services.orchestrator.long_horizon_planner import Plan, PlannedTask
        return Plan(goal=goal, tasks=[PlannedTask(id="t1", capability="research",
                                                  title="r")])

    planner.set_planner(_counting)
    planner.plan_goal("anything", user_id="u1", persist=False)
    assert calls["n"] == 1  # exactly one planning call, no loops


def test_paid_tasks_marked_approval_required(planner_env):
    *_, planner = planner_env
    plan = planner.plan_goal("Build a SaaS web app", user_id="u1", persist=False)
    builds = [t for t in plan["tasks"] if t["capability"] in ("web_build", "app_build")]
    assert builds
    assert all(t["approval_required"] for t in builds)


# ── Persistence + approval invalidation ──────────────────────────────────

def test_plan_persists_and_reloads(planner_env):
    _, _, _, plans_store, planner = planner_env
    plan = planner.plan_goal("Create a SaaS platform", user_id="u1",
                             project_id="p1")
    pid = plan["plan_id"]
    assert pid
    reloaded = plans_store.get_plan(pid)
    assert reloaded is not None
    assert reloaded["goal"] == "Create a SaaS platform"
    assert len(reloaded["tasks"]) == len(plan["tasks"])
    # And latest_for_project resolves it.
    assert plans_store.latest_for_project("p1")["id"] == pid


def test_plan_edit_invalidates_affected_approvals(planner_env):
    caps, ep, approvals, plans_store, planner = planner_env

    # Deterministic planner v1: a web_build task.
    def _v1(goal, context):
        from backend.services.orchestrator.long_horizon_planner import Plan, PlannedTask
        return Plan(goal=goal, tasks=[
            PlannedTask(id="t1", capability="product", title="Define"),
            PlannedTask(id="t2", capability="web_build", title="Web Build v1",
                        depends_on=["t1"]),
        ])

    planner.set_planner(_v1)
    p1 = planner.plan_goal("SaaS", user_id="u1", project_id="p1")
    pid = p1["plan_id"]

    # User approves the web_build task at v1's fingerprint.
    t2_v1 = next(t for t in p1["tasks"] if t["id"] == "t2")
    fp_v1 = ep.operation_fingerprint("web_build", {
        "title": t2_v1["title"], "depends_on": sorted(t2_v1["depends_on"]),
        "deliverable_kind": t2_v1["deliverable_kind"],
    })
    approvals.record_approval(user_id="u1", capability="web_build",
                              fingerprint=fp_v1, project_id="p1")
    assert approvals.is_approved(user_id="u1", capability="web_build",
                                 fingerprint=fp_v1)

    # Re-plan with a materially changed web_build task (same id, new title).
    def _v2(goal, context):
        from backend.services.orchestrator.long_horizon_planner import Plan, PlannedTask
        return Plan(goal=goal, tasks=[
            PlannedTask(id="t1", capability="product", title="Define"),
            PlannedTask(id="t2", capability="web_build",
                        title="Web Build v2 — MORE PAGES", depends_on=["t1"]),
        ])

    planner.set_planner(_v2)
    p2 = planner.plan_goal("SaaS", user_id="u1", project_id="p1", plan_id=pid)

    # The old approval (bound to v1's fingerprint) is now invalid.
    assert "web_build" in p2.get("invalidated_approvals", [])
    assert not approvals.is_approved(user_id="u1", capability="web_build",
                                     fingerprint=fp_v1)
