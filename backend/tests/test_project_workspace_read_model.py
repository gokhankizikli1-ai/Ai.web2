# coding: utf-8
"""The Project WORKSPACE read model + `GET /v2/projects/{id}/workspace`.

This is the single request the Project page renders from, so it is also the
single place a mistake would leak one account's project into another's browser.
These tests pin, adversarially:

  * OWNERSHIP — a project the caller does not own is 404 (existence-hidden), and
    the read model itself returns None rather than a partially-filled shell;
  * ISOLATION — no cross-project and no cross-user observations, products, chats
    or connector bindings, including for a stale binding recorded by a different
    owner;
  * SECRECY — no credential material and no opaque provider resource id in the
    response;
  * BOUNDS + STABLE ORDER — every list is capped and deterministically ordered;
  * TRUTHFUL DEGRADATION — an empty project, and a project read while the
    Project Brain flag is OFF, both succeed with honest empty sections;
  * NO SIDE EFFECTS — reading the workspace creates no observation, candidate
    action, task or run.

No network, no model calls.
"""
from __future__ import annotations

import pytest

from backend.core import deps
from backend.services.auth.identity import User

USER_A = User(id="uA", kind="email", external_id="email:a@x.com", display_name="A")
USER_B = User(id="uB", kind="email", external_id="email:b@x.com", display_name="B")


@pytest.fixture()
def env(tmp_path, monkeypatch, app):
    """One tmp projects.db shared by every project-scoped authority (exactly how
    production co-locates them) plus a tmp sessions.db for chats."""
    projects_db = str(tmp_path / "projects.db")
    sessions_db = str(tmp_path / "sessions.db")
    monkeypatch.setenv("PROJECTS_DB_PATH", projects_db)
    monkeypatch.setenv("SESSIONS_DB_PATH", sessions_db)
    monkeypatch.setenv("ENABLE_SESSIONS", "true")
    monkeypatch.setenv("ENABLE_PROJECT_BRAIN", "true")

    from backend.services.projects import store as projects_store
    from backend.services.orchestrator import (
        observations_store as obs, deliverables_store as dls,
        build_execution_store as bes, goals_store, decisions_store,
        tasks_store, runs_store, candidate_actions_store,
    )
    from backend.services.connectors import store as shared
    from backend.services.sessions import store as sessions_store
    from backend.services.sessions import client as sessions_client
    from backend.services.gmail import crypto as credential_crypto

    # Every project-scoped store points at the tmp DB. tasks/runs/candidates are
    # included so the "reading writes nothing" assertion inspects THIS test's
    # tables rather than whatever a previously-run test left in the shared file.
    for mod in (projects_store, obs, dls, bes, goals_store, decisions_store,
                tasks_store, runs_store, candidate_actions_store):
        monkeypatch.setattr(mod, "DB_PATH", projects_db, raising=False)
    monkeypatch.setattr(sessions_store, "DB_PATH", sessions_db, raising=False)
    projects_store._reset_for_tests()
    projects_store.init()
    obs.init_observations_table()
    dls.init_deliverables_table()
    goals_store.init_goals_table()
    decisions_store.init_decisions_table()
    sessions_store.init()
    shared._reset_for_tests()
    shared.init_tables()
    credential_crypto.set_cipher_for_tests(credential_crypto._ReversibleTestCipher())

    projects_store.create_project("uA", name="Fitness App", description="Track workouts.",
                                  project_id="pA")
    projects_store.create_project("uA", name="Second", description="", project_id="pA2")
    projects_store.create_project("uB", name="Theirs", description="", project_id="pB")

    from backend.services.project_brain import workspace as ws_mod
    yield {
        "ws": ws_mod, "projects": projects_store, "obs": obs, "dls": dls,
        "goals": goals_store, "shared": shared, "sessions": sessions_client,
        "db": projects_db,
    }
    credential_crypto.set_cipher_for_tests(None)
    app.dependency_overrides.clear()


def _as(app, user):
    app.dependency_overrides[deps.current_user] = lambda: user


