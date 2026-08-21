# coding: utf-8
"""CORRELATED STORIES in the Workspace read model, and what each one's evidence
actually establishes.

Two properties are pinned here, and they are the two the Project page's whole
character rests on:

  ONE SUBJECT IS ONE CHANGE. A merge on GitHub, the Vercel deployment it
  triggered and the Slack thread about it are one thing that happened, not
  three. The identity that collapses them is the CORRELATION authority's own
  membership index — the workspace correlates nothing itself — so the count in
  "since your last visit" and the subjects in "current state" can never
  disagree. When no subject speaks for a row, the row keeps the previous
  attention-derived key: the fallback is the old behaviour, never a lost change.

  A STORY ANSWERS FOR ITS OWN EVIDENCE. Each correlated subject carries the
  `project_intelligence.grounding` reading of the observations that belong to
  IT — same function, same closed claim vocabulary, same support levels, asked
  about one story instead of the whole project. A deployment event establishes
  a deployment. It does not establish that the software works, that anyone used
  it, that anyone said anything about it, or that a goal moved — and the payload
  has to say so, per story, or the page will imply it.

No network, no model calls, no writes.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from backend.services.auth.identity import User

NOW = datetime(2026, 6, 10, 12, 0, 0, tzinfo=timezone.utc)
USER_A = User(id="uA", kind="email", external_id="email:a@x.com", display_name="A")


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


@pytest.fixture()
def env(tmp_path, monkeypatch, app):
    projects_db = str(tmp_path / "projects.db")
    sessions_db = str(tmp_path / "sessions.db")
    monkeypatch.setenv("PROJECTS_DB_PATH", projects_db)
    monkeypatch.setenv("SESSIONS_DB_PATH", sessions_db)
    monkeypatch.setenv("ENABLE_SESSIONS", "true")

    from backend.services.projects import store as projects_store
    from backend.services.projects import (
        knowledge as knowledge_mod, tasks_store, views_store,
    )
    from backend.services.orchestrator import (
        observations_store as obs, deliverables_store as dls, goals_store,
        decisions_store, candidate_actions_store, runs_store,
        tasks_store as orchestrator_tasks,
    )
    from backend.services.sessions import store as sessions_store

    for mod in (projects_store, tasks_store, views_store, obs, dls, goals_store,
                decisions_store, candidate_actions_store, runs_store,
                orchestrator_tasks):
        monkeypatch.setattr(mod, "DB_PATH", projects_db, raising=False)
    monkeypatch.setattr(sessions_store, "DB_PATH", sessions_db, raising=False)
    projects_store._reset_for_tests()
    projects_store.init()
    tasks_store.init_tasks_table()
    views_store.init_views_table()
    obs.init_observations_table()
    dls.init_deliverables_table()
    goals_store.init_goals_table()
    decisions_store.init_decisions_table()
    sessions_store.init()

    projects_store.create_project("uA", name="Fitness App", description="",
                                  project_id="pA")
    projects_store.create_project("uB", name="Theirs", description="",
                                  project_id="pB")

    from backend.services.project_brain import workspace as ws_mod
    yield {"ws": ws_mod, "obs": obs, "views": views_store, "goals": goals_store,
           "k": knowledge_mod, "projects": projects_store}
    app.dependency_overrides.clear()


def _observe(env, *, project="pA", source="github", kind="github.commit.pushed",
             summary="Commit abc", ext="x1", when=None, payload=None,
             user="uA"):
    return env["obs"].record_observation(
        user_id=user, project_id=project, source=source, kind=kind,
        summary=summary, external_id=ext,
        observed_at=_iso(when or (NOW - timedelta(hours=1))),
        payload=payload or {})


#: The branch a PR and the deployment it triggered share. That shared branch
#: key is what the correlation authority joins on — the fixtures mirror what the
#: real normalizers emit rather than inventing a link the product does not have.
BRANCH = "feat/checkout-retry"
SHA = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0"


def _merged_pr(env, *, when, ext="pr1", number=656, repo="acme/site",
               branch=BRANCH):
    return _observe(env, source="github", kind="github.pull_request.merged",
                    summary=f"PR #{number} merged", ext=ext, when=when,
                    payload={"repo": repo, "number": number,
                             "head_ref": branch,
                             "title": "Add checkout retry"})


def _deploy(env, *, when, ok=True, ext="d1", target="production",
            repo="acme/site", branch=BRANCH, sha=SHA):
    return _observe(
        env, source="vercel",
        kind="vercel.deployment.ready" if ok else "vercel.deployment.error",
        summary=("Production deployment successful" if ok
                 else "Production deployment failed"),
        ext=ext, when=when,
        payload={"target": target, "vercel_project_id": "vp-opaque-1",
                 "project_name": "acme-site",
                 "git": {"repo": repo, "ref": branch, "commit_sha": sha}})


def _build(env, now=NOW):
    return env["ws"].build("uA", "pA", now=now)


def _connector_changes(snapshot):
    return [c for c in snapshot["changes"]["items"] if c["change"] == "connector"]


def _state_by_id(snapshot, subject_id):
    for row in snapshot["project_state"]:
        if row["id"] == subject_id:
            return row
    return None


def _support(state, claim):
    for row in (state.get("grounding") or {}).get("claims") or []:
        if row.get("claim") == claim:
            return row.get("support")
    return None


# ══════════════════════════════════════════════════════════════════════════
# One subject is one change
# ══════════════════════════════════════════════════════════════════════════

def test_multi_provider_evidence_for_one_subject_is_one_change(env):
    """The headline property. Three providers, one real-world thing."""
    _merged_pr(env, when=NOW - timedelta(hours=3))
    _deploy(env, when=NOW - timedelta(hours=2), ok=True)
    _observe(env, source="github", kind="github.commit.pushed",
             summary="Merge commit landed", ext="c1",
             when=NOW - timedelta(minutes=150),
             payload={"repo": "acme/site", "sha": SHA,
                      "message": "Add checkout retry"})

    snapshot = _build(env)
    rows = _connector_changes(snapshot)
    grouped = [r for r in rows if r["subject_id"]]
    assert grouped, "no correlated subject spoke for any connector change"
    # Every row that a subject speaks for collapses onto that subject's key.
    by_subject = {}
    for row in grouped:
        by_subject.setdefault(row["subject_id"], []).append(row)
    assert all(len(v) == 1 for v in by_subject.values()), by_subject


def test_a_grouped_change_names_the_story_it_belongs_to(env):
    _merged_pr(env, when=NOW - timedelta(hours=3))
    _deploy(env, when=NOW - timedelta(hours=2), ok=False, ext="d1")
    _deploy(env, when=NOW - timedelta(hours=1), ok=False, ext="d2")
    snapshot = _build(env)
    grouped = [r for r in _connector_changes(snapshot) if r["subject_id"]]
    assert grouped
    row = grouped[0]
    assert row["subject"], "a grouped change must name its subject"
    assert row["state"], "a grouped change must carry the subject's state"
    # …and that subject is one the page can actually open.
    assert _state_by_id(snapshot, row["subject_id"]) is not None


def test_the_change_count_is_a_count_of_stories_not_of_provider_traffic(env):
    """Four provider events about one subject read as one meaningful thing."""
    _merged_pr(env, when=NOW - timedelta(hours=5))
    _deploy(env, when=NOW - timedelta(hours=4), ok=False, ext="d1")
    _deploy(env, when=NOW - timedelta(hours=3), ok=False, ext="d2")
    _deploy(env, when=NOW - timedelta(hours=2), ok=True, ext="d3")
    snapshot = _build(env)
    assert len(_connector_changes(snapshot)) == 1


def test_two_unrelated_subjects_stay_two_changes(env):
    """Correlation must not over-collapse: different repos are different work."""
    _merged_pr(env, when=NOW - timedelta(hours=4), ext="pr1", number=1,
               repo="acme/site", branch="feat/site")
    _deploy(env, when=NOW - timedelta(hours=3), ok=True, ext="d1",
            repo="acme/site", branch="feat/site")
    _observe(env, source="github", kind="github.check.failed",
             summary="CI failed on api", ext="ci2",
             when=NOW - timedelta(hours=2),
             payload={"repo": "acme/api", "check_id": "77", "branch": "main"})
    _observe(env, source="github", kind="github.check.failed",
             summary="CI failed on api again", ext="ci3",
             when=NOW - timedelta(hours=1),
             payload={"repo": "acme/api", "check_id": "77", "branch": "main"})
    rows = _connector_changes(_build(env))
    assert len(rows) >= 2, rows


def test_an_uncorrelated_row_keeps_the_previous_key_and_is_never_dropped(env):
    """A single mail belongs to no subject. It is still a change."""
    _observe(env, source="gmail", kind="gmail.message.received",
             summary="Invoice from the hosting provider", ext="m1",
             when=NOW - timedelta(hours=1),
             payload={"subject": "Invoice", "from": "billing@host.example"})
    rows = _connector_changes(_build(env))
    assert len(rows) == 1
    assert rows[0]["subject_id"] == ""
    assert rows[0]["key"].startswith("connector:")


def test_a_story_key_never_carries_an_opaque_provider_id(env):
    """The subject id is a digest over component keys — the provider's own
    resource ids stay on the server, exactly as the previous key rule required."""
    _merged_pr(env, when=NOW - timedelta(hours=3))
    _deploy(env, when=NOW - timedelta(hours=2), ok=False)
    for row in _connector_changes(_build(env)):
        assert "vp-opaque-1" not in row["key"]
        assert "vp-opaque-1" not in row["subject_id"]


def test_a_first_visit_still_says_recent_even_with_stories(env):
    _merged_pr(env, when=NOW - timedelta(hours=3))
    _deploy(env, when=NOW - timedelta(hours=2), ok=True)
    assert _build(env)["changes"]["mode"] == "recent"


def test_a_repeat_visit_reports_stories_that_landed_after_the_marker(env):
    _merged_pr(env, when=NOW - timedelta(days=3))
    env["views"].mark_viewed("uA", "pA", seen_through=_iso(NOW - timedelta(days=2)))
    _deploy(env, when=NOW - timedelta(hours=1), ok=False)
    changes = _build(env)["changes"]
    assert changes["mode"] == "since_last_visit"
    assert changes["count"] >= 1


def test_stories_never_leak_across_projects(env):
    _merged_pr(env, when=NOW - timedelta(hours=2))
    _observe(env, project="pB", user="uB", source="vercel",
             kind="vercel.deployment.error", summary="Theirs failed", ext="z1",
             when=NOW - timedelta(hours=1),
             payload={"target": "production", "vercel_project_id": "vp-other"})
    snapshot = _build(env)
    blob = repr(snapshot)
    assert "Theirs failed" not in blob and "vp-other" not in blob


def test_a_malformed_observation_never_breaks_the_read(env):
    env["obs"].record_observation(
        user_id="uA", project_id="pA", source="", kind="", summary="",
        external_id="bad1", observed_at="not-a-date", payload={})
    snapshot = _build(env)
    assert snapshot is not None and "changes" in snapshot


# ══════════════════════════════════════════════════════════════════════════
# What a story's own evidence establishes
# ══════════════════════════════════════════════════════════════════════════

def test_a_deployment_story_establishes_a_deployment_and_nothing_more(env):
    """The evidence-discipline rule, now per story rather than per project."""
    from backend.services.project_intelligence import grounding as gr

    _deploy(env, when=NOW - timedelta(hours=3), ok=False, ext="d1")
    _deploy(env, when=NOW - timedelta(hours=2), ok=True, ext="d2")
    snapshot = _build(env)
    states = [s for s in snapshot["project_state"] if s.get("grounding")]
    assert states, "no story carried a grounding reading"
    state = states[0]
    assert _support(state, gr.CLAIM_DEPLOYMENT) == gr.SUPPORT_DIRECT
    for claim in (gr.CLAIM_FUNCTIONALITY, gr.CLAIM_USERS, gr.CLAIM_FEEDBACK,
                  gr.CLAIM_GOAL_PROGRESS, gr.CLAIM_BUSINESS_OUTCOME):
        assert _support(state, claim) != gr.SUPPORT_DIRECT, claim


def test_a_project_goal_never_makes_a_deploy_story_look_like_goal_progress(env):
    """Grounding here is SUBJECT-scoped. Project-level records belong to the
    project-level reading; a story answers for its own rows."""
    from backend.services.project_intelligence import grounding as gr

    env["goals"].create_goal(project_id="pA", user_id="uA", title="Ship v1",
                             priority=3)
    _deploy(env, when=NOW - timedelta(hours=2), ok=True)
    _deploy(env, when=NOW - timedelta(hours=1), ok=True, ext="d2",
            target="preview")
    snapshot = _build(env)
    for state in snapshot["project_state"]:
        if state.get("grounding"):
            assert _support(state, gr.CLAIM_GOAL_PROGRESS) != gr.SUPPORT_DIRECT


def test_a_single_source_story_is_flagged_as_single_source(env):
    _deploy(env, when=NOW - timedelta(hours=3), ok=False, ext="d1")
    _deploy(env, when=NOW - timedelta(hours=2), ok=False, ext="d2")
    snapshot = _build(env)
    grounded = [s for s in snapshot["project_state"] if s.get("grounding")]
    assert grounded
    assert grounded[0]["grounding"]["single_source"] is True


def test_the_grounding_claim_vocabulary_is_the_authority_s_own(env):
    """No claim code is invented by the read model."""
    from backend.services.project_intelligence import grounding as gr

    _merged_pr(env, when=NOW - timedelta(hours=3))
    _deploy(env, when=NOW - timedelta(hours=2), ok=True)
    for state in _build(env)["project_state"]:
        for row in (state.get("grounding") or {}).get("claims") or []:
            assert row["claim"] in gr.CLAIMS
            assert row["support"] in (gr.SUPPORT_NONE, gr.SUPPORT_INDIRECT,
                                      gr.SUPPORT_DIRECT)


def test_no_story_carries_a_health_score_or_a_percentage(env):
    _merged_pr(env, when=NOW - timedelta(hours=3))
    _deploy(env, when=NOW - timedelta(hours=2), ok=False)
    for state in _build(env)["project_state"]:
        blob = repr(state.get("grounding") or {})
        for banned in ("health", "%", "percent", "score"):
            assert banned not in blob.lower(), (banned, blob)


def test_conflicting_evidence_is_shown_as_conflict_not_averaged_away(env):
    """A preview that passed and a production deploy that failed are two facts.
    The evidence rows have to keep enough to tell them apart."""
    _merged_pr(env, when=NOW - timedelta(hours=4))
    _deploy(env, when=NOW - timedelta(hours=3), ok=True, ext="dp",
            target="preview")
    _deploy(env, when=NOW - timedelta(hours=2), ok=False, ext="dpr",
            target="production")
    snapshot = _build(env)
    rows = []
    for state in snapshot["project_state"]:
        rows.extend(state["supporting"])
        rows.extend(state["contradicting"])
        rows.extend(state["context"])
    deploys = [r for r in rows if r["source"] == "vercel"]
    assert deploys, rows
    assert {r["environment"] for r in deploys} >= {"production"}
    assert {r["polarity"] for r in deploys} & {"positive", "negative"}


def test_an_empty_project_carries_no_stories_and_claims_nothing(env):
    snapshot = _build(env)
    assert snapshot["project_state"] == []
    assert snapshot["changes"]["count"] == 0
    assert snapshot["project_understanding"]["state"] == "no_evidence"
