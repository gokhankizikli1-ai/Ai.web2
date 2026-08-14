# coding: utf-8
"""Business Brain LIVE prioritization path (Phase 1 closure).

The connector-hardening sprint proved — at the LIBRARY level — that a
high-importance Gmail/GitHub observation can be promoted to a candidate action
and prioritized by `assess_business_brain`. But nothing in production ever
invoked that chain: `synthesize_candidates` / `assess_business_brain` had ZERO
live callers, so connector observations were stored and (optionally) shown as
passive chat text, never turned into a prioritized recommendation.

`POST /v2/orchestrator/projects/{id}/assessment` is the production seam that
closes that gap. These tests drive it over HTTP and prove:

  1. A high-importance GitHub observation reaches a LIVE, user-visible
     recommendation through the EXISTING Business Brain authorities.
  2. The assessment creates NO task and NO run (observation → recommendation
     only; the Business Brain remains the single prioritizer, execution stays
     with the existing authorities).
  3. Ownership is enforced: a project the caller does not own is 404
     (existence-hidden), so observations never leak across users.
  4. A duplicate sync does not amplify the signal (idempotent promotion).

No model calls, no network — the observation is recorded directly through the
canonical store, exactly as the connectors' ingest path does.
"""
from __future__ import annotations

import pytest

GUEST = "guest:no-middleware"   # the id current_user resolves to with no auth


@pytest.fixture()
def client(tmp_path, monkeypatch):
    db = str(tmp_path / "projects.db")
    monkeypatch.setenv("PROJECTS_DB_PATH", db)
    monkeypatch.setenv("ENABLE_PROJECT_ORCHESTRATOR", "true")

    from backend.services.projects import store as projects_store
    from backend.services.orchestrator import (
        observations_store, candidate_actions_store, goals_store,
        decisions_store, metrics_store, tasks_store, runs_store,
    )
    for mod in (projects_store, observations_store, candidate_actions_store,
                goals_store, decisions_store, metrics_store, tasks_store,
                runs_store):
        monkeypatch.setattr(mod, "DB_PATH", db, raising=False)
    projects_store._reset_for_tests()
    projects_store.init()
    observations_store.init_observations_table()
    candidate_actions_store.init_candidate_actions_table()
    goals_store.init_goals_table()
    decisions_store.init_decisions_table()
    metrics_store.init_metrics_table()

    from fastapi.testclient import TestClient
    import backend.api as api
    return {
        "http": TestClient(api.app),
        "projects": projects_store, "obs": observations_store,
        "cas": candidate_actions_store, "tasks": tasks_store, "runs": runs_store,
    }


def _high_ci_failure(env, *, user, project, ext="gh-ci-1"):
    """Record the same shape github/normalize emits for a failed CI run."""
    return env["obs"].record_observation(
        user_id=user, project_id=project, source="github",
        kind="github.check.failed", summary="CI failed on main",
        external_id=ext, importance="high",
        observed_at="2024-05-01T00:00:00Z",
        payload={"name": "CI", "conclusion": "failure", "branch": "main"},
    )


def test_high_importance_observation_reaches_live_recommendation(client):
    p = client["projects"].create_project(GUEST, name="My SaaS")
    _high_ci_failure(client, user=GUEST, project=p.id)

    r = client["http"].post(f"/v2/orchestrator/projects/{p.id}/assessment")
    assert r.status_code == 200
    data = r.json()["data"]
    # The connector observation was promoted + prioritized into a live rec.
    assert data["recommended_next_action"] == "act_on_candidate_action"
    assert data["recommendation"]["type"] == "candidate_action"
    # Its evidence traces back to a connector observation.
    cands = client["cas"].list_candidate_actions(p.id)
    assert any(c.get("source") == "OBSERVATION" for c in cands)


def test_live_assessment_creates_no_task_or_run(client):
    p = client["projects"].create_project(GUEST, name="My SaaS")
    _high_ci_failure(client, user=GUEST, project=p.id)

    client["http"].post(f"/v2/orchestrator/projects/{p.id}/assessment")
    # Prioritization is a RECOMMENDATION — nothing executable was created.
    assert client["tasks"].list_tasks_for_project(p.id) == []
    assert client["runs"].list_runs(project_id=p.id) == []


def test_assessment_ownership_enforced(client):
    # Project owned by someone else — the guest caller must get a 404, and no
    # part of the owner's observation state may surface.
    p = client["projects"].create_project("someone-else", name="Private")
    _high_ci_failure(client, user="someone-else", project=p.id)

    r = client["http"].post(f"/v2/orchestrator/projects/{p.id}/assessment")
    assert r.status_code == 404
    assert r.json()["metadata"]["code"] == "project_not_found"


def test_duplicate_sync_does_not_amplify(client):
    p = client["projects"].create_project(GUEST, name="My SaaS")
    # Same external id twice — the connector dedupes at the observation store.
    assert _high_ci_failure(client, user=GUEST, project=p.id, ext="dup")["ok"]
    assert _high_ci_failure(client, user=GUEST, project=p.id, ext="dup")["deduplicated"]

    client["http"].post(f"/v2/orchestrator/projects/{p.id}/assessment")
    # Re-assessing must not multiply candidates for the one observation.
    client["http"].post(f"/v2/orchestrator/projects/{p.id}/assessment")
    obs_cands = [c for c in client["cas"].list_candidate_actions(p.id)
                 if c.get("source") == "OBSERVATION"]
    assert len(obs_cands) == 1