def _observe(env, *, user="uA", project="pA", source="github",
             kind="github.commit.pushed", summary="Commit abc", ext="x1",
             importance="normal", when="2026-05-30T10:00:00Z", payload=None):
    return env["obs"].record_observation(
        user_id=user, project_id=project, source=source, kind=kind, summary=summary,
        external_id=ext, importance=importance, observed_at=when, payload=payload or {})


def _product(env, project="pA", *, title="Landing Page", build_type="web",
             status="completed", run_id="run-1"):
    kind = "app_build" if build_type == "app" else "web_build"
    return env["dls"].create_deliverable(
        run_id=run_id, agent_id="builder", node_id="build", kind=kind, title=title,
        project_id=project, status=status,
        content={"build_type": build_type, "build_status": status,
                 "artifact_ref": "artifact://abc", "build_ref": "build://xyz"})


def _chat(env, project="pA", *, owner="uA", title="Pricing page", attach=True):
    ws = env["sessions"].ensure_default_workspace(owner)
    th = env["sessions"].create_thread(workspace_id=ws.id, title=title, mode="chat")
    if attach:
        env["projects"].attach_thread(project, th.id)
    return th


# ── ownership ────────────────────────────────────────────────────────────────

def test_owner_gets_their_project(env):
    snap = env["ws"].build("uA", "pA")
    assert snap is not None
    assert snap["project"]["id"] == "pA"
    assert snap["project"]["name"] == "Fitness App"


def test_non_owner_gets_nothing(env):
    assert env["ws"].build("uB", "pA") is None


def test_unknown_project_gets_nothing(env):
    assert env["ws"].build("uA", "does-not-exist") is None


def test_missing_identity_fails_closed(env):
    assert env["ws"].build("", "pA") is None
    assert env["ws"].build("uA", "") is None


def test_ownership_change_fails_closed(env):
    """The gate is re-evaluated on every read — there is no cached authority — so
    the moment the canonical record names a different owner the previous owner
    stops seeing the project."""
    assert env["ws"].build("uA", "pA") is not None
    env["projects"].delete_project("pA")
    env["projects"].create_project("uB", name="Fitness App", project_id="pA")
    assert env["ws"].build("uA", "pA") is None
    assert env["ws"].build("uB", "pA") is not None


# ── isolation ────────────────────────────────────────────────────────────────

def test_no_cross_project_observations(env):
    _observe(env, project="pA", summary="A-only", ext="a1")
    _observe(env, project="pA2", summary="B-only", ext="a2")
    titles = {a["title"] for a in env["ws"].build("uA", "pA")["activity"]}
    assert "A-only" in titles
    assert "B-only" not in titles


def test_no_cross_user_observations_on_the_same_project_id(env):
    """The observation table is (user, project) scoped. Even if another user
    somehow recorded rows against this project id, the owner's read must not
    show them."""
    _observe(env, user="uA", project="pA", summary="mine", ext="m1")
    _observe(env, user="uB", project="pA", summary="theirs", ext="t1")
    titles = {a["title"] for a in env["ws"].build("uA", "pA")["activity"]}
    assert titles == {"mine"}


def test_no_cross_project_products_or_chats(env):
    _product(env, "pA", title="A Landing")
    _product(env, "pA2", title="Other Landing")
    _chat(env, "pA", title="A chat")
    _chat(env, "pA2", title="Other chat")
    snap = env["ws"].build("uA", "pA")
    assert [p["title"] for p in snap["products"]] == ["A Landing"]
    assert [c["title"] for c in snap["chats"]] == ["A chat"]


def test_a_thread_owned_by_another_user_is_never_surfaced(env):
    """A stale binding pointing at a thread in someone else's workspace is
    dropped by the defense-in-depth owner check, not rendered."""
    foreign = _chat(env, "pA", owner="uB", title="Their conversation")
    mine = _chat(env, "pA", owner="uA", title="My conversation")
    titles = {c["title"] for c in env["ws"].build("uA", "pA")["chats"]}
    assert titles == {"My conversation"}
    assert foreign.id != mine.id


