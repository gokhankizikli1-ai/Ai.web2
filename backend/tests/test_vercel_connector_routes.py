# coding: utf-8
"""Vercel connector — HTTP surface (/v2/vercel/*).

Covers the feature gate, fail-closed config gates, ownership / cross-user
isolation, the OAuth callback's state validation (invalid / replayed / denied /
ownership-mismatch), the team-scope-from-token rule, token-never-leaks, the
server-revalidated project picker + selection, sync, disconnect, and the
absence of any mutation route. Network + crypto seams are faked/injected so no
real Vercel call or native AES backend is needed.
"""
from __future__ import annotations

import json

import pytest

from backend.core import deps
from backend.services.auth.identity import User
from backend.services.gmail import crypto as credential_crypto
from backend.services.orchestrator import observations_store as obs
from backend.services.projects import store as projects_store
from backend.services.vercel import oauth as vc_oauth
from backend.services.vercel import setup_state as vc_setup
from backend.services.vercel import store as vc_store
from backend.services.vercel import sync as vc_sync
from backend.routes import v2_vercel as route_mod

USER_A = User(id="uA", kind="email", external_id="email:a@x.com", display_name="A")
USER_B = User(id="uB", kind="email", external_id="email:b@x.com", display_name="B")

SECRET = "SUPER-SECRET"
TOKEN = "vercel_access_TOKEN"

PROJECT_PAYLOAD = {
    "id": "prj_1", "name": "korvix-site", "framework": "nextjs",
    "updatedAt": 1700000000000,
    "targets": {"production": {"alias": ["korvixai.com"]}},
    # Must never surface anywhere in an API response.
    "env": [{"key": "STRIPE_SECRET", "value": "sk_live_LEAK"}],
}


@pytest.fixture()
def env(tmp_path, monkeypatch, app):
    path = str(tmp_path / "projects.db")
    monkeypatch.setenv("PROJECTS_DB_PATH", path)
    monkeypatch.setenv("ENABLE_VERCEL_CONNECTOR", "true")
    monkeypatch.setenv("VERCEL_OAUTH_CLIENT_ID", "oac_test")
    monkeypatch.setenv("VERCEL_OAUTH_CLIENT_SECRET", SECRET)
    monkeypatch.setenv("VERCEL_OAUTH_REDIRECT_URI",
                       "https://backend.example.com/v2/vercel/oauth/callback")
    monkeypatch.setenv("VERCEL_INTEGRATION_SLUG", "korvixai")
    monkeypatch.setenv("VERCEL_FRONTEND_RESULT_URL", "https://app.example.com")
    monkeypatch.setenv("VERCEL_FRONTEND_RESULT_PATH", "/#/settings/integrations")
    for mod in (projects_store, vc_store, vc_setup, obs):
        monkeypatch.setattr(mod, "DB_PATH", path, raising=False)
    projects_store.init()
    vc_store._reset_for_tests(); vc_store.init_vercel_tables()
    vc_setup._reset_for_tests(); vc_setup.init_vercel_setup_tables()
    obs.init_observations_table()
    credential_crypto.set_cipher_for_tests(credential_crypto._ReversibleTestCipher())
    projects_store.create_project("uA", name="Proj A", project_id="p1")
    projects_store.create_project("uB", name="Proj B", project_id="pB")
    yield path
    credential_crypto.set_cipher_for_tests(None)
    app.dependency_overrides.clear()


def _as(app, user):
    app.dependency_overrides[deps.require_auth] = lambda: user


class FakeClient:
    """Stands in for VercelClient in the route layer (no network)."""

    instances = []

    def __init__(self, conn):
        self.conn = conn
        FakeClient.instances.append(self)

    projects = [PROJECT_PAYLOAD, {"id": "prj_2", "name": "other", "framework": "vite"}]
    project_error = None

    def list_projects(self, **_kw):
        if FakeClient.project_error:
            raise FakeClient.project_error
        return list(FakeClient.projects)

    def get_project(self, vercel_project_id):
        if FakeClient.project_error:
            raise FakeClient.project_error
        for p in FakeClient.projects:
            if p["id"] == vercel_project_id:
                return p
        from backend.services.vercel.errors import VercelNotFoundError
        raise VercelNotFoundError("not found", status=404)


