# coding: utf-8
"""Sprint 1.1 — Production Foundation Hardening regression tests.

Covers the four hardening changes:
  1. Persistence path resolution (backend/core/paths.py) — durable-volume
     support with strict backward-compatible precedence.
  2. Config startup self-check (settings.validate_runtime()).
  3. Authoritative identity resolution shared by /chat + /v2/orchestrate —
     body.user_id can never override an authenticated identity.
  4. Legacy IDOR routes (/memory, /profile) now ownership-enforced + the
     ENABLE_LEGACY_USER_ROUTES kill-switch.
"""
import importlib
import os
import sys
import tempfile
import types

import pytest


# ════════════════════════════════════════════════════════════════════════
# 1. Persistence path resolution
# ════════════════════════════════════════════════════════════════════════

def test_resolve_db_path_default_is_legacy(monkeypatch):
    from backend.core import paths
    monkeypatch.delenv("KORVIX_DATA_DIR", raising=False)
    monkeypatch.delenv("RAILWAY_VOLUME_MOUNT_PATH", raising=False)
    monkeypatch.delenv("JOBS_DB_PATH", raising=False)
    assert paths.resolve_db_path("jobs.db", "JOBS_DB_PATH") == "jobs.db"
    assert paths.persistence_is_durable() is False


def test_resolve_db_path_explicit_env_always_wins(monkeypatch, tmp_path):
    from backend.core import paths
    monkeypatch.setenv("KORVIX_DATA_DIR", str(tmp_path))   # durable dir set...
    monkeypatch.setenv("JOBS_DB_PATH", "/explicit/abs.db")  # ...but env wins
    assert paths.resolve_db_path("jobs.db", "JOBS_DB_PATH") == "/explicit/abs.db"


def test_resolve_db_path_uses_data_dir(monkeypatch, tmp_path):
    from backend.core import paths
    monkeypatch.delenv("JOBS_DB_PATH", raising=False)
    monkeypatch.setenv("KORVIX_DATA_DIR", str(tmp_path))
    assert paths.resolve_db_path("jobs.db", "JOBS_DB_PATH") == os.path.join(str(tmp_path), "jobs.db")
    assert paths.persistence_is_durable() is True


def test_resolve_db_path_railway_volume_fallback(monkeypatch, tmp_path):
    from backend.core import paths
    monkeypatch.delenv("KORVIX_DATA_DIR", raising=False)
    monkeypatch.delenv("MEMORY_PLANE_DB_PATH", raising=False)
    monkeypatch.setenv("RAILWAY_VOLUME_MOUNT_PATH", str(tmp_path))
    got = paths.resolve_db_path("memory_plane.db", "MEMORY_PLANE_DB_PATH")
    assert got == os.path.join(str(tmp_path), "memory_plane.db")
    summary = paths.persistence_summary()
    assert summary["durable"] is True
    assert summary["source"] == "RAILWAY_VOLUME_MOUNT_PATH"


def test_stores_follow_data_dir(monkeypatch, tmp_path):
    """A store with no explicit env var picks up the data dir at call time."""
    monkeypatch.delenv("JOBS_DB_PATH", raising=False)
    monkeypatch.setenv("KORVIX_DATA_DIR", str(tmp_path))
    js = importlib.import_module("backend.services.jobs.store")
    assert js._db_path() == os.path.join(str(tmp_path), "jobs.db")


# ════════════════════════════════════════════════════════════════════════
# 2. Config startup self-check
# ════════════════════════════════════════════════════════════════════════

def test_validate_runtime_flags_ephemeral_persistence_in_prod(monkeypatch):
    from backend.core.config import settings
    monkeypatch.delenv("KORVIX_DATA_DIR", raising=False)
    monkeypatch.delenv("RAILWAY_VOLUME_MOUNT_PATH", raising=False)
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")
    monkeypatch.setattr(settings, "ENABLE_JOB_QUEUE", True)  # stateful subsystem on
    issues = settings.validate_runtime()
    crit = [m for lvl, m in issues if lvl == "critical"]
    assert any("EPHEMERAL" in m for m in crit), issues


def test_validate_runtime_clean_when_durable(monkeypatch, tmp_path):
    from backend.core.config import settings
    monkeypatch.setenv("KORVIX_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")
    monkeypatch.delenv("ENABLE_AUTH_V2", raising=False)
    issues = settings.validate_runtime()
    # No persistence criticals when a durable data dir is configured.
    assert not any(lvl == "critical" and "EPHEMERAL" in m for lvl, m in issues)


def test_validate_runtime_flags_missing_jwt_when_auth_on(monkeypatch):
    from backend.core.config import settings
    monkeypatch.setenv("ENABLE_AUTH_V2", "true")
    monkeypatch.setattr(settings, "JWT_SECRET_KEY", "")
    issues = settings.validate_runtime()
    assert any(lvl == "critical" and "JWT_SECRET_KEY" in m for lvl, m in issues)


