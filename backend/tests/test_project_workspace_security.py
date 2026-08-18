# coding: utf-8
"""MERGE-SAFETY — the attack surface of the new Workspace write routes.

Everything this PR adds is reachable by URL, so every route is attacked here
from the outside, over HTTP, exactly as an attacker would reach it:

    unauthenticated · foreign owner · foreign project · guessed task id ·
    guessed knowledge id · guessed view marker · cross-project id reuse ·
    stale ownership after a project's owner changes ·
    a user_id / owner_user_id planted in the body, query string and headers

Two invariants must hold for all of them:

  IDENTITY  the acting user is whoever SERVER AUTH says, never anything the
            request carries;
  EXISTENCE the answer for "not yours" is byte-identical to the answer for
            "not there", so no probe can map another account's data.

`test_project_workspace_tasks.py` and `..._knowledge.py` attack the STORES
directly. This file attacks the ROUTES, because a store can be perfectly scoped
and still be reachable through a handler that forgot to gate.

No network, no model calls.
"""
from __future__ import annotations

import sqlite3

import pytest

from backend.core import deps
from backend.services.auth.identity import User

OWNER = User(id="uA", kind="email", external_id="email:a@x.com", display_name="A")
ATTACKER = User(id="uB", kind="email", external_id="email:b@x.com", display_name="B")
GUEST = User(id="guest:anon", kind="guest", external_id="guest:anon",
             display_name="")


@pytest.fixture()
def env(tmp_path, monkeypatch, app):
    projects_db = str(tmp_path / "projects.db")
    monkeypatch.setenv("PROJECTS_DB_PATH", projects_db)
    from backend.services.projects import store as projects_store
    from backend.services.projects import knowledge as knowledge_mod
    from backend.services.projects import tasks_store, views_store
    from backend.services.orchestrator import decisions_store
    for mod in (projects_store, tasks_store, views_store, decisions_store):
        monkeypatch.setattr(mod, "DB_PATH", projects_db, raising=False)
    projects_store._reset_for_tests()
    projects_store.init()
    tasks_store.init_tasks_table()
    views_store.init_views_table()
    decisions_store.init_decisions_table()

    projects_store.create_project("uA", name="Owned", description="",
                                  project_id="pA")
    projects_store.create_project("uA", name="Also owned", description="",
                                  project_id="pA2")
    projects_store.create_project("uB", name="Theirs", description="",
                                  project_id="pB")

    task = tasks_store.create_task(project_id="pA", owner_user_id="uA",
                                   title="Secret task")
    item = knowledge_mod.add_knowledge(project_id="pA", user_id="uA",
                                       kind="decision", text="Secret decision")
    views_store.mark_viewed("uA", "pA")
    yield {"db": projects_db, "projects": projects_store, "tasks": tasks_store,
           "views": views_store, "k": knowledge_mod,
           "task_id": task["id"], "knowledge_id": item["id"]}
    app.dependency_overrides.clear()


def _as(app, user):
    app.dependency_overrides[deps.current_user] = lambda: user


def _every_route(env):
    """(method, path, body) for every route this PR adds, plus the read."""
    t, k = env["task_id"], env["knowledge_id"]
    return [
        ("GET", "/v2/projects/pA/workspace", None),
        ("GET", "/v2/projects/pA/tasks", None),
        ("POST", "/v2/projects/pA/tasks", {"title": "Injected"}),
        ("PATCH", f"/v2/projects/pA/tasks/{t}", {"status": "done"}),
        ("DELETE", f"/v2/projects/pA/tasks/{t}", None),
        ("GET", "/v2/projects/pA/knowledge", None),
        ("POST", "/v2/projects/pA/knowledge", {"kind": "fact", "text": "x"}),
        ("DELETE", f"/v2/projects/pA/knowledge/{k}", None),
        ("POST", "/v2/projects/pA/workspace/seen", {}),
    ]


def _call(client, method, path, body):
    return client.request(method, path, json=body) if body is not None \
        else client.request(method, path)


# ── identity ─────────────────────────────────────────────────────────────────

