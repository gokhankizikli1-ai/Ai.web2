# coding: utf-8
"""Business Brain ⇄ connector consumption — proving the wiring, end to end.

These tests exercise the REAL chain a connector uses:

    provider resource → github/gmail.normalize (pure) → github/gmail.ingest
        → observations_store.record_observation()
        → project_supervisor.assess_business_brain() / candidate_synthesis
          (the Business Brain OBSERVE + PRIORITIZE authorities)

They assert the seven guarantees the connector-hardening sprint requires:

 1. A GitHub observation for project A is visible to the Business Brain for A.
 2. A Gmail observation for project A is visible to the Business Brain for A.
 3. Project B cannot see A's connector observations (no cross-project leakage).
 4. A duplicate sync does not duplicate the effective Business Brain signal.
 5. The source timestamp (observed_at) is preserved, not overwritten with "now".
 6. Ingesting an observation ALONE creates no task/run/candidate (INPUTS ONLY).
 7. The Business Brain can PRIORITIZE a high-importance observation through its
    existing candidate flow — no parallel connector-specific decision engine.

No network, no model calls: connections are constructed in-process and the
observation is normalized from plain fixture dicts.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest

REPO = {"id": 42, "full_name": "octo/hello"}


def _gh_conn(store_cls, *, project_id="pA", owner="uA"):
    return store_cls(
        project_id=project_id, owner_user_id=owner, installation_id="100",
        repo_full_name="octo/hello", repo_id="42",
        created_at="2024-01-01T00:00:00Z", updated_at="2024-01-01T00:00:00Z",
        last_sync_at="",
    )


def _gm_conn(store_cls, *, project_id="pA", owner="uA"):
    return store_cls(
        project_id=project_id, owner_user_id=owner, provider="gmail",
        google_email="me@x.com", scopes="", refresh_token_enc="", access_token_enc="",
        access_token_expires="", status="connected",
        created_at="2024-01-01T00:00:00Z", updated_at="2024-01-01T00:00:00Z",
        last_sync_at="",
    )


def _gmail_message(mid="m1", subject="Invoice overdue", internal="1700000000000"):
    return {
        "id": mid, "threadId": "t1", "snippet": "please pay",
        "internalDate": internal, "labelIds": ["INBOX", "UNREAD"],
        "payload": {"headers": [
            {"name": "From", "value": "billing@vendor.com"},
            {"name": "Subject", "value": subject},
            {"name": "Date", "value": "Wed, 15 Nov 2023 00:00:00 +0000"},
        ]},
    }


@pytest.fixture()
def bb(tmp_path, monkeypatch):
    """A shared projects.db with every Business Brain store scoped to it, plus
    the connector ingest/normalize modules bound to the same observation store."""
    path = str(tmp_path / "projects.db")
    monkeypatch.setenv("PROJECTS_DB_PATH", path)

    from backend.services.orchestrator import (
        observations_store, candidate_actions_store, goals_store,
        decisions_store, metrics_store, project_supervisor, candidate_synthesis,
    )
    from backend.services.github import ingest as gh_ingest, normalize as gh_norm
    from backend.services.github.store import GitHubConnection
    from backend.services.gmail import ingest as gm_ingest, normalize as gm_norm
    from backend.services.gmail.store import GmailConnection
    from backend.services.orchestrator import tasks_store

    stores = (observations_store, candidate_actions_store, goals_store,
              decisions_store, metrics_store, tasks_store)
    for mod in stores:
        monkeypatch.setattr(mod, "DB_PATH", path, raising=False)
    observations_store.init_observations_table()
    candidate_actions_store.init_candidate_actions_table()
    goals_store.init_goals_table()
    decisions_store.init_decisions_table()
    metrics_store.init_metrics_table()

    return SimpleNamespace(
        obs=observations_store, cas=candidate_actions_store, tasks=tasks_store,
        supervisor=project_supervisor, synth=candidate_synthesis,
        gh_ingest=gh_ingest, gh_norm=gh_norm, gh_conn=_gh_conn(GitHubConnection),
        gm_ingest=gm_ingest, gm_norm=gm_norm, gm_conn=_gm_conn(GmailConnection),
    )


# ── 1. GitHub observation reaches the Business Brain for its project ──────────

def test_github_observation_visible_to_business_brain_project_A(bb):
    issue = {"number": 10, "state": "open", "title": "Login is broken",
             "updated_at": "2024-04-01T00:00:00Z"}
    normalized = bb.gh_norm.normalize_issue(issue, REPO)
    assert bb.gh_ingest.ingest_one(bb.gh_conn, normalized) == "recorded"

    assessment = bb.supervisor.assess_business_brain(
        None, project_id="pA", user_id="uA", learnings=[])
    kinds = {o["kind"] for o in assessment["observations"]}
    assert "github.issue.opened" in kinds
    assert any(o["source"] == "github" for o in assessment["observations"])


# ── 2. Gmail observation reaches the Business Brain for its project ───────────

def test_gmail_observation_visible_to_business_brain_project_A(bb):
    normalized = bb.gm_norm.normalize_message(_gmail_message(), connection_email="me@x.com")
    assert bb.gm_ingest.ingest_one(bb.gm_conn, normalized) == "recorded"

    assessment = bb.supervisor.assess_business_brain(
        None, project_id="pA", user_id="uA", learnings=[])
    sources = {o["source"] for o in assessment["observations"]}
    assert "gmail" in sources
    assert any(o["kind"] == "gmail.message.received" for o in assessment["observations"])


# ── 3. No cross-project leakage ──────────────────────────────────────────────

def test_project_B_cannot_see_project_A_connector_observations(bb):
    from backend.services.github.store import GitHubConnection
    # A GitHub observation for project A, and a Gmail one for project B.
    bb.gh_ingest.ingest_one(bb.gh_conn, bb.gh_norm.normalize_issue(
        {"number": 1, "state": "open", "title": "A-only", "updated_at": "2024-04-01T00:00:00Z"}, REPO))
    conn_b = _gh_conn(GitHubConnection, project_id="pB", owner="uB")
    bb.gh_ingest.ingest_one(conn_b, bb.gh_norm.normalize_issue(
        {"number": 2, "state": "open", "title": "B-only", "updated_at": "2024-04-02T00:00:00Z"}, REPO))

    a = bb.supervisor.assess_business_brain(None, project_id="pA", user_id="uA", learnings=[])
    b = bb.supervisor.assess_business_brain(None, project_id="pB", user_id="uB", learnings=[])
    a_titles = {o["payload"].get("title") for o in a["observations"]}
    b_titles = {o["payload"].get("title") for o in b["observations"]}
    assert "A-only" in a_titles and "B-only" not in a_titles
    assert "B-only" in b_titles and "A-only" not in b_titles


# ── 4. Duplicate sync does not duplicate the effective signal ─────────────────

def test_duplicate_sync_does_not_duplicate_business_brain_signal(bb):
    issue = {"number": 10, "state": "open", "title": "Dup", "updated_at": "2024-04-01T00:00:00Z"}
    normalized = bb.gh_norm.normalize_issue(issue, REPO)
    assert bb.gh_ingest.ingest_one(bb.gh_conn, normalized) == "recorded"
    # Re-syncing the same resource dedups on the deterministic external id.
    assert bb.gh_ingest.ingest_one(bb.gh_conn, normalized) == "deduplicated"

    assessment = bb.supervisor.assess_business_brain(
        None, project_id="pA", user_id="uA", learnings=[])
    matching = [o for o in assessment["observations"] if o["kind"] == "github.issue.opened"]
    assert len(matching) == 1   # one effective signal, not two


# ── 5. Source timestamp preserved (old backfill never masquerades as fresh) ───

def test_source_timestamp_preserved(bb):
    issue = {"number": 10, "state": "open", "title": "Old", "updated_at": "2021-06-15T09:08:07Z"}
    normalized = bb.gh_norm.normalize_issue(issue, REPO)
    bb.gh_ingest.ingest_one(bb.gh_conn, normalized)

    [o] = bb.obs.recent_observations("pA", limit=10)
    assert o["observed_at"] == "2021-06-15T09:08:07Z"   # source time, not ingest time
    assert o["ingested_at"] != o["observed_at"]


# ── 6. Ingestion ALONE creates nothing executable (INPUTS ONLY) ──────────────

def test_observation_ingestion_alone_creates_no_task_or_candidate(bb):
    # A HIGH-importance observation would be a candidate IF synthesis ran — but
    # ingestion must not run it. Nothing executable exists until an explicit
    # Business Brain step is invoked.
    run = {"id": 900, "status": "completed", "conclusion": "failure", "name": "CI",
           "head_branch": "main", "updated_at": "2024-05-01T00:00:00Z"}
    normalized = bb.gh_norm.normalize_workflow_run(run, REPO)
    assert normalized["importance"] == "high"
    bb.gh_ingest.ingest_one(bb.gh_conn, normalized)

    assert bb.cas.list_candidate_actions("pA") == []
    assert bb.tasks.list_tasks_for_project("pA") == []


# ── 7. Business Brain PRIORITIZES the observation through its existing flow ───

def test_business_brain_prioritizes_high_importance_observation(bb):
    run = {"id": 900, "status": "completed", "conclusion": "failure", "name": "CI",
           "head_branch": "main", "updated_at": "2024-05-01T00:00:00Z"}
    normalized = bb.gh_norm.normalize_workflow_run(run, REPO)
    bb.gh_ingest.ingest_one(bb.gh_conn, normalized)

    # Explicit OBSERVATION → CANDIDATE promotion (the Business Brain step). This
    # is the existing authority, not a new connector engine.
    created = bb.synth.synthesize_candidates("pA", "uA")
    assert created, "a high-importance connector observation should yield a candidate"
    cands = bb.cas.list_candidate_actions("pA")
    assert any(c.get("source") == "OBSERVATION" for c in cands)

    # The Business Brain assessment now recommends acting on that candidate.
    assessment = bb.supervisor.assess_business_brain(
        None, project_id="pA", user_id="uA", learnings=[])
    assert assessment["recommended_next_action"] == "act_on_candidate_action"
    assert assessment["recommendation"]["type"] == "candidate_action"
    # And it did NOT auto-create a task/run — prioritization is a recommendation.
    assert bb.tasks.list_tasks_for_project("pA") == []