# ════════════════════════════════════════════════════════════════════════
# 3. Authoritative identity resolution
# ════════════════════════════════════════════════════════════════════════

class _FakeHeaders(dict):
    def get(self, key, default=None):
        return super().get(key.lower(), default)


def _fake_request(headers=None, state_uid=None, state_is_guest=None):
    req = types.SimpleNamespace()
    req.headers = _FakeHeaders({k.lower(): v for k, v in (headers or {}).items()})
    req.state = types.SimpleNamespace()
    if state_uid is not None:
        req.state.user_id = state_uid
    if state_is_guest is not None:
        req.state.is_guest = state_is_guest
    return req


def test_resolve_uid_prefers_middleware_state():
    from backend.core.deps import resolve_authoritative_uid
    req = _fake_request(state_uid="user-from-mw")
    assert resolve_authoritative_uid(req, "body-id") == "user-from-mw"


def test_resolve_uid_guest_header_over_body():
    from backend.core.deps import resolve_authoritative_uid
    req = _fake_request(headers={"X-Korvix-Guest-Id": "guest-123"})
    assert resolve_authoritative_uid(req, "body-id") == "guest-123"


def test_resolve_uid_body_only_as_last_resort():
    from backend.core.deps import resolve_authoritative_uid
    req = _fake_request()
    assert resolve_authoritative_uid(req, "body-id") == "body-id"
    assert resolve_authoritative_uid(req, "") == "anonymous"


def test_resolve_uid_valid_bearer_overrides_body(monkeypatch):
    monkeypatch.setenv("JWT_SECRET_KEY", "x" * 40)
    from backend.services.auth import tokens
    tok, _ = tokens.issue(sub="victim-sub", token_type="access", ttl_seconds=3600)
    from backend.core.deps import resolve_authoritative_uid
    req = _fake_request(headers={"Authorization": f"Bearer {tok}"})
    # body says "attacker" but the verified token subject wins — this is
    # the core anti-impersonation guarantee.
    assert resolve_authoritative_uid(req, "attacker") == "victim-sub"


def test_resolve_uid_guest_beats_bad_bearer(monkeypatch):
    monkeypatch.setenv("JWT_SECRET_KEY", "x" * 40)
    from backend.core.deps import resolve_authoritative_uid
    # A bad/expired token does NOT win; the request degrades to the guest
    # nonce (NOT the body id) when a guest header is present.
    req = _fake_request(headers={
        "Authorization": "Bearer not-a-real-token",
        "X-Korvix-Guest-Id": "g-9",
    })
    assert resolve_authoritative_uid(req, "attacker") == "g-9"


def test_orchestrate_guest_state_is_not_verified_identity():
    from backend.routes.v2_orchestrate import _has_verified_identity
    req = _fake_request(state_uid="guest-db-user", state_is_guest=True)
    assert _has_verified_identity(req) is False


# ════════════════════════════════════════════════════════════════════════
# 4. Legacy IDOR routes — ownership enforcement + kill-switch
# ════════════════════════════════════════════════════════════════════════

@pytest.fixture
def legacy_client():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.routes import memory as mem_route
    from backend.routes import profile as prof_route
    app = FastAPI()
    app.include_router(mem_route.router)
    app.include_router(prof_route.router)
    return TestClient(app)


def test_legacy_memory_unauth_cross_user_denied(legacy_client):
    # No auth context → caller resolves to "anonymous" → cannot read uid 123.
    assert legacy_client.get("/memory/123").status_code == 403
    assert legacy_client.post("/memory", json={"user_id": "victim", "content": "x"}).status_code == 403
    assert legacy_client.request("DELETE", "/memory",
                                 json={"user_id": "victim", "keyword": "x"}).status_code == 403


def test_legacy_profile_unauth_cross_user_denied(legacy_client):
    assert legacy_client.get("/profile/777").status_code == 403


def test_legacy_memory_guest_self_access_allowed(legacy_client):
    # A guest presenting their own nonce may read their own memory.
    r = legacy_client.get("/memory/g-self", headers={"X-Korvix-Guest-Id": "g-self"})
    assert r.status_code == 200
    # ...but not someone else's.
    r2 = legacy_client.get("/memory/other", headers={"X-Korvix-Guest-Id": "g-self"})
    assert r2.status_code == 403


def test_legacy_owner_token_can_access_any(legacy_client, monkeypatch):
    # Owner-token unlock requires admin mode to be on (owner.match_owner_token).
    monkeypatch.setenv("ENABLE_ADMIN_MODE", "true")
    monkeypatch.setenv("OWNER_TOKEN", "owner-secret-token-1234567890")
    r = legacy_client.get("/memory/anybody",
                          headers={"X-Korvix-Owner-Token": "owner-secret-token-1234567890"})
    assert r.status_code == 200


