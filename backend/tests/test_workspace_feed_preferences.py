# coding: utf-8
"""CUSTOMIZABLE PROJECT FEED — a presentation preference, proved to be ONLY a
presentation preference.

The feature is small: one person says which sources they want prominent,
ordinary or absent in one project's activity feed. The DANGER is not small,
because the obvious naive implementation — "filter the observations, then build
everything from the filtered list" — quietly turns a display choice into an
evidence choice, and a user who hides Vercel stops being told their production
is down.

So the assertions in this file split cleanly in two:

  IT WORKS       defaults are the old behaviour byte for byte; hidden sources
                 leave the feed; highlighted sources are guaranteed a share of
                 the bounded slots on a project one source would otherwise
                 dominate; choices persist and are per (user, project).

  IT CANNOT      a preference cannot delete an observation, cannot change Needs
                 Attention, Today, Focus, Project State, Project Understanding
                 or "since your last visit", cannot alter connector sync, and
                 cannot reach candidate synthesis or the priority ladder. The
                 outage a user hid is still ranked, and the Brain still sees it.

No network, no model calls.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from backend.core import deps
from backend.services.auth.identity import User

USER_A = User(id="uA", kind="email", external_id="email:a@x.com", display_name="A")
USER_B = User(id="uB", kind="email", external_id="email:b@x.com", display_name="B")

PREFS_URL = "/v2/projects/pA/feed-preferences"


def _recent(hours_ago: float) -> str:
    """An ISO stamp inside `attention.MAX_AGE_DAYS`. Attention deliberately
    drops signals older than a fortnight, so a fixture timestamp has to be
    relative to the real clock or the alarm under test would be dropped as
    history and the assertion would pass for the wrong reason."""
    when = datetime.now(timezone.utc) - timedelta(hours=hours_ago)
    return when.isoformat().replace("+00:00", "Z")


def _without_clock(value):
    """`focus` and `project_understanding` each carry the instant they were
    computed at; two builds a millisecond apart differ there and nowhere else.
    Compare the DECISION, not the clock."""
    if not isinstance(value, dict):
        return value
    return {k: v for k, v in value.items() if k != "generated_at"}


@pytest.fixture()
def env(tmp_path, monkeypatch, app):
    projects_db = str(tmp_path / "projects.db")
    sessions_db = str(tmp_path / "sessions.db")
    monkeypatch.setenv("PROJECTS_DB_PATH", projects_db)
    monkeypatch.setenv("SESSIONS_DB_PATH", sessions_db)
    monkeypatch.setenv("ENABLE_WORKSPACE_AUTO_REFRESH", "false")

    from backend.services.projects import store as projects_store
    from backend.services.projects import feed_prefs_store, tasks_store, views_store
    from backend.services.orchestrator import (
        candidate_actions_store as cas, decisions_store,
        deliverables_store as dls, goals_store, observations_store as obs,
        runs_store,
    )
    from backend.services.orchestrator import tasks_store as orch_tasks

    for mod in (projects_store, tasks_store, views_store, obs, cas, dls,
                goals_store, decisions_store, runs_store, orch_tasks):
        monkeypatch.setattr(mod, "DB_PATH", projects_db, raising=False)

    projects_store._reset_for_tests()
    projects_store.init()
    tasks_store.init_tasks_table()
    views_store.init_views_table()
    obs.init_observations_table()
    dls.init_deliverables_table()
    goals_store.init_goals_table()
    decisions_store.init_decisions_table()
    feed_prefs_store._reset_for_tests()
    feed_prefs_store.init_feed_prefs_table()

    projects_store.create_project("uA", name="Fitness App", description="d",
                                  project_id="pA")
    projects_store.create_project("uB", name="Theirs", description="",
                                  project_id="pB")

    from backend.services.project_brain import workspace as ws_mod
    _as(app, USER_A)
    yield {"obs": obs, "prefs": feed_prefs_store, "ws": ws_mod,
           "projects": projects_store}
    app.dependency_overrides.clear()


def _as(app, user):
    app.dependency_overrides[deps.current_user] = lambda: user


def _obs(env, source: str, n: int, *, kind: str = "", summary: str = "",
         hours_ago: float = 10.0, importance: str = "normal", payload=None):
    """`n` observations from `source`, the newest `hours_ago` old and each
    subsequent one slightly older. Distinct, strictly ordered stamps — so a test
    that says "this source is newer than that one" really means it."""
    for i in range(n):
        env["obs"].record_observation(
            user_id="uA", project_id="pA", source=source,
            kind=kind or f"{source}.event",
            summary=summary or f"{source} event {i}",
            external_id=f"{source}-{i}", importance=importance,
            payload=payload or {},
            observed_at=_recent(hours_ago + i * 0.05))


def _sources(snapshot) -> list:
    return [row["source"] for row in snapshot["activity"]]


# ══════════════════════════════════════════════════════════════════════════
# Defaults — a project nobody customised must be untouched
# ══════════════════════════════════════════════════════════════════════════

def test_a_user_with_no_preference_row_sees_the_previous_feed(env):
    _obs(env, "vercel", 5)
    _obs(env, "gmail", 3)
    snap = env["ws"].build("uA", "pA")
    assert snap["feed_preferences"] == {}
    assert snap["counts"]["activity_hidden"] == 0
    assert len(snap["activity"]) == 8
    # Strict reverse chronology, exactly as before.
    stamps = [row["occurred_at"] for row in snap["activity"]]
    assert stamps == sorted(stamps, reverse=True)


def test_the_route_reports_an_uncustomised_project_honestly(env, client):
    res = client.get(PREFS_URL)
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["preferences"] == {}, "no fabricated row-per-source"
    assert data["default"] == "normal"
    assert set(data["values"]) == {"highlight", "normal", "hidden"}
    for provider in ("github", "vercel", "gmail", "calendar", "slack"):
        assert provider in data["sources"]


def test_an_empty_project_with_a_preference_is_still_empty(env, client):
    client.put(PREFS_URL, json={"preferences": {"github": "highlight"}})
    snap = env["ws"].build("uA", "pA")
    assert snap["activity"] == []
    assert snap["counts"]["activity_hidden"] == 0


# ══════════════════════════════════════════════════════════════════════════
# Hidden
# ══════════════════════════════════════════════════════════════════════════

def test_hiding_a_source_removes_it_from_the_feed_and_says_how_many(env, client):
    _obs(env, "vercel", 6)
    _obs(env, "gmail", 2)
    client.put(PREFS_URL, json={"preferences": {"vercel": "hidden"}})
    snap = env["ws"].build("uA", "pA")
    assert set(_sources(snap)) == {"gmail"}
    assert snap["counts"]["activity_hidden"] == 6, "the exclusion is reported"


def test_hiding_every_source_leaves_an_honest_empty_feed(env, client):
    _obs(env, "vercel", 4)
    _obs(env, "github", 4)
    client.put(PREFS_URL, json={"preferences": {"vercel": "hidden",
                                                "github": "hidden"}})
    snap = env["ws"].build("uA", "pA")
    assert snap["activity"] == []
    assert snap["counts"]["activity_hidden"] == 8
    # And the observations are all still there, untouched.
    assert len(env["obs"].recent_observations("pA", user_id="uA", limit=50)) == 8


def test_a_hidden_source_is_not_deleted_from_the_observation_store(env, client):
    _obs(env, "gmail", 5)
    before = env["obs"].observations_stats("pA")
    client.put(PREFS_URL, json={"preferences": {"gmail": "hidden"}})
    env["ws"].build("uA", "pA")
    assert env["obs"].observations_stats("pA") == before


# ══════════════════════════════════════════════════════════════════════════
# Highlight — the Vercel-dominated project this feature exists for
# ══════════════════════════════════════════════════════════════════════════

def test_highlight_wins_slots_on_a_project_one_source_dominates(env, client):
    """THE motivating case. Forty Vercel deployments, two Gmail threads, twelve
    slots. Without a preference the mail never appears; with `highlight` it is
    guaranteed a share."""
    _obs(env, "vercel", 40, hours_ago=1)
    _obs(env, "gmail", 2, hours_ago=200)

    plain = env["ws"].build("uA", "pA")
    assert "gmail" not in _sources(plain), "the premise: mail is crowded out"

    client.put(PREFS_URL, json={"preferences": {"gmail": "highlight"}})
    tuned = env["ws"].build("uA", "pA")
    assert _sources(tuned).count("gmail") == 2
    assert len(tuned["activity"]) == len(plain["activity"]), \
        "highlighting must not shorten the feed"


def test_a_highlighted_source_never_reserves_more_than_it_can_fill(env, client):
    _obs(env, "vercel", 20, hours_ago=1)
    _obs(env, "github", 1, hours_ago=200)
    client.put(PREFS_URL, json={"preferences": {"github": "highlight"}})
    snap = env["ws"].build("uA", "pA")
    assert _sources(snap).count("github") == 1
    assert len(snap["activity"]) == 12, "unused reserve goes back to everyone else"


def test_the_feed_stays_a_chronology(env, client):
    """Preferences decide WHICH rows survive the bound. They never decide the
    ORDER — a feed that is not in time order is not a feed."""
    _obs(env, "vercel", 20, hours_ago=1)
    _obs(env, "gmail", 3, hours_ago=200)
    client.put(PREFS_URL, json={"preferences": {"gmail": "highlight"}})
    snap = env["ws"].build("uA", "pA")
    stamps = [row["occurred_at"] for row in snap["activity"]]
    assert stamps == sorted(stamps, reverse=True)


def test_highlighting_everything_is_the_same_as_highlighting_nothing(env, client):
    _obs(env, "vercel", 8)
    _obs(env, "github", 8)
    plain = env["ws"].build("uA", "pA")
    client.put(PREFS_URL, json={"preferences": {"vercel": "highlight",
                                                "github": "highlight"}})
    tuned = env["ws"].build("uA", "pA")
    assert [r["id"] for r in tuned["activity"]] == [r["id"] for r in plain["activity"]]


# ══════════════════════════════════════════════════════════════════════════
# THE SEMANTIC BOUNDARY — the assertions this feature lives or dies on
# ══════════════════════════════════════════════════════════════════════════

def _production_outage(env):
    """A real, decisive Vercel signal: a failed PRODUCTION deployment."""
    env["obs"].record_observation(
        user_id="uA", project_id="pA", source="vercel",
        kind="vercel.deployment.error", summary="Production deployment failed",
        external_id="dep-1", importance="high",
        payload={"target": "production", "state": "ERROR", "url": "x.vercel.app"},
        observed_at=_recent(2))


def test_a_hidden_source_with_a_production_outage_still_needs_attention(env, client):
    """The example from the brief, asserted directly: hide Vercel, break
    production, and the alarm must survive."""
    _production_outage(env)
    client.put(PREFS_URL, json={"preferences": {"vercel": "hidden"}})
    snap = env["ws"].build("uA", "pA")

    assert _sources(snap) == [], "it is out of the FEED, as the user asked"
    reasons = [item["reason"] for item in snap["attention"]]
    assert "deploy_failed" in reasons, "and still in Needs Attention"
    assert snap["attention"][0]["source"] == "vercel"
    assert snap["today"]["attention"] is not None
    assert snap["today"]["attention"]["source"] == "vercel"


def test_a_preference_changes_nothing_but_the_feed(env, client):
    """Field-by-field: every decision surface must be IDENTICAL before and after
    a preference is set. Only `activity`, `feed_preferences` and the hidden
    count are allowed to move."""
    _production_outage(env)
    _obs(env, "github", 4)
    _obs(env, "gmail", 3)

    before = env["ws"].build("uA", "pA")
    client.put(PREFS_URL, json={"preferences": {"vercel": "hidden",
                                                "gmail": "highlight"}})
    after = env["ws"].build("uA", "pA")

    for field in ("attention", "today", "project_state", "goals", "tasks",
                  "knowledge", "products", "chats", "summary"):
        assert after[field] == before[field], f"{field} moved — it must not"
    for field in ("focus", "project_understanding"):
        assert _without_clock(after[field]) == _without_clock(before[field]), \
            f"{field} moved — it must not"
    # `changes` carries the snapshot instant, so compare its ITEMS.
    assert after["changes"]["items"] == before["changes"]["items"]
    # Connectors, and therefore sync scheduling, are untouched too.
    assert after["connectors"] == before["connectors"]
    assert after["activity"] != before["activity"], "the feed DID change"


def test_a_preference_writes_no_candidate_action_task_or_run(env, client):
    from backend.services.orchestrator import candidate_actions_store as cas
    from backend.services.orchestrator import runs_store
    from backend.services.orchestrator import tasks_store as orch_tasks
    _production_outage(env)
    client.put(PREFS_URL, json={"preferences": {"vercel": "hidden"}})
    env["ws"].build("uA", "pA")
    assert cas.list_candidate_actions("pA", limit=50) == []
    assert orch_tasks.list_tasks_for_project("pA") == []
    assert runs_store.list_runs(project_id="pA") == []


def test_the_priority_ladder_cannot_read_a_preference(env, client):
    """`decision_context.project_focus` is the SAME function the action
    prioritizer uses. Feed it the same subjects with and without a preference
    set and it must not notice."""
    _production_outage(env)
    before = env["ws"].build("uA", "pA")["focus"]
    client.put(PREFS_URL, json={"preferences": {"vercel": "hidden"}})
    after = env["ws"].build("uA", "pA")["focus"]
    assert _without_clock(after) == _without_clock(before)
    assert (after or {}).get("top") is not None


def test_the_brain_context_block_is_unaffected_by_a_preference(env, client,
                                                               monkeypatch):
    """The Business Brain reads observations through its own authority, which
    has never heard of the preference store. Hiding a source must not shrink
    what the model is told."""
    _production_outage(env)
    _obs(env, "github", 3)
    seen_before = env["obs"].recent_observations("pA", user_id="uA", limit=50)
    client.put(PREFS_URL, json={"preferences": {"vercel": "hidden",
                                                "github": "hidden"}})
    seen_after = env["obs"].recent_observations("pA", user_id="uA", limit=50)
    assert seen_after == seen_before


# ══════════════════════════════════════════════════════════════════════════
# Persistence, validation, isolation
# ══════════════════════════════════════════════════════════════════════════

def test_a_preference_persists_and_round_trips(env, client):
    put = client.put(PREFS_URL, json={"preferences": {"github": "highlight",
                                                      "slack": "hidden"}})
    assert put.status_code == 200
    assert put.json()["data"]["preferences"] == {"github": "highlight",
                                                 "slack": "hidden"}
    got = client.get(PREFS_URL).json()["data"]["preferences"]
    assert got == {"github": "highlight", "slack": "hidden"}


def test_setting_a_source_back_to_normal_removes_its_row(env, client):
    """`normal` is the DEFAULT, not a third stored state — resetting must leave
    no tombstone that would look like a choice."""
    client.put(PREFS_URL, json={"preferences": {"github": "highlight"}})
    client.put(PREFS_URL, json={"preferences": {"github": "normal"}})
    assert client.get(PREFS_URL).json()["data"]["preferences"] == {}


def test_a_replace_really_replaces(env, client):
    client.put(PREFS_URL, json={"preferences": {"github": "hidden",
                                                "gmail": "hidden"}})
    client.put(PREFS_URL, json={"preferences": {"gmail": "hidden"}})
    assert client.get(PREFS_URL).json()["data"]["preferences"] == {"gmail": "hidden"}


def test_an_unknown_source_is_refused(env, client):
    res = client.put(PREFS_URL, json={"preferences": {"myspace": "highlight",
                                                      "github": "hidden"}})
    assert res.status_code == 200
    assert res.json()["data"]["preferences"] == {"github": "hidden"}


def test_a_malformed_value_reads_as_the_default(env, client):
    res = client.put(PREFS_URL, json={"preferences": {"github": "SUPER-IMPORTANT"}})
    assert res.json()["data"]["preferences"] == {}
    _obs(env, "github", 3)
    snap = env["ws"].build("uA", "pA")
    assert len(snap["activity"]) == 3, "a bad value must never blank the feed"


def test_a_stale_row_written_directly_cannot_blank_the_feed(env):
    """Defence against a hand-edited row, a partial migration, or a value from a
    future version: an unrecognised preference reads as `normal`."""
    from backend.services.orchestrator import _sqlite
    from backend.core.paths import resolve_db_path
    _obs(env, "github", 4)
    with _sqlite.connection(resolve_db_path("projects.db", "PROJECTS_DB_PATH")) as c:
        c.execute("INSERT INTO project_feed_preferences "
                  "(user_id, project_id, source, preference, updated_at) "
                  "VALUES ('uA','pA','github','obliterate','2026-01-01T00:00:00Z')")
    snap = env["ws"].build("uA", "pA")
    assert snap["feed_preferences"] == {}
    assert len(snap["activity"]) == 4


def test_only_real_sources_can_occupy_a_row(env, client):
    """A scripted client cannot grow the table: unknown sources are dropped, so
    only sources the backend recognises can ever occupy a row."""
    payload = {f"source-{i}": "hidden" for i in range(50)}
    payload["github"] = "hidden"
    res = client.put(PREFS_URL, json={"preferences": payload})
    assert res.status_code == 200
    assert res.json()["data"]["preferences"] == {"github": "hidden"}


def test_an_oversized_payload_is_refused_at_the_boundary(env, client):
    """Cheap to send must stay cheap to process: a map far larger than any real
    panel could produce is rejected by validation, not walked."""
    payload = {f"source-{i}": "hidden" for i in range(5000)}
    res = client.put(PREFS_URL, json={"preferences": payload})
    assert res.status_code == 422
    assert env["prefs"].get_preferences("uA", "pA") == {}


def test_an_overlong_key_or_value_is_refused(env, client):
    assert client.put(PREFS_URL, json={"preferences": {"g" * 500: "hidden"}}
                      ).status_code == 422
    assert client.put(PREFS_URL, json={"preferences": {"github": "h" * 500}}
                      ).status_code == 422
    assert env["prefs"].get_preferences("uA", "pA") == {}


def test_the_store_itself_refuses_to_walk_an_unbounded_map(env):
    """Defence in depth below the route: even called directly, the store stops
    at its input bound instead of iterating whatever it is handed."""
    prefs = env["prefs"]
    huge = {f"source-{i}": "hidden" for i in range(100_000)}
    huge["github"] = "hidden"       # deliberately LAST, past the bound
    stored = prefs.set_preferences("uA", "pA", huge)
    assert stored == {}, "nothing past the input bound is even looked at"


def test_preferences_are_per_project(env, client, app):
    from backend.services.projects import store as projects_store
    projects_store.create_project("uA", name="Second", description="",
                                  project_id="pA2")
    client.put(PREFS_URL, json={"preferences": {"github": "hidden"}})
    other = client.get("/v2/projects/pA2/feed-preferences")
    assert other.json()["data"]["preferences"] == {}


def test_preferences_are_per_user(env, client, app):
    """Two accounts cannot see or overwrite each other's view of a project —
    and here they cannot even reach the same project, which is the stronger
    guarantee the ownership gate already provides."""
    client.put(PREFS_URL, json={"preferences": {"github": "hidden"}})
    _as(app, USER_B)
    assert client.get(PREFS_URL).status_code == 404
    assert client.put(PREFS_URL, json={"preferences": {"github": "highlight"}}
                      ).status_code == 404
    _as(app, USER_A)
    assert client.get(PREFS_URL).json()["data"]["preferences"] == {"github": "hidden"}


def test_the_store_keeps_two_users_apart_even_on_one_project(env):
    """Directly at the store, below the ownership gate: the key is (user,
    project, source), so two people on one project keep separate views."""
    prefs = env["prefs"]
    prefs.set_preferences("uA", "pA", {"github": "hidden"})
    prefs.set_preferences("uB", "pA", {"github": "highlight"})
    assert prefs.get_preferences("uA", "pA") == {"github": "hidden"}
    assert prefs.get_preferences("uB", "pA") == {"github": "highlight"}


def test_a_foreign_project_answers_exactly_like_a_missing_one(env, client, app):
    _as(app, USER_B)
    theirs = client.get(PREFS_URL)
    missing = client.get("/v2/projects/does-not-exist/feed-preferences")
    assert theirs.status_code == missing.status_code == 404
    assert theirs.json() == missing.json()


def test_a_planted_user_id_in_the_body_is_ignored(env, client, app):
    """Identity is server auth, always."""
    client.put(PREFS_URL, json={"preferences": {"github": "hidden"},
                                "user_id": "uB", "owner_user_id": "uB"})
    assert env["prefs"].get_preferences("uB", "pA") == {}
    assert env["prefs"].get_preferences("uA", "pA") == {"github": "hidden"}


def test_deleting_the_project_forgets_the_preferences(env, client):
    client.put(PREFS_URL, json={"preferences": {"github": "hidden"}})
    env["projects"].delete_project("pA")
    assert env["prefs"].get_preferences("uA", "pA") == {}


# ══════════════════════════════════════════════════════════════════════════
# Connector shape changes
# ══════════════════════════════════════════════════════════════════════════

def test_a_newly_connected_source_starts_on_the_default(env, client):
    client.put(PREFS_URL, json={"preferences": {"github": "hidden"}})
    _obs(env, "slack", 3)     # a source connected after the preference was set
    snap = env["ws"].build("uA", "pA")
    assert _sources(snap) == ["slack"] * 3


def test_a_disconnected_source_keeps_its_stored_observations_visible(env, client):
    """Disconnecting a connector does not delete what it already told us, and a
    preference about it stays meaningful for that history."""
    _obs(env, "slack", 4)
    client.put(PREFS_URL, json={"preferences": {"slack": "hidden"}})
    snap = env["ws"].build("uA", "pA")
    assert snap["activity"] == []
    assert snap["counts"]["activity_hidden"] == 4
    client.put(PREFS_URL, json={"preferences": {}})
    assert len(env["ws"].build("uA", "pA")["activity"]) == 4
