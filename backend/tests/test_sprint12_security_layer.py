# coding: utf-8
"""Sprint 1.2 — Production Security Layer regression tests.

Covers: centralized Principal + permission model, verified-JWT identity,
invalid/expired/forged token handling, guest isolation, owner permissions,
background-worker context, SSE scope ownership, and project/session
cross-user ownership.
"""
import importlib
import os
import sys
import tempfile
import types

import pytest


# ── helpers ───────────────────────────────────────────────────────────────

class _FakeHeaders(dict):
    def get(self, key, default=None):
        return super().get(key.lower(), default)


def _req(headers=None, state_uid=None):
    r = types.SimpleNamespace()
    r.headers = _FakeHeaders({k.lower(): v for k, v in (headers or {}).items()})
    r.state = types.SimpleNamespace()
    if state_uid is not None:
        r.state.user_id = state_uid
    return r


def _token(sub, ttl_seconds=3600):
    from backend.services.auth import tokens
    tok, _ = tokens.issue(sub=sub, token_type="access", ttl_seconds=ttl_seconds)
    return tok


def _bearer(sub, ttl_seconds=3600):
    return {"Authorization": f"Bearer {_token(sub, ttl_seconds)}"}


# ════════════════════════════════════════════════════════════════════════
# 1. Principal model + permission levels
# ════════════════════════════════════════════════════════════════════════

def test_principal_kinds_and_predicates(monkeypatch):
    monkeypatch.setenv("JWT_SECRET_KEY", "x" * 40)
    from backend.core.principal import resolve_principal, PrincipalKind
    # anonymous → guest
    p = resolve_principal(_req())
    assert p.kind is PrincipalKind.GUEST and p.is_guest and not p.is_authenticated
    # guest nonce
    p = resolve_principal(_req(headers={"X-Korvix-Guest-Id": "g-1"}))
    assert p.kind is PrincipalKind.GUEST and p.user_id == "g-1"
    # verified user
    p = resolve_principal(_req(headers=_bearer("u-7")))
    assert p.kind is PrincipalKind.USER and p.is_authenticated and not p.is_owner


def test_owner_principal_via_identity(monkeypatch):
    monkeypatch.setenv("JWT_SECRET_KEY", "x" * 40)
    monkeypatch.setenv("ENABLE_ADMIN_MODE", "true")  # owner detection is admin-mode gated
    fd, path = tempfile.mkstemp(suffix="-owner.db"); os.close(fd)
    monkeypatch.setenv("AUTH_DB_PATH", path)
    from backend.services.auth import storage
    monkeypatch.setattr(storage, "_INITIALIZED", False, raising=False)
    # Register an identity-store user and make OWNER_ID match its external_id.
    u = storage.get_or_create_user(kind="google", external_id="owner-sub",
                                   display_name="Boss")
    monkeypatch.setenv("OWNER_ID", "owner-sub")
    from backend.core.principal import resolve_principal, PrincipalKind
    p = resolve_principal(_req(headers=_bearer(u.id)))
    assert p.kind is PrincipalKind.OWNER and p.is_owner and p.is_authenticated
    try: os.unlink(path)
    except FileNotFoundError: pass


def test_owner_principal_via_token(monkeypatch):
    # Token-unlock owner path (no DB user needed): guest + valid OWNER_TOKEN
    # + admin mode → OWNER principal.
    monkeypatch.setenv("ENABLE_ADMIN_MODE", "true")
    monkeypatch.setenv("OWNER_TOKEN", "owner-secret-token-1234567890")
    from backend.core.principal import resolve_principal, PrincipalKind
    p = resolve_principal(_req(headers={"X-Korvix-Owner-Token": "owner-secret-token-1234567890"}))
    assert p.kind is PrincipalKind.OWNER and p.is_owner


def test_forged_and_expired_tokens_are_not_trusted(monkeypatch):
    monkeypatch.setenv("JWT_SECRET_KEY", "x" * 40)
    from backend.core.principal import resolve_principal, PrincipalKind
    # forged signature
    import base64, json
    def b64(d): return base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()
    forged = ".".join([b64({"alg": "HS256"}), b64({"sub": "victim"}), "nope"])
    p = resolve_principal(_req(headers={"Authorization": f"Bearer {forged}"}))
    assert p.kind is PrincipalKind.GUEST and p.user_id != "victim"
    # expired token (exp in the past)
    expired = _token("victim", ttl_seconds=-30)
    p = resolve_principal(_req(headers={"Authorization": f"Bearer {expired}"}))
    assert p.kind is PrincipalKind.GUEST and p.user_id != "victim"