def test_legacy_killswitch_returns_410(legacy_client, monkeypatch):
    # Patch the settings object the ROUTE modules actually reference. Other
    # tests in the suite reload backend.core.config, so the route-bound
    # settings singleton may differ from a fresh `from ... import settings`.
    from backend.routes import memory as mem_route
    from backend.routes import profile as prof_route
    monkeypatch.setattr(mem_route.settings, "ENABLE_LEGACY_USER_ROUTES", False)
    monkeypatch.setattr(prof_route.settings, "ENABLE_LEGACY_USER_ROUTES", False)
    assert legacy_client.get("/memory/g-self",
                             headers={"X-Korvix-Guest-Id": "g-self"}).status_code == 410
    assert legacy_client.get("/profile/g-self",
                             headers={"X-Korvix-Guest-Id": "g-self"}).status_code == 410


# ════════════════════════════════════════════════════════════════════════
# 5. /v2/orchestrate identity (integration)
# ════════════════════════════════════════════════════════════════════════

@pytest.fixture
def orchestrate_client(monkeypatch):
    fd, path = tempfile.mkstemp(suffix="-sprint11.db")
    os.close(fd)
    monkeypatch.setenv("PROJECTS_DB_PATH", path)
    monkeypatch.setenv("ENABLE_ORCHESTRATOR", "true")
    monkeypatch.setenv("JWT_SECRET_KEY", "x" * 40)
    for m in (
        "backend.services.orchestrator.runs_store",
        "backend.services.orchestrator.tasks_store",
        "backend.services.orchestrator",
        "backend.routes.v2_orchestrate",
    ):
        if m in sys.modules:
            importlib.reload(sys.modules[m])
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.services.orchestrator import init_runs_table, init_tasks_table
    init_runs_table()
    init_tasks_table()

    from backend.routes import v2_orchestrate as o_route
    from backend.services.agent.types import AgentResponse

    async def _stub(req):
        return AgentResponse(reply="ok", mode=req.mode, model=req.model)
    monkeypatch.setattr(o_route, "run_agent", _stub)

    app = FastAPI()
    app.include_router(o_route.router)
    yield TestClient(app)
    try:
        os.unlink(path)
    except FileNotFoundError:
        pass


def _bearer(sub):
    from backend.services.auth import tokens
    tok, _ = tokens.issue(sub=sub, token_type="access", ttl_seconds=3600)
    return {"Authorization": f"Bearer {tok}"}


def test_orchestrate_body_user_id_cannot_impersonate(orchestrate_client):
    """A verified JWT for 'victim' wins over body.user_id='attacker' — the
    run is created under the authenticated identity."""
    r = orchestrate_client.post(
        "/v2/orchestrate",
        headers=_bearer("victim"),
        json={"user_id": "attacker", "message": "hi"},
    )
    assert r.status_code == 200
    from backend.services.orchestrator import list_runs
    assert list_runs(user_id="victim"), "run should be stored under the JWT subject"
    assert not list_runs(user_id="attacker"), "must NOT be stored under the spoofed body id"


def test_orchestrate_read_routes_scope_by_identity(orchestrate_client):
    r = orchestrate_client.post(
        "/v2/orchestrate", headers=_bearer("alice"),
        json={"user_id": "alice", "message": "hi"},
    )
    rid = r.json()["run_id"]
    # Owner of the run reads it fine.
    assert orchestrate_client.get(f"/v2/orchestrate/runs/{rid}", headers=_bearer("alice")).status_code == 200
    # A different authenticated user gets a 404 (existence-hidden).
    assert orchestrate_client.get(f"/v2/orchestrate/runs/{rid}", headers=_bearer("mallory")).status_code == 404
    # Authenticated listing is scoped to self regardless of ?user_id.
    listed = orchestrate_client.get("/v2/orchestrate/runs?user_id=alice", headers=_bearer("mallory")).json()
    assert all(row["user_id"] != "alice" for row in listed["runs"])


def test_orchestrate_project_tasks_scoped_to_authenticated_owner(orchestrate_client):
    import importlib as _il
    rstore = _il.import_module("backend.services.orchestrator.runs_store")
    tstore = _il.import_module("backend.services.orchestrator.tasks_store")
    alice_run = rstore.create_run(
        user_id="alice", agent_id="supervisor", project_id="shared-project",
    )
    bob_run = rstore.create_run(
        user_id="bob", agent_id="supervisor", project_id="shared-project",
    )
    alice_task = tstore.create_task(
        run_id=alice_run, project_id="shared-project", title="Alice task",
        assigned_agent="researcher",
    )
    bob_task = tstore.create_task(
        run_id=bob_run, project_id="shared-project", title="Bob task",
        assigned_agent="researcher",
    )

    r = orchestrate_client.get(
        "/v2/orchestrate/projects/shared-project/tasks", headers=_bearer("alice"),
    )
    assert r.status_code == 200, r.text
    task_ids = {row["id"] for row in r.json()["tasks"]}
    assert alice_task in task_ids
    assert bob_task not in task_ids
