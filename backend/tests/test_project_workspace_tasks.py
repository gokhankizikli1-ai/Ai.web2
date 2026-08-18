# coding: utf-8
"""PROJECT TASKS — the canonical user-facing task authority + its routes.

A project task is ORGANIZATIONAL STATE. It is the one place in the Project
Workspace where the user WRITES, so it is also the one place where a mistake
would either leak across accounts or quietly turn "I wrote something down" into
"Korvix ran something". These tests attack both:

  * OWNERSHIP     — another account's project is 404 (existence-hidden), and a
                    task id from another owner or another project cannot be
                    read, edited or deleted through a project you DO own;
  * IDENTITY      — a client-supplied owner is ignored entirely;
  * LIFECYCLE     — create → move through the four states → complete → delete,
                    with `completed_at` maintained by the store, never the
                    client;
  * NO EXECUTION  — a task write creates no run, no candidate action, no
                    orchestrator task and no approval;
  * BOUNDS+ORDER  — every list is capped and deterministically ordered;
  * PROJECTION    — the workspace snapshot carries a bounded task slice and
                    honest counts.

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
    projects_db = str(tmp_path / "projects.db")
    monkeypatch.setenv("PROJECTS_DB_PATH", projects_db)

    from backend.services.projects import store as projects_store
    from backend.services.projects import tasks_store, views_store
    from backend.services.orchestrator import (
        decisions_store, candidate_actions_store, runs_store,
        tasks_store as orchestrator_tasks, approvals_store,
    )

    for mod in (projects_store, tasks_store, views_store, decisions_store,
                candidate_actions_store, runs_store, orchestrator_tasks,
                approvals_store):
        monkeypatch.setattr(mod, "DB_PATH", projects_db, raising=False)
    projects_store._reset_for_tests()
    projects_store.init()
    tasks_store.init_tasks_table()
    views_store.init_views_table()
    decisions_store.init_decisions_table()

    projects_store.create_project("uA", name="Fitness App", description="",
                                  project_id="pA")
    projects_store.create_project("uA", name="Second", description="",
                                  project_id="pA2")
    projects_store.create_project("uB", name="Theirs", description="",
                                  project_id="pB")

    from backend.services.project_brain import workspace as ws_mod
    yield {"tasks": tasks_store, "projects": projects_store, "ws": ws_mod}
    app.dependency_overrides.clear()


def _as(app, user):
    app.dependency_overrides[deps.current_user] = lambda: user


def _create(client, project="pA", **body):
    payload = {"title": "Review pricing page"}
    payload.update(body)
    return client.post(f"/v2/projects/{project}/tasks", json=payload)


# ── store: lifecycle ─────────────────────────────────────────────────────────

def test_create_stores_the_task_with_server_supplied_owner(env):
    task = env["tasks"].create_task(project_id="pA", owner_user_id="uA",
                                    title="  Ship the beta  ")
    assert task is not None
    assert task["title"] == "Ship the beta"          # trimmed
    assert task["status"] == "todo"                  # default
    assert task["priority"] == 2                     # normal
    assert task["source"] == "user"
    assert task["owner_user_id"] == "uA"
    assert task["completed_at"] == "" and task["archived_at"] == ""


def test_a_task_without_a_title_is_not_a_task(env):
    assert env["tasks"].create_task(project_id="pA", owner_user_id="uA",
                                    title="   ") is None


def test_status_moves_through_all_four_states(env):
    t = env["tasks"].create_task(project_id="pA", owner_user_id="uA", title="X")
    for status in ("doing", "waiting", "todo", "done"):
        moved = env["tasks"].update_task(t["id"], project_id="pA",
                                         owner_user_id="uA", status=status)
        assert moved["status"] == status
    assert moved["completed_at"]     # stamped exactly when it reached done


def test_completed_at_is_derived_from_status_not_accepted_from_the_client(env):
    t = env["tasks"].create_task(project_id="pA", owner_user_id="uA", title="X")
    done = env["tasks"].update_task(t["id"], project_id="pA",
                                    owner_user_id="uA", status="done")
    stamped = done["completed_at"]
    assert stamped
    # Re-completing keeps the ORIGINAL completion instant…
    again = env["tasks"].update_task(t["id"], project_id="pA",
                                     owner_user_id="uA", title="X2")
    assert again["completed_at"] == stamped
    # …and leaving `done` clears it, so status and timestamp can never disagree.
    reopened = env["tasks"].update_task(t["id"], project_id="pA",
                                        owner_user_id="uA", status="todo")
    assert reopened["completed_at"] == ""


def test_a_rename_may_not_empty_the_task(env):
    t = env["tasks"].create_task(project_id="pA", owner_user_id="uA", title="X")
    assert env["tasks"].update_task(t["id"], project_id="pA",
                                    owner_user_id="uA", title="  ") is None
    assert env["tasks"].get_task(t["id"], project_id="pA",
                                 owner_user_id="uA")["title"] == "X"


def test_an_unknown_status_or_priority_falls_back_instead_of_corrupting(env):
    t = env["tasks"].create_task(project_id="pA", owner_user_id="uA", title="X",
                                 status="in_review", priority=99)
    assert t["status"] == "todo" and t["priority"] == 2


def test_archive_hides_the_task_from_every_read(env):
    t = env["tasks"].create_task(project_id="pA", owner_user_id="uA", title="X")
    assert env["tasks"].archive_task(t["id"], project_id="pA", owner_user_id="uA")
    assert env["tasks"].get_task(t["id"], project_id="pA", owner_user_id="uA") is None
    assert env["tasks"].list_tasks("pA", owner_user_id="uA") == []
    assert env["tasks"].count_by_status("pA", owner_user_id="uA")["open"] == 0
    # Archiving twice is not a second delete.
    assert env["tasks"].archive_task(t["id"], project_id="pA",
                                     owner_user_id="uA") is False


# ── store: isolation ─────────────────────────────────────────────────────────

def test_a_task_is_invisible_across_owners(env):
    t = env["tasks"].create_task(project_id="pA", owner_user_id="uA", title="Mine")
    assert env["tasks"].get_task(t["id"], project_id="pA", owner_user_id="uB") is None
    assert env["tasks"].update_task(t["id"], project_id="pA",
                                    owner_user_id="uB", status="done") is None
    assert env["tasks"].archive_task(t["id"], project_id="pA",
                                     owner_user_id="uB") is False
    assert env["tasks"].list_tasks("pA", owner_user_id="uB") == []


def test_a_task_is_invisible_across_projects(env):
    t = env["tasks"].create_task(project_id="pA", owner_user_id="uA", title="Mine")
    assert env["tasks"].get_task(t["id"], project_id="pA2", owner_user_id="uA") is None
    assert env["tasks"].update_task(t["id"], project_id="pA2",
                                    owner_user_id="uA", status="done") is None
    assert env["tasks"].archive_task(t["id"], project_id="pA2",
                                     owner_user_id="uA") is False
    assert env["tasks"].list_tasks("pA2", owner_user_id="uA") == []


# ── store: order + bounds ────────────────────────────────────────────────────

def test_ordering_is_doing_then_todo_then_waiting_then_done(env):
    made = {}
    for status in ("done", "waiting", "todo", "doing"):
        made[status] = env["tasks"].create_task(
            project_id="pA", owner_user_id="uA", title=status, status=status)
    order = [t["status"] for t in env["tasks"].list_tasks("pA", owner_user_id="uA")]
    assert order == ["doing", "todo", "waiting", "done"]


def test_within_a_status_higher_priority_wins_then_oldest_first(env):
    low = env["tasks"].create_task(project_id="pA", owner_user_id="uA",
                                   title="low", priority=1)
    high = env["tasks"].create_task(project_id="pA", owner_user_id="uA",
                                    title="high", priority=3)
    normal = env["tasks"].create_task(project_id="pA", owner_user_id="uA",
                                      title="normal", priority=2)
    titles = [t["title"] for t in env["tasks"].list_tasks("pA", owner_user_id="uA")]
    assert titles == ["high", "normal", "low"]
    assert {low["id"], high["id"], normal["id"]} == {
        t["id"] for t in env["tasks"].list_tasks("pA", owner_user_id="uA")}


def test_list_is_bounded_and_stable(env):
    for i in range(30):
        env["tasks"].create_task(project_id="pA", owner_user_id="uA",
                                 title=f"task {i}")
    first = env["tasks"].list_tasks("pA", owner_user_id="uA", limit=5)
    second = env["tasks"].list_tasks("pA", owner_user_id="uA", limit=5)
    assert len(first) == 5 and first == second
    assert len(env["tasks"].list_tasks("pA", owner_user_id="uA", limit=10_000)) == 30


def test_counts_report_every_status_even_when_zero(env):
    env["tasks"].create_task(project_id="pA", owner_user_id="uA", title="a",
                             status="doing")
    env["tasks"].create_task(project_id="pA", owner_user_id="uA", title="b",
                             status="done")
    counts = env["tasks"].count_by_status("pA", owner_user_id="uA")
    assert counts == {"todo": 0, "doing": 1, "waiting": 0, "done": 1, "open": 1}


def test_an_empty_project_has_an_honest_empty_task_state(env):
    assert env["tasks"].list_tasks("pA2", owner_user_id="uA") == []
    assert env["tasks"].count_by_status("pA2", owner_user_id="uA")["open"] == 0


# ── the write starts nothing ─────────────────────────────────────────────────

def test_a_task_write_starts_no_run_and_proposes_no_candidate_action(env):
    """A user-visible task is organizational state, not permission to execute.
    Creating, moving and completing one must leave the whole Business Brain
    execution path — candidates, orchestrator tasks, runs, approvals —
    completely untouched."""
    from backend.services.orchestrator import (
        candidate_actions_store as cas, runs_store,
        tasks_store as orchestrator_tasks, approvals_store,
    )
    t = env["tasks"].create_task(project_id="pA", owner_user_id="uA", title="Do it")
    env["tasks"].update_task(t["id"], project_id="pA", owner_user_id="uA",
                             status="doing")
    env["tasks"].update_task(t["id"], project_id="pA", owner_user_id="uA",
                             status="done")
    env["tasks"].archive_task(t["id"], project_id="pA", owner_user_id="uA")

    assert cas.list_candidate_actions("pA", limit=50) == []
    assert orchestrator_tasks.list_tasks_for_project("pA") == []
    assert runs_store.list_runs(project_id="pA") == []
    assert approvals_store.list_for_project("pA") == []


def test_deleting_the_project_takes_its_tasks_and_view_marker_with_it(env):
    """`project_tasks` and `project_views` self-initialize, so they carry no FK
    to `projects` and are not cascaded by SQLite. A deleted project must not
    leave the user's tasks — or their last-visit metadata — behind."""
    from backend.services.projects import views_store
    env["tasks"].create_task(project_id="pA", owner_user_id="uA", title="Mine")
    views_store.mark_viewed("uA", "pA")
    keep = env["tasks"].create_task(project_id="pA2", owner_user_id="uA",
                                    title="Other project")

    assert env["projects"].delete_project("pA") is True
    assert env["tasks"].list_tasks("pA", owner_user_id="uA") == []
    assert views_store.get_last_viewed_at("uA", "pA") == ""
    # …and the OTHER project is untouched.
    assert [t["id"] for t in env["tasks"].list_tasks("pA2", owner_user_id="uA")] \
        == [keep["id"]]


