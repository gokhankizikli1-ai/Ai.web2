# coding: utf-8
"""MERGE-SAFETY — what Smart Refresh and the feed preference COST per page open.

The features are only worth having if opening a project stays cheap. "Cheap" is
not an opinion, so this measures it: every SQL statement issued while serving
`GET /v2/projects/{id}/workspace` is counted through `sqlite3`'s own trace
callback, and every provider call is counted at the one seam they all go
through.

The load-bearing properties:

  FLAT           the cost does not grow with the size of the project (an N+1
                 behind a "single bounded read" claim is invisible until the
                 busiest account in production hits it);
  BOUNDED        the added cost of the two features is a small CONSTANT, and it
                 is the same on every read — no first-call-is-different lazy
                 init, which is what makes a cost budget meaningful;
  ZERO-CALL      a page open makes no provider call unless something is
                 genuinely stale, and no model call ever;
  NO-WRITE       a page open that starts no refresh writes nothing at all.

No network, no model calls.
"""
from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta, timezone

import pytest

from backend.core import deps
from backend.services.auth.identity import User

USER_A = User(id="uA", kind="email", external_id="email:a@x.com", display_name="A")

#: Headroom over what one workspace REQUEST issues today (≈104 for a project
#: with five fresh connectors — the common case — and ≈153 on the rare open
#: that actually claims two refreshes, where the extra is the shared claim
#: authority's own bring-up and is dwarfed by the two real HTTP calls it is
#: authorising). It catches a new read being added silently; the no-growth
#: assertions below are what prove the shape is flat.
#:
#: The bulk of the absolute number is NOT this feature: `connectors.store`
#: re-executes its eight-statement `CREATE … IF NOT EXISTS` script on every
#: call (its `_initialized` flag is set but never read), so each binding read
#: costs a schema script. Memoising it is a real improvement and a SEPARATE
#: change — it moves statement counts that several existing tests pin, and
#: smuggling it in here would be a change nobody reviewed.
_REQUEST_CEILING = 175


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


@pytest.fixture()
def counting_sqlite(monkeypatch):
    """Count every SQL statement any store executes. Both connection paths in
    this codebase go through `sqlite3.connect`, so wrapping that one function
    sees everything without touching a single store."""
    real_connect = sqlite3.connect
    state = {"count": 0, "statements": []}

    def _connect(*args, **kwargs):
        conn = real_connect(*args, **kwargs)

        def _trace(statement):
            state["count"] += 1
            state["statements"].append(statement.split("\n")[0][:90])

        conn.set_trace_callback(_trace)
        return conn

    monkeypatch.setattr(sqlite3, "connect", _connect)
    return state


@pytest.fixture()
def env(tmp_path, monkeypatch, app):
    projects_db = str(tmp_path / "projects.db")
    sessions_db = str(tmp_path / "sessions.db")
    monkeypatch.setenv("PROJECTS_DB_PATH", projects_db)
    monkeypatch.setenv("SESSIONS_DB_PATH", sessions_db)
    monkeypatch.setenv("ENABLE_SESSIONS", "true")
    for flag in ("ENABLE_GITHUB_CONNECTOR", "ENABLE_VERCEL_CONNECTOR",
                 "ENABLE_GMAIL_CONNECTOR", "ENABLE_CALENDAR_CONNECTOR",
                 "ENABLE_SLACK_CONNECTOR"):
        monkeypatch.setenv(flag, "true")
    monkeypatch.delenv("ENABLE_WORKSPACE_AUTO_REFRESH", raising=False)

    from backend.services.projects import store as projects_store
    from backend.services.projects import feed_prefs_store, tasks_store, views_store
    from backend.services.projects import knowledge as knowledge_mod
    from backend.services.orchestrator import (
        candidate_actions_store as cas, decisions_store,
        deliverables_store as dls, goals_store, observations_store as obs,
        runs_store,
    )
    from backend.services.orchestrator import tasks_store as orch_tasks
    from backend.services.orchestrator import step_claim
    from backend.services.connectors import store as shared
    from backend.services.connectors import refresh as refresh_mod
    from backend.services.sessions import store as sessions_store

    for mod in (projects_store, tasks_store, views_store, obs, cas, dls,
                goals_store, decisions_store, runs_store, orch_tasks,
                # The SHARED claim authority the refresh coordinator delegates
                # its in-flight guard to. It captures its path at import, so an
                # un-repointed test would take claims in the REAL projects.db
                # and leak them into every later test.
                step_claim):
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
    shared._reset_for_tests()
    shared.init_tables()
    feed_prefs_store._reset_for_tests()
    feed_prefs_store.init_feed_prefs_table()
    refresh_mod._reset_for_tests()
    refresh_mod.init_refresh_table()

    projects_store.create_project("uA", name="Fitness App", description="d",
                                  project_id="pA")

    _as(app, USER_A)
    yield {"tasks": tasks_store, "k": knowledge_mod, "obs": obs,
           "shared": shared, "prefs": feed_prefs_store, "db": projects_db}
    app.dependency_overrides.clear()


