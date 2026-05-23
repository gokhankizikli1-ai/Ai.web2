# coding: utf-8
"""Phase 2.5 — end-to-end smoke test for project persistence + chat injection.

Exercises the full happy path that the frontend relies on:
  1.  POST /projects               → create
  2.  GET  /projects               → list
  3.  POST /projects/{id}/memory   → add memory (note + fact + decision)
  4.  GET  /projects/{id}/memory   → list, newest-first
  5.  POST /projects/{id}/agents   → bind an agent
  6.  GET  /projects/{id}/agents   → confirm agent persists
  7.  build_project_context_block  → the same prompt fragment that ask_ai
                                     will prepend on a /chat call
  8.  "Reload" (re-open a TestClient, same DB)
                                   → confirm everything persists
  9.  503 behaviour when ENABLE_PROJECTS is off
 10.  cascading delete cleans up memory + agents

This is the contract the frontend depends on. If any assertion fails,
the Phase 2 UI in `ProjectWorkspace.tsx` will silently fall back to
localStorage and the user will lose cross-device project memory.
"""
import os
import sys
import tempfile
import importlib

import pytest


@pytest.fixture
def client():
    """Spin up a FastAPI app with /projects wired against a temp DB."""
    fd, path = tempfile.mkstemp(suffix="-phase25-smoke.db")
    os.close(fd)
    os.environ["PROJECTS_DB_PATH"] = path
    os.environ["ENABLE_PROJECTS"] = "true"

    # Force re-import so the new env vars take effect.
    if "backend.services.projects.store" in sys.modules:
        importlib.reload(sys.modules["backend.services.projects.store"])
    if "backend.services.projects.context" in sys.modules:
        importlib.reload(sys.modules["backend.services.projects.context"])
    if "backend.routes.projects" in sys.modules:
        importlib.reload(sys.modules["backend.routes.projects"])

    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.routes import projects as p_route
    from backend.services.projects import store as p_store
    p_store.init()

    app = FastAPI()
    app.include_router(p_route.router)
    yield TestClient(app)
    try:
        os.unlink(path)
    except FileNotFoundError:
        pass


def test_phase25_full_happy_path(client):
    """The whole flow the Phase 2.5 UI exercises end to end."""
    USER = "smoke-phase25"

    # 1. Create a project with a client-supplied id (mirrors what the
    #    localStorage → backend backfill does in the frontend).
    r = client.post("/projects", json={
        "user_id":     USER,
        "name":        "Smoke Test SaaS",
        "description": "A test project for Phase 2.5 smoke testing.",
        "project_id":  "smoke-pid",
    })
    assert r.status_code == 201, r.text
    pid = r.json()["id"]
    assert pid == "smoke-pid"

    # 2. List → should contain it
    r = client.get("/projects", params={"user_id": USER})
    assert r.status_code == 200
    projects = r.json()["projects"]
    assert len(projects) == 1 and projects[0]["id"] == pid

    # 3. Add three kinds of memory (matches the modal options)
    for kind, content in [
        ("note",     "Targeting EU mid-market"),
        ("fact",     "Stack: Next.js + FastAPI"),
        ("decision", "Pricing: Free / $29 / $99"),
    ]:
        r = client.post(f"/projects/{pid}/memory", json={
            "content": content, "kind": kind, "source": "user",
        })
        assert r.status_code == 201, r.text
        assert r.json()["kind"] == kind
        assert r.json()["content"] == content

    # 4. Listed newest-first
    r = client.get(f"/projects/{pid}/memory")
    assert r.status_code == 200
    mem = r.json()["memory"]
    assert len(mem) == 3
    assert mem[0]["content"] == "Pricing: Free / $29 / $99"
    assert mem[2]["content"] == "Targeting EU mid-market"

    # 5. Bind an agent (mirrors what addProjectAgent does in the frontend)
    r = client.post(f"/projects/{pid}/agents", json={
        "agent_id":      "agent-smoke-1",
        "name":          "Backend Engineer",
        "role":          "backend",
        "system_prompt": "You design APIs.",
        "color":         "cyan",
        "icon":          "Server",
        "metadata":      {"specialty": "FastAPI"},
    })
    assert r.status_code == 201
    assert r.json()["id"] == "agent-smoke-1"

    # 6. Listed back
    r = client.get(f"/projects/{pid}/agents")
    assert r.status_code == 200
    agents = r.json()["agents"]
    assert len(agents) == 1 and agents[0]["name"] == "Backend Engineer"

    # 7. The same prompt fragment chat.py will inject when project_id is sent.
    from backend.services.projects.context import build_project_context_block
    blk = build_project_context_block(pid)
    assert blk is not None
    assert "Smoke Test SaaS" in blk
    assert "Pricing: Free / $29 / $99" in blk    # decision
    assert "Stack: Next.js + FastAPI" in blk      # fact
    assert "Targeting EU mid-market" in blk       # note
    # Newest-first ordering in the block
    assert blk.find("Pricing") < blk.find("Stack") < blk.find("Targeting")


