# coding: utf-8
"""MERGE-SAFETY — schema bootstrap, upgrade, rollback and hostile rows.

This PR adds two tables (`project_tasks`, `project_views`) to a database that
is already live on deployed installations. There is no migration script: both
self-initialize on access, the same way `observations`, `goals` and
`decisions` already do. That choice is only safe if all of the following hold,
so each one is pinned here:

  * bringing the schema up is IDEMPOTENT and survives concurrent startup;
  * a projects.db written BEFORE this PR opens and upgrades in place, with
    every pre-existing row intact;
  * nothing is dropped, renamed, rewritten or back-filled — the upgrade is
    additive only, so rolling the code back leaves a readable database;
  * the declared indexes actually exist;
  * a hostile or legacy row cannot take down a Workspace read or a route.

The last one matters most. SQLite columns are dynamically typed, so `priority
INTEGER` does not prevent a non-numeric value being present — from a restored
backup, a hand-edited file, or a future writer with a bug. One bad row may cost
its own fidelity; it may never cost the list, the page, or a 200.

No network, no model calls.
"""
from __future__ import annotations

import sqlite3
import threading

import pytest

from backend.core import deps
from backend.services.auth.identity import User

USER_A = User(id="uA", kind="email", external_id="email:a@x.com", display_name="A")

#: Exactly the tables a projects.db had BEFORE this PR.
_LEGACY_SCHEMA = """
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS project_threads (
    project_id TEXT NOT NULL, thread_id TEXT NOT NULL, added_at TEXT NOT NULL,
    PRIMARY KEY (project_id, thread_id));
CREATE TABLE IF NOT EXISTS project_memory (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'note', content TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'user', created_at TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}');
"""


@pytest.fixture()
def env(tmp_path, monkeypatch, app):
    projects_db = str(tmp_path / "projects.db")
    monkeypatch.setenv("PROJECTS_DB_PATH", projects_db)
    from backend.services.projects import store as projects_store
    from backend.services.projects import tasks_store, views_store
    from backend.services.orchestrator import decisions_store
    from backend.services.orchestrator import observations_store as obs
    for mod in (projects_store, tasks_store, views_store, decisions_store, obs):
        monkeypatch.setattr(mod, "DB_PATH", projects_db, raising=False)
    projects_store._reset_for_tests()
    app.dependency_overrides[deps.current_user] = lambda: USER_A
    yield {"db": projects_db, "projects": projects_store, "tasks": tasks_store,
           "views": views_store}
    app.dependency_overrides.clear()


def _tables(db: str) -> set:
    c = sqlite3.connect(db)
    try:
        return {r[0] for r in c.execute(
            "SELECT name FROM sqlite_master WHERE type='table'")}
    finally:
        c.close()


def _indexes(db: str) -> set:
    c = sqlite3.connect(db)
    try:
        return {r[0] for r in c.execute(
            "SELECT name FROM sqlite_master WHERE type='index' "
            "AND name IS NOT NULL")}
    finally:
        c.close()


# ── bootstrap ────────────────────────────────────────────────────────────────

def test_bringing_the_schema_up_is_idempotent(env):
    for _ in range(5):
        env["tasks"].init_tasks_table()
        env["views"].init_views_table()
    assert {"project_tasks", "project_views"} <= _tables(env["db"])


