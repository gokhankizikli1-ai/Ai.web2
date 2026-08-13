# coding: utf-8
"""Gmail connector — HTTP surface (/v2/gmail/*).

Covers the feature gate, fail-closed config gates, ownership / cross-user
isolation, the OAuth callback's state validation (invalid / replayed / denied /
ownership-mismatch), token-never-leaks, sync, and disconnect. Network + crypto
seams are faked/injected so no real Google call or native AES backend is needed.
"""
from __future__ import annotations

import json

import pytest

from backend.core import deps
from backend.services.auth.identity import User
from backend.services.gmail import crypto as gm_crypto
from backend.services.gmail import oauth as gm_oauth
from backend.services.gmail import state_store as gm_state
from backend.services.gmail import store as gm_store
from backend.services.gmail import sync as gm_sync
from backend.services.projects import store as projects_store
from backend.services.orchestrator import observations_store as obs

USER_A = User(id="uA", kind="email", external_id="email:a@x.com", display_name="A")
USER_B = User(id="uB", kind="email", external_id="email:b@x.com", display_name="B")


@pytest.fixture()
def env(tmp_path, monkeypatch, app):
    path = str(tmp_path / "projects.db")
    monkeypatch.setenv("PROJECTS_DB_PATH", path)
    monkeypatch.setenv("ENABLE_GMAIL_CONNECTOR", "true")
    monkeypatch.setenv("GMAIL_OAUTH_CLIENT_ID", "cid.apps.googleusercontent.com")
    monkeypatch.setenv("GMAIL_OAUTH_CLIENT_SECRET", "csecret")
    monkeypatch.setenv("GMAIL_OAUTH_REDIRECT_URI",
                       "https://backend.example.com/v2/gmail/oauth/callback")
    monkeypatch.setenv("GMAIL_FRONTEND_RESULT_URL", "https://app.example.com")
    monkeypatch.setenv("GMAIL_FRONTEND_RESULT_PATH", "/#/settings/integrations")
    for mod in (projects_store, gm_store, gm_state, obs):
        monkeypatch.setattr(mod, "DB_PATH", path, raising=False)
    # projects_store uses its own _conn; point it at the tmp file + init.
    projects_store.init()
    gm_store._reset_for_tests(); gm_store.init_gmail_tables()
    gm_state._reset_for_tests(); gm_state.init_gmail_state_table()
    obs.init_observations_table()
    gm_crypto.set_cipher_for_tests(gm_crypto._ReversibleTestCipher())
    projects_store.create_project("uA", name="Proj A", project_id="p1")
    yield path
    gm_crypto.set_cipher_for_tests(None)
    app.dependency_overrides.clear()


def _as(app, user):
    app.dependency_overrides[deps.require_auth] = lambda: user


# ── feature gate ─────────────────────────────────────────────────────────────

def test_disabled_returns_503(client, app, env, monkeypatch):
    monkeypatch.setenv("ENABLE_GMAIL_CONNECTOR", "false")
    _as(app, USER_A)
    r = client.get("/v2/gmail/projects/p1/connection")
    assert r.status_code == 503


# ── connect/start ────────────────────────────────────────────────────────────

def test_connect_start_returns_auth_url_no_secret(client, app, env):
    _as(app, USER_A)
    r = client.post("/v2/gmail/projects/p1/connect/start")
    assert r.status_code == 200
    data = r.json()["data"]
    assert data["authorization_url"].startswith("https://accounts.google.com/")
    assert data["scopes"] == ["https://www.googleapis.com/auth/gmail.readonly"]
    # No client secret / token ever surfaced.
    assert "csecret" not in json.dumps(r.json())
    # A state row was created.
    assert data["state"]


def test_connect_start_unauthenticated_rejected(client, app, env):
    # No dependency override → real require_auth → guest → MissingTokenError
    # (a 401 UnauthorizedError; the default test app ships without the v2
    # envelope handler so it surfaces as a 500, but the security-relevant fact
    # is that the route REJECTS and performs NO side effect for a guest).
    r = client.post("/v2/gmail/projects/p1/connect/start")
    assert r.status_code >= 400  # never a 200/302 success for a guest
    assert r.status_code != 302
    # A guest can neither create a connection nor mint an OAuth state.
    assert gm_store.get_connection("p1") is None
    from backend.services.orchestrator import _sqlite
    with _sqlite.connection(env) as c:
        n = c.execute("SELECT COUNT(*) AS n FROM gmail_oauth_states").fetchone()["n"]
    assert n == 0


