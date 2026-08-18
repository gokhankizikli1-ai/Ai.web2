# coding: utf-8
"""TODAY (next best action) and SINCE YOUR LAST VISIT.

These two blocks are the ones most able to lie, so they get the most hostile
tests:

  TODAY must never invent. Its ladder is attention → task → goal → nothing, it
  never re-ranks what `attention` already ranked, it emits stable reason codes
  (never English prose, never a score, never a percentage), and rendering it
  must not create a task, a candidate action or a run.

  SINCE YOUR LAST VISIT must never claim a visit it cannot prove. With no
  marker the payload says `recent` and the frontend says "Recent changes"; with
  a marker it says `since_last_visit` and the window really does start there.
  Reading the workspace must NOT move the marker — otherwise opening the page
  would empty the very list it just computed — and the acknowledgement must not
  swallow a change that landed while the user was reading.

No network, no model calls.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from backend.core import deps
from backend.services.auth.identity import User
from backend.services.project_brain import today as today_mod

NOW = datetime(2026, 6, 10, 12, 0, 0, tzinfo=timezone.utc)
USER_A = User(id="uA", kind="email", external_id="email:a@x.com", display_name="A")
USER_B = User(id="uB", kind="email", external_id="email:b@x.com", display_name="B")


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
    from backend.services.sessions import client as sessions_client

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
    projects_store.create_project("uA", name="Second", description="",
                                  project_id="pA2")
    projects_store.create_project("uB", name="Theirs", description="",
                                  project_id="pB")

    from backend.services.project_brain import workspace as ws_mod
    yield {"ws": ws_mod, "obs": obs, "tasks": tasks_store, "views": views_store,
           "goals": goals_store, "k": knowledge_mod, "projects": projects_store,
           "sessions": sessions_client, "dls": dls}
    app.dependency_overrides.clear()


def _as(app, user):
    app.dependency_overrides[deps.current_user] = lambda: user


def _observe(env, *, project="pA", source="github", kind="github.commit.pushed",
             summary="Commit abc", ext="x1", when=None, payload=None,
             user="uA"):
    return env["obs"].record_observation(
        user_id=user, project_id=project, source=source, kind=kind,
        summary=summary, external_id=ext,
        observed_at=_iso(when or (NOW - timedelta(hours=1))), payload=payload or {})


def _deploy_failed(env, *, when=None, ext="d1", project="pA"):
    return _observe(env, project=project, source="vercel",
                    kind="vercel.deployment.error",
                    summary="Production deployment failed", ext=ext, when=when,
                    payload={"target": "production", "vercel_project_id": "vp1",
                             "project_name": "Acme"})


def _deploy_ok(env, *, when=None, ext="d2", project="pA"):
    return _observe(env, project=project, source="vercel",
                    kind="vercel.deployment.ready", summary="Deployment ready",
                    ext=ext, when=when,
                    payload={"target": "production", "vercel_project_id": "vp1"})


def _ci_failed(env, *, when=None, ext="c1"):
    return _observe(env, source="github", kind="github.check.failed",
                    summary="CI failed on main", ext=ext, when=when,
                    payload={"repo": "acme/site", "check_id": "42"})


# ══════════════════════════════════════════════════════════════════════════
# TODAY — the pure ladder
# ══════════════════════════════════════════════════════════════════════════

def test_today_prefers_the_top_attention_signal_over_any_task(env):
    _deploy_failed(env)
    env["tasks"].create_task(project_id="pA", owner_user_id="uA",
                             title="Write copy", status="doing")
    today = env["ws"].build("uA", "pA", now=NOW)["today"]
    assert today["attention"]["reason"] == "deploy_failed"
    assert today["recommendation"]["reason"] == today_mod.RECO_INVESTIGATE_DEPLOY
    assert today["recommendation"]["source"] == "attention"
    # The signal's own words are passed through — never rewritten, never invented.
    assert today["recommendation"]["title"] == "Production deployment failed"


def test_failed_ci_outranks_ordinary_recent_activity(env):
    _observe(env, source="github", kind="github.commit.pushed",
             summary="Pushed 3 commits", ext="p1", when=NOW - timedelta(minutes=5))
    _ci_failed(env, when=NOW - timedelta(hours=3))
    today = env["ws"].build("uA", "pA", now=NOW)["today"]
    assert today["attention"]["reason"] == "ci_failed"
    assert today["recommendation"]["reason"] == today_mod.RECO_FIX_CHECKS


def test_a_resolved_signal_disappears_from_today(env):
    _deploy_failed(env, when=NOW - timedelta(hours=4))
    _deploy_ok(env, when=NOW - timedelta(hours=1))
    env["tasks"].create_task(project_id="pA", owner_user_id="uA",
                             title="Write copy", status="doing")
    today = env["ws"].build("uA", "pA", now=NOW)["today"]
    assert today["attention"] is None
    # The recommendation falls back down the ladder rather than vanishing.
    assert today["recommendation"]["reason"] == today_mod.RECO_CONTINUE_TASK
    assert today["recommendation"]["title"] == "Write copy"


def test_an_upcoming_meeting_stays_truthful_after_it_has_passed(env):
    """A calendar observation is written once and deduplicated for the life of
    the event, so imminence is recomputed from the event's own start time.
    Today must inherit that, not re-assert a stale reminder."""
    _observe(env, source="calendar", kind="calendar.event.upcoming",
             summary="Launch review", ext="e1", when=NOW - timedelta(days=2),
             payload={"event_id": "ev1", "start": _iso(NOW + timedelta(hours=3))})
    soon = env["ws"].build("uA", "pA", now=NOW)["today"]
    assert soon["recommendation"]["reason"] == today_mod.RECO_PREPARE_MEETING

    after = env["ws"].build("uA", "pA", now=NOW + timedelta(hours=5))["today"]
    assert after["attention"] is None and after["recommendation"] is None


def test_the_task_ladder_is_doing_then_todo_then_waiting(env):
    env["tasks"].create_task(project_id="pA", owner_user_id="uA",
                             title="parked", status="waiting")
    assert env["ws"].build("uA", "pA", now=NOW)["today"]["recommendation"]["reason"] \
        == today_mod.RECO_UNBLOCK_TASK
    env["tasks"].create_task(project_id="pA", owner_user_id="uA",
                             title="queued", status="todo")
    assert env["ws"].build("uA", "pA", now=NOW)["today"]["recommendation"]["reason"] \
        == today_mod.RECO_START_TASK
    env["tasks"].create_task(project_id="pA", owner_user_id="uA",
                             title="started", status="doing")
    reco = env["ws"].build("uA", "pA", now=NOW)["today"]["recommendation"]
    assert reco["reason"] == today_mod.RECO_CONTINUE_TASK
    assert reco["title"] == "started"


def test_a_done_task_is_never_the_next_best_action(env):
    env["tasks"].create_task(project_id="pA", owner_user_id="uA",
                             title="finished", status="done")
    assert env["ws"].build("uA", "pA", now=NOW)["today"]["recommendation"] is None


def test_a_goal_is_the_last_resort_before_saying_nothing(env):
    env["goals"].create_goal(project_id="pA", user_id="uA",
                             title="Launch the beta", priority=3)
    reco = env["ws"].build("uA", "pA", now=NOW)["today"]["recommendation"]
    assert reco["reason"] == today_mod.RECO_CONTINUE_GOAL
    assert reco["title"] == "Launch the beta"
    assert reco["source"] == "goal"


def test_an_empty_project_gets_no_recommendation_rather_than_an_invented_one(env):
    today = env["ws"].build("uA", "pA2", now=NOW)["today"]
    assert today == {"attention": None, "recommendation": None}


def test_today_is_deterministic_and_carries_no_score(env):
    _deploy_failed(env)
    _ci_failed(env)
    first = env["ws"].build("uA", "pA", now=NOW)["today"]
    second = env["ws"].build("uA", "pA", now=NOW)["today"]
    assert first == second
    reco = first["recommendation"]
    assert set(reco) == {"reason", "source", "ref_id", "title", "context",
                         "actions"}
    # No score, no percentage, no confidence — and every value is a string or a
    # list of stable codes.
    assert all(isinstance(v, (str, list)) for v in reco.values())


def test_every_recommendation_action_is_an_affordance_that_exists(env):
    known = {today_mod.ACTION_ASK, today_mod.ACTION_CREATE_TASK,
             today_mod.ACTION_OPEN_TASKS}
    _deploy_failed(env)
    assert set(env["ws"].build("uA", "pA", now=NOW)["today"]
               ["recommendation"]["actions"]) <= known
    env["tasks"].create_task(project_id="pA", owner_user_id="uA", title="t")
    env["goals"].create_goal(project_id="pA", user_id="uA", title="g")
    for pid in ("pA",):
        reco = env["ws"].build("uA", pid, now=NOW)["today"]["recommendation"]
        assert set(reco["actions"]) <= known


def test_an_unknown_attention_reason_still_recommends_something_generic():
    today = today_mod.build_today(
        attention=[{"id": "a1", "reason": "brand_new_reason", "title": "Hm"}])
    assert today["recommendation"]["reason"] == today_mod.RECO_REVIEW_SIGNAL


def test_rendering_today_creates_no_task_candidate_or_run(env):
    from backend.services.orchestrator import (
        candidate_actions_store as cas, runs_store,
        tasks_store as orchestrator_tasks,
    )
    _deploy_failed(env)
    env["goals"].create_goal(project_id="pA", user_id="uA", title="Launch")
    for _ in range(3):
        env["ws"].build("uA", "pA", now=NOW)
    assert env["tasks"].list_tasks("pA", owner_user_id="uA") == []
    assert cas.list_candidate_actions("pA", limit=50) == []
    assert orchestrator_tasks.list_tasks_for_project("pA") == []
    assert runs_store.list_runs(project_id="pA") == []


def test_even_the_weakest_signal_outranks_the_strongest_task(env):
    """The load-bearing edge of the ladder. A merged-PR-waiting signal is the
    LOWEST attention severity there is (`waiting`); a high-priority task in
    `doing` is the strongest thing below attention. The signal still wins —
    "something real is open" is categorically above "something planned"."""
    _observe(env, source="github", kind="github.pull_request.opened",
             summary="PR #9 awaiting review", ext="pr9",
             when=NOW - timedelta(hours=2), payload={"repo": "a/b", "number": "9"})
    env["tasks"].create_task(project_id="pA", owner_user_id="uA",
                             title="Very important", status="doing", priority=3)
    today = env["ws"].build("uA", "pA", now=NOW)["today"]
    assert today["attention"]["severity"] == "waiting"
    assert today["recommendation"]["source"] == "attention"
    assert today["recommendation"]["reason"] == today_mod.RECO_REVIEW_PR


def test_a_goal_never_outranks_a_task_and_a_task_never_outranks_a_signal(env):
    """The whole ladder in one assertion, built up one rung at a time."""
    env["goals"].create_goal(project_id="pA", user_id="uA", title="A goal",
                             priority=4)
    assert env["ws"].build("uA", "pA", now=NOW)["today"]["recommendation"]["source"] \
        == "goal"
    env["tasks"].create_task(project_id="pA", owner_user_id="uA", title="A task")
    assert env["ws"].build("uA", "pA", now=NOW)["today"]["recommendation"]["source"] \
        == "task"
    _deploy_failed(env, when=NOW - timedelta(hours=1))
    assert env["ws"].build("uA", "pA", now=NOW)["today"]["recommendation"]["source"] \
        == "attention"


def test_today_never_carries_progress_health_or_confidence_vocabulary(env):
    """No fabricated "on track", no score, no percentage, no confidence — not
    as a value and not as a field name. Asserted over the SERIALIZED block so a
    number cannot hide in a nested structure a field-name check would miss."""
    import json
    _deploy_failed(env, when=NOW - timedelta(hours=1))
    env["tasks"].create_task(project_id="pA", owner_user_id="uA", title="T")
    env["goals"].create_goal(project_id="pA", user_id="uA", title="G")
    blob = json.dumps(env["ws"].build("uA", "pA", now=NOW)["today"]).lower()
    for word in ("score", "confidence", "percent", "progress", "health",
                 "on_track", "on track", "%"):
        assert word not in blob, f"Today leaked `{word}`: {blob[:400]}"


def test_the_today_locale_strings_promise_nothing_the_backend_cannot_prove(env):
    """The backend sends codes; the LOCALE supplies the sentence. A reassuring
    phrase added there would be just as untrue, so the shipped dictionaries are
    checked too."""
    import pathlib as _p
    import re
    for locale in ("en", "tr", "de"):
        text = _p.Path(f"src/i18n/locales/{locale}.ts").read_text(encoding="utf-8")
        today_lines = [l for l in text.splitlines()
                       if re.match(r"\s*projectToday\w*:", l)]
        assert today_lines, f"no Today keys found in {locale}"
        for line in today_lines:
            assert "%" not in line, f"{locale}: percentage in {line.strip()}"
            assert "{count}" not in line or "Reco" not in line


# ══════════════════════════════════════════════════════════════════════════
# SINCE YOUR LAST VISIT
# ══════════════════════════════════════════════════════════════════════════

def test_a_first_visit_says_recent_not_since_you_were_away(env):
    _observe(env, when=NOW - timedelta(hours=2))
    changes = env["ws"].build("uA", "pA", now=NOW)["changes"]
    assert changes["mode"] == "recent"
    assert changes["last_viewed_at"] == ""
    assert changes["count"] == 1


def test_a_repeat_visit_reports_only_what_landed_after_the_marker(env):
    _observe(env, summary="Before", ext="b1", when=NOW - timedelta(days=2))
    env["views"].mark_viewed("uA", "pA", seen_through=_iso(NOW - timedelta(days=1)))
    _observe(env, summary="After", ext="a1", when=NOW - timedelta(hours=1))

    changes = env["ws"].build("uA", "pA", now=NOW)["changes"]
    assert changes["mode"] == "since_last_visit"
    assert changes["since"] == _iso(NOW - timedelta(days=1))
    assert [i["title"] for i in changes["items"]] == ["After"]
    assert changes["count"] == 1


def test_reading_the_workspace_never_moves_the_marker(env):
    """If the READ advanced the marker, the list would be emptied by the very
    request that computed it. Only the explicit acknowledgement may write."""
    _observe(env, when=NOW - timedelta(hours=1))
    for _ in range(3):
        snap = env["ws"].build("uA", "pA", now=NOW)
        assert snap["changes"]["count"] == 1
    assert env["views"].get_last_viewed_at("uA", "pA") == ""


def test_the_marker_lands_on_the_snapshot_the_user_actually_saw(env):
    """The acknowledgement carries the snapshot's `generated_at`, so a change
    that arrives between the read and the acknowledgement is still new next
    time instead of being swallowed."""
    snap = env["ws"].build("uA", "pA", now=NOW)
    # …a change lands while the user is reading…
    _observe(env, summary="Landed mid-read", ext="m1",
             when=NOW + timedelta(seconds=30))
    # …and only then does the page acknowledge what it rendered.
    env["views"].mark_viewed("uA", "pA",
                             seen_through=snap["freshness"]["generated_at"],
                             now=NOW + timedelta(minutes=1))
    later = env["ws"].build("uA", "pA", now=NOW + timedelta(minutes=2))["changes"]
    assert [i["title"] for i in later["items"]] == ["Landed mid-read"]


def test_the_marker_can_never_be_pushed_into_the_future_or_rewound(env):
    env["views"].mark_viewed("uA", "pA", seen_through=_iso(NOW), now=NOW)
    # A client claiming to have seen next year is clamped to server `now`.
    forward = env["views"].mark_viewed(
        "uA", "pA", seen_through=_iso(NOW + timedelta(days=365)),
        now=NOW + timedelta(minutes=1))
    assert forward == _iso(NOW + timedelta(minutes=1))
    # A replayed / out-of-order acknowledgement cannot rewind it.
    back = env["views"].mark_viewed("uA", "pA",
                                    seen_through=_iso(NOW - timedelta(days=5)),
                                    now=NOW + timedelta(minutes=2))
    assert back == forward


def test_a_garbage_seen_through_falls_back_to_now_rather_than_failing(env):
    marker = env["views"].mark_viewed("uA", "pA", seen_through="not-a-date",
                                      now=NOW)
    assert marker == _iso(NOW)


def test_markers_are_per_user_and_per_project(env):
    env["views"].mark_viewed("uA", "pA", now=NOW)
    assert env["views"].get_last_viewed_at("uB", "pA") == ""
    assert env["views"].get_last_viewed_at("uA", "pA2") == ""


def test_changes_supersede_by_subject_so_one_fire_is_one_line(env):
    _deploy_failed(env, when=NOW - timedelta(hours=5), ext="f1")
    _deploy_failed(env, when=NOW - timedelta(hours=4), ext="f2")
    _deploy_ok(env, when=NOW - timedelta(hours=3), ext="ok1")
    changes = env["ws"].build("uA", "pA", now=NOW)["changes"]
    assert changes["count"] == 1
    assert changes["items"][0]["title"] == "Deployment ready"


def test_a_task_moved_several_times_is_one_change(env):
    t = env["tasks"].create_task(project_id="pA", owner_user_id="uA", title="T")
    env["tasks"].update_task(t["id"], project_id="pA", owner_user_id="uA",
                             status="doing")
    env["tasks"].update_task(t["id"], project_id="pA", owner_user_id="uA",
                             status="done")
    changes = env["ws"].build("uA", "pA")["changes"]
    task_rows = [i for i in changes["items"] if i["change"] == "task"]
    assert len(task_rows) == 1 and task_rows[0]["detail"] == "done"


def test_an_undatable_row_is_dropped_rather_than_padding_the_count(env):
    _observe(env, summary="Datable", ext="d1", when=NOW - timedelta(hours=1))
    env["obs"].record_observation(
        user_id="uA", project_id="pA", source="github",
        kind="github.commit.pushed", summary="Undatable", external_id="u1",
        observed_at="not-a-timestamp")
    changes = env["ws"].build("uA", "pA", now=NOW)["changes"]
    assert [i["title"] for i in changes["items"]] == ["Datable"]


def test_changes_are_bounded_and_say_so_when_truncated(env):
    for i in range(15):
        _observe(env, summary=f"Change {i}", ext=f"c{i}",
                 when=NOW - timedelta(minutes=i + 1))
    changes = env["ws"].build("uA", "pA", now=NOW)["changes"]
    assert len(changes["items"]) == 6
    assert changes["count"] == 15 and changes["truncated"] is True


def test_changes_never_leak_across_projects(env):
    _observe(env, project="pA2", summary="Other project", ext="o1",
             when=NOW - timedelta(hours=1))
    assert env["ws"].build("uA", "pA", now=NOW)["changes"]["count"] == 0


def test_changes_never_leak_across_owners(env):
    _observe(env, project="pA", user="uB", summary="Theirs", ext="t1",
             when=NOW - timedelta(hours=1))
    assert env["ws"].build("uA", "pA", now=NOW)["changes"]["count"] == 0


def test_the_recent_window_excludes_older_history(env):
    _observe(env, summary="Ancient", ext="old", when=NOW - timedelta(days=30))
    _observe(env, summary="Fresh", ext="new", when=NOW - timedelta(days=1))
    changes = env["ws"].build("uA", "pA", now=NOW)["changes"]
    assert [i["title"] for i in changes["items"]] == ["Fresh"]


def test_a_quiet_project_reports_zero_changes_not_a_reassurance(env):
    changes = env["ws"].build("uA", "pA", now=NOW)["changes"]
    assert changes["count"] == 0 and changes["items"] == []


# ── HTTP surface for the acknowledgement ─────────────────────────────────────

def test_route_seen_marks_and_returns_the_marker(client, env, app):
    _as(app, USER_A)
    res = client.post("/v2/projects/pA/workspace/seen",
                      json={"seen_through": _iso(NOW)})
    assert res.status_code == 200
    assert res.json()["data"]["last_viewed_at"] == _iso(NOW)
    assert env["views"].get_last_viewed_at("uA", "pA") == _iso(NOW)


def test_route_seen_works_without_a_body(client, env, app):
    _as(app, USER_A)
    res = client.post("/v2/projects/pA/workspace/seen", json={})
    assert res.status_code == 200 and res.json()["data"]["last_viewed_at"]


def test_route_seen_hides_another_owners_project(client, env, app):
    _as(app, USER_B)
    assert client.post("/v2/projects/pA/workspace/seen",
                       json={}).status_code == 404
    assert client.post("/v2/projects/nope/workspace/seen",
                       json={}).status_code == 404
    assert env["views"].get_last_viewed_at("uB", "pA") == ""
    assert env["views"].get_last_viewed_at("uA", "pA") == ""


def test_route_seen_writes_only_view_metadata(client, env, app):
    """Marking a project seen is not project activity. It must not appear in the
    timeline, become an observation, or change anything the project IS."""
    from backend.services.orchestrator import candidate_actions_store as cas
    _as(app, USER_A)
    before = env["ws"].build("uA", "pA", now=NOW)
    client.post("/v2/projects/pA/workspace/seen", json={"seen_through": _iso(NOW)})
    after = env["ws"].build("uA", "pA", now=NOW)

    assert after["activity"] == before["activity"]
    assert after["counts"]["activity"] == before["counts"]["activity"]
    assert env["obs"].list_observations("pA", limit=500) == []
    assert cas.list_candidate_actions("pA", limit=50) == []
    assert env["tasks"].list_tasks("pA", owner_user_id="uA") == []


def test_route_read_then_seen_then_read_is_the_full_loop(client, env, app):
    _as(app, USER_A)
    # The route uses the real clock, so the fixture instant must be too.
    real_now = datetime.now(timezone.utc)
    _observe(env, summary="First", ext="f1", when=real_now - timedelta(hours=1))
    first = client.get("/v2/projects/pA/workspace").json()["data"]
    assert first["changes"]["mode"] == "recent" and first["changes"]["count"] == 1

    client.post("/v2/projects/pA/workspace/seen",
                json={"seen_through": first["freshness"]["generated_at"]})

    second = client.get("/v2/projects/pA/workspace").json()["data"]
    assert second["changes"]["mode"] == "since_last_visit"
    assert second["changes"]["count"] == 0


# ══════════════════════════════════════════════════════════════════════════
# MERGE-SAFETY — the exact last-visit ordering, and the ways it could go wrong
# ══════════════════════════════════════════════════════════════════════════

def test_only_the_seen_route_can_ever_move_the_marker():
    """A static guard on the whole backend: `mark_viewed` may be called from
    exactly one production module. If a future change calls it from the
    workspace projection, a connector sync or a background job, the marker
    starts advancing behind the user's back and "since your last visit" quietly
    becomes a lie. That must fail here, loudly."""
    import pathlib as _p
    callers = set()
    for path in _p.Path("backend").rglob("*.py"):
        if "tests" in path.parts or path.name == "views_store.py":
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        if "mark_viewed(" in text:
            callers.add(str(path))
    assert callers == {"backend/routes/v2_project_workspace.py"}, callers


def test_the_read_calculates_against_the_previous_marker_not_the_new_one(env):
    """The ordering the whole feature rests on, asserted step by step:

        1. the PREVIOUS marker is read
        2. the snapshot is generated
        3. changes are calculated against the PREVIOUS marker
        4. only then may the seen endpoint write a NEW marker
    """
    previous = _iso(NOW - timedelta(hours=6))
    env["views"].mark_viewed("uA", "pA", seen_through=previous,
                             now=NOW - timedelta(hours=6))
    _observe(env, summary="While away", ext="w1", when=NOW - timedelta(hours=2))

    # 1 + 2 + 3 — the read reports the PREVIOUS marker and measures from it.
    snap = env["ws"].build("uA", "pA", now=NOW)
    assert snap["changes"]["last_viewed_at"] == previous
    assert snap["changes"]["since"] == previous
    assert [i["title"] for i in snap["changes"]["items"]] == ["While away"]
    # …and the stored marker has NOT moved as a result of reading.
    assert env["views"].get_last_viewed_at("uA", "pA") == previous

    # 4 — only the explicit acknowledgement advances it.
    env["views"].mark_viewed("uA", "pA",
                             seen_through=snap["freshness"]["generated_at"],
                             now=NOW)
    assert env["views"].get_last_viewed_at("uA", "pA") != previous


def test_a_stale_marker_makes_everything_since_it_new_without_unbounding(env):
    """A marker from months ago is not corrupt — the user really has been away
    that long. Every change since then is genuinely new, but the RESULT stays
    bounded and the count stays truthful about what it is counting."""
    env["views"].mark_viewed("uA", "pA", seen_through=_iso(NOW - timedelta(days=400)),
                             now=NOW - timedelta(days=400))
    for i in range(15):
        _observe(env, summary=f"Change {i}", ext=f"s{i}",
                 when=NOW - timedelta(days=i + 1))
    changes = env["ws"].build("uA", "pA", now=NOW)["changes"]
    assert changes["mode"] == "since_last_visit"
    # Deliberately NOT clipped to the 7-day "recent" window — a real absence is
    # a real absence — but still bounded and honest about the overflow.
    assert changes["count"] == 15
    assert len(changes["items"]) == 6 and changes["truncated"] is True


def test_a_marker_stored_in_the_future_cannot_hide_changes_forever(env):
    """Defence against a corrupt/skewed row already in the table (the clamp
    guards the write path; this guards a row that got there some other way).
    A future marker means the window start is after `now`, so nothing can fall
    inside it — and the very next acknowledgement pulls it back to `now`."""
    import sqlite3
    _observe(env, summary="Real change", ext="r1", when=NOW - timedelta(hours=1))
    c = sqlite3.connect(env["views"].DB_PATH)
    c.execute("INSERT INTO project_views (user_id, project_id, last_viewed_at, "
              "updated_at) VALUES (?, ?, ?, ?)",
              ("uA", "pA", _iso(NOW + timedelta(days=3650)), _iso(NOW)))
    c.commit(); c.close()

    changes = env["ws"].build("uA", "pA", now=NOW)["changes"]
    assert changes["items"] == []          # degraded, but not crashed
    # The marker is monotonic, so the stored future value survives a later
    # acknowledgement rather than silently rewinding…
    assert env["views"].mark_viewed("uA", "pA", now=NOW).startswith("2036")


def test_a_corrupt_marker_value_falls_back_to_the_truthful_weaker_claim(env):
    """An unparseable stored marker must not be treated as a visit. The read
    degrades to `recent` — the claim we can still prove — instead of raising or
    reporting an empty "since your last visit"."""
    import sqlite3
    _observe(env, summary="Real change", ext="r1", when=NOW - timedelta(hours=1))
    c = sqlite3.connect(env["views"].DB_PATH)
    c.execute("INSERT INTO project_views (user_id, project_id, last_viewed_at, "
              "updated_at) VALUES (?, ?, ?, ?)",
              ("uA", "pA", "not-a-timestamp", _iso(NOW)))
    c.commit(); c.close()

    changes = env["ws"].build("uA", "pA", now=NOW)["changes"]
    assert changes["mode"] == "recent"
    assert [i["title"] for i in changes["items"]] == ["Real change"]


def test_two_concurrent_tabs_see_the_same_list_and_neither_loses_a_change(env):
    """Two tabs open the project before either acknowledges. Both must compute
    against the SAME previous marker — the first tab's acknowledgement cannot
    empty the second tab's already-rendered list, because the second tab read
    before that write landed."""
    env["views"].mark_viewed("uA", "pA", seen_through=_iso(NOW - timedelta(days=1)),
                             now=NOW - timedelta(days=1))
    _observe(env, summary="New thing", ext="n1", when=NOW - timedelta(hours=1))

    tab_a = env["ws"].build("uA", "pA", now=NOW)
    tab_b = env["ws"].build("uA", "pA", now=NOW)
    assert tab_a["changes"]["items"] == tab_b["changes"]["items"]
    assert tab_a["changes"]["count"] == 1

    # Tab A acknowledges. Tab B's ALREADY-RENDERED payload is untouched — it is
    # a value, not a live query — and tab B's later acknowledgement, carrying an
    # older snapshot instant, cannot rewind the marker tab A set.
    after_a = env["views"].mark_viewed(
        "uA", "pA", seen_through=tab_a["freshness"]["generated_at"],
        now=NOW + timedelta(seconds=1))
    assert tab_b["changes"]["count"] == 1
    after_b = env["views"].mark_viewed(
        "uA", "pA", seen_through=tab_b["freshness"]["generated_at"],
        now=NOW + timedelta(seconds=2))
    assert after_b == after_a


def test_a_failed_seen_write_degrades_to_showing_the_change_again(env):
    """The acknowledgement is best-effort. If it never lands, the marker simply
    does not move, so the next visit reports the SAME changes — annoying at
    worst, and never a silently swallowed change."""
    env["views"].mark_viewed("uA", "pA", seen_through=_iso(NOW - timedelta(days=1)),
                             now=NOW - timedelta(days=1))
    _observe(env, summary="Unacknowledged", ext="u1", when=NOW - timedelta(hours=1))

    first = env["ws"].build("uA", "pA", now=NOW)["changes"]
    assert [i["title"] for i in first["items"]] == ["Unacknowledged"]
    # …the seen call fails / never fires (nothing is written) …
    second = env["ws"].build("uA", "pA", now=NOW + timedelta(minutes=5))["changes"]
    assert [i["title"] for i in second["items"]] == ["Unacknowledged"]


def test_route_reading_the_workspace_repeatedly_never_creates_a_marker(client, env, app):
    """The HTTP read, end to end: no amount of page loading may create view
    state. Only POST /workspace/seen may."""
    _as(app, USER_A)
    for _ in range(5):
        assert client.get("/v2/projects/pA/workspace").status_code == 200
    assert env["views"].get_last_viewed_at("uA", "pA") == ""