# ── workspace projection ─────────────────────────────────────────────────────

def test_the_workspace_carries_a_bounded_task_slice_and_real_counts(env):
    for i in range(12):
        env["tasks"].create_task(project_id="pA", owner_user_id="uA",
                                 title=f"task {i}")
    snap = env["ws"].build("uA", "pA")
    assert len(snap["tasks"]["items"]) == 6            # bounded for the Overview
    assert snap["tasks"]["counts"]["todo"] == 12       # the count is the truth
    assert snap["counts"]["tasks"] == 12


def test_the_workspace_never_shows_another_owners_tasks(env):
    """A task row written against this project but recorded under a different
    owner must not appear — the project gate alone is not relied upon."""
    env["tasks"].create_task(project_id="pA", owner_user_id="uB", title="Theirs")
    env["tasks"].create_task(project_id="pA", owner_user_id="uA", title="Mine")
    snap = env["ws"].build("uA", "pA")
    assert [t["title"] for t in snap["tasks"]["items"]] == ["Mine"]


# ── HTTP surface ─────────────────────────────────────────────────────────────

def test_route_create_list_update_delete_round_trip(client, env, app):
    _as(app, USER_A)
    created = _create(client)
    assert created.status_code == 201
    task = created.json()["data"]["task"]
    assert task["title"] == "Review pricing page" and task["status"] == "todo"

    listed = client.get("/v2/projects/pA/tasks")
    assert listed.status_code == 200
    body = listed.json()["data"]
    assert [t["id"] for t in body["tasks"]] == [task["id"]]
    assert body["counts"]["open"] == 1

    moved = client.patch(f"/v2/projects/pA/tasks/{task['id']}",
                         json={"status": "done"})
    assert moved.status_code == 200
    assert moved.json()["data"]["task"]["status"] == "done"
    assert moved.json()["data"]["task"]["completed_at"]

    removed = client.delete(f"/v2/projects/pA/tasks/{task['id']}")
    assert removed.status_code == 200
    assert client.get("/v2/projects/pA/tasks").json()["data"]["tasks"] == []