def test_connect_start_foreign_project_404(client, app, env):
    _as(app, USER_B)  # B does not own p1
    r = client.post("/v2/gmail/projects/p1/connect/start")
    assert r.status_code == 404


def test_connect_start_fails_closed_without_encryption(client, app, env):
    # Remove the injected cipher and env key → crypto unconfigured → 503.
    gm_crypto.set_cipher_for_tests(None)
    _as(app, USER_A)
    r = client.post("/v2/gmail/projects/p1/connect/start")
    assert r.status_code == 503
    assert r.json()["detail"]["code"] == "CREDENTIAL_ENCRYPTION_NOT_CONFIGURED"


def test_connect_start_fails_closed_without_oauth_config(client, app, env, monkeypatch):
    monkeypatch.delenv("GMAIL_OAUTH_CLIENT_ID", raising=False)
    monkeypatch.delenv("GOOGLE_CLIENT_ID", raising=False)
    _as(app, USER_A)
    r = client.post("/v2/gmail/projects/p1/connect/start")
    assert r.status_code == 503
    assert r.json()["detail"]["code"] == "GMAIL_OAUTH_NOT_CONFIGURED"


# ── OAuth callback ───────────────────────────────────────────────────────────

def _start_state(client, app):
    _as(app, USER_A)
    r = client.post("/v2/gmail/projects/p1/connect/start")
    return r.json()["data"]["state"]


def test_callback_happy_path_stores_connection(client, app, env, monkeypatch):
    state = _start_state(client, app)
    monkeypatch.setattr(gm_oauth, "exchange_code",
                        lambda code: gm_oauth.TokenResponse("AT", "RT-secret", 3600,
                                                            "https://www.googleapis.com/auth/gmail.readonly", "Bearer"))
    monkeypatch.setattr(gm_oauth, "fetch_account_email", lambda at: "me@gmail.com")
    r = client.get("/v2/gmail/oauth/callback", params={"state": state, "code": "abc"},
                   follow_redirects=False)
    assert r.status_code == 302
    loc = r.headers["location"]
    assert loc.startswith("https://app.example.com/#/settings/integrations")
    assert "gmail=connected" in loc
    # Connection persisted + owner-scoped; token never in the redirect.
    conn = gm_store.get_connection("p1")
    assert conn is not None and conn.owner_user_id == "uA" and conn.google_email == "me@gmail.com"
    assert "RT-secret" not in loc


def test_callback_invalid_state_rejected(client, app, env):
    r = client.get("/v2/gmail/oauth/callback", params={"state": "forged", "code": "abc"},
                   follow_redirects=False)
    assert r.status_code == 302
    assert "reason=invalid_state" in r.headers["location"]
    assert gm_store.get_connection("p1") is None


def test_callback_replay_rejected(client, app, env, monkeypatch):
    state = _start_state(client, app)
    monkeypatch.setattr(gm_oauth, "exchange_code",
                        lambda code: gm_oauth.TokenResponse("AT", "RT", 3600, "", "Bearer"))
    monkeypatch.setattr(gm_oauth, "fetch_account_email", lambda at: "me@gmail.com")
    r1 = client.get("/v2/gmail/oauth/callback", params={"state": state, "code": "abc"},
                    follow_redirects=False)
    assert "gmail=connected" in r1.headers["location"]
    # Replaying the SAME state must be rejected (one-time).
    r2 = client.get("/v2/gmail/oauth/callback", params={"state": state, "code": "abc"},
                    follow_redirects=False)
    assert "reason=invalid_state" in r2.headers["location"]


def test_callback_denied_consent(client, app, env):
    state = _start_state(client, app)
    r = client.get("/v2/gmail/oauth/callback",
                   params={"state": state, "error": "access_denied"},
                   follow_redirects=False)
    assert "reason=access_denied" in r.headers["location"]
    assert gm_store.get_connection("p1") is None


def test_callback_missing_code(client, app, env):
    state = _start_state(client, app)
    r = client.get("/v2/gmail/oauth/callback", params={"state": state},
                   follow_redirects=False)
    assert "reason=missing_code" in r.headers["location"]


def test_callback_no_refresh_token_on_first_connect_rejected(client, app, env, monkeypatch):
    state = _start_state(client, app)
    # Google returned no refresh token and there is no prior connection.
    monkeypatch.setattr(gm_oauth, "exchange_code",
                        lambda code: gm_oauth.TokenResponse("AT", "", 3600, "", "Bearer"))
    monkeypatch.setattr(gm_oauth, "fetch_account_email", lambda at: "me@gmail.com")
    r = client.get("/v2/gmail/oauth/callback", params={"state": state, "code": "abc"},
                   follow_redirects=False)
    assert "reason=no_refresh_token" in r.headers["location"]
    assert gm_store.get_connection("p1") is None