def test_a_guest_is_refused_by_every_route(client, env, app):
    """An unauthenticated caller resolves to a guest identity, which owns no
    project — so every route answers the same 404 as a project that is not
    there, and nothing is mutated."""
    _as(app, GUEST)
    for method, path, body in _every_route(env):
        res = _call(client, method, path, body)
        assert res.status_code == 404, f"{method} {path} → {res.status_code}"
    assert len(env["tasks"].list_tasks("pA", owner_user_id="uA")) == 1
    assert len(env["k"].list_knowledge("pA")) == 1


def test_a_foreign_owner_is_refused_by_every_route(client, env, app):
    _as(app, ATTACKER)
    for method, path, body in _every_route(env):
        res = _call(client, method, path, body)
        assert res.status_code == 404, f"{method} {path} → {res.status_code}"
    assert len(env["tasks"].list_tasks("pA", owner_user_id="uA")) == 1


def test_a_foreign_project_answers_exactly_like_a_missing_one(client, env, app):
    """Existence-hidden, asserted byte for byte: someone else's project and a
    project id that was never issued must be indistinguishable."""
    _as(app, ATTACKER)
    for path in ("/v2/projects/{}/workspace", "/v2/projects/{}/tasks",
                 "/v2/projects/{}/knowledge"):
        theirs = client.get(path.format("pA"))
        missing = client.get(path.format("does-not-exist"))
        assert theirs.status_code == missing.status_code == 404
        # The ENTIRE body, not just a field: identical responses are what make
        # the two cases indistinguishable to a prober.
        assert theirs.json() == missing.json()
        assert "pA" not in theirs.text


def test_a_planted_identity_in_body_query_or_header_changes_nothing(
        client, env, app):
    """Every shape an attacker can decorate a request with. The acting user is
    the session's, always."""
    _as(app, ATTACKER)
    decorations = {"params": {"user_id": "uA", "owner_user_id": "uA",
                              "project_owner": "uA"},
                   "headers": {"X-User-Id": "uA", "X-Owner-User-Id": "uA"}}
    res = client.post("/v2/projects/pA/tasks",
                      json={"title": "Injected", "owner_user_id": "uA",
                            "user_id": "uA", "project_id": "pA"},
                      **decorations)
    assert res.status_code == 404
    assert env["tasks"].list_tasks("pA", owner_user_id="uA")[0]["title"] \
        == "Secret task"

    # And when the OWNER supplies a foreign owner, the row is still theirs.
    _as(app, OWNER)
    made = client.post("/v2/projects/pA/tasks",
                       json={"title": "Mine", "owner_user_id": "uB"},
                       **decorations)
    assert made.status_code == 201
    assert made.json()["data"]["task"]["owner_user_id"] == "uA"


# ── guessed ids ──────────────────────────────────────────────────────────────

def test_a_guessed_task_id_is_useless_from_another_account(client, env, app):
    """The attacker knows the exact task id — from a log, a screenshot, a
    shared link. It is still unreachable, through their OWN project too."""
    _as(app, ATTACKER)
    t = env["task_id"]
    for path in (f"/v2/projects/pA/tasks/{t}", f"/v2/projects/pB/tasks/{t}"):
        assert client.patch(path, json={"status": "done"}).status_code == 404
        assert client.delete(path).status_code == 404
    assert env["tasks"].get_task(t, project_id="pA",
                                 owner_user_id="uA")["status"] == "todo"


def test_a_guessed_knowledge_id_is_useless_from_another_account(client, env, app):
    _as(app, ATTACKER)
    k = env["knowledge_id"]
    assert client.delete(f"/v2/projects/pA/knowledge/{k}").status_code == 404
    assert client.delete(f"/v2/projects/pB/knowledge/{k}").status_code == 404
    assert len(env["k"].list_knowledge("pA")) == 1


def test_cross_project_id_reuse_is_refused_between_projects_you_own(
        client, env, app):
    """Owner A owns BOTH pA and pA2. Knowing a real id from pA must not make it
    actionable through pA2 — the project in the PATH is authoritative, not the
    fact that the caller happens to own something."""
    _as(app, OWNER)
    t, k = env["task_id"], env["knowledge_id"]
    assert client.patch(f"/v2/projects/pA2/tasks/{t}",
                        json={"status": "done"}).status_code == 404
    assert client.delete(f"/v2/projects/pA2/tasks/{t}").status_code == 404
    assert client.delete(f"/v2/projects/pA2/knowledge/{k}").status_code == 404
    assert env["tasks"].get_task(t, project_id="pA",
                                 owner_user_id="uA")["status"] == "todo"
    assert len(env["k"].list_knowledge("pA")) == 1