def test_concurrent_startup_does_not_race_or_raise(env):
    """Every worker in a multi-process deploy brings the schema up on its first
    access. WAL + a busy timeout is what makes that safe; this proves it."""
    errors: list = []

    def _boot():
        try:
            env["tasks"].init_tasks_table()
            env["views"].init_views_table()
            env["tasks"].count_by_status("nope", owner_user_id="uA")
        except Exception as exc:                 # pragma: no cover — the point
            errors.append(repr(exc))

    threads = [threading.Thread(target=_boot) for _ in range(12)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert errors == []
    assert {"project_tasks", "project_views"} <= _tables(env["db"])


def test_the_declared_indexes_exist(env):
    env["tasks"].init_tasks_table()
    names = _indexes(env["db"])
    assert "ix_project_tasks_project" in names
    assert "ix_project_tasks_owner" in names


def test_the_view_marker_is_one_row_per_user_and_project(env):
    """The primary key is the whole isolation guarantee for view state."""
    env["views"].init_views_table()
    env["views"].mark_viewed("uA", "pA")
    env["views"].mark_viewed("uA", "pA")
    env["views"].mark_viewed("uB", "pA")
    c = sqlite3.connect(env["db"])
    try:
        assert c.execute("SELECT COUNT(*) FROM project_views").fetchone()[0] == 2
    finally:
        c.close()


# ── upgrading a real, pre-existing database ──────────────────────────────────

def test_a_database_written_before_this_pr_upgrades_in_place(env, client):
    """The actual deployment path: an existing projects.db with real rows and
    none of the new tables. Opening the Workspace must upgrade it additively and
    leave every pre-existing row untouched."""
    c = sqlite3.connect(env["db"])
    c.executescript(_LEGACY_SCHEMA)
    c.execute("INSERT INTO projects (id, owner_user_id, name, description, "
              "status, created_at, updated_at) VALUES "
              "('pA','uA','Legacy project','desc','active','2026-01-01','2026-01-01')")
    c.execute("INSERT INTO project_memory (id, project_id, kind, content, source,"
              " created_at) VALUES ('m1','pA','fact','An old fact','user','2026-01-02')")
    c.commit(); c.close()
    before = _tables(env["db"])
    assert "project_tasks" not in before and "project_views" not in before

    env["projects"]._reset_for_tests()
    res = client.get("/v2/projects/pA/workspace")
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["project"]["name"] == "Legacy project"
    assert data["tasks"]["items"] == []
    assert data["changes"]["mode"] == "recent"
    # The pre-existing knowledge row is still there and is now surfaced.
    assert data["knowledge"]["counts"]["fact"] == 1

    after = _tables(env["db"])
    assert {"project_tasks", "project_views"} <= after
    assert before <= after                        # nothing dropped or renamed


def test_the_upgrade_writes_no_rows_of_its_own(env, client):
    """Additive means additive: bringing the tables up must not back-fill,
    synthesise a marker, or invent a task for an existing project."""
    env["projects"].init()
    env["projects"].create_project("uA", name="P", description="",
                                   project_id="pA")
    assert client.get("/v2/projects/pA/workspace").status_code == 200
    c = sqlite3.connect(env["db"])
    try:
        assert c.execute("SELECT COUNT(*) FROM project_tasks").fetchone()[0] == 0
        assert c.execute("SELECT COUNT(*) FROM project_views").fetchone()[0] == 0
    finally:
        c.close()


def test_rolling_back_leaves_a_readable_database(env, client):
    """Reverting the code leaves the two tables behind, unread. The inverse —
    the tables missing while the code runs — must also be survivable, so the
    Workspace is read with them dropped mid-flight."""
    env["projects"].init()
    env["projects"].create_project("uA", name="P", description="",
                                   project_id="pA")
    env["tasks"].create_task(project_id="pA", owner_user_id="uA", title="T")
    env["views"].mark_viewed("uA", "pA")

    c = sqlite3.connect(env["db"])
    c.executescript("DROP TABLE project_tasks; DROP TABLE project_views;")
    c.commit(); c.close()

    res = client.get("/v2/projects/pA/workspace")
    assert res.status_code == 200
    body = res.json()["data"]
    assert body["project"]["name"] == "P"         # the project still reads
    assert body["tasks"]["items"] == []           # the section degrades honestly
    assert body["changes"]["mode"] == "recent"


# ── hostile rows ─────────────────────────────────────────────────────────────

def _insert_raw_task(db: str, **over):
    row = {"id": "bad1", "project_id": "pA", "owner_user_id": "uA",
           "title": "legacy row", "details": "", "status": "todo", "priority": 2,
           "source": "user", "origin_ref": "", "created_at": "2026-01-01",
           "updated_at": "2026-01-01", "completed_at": "", "archived_at": ""}
    row.update(over)
    from backend.services.projects import tasks_store
    tasks_store.init_tasks_table()
    c = sqlite3.connect(db)
    c.execute(
        "INSERT INTO project_tasks (id, project_id, owner_user_id, title, "
        "details, status, priority, source, origin_ref, created_at, updated_at,"
        " completed_at, archived_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        tuple(row[k] for k in (
            "id", "project_id", "owner_user_id", "title", "details", "status",
            "priority", "source", "origin_ref", "created_at", "updated_at",
            "completed_at", "archived_at")))
    c.commit(); c.close()