def test_route_status_filter(client, env, app):
    _as(app, USER_A)
    _create(client, title="a", status="doing")
    _create(client, title="b", status="todo")
    doing = client.get("/v2/projects/pA/tasks", params={"status": "doing"})
    assert [t["title"] for t in doing.json()["data"]["tasks"]] == ["a"]


def test_route_empty_patch_does_not_fake_activity(client, env, app):
    _as(app, USER_A)
    task = _create(client).json()["data"]["task"]
    same = client.patch(f"/v2/projects/pA/tasks/{task['id']}", json={})
    assert same.status_code == 200
    assert same.json()["data"]["task"]["updated_at"] == task["updated_at"]


def test_route_rejects_an_empty_title(client, env, app):
    _as(app, USER_A)
    assert _create(client, title="").status_code == 422        # schema floor
    assert _create(client, title="   ").status_code == 400     # store floor


def test_route_hides_another_owners_project_on_every_verb(client, env, app):
    _as(app, USER_B)
    assert client.get("/v2/projects/pA/tasks").status_code == 404
    assert _create(client).status_code == 404
    assert client.patch("/v2/projects/pA/tasks/anything",
                        json={"status": "done"}).status_code == 404
    assert client.delete("/v2/projects/pA/tasks/anything").status_code == 404
    # A project that does not exist at all answers identically.
    assert client.get("/v2/projects/nope/tasks").status_code == 404