def test_connector_binding_recorded_for_another_owner_contributes_nothing(env):
    auth = env["shared"].upsert_authorization(
        owner_user_id="uB", provider="gmail", account_key="b@x.com",
        account_label="b@x.com", credentials={"refresh_token": "RT"})
    env["shared"].set_binding(project_id="pA", authorization_id=auth.id,
                              owner_user_id="uB", resources=[])
    assert env["ws"].build("uA", "pA")["connectors"] == []


def test_authorization_without_a_project_binding_contributes_nothing(env):
    """Authorizing a provider for the ACCOUNT is not the same as letting this
    project use it — an unbound authorization must not appear here."""
    env["shared"].upsert_authorization(
        owner_user_id="uA", provider="gmail", account_key="a@x.com",
        account_label="a@x.com", credentials={"refresh_token": "RT"})
    assert env["ws"].build("uA", "pA")["connectors"] == []


# ── secrecy ──────────────────────────────────────────────────────────────────

def test_no_credentials_and_no_opaque_resource_ids_in_the_payload(env):
    auth = env["shared"].upsert_authorization(
        owner_user_id="uA", provider="github", account_key="acme",
        account_label="acme",
        credentials={"refresh_token": "SUPER-SECRET-RT",
                     "access_token": "SUPER-SECRET-AT"})
    env["shared"].set_binding(
        project_id="pA", authorization_id=auth.id, owner_user_id="uA",
        resources=[{"resource_id": "R_kgDOopaque123", "resource_label": "acme/site",
                    "resource": {}}])
    snap = env["ws"].build("uA", "pA")
    blob = str(snap)
    for secret in ("SUPER-SECRET-RT", "SUPER-SECRET-AT", "R_kgDOopaque123", auth.id,
                   "credentials", "refresh_token"):
        assert secret not in blob, secret
    row = next(c for c in snap["connectors"] if c["provider"] == "github")
    assert row["resources"] == ["acme/site"]      # the human label only
    assert row["label"] == "GitHub"


# ── bounds + stable ordering ─────────────────────────────────────────────────

def test_every_list_is_bounded(env):
    for i in range(40):
        _observe(env, ext=f"o{i}", summary=f"commit {i}",
                 when=f"2026-05-{(i % 28) + 1:02d}T10:00:00Z")
    for i in range(20):
        _product(env, title=f"Build {i}", run_id=f"run-{i}")
    for i in range(20):
        _chat(env, title=f"Chat {i}")
    for i in range(20):
        env["goals"].create_goal(project_id="pA", user_id="uA", title=f"Goal {i}")
    snap = env["ws"].build("uA", "pA")
    assert len(snap["activity"]) <= 12
    assert len(snap["products"]) <= 8
    assert len(snap["chats"]) <= 8
    assert len(snap["goals"]) <= 5
    assert len(snap["attention"]) <= 5
    assert snap["counts"]["activity"] == len(snap["activity"])


def test_activity_is_newest_first_and_deterministic(env):
    _observe(env, ext="old", summary="older", when="2026-05-01T10:00:00Z")
    _observe(env, ext="new", summary="newer", when="2026-05-20T10:00:00Z")
    first = env["ws"].build("uA", "pA")["activity"]
    assert [a["title"] for a in first][:2] == ["newer", "older"]
    second = env["ws"].build("uA", "pA")["activity"]
    assert [a["id"] for a in first] == [a["id"] for a in second]