@pytest.fixture(autouse=True)
def _fake_client(monkeypatch):
    FakeClient.instances = []
    FakeClient.project_error = None
    FakeClient.projects = [PROJECT_PAYLOAD,
                           {"id": "prj_2", "name": "other", "framework": "vite"}]
    monkeypatch.setattr(route_mod, "VercelClient", FakeClient)
    yield


def _tokens(team_id="team_9"):
    return vc_oauth.TokenResponse(access_token=TOKEN, installation_id="icfg_1",
                                  user_id="vu_1", team_id=team_id, token_type="Bearer")


def _stub_exchange(monkeypatch, tokens=None, exc=None):
    def fake(code, **_kw):
        if exc:
            raise exc
        return tokens or _tokens()

    monkeypatch.setattr(route_mod.vc_oauth, "exchange_code", fake)
    monkeypatch.setattr(route_mod.vc_oauth, "fetch_account_label",
                        lambda *a, **k: "Acme Inc")


def _authorize(client, app, monkeypatch, *, team_id="team_9", project_id="p1"):
    """Drive a real connect/start → callback round-trip and return the state."""
    _as(app, USER_A)
    start = client.post(f"/v2/vercel/projects/{project_id}/connect/start")
    state = start.json()["data"]["state"]
    _stub_exchange(monkeypatch, _tokens(team_id))
    client.get("/v2/vercel/oauth/callback", params={"state": state, "code": "CODE"},
               follow_redirects=False)
    return state


# ── feature gate ─────────────────────────────────────────────────────────────

def test_disabled_returns_503(client, app, env, monkeypatch):
    monkeypatch.setenv("ENABLE_VERCEL_CONNECTOR", "false")
    _as(app, USER_A)
    assert client.get("/v2/vercel/projects/p1/connection").status_code == 503


def test_disabled_callback_bounces_to_frontend(client, env, monkeypatch):
    monkeypatch.setenv("ENABLE_VERCEL_CONNECTOR", "false")
    r = client.get("/v2/vercel/oauth/callback", params={"state": "x", "code": "y"},
                   follow_redirects=False)
    assert r.status_code == 302
    assert r.headers["location"].startswith("https://app.example.com/#/settings/integrations")
    assert "reason=disabled" in r.headers["location"]


# ── connect/start ────────────────────────────────────────────────────────────

def test_connect_start_returns_install_url_without_secret(client, app, env):
    _as(app, USER_A)
    r = client.post("/v2/vercel/projects/p1/connect/start")
    assert r.status_code == 200
    data = r.json()["data"]
    assert data["authorization_url"].startswith("https://vercel.com/integrations/korvixai/new?")
    assert data["state"]
    assert SECRET not in json.dumps(r.json())


def test_connect_start_unauthenticated_performs_no_side_effect(client, env):
    r = client.post("/v2/vercel/projects/p1/connect/start")
    assert r.status_code >= 400 and r.status_code != 302
    assert vc_store.get_connection("p1") is None
    from backend.services.orchestrator import _sqlite
    with _sqlite.connection(env) as c:
        n = c.execute("SELECT COUNT(*) AS n FROM vercel_oauth_states").fetchone()["n"]
    assert n == 0


def test_connect_start_foreign_project_404(client, app, env):
    _as(app, USER_B)   # B does not own p1
    assert client.post("/v2/vercel/projects/p1/connect/start").status_code == 404


def test_connect_start_fails_closed_without_encryption(client, app, env):
    credential_crypto.set_cipher_for_tests(None)
    _as(app, USER_A)
    r = client.post("/v2/vercel/projects/p1/connect/start")
    assert r.status_code == 503
    assert r.json()["detail"]["code"] == "CREDENTIAL_ENCRYPTION_NOT_CONFIGURED"


def test_connect_start_fails_closed_without_oauth_config(client, app, env, monkeypatch):
    monkeypatch.delenv("VERCEL_OAUTH_CLIENT_SECRET", raising=False)
    _as(app, USER_A)
    r = client.post("/v2/vercel/projects/p1/connect/start")
    assert r.status_code == 503
    assert r.json()["detail"]["code"] == "VERCEL_OAUTH_NOT_CONFIGURED"


# ── OAuth callback ───────────────────────────────────────────────────────────

