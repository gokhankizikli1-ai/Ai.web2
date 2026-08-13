# coding: utf-8
"""Business Brain — Phase 2: CANDIDATE ACTIONS + deterministic prioritization.

Candidate actions are distinct from decisions/tasks/approvals; ranking is
deterministic, inspectable, goal-aware, evidence-aware, and stable on ties.
"""
from __future__ import annotations

import importlib

import pytest

from backend.services.orchestrator import action_prioritizer as ap


@pytest.fixture()
def cas(tmp_path, monkeypatch):
    monkeypatch.setenv("PROJECTS_DB_PATH", str(tmp_path / "projects.db"))
    from backend.services.orchestrator import candidate_actions_store
    importlib.reload(candidate_actions_store)
    candidate_actions_store.init_candidate_actions_table()
    return candidate_actions_store


# ── Store ────────────────────────────────────────────────────────────────

def test_record_get_list(cas):
    cid = cas.record_candidate_action(
        project_id="p1", user_id="u1", title="Investigate signup drop",
        detail="conversion fell", impact="high", confidence=0.6,
        cost="low", risk="low", urgency="high",
        recommended_capability="research",
        evidence_refs=[{"type": "metric", "ref": "signup_conversion"}])
    assert cid
    c = cas.get_candidate_action(cid)
    assert c["title"] == "Investigate signup drop"
    assert c["status"] == cas.STATUS_PROPOSED
    assert c["evidence_refs"][0]["ref"] == "signup_conversion"
    assert cid in {x["id"] for x in cas.list_candidate_actions("p1")}


def test_invalid_input_rejected(cas):
    assert cas.record_candidate_action(project_id="", user_id="u1", title="x") == ""
    assert cas.record_candidate_action(project_id="p1", user_id="u1", title="  ") == ""


def test_dedup_updates_open_candidate_in_place(cas):
    a = cas.record_candidate_action(project_id="p1", user_id="u1", title="v1",
                                    impact="low", dedup_key="signup_drop")
    b = cas.record_candidate_action(project_id="p1", user_id="u1", title="v2",
                                    impact="high", dedup_key="signup_drop")
    assert a == b   # same row updated, not duplicated
    rows = cas.list_candidate_actions("p1")
    assert len(rows) == 1
    assert rows[0]["title"] == "v2" and rows[0]["impact"] == "high"


def test_dedup_after_close_inserts_fresh(cas):
    a = cas.record_candidate_action(project_id="p1", user_id="u1", title="v1",
                                    dedup_key="k")
    cas.set_status(a, cas.STATUS_DISMISSED)
    b = cas.record_candidate_action(project_id="p1", user_id="u1", title="v2",
                                    dedup_key="k")
    assert a != b   # closed candidate is not resurrected; a new one is created
    assert len(cas.list_candidate_actions("p1")) == 2


def test_open_only_filter(cas):
    a = cas.record_candidate_action(project_id="p1", user_id="u1", title="open")
    b = cas.record_candidate_action(project_id="p1", user_id="u1", title="closed")
    cas.set_status(b, cas.STATUS_DISMISSED)
    open_ids = {x["id"] for x in cas.list_candidate_actions("p1", open_only=True)}
    assert a in open_ids and b not in open_ids


def test_cross_project_isolation(cas):
    cas.record_candidate_action(project_id="pA", user_id="u1", title="A")
    cas.record_candidate_action(project_id="pB", user_id="u2", title="B")
    assert [c["title"] for c in cas.list_candidate_actions("pA")] == ["A"]


def test_restart_persists(cas):
    cid = cas.record_candidate_action(project_id="p1", user_id="u1", title="durable")
    from backend.services.orchestrator import candidate_actions_store as cas2
    importlib.reload(cas2)
    assert cas2.get_candidate_action(cid)["title"] == "durable"


# ── Prioritizer (pure, deterministic) ────────────────────────────────────

def _cand(**kw):
    base = {"id": kw.get("id", "x"), "impact": "medium", "confidence": 0.5,
            "cost": "low", "risk": "low", "urgency": "medium",
            "goal_id": None, "created_at": "2020-01-01T00:00:00Z"}
    base.update(kw)
    return base


def test_goal_aligned_outranks_unrelated(cas):
    goals = [{"id": "g1", "priority": 3}]
    aligned = _cand(id="a", goal_id="g1")
    unrelated = _cand(id="b", goal_id=None)
    ranked = ap.rank_candidates([unrelated, aligned], active_goals=goals)
    assert ranked[0]["id"] == "a"
    assert ranked[0]["priority_breakdown"]["aligned_to_goal"] is True


def test_high_impact_low_cost_beats_low_impact_high_cost():
    good = _cand(id="good", impact="high", cost="low", risk="low", confidence=0.8)
    bad = _cand(id="bad", impact="low", cost="high", risk="high", confidence=0.4)
    ranked = ap.rank_candidates([bad, good])
    assert ranked[0]["id"] == "good"


def test_unknown_evidence_lowers_confidence_ranking():
    # Identical except confidence — the more evidence-backed one wins.
    confident = _cand(id="c", confidence=0.9)
    unsure = _cand(id="u", confidence=0.1)
    ranked = ap.rank_candidates([unsure, confident])
    assert ranked[0]["id"] == "c"


def test_deterministic_and_stable_ties():
    # Two identical-score candidates → older created_at wins, then id.
    a = _cand(id="a2", created_at="2020-01-02T00:00:00Z")
    b = _cand(id="b1", created_at="2020-01-01T00:00:00Z")
    ranked = ap.rank_candidates([a, b])
    assert [c["id"] for c in ranked] == ["b1", "a2"]   # older first
    # Fully deterministic: same input → same output every call.
    again = ap.rank_candidates([a, b])
    assert [c["id"] for c in again] == ["b1", "a2"]


def test_no_recommendation_from_empty():
    assert ap.rank_candidates([]) == []
    assert ap.top_candidate([]) is None


def test_score_breakdown_is_inspectable():
    s = ap.score_candidate(_cand(impact="high", confidence=0.5, cost="high", risk="high"))
    bd = s["breakdown"]
    assert set(bd) >= {"goal_alignment", "impact", "confidence", "urgency",
                       "cost", "risk", "aligned_to_goal"}
    assert bd["cost"] < 0 and bd["risk"] < 0   # penalties are negative
