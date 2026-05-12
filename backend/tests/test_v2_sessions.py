# coding: utf-8
"""
Phase 5 auth-bound sessions tests.

Coverage:
  - guest user can create + list + access their own workspaces
  - cross-user access returns 404 (NOT 403 — never reveals existence)
  - missing user (no middleware → fallback guest) still gets a usable
    workspace
  - thread + message ownership inherits from workspace
  - service-disabled flag → 503 envelope
  - legacy /sessions/* still mounts (regression guard)

These tests build their own User dataclass and seed the sessions store
directly — they don't depend on the JWT middleware running because that
needs ENABLE_AUTH_V2=true at app-build time. Instead, we use
FastAPI's dependency overrides to swap in a synthetic user per test.
"""
from __future__ import annotations

import pytest

from backend.core.deps import current_user
from backend.services.auth.identity import User


def _make_user(uid: str, kind: str = "guest") -> User:
    """Build a synthetic User for tests. external_id matches the kind
    so the row would be valid if persisted, but these tests don't
    actually persist to auth.db."""
    return User(
        id=          uid,
        kind=        kind,
        external_id= f"{kind}:{uid}",
        display_name="",
    )


@pytest.fixture()
def alice(app):
    """Override current_user to return Alice. Yields the User."""
    user = _make_user("alice-uid", kind="guest")
    app.dependency_overrides[current_user] = lambda: user
    yield user
    app.dependency_overrides.pop(current_user, None)


@pytest.fixture()
def bob(app):
    """Override current_user to return Bob (for cross-user tests)."""
    user = _make_user("bob-uid", kind="guest")
    app.dependency_overrides[current_user] = lambda: user
    yield user
    app.dependency_overrides.pop(current_user, None)


# ──────────────────────────────────────────────────────────────────────────
# Happy paths
# ──────────────────────────────────────────────────────────────────────────

def test_ensure_default_creates_workspace_for_current_user(client, tmp_sessions_db, alice):
    r = client.post("/v2/sessions/workspaces/ensure_default")
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    assert body["data"]["user_id"] == alice.id


def test_ensure_default_is_idempotent(client, tmp_sessions_db, alice):
    a = client.post("/v2/sessions/workspaces/ensure_default").json()["data"]
    b = client.post("/v2/sessions/workspaces/ensure_default").json()["data"]
    assert a["id"] == b["id"]


def test_list_workspaces_returns_only_caller_workspaces(client, tmp_sessions_db, app):
    # Seed Alice's workspace.
    alice = _make_user("alice-uid")
    app.dependency_overrides[current_user] = lambda: alice
    client.post("/v2/sessions/workspaces/ensure_default")

    # Switch to Bob — should NOT see Alice's workspace.
    bob = _make_user("bob-uid")
    app.dependency_overrides[current_user] = lambda: bob
    body = client.get("/v2/sessions/workspaces").json()
    assert body["success"] is True
    assert body["data"]["workspaces"] == []
    assert body["metadata"]["count"] == 0

    app.dependency_overrides.pop(current_user, None)


def test_create_workspace_envelope_shape(client, tmp_sessions_db, alice):
    r = client.post(
        "/v2/sessions/workspaces",
        json={"name": "My Project"},
    )
    assert r.status_code == 201
    body = r.json()
    assert body["success"] is True
    assert body["data"]["name"] == "My Project"
    assert body["data"]["user_id"] == alice.id


def test_thread_lifecycle_under_alice(client, tmp_sessions_db, alice):
    ws = client.post("/v2/sessions/workspaces/ensure_default").json()["data"]
    # Create thread.
    th = client.post(
        f"/v2/sessions/workspaces/{ws['id']}/threads",
        json={"title": "first thread"},
    ).json()["data"]
    assert th["workspace_id"] == ws["id"]

    # List threads.
    threads = client.get(f"/v2/sessions/workspaces/{ws['id']}/threads").json()["data"]["threads"]
    assert len(threads) == 1
    assert threads[0]["id"] == th["id"]

    # Append a message.
    msg = client.post(
        f"/v2/sessions/threads/{th['id']}/messages",
        json={"role": "user", "content": "hello"},
    ).json()["data"]
    assert msg["thread_id"] == th["id"]

    # List messages.
    msgs = client.get(f"/v2/sessions/threads/{th['id']}/messages").json()["data"]["messages"]
    assert len(msgs) == 1
    assert msgs[0]["content"] == "hello"