def _as(app, user):
    app.dependency_overrides[deps.current_user] = lambda: user
    app.dependency_overrides[deps.require_auth] = lambda: user


@pytest.fixture()
def calls(monkeypatch):
    """Count provider reads at the one seam they all go through."""
    from backend.services.connectors import sync as connector_sync
    seen = []

    def _fake(user_id, project_id, provider):
        seen.append(str(provider))
        return connector_sync.SyncOutcome(
            project_id, provider, connector_sync.OUTCOME_SYNCED, ok=True,
            report_ok=True, report={"ok": True})

    monkeypatch.setattr(connector_sync, "sync_binding", _fake)
    return seen


def _fill(env, n: int) -> None:
    for i in range(n):
        env["tasks"].create_task(project_id="pA", owner_user_id="uA",
                                 title=f"task {i}")
        env["k"].add_knowledge(project_id="pA", user_id="uA", kind="fact",
                               text=f"fact {i}")
        env["obs"].record_observation(
            user_id="uA", project_id="pA", source="github",
            kind="github.commit.pushed", summary=f"commit {i}",
            external_id=f"c{i}", observed_at="2026-06-01T10:00:00Z")


def _bind(env, provider: str, *, last_sync: str = "") -> None:
    shared = env["shared"]
    auth = shared.upsert_authorization(
        owner_user_id="uA", provider=provider,
        account_key=f"acct-{provider}", account_label="a",
        credentials={}, metadata={})
    shared.set_binding(
        project_id="pA", authorization_id=auth.id, owner_user_id="uA",
        resources=[{"resource_id": f"r-{provider}", "resource_label": "r",
                    "resource": {}}])
    if last_sync:
        from backend.services.orchestrator import _sqlite
        with _sqlite.connection(env["db"]) as c:
            c.execute("UPDATE connector_project_bindings SET last_sync_at=? "
                      "WHERE project_id=? AND provider=?",
                      (last_sync, "pA", provider))


def _statements(client, counting_sqlite) -> int:
    counting_sqlite["count"] = 0
    counting_sqlite["statements"].clear()
    assert client.get("/v2/projects/pA/workspace").status_code == 200
    return counting_sqlite["count"]


# ── the request is flat ──────────────────────────────────────────────────────

def test_the_request_cost_does_not_grow_with_the_size_of_the_project(
        env, client, counting_sqlite, calls):
    """THE N+1 TEST, at the ROUTE this time — the read model has its own, but
    the refresh planning and the preference read are new statements outside it
    and have to be flat too."""
    _fill(env, 1)
    small = _statements(client, counting_sqlite)
    _fill(env, 60)
    large = _statements(client, counting_sqlite)
    assert large == small, (
        f"request cost grew from {small} to {large} as the project grew — "
        f"that is an N+1. Statements: {counting_sqlite['statements']}")


def test_repeat_requests_cost_the_same_every_time(env, client, counting_sqlite, calls):
    """No warm-up query and no lazy schema creation that makes the first read of
    a process more expensive than the rest — which is what would make any cost
    budget here meaningless."""
    _fill(env, 10)
    costs = [_statements(client, counting_sqlite) for _ in range(3)]
    assert len(set(costs)) == 1, costs


def test_one_request_stays_under_the_ceiling(env, client, counting_sqlite, calls):
    _fill(env, 25)
    used = _statements(client, counting_sqlite)
    assert used <= _REQUEST_CEILING, (
        f"{used} statements for one workspace request: "
        f"{counting_sqlite['statements']}")


def test_the_added_cost_is_a_small_constant(env, client, counting_sqlite, calls):
    """A project with connectors bound costs a few statements more than one
    without — the binding read and the attempt-table read. It must be a
    CONSTANT, not per-connector-times-something."""
    _fill(env, 5)
    bare = _statements(client, counting_sqlite)
    for provider in ("github", "vercel", "gmail"):
        _bind(env, provider, last_sync=_iso(datetime.now(timezone.utc)))
    connected = _statements(client, counting_sqlite)
    assert connected - bare <= 16, (
        f"connectors added {connected - bare} statements: "
        f"{counting_sqlite['statements']}")


def _matching(counting_sqlite, needle: str) -> int:
    return sum(1 for s in counting_sqlite["statements"] if needle in s)


def test_asking_what_is_refreshing_is_one_query_however_many_connectors(
        env, client, counting_sqlite, calls):
    """A different shape of growth from the N+1 above, one level down.

    Asking the shared claim authority "is THIS one refreshing?" per provider
    would make a five-connector project cost five extra round trips on every
    page open. The question is asked ONCE for the whole (bounded) set, so the
    count of claim-table READS does not move as connectors are added.

    Asserted on the statements themselves rather than on a total, because the
    total legitimately DOES rise between one and five stale connectors: one
    stale connector is one claim, five is two (`MAX_PER_OPEN`), and a second
    claim is a second claim+release cycle. Conflating the two would make this
    test pass or fail for the wrong reason."""
    _fill(env, 5)
    old = _iso(datetime.now(timezone.utc) - timedelta(days=3))

    _bind(env, "github", last_sync=old)
    _statements(client, counting_sqlite)
    assert _matching(counting_sqlite, "SELECT key FROM workflow_step_claims") == 1
    assert _matching(counting_sqlite, "FROM connector_refresh_attempts") <= 3

    for provider in ("vercel", "gmail", "calendar", "slack"):
        _bind(env, provider, last_sync=old)
    _statements(client, counting_sqlite)
    assert _matching(counting_sqlite, "SELECT key FROM workflow_step_claims") == 1, (
        "the in-flight question must be ONE query for the whole set: "
        f"{counting_sqlite['statements']}")
    # One read in `plan`, plus one fail-closed re-read per claim actually taken
    # (bounded by MAX_PER_OPEN) — never one per connector.
    assert _matching(counting_sqlite, "FROM connector_refresh_attempts") <= 3


