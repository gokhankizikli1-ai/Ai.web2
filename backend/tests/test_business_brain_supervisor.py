# coding: utf-8
"""Business Brain — Phase 7: Project Supervisor extension + connected E2E.

The EXISTING deterministic Project Supervisor is extended (not replaced) to
answer "what matters now?" — composing goals + observations + metric changes +
prioritized candidate actions + learnings — while PRESERVING operational
priority (runner/approval/failed always win). No model call.

Connected scenarios A–E run with NO frontend and NO paid provider.
"""
from __future__ import annotations

import importlib

import pytest


@pytest.fixture()
def bb(tmp_path, monkeypatch, tmp_memory_plane_db):
    """Isolate projects.db + Memory Plane and reload every Business Brain
    module so they all share the tmp DB (simulating one process)."""
    monkeypatch.setenv("PROJECTS_DB_PATH", str(tmp_path / "projects.db"))
    mods = {}
    for name in ("goals_store", "candidate_actions_store", "observations_store",
                 "metrics_store", "experiments_store", "decisions_store",
                 "action_prioritizer", "candidate_synthesis", "execution_policy",
                 "business_knowledge", "project_supervisor"):
        m = importlib.import_module(f"backend.services.orchestrator.{name}")
        importlib.reload(m)
        mods[name] = m
    mods["goals_store"].init_goals_table()
    mods["candidate_actions_store"].init_candidate_actions_table()
    mods["observations_store"].init_observations_table()
    mods["metrics_store"].init_metrics_table()
    mods["experiments_store"].init_experiments_table()
    mods["decisions_store"].init_decisions_table()
    from types import SimpleNamespace
    return SimpleNamespace(**mods)


# ── Autonomy mapping onto the existing execution policy ──────────────────

def test_autonomy_maps_onto_execution_policy(bb):
    sup = bb.project_supervisor
    assert sup.autonomy_for_capability("research") == sup.AUTONOMY_AUTONOMOUS
    assert sup.autonomy_for_capability("web_build") == sup.AUTONOMY_REVIEW
    assert sup.autonomy_for_capability("delete_project") == sup.AUTONOMY_RESTRICTED
    assert sup.autonomy_for_capability(None) == sup.AUTONOMY_REVIEW   # conservative


# ── assess_business_brain: operational priority preserved (Scenario E) ───

def test_operational_blocker_beats_business_recommendation(bb):
    sup = bb.project_supervisor
    # A juicy candidate exists AND the runner is broken.
    bb.candidate_actions_store.record_candidate_action(
        project_id="p1", user_id="u1", title="Growth opportunity",
        impact="high", confidence=0.9, recommended_capability="research")
    snap = {"run": {"project_id": "p1", "user_id": "u1"},
            "runner_error": "worker crashed", "status": "running",
            "observability": {}, "task_graph": {"tasks": []}}
    a = sup.assess_business_brain(snap, project_id="p1", user_id="u1")
    # Execution health wins — business truth is NOT hidden, but not recommended first.
    assert a["recommended_next_action"] == sup.NA_RESOLVE_RUNNER
    assert a["candidate_actions"]   # still surfaced


def test_approval_blocker_beats_business(bb):
    sup = bb.project_supervisor
    bb.candidate_actions_store.record_candidate_action(
        project_id="p1", user_id="u1", title="do a thing", impact="high",
        confidence=0.9, recommended_capability="research")
    snap = {"run": {"project_id": "p1", "user_id": "u1"}, "status": "awaiting_approval",
            "observability": {"pending_approvals": [{"capability": "web_build"}]},
            "task_graph": {"tasks": []}}
    a = sup.assess_business_brain(snap, project_id="p1", user_id="u1")
    assert a["recommended_next_action"] == sup.NA_APPROVE


def test_business_recommendation_when_no_blocker(bb):
    sup = bb.project_supervisor
    gid = bb.goals_store.create_goal(project_id="p1", user_id="u1",
                                     title="Grow users", priority=bb.goals_store.PRIORITY_HIGH)
    bb.candidate_actions_store.record_candidate_action(
        project_id="p1", user_id="u1", title="Investigate churn", goal_id=gid,
        impact="high", confidence=0.7, recommended_capability="research")
    snap = {"run": {"project_id": "p1", "user_id": "u1"}, "status": "completed",
            "observability": {}, "task_graph": {"tasks": [
                {"id": "t1", "status": "completed", "assigned_agent": "research"}]}}
    a = sup.assess_business_brain(snap, project_id="p1", user_id="u1")
    assert a["recommended_next_action"] == sup.NA_RUN_CANDIDATE
    rec = a["recommendation"]
    assert rec["type"] == "candidate_action"
    assert rec["autonomy"] == sup.AUTONOMY_AUTONOMOUS
    assert rec["aligned_to_goal"] is True
    assert rec["priority_breakdown"] and rec["evidence_refs"] is not None


