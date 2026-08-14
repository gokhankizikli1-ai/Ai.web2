# coding: utf-8
"""Project ⇄ chat binding + generated-product listing (Phase 2 closure).

A Korvix Project becomes the durable workspace that owns its conversations and
generated products. These tests prove the BACKEND-AUTHORITATIVE affordances:

  * a chat can be assigned to, MOVED between, and removed from projects the
    caller owns — persisted server-side in the canonical `project_threads`
    binding (not localStorage);
  * a project lists its bound chats;
  * a project lists its generated Web/App products (buildType preserved, refs
    only, no duplicated source);
  * ownership is enforced on BOTH sides server-side: a user can neither read
    another user's chat/project nor file a chat under a project they don't own.

Distinct identities are provided by overriding the `current_user` dependency
(the standard FastAPI test seam) so the route sees a real, chosen user id
without coupling the test to the identity backend.
"""
from __future__ import annotations

import pytest


@pytest.fixture()
def env(tmp_path, monkeypatch):
    projects_db = str(tmp_path / "projects.db")
    sessions_db = str(tmp_path / "sessions.db")
    monkeypatch.setenv("PROJECTS_DB_PATH", projects_db)
    monkeypatch.setenv("SESSIONS_DB_PATH", sessions_db)
    monkeypatch.setenv("ENABLE_SESSIONS", "true")
    monkeypatch.setenv("ENABLE_PROJECT_ORCHESTRATOR", "true")

    from backend.services.projects import store as projects_store
    from backend.services.orchestrator import deliverables_store as dls
    from backend.services.sessions import store as sessions_store
    for mod in (projects_store, dls):
        monkeypatch.setattr(mod, "DB_PATH", projects_db, raising=False)
    monkeypatch.setattr(sessions_store, "DB_PATH", sessions_db, raising=False)
    projects_store._reset_for_tests()
    projects_store.init()
    dls.init_deliverables_table()
    sessions_store.init()

    from fastapi.testclient import TestClient
    import backend.api as api
    from backend.core.deps import current_user
    from backend.core.errors import install_api_error_handlers
    from backend.services.auth.identity import User
    from backend.services.sessions import client as sessions_client

    # The module app is built without the env-gated v2 error handlers; install
    # them so ApiError (NotFoundError → 404) maps to the production envelope.
    # Starlette caches the middleware stack on first request, so force a rebuild
    # in case another test already triggered the app in this session.
    install_api_error_handlers(api.app)
    api.app.middleware_stack = api.app.build_middleware_stack()

    state = {"uid": "userA"}

    def _override():
        uid = state["uid"]
        return User(id=uid, kind="email", external_id=uid, display_name=uid)

    api.app.dependency_overrides[current_user] = _override

    def act_as(uid: str) -> dict:
        state["uid"] = uid
        return {}

    yield {
        "http": TestClient(api.app, raise_server_exceptions=False),
        "projects": projects_store, "dls": dls, "sessions": sessions_client,
        "act_as": act_as,
    }
    api.app.dependency_overrides.pop(current_user, None)


def _make_thread(env, *, title="My chat"):
    r = env["http"].post("/v2/sessions/workspaces/ensure_default")
    ws_id = r.json()["data"]["id"]
    r = env["http"].post(f"/v2/sessions/workspaces/{ws_id}/threads",
                         json={"title": title})
    return r.json()["data"]["id"]


# ── Assign / move / remove ───────────────────────────────────────────────────

