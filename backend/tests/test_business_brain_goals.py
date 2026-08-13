# coding: utf-8
"""Business Brain — Phase 1: durable GOAL hierarchy.

Covers goal creation, parent/child hierarchy, cycle prevention, status
transitions, success criteria, cross-project/user isolation, restart/reopen
persistence, and Project Intelligence projection of active goals.
"""
from __future__ import annotations

import importlib

import pytest


@pytest.fixture()
def goals(tmp_path, monkeypatch):
    monkeypatch.setenv("PROJECTS_DB_PATH", str(tmp_path / "projects.db"))
    from backend.services.orchestrator import goals_store
    importlib.reload(goals_store)
    goals_store.init_goals_table()
    return goals_store


def test_create_and_get(goals):
    gid = goals.create_goal(project_id="p1", user_id="u1",
                            title="Get first 100 paying users",
                            description="north-star", priority=goals.PRIORITY_HIGH,
                            success_criteria=[{"metric": "paying_users", "op": ">=", "target": 100}])
    assert gid
    g = goals.get_goal(gid)
    assert g["title"] == "Get first 100 paying users"
    assert g["status"] == goals.STATUS_ACTIVE
    assert g["priority"] == goals.PRIORITY_HIGH
    assert g["success_criteria"][0]["metric"] == "paying_users"


def test_invalid_input_returns_empty(goals):
    assert goals.create_goal(project_id="", user_id="u1", title="x") == ""
    assert goals.create_goal(project_id="p1", user_id="u1", title="   ") == ""


def test_parent_child_hierarchy(goals):
    biz = goals.create_goal(project_id="p1", user_id="u1", title="Grow the business")
    proj = goals.create_goal(project_id="p1", user_id="u1", title="Launch CRM",
                             parent_id=biz)
    milestone = goals.create_goal(project_id="p1", user_id="u1",
                                  title="Ship MVP", parent_id=proj)
    assert {c["id"] for c in goals.children_of(biz)} == {proj}
    chain = goals.ancestors_of(milestone)
    assert [a["id"] for a in chain] == [proj, biz]   # immediate parent → root


def test_parent_must_exist_and_same_project(goals):
    with pytest.raises(goals.GoalNotFoundError):
        goals.create_goal(project_id="p1", user_id="u1", title="x", parent_id="nope")
    other = goals.create_goal(project_id="p2", user_id="u1", title="other-project goal")
    with pytest.raises(goals.GoalNotFoundError):
        goals.create_goal(project_id="p1", user_id="u1", title="x", parent_id=other)


def test_cycle_prevention_on_reparent(goals):
    a = goals.create_goal(project_id="p1", user_id="u1", title="A")
    b = goals.create_goal(project_id="p1", user_id="u1", title="B", parent_id=a)
    c = goals.create_goal(project_id="p1", user_id="u1", title="C", parent_id=b)
    # Making A a child of C would create A→...→C→A.
    with pytest.raises(goals.GoalCycleError):
        goals.update_goal(a, parent_id=c)
    # Self-parent is rejected too.
    with pytest.raises(goals.GoalCycleError):
        goals.update_goal(a, parent_id=a)


def test_status_transitions(goals):
    gid = goals.create_goal(project_id="p1", user_id="u1", title="G")
    assert goals.set_status(gid, goals.STATUS_ACHIEVED)
    assert goals.get_goal(gid)["status"] == goals.STATUS_ACHIEVED
    assert goals.set_status(gid, goals.STATUS_PAUSED)
    assert goals.get_goal(gid)["status"] == goals.STATUS_PAUSED
    # Only active goals are returned by active_goals.
    assert gid not in {g["id"] for g in goals.active_goals("p1")}


def test_update_goal_partial(goals):
    gid = goals.create_goal(project_id="p1", user_id="u1", title="Old")
    assert goals.update_goal(gid, title="New", priority=goals.PRIORITY_CRITICAL)
    g = goals.get_goal(gid)
    assert g["title"] == "New" and g["priority"] == goals.PRIORITY_CRITICAL
    # No fields → no-op returns False.
    assert goals.update_goal(gid) is False


def test_active_goals_priority_order(goals):
    goals.create_goal(project_id="p1", user_id="u1", title="low", priority=goals.PRIORITY_LOW)
    goals.create_goal(project_id="p1", user_id="u1", title="crit", priority=goals.PRIORITY_CRITICAL)
    ordered = goals.active_goals("p1")
    assert ordered[0]["title"] == "crit"   # highest priority first


def test_cross_project_isolation(goals):
    goals.create_goal(project_id="pA", user_id="u1", title="A-goal")
    goals.create_goal(project_id="pB", user_id="u2", title="B-goal")
    assert [g["title"] for g in goals.active_goals("pA")] == ["A-goal"]
    assert [g["title"] for g in goals.active_goals("pB")] == ["B-goal"]


def test_restart_reopen_persists(goals, tmp_path, monkeypatch):
    gid = goals.create_goal(project_id="p1", user_id="u1", title="Durable")
    # Simulate a process restart: re-import against the SAME db file.
    import importlib
    from backend.services.orchestrator import goals_store as gs2
    importlib.reload(gs2)
    assert gs2.get_goal(gid)["title"] == "Durable"
    assert {g["id"] for g in gs2.active_goals("p1")} == {gid}


# ── Project Intelligence projection (bounded, isolated) ──────────────────

def test_intelligence_projects_active_goal(goals):
    goals.create_goal(project_id="p1", user_id="u1",
                      title="Get first 100 paying users",
                      success_criteria=[{"metric": "paying_users", "op": ">=", "target": 100}])
    from backend.services.orchestrator.project_intelligence import (
        build_intelligence_packet, TOTAL_CHAR_BUDGET,
    )
    packet = build_intelligence_packet(
        capability="research", run_id="r1", project_id="p1", depends_on=[],
        user_goal="g", deliverables=[], decisions=[], knowledge=[])
    assert "ACTIVE GOALS" in packet
    assert "Get first 100 paying users" in packet
    assert "paying_users >= 100" in packet
    assert len(packet) <= TOTAL_CHAR_BUDGET


def test_intelligence_goal_isolation(goals):
    goals.create_goal(project_id="pA", user_id="u1", title="A-secret-goal")
    from backend.services.orchestrator.project_intelligence import (
        build_intelligence_packet,
    )
    packet = build_intelligence_packet(
        capability="research", run_id="r1", project_id="pB", depends_on=[],
        user_goal="g", deliverables=[], decisions=[], knowledge=[])
    assert "A-secret-goal" not in packet