def test_restricted_candidate_is_not_auto_executed(bb):
    sup = bb.project_supervisor
    # A high-priority but RESTRICTED action is recommended, never executed.
    bb.candidate_actions_store.record_candidate_action(
        project_id="p1", user_id="u1", title="Delete stale project data",
        impact="high", confidence=0.9, recommended_capability="delete_project")
    snap = {"run": {"project_id": "p1", "user_id": "u1"}, "status": "completed",
            "observability": {}, "task_graph": {"tasks": []}}
    a = sup.assess_business_brain(snap, project_id="p1", user_id="u1")
    assert a["recommendation"]["autonomy"] == sup.AUTONOMY_RESTRICTED
    # The recommendation is advisory only — nothing is executed here.


# ── Scenario A — connected, deterministic, zero model calls ──────────────

def test_scenario_a_connected_prioritization(bb):
    sup = bb.project_supervisor
    goal = bb.goals_store.create_goal(
        project_id="p1", user_id="u1", title="Get first 100 paying users",
        priority=bb.goals_store.PRIORITY_HIGH, target_metric_key="signup_conversion")

    # Three observations: signup decline, onboarding confusion (HIGH), competitor noise (low).
    bb.observations_store.record_observation(
        user_id="u1", project_id="p1", source="analytics",
        kind="analytics.metric_changed", summary="signup conversion fell",
        importance="normal", external_id="a1")
    bb.observations_store.record_observation(
        user_id="u1", project_id="p1", source="gmail",
        kind="gmail.customer_feedback", summary="users confused by onboarding",
        importance="high", external_id="g1")
    bb.observations_store.record_observation(
        user_id="u1", project_id="p1", source="research",
        kind="research.competitor_change",
        summary="competitor launched an unrelated visual theme feature",
        importance="low", external_id="r1")

    # A real, significant metric decline.
    bb.metrics_store.record_metric(user_id="u1", project_id="p1",
                                   metric_key="signup_conversion", value=7.2,
                                   observed_at="2024-01-01T00:00:00Z")
    bb.metrics_store.record_metric(user_id="u1", project_id="p1",
                                   metric_key="signup_conversion", value=4.8,
                                   observed_at="2024-02-01T00:00:00Z")

    # Deterministic synthesis: significant metric + HIGH observation → candidates.
    created = bb.candidate_synthesis.synthesize_candidates("p1", "u1")
    assert len(created) == 2   # signup metric + onboarding; competitor NOT promoted

    cands = bb.candidate_actions_store.list_candidate_actions("p1")
    titles = " ".join(c["title"] for c in cands)
    assert "signup_conversion" in titles          # metric-derived candidate
    assert "onboarding" in titles                 # high-importance observation
    assert "theme feature" not in titles          # competitor noise NOT a candidate

    snap = {"run": {"project_id": "p1", "user_id": "u1"}, "status": "completed",
            "observability": {}, "task_graph": {"tasks": []}}
    a = sup.assess_business_brain(snap, project_id="p1", user_id="u1")

    # #1/#2 are goal-aligned; recommendation is an appropriate investigation.
    assert a["recommended_next_action"] == sup.NA_RUN_CANDIDATE
    top = a["top_candidate"]
    assert top["goal_id"] == goal
    assert top["priority_breakdown"]["aligned_to_goal"] is True
    # Competitor observation is RETAINED (not over-prioritized).
    assert any("theme feature" in o["summary"] for o in a["observations"])
    # Metric change surfaced truthfully.
    assert any(m["metric_key"] == "signup_conversion" for m in a["metric_changes"])
    # No restricted capability → nothing needs to auto-execute; capability is AUTO.
    assert a["recommendation"]["autonomy"] == sup.AUTONOMY_AUTONOMOUS


# ── Scenario B — experiment → learning feeds the assessment ──────────────