def test_callback_stores_encrypted_token_and_team_scope(client, app, env, monkeypatch):
    _authorize(client, app, monkeypatch)
    conn = vc_store.get_connection("p1")
    assert conn is not None
    assert conn.owner_user_id == "uA"           # from the STATE, not a query param
    assert conn.team_id == "team_9"             # from the TOKEN, not a query param
    assert conn.status == vc_store.STATUS_PENDING_SELECTION
    assert TOKEN not in conn.access_token_enc
    assert vc_store.decrypt_access_token(conn) == TOKEN


def test_callback_redirects_to_fixed_frontend_only(client, app, env, monkeypatch):
    _as(app, USER_A)
    state = client.post("/v2/vercel/projects/p1/connect/start").json()["data"]["state"]
    _stub_exchange(monkeypatch)
    r = client.get("/v2/vercel/oauth/callback",
                   params={"state": state, "code": "CODE",
                           # Attacker-supplied redirect + scope params: ignored.
                           "next": "https://evil.example.com/steal",
                           "teamId": "team_ATTACKER"},
                   follow_redirects=False)
    assert r.status_code == 302
    loc = r.headers["location"]
    assert loc.startswith("https://app.example.com/#/settings/integrations")
    assert "evil.example.com" not in loc
    assert "vercel=authorized" in loc
    assert vc_store.get_connection("p1").team_id == "team_9"


def test_callback_rejects_invalid_state(client, env, monkeypatch):
    _stub_exchange(monkeypatch)
    r = client.get("/v2/vercel/oauth/callback",
                   params={"state": "forged", "code": "CODE"}, follow_redirects=False)
    assert "reason=invalid_state" in r.headers["location"]
    assert vc_store.get_connection("p1") is None


def test_callback_rejects_a_replayed_state(client, app, env, monkeypatch):
    state = _authorize(client, app, monkeypatch)
    vc_store.delete_connection("p1")
    r = client.get("/v2/vercel/oauth/callback", params={"state": state, "code": "CODE"},
                   follow_redirects=False)
    assert "reason=invalid_state" in r.headers["location"]
    assert vc_store.get_connection("p1") is None


def test_callback_cannot_bind_another_users_project(client, app, env, monkeypatch):
    """A state minted for B's project can never attach to A's project (and vice
    versa): the callback reads the target ONLY from the state."""
    _as(app, USER_B)
    state_b = client.post("/v2/vercel/projects/pB/connect/start").json()["data"]["state"]
    _stub_exchange(monkeypatch)
    # Even though the attacker adds ?project_id=p1, the binding follows the state.
    client.get("/v2/vercel/oauth/callback",
               params={"state": state_b, "code": "C", "project_id": "p1"},
               follow_redirects=False)
    assert vc_store.get_connection("p1") is None
    assert vc_store.get_connection("pB").owner_user_id == "uB"


def test_callback_rejects_ownership_mismatch(client, app, env, monkeypatch):
    _as(app, USER_A)
    state = client.post("/v2/vercel/projects/p1/connect/start").json()["data"]["state"]
    _stub_exchange(monkeypatch)
    # The project is reassigned mid-flow.
    from backend.services.orchestrator import _sqlite
    with _sqlite.connection(env) as c:
        c.execute("UPDATE projects SET owner_user_id='uB' WHERE id='p1'")
    r = client.get("/v2/vercel/oauth/callback", params={"state": state, "code": "C"},
                   follow_redirects=False)
    assert "reason=ownership_mismatch" in r.headers["location"]
    assert vc_store.get_connection("p1") is None


def test_callback_reports_denied_consent(client, app, env, monkeypatch):
    _as(app, USER_A)
    state = client.post("/v2/vercel/projects/p1/connect/start").json()["data"]["state"]
    r = client.get("/v2/vercel/oauth/callback",
                   params={"state": state, "error": "access_denied"},
                   follow_redirects=False)
    assert "reason=access_denied" in r.headers["location"]
    assert vc_store.get_connection("p1") is None


def test_callback_reports_missing_code(client, app, env):
    from backend.services.vercel import setup_state
    state = setup_state.create_state(owner_user_id="uA", project_id="p1")
    r = client.get("/v2/vercel/oauth/callback", params={"state": state},
                   follow_redirects=False)
    assert "reason=missing_code" in r.headers["location"]


