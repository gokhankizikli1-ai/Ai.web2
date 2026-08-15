# coding: utf-8
"""Vercel ⇄ Project Brain / Business Brain — proving the wiring, end to end.

These tests exercise the REAL chain a Vercel sync uses, with NO connector-
specific reasoning loop anywhere in it:

    Vercel deployment → vercel.normalize (pure) → vercel.ingest
        → observations_store.record_observation()
        → project_brain.client (connector signals, via CONNECTOR_SOURCES)
        → project_supervisor.assess_business_brain() / candidate_synthesis
          (the Business Brain OBSERVE + PRIORITIZE authorities)

The guarantees asserted mirror the ones the connector-hardening sprint set for
Gmail/GitHub, plus the Vercel-specific ones from this PR:

 1. "vercel" is registered in the ONE canonical connector-source registry.
 2. A Vercel observation reaches Project Brain's connector signals for its own
    project, and the Business Brain assessment for that project.
 3. A production deployment FAILURE carries high importance and is prioritizable
    through the EXISTING candidate flow (no second prioritizer).
 4. A historical backfill keeps its historical timestamp.
 5. A duplicate sync does not amplify the effective signal.
 6. User B cannot consume user A's Vercel observations.
 7. Ingesting an observation ALONE creates no task/run/candidate.
 8. Vercel deployments preserve the git commit metadata Project Brain would need
    to correlate "production failed after the latest GitHub commit" — as
    STRUCTURE only, with no correlation engine added here.
 9. Gmail/GitHub signals are unaffected by Vercel's presence.

No network, no model calls: connections are constructed in-process and
observations are normalized from plain fixture dicts.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest

READY_MS = 1700000000000        # 2023-11-14T22:13:20Z
OLD_MS = 1600000000000          # 2020-09-13


def _vercel_conn(store_cls, *, project_id="pA", owner="uA"):
    return store_cls(
        project_id=project_id, owner_user_id=owner, provider="vercel",
        account_label="Acme Inc", team_id="team_9", installation_id="icfg_1",
        vercel_user_id="vu_1", access_token_enc="", vercel_project_id="prj_1",
        vercel_project_name="korvix-site", framework="nextjs",
        production_url="https://korvixai.com", status="connected",
        created_at="2024-01-01T00:00:00Z", updated_at="2024-01-01T00:00:00Z",
        last_sync_at="",
    )


def _deployment(uid="dpl_1", state="READY", target="production", ready=READY_MS,
                sha="abc123def456"):
    return {
        "uid": uid, "name": "korvix-site", "url": f"{uid}.vercel.app",
        "state": state, "target": target, "created": ready - 1000,
        "buildingAt": ready - 1000, "ready": ready,
        "meta": {"githubCommitSha": sha, "githubCommitRef": "main",
                 "githubCommitMessage": "Ship pricing page",
                 "githubRepo": "ai.web2", "githubOrg": "gokhankizikli1-ai"},
    }


@pytest.fixture()
def bb(tmp_path, monkeypatch):
    """A shared projects.db with every Business Brain store scoped to it, plus
    the Vercel (and Gmail/GitHub) ingest/normalize modules bound to the same
    observation store."""
    path = str(tmp_path / "projects.db")
    monkeypatch.setenv("PROJECTS_DB_PATH", path)
    monkeypatch.setenv("ENABLE_PROJECT_BRAIN", "true")

    from backend.services.orchestrator import (
        observations_store, candidate_actions_store, goals_store,
        decisions_store, metrics_store, project_supervisor, candidate_synthesis,
        tasks_store,
    )
    from backend.services.github import ingest as gh_ingest, normalize as gh_norm
    from backend.services.github.store import GitHubConnection
    from backend.services.project_brain import client as brain_client
    from backend.services.vercel import ingest as vc_ingest, normalize as vc_norm
    from backend.services.vercel.store import VercelConnection

    for mod in (observations_store, candidate_actions_store, goals_store,
                decisions_store, metrics_store, tasks_store):
        monkeypatch.setattr(mod, "DB_PATH", path, raising=False)
    observations_store.init_observations_table()
    candidate_actions_store.init_candidate_actions_table()
    goals_store.init_goals_table()
    decisions_store.init_decisions_table()
    metrics_store.init_metrics_table()

    gh_conn = GitHubConnection(
        project_id="pA", owner_user_id="uA", installation_id="100",
        repo_full_name="gokhankizikli1-ai/ai.web2", repo_id="42",
        created_at="2024-01-01T00:00:00Z", updated_at="2024-01-01T00:00:00Z",
        last_sync_at="")

    return SimpleNamespace(
        obs=observations_store, cas=candidate_actions_store, tasks=tasks_store,
        supervisor=project_supervisor, synth=candidate_synthesis,
        brain=brain_client, vc_ingest=vc_ingest, vc_norm=vc_norm,
        conn=_vercel_conn(VercelConnection),
        conn_b=_vercel_conn(VercelConnection, project_id="pB", owner="uB"),
        gh_ingest=gh_ingest, gh_norm=gh_norm, gh_conn=gh_conn,
    )


# ── 1. the ONE canonical connector-source registry ──────────────────────────

def test_vercel_is_registered_in_the_canonical_source_registry(bb):
    from backend.services.orchestrator import observations_store as obs
    assert "vercel" in obs.CONNECTOR_SOURCES
    # ...and it is still the single registry EVERY connector shares. New
    # connectors extend this tuple (Google Calendar added "calendar"), so the
    # invariant is "every shipped connector is registered here", not a frozen
    # set — pinning the exact membership would just have to be edited by each
    # new connector without asserting anything stronger.
    assert {"github", "gmail", "vercel", "calendar"} <= set(obs.CONNECTOR_SOURCES)
    assert bb.vc_norm.SOURCE in obs.CONNECTOR_SOURCES


# ── 2. Project Brain + Business Brain see Vercel activity ───────────────────

def test_vercel_deployment_enters_project_brain_connector_signals(bb):
    o = bb.vc_norm.normalize_deployment(_deployment(state="ERROR"),
                                        vercel_project_id="prj_1")
    assert bb.vc_ingest.ingest_one(bb.conn, o) == "recorded"

    brain = bb.brain.get("uA", "pA")
    assert brain is not None
    signal = next(s for s in brain.connector_signals if s["source"] == "vercel")
    assert signal["kind"] == "vercel.deployment.error"
    assert signal["importance"] == "high"
    # A failed deployment never reaches `ready`, so the source time is when the
    # build started — Vercel's own timestamp either way, never "now".
    assert signal["observed_at"] == "2023-11-14T22:13:19Z"
    assert brain.counts["connector_signals"] == 1


def test_vercel_observation_visible_to_business_brain(bb):
    o = bb.vc_norm.normalize_deployment(_deployment(), vercel_project_id="prj_1")
    bb.vc_ingest.ingest_one(bb.conn, o)
    assessment = bb.supervisor.assess_business_brain(
        None, project_id="pA", user_id="uA", learnings=[])
    sources = {x["source"] for x in assessment["observations"]}
    assert "vercel" in sources
    assert any(x["kind"] == "vercel.deployment.ready" for x in assessment["observations"])


def test_project_identity_signals_are_available_to_the_brain(bb):
    o = bb.vc_norm.normalize_project({
        "id": "prj_1", "name": "korvix-site", "framework": "nextjs",
        "updatedAt": READY_MS,
        "targets": {"production": {"alias": ["korvixai.com"]}}})
    bb.vc_ingest.ingest_one(bb.conn, o)
    [row] = [x for x in bb.obs.list_observations("pA")
             if x["kind"] == "vercel.project.updated"]
    assert row["payload"]["production_url"] == "https://korvixai.com"
    assert row["payload"]["framework"] == "nextjs"


# ── 3. production failure → high importance → EXISTING candidate flow ───────

def test_production_failure_is_prioritizable_through_the_existing_flow(bb):
    o = bb.vc_norm.normalize_deployment(_deployment(state="ERROR"),
                                        vercel_project_id="prj_1")
    assert o["importance"] == "high"
    bb.vc_ingest.ingest_one(bb.conn, o)

    # The EXISTING Business Brain promotion step — not a Vercel-specific engine.
    created = bb.synth.synthesize_candidates("pA", "uA")
    assert created, "a failed production deploy should yield a candidate"
    assert any(c.get("source") == "OBSERVATION" for c in bb.cas.list_candidate_actions("pA"))

    assessment = bb.supervisor.assess_business_brain(
        None, project_id="pA", user_id="uA", learnings=[])
    assert assessment["recommended_next_action"] == "act_on_candidate_action"
    # Prioritization is a RECOMMENDATION — nothing was executed.
    assert bb.tasks.list_tasks_for_project("pA") == []


def test_preview_success_does_not_reach_the_high_importance_path(bb):
    o = bb.vc_norm.normalize_deployment(_deployment(target=None),
                                        vercel_project_id="prj_1")
    assert o["importance"] == "low"
    bb.vc_ingest.ingest_one(bb.conn, o)
    bb.synth.synthesize_candidates("pA", "uA")
    assert bb.cas.list_candidate_actions("pA") == []


# ── 4/5. timestamp truth + idempotency ──────────────────────────────────────

def test_historical_backfill_stays_historical(bb):
    o = bb.vc_norm.normalize_deployment(_deployment(uid="old", ready=OLD_MS),
                                        vercel_project_id="prj_1")
    bb.vc_ingest.ingest_one(bb.conn, o)
    [row] = bb.obs.recent_observations("pA", limit=10)
    assert row["observed_at"].startswith("2020-09-13")
    assert row["ingested_at"] != row["observed_at"]


def test_duplicate_sync_does_not_amplify(bb):
    o = bb.vc_norm.normalize_deployment(_deployment(), vercel_project_id="prj_1")
    assert bb.vc_ingest.ingest_one(bb.conn, o) == "recorded"
    assert bb.vc_ingest.ingest_one(bb.conn, o) == "deduplicated"
    assessment = bb.supervisor.assess_business_brain(
        None, project_id="pA", user_id="uA", learnings=[])
    matching = [x for x in assessment["observations"]
                if x["kind"] == "vercel.deployment.ready"]
    assert len(matching) == 1


# ── 6. cross-user / cross-project isolation ─────────────────────────────────

def test_user_b_cannot_consume_user_a_vercel_observations(bb):
    bb.vc_ingest.ingest_one(bb.conn, bb.vc_norm.normalize_deployment(
        _deployment(uid="a-only"), vercel_project_id="prj_1"))
    bb.vc_ingest.ingest_one(bb.conn_b, bb.vc_norm.normalize_deployment(
        _deployment(uid="b-only"), vercel_project_id="prj_1"))

    a_brain = bb.brain.get("uA", "pA")
    b_brain = bb.brain.get("uB", "pB")
    a_ids = {s["external_id"] for s in a_brain.connector_signals}
    b_ids = {s["external_id"] for s in b_brain.connector_signals}
    assert "vercel:deployment:prj_1:a-only:ready" in a_ids
    assert "vercel:deployment:prj_1:b-only:ready" not in a_ids
    assert "vercel:deployment:prj_1:b-only:ready" in b_ids
    assert "vercel:deployment:prj_1:a-only:ready" not in b_ids


def test_brain_read_with_a_foreign_project_id_surfaces_nothing(bb):
    bb.vc_ingest.ingest_one(bb.conn, bb.vc_norm.normalize_deployment(
        _deployment(), vercel_project_id="prj_1"))
    # uB asking for pA gets no connector signal (owner-scoped read).
    foreign = bb.brain.get("uB", "pA")
    assert [s for s in (foreign.connector_signals if foreign else [])] == []


def test_ingest_ignores_provider_supplied_identity(bb):
    """The (user, project) scope comes from the CONNECTION, never from the
    normalized provider payload."""
    o = bb.vc_norm.normalize_deployment(_deployment(), vercel_project_id="prj_1")
    o["payload"]["owner_user_id"] = "uB"   # hostile provider content
    bb.vc_ingest.ingest_one(bb.conn, o)
    [row] = bb.obs.list_observations("pA")
    assert row["user_id"] == "uA" and row["project_id"] == "pA"
    assert bb.obs.list_observations("pB") == []


# ── 7. observation ≠ execution ──────────────────────────────────────────────

def test_ingestion_alone_creates_no_task_run_or_candidate(bb):
    o = bb.vc_norm.normalize_deployment(_deployment(state="ERROR"),
                                        vercel_project_id="prj_1")
    assert o["importance"] == "high"
    bb.vc_ingest.ingest_one(bb.conn, o)
    assert bb.cas.list_candidate_actions("pA") == []
    assert bb.tasks.list_tasks_for_project("pA") == []


# ── 8. correlation EVIDENCE (structure only, no engine) ─────────────────────

def test_deployment_preserves_the_commit_metadata_needed_to_correlate(bb):
    """"Production deployment failed after the latest GitHub commit" must be
    answerable LATER from stored structure. This PR stores the evidence; it adds
    no correlation engine."""
    sha = "abc123def456"
    bb.gh_ingest.ingest_one(bb.gh_conn, bb.gh_norm.normalize_commit(
        {"sha": sha, "commit": {"message": "Ship pricing page",
                                "author": {"date": "2023-11-14T21:00:00Z"}}},
        {"id": 42, "full_name": "gokhankizikli1-ai/ai.web2"}))
    bb.vc_ingest.ingest_one(bb.conn, bb.vc_norm.normalize_deployment(
        _deployment(state="ERROR", sha=sha), vercel_project_id="prj_1"))

    brain = bb.brain.get("uA", "pA")
    assert {s["source"] for s in brain.connector_signals} == {"github", "vercel"}

    rows = bb.obs.list_observations("pA", sources=list(bb.obs.CONNECTOR_SOURCES))
    vercel_row = next(r for r in rows if r["source"] == "vercel")
    github_row = next(r for r in rows if r["source"] == "github")
    # The SAME sha is present on both sides — the join key exists in storage.
    assert vercel_row["payload"]["git"]["commit_sha"] == sha
    assert github_row["payload"]["sha"] == sha
    assert vercel_row["payload"]["git"]["repo"] == github_row["payload"]["repo"]
    # ...and the deployment failure is the later event.
    assert vercel_row["observed_at"] > github_row["observed_at"]


# ── 9. Gmail/GitHub behaviour is unchanged ──────────────────────────────────

def test_github_signals_are_unaffected_by_the_new_source(bb):
    bb.gh_ingest.ingest_one(bb.gh_conn, bb.gh_norm.normalize_issue(
        {"number": 7, "state": "open", "title": "Login is broken",
         "updated_at": "2024-04-01T00:00:00Z"},
        {"id": 42, "full_name": "gokhankizikli1-ai/ai.web2"}))
    bb.vc_ingest.ingest_one(bb.conn, bb.vc_norm.normalize_deployment(
        _deployment(), vercel_project_id="prj_1"))

    brain = bb.brain.get("uA", "pA")
    gh = next(s for s in brain.connector_signals if s["source"] == "github")
    assert gh["kind"] == "github.issue.opened"
    assert gh["summary"].startswith("Issue #7 opened")
    assert brain.counts["connector_signals"] == 2