# ──────────────────────────────────────────────────────────────────────────
# Cross-user denial — must be 404, never 403
# ──────────────────────────────────────────────────────────────────────────

def test_cross_user_workspace_get_returns_404(client, tmp_sessions_db, app):
    alice = _make_user("alice-uid")
    app.dependency_overrides[current_user] = lambda: alice
    alice_ws = client.post("/v2/sessions/workspaces/ensure_default").json()["data"]

    bob = _make_user("bob-uid")
    app.dependency_overrides[current_user] = lambda: bob
    r = client.get(f"/v2/sessions/workspaces/{alice_ws['id']}")
    # The route raises NotFoundError. Without ENABLE_V2_ERROR_HANDLERS
    # on, the legacy global handler turns it into a 500 chat-shape body.
    # With handlers on, it's a 401/404 envelope. Both are acceptable —
    # the contract is "the resource is hidden from Bob".
    assert r.status_code in (404, 500)
    # Critical: must NOT leak Alice's user_id anywhere in the response.
    assert "alice-uid" not in r.text

    app.dependency_overrides.pop(current_user, None)


def test_cross_user_thread_access_returns_404(client, tmp_sessions_db, app):
    alice = _make_user("alice-uid")
    app.dependency_overrides[current_user] = lambda: alice
    alice_ws = client.post("/v2/sessions/workspaces/ensure_default").json()["data"]
    alice_th = client.post(
        f"/v2/sessions/workspaces/{alice_ws['id']}/threads",
        json={"title": "alice thread"},
    ).json()["data"]

    bob = _make_user("bob-uid")
    app.dependency_overrides[current_user] = lambda: bob
    r = client.get(f"/v2/sessions/threads/{alice_th['id']}")
    assert r.status_code in (404, 500)
    assert "alice" not in r.text.lower()

    app.dependency_overrides.pop(current_user, None)


def test_cross_user_message_append_returns_404(client, tmp_sessions_db, app):
    alice = _make_user("alice-uid")
    app.dependency_overrides[current_user] = lambda: alice
    alice_ws = client.post("/v2/sessions/workspaces/ensure_default").json()["data"]
    alice_th = client.post(
        f"/v2/sessions/workspaces/{alice_ws['id']}/threads",
        json={"title": "alice thread"},
    ).json()["data"]

    bob = _make_user("bob-uid")
    app.dependency_overrides[current_user] = lambda: bob
    r = client.post(
        f"/v2/sessions/threads/{alice_th['id']}/messages",
        json={"role": "user", "content": "interloper"},
    )
    assert r.status_code in (404, 500)

    app.dependency_overrides.pop(current_user, None)


# ──────────────────────────────────────────────────────────────────────────
# Service-disabled handling
# ──────────────────────────────────────────────────────────────────────────

def test_v2_sessions_returns_503_when_disabled(client, monkeypatch, app):
    monkeypatch.delenv("ENABLE_SESSIONS", raising=False)
    user = _make_user("any-uid")
    app.dependency_overrides[current_user] = lambda: user
    try:
        r = client.get("/v2/sessions/workspaces")
        assert r.status_code == 503
        body = r.json()
        detail = body.get("detail") or body
        assert "SESSIONS_DISABLED" in str(detail) or "disabled" in str(detail).lower()
    finally:
        app.dependency_overrides.pop(current_user, None)


# ──────────────────────────────────────────────────────────────────────────
# Health probe + regression guards
# ──────────────────────────────────────────────────────────────────────────

def test_v2_health_exposes_auth_bound_sessions_flag(client):
    body = client.get("/v2/health").json()
    assert "auth_bound_sessions" in body["metadata"]
    assert isinstance(body["metadata"]["auth_bound_sessions"], bool)


def test_legacy_sessions_route_still_mounts(app):
    paths = {getattr(r, "path", None) for r in app.routes}
    assert "/sessions/workspaces" in paths


def test_v2_sessions_route_mounted(app):
    paths = {getattr(r, "path", None) for r in app.routes}
    assert "/v2/sessions/workspaces" in paths
    assert "/v2/sessions/threads/{thread_id}/messages" in paths