def test_owns_user_and_scope_rules(monkeypatch):
    monkeypatch.setenv("JWT_SECRET_KEY", "x" * 40)
    from backend.core.principal import resolve_principal
    user = resolve_principal(_req(headers=_bearer("alice")))
    assert user.owns_user("alice") and not user.owns_user("bob")
    assert user.may_access_scope("user:alice")
    assert not user.may_access_scope("user:bob")
    assert not user.may_access_scope("*")          # wildcard owner-only
    # project scope requires owning the project (lookup)
    assert user.may_access_scope("project:p1", project_owner_lookup=lambda _: "alice")
    assert not user.may_access_scope("project:p1", project_owner_lookup=lambda _: "bob")
    assert not user.may_access_scope("project:p1")  # no lookup → deny


def test_system_and_worker_principals():
    from backend.core.principal import system_principal, worker_principal, PrincipalKind
    s = system_principal("maintenance")
    assert s.kind is PrincipalKind.INTERNAL and s.owns_user("anyone") and s.may_access_scope("*")
    w = worker_principal("u-42")
    assert w.kind is PrincipalKind.WORKER
    assert w.effective_user_id == "u-42"
    assert w.owns_user("u-42") and not w.owns_user("u-99")  # never crosses users
    assert not w.may_access_scope("*")                       # not an owner


def test_resolve_uid_and_source_labels(monkeypatch):
    monkeypatch.setenv("JWT_SECRET_KEY", "x" * 40)
    from backend.core.deps import resolve_uid_and_source
    assert resolve_uid_and_source(_req(headers=_bearer("u-1")))[1] == "jwt"
    assert resolve_uid_and_source(_req(headers={"X-Korvix-Guest-Id": "g"}))[1] == "guest-header"
    assert resolve_uid_and_source(_req(), "body-id")[1] == "body"
    assert resolve_uid_and_source(_req())[1] == "anonymous"
    assert resolve_uid_and_source(_req(state_uid="mw-user"))[1] == "middleware"


# ════════════════════════════════════════════════════════════════════════
# 2. SSE scope ownership (HTTP-level deny paths)
# ════════════════════════════════════════════════════════════════════════

@pytest.fixture
def events_client(monkeypatch):
    monkeypatch.setenv("ENABLE_REALTIME_EVENTS", "true")
    monkeypatch.setenv("JWT_SECRET_KEY", "x" * 40)
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.routes import v2_events
    app = FastAPI()
    app.include_router(v2_events.router)
    return TestClient(app)


def test_sse_anonymous_denied(events_client):
    assert events_client.get("/v2/events/stream?scope=project:x").status_code == 403
    assert events_client.get("/v2/events/stream?scope=user:victim").status_code == 403


def test_sse_user_cannot_subscribe_other_or_wildcard(events_client):
    h = _bearer("u-1")
    assert events_client.get("/v2/events/stream?scope=user:victim", headers=h).status_code == 403
    assert events_client.get("/v2/events/stream?scope=*", headers=h).status_code == 403
    assert events_client.get("/v2/events/stream?scope=project:not-mine", headers=h).status_code == 403


def test_sse_disabled_returns_503(monkeypatch):
    monkeypatch.setenv("ENABLE_REALTIME_EVENTS", "false")
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.routes import v2_events
    app = FastAPI(); app.include_router(v2_events.router)
    c = TestClient(app)
    assert c.get("/v2/events/stream?scope=user:u-1", headers=_bearer("u-1")).status_code == 503


# ════════════════════════════════════════════════════════════════════════
# 3. Project ownership (cross-user blocked)
# ════════════════════════════════════════════════════════════════════════

@pytest.fixture
def projects_client(monkeypatch):
    fd, path = tempfile.mkstemp(suffix="-sec-projects.db"); os.close(fd)
    monkeypatch.setenv("PROJECTS_DB_PATH", path)
    monkeypatch.setenv("ENABLE_PROJECTS", "true")
    monkeypatch.setenv("JWT_SECRET_KEY", "x" * 40)
    for m in ("backend.services.projects.store", "backend.routes.projects"):
        if m in sys.modules:
            importlib.reload(sys.modules[m])
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.services.projects import store as pstore
    pstore.init()
    from backend.routes import projects as p_route
    app = FastAPI(); app.include_router(p_route.router)
    yield TestClient(app)
    try: os.unlink(path)
    except FileNotFoundError: pass


def test_project_authenticated_cross_user_blocked(projects_client):
    # Alice (verified) creates a project.
    r = projects_client.post("/projects", headers=_bearer("alice"),
                             json={"user_id": "alice", "name": "Alice proj"})
    assert r.status_code == 201
    pid = r.json()["id"]
    assert r.json()["owner_user_id"] == "alice"
    # Mallory (verified, different) cannot read/update/delete it.
    assert projects_client.get(f"/projects/{pid}", headers=_bearer("mallory")).status_code == 404
    assert projects_client.patch(f"/projects/{pid}", headers=_bearer("mallory"),
                                 json={"name": "hijack"}).status_code == 404
    assert projects_client.delete(f"/projects/{pid}", headers=_bearer("mallory")).status_code == 404
    # Owner reads fine.
    assert projects_client.get(f"/projects/{pid}", headers=_bearer("alice")).status_code == 200