def test_a_non_numeric_priority_cannot_crash_the_list_or_the_route(env, client):
    """SQLite will happily store 'not-an-int' in an INTEGER column. A bare
    int() here used to raise straight out of `list_tasks`: the Workspace
    swallowed it (the whole task section silently vanished) and the tasks route
    did not (HTTP 500). One bad row may cost only itself."""
    env["projects"].init()
    env["projects"].create_project("uA", name="P", description="",
                                   project_id="pA")
    env["tasks"].create_task(project_id="pA", owner_user_id="uA", title="good")
    _insert_raw_task(env["db"], priority="not-an-int", status="in_review",
                     source="martian", created_at="garbage", updated_at="garbage")

    rows = env["tasks"].list_tasks("pA", owner_user_id="uA")
    assert {r["title"] for r in rows} == {"good", "legacy row"}
    bad = next(r for r in rows if r["title"] == "legacy row")
    assert bad["priority"] == 2 and bad["status"] == "todo"
    assert bad["source"] == "user"                # unknown → the safe default

    listed = client.get("/v2/projects/pA/tasks")
    assert listed.status_code == 200
    assert len(listed.json()["data"]["tasks"]) == 2
    assert client.get("/v2/projects/pA/workspace").status_code == 200


def test_counts_and_the_list_agree_about_a_malformed_status(env):
    """Two readers of the same row must not disagree — one hiding it while the
    other shows it is exactly how a count stops matching what is on screen."""
    env["projects"].init()
    env["projects"].create_project("uA", name="P", description="",
                                   project_id="pA")
    _insert_raw_task(env["db"], status="in_review")
    rows = env["tasks"].list_tasks("pA", owner_user_id="uA")
    counts = env["tasks"].count_by_status("pA", owner_user_id="uA")
    assert len(rows) == 1 and rows[0]["status"] == "todo"
    assert counts["todo"] == 1 and counts["open"] == 1


def test_a_malformed_knowledge_row_cannot_crash_the_workspace(env, client):
    """The same guarantee on the knowledge side, across BOTH backing
    authorities: an unknown memory kind and a decision with no value."""
    env["projects"].init()
    env["projects"].create_project("uA", name="P", description="",
                                   project_id="pA")
    from backend.services.orchestrator import decisions_store
    decisions_store.init_decisions_table()
    c = sqlite3.connect(env["db"])
    c.execute("INSERT INTO project_memory (id, project_id, kind, content, "
              "source, created_at, metadata_json) VALUES "
              "('m9','pA','martian','odd row','user','2026-01-01','{}')")
    c.execute("INSERT INTO project_decisions (id, project_id, user_id, topic, "
              "value, source, reason, status, created_at) VALUES "
              "('d9','pA','uA','t','','USER','','active','2026-01-01')")
    c.commit(); c.close()

    res = client.get("/v2/projects/pA/workspace")
    assert res.status_code == 200
    # Neither unusable row is rendered, and neither took the page down.
    assert res.json()["data"]["knowledge"]["counts"]["total"] == 0
    assert client.get("/v2/projects/pA/knowledge").status_code == 200


def test_a_malformed_view_marker_cannot_crash_the_workspace(env, client):
    env["projects"].init()
    env["projects"].create_project("uA", name="P", description="",
                                   project_id="pA")
    env["views"].init_views_table()
    c = sqlite3.connect(env["db"])
    c.execute("INSERT INTO project_views (user_id, project_id, last_viewed_at,"
              " updated_at) VALUES ('uA','pA','¯\\\\_(ツ)_/¯','x')")
    c.commit(); c.close()
    res = client.get("/v2/projects/pA/workspace")
    assert res.status_code == 200
    assert res.json()["data"]["changes"]["mode"] == "recent"