def test_callback_cannot_attach_to_another_users_project(client, app, env, monkeypatch):
    # The state is bound to (uA, p1). Even if p1 were reassigned to another
    # owner mid-flow, the ownership re-check blocks the attach.
    state = _start_state(client, app)
    # Simulate p1 now owned by someone else.
    from backend.services.orchestrator import _sqlite
    with _sqlite.connection(env) as c:
        c.execute("UPDATE projects SET owner_user_id=? WHERE id=?", ("uB", "p1"))
    monkeypatch.setattr(gm_oauth, "exchange_code",
                        lambda code: gm_oauth.TokenResponse("AT", "RT", 3600, "", "Bearer"))
    r = client.get("/v2/gmail/oauth/callback", params={"state": state, "code": "abc"},
                   follow_redirects=False)
    assert "reason=ownership_mismatch" in r.headers["location"]
    assert gm_store.get_connection("p1") is None


# ── status ───────────────────────────────────────────────────────────────────

def test_status_never_returns_token(client, app, env):
    gm_store.upsert_connection(project_id="p1", owner_user_id="uA",
                               google_email="me@gmail.com", scopes="",
                               refresh_token="RT-secret", access_token="AT-secret")
    _as(app, USER_A)
    r = client.get("/v2/gmail/projects/p1/connection")
    assert r.status_code == 200
    blob = json.dumps(r.json()).lower()
    assert "rt-secret" not in blob and "at-secret" not in blob and "token" not in blob
    assert r.json()["data"]["connected"] is True


def test_status_foreign_project_404(client, app, env):
    _as(app, USER_B)
    assert client.get("/v2/gmail/projects/p1/connection").status_code == 404


# ── sync ─────────────────────────────────────────────────────────────────────

def test_sync_requires_connection(client, app, env):
    _as(app, USER_A)
    assert client.post("/v2/gmail/projects/p1/sync").status_code == 409


def test_sync_records_observations(client, app, env, monkeypatch):
    gm_store.upsert_connection(project_id="p1", owner_user_id="uA",
                               google_email="me@gmail.com", scopes="",
                               refresh_token="RT", access_token="AT",
                               access_token_expires="2999-01-01T00:00:00Z")

    class _FakeClient:
        def __init__(self, conn): pass
        def list_message_ids(self, **kw): return ["m1"]
        def get_message_metadata(self, mid):
            return {"id": "m1", "threadId": "t1", "snippet": "hi",
                    "internalDate": "1700000000000", "labelIds": ["INBOX"],
                    "payload": {"headers": [{"name": "Subject", "value": "Hi"}]}}
    monkeypatch.setattr(gm_sync, "GmailClient", _FakeClient)
    _as(app, USER_A)
    r = client.post("/v2/gmail/projects/p1/sync")
    assert r.status_code == 200
    assert r.json()["data"]["sync"]["recorded"] == 1
    # Visible through the EXISTING Business Brain authority path.
    from backend.services.orchestrator import project_supervisor
    assessment = project_supervisor.assess_business_brain(None, project_id="p1", user_id="uA")
    kinds = {o["kind"] for o in assessment["observations"]}
    assert "gmail.message.received" in kinds


def test_sync_revoked_connection_409(client, app, env):
    gm_store.upsert_connection(project_id="p1", owner_user_id="uA",
                               google_email="me@gmail.com", scopes="",
                               refresh_token="RT", access_token="AT")
    gm_store.mark_revoked("p1")
    _as(app, USER_A)
    r = client.post("/v2/gmail/projects/p1/sync")
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "CONNECTION_REVOKED"


# ── disconnect ───────────────────────────────────────────────────────────────

def test_disconnect_removes_credentials(client, app, env, monkeypatch):
    gm_store.upsert_connection(project_id="p1", owner_user_id="uA",
                               google_email="me@gmail.com", scopes="",
                               refresh_token="RT", access_token="AT")
    revoked = {"called": False}
    monkeypatch.setattr(gm_oauth, "revoke_token",
                        lambda t: revoked.__setitem__("called", True) or True)
    _as(app, USER_A)
    r = client.delete("/v2/gmail/projects/p1/connection")
    assert r.status_code == 200
    assert r.json()["data"]["removed"] is True
    assert gm_store.get_connection("p1") is None
    assert revoked["called"] is True  # remote revoke attempted


def test_disconnect_foreign_project_404(client, app, env):
    _as(app, USER_B)
    assert client.delete("/v2/gmail/projects/p1/connection").status_code == 404