def test_activity_is_a_chronology_and_does_not_ration_by_event_kind(env):
    """Activity reports WHAT HAPPENED, newest first — it does not decide what
    matters. A per-kind quota was tried here and removed: it can only ever drop
    real rows (never promote an important one), it drops them even when nothing
    else is competing for the space, and it makes the rendered count quietly
    smaller than the bound. Importance is `attention`'s job.

    So a burst is reported as a burst — and the CI failure underneath it is
    still surfaced, by the authority that actually owns importance."""
    for i in range(8):
        _observe(env, ext=f"c{i}", kind="github.commit.pushed",
                 summary=f"chore {i}", when=f"2026-05-20T10:0{i}:00Z")
    _observe(env, ext="ci", kind="github.check.failed", summary="CI failed",
             when="2026-05-20T09:00:00Z",
             payload={"repo": "acme/site", "check_id": "42"})

    # A fixed `now` near the fixture, so the CI signal is current rather than
    # aged out by the attention window.
    from datetime import datetime, timezone
    snap = env["ws"].build("uA", "pA",
                           now=datetime(2026, 5, 20, 12, 0, tzinfo=timezone.utc))
    activity = snap["activity"]
    # Newest-first, nothing rationed away, one global bound.
    assert [a["title"] for a in activity][:3] == ["chore 7", "chore 6", "chore 5"]
    assert len([a for a in activity if a["kind"] == "github.commit.pushed"]) == 8
    assert len(activity) <= 12
    # The important thing is NOT relying on the timeline to surface it.
    assert [a["reason"] for a in snap["attention"]] == ["ci_failed"]
    assert snap["today"]["attention"]["reason"] == "ci_failed"


def test_activity_ordering_is_total_and_stable_with_many_same_kind_rows(env):
    """Ties within one kind resolve deterministically (timestamp, then source,
    then id), so repeat reads never reshuffle the timeline."""
    for i in range(6):
        _observe(env, ext=f"t{i}", kind="github.commit.pushed",
                 summary=f"commit {i}", when="2026-05-20T10:00:00Z")
    first = env["ws"].build("uA", "pA")["activity"]
    second = env["ws"].build("uA", "pA")["activity"]
    assert [a["id"] for a in first] == [a["id"] for a in second]


def test_activity_merges_connector_chat_and_build_sources(env):
    _observe(env, ext="g1", summary="Commit abc", when="2026-05-20T10:00:00Z")
    _chat(env, title="Design chat")
    _product(env, title="Landing Page")
    sources = {a["source"] for a in env["ws"].build("uA", "pA")["activity"]}
    assert {"github", "chat", "build"} <= sources


def test_activity_never_carries_the_raw_observation_payload(env):
    _observe(env, source="gmail", kind="gmail.message.received",
             summary="Email: Invoice — from billing@x.com", ext="gm1",
             payload={"snippet": "PRIVATE BODY TEXT", "from": "billing@x.com",
                      "label_ids": ["UNREAD"]})
    snap = env["ws"].build("uA", "pA")
    assert "PRIVATE BODY TEXT" not in str(snap)
    row = next(a for a in snap["activity"] if a["source"] == "gmail")
    assert set(row) == {"id", "source", "kind", "title", "occurred_at", "ref"}


def test_goals_are_ordered_by_priority_and_read_only(env):
    env["goals"].create_goal(project_id="pA", user_id="uA", title="Low one", priority=1)
    env["goals"].create_goal(project_id="pA", user_id="uA", title="Critical one", priority=4)
    goals = env["ws"].build("uA", "pA")["goals"]
    assert [g["title"] for g in goals][:2] == ["Critical one", "Low one"]
    assert all(g["source"] in ("goals", "memory") for g in goals)


# ── attention wiring ─────────────────────────────────────────────────────────

def test_attention_surfaces_a_real_blocker_and_ignores_noise(env):
    _observe(env, source="vercel", kind="vercel.deployment.error",
             summary="Production deployment failed", ext="v1",
             importance="high", when="2026-05-30T09:00:00Z",
             payload={"vercel_project_id": "vp1", "target": "production"})
    for i in range(5):
        _observe(env, ext=f"c{i}", summary=f"commit {i}", when="2026-05-30T08:00:00Z")
    snap = env["ws"].build("uA", "pA",
                           now=__import__("datetime").datetime(
                               2026, 5, 30, 12, 0,
                               tzinfo=__import__("datetime").timezone.utc))
    assert [a["reason"] for a in snap["attention"]] == ["deploy_failed"]
    assert snap["counts"]["attention"] == 1


# ── truthful degradation ─────────────────────────────────────────────────────

def test_empty_project_is_honest_not_broken(env):
    snap = env["ws"].build("uA", "pA2")
    assert snap["attention"] == [] and snap["activity"] == []
    assert snap["goals"] == [] and snap["products"] == [] and snap["chats"] == []
    assert snap["connectors"] == []
    assert snap["summary"] == {"text": "", "source": ""}
    assert snap["freshness"]["last_activity_at"] == ""
    assert snap["freshness"]["generated_at"]