def test_callback_reports_a_failed_exchange(client, app, env, monkeypatch):
    from backend.services.vercel.errors import VercelOAuthError
    _as(app, USER_A)
    state = client.post("/v2/vercel/projects/p1/connect/start").json()["data"]["state"]
    _stub_exchange(monkeypatch, exc=VercelOAuthError("nope", reason="bad_request"))
    r = client.get("/v2/vercel/oauth/callback", params={"state": state, "code": "C"},
                   follow_redirects=False)
    assert "reason=exchange_failed" in r.headers["location"]
    assert vc_store.get_connection("p1") is None


def test_callback_fails_closed_without_encryption(client, app, env, monkeypatch):
    _as(app, USER_A)
    state = client.post("/v2/vercel/projects/p1/connect/start").json()["data"]["state"]
    _stub_exchange(monkeypatch)
    credential_crypto.set_cipher_for_tests(None)
    r = client.get("/v2/vercel/oauth/callback", params={"state": state, "code": "C"},
                   follow_redirects=False)
    assert "reason=encryption_unavailable" in r.headers["location"]
    assert vc_store.get_connection("p1") is None


def test_callback_prepopulates_the_pending_project_set(client, app, env, monkeypatch):
    _authorize(client, app, monkeypatch)
    pending = vc_setup.list_pending_projects("p1", owner_user_id="uA")
    assert {p.vercel_project_id for p in pending} == {"prj_1", "prj_2"}


# ── pending projects ─────────────────────────────────────────────────────────

def test_pending_projects_are_owner_only(client, app, env, monkeypatch):
    _authorize(client, app, monkeypatch)
    _as(app, USER_B)
    assert client.get("/v2/vercel/projects/p1/pending-projects").status_code == 404


def test_pending_projects_returns_display_metadata_only(client, app, env, monkeypatch):
    _authorize(client, app, monkeypatch)
    _as(app, USER_A)
    r = client.get("/v2/vercel/projects/p1/pending-projects")
    assert r.status_code == 200
    body = json.dumps(r.json())
    assert r.json()["data"]["count"] == 2
    assert TOKEN not in body and SECRET not in body
    assert "sk_live_LEAK" not in body and "STRIPE_SECRET" not in body


def test_pending_projects_refreshes_when_empty(client, app, env, monkeypatch):
    _authorize(client, app, monkeypatch)
    vc_setup.delete_pending_projects("p1")
    FakeClient.projects = [{"id": "prj_new", "name": "fresh"}]
    _as(app, USER_A)
    r = client.get("/v2/vercel/projects/p1/pending-projects")
    ids = [p["vercel_project_id"] for p in r.json()["data"]["projects"]]
    assert ids == ["prj_new"]


def test_pending_projects_requires_an_authorization(client, app, env):
    _as(app, USER_A)
    r = client.get("/v2/vercel/projects/p1/pending-projects")
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "NOT_AUTHORIZED"


def test_pending_projects_surfaces_provider_failure(client, app, env, monkeypatch):
    from backend.services.vercel.errors import VercelServerError
    _authorize(client, app, monkeypatch)
    vc_setup.delete_pending_projects("p1")
    FakeClient.project_error = VercelServerError("down", status=500)
    _as(app, USER_A)
    r = client.get("/v2/vercel/projects/p1/pending-projects")
    assert r.status_code == 502


def test_pending_projects_reports_a_revoked_connection(client, app, env, monkeypatch):
    _authorize(client, app, monkeypatch)
    vc_store.mark_revoked("p1")
    _as(app, USER_A)
    r = client.get("/v2/vercel/projects/p1/pending-projects")
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "CONNECTION_REVOKED"


# ── connect/select (double validation) ──────────────────────────────────────

def test_select_binds_a_revalidated_project(client, app, env, monkeypatch):
    _authorize(client, app, monkeypatch)
    _as(app, USER_A)
    r = client.post("/v2/vercel/projects/p1/connect/select",
                    json={"vercel_project_id": "prj_1"})
    assert r.status_code == 200
    conn = r.json()["data"]["connection"]
    assert conn["vercel_project_id"] == "prj_1"
    assert conn["connected"] is True
    assert conn["production_url"] == "https://korvixai.com"
    assert "sk_live_LEAK" not in json.dumps(r.json())
    # The pending set is cleared once a choice is made.
    assert vc_setup.list_pending_projects("p1", owner_user_id="uA") == []