def test_project_create_cannot_spoof_owner_via_body(projects_client):
    # Verified alice, but body claims bob → project owned by alice.
    r = projects_client.post("/projects", headers=_bearer("alice"),
                             json={"user_id": "bob", "name": "P"})
    assert r.status_code == 201
    assert r.json()["owner_user_id"] == "alice"


def test_project_authenticated_list_scoped_to_self(projects_client):
    projects_client.post("/projects", headers=_bearer("alice"),
                         json={"user_id": "alice", "name": "A"})
    # Mallory asking to list alice's projects only sees her own (none).
    r = projects_client.get("/projects?user_id=alice", headers=_bearer("mallory"))
    assert r.status_code == 200
    assert all(p["owner_user_id"] != "alice" for p in r.json()["projects"])


def test_project_memory_cross_user_blocked(projects_client):
    r = projects_client.post("/projects", headers=_bearer("alice"),
                             json={"user_id": "alice", "name": "A"})
    pid = r.json()["id"]
    projects_client.post(f"/projects/{pid}/memory", headers=_bearer("alice"),
                         json={"content": "secret note"})
    # Mallory cannot read or write alice's project memory.
    assert projects_client.get(f"/projects/{pid}/memory", headers=_bearer("mallory")).status_code == 404
    assert projects_client.post(f"/projects/{pid}/memory", headers=_bearer("mallory"),
                                json={"content": "x"}).status_code == 404


def test_project_guest_legacy_preserved(projects_client):
    # A header-less (anonymous) client keeps the legacy contract so the
    # current frontend (which sends no auth header on project calls) works.
    r = projects_client.post("/projects", json={"user_id": "guest-xyz", "name": "G"})
    assert r.status_code == 201
    pid = r.json()["id"]
    assert projects_client.get(f"/projects/{pid}").status_code == 200


# ════════════════════════════════════════════════════════════════════════
# 4. Legacy session ownership (cross-user blocked)
# ════════════════════════════════════════════════════════════════════════

@pytest.fixture
def sessions_client(monkeypatch):
    fd, path = tempfile.mkstemp(suffix="-sec-sessions.db"); os.close(fd)
    monkeypatch.setenv("SESSIONS_DB_PATH", path)
    monkeypatch.setenv("ENABLE_SESSIONS", "true")
    monkeypatch.setenv("JWT_SECRET_KEY", "x" * 40)
    from backend.services.sessions import store as sstore
    monkeypatch.setattr(sstore, "DB_PATH", path, raising=False)
    monkeypatch.setattr(sstore, "_INITIALIZED", False, raising=False)
    sstore.init()
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.routes import sessions as s_route
    app = FastAPI(); app.include_router(s_route.router)
    yield TestClient(app)
    try: os.unlink(path)
    except FileNotFoundError: pass


def test_session_workspace_cross_user_blocked(sessions_client):
    r = sessions_client.post("/sessions/workspaces", headers=_bearer("alice"),
                             json={"user_id": "alice", "name": "WS"})
    assert r.status_code == 201
    wid = r.json()["id"]
    # Mallory can't read alice's workspace or its threads.
    assert sessions_client.get(f"/sessions/workspaces/{wid}", headers=_bearer("mallory")).status_code == 404
    assert sessions_client.get(f"/sessions/workspaces/{wid}/threads", headers=_bearer("mallory")).status_code == 404
    # Owner can.
    assert sessions_client.get(f"/sessions/workspaces/{wid}", headers=_bearer("alice")).status_code == 200


def test_session_thread_message_chain_ownership(sessions_client):
    wid = sessions_client.post("/sessions/workspaces", headers=_bearer("alice"),
                               json={"user_id": "alice", "name": "WS"}).json()["id"]
    tid = sessions_client.post(f"/sessions/workspaces/{wid}/threads", headers=_bearer("alice"),
                               json={"title": "T"}).json()["id"]
    # Mallory blocked at thread + messages level (inherited ownership).
    assert sessions_client.get(f"/sessions/threads/{tid}", headers=_bearer("mallory")).status_code == 404
    assert sessions_client.get(f"/sessions/threads/{tid}/messages", headers=_bearer("mallory")).status_code == 404
    assert sessions_client.get(f"/sessions/threads/{tid}/messages", headers=_bearer("alice")).status_code == 200