def test_phase25_persists_after_reload(client):
    """Simulates the user reloading the browser — data must come back."""
    USER = "reload-user"
    # First "session": create + add memory
    r = client.post("/projects", json={
        "user_id": USER, "name": "Persistent Project",
        "description": "Should survive reload.",
        "project_id": "reload-pid",
    })
    assert r.status_code == 201
    pid = r.json()["id"]
    client.post(f"/projects/{pid}/memory", json={
        "content": "Key fact: built with KorvixAI", "kind": "fact",
    })
    client.post(f"/projects/{pid}/agents", json={
        "agent_id": "reload-agent", "name": "Researcher", "role": "research",
    })

    # "Reload" — re-import the route module so its in-process state
    # resets; the DB file stays. This is the closest simulation of a
    # fresh browser hitting the same backend deployment.
    importlib.reload(sys.modules["backend.routes.projects"])
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.routes import projects as p_route2
    app2 = FastAPI()
    app2.include_router(p_route2.router)
    client2 = TestClient(app2)

    # Everything still there
    r = client2.get("/projects", params={"user_id": USER})
    assert r.status_code == 200
    projects = r.json()["projects"]
    assert len(projects) == 1 and projects[0]["id"] == pid

    r = client2.get(f"/projects/{pid}/memory")
    assert any(m["content"] == "Key fact: built with KorvixAI" for m in r.json()["memory"])

    r = client2.get(f"/projects/{pid}/agents")
    assert any(a["id"] == "reload-agent" for a in r.json()["agents"])


def test_phase25_disabled_flag_returns_503(client, monkeypatch):
    """When ENABLE_PROJECTS is off the routes 503 cleanly — frontend
    listProjectMemory/addProjectMemory then return [] / null and the UI
    drops into 'Offline — local only' mode. No exceptions surface."""
    monkeypatch.setenv("ENABLE_PROJECTS", "false")
    r = client.get("/projects", params={"user_id": "x"})
    assert r.status_code == 503
    body = r.json()
    assert body["detail"]["error"] == "projects_disabled"


def test_phase25_cascading_delete(client):
    USER = "cascade-user"
    r = client.post("/projects", json={"user_id": USER, "name": "Disposable"})
    pid = r.json()["id"]
    client.post(f"/projects/{pid}/memory", json={"content": "to be deleted"})
    client.post(f"/projects/{pid}/agents", json={"name": "Dispose Agent"})

    r = client.delete(f"/projects/{pid}")
    assert r.status_code == 200 and r.json()["deleted"] is True

    # Hitting children must return empty / 404 — never leak orphans.
    r = client.get(f"/projects/{pid}")
    assert r.status_code == 404
    r = client.get(f"/projects/{pid}/memory")
    assert r.status_code == 404
    r = client.get(f"/projects/{pid}/agents")
    assert r.status_code == 404


def test_phase25_idempotent_backfill(client):
    """Creating the same project_id twice (the backfill case) must not
    duplicate or 500 — the frontend re-runs hydrateAndBackfill if it
    failed the first time, so we MUST tolerate retries."""
    body = {"user_id": "u-1", "name": "Imported", "project_id": "fixed-id"}
    r1 = client.post("/projects", json=body)
    r2 = client.post("/projects", json=body)
    assert r1.status_code == 201
    assert r2.status_code == 201
    # Only one row exists
    r = client.get("/projects", params={"user_id": "u-1"})
    assert len([p for p in r.json()["projects"] if p["id"] == "fixed-id"]) == 1