def test_select_rejects_a_project_outside_the_pending_set(client, app, env, monkeypatch):
    _authorize(client, app, monkeypatch)
    _as(app, USER_A)
    r = client.post("/v2/vercel/projects/p1/connect/select",
                    json={"vercel_project_id": "prj_SOMEONE_ELSE"})
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "NO_PENDING_PROJECT"
    assert vc_store.get_connection("p1").vercel_project_id == ""


def test_select_revalidates_live_against_vercel(client, app, env, monkeypatch):
    """A pending row alone must never be enough: if Vercel no longer exposes the
    project under this token's scope, the bind is refused."""
    _authorize(client, app, monkeypatch)
    FakeClient.projects = [{"id": "prj_2", "name": "other"}]   # prj_1 lost access
    _as(app, USER_A)
    r = client.post("/v2/vercel/projects/p1/connect/select",
                    json={"vercel_project_id": "prj_1"})
    assert r.status_code == 502
    assert vc_store.get_connection("p1").vercel_project_id == ""


def test_select_is_owner_only(client, app, env, monkeypatch):
    _authorize(client, app, monkeypatch)
    _as(app, USER_B)
    r = client.post("/v2/vercel/projects/p1/connect/select",
                    json={"vercel_project_id": "prj_1"})
    assert r.status_code == 404
    assert vc_store.get_connection("p1").vercel_project_id == ""


def test_select_requires_an_authorization(client, app, env):
    _as(app, USER_A)
    r = client.post("/v2/vercel/projects/p1/connect/select",
                    json={"vercel_project_id": "prj_1"})
    assert r.status_code == 409


def test_select_rejects_an_empty_id(client, app, env, monkeypatch):
    _authorize(client, app, monkeypatch)
    _as(app, USER_A)
    r = client.post("/v2/vercel/projects/p1/connect/select",
                    json={"vercel_project_id": ""})
    assert r.status_code == 422


# ── connection status ────────────────────────────────────────────────────────

def test_connection_status_never_leaks_a_token(client, app, env, monkeypatch):
    _authorize(client, app, monkeypatch)
    _as(app, USER_A)
    r = client.get("/v2/vercel/projects/p1/connection")
    body = json.dumps(r.json())
    assert TOKEN not in body and SECRET not in body
    assert "access_token" not in body
    data = r.json()["data"]
    assert data["connected"] is False                       # selection pending
    assert data["connection"]["needs_project_selection"] is True
    assert data["connection"]["account_label"] == "Acme Inc"


def test_connection_status_is_owner_scoped(client, app, env, monkeypatch):
    _authorize(client, app, monkeypatch)
    _as(app, USER_B)
    assert client.get("/v2/vercel/projects/p1/connection").status_code == 404


def test_unconnected_project_reports_null(client, app, env):
    _as(app, USER_A)
    r = client.get("/v2/vercel/projects/p1/connection")
    assert r.json()["data"] == {"connection": None, "connected": False}


# ── sync ─────────────────────────────────────────────────────────────────────

def _connected(client, app, monkeypatch):
    _authorize(client, app, monkeypatch)
    _as(app, USER_A)
    client.post("/v2/vercel/projects/p1/connect/select",
                json={"vercel_project_id": "prj_1"})


def test_sync_runs_and_reports_truthfully(client, app, env, monkeypatch):
    _connected(client, app, monkeypatch)
    monkeypatch.setattr(
        route_mod.vc_sync, "sync_connection",
        lambda conn, **k: vc_sync.SyncReport(project_id=conn.project_id,
                                             vercel_project_id=conn.vercel_project_id,
                                             recorded=3, deduplicated=1))
    r = client.post("/v2/vercel/projects/p1/sync")
    assert r.status_code == 200
    assert r.json()["data"]["sync"]["recorded"] == 3
    assert r.json()["data"]["sync"]["ok"] is True


def test_sync_requires_a_selected_project(client, app, env, monkeypatch):
    _authorize(client, app, monkeypatch)
    _as(app, USER_A)
    r = client.post("/v2/vercel/projects/p1/sync")
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "PROJECT_SELECTION_REQUIRED"


def test_sync_requires_a_connection(client, app, env):
    _as(app, USER_A)
    r = client.post("/v2/vercel/projects/p1/sync")
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "NOT_CONNECTED"