def test_assign_move_and_remove_own_chat(env):
    env["act_as"]("userA")
    pA = env["projects"].create_project("userA", name="Project A")
    pB = env["projects"].create_project("userA", name="Project B")
    th = _make_thread(env)

    # Assign to A.
    r = env["http"].put(f"/v2/sessions/threads/{th}/project",
                        json={"project_id": pA.id})
    assert r.status_code == 200
    assert r.json()["data"]["project_id"] == pA.id
    assert env["projects"].get_project_of_thread(th) == pA.id

    # Move A → B (single-binding: detach A, attach B).
    r = env["http"].put(f"/v2/sessions/threads/{th}/project",
                        json={"project_id": pB.id})
    assert r.status_code == 200
    assert r.json()["data"]["moved_from"] == pA.id
    assert env["projects"].get_project_of_thread(th) == pB.id
    assert th not in [l.thread_id for l in env["projects"].list_project_threads(pA.id)]

    # Remove from B.
    r = env["http"].delete(f"/v2/sessions/threads/{th}/project")
    assert r.status_code == 200
    assert env["projects"].get_project_of_thread(th) is None


def test_list_project_chats(env):
    env["act_as"]("userA")
    p = env["projects"].create_project("userA", name="Workspace")
    th = _make_thread(env, title="Pricing chat")
    env["http"].put(f"/v2/sessions/threads/{th}/project",
                    json={"project_id": p.id})

    r = env["http"].get(f"/v2/sessions/projects/{p.id}/threads")
    assert r.status_code == 200
    threads = r.json()["data"]["threads"]
    assert len(threads) == 1
    assert threads[0]["title"] == "Pricing chat"
    assert threads[0]["id"] == th


# ── Ownership isolation ──────────────────────────────────────────────────────

def test_cannot_assign_to_foreign_project(env):
    env["act_as"]("userB")
    p_b = env["projects"].create_project("userB", name="B's project")
    env["act_as"]("userA")
    th_a = _make_thread(env)   # A's thread

    # A tries to file their chat under B's project → 404 (existence-hidden).
    r = env["http"].put(f"/v2/sessions/threads/{th_a}/project",
                        json={"project_id": p_b.id})
    assert r.status_code == 404
    assert env["projects"].get_project_of_thread(th_a) is None


def test_cannot_move_foreign_chat(env):
    env["act_as"]("userA")
    p_a = env["projects"].create_project("userA", name="A's project")
    th_a = _make_thread(env)

    # B tries to grab A's thread → 404 (thread ownership hidden).
    env["act_as"]("userB")
    r = env["http"].put(f"/v2/sessions/threads/{th_a}/project",
                        json={"project_id": p_a.id})
    assert r.status_code == 404


def test_cannot_list_foreign_project_chats(env):
    env["act_as"]("userA")
    p_a = env["projects"].create_project("userA", name="A's project")
    env["act_as"]("userB")
    r = env["http"].get(f"/v2/sessions/projects/{p_a.id}/threads")
    assert r.status_code == 404


# ── Products listing ─────────────────────────────────────────────────────────

def test_project_products_listing(env):
    env["act_as"]("userA")
    p = env["projects"].create_project("userA", name="Builder project")
    env["dls"].create_deliverable(
        run_id="run-1", agent_id="builder", node_id="build", kind="app_build",
        title="iOS Shell", project_id=p.id, status="completed",
        content={"build_type": "app", "build_status": "completed",
                 "artifact_ref": "artifact://ios"},
    )
    r = env["http"].get(f"/v2/orchestrator/projects/{p.id}/products")
    assert r.status_code == 200
    products = r.json()["data"]["products"]
    assert len(products) == 1
    assert products[0]["build_type"] == "app"
    assert products[0]["title"] == "iOS Shell"
    assert products[0]["artifact_ref"] == "artifact://ios"


def test_cannot_list_foreign_project_products(env):
    env["act_as"]("userA")
    p_a = env["projects"].create_project("userA", name="A's project")
    env["dls"].create_deliverable(
        run_id="run-1", agent_id="builder", node_id="build", kind="web_build",
        title="Secret", project_id=p_a.id, status="completed",
        content={"build_type": "web"},
    )
    env["act_as"]("userB")
    r = env["http"].get(f"/v2/orchestrator/projects/{p_a.id}/products")
    assert r.status_code == 404