# ── the view marker ──────────────────────────────────────────────────────────

def test_the_view_marker_cannot_be_read_or_written_across_accounts(
        client, env, app):
    """View state is per-person. The attacker can neither learn when the owner
    last looked at a project, nor move the owner's marker to hide changes from
    them."""
    owner_marker = env["views"].get_last_viewed_at("uA", "pA")
    assert owner_marker

    _as(app, ATTACKER)
    assert client.post("/v2/projects/pA/workspace/seen",
                       json={"seen_through": "2099-01-01T00:00:00Z"}
                       ).status_code == 404
    assert env["views"].get_last_viewed_at("uA", "pA") == owner_marker
    assert env["views"].get_last_viewed_at("uB", "pA") == ""

    # The attacker's own marker on their OWN project is separate and unrelated.
    assert client.post("/v2/projects/pB/workspace/seen", json={}
                       ).status_code == 200
    assert env["views"].get_last_viewed_at("uA", "pA") == owner_marker


def test_the_owner_cannot_be_tricked_into_hiding_their_own_changes(
        client, env, app):
    """`seen_through` is a hint from the client, so the obvious abuse is a far
    future value that suppresses "since your last visit" forever. The store
    clamps it to server `now`."""
    _as(app, OWNER)
    res = client.post("/v2/projects/pA/workspace/seen",
                      json={"seen_through": "2099-01-01T00:00:00Z"})
    assert res.status_code == 200
    assert not res.json()["data"]["last_viewed_at"].startswith("2099")


# ── ownership that changes underneath the data ───────────────────────────────

def test_a_project_whose_owner_changes_leaks_nothing_in_either_direction(
        client, env, app):
    """There is no transfer API today, but a project's owner could change by an
    operator edit or a future feature. Both directions must be safe:

      * the OLD owner immediately fails the project gate;
      * the NEW owner passes the gate but does NOT inherit the previous
        owner's task rows, because tasks are scoped to the user who recorded
        them as well as to the project.

    The rows become unreachable rather than reassigned. Losing sight of a row
    is recoverable; showing it to the wrong person is not."""
    _as(app, OWNER)
    assert client.get("/v2/projects/pA/tasks").status_code == 200

    c = sqlite3.connect(env["db"])
    c.execute("UPDATE projects SET owner_user_id='uB' WHERE id='pA'")
    c.commit(); c.close()

    # Old owner: gate closed on every route.
    for method, path, body in _every_route(env):
        assert _call(client, method, path, body).status_code == 404

    # New owner: through the gate, but inherits no task and no view marker.
    _as(app, ATTACKER)
    listed = client.get("/v2/projects/pA/tasks")
    assert listed.status_code == 200
    assert listed.json()["data"]["tasks"] == []
    assert listed.json()["data"]["counts"]["open"] == 0
    snap = client.get("/v2/projects/pA/workspace")
    assert snap.status_code == 200
    assert snap.json()["data"]["tasks"]["items"] == []
    assert snap.json()["data"]["changes"]["last_viewed_at"] == ""
    # The old owner's task is still on disk, and reachable by nobody.
    assert env["tasks"].get_task(env["task_id"], project_id="pA",
                                 owner_user_id="uB") is None


def test_an_archived_project_still_belongs_to_its_owner_and_nobody_else(
        client, env, app):
    """Archiving is a status, not a permission change."""
    env["projects"].update_project("pA", status="archived")
    _as(app, ATTACKER)
    assert client.get("/v2/projects/pA/tasks").status_code == 404
    _as(app, OWNER)
    assert client.get("/v2/projects/pA/tasks").status_code == 200


# ── nothing sensitive in the payloads ────────────────────────────────────────

def test_no_route_response_carries_credential_material(client, env, app):
    _as(app, OWNER)
    for method, path, body in _every_route(env):
        res = _call(client, method, path, body)
        text = res.text.lower()
        for secret in ("access_token", "refresh_token", "client_secret",
                       "authorization_id", "credential", "password",
                       "api_key", "bearer "):
            assert secret not in text, f"{method} {path} leaked `{secret}`"