def test_a_feed_preference_does_not_change_the_request_cost(
        env, client, counting_sqlite, calls):
    """The preference read happens whether or not one is set — so a user who
    customises their view does not pay more per page open than one who never
    opened Customize."""
    _fill(env, 5)
    plain = _statements(client, counting_sqlite)
    env["prefs"].set_preferences("uA", "pA", {"github": "hidden",
                                              "vercel": "highlight"})
    tuned = _statements(client, counting_sqlite)
    assert tuned == plain, counting_sqlite["statements"]


# ── provider and model cost ──────────────────────────────────────────────────

def test_a_page_open_makes_no_provider_call_when_everything_is_fresh(
        env, client, calls):
    for provider in ("github", "vercel", "gmail", "calendar", "slack"):
        _bind(env, provider, last_sync=_iso(datetime.now(timezone.utc)))
    for _ in range(5):
        client.get("/v2/projects/pA/workspace")
    assert calls == []


def test_a_page_open_never_calls_a_model(env, client, calls, monkeypatch):
    """Opening a project must not spend a token — not through the brain summary,
    not through the refresh, not through anything. Any provider-layer call at
    all fails this."""
    import backend.services.providers as providers
    reached = []
    monkeypatch.setattr(providers, "get_provider",
                        lambda *a, **k: reached.append(a) or None, raising=False)
    _fill(env, 5)
    _bind(env, "github", last_sync="")
    client.get("/v2/projects/pA/workspace")
    assert reached == []


def test_a_page_open_with_nothing_stale_writes_nothing(env, client, calls,
                                                       counting_sqlite):
    """A read stays a read. The ONLY write this route may perform is taking a
    refresh lease, and it takes none when nothing is stale."""
    _fill(env, 5)
    _bind(env, "github", last_sync=_iso(datetime.now(timezone.utc)))
    counting_sqlite["count"] = 0
    counting_sqlite["statements"].clear()
    client.get("/v2/projects/pA/workspace")
    writes = [s for s in counting_sqlite["statements"]
              if s.lower().startswith(("insert", "update", "delete"))]
    assert writes == [], writes


def test_a_stale_page_open_writes_only_refresh_coordination(env, client, calls,
                                                            counting_sqlite):
    """The ONLY writes a page open may perform are the two halves of refresh
    coordination: taking the shared claim, and recording the attempt's cooldown
    when it ends. Nothing else — no observation, no task, no candidate."""
    _fill(env, 5)
    _bind(env, "github", last_sync="")
    counting_sqlite["count"] = 0
    counting_sqlite["statements"].clear()
    client.get("/v2/projects/pA/workspace")
    writes = [s for s in counting_sqlite["statements"]
              if s.lower().startswith(("insert", "update", "delete"))]
    assert writes, "a stale open does take the claim"
    for w in writes:
        assert ("workflow_step_claims" in w             # the shared claim
                or "connector_refresh_attempts" in w),  w
    assert calls == ["github"]


def test_two_tabs_cost_one_provider_call_and_a_bounded_number_of_statements(
        env, client, counting_sqlite, calls, monkeypatch):
    """The storm case, measured: the second arrival is a read plus one REFUSED
    claim, not a second refresh.

    `run_claimed` is stubbed so the first tab's lease is still held when the
    second arrives — a single-threaded TestClient would otherwise never let the
    two overlap. The provider counter is therefore silent by construction here;
    what is measured is that the second tab took NO lease, which is the thing
    that decides whether a provider gets called at all."""
    from backend.services.connectors import refresh as refresh_mod
    started = []
    monkeypatch.setattr(refresh_mod, "run_claimed",
                        lambda uid, pid, providers: started.append(list(providers)))
    _fill(env, 5)
    _bind(env, "github", last_sync="")
    first = client.get("/v2/projects/pA/workspace").json()["data"]["refresh"]
    counting_sqlite["count"] = 0
    counting_sqlite["statements"].clear()
    second = client.get("/v2/projects/pA/workspace").json()["data"]["refresh"]

    assert first["started"] == ["github"]
    assert second["started"] == [] and second["in_flight"] == ["github"]
    assert started == [["github"]], "exactly one refresh was ever scheduled"
    assert counting_sqlite["count"] <= _REQUEST_CEILING, counting_sqlite["statements"]
