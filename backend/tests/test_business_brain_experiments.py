# coding: utf-8
"""Business Brain — Phase 6: EXPERIMENTS + LEARNING loop.

Experiments produce evidence-linked durable learnings on the Memory Plane;
outcomes are improved/worsened/neutral/inconclusive (never a forced winner);
unsupported causal wording is prevented; failed experiments are retained.
"""
from __future__ import annotations

import importlib

import pytest

from backend.services.orchestrator import experiments_store as ex_pure


@pytest.fixture()
def ex(tmp_path, monkeypatch, tmp_memory_plane_db):
    monkeypatch.setenv("PROJECTS_DB_PATH", str(tmp_path / "projects.db"))
    from backend.services.orchestrator import experiments_store
    importlib.reload(experiments_store)
    experiments_store.init_experiments_table()
    return experiments_store


# ── Store ────────────────────────────────────────────────────────────────

def test_create_and_get(ex):
    eid = ex.create_experiment(project_id="p1", user_id="u1", goal_id="g1",
                               hypothesis="Simpler onboarding lifts activation",
                               change_ref="plan:1", metric_key="activation")
    assert eid
    e = ex.get_experiment(eid)
    assert e["status"] == ex.STATUS_RUNNING
    assert e["hypothesis"].startswith("Simpler onboarding")
    assert e["metric_key"] == "activation"


def test_invalid_input_rejected(ex):
    assert ex.create_experiment(project_id="p1", user_id="u1", hypothesis="  ") == ""


# ── Outcome classification (pure) ────────────────────────────────────────

def test_classify_improved_and_worsened():
    up = ex_pure.classify_outcome(10, 15, higher_is_better=True)
    assert up["outcome"] == ex_pure.OUTCOME_IMPROVED and up["confidence"] > 0
    down = ex_pure.classify_outcome(10, 5, higher_is_better=True)
    assert down["outcome"] == ex_pure.OUTCOME_WORSENED
    # For a "lower is better" metric (e.g. churn), a decrease is an improvement.
    churn = ex_pure.classify_outcome(10, 5, higher_is_better=False)
    assert churn["outcome"] == ex_pure.OUTCOME_IMPROVED


def test_classify_neutral_and_inconclusive():
    neutral = ex_pure.classify_outcome(100, 101, min_effect_pct=0.05)
    assert neutral["outcome"] == ex_pure.OUTCOME_NEUTRAL
    assert ex_pure.classify_outcome(None, 10)["outcome"] == ex_pure.OUTCOME_INCONCLUSIVE
    assert ex_pure.classify_outcome(10, None)["outcome"] == ex_pure.OUTCOME_INCONCLUSIVE
    short = ex_pure.classify_outcome(10, 20, sufficient_samples=False)
    assert short["outcome"] == ex_pure.OUTCOME_INCONCLUSIVE


def test_association_wording_is_not_causal():
    phrase = ex_pure.association_phrase("simpler onboarding", "activation", "improved")
    assert "caused" not in phrase.lower()
    assert "followed" in phrase.lower() or "after" in phrase.lower()


# ── Assess (one-shot) + learning ─────────────────────────────────────────

def test_assess_improved_persists_learning(ex):
    eid = ex.create_experiment(project_id="p1", user_id="u1",
                               hypothesis="simpler onboarding", metric_key="activation")
    res = ex.assess_experiment(eid, baseline_value=10.0, result_value=15.0)
    assert res["outcome"] == ex.OUTCOME_IMPROVED
    assert res["learning_ref"]
    # The experiment is now assessed, outcome + confidence persisted.
    e = ex.get_experiment(eid)
    assert e["status"] == ex.STATUS_ASSESSED and e["outcome"] == ex.OUTCOME_IMPROVED
    assert e["learning_ref"] == res["learning_ref"]
    # Learning is durable + evidence-linked + non-causal in the Memory Plane.
    from backend.services.orchestrator import business_knowledge as bk
    learnings = bk.list_knowledge(user_id="u1", project_id="p1",
                                  domains=[bk.DOMAIN_LEARNING])
    assert learnings and learnings[0]["source_ref"] == eid
    assert "caused" not in learnings[0]["summary"].lower()


def test_assess_inconclusive_records_no_learning(ex):
    eid = ex.create_experiment(project_id="p1", user_id="u1", hypothesis="h",
                               metric_key="m")
    res = ex.assess_experiment(eid, baseline_value=None, result_value=5.0)
    assert res["outcome"] == ex.OUTCOME_INCONCLUSIVE
    assert res["learning_ref"] is None
    from backend.services.orchestrator import business_knowledge as bk
    assert bk.list_knowledge(user_id="u1", project_id="p1",
                             domains=[bk.DOMAIN_LEARNING]) == []


def test_failed_experiment_retained(ex):
    eid = ex.create_experiment(project_id="p1", user_id="u1", hypothesis="h",
                               metric_key="m", higher_is_better=True)
    ex.assess_experiment(eid, baseline_value=10.0, result_value=4.0)   # worse
    e = ex.get_experiment(eid)
    assert e["outcome"] == ex.OUTCOME_WORSENED
    # Retained + discoverable so it isn't blindly repeated.
    assert eid in {x["id"] for x in ex.list_experiments("p1")}


def test_assess_unknown_experiment_returns_none(ex):
    assert ex.assess_experiment("nope", baseline_value=1, result_value=2) is None


def test_restart_persists(ex):
    eid = ex.create_experiment(project_id="p1", user_id="u1", hypothesis="durable",
                               metric_key="m")
    from backend.services.orchestrator import experiments_store as ex2
    importlib.reload(ex2)
    assert ex2.get_experiment(eid)["hypothesis"] == "durable"
