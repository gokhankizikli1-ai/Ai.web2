# coding: utf-8
"""MERGE-SAFETY — the Project Workspace read stays ONE bounded, flat read.

The whole page renders from a single request. That is only worth anything if
the request itself does not fan out, so this measures rather than asserts by
inspection: every SQL statement issued while building the snapshot is counted
through `sqlite3`'s own trace callback.

The load-bearing property is not the absolute number — it is that the number
does NOT MOVE when the project gets big. A read whose cost grows with the row
count is an N+1, and an N+1 behind a "single bounded read" claim is the kind of
thing that only shows up on the busiest account in production.

Also pinned here: the arrays stay bounded no matter how much history exists,
and the read issues no provider, model or network call at all.

No network, no model calls.
"""
from __future__ import annotations

import sqlite3

import pytest

from backend.core import deps
from backend.services.auth.identity import User

USER_A = User(id="uA", kind="email", external_id="email:a@x.com", display_name="A")

#: Headroom over the statements one build actually issues today. It exists to
#: catch a NEW read being added silently, not to pin an exact number — the
#: no-growth assertions below are what prove the shape is flat.
_STATEMENT_CEILING = 120


@pytest.fixture()
def counting_sqlite(monkeypatch):
    """Count every SQL statement any store executes.

    Both connection paths in this codebase (`orchestrator._sqlite.connect` and
    `projects.store._conn`) go through `sqlite3.connect`, so wrapping that one
    function sees everything without touching a single store."""
    real_connect = sqlite3.connect
    state = {"count": 0, "statements": []}

    def _connect(*args, **kwargs):
        conn = real_connect(*args, **kwargs)

        def _trace(statement):
            state["count"] += 1
            state["statements"].append(statement.split("\n")[0][:80])

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

    from backend.services.projects import store as projects_store
    from backend.services.projects import knowledge as knowledge_mod
    from backend.services.projects import tasks_store, views_store
    from backend.services.orchestrator import (
        decisions_store, deliverables_store as dls, goals_store,
        observations_store as obs,
    )
    from backend.services.sessions import store as sessions_store

    for mod in (projects_store, tasks_store, views_store, obs, dls, goals_store,
                decisions_store):
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
    projects_store.create_project("uA", name="Fitness App", description="d",
                                  project_id="pA")

    from backend.services.project_brain import workspace as ws_mod
    app.dependency_overrides[deps.current_user] = lambda: USER_A
    yield {"ws": ws_mod, "tasks": tasks_store, "k": knowledge_mod, "obs": obs,
           "projects": projects_store}
    app.dependency_overrides.clear()


def _fill(env, n: int) -> None:
    """Give the project `n` of everything the read model touches."""
    for i in range(n):
        env["tasks"].create_task(project_id="pA", owner_user_id="uA",
                                 title=f"task {i}")
        env["k"].add_knowledge(project_id="pA", user_id="uA", kind="fact",
                               text=f"fact {i}")
        env["obs"].record_observation(
            user_id="uA", project_id="pA", source="github",
            kind="github.commit.pushed", summary=f"commit {i}",
            external_id=f"c{i}", observed_at="2026-06-01T10:00:00Z")


def _statements_for_one_build(env, counting_sqlite) -> int:
    counting_sqlite["count"] = 0
    counting_sqlite["statements"].clear()
    assert env["ws"].build("uA", "pA") is not None
    return counting_sqlite["count"]


# ── the read is flat ─────────────────────────────────────────────────────────

def test_the_read_cost_does_not_grow_with_the_size_of_the_project(
        env, counting_sqlite):
    """THE N+1 TEST. A project with 1 of everything and a project with 60 of
    everything must cost the same number of statements. Any per-row read — a
    lookup inside a loop, a per-task or per-knowledge-item query — shows up
    here immediately."""
    _fill(env, 1)
    small = _statements_for_one_build(env, counting_sqlite)

    _fill(env, 60)
    large = _statements_for_one_build(env, counting_sqlite)

    assert large == small, (
        f"read cost grew from {small} to {large} statements as the project "
        f"grew — that is an N+1. Statements: {counting_sqlite['statements']}"
    )


def test_one_build_stays_under_the_statement_ceiling(env, counting_sqlite):
    _fill(env, 25)
    used = _statements_for_one_build(env, counting_sqlite)
    assert used <= _STATEMENT_CEILING, (
        f"{used} statements for one workspace read: "
        f"{counting_sqlite['statements']}")