def test_route_cannot_reach_a_task_through_a_project_you_own(client, env, app):
    """Owner A owns BOTH pA and pA2. A task filed under pA must still be
    unreachable through pA2 — the project in the path is authoritative."""
    _as(app, USER_A)
    task = _create(client).json()["data"]["task"]
    assert client.patch(f"/v2/projects/pA2/tasks/{task['id']}",
                        json={"status": "done"}).status_code == 404
    assert client.delete(f"/v2/projects/pA2/tasks/{task['id']}").status_code == 404


def test_route_ignores_a_client_supplied_owner(client, env, app):
    """Identity comes from server auth alone. Decorating the request with
    another owner changes nothing."""
    _as(app, USER_B)
    res = client.post("/v2/projects/pA/tasks",
                      params={"user_id": "uA", "owner_user_id": "uA"},
                      headers={"X-User-Id": "uA"},
                      json={"title": "Sneaky", "owner_user_id": "uA"})
    assert res.status_code == 404
    assert env["tasks"].list_tasks("pA", owner_user_id="uA") == []


def test_route_stores_the_authenticated_owner_not_the_body(client, env, app):
    _as(app, USER_A)
    task = _create(client, owner_user_id="uB", user_id="uB").json()["data"]["task"]
    assert task["owner_user_id"] == "uA"


def test_route_survives_a_very_long_title_by_bounding_it(client, env, app):
    _as(app, USER_A)
    over = client.post("/v2/projects/pA/tasks", json={"title": "x" * 5000})
    assert over.status_code == 422        # rejected at the schema, not truncated
    at_max = client.post("/v2/projects/pA/tasks", json={"title": "y" * 200})
    assert at_max.status_code == 201
    assert len(at_max.json()["data"]["task"]["title"]) == 200


def test_route_a_guest_identity_owns_no_project_and_sees_nothing(client, env, app):
    """An unauthenticated caller resolves to a guest identity, which owns no
    project — so every verb answers the same existence-hidden 404 rather than
    leaking that pA is real."""
    guest = User(id="guest:anon", kind="guest", external_id="guest:anon",
                 display_name="")
    _as(app, guest)
    assert client.get("/v2/projects/pA/tasks").status_code == 404
    assert _create(client).status_code == 404
    assert client.delete("/v2/projects/pA/tasks/x").status_code == 404
    assert client.get("/v2/projects/pA/knowledge").status_code == 404
    assert client.post("/v2/projects/pA/workspace/seen", json={}).status_code == 404
    assert client.get("/v2/projects/pA/workspace").status_code == 404
    assert env["tasks"].list_tasks("pA", owner_user_id="uA") == []
