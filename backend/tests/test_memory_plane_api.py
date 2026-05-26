# coding: utf-8
"""
Phase 6 — /v2/memory route tests.

Mirrors the v2_sessions test pattern: build the real production app
once per session, override the `current_user` dependency to swap in
synthetic users per test, isolate the SQLite file via the
`tmp_memory_plane_db` fixture.

Coverage:
  * Flag off → 503 envelope
  * Create / read / list / search / delete happy path
  * Cross-user access returns 404 (never 403, never the wrong content)
  * Project ownership enforced via sessions integration
  * Invalid body → 422 from Pydantic
"""
from __future__ import annotations

import pytest

from backend.core.deps import current_user
from backend.services.auth.identity import User


def _make_user(uid: str) -> User:
    return User(
        id=          uid,
        kind=        "guest",
        external_id= f"guest:{uid}",
        display_name="",
    )


@pytest.fixture()
def alice(app):
    user = _make_user("alice-uid")
    app.dependency_overrides[current_user] = lambda: user
    yield user
    app.dependency_overrides.pop(current_user, None)


@pytest.fixture()
def bob(app):
    user = _make_user("bob-uid")
    app.dependency_overrides[current_user] = lambda: user
    yield user
    app.dependency_overrides.pop(current_user, None)


# ── Feature gate ─────────────────────────────────────────────────────────────

def test_flag_off_returns_503(client, monkeypatch, alice):
    monkeypatch.setenv("ENABLE_MEMORY_PLANE", "false")
    r = client.post("/v2/memory", json={"content": "hello"})
    assert r.status_code == 503
    body = r.json()
    assert body["detail"]["code"] == "MEMORY_PLANE_DISABLED"


# ── Create + Read ────────────────────────────────────────────────────────────

def test_create_returns_envelope(client, tmp_memory_plane_db, alice):
    r = client.post("/v2/memory", json={
        "content": "I prefer concise answers",
        "kind":    "preference",
    })
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    mem = body["data"]["memory"]
    assert mem["content"] == "I prefer concise answers"
    assert mem["kind"] == "preference"
    assert mem["user_id"] == alice.id
    assert mem["id"]


def test_create_rejects_secret_content(client, tmp_memory_plane_db, alice):
    r = client.post("/v2/memory", json={
        "content": "save my password=hunter2 for later",
    })
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "MEMORY_REJECTED"


def test_create_invalid_body_returns_422(client, tmp_memory_plane_db, alice):
    r = client.post("/v2/memory", json={"content": ""})
    assert r.status_code == 422


def test_get_returns_record(client, tmp_memory_plane_db, alice):
    created = client.post("/v2/memory", json={"content": "remember me"}).json()
    rid = created["data"]["memory"]["id"]
    r = client.get(f"/v2/memory/{rid}")
    assert r.status_code == 200
    assert r.json()["data"]["memory"]["id"] == rid


def test_get_unknown_returns_404(client, tmp_memory_plane_db, alice):
    r = client.get("/v2/memory/does-not-exist")
    assert r.status_code == 404


# ── Cross-user isolation ─────────────────────────────────────────────────────

def test_cross_user_get_returns_404(client, tmp_memory_plane_db, app):
    # Alice creates a memory.
    alice = _make_user("alice-uid")
    app.dependency_overrides[current_user] = lambda: alice
    created = client.post("/v2/memory", json={"content": "alice secret"}).json()
    rid = created["data"]["memory"]["id"]
    # Bob tries to read it.
    bob = _make_user("bob-uid")
    app.dependency_overrides[current_user] = lambda: bob
    r = client.get(f"/v2/memory/{rid}")
    assert r.status_code == 404
    # Cleanup
    app.dependency_overrides.pop(current_user, None)


def test_cross_user_delete_returns_404(client, tmp_memory_plane_db, app):
    alice = _make_user("alice-uid")
    app.dependency_overrides[current_user] = lambda: alice
    created = client.post("/v2/memory", json={"content": "alice memo"}).json()
    rid = created["data"]["memory"]["id"]

    bob = _make_user("bob-uid")
    app.dependency_overrides[current_user] = lambda: bob
    r = client.delete(f"/v2/memory/{rid}")
    assert r.status_code == 404

    # And it's still there for alice.
    app.dependency_overrides[current_user] = lambda: alice
    r2 = client.get(f"/v2/memory/{rid}")
    assert r2.status_code == 200

    app.dependency_overrides.pop(current_user, None)


# ── List + filters ───────────────────────────────────────────────────────────