def test_scenario_b_experiment_learning_loop(bb):
    sup = bb.project_supervisor
    eid = bb.experiments_store.create_experiment(
        project_id="p1", user_id="u1", hypothesis="Simpler onboarding lifts activation",
        change_ref="plan:1", metric_key="activation")
    res = bb.experiments_store.assess_experiment(eid, baseline_value=10.0, result_value=14.0)
    assert res["outcome"] == bb.experiments_store.OUTCOME_IMPROVED

    snap = {"run": {"project_id": "p1", "user_id": "u1"}, "status": "completed",
            "observability": {}, "task_graph": {"tasks": []}}
    a = sup.assess_business_brain(snap, project_id="p1", user_id="u1")
    # The learning is now part of what the supervisor understands.
    assert a["learnings"]
    assert "caused" not in a["learnings"][0]["summary"].lower()


# ── Scenario C — restart / reopen reconstructs from storage ──────────────

def test_scenario_c_restart_reconstructs(bb, tmp_path, monkeypatch):
    # Populate goals, decisions, observations, metrics, candidates, learning.
    gid = bb.goals_store.create_goal(project_id="p1", user_id="u1", title="G",
                                     priority=bb.goals_store.PRIORITY_HIGH)
    bb.decisions_store.record_decision(project_id="p1", user_id="u1",
                                       topic="pricing", value="$19", source="PRODUCT")
    bb.observations_store.record_observation(user_id="u1", project_id="p1",
                                             source="s", kind="k", summary="obs",
                                             importance="high", external_id="e1")
    bb.metrics_store.record_metric(user_id="u1", project_id="p1", metric_key="m",
                                   value=1, observed_at="2024-01-01T00:00:00Z")
    bb.candidate_actions_store.record_candidate_action(
        project_id="p1", user_id="u1", title="c", goal_id=gid,
        recommended_capability="research")

    # "Restart": reload every module against the same DB, no chat replay.
    for name in ("goals_store", "candidate_actions_store", "observations_store",
                 "metrics_store", "decisions_store", "business_knowledge",
                 "action_prioritizer", "project_supervisor"):
        importlib.reload(importlib.import_module(f"backend.services.orchestrator.{name}"))
    from backend.services.orchestrator import project_supervisor as sup2
    a = sup2.assess_business_brain(None, project_id="p1", user_id="u1")
    assert a["goals"] and a["goals"][0]["id"] == gid
    assert a["decisions"] and a["decisions"][0]["value"] == "$19"
    assert a["observations"] and a["candidate_actions"]


# ── Scenario D — cross-user / cross-project isolation ────────────────────

def test_scenario_d_isolation(bb):
    sup = bb.project_supervisor
    # Two users, two projects, concurrent signals.
    bb.goals_store.create_goal(project_id="pA", user_id="u1", title="A-goal")
    bb.goals_store.create_goal(project_id="pB", user_id="u2", title="B-goal")
    bb.candidate_actions_store.record_candidate_action(project_id="pA", user_id="u1", title="A-cand")
    bb.candidate_actions_store.record_candidate_action(project_id="pB", user_id="u2", title="B-cand")
    bb.observations_store.record_observation(user_id="u1", project_id="pA", source="s", kind="k", summary="A-obs")
    bb.observations_store.record_observation(user_id="u2", project_id="pB", source="s", kind="k", summary="B-obs")
    bb.metrics_store.record_metric(user_id="u1", project_id="pA", metric_key="m", value=1)
    bb.metrics_store.record_metric(user_id="u2", project_id="pB", metric_key="m", value=2)
    bb.business_knowledge.record_learning(user_id="u1", project_id="pA", summary="A-learn")
    bb.business_knowledge.record_learning(user_id="u2", project_id="pB", summary="B-learn")

    a = sup.assess_business_brain(None, project_id="pA", user_id="u1")
    assert [g["title"] for g in a["goals"]] == ["A-goal"]
    assert all(c["title"] == "A-cand" for c in a["candidate_actions"])
    assert all(o["summary"] == "A-obs" for o in a["observations"])
    assert all(l["summary"] == "A-learn" for l in a["learnings"])

    b = sup.assess_business_brain(None, project_id="pB", user_id="u2")
    assert [g["title"] for g in b["goals"]] == ["B-goal"]
    assert all(l["summary"] == "B-learn" for l in b["learnings"])


# ── evaluate_run is unchanged (backward compatibility) ───────────────────

def test_evaluate_run_backward_compatible(bb):
    sup = bb.project_supervisor
    snap = {"run": {"project_id": "p1", "user_id": "u1"}, "status": "completed",
            "observability": {}, "task_graph": {"tasks": [
                {"id": "t1", "status": "completed", "assigned_agent": "research"}]}}
    ev = sup.evaluate_run(snap, decisions=[])
    assert ev["recommended_next_action"] == sup.NA_REVIEW
    assert ev["status"] == "completed"