def test_summary_falls_back_to_the_project_description(env):
    snap = env["ws"].build("uA", "pA")
    assert snap["summary"]["text"] == "Track workouts."
    assert snap["summary"]["source"] == "project"


def test_workspace_still_works_with_the_project_brain_disabled(env, monkeypatch):
    monkeypatch.setenv("ENABLE_PROJECT_BRAIN", "false")
    _product(env, title="Landing Page")
    _chat(env, title="A chat")
    snap = env["ws"].build("uA", "pA")
    assert snap is not None
    assert [p["title"] for p in snap["products"]] == ["Landing Page"]
    assert [c["title"] for c in snap["chats"]] == ["A chat"]
    # Brain-derived slices degrade truthfully rather than 503-ing the page.
    assert snap["summary"]["source"] == "project"


def test_freshness_reports_only_real_timestamps(env):
    _observe(env, ext="o1", summary="commit", when="2026-05-20T10:00:00Z")
    fresh = env["ws"].build("uA", "pA")["freshness"]
    assert fresh["last_observation_at"] == "2026-05-20T10:00:00Z"
    assert fresh["last_activity_at"] == "2026-05-20T10:00:00Z"
    assert fresh["last_connector_sync_at"] == ""


# ── no side effects ──────────────────────────────────────────────────────────

def test_reading_the_workspace_writes_nothing(env):
    _observe(env, source="vercel", kind="vercel.deployment.error", ext="v1",
             importance="high", summary="Production deployment failed",
             payload={"vercel_project_id": "vp1", "target": "production"})
    from backend.services.orchestrator import (
        candidate_actions_store as cas, tasks_store, runs_store,
    )
    before_obs = len(env["obs"].list_observations("pA", limit=500))
    for _ in range(3):
        env["ws"].build("uA", "pA")
    assert len(env["obs"].list_observations("pA", limit=500)) == before_obs
    # A high-importance observation must NOT have been promoted into a candidate
    # action / task / run by the mere act of rendering the page.
    assert cas.list_candidate_actions("pA", limit=50) == []
    assert tasks_store.list_tasks_for_project("pA") == []
    assert runs_store.list_runs(project_id="pA") == []


# ── HTTP surface ─────────────────────────────────────────────────────────────

def test_route_returns_the_snapshot_for_the_owner(client, env, app):
    _as(app, USER_A)
    res = client.get("/v2/projects/pA/workspace")
    assert res.status_code == 200
    body = res.json()
    assert body["success"] is True
    assert body["data"]["project"]["id"] == "pA"
    assert set(body["data"]) == {
        "project", "summary", "today", "goals", "attention", "project_state",
        "project_understanding", "focus",
        "activity", "changes", "tasks", "knowledge", "products", "chats",
        "connectors", "freshness", "counts",
        # Route-level additions to the projection. `refresh` is smart-refresh
        # COORDINATION metadata (what the page should wait for), and
        # `feed_preferences` is this user's presentation choice for this
        # project — neither is project state, and neither is produced by
        # `project_workspace.build`.
        "refresh", "feed_preferences",
    }


def test_route_hides_the_existence_of_another_users_project(client, env, app):
    _as(app, USER_B)
    res = client.get("/v2/projects/pA/workspace")
    assert res.status_code == 404
    assert "pA" not in res.text or "PROJECT_NOT_FOUND" in res.text
    # Identical response for a project that does not exist at all.
    missing = client.get("/v2/projects/nope/workspace")
    assert missing.status_code == 404


def test_route_ignores_a_client_supplied_owner(client, env, app):
    """Identity comes from the server session only. A client that asks for
    another owner's project — however it decorates the request — still gets 404."""
    _as(app, USER_B)
    res = client.get("/v2/projects/pA/workspace",
                     params={"user_id": "uA", "owner_user_id": "uA"},
                     headers={"X-User-Id": "uA"})
    assert res.status_code == 404