def test_each_knowledge_authority_is_row_read_exactly_once(env, counting_sqlite):
    """Counts used to come from a SECOND full `list_knowledge`, so every page
    load read every row of both authorities twice purely to count what it was
    already holding.

    Each authority is now touched exactly twice per build and no more: ONE row
    read (bounded) and ONE aggregate (exact, so a project past the cap still
    reports what it really holds). The aggregate is cheap and constant; a second
    ROW read would not be."""
    _fill(env, 5)
    _statements_for_one_build(env, counting_sqlite)
    statements = [s.lower() for s in counting_sqlite["statements"]]
    for table in ("project_decisions", "project_memory"):
        touching = [s for s in statements if f"from {table}" in s]
        row_reads = [s for s in touching if "count(" not in s]
        aggregates = [s for s in touching if "count(" in s]
        assert len(row_reads) == 1, f"{table} row-read {len(row_reads)}x"
        assert len(aggregates) == 1, f"{table} aggregated {len(aggregates)}x"


def test_repeat_reads_cost_the_same_every_time(env, counting_sqlite):
    """No warm-up query, no lazy migration re-running, no growth over time."""
    _fill(env, 10)
    costs = [_statements_for_one_build(env, counting_sqlite) for _ in range(3)]
    assert len(set(costs)) == 1, costs


# ── the payload is bounded ───────────────────────────────────────────────────

def test_every_array_stays_bounded_against_a_large_project(env):
    """100+ tasks and 100+ knowledge items in storage; the read model still
    returns a constant-size payload, and the COUNTS stay truthful about what is
    really there."""
    for i in range(120):
        env["tasks"].create_task(project_id="pA", owner_user_id="uA",
                                 title=f"task {i}")
        env["k"].add_knowledge(project_id="pA", user_id="uA", kind="note",
                               text=f"note {i}")
    for i in range(80):
        env["obs"].record_observation(
            user_id="uA", project_id="pA", source="github",
            kind="github.commit.pushed", summary=f"commit {i}",
            external_id=f"o{i}", observed_at="2026-06-01T10:00:00Z")

    snap = env["ws"].build("uA", "pA")
    assert len(snap["tasks"]["items"]) <= 6
    assert len(snap["knowledge"]["items"]) <= 4
    assert len(snap["activity"]) <= 12
    assert len(snap["changes"]["items"]) <= 6
    assert len(snap["attention"]) <= 5
    assert len(snap["goals"]) <= 5
    assert len(snap["chats"]) <= 8
    assert len(snap["products"]) <= 8
    # The truth about scale is reported as a NUMBER, not by a longer list —
    # and the number is EXACT past the row-read cap, not saturated at it.
    assert snap["tasks"]["counts"]["open"] == 120
    assert snap["knowledge"]["counts"]["note"] == 120
    assert snap["knowledge"]["counts"]["total"] == 120


def test_the_task_and_knowledge_routes_are_bounded_too(env, client):
    """The dedicated views ask for the full list; "full" is still capped."""
    for i in range(250):
        env["tasks"].create_task(project_id="pA", owner_user_id="uA",
                                 title=f"task {i}")
    for i in range(150):
        env["k"].add_knowledge(project_id="pA", user_id="uA", kind="note",
                               text=f"note {i}")

    tasks = client.get("/v2/projects/pA/tasks")
    assert tasks.status_code == 200
    assert len(tasks.json()["data"]["tasks"]) <= 200
    assert tasks.json()["data"]["counts"]["open"] == 250   # count is the truth

    knowledge = client.get("/v2/projects/pA/knowledge")
    assert knowledge.status_code == 200
    assert len(knowledge.json()["data"]["knowledge"]) <= 100

    # A client asking for more than the cap gets the cap, not an error.
    over = client.get("/v2/projects/pA/tasks", params={"limit": 100000})
    assert over.status_code == 422        # rejected at the schema boundary
    at_cap = client.get("/v2/projects/pA/tasks", params={"limit": 200})
    assert at_cap.status_code == 200


# ── the read reaches nothing off-box ─────────────────────────────────────────

def test_the_read_opens_no_socket(env, monkeypatch):
    """No provider call, no connector API call, no HTTP of any kind. Proven by
    making the socket layer itself fatal for the duration of the read."""
    import socket

    def _boom(*_a, **_k):                        # pragma: no cover — the point
        raise AssertionError("the workspace read attempted a network connection")

    monkeypatch.setattr(socket.socket, "connect", _boom)
    monkeypatch.setattr(socket, "create_connection", _boom)
    _fill(env, 5)
    assert env["ws"].build("uA", "pA") is not None