def test_list_returns_only_caller_rows(client, tmp_memory_plane_db, app):
    alice = _make_user("alice-uid")
    app.dependency_overrides[current_user] = lambda: alice
    client.post("/v2/memory", json={"content": "alice-1"})
    client.post("/v2/memory", json={"content": "alice-2"})

    bob = _make_user("bob-uid")
    app.dependency_overrides[current_user] = lambda: bob
    client.post("/v2/memory", json={"content": "bob-1"})
    r = client.get("/v2/memory").json()
    contents = [m["content"] for m in r["data"]["memories"]]
    assert contents == ["bob-1"]

    app.dependency_overrides.pop(current_user, None)


def test_list_kind_filter(client, tmp_memory_plane_db, alice):
    client.post("/v2/memory", json={"content": "a", "kind": "fact"})
    client.post("/v2/memory", json={"content": "b", "kind": "preference"})
    r = client.get("/v2/memory?kind=preference").json()
    kinds = [m["kind"] for m in r["data"]["memories"]]
    assert kinds == ["preference"]


def test_list_pagination_metadata(client, tmp_memory_plane_db, alice):
    for i in range(5):
        client.post("/v2/memory", json={"content": f"row {i}"})
    r = client.get("/v2/memory?limit=2&offset=1").json()
    assert r["metadata"]["limit"] == 2
    assert r["metadata"]["offset"] == 1
    assert len(r["data"]["memories"]) == 2


# ── Search ───────────────────────────────────────────────────────────────────

def test_search_returns_relevant_first(client, tmp_memory_plane_db, alice):
    client.post("/v2/memory", json={"content": "deploy to Vercel via PR"})
    client.post("/v2/memory", json={"content": "draft a new blog post"})
    r = client.get("/v2/memory/search?q=vercel").json()
    assert r["success"] is True
    contents = [m["content"] for m in r["data"]["memories"]]
    assert contents and "Vercel" in contents[0]


# ── Delete happy path ────────────────────────────────────────────────────────

def test_delete_then_get_returns_404(client, tmp_memory_plane_db, alice):
    rid = client.post("/v2/memory", json={"content": "bye"}).json()["data"]["memory"]["id"]
    r = client.delete(f"/v2/memory/{rid}")
    assert r.status_code == 200
    assert r.json()["data"]["deleted_id"] == rid
    r2 = client.get(f"/v2/memory/{rid}")
    assert r2.status_code == 404


# ── Project ownership integration ────────────────────────────────────────────

def test_project_filter_requires_owned_workspace(client, tmp_memory_plane_db, tmp_sessions_db, app):
    """When the caller passes project_id, the route must reject access
    to projects belonging to other users."""
    from backend.services.sessions import client as sessions_client

    # Alice owns workspace W.
    alice = _make_user("alice-uid")
    app.dependency_overrides[current_user] = lambda: alice
    ws = sessions_client.create_workspace(alice.id, name="A", kind="personal")

    # Bob tries to create a memory inside Alice's workspace.
    bob = _make_user("bob-uid")
    app.dependency_overrides[current_user] = lambda: bob
    r = client.post("/v2/memory", json={
        "content":    "bob trying to leak into alice's project",
        "project_id": ws.id,
    })
    assert r.status_code == 404
    app.dependency_overrides.pop(current_user, None)


def test_project_filter_allows_owned_workspace(client, tmp_memory_plane_db, tmp_sessions_db, app):
    from backend.services.sessions import client as sessions_client
    alice = _make_user("alice-uid")
    app.dependency_overrides[current_user] = lambda: alice
    ws = sessions_client.create_workspace(alice.id, name="A", kind="personal")
    r = client.post("/v2/memory", json={
        "content":    "alice ok",
        "project_id": ws.id,
    })
    assert r.status_code == 200
    mem = r.json()["data"]["memory"]
    assert mem["project_id"] == ws.id

    # List via /v2/memory/project/{id} should return it.
    r2 = client.get(f"/v2/memory/project/{ws.id}")
    assert r2.status_code == 200
    assert len(r2.json()["data"]["memories"]) == 1

    app.dependency_overrides.pop(current_user, None)


# ── Diagnostic endpoint ──────────────────────────────────────────────────────

def test_diagnostic_endpoint_returns_stats(client, tmp_memory_plane_db, alice):
    r = client.get("/v2/memory/health/diagnostic")
    assert r.status_code == 200
    body = r.json()
    assert body["data"]["enabled"] is True
    assert "tables" in body["data"]
    assert "fact" in body["metadata"]["kinds_supported"]