def test_sync_reports_a_revoked_authorization(client, app, env, monkeypatch):
    _connected(client, app, monkeypatch)
    vc_store.mark_revoked("p1")
    r = client.post("/v2/vercel/projects/p1/sync")
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "CONNECTION_REVOKED"


def test_sync_reports_a_token_that_died_mid_sync(client, app, env, monkeypatch):
    """A 401 mid-sync wipes the dead credential inside the client; the route must
    then surface the actionable reconnect signal, not an opaque partial failure."""
    _connected(client, app, monkeypatch)

    def _dies(conn, **_k):
        vc_store.mark_revoked(conn.project_id)
        return vc_sync.SyncReport(project_id=conn.project_id,
                                  vercel_project_id=conn.vercel_project_id,
                                  errors={"deployments": "VercelAuthError (HTTP 401)"})

    monkeypatch.setattr(route_mod.vc_sync, "sync_connection", _dies)
    r = client.post("/v2/vercel/projects/p1/sync")
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "CONNECTION_REVOKED"


def test_sync_is_owner_scoped(client, app, env, monkeypatch):
    _connected(client, app, monkeypatch)
    _as(app, USER_B)
    assert client.post("/v2/vercel/projects/p1/sync").status_code == 404


def test_sync_cannot_read_another_projects_observations(client, app, env, monkeypatch):
    """Sync writes and the caller reads only within their own (user, project)."""
    _connected(client, app, monkeypatch)
    obs.record_observation(user_id="uB", project_id="pB", source="vercel",
                           kind="vercel.deployment.error", summary="B's failure",
                           external_id="b-1")
    monkeypatch.setattr(route_mod.vc_sync, "sync_connection",
                        lambda conn, **k: vc_sync.SyncReport(
                            project_id=conn.project_id,
                            vercel_project_id=conn.vercel_project_id))
    client.post("/v2/vercel/projects/p1/sync")
    assert obs.list_observations("p1", user_id="uA") == []
    assert len(obs.list_observations("pB", user_id="uB")) == 1


# ── disconnect ───────────────────────────────────────────────────────────────

def test_disconnect_removes_local_state_only(client, app, env, monkeypatch):
    _connected(client, app, monkeypatch)
    r = client.delete("/v2/vercel/projects/p1/connection")
    assert r.status_code == 200
    assert r.json()["data"] == {"removed": True, "connected": False}
    assert vc_store.get_connection("p1") is None
    assert vc_setup.list_pending_projects("p1", owner_user_id="uA") == []


def test_disconnect_is_idempotent(client, app, env):
    _as(app, USER_A)
    r = client.delete("/v2/vercel/projects/p1/connection")
    assert r.json()["data"]["removed"] is False


def test_disconnect_cannot_touch_another_users_connector(client, app, env, monkeypatch):
    _connected(client, app, monkeypatch)
    _as(app, USER_B)
    assert client.delete("/v2/vercel/projects/p1/connection").status_code == 404
    assert vc_store.get_connection("p1") is not None


# ── no mutation surface ──────────────────────────────────────────────────────

def test_router_exposes_no_vercel_mutation_route(app):
    """The whole /v2/vercel surface must contain no deploy/redeploy/rollback/
    env/domain path — read + local connection management only."""
    paths = {r.path for r in route_mod.router.routes}
    for forbidden in ("deploy", "redeploy", "rollback", "promote", "cancel",
                      "env", "domain", "alias"):
        assert not any(forbidden in p for p in paths), f"{forbidden} route exists"
    # The only DELETE is the LOCAL connection removal.
    deletes = [r.path for r in route_mod.router.routes
               if "DELETE" in getattr(r, "methods", set())]
    assert deletes == ["/v2/vercel/projects/{project_id}/connection"]


def test_regular_authenticated_users_can_use_the_connector(client, app, env, monkeypatch):
    """The connector is NOT owner-only: any authenticated user may connect a
    project they own. Ownership — not a role — is the security boundary."""
    projects_store.create_project("uB", name="B's own", project_id="pB2")
    _as(app, USER_B)
    assert client.post("/v2/vercel/projects/pB2/connect/start").status_code == 200
    assert client.get("/v2/vercel/projects/pB2/connection").status_code == 200
