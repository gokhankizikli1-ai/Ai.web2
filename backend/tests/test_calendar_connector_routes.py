# coding: utf-8
"""Google Calendar connector — HTTP surface (/v2/calendar/*).

Covers the feature gate, fail-closed config gates, ownership / cross-user
isolation, the OAuth callback's state validation (invalid / replayed / denied /
ownership-mismatch), token-never-leaks, sync, disconnect, and the Gmail
isolation guarantees. Network + crypto seams are faked/injected so no real
Google call or native AES backend is needed.
"""
from __future__ import annotations

import json

import pytest

from backend.core import deps
from backend.services.auth.identity import User
from backend.services.gmail import crypto as credential_crypto
from backend.services.gmail import oauth as gm_oauth
from backend.services.gmail import state_store as gm_state
from backend.services.gmail import store as gm_store
from backend.services.google_calendar import oauth as cal_oauth
from backend.services.google_calendar import state_store as cal_state
from backend.services.google_calendar import store as cal_store
from backend.services.google_calendar import sync as cal_sync
from backend.services.orchestrator import observations_store as obs
from backend.services.projects import store as projects_store

USER_A = User(id="uA", kind="email", external_id="email:a@x.com", display_name="A")
USER_B = User(id="uB", kind="email", external_id="email:b@x.com", display_name="B")

_IDENTITY = cal_oauth.CalendarIdentity(google_email="me@gmail.com",
                                       calendar_id="primary", time_zone="UTC")


@pytest.fixture()
def env(tmp_path, monkeypatch, app):
    path = str(tmp_path / "projects.db")
    monkeypatch.setenv("PROJECTS_DB_PATH", path)
    monkeypatch.setenv("ENABLE_CALENDAR_CONNECTOR", "true")
    monkeypatch.setenv("ENABLE_GMAIL_CONNECTOR", "true")
    monkeypatch.setenv("GMAIL_OAUTH_CLIENT_ID", "cid.apps.googleusercontent.com")
    monkeypatch.setenv("GMAIL_OAUTH_CLIENT_SECRET", "csecret")
    monkeypatch.delenv("CALENDAR_OAUTH_CLIENT_ID", raising=False)
    monkeypatch.delenv("CALENDAR_OAUTH_CLIENT_SECRET", raising=False)
    monkeypatch.setenv("GMAIL_OAUTH_REDIRECT_URI",
                       "https://backend.example.com/v2/gmail/oauth/callback")
    monkeypatch.setenv("CALENDAR_OAUTH_REDIRECT_URI",
                       "https://backend.example.com/v2/calendar/oauth/callback")
    monkeypatch.setenv("CALENDAR_FRONTEND_RESULT_URL", "https://app.example.com")
    monkeypatch.setenv("CALENDAR_FRONTEND_RESULT_PATH", "/#/settings/integrations")
    monkeypatch.setenv("GMAIL_FRONTEND_RESULT_URL", "https://app.example.com")
    for mod in (projects_store, cal_store, cal_state, gm_store, gm_state, obs):
        monkeypatch.setattr(mod, "DB_PATH", path, raising=False)
    projects_store.init()
    cal_store._reset_for_tests(); cal_store.init_calendar_tables()
    cal_state._reset_for_tests(); cal_state.init_calendar_state_table()
    gm_store._reset_for_tests(); gm_store.init_gmail_tables()
    gm_state._reset_for_tests(); gm_state.init_gmail_state_table()
    obs.init_observations_table()
    credential_crypto.set_cipher_for_tests(credential_crypto._ReversibleTestCipher())
    projects_store.create_project("uA", name="Proj A", project_id="p1")
    yield path
    credential_crypto.set_cipher_for_tests(None)
    app.dependency_overrides.clear()


def _as(app, user):
    app.dependency_overrides[deps.require_auth] = lambda: user


def _connect(project_id="p1", owner="uA", email="me@gmail.com"):
    return cal_store.upsert_connection(
        project_id=project_id, owner_user_id=owner, google_email=email,
        calendar_id="primary", time_zone="UTC", scopes="",
        refresh_token="RT-secret", access_token="AT-secret",
        access_token_expires="2999-01-01T00:00:00Z")


# ── feature gate ─────────────────────────────────────────────────────────────

def test_disabled_returns_503(client, app, env, monkeypatch):
    monkeypatch.setenv("ENABLE_CALENDAR_CONNECTOR", "false")
    _as(app, USER_A)
    r = client.get("/v2/calendar/projects/p1/connection")
    assert r.status_code == 503
    assert r.json()["detail"]["code"] == "CALENDAR_CONNECTOR_DISABLED"


def test_disabled_callback_bounces_without_touching_state(client, app, env, monkeypatch):
    state = _start_state(client, app)
    monkeypatch.setenv("ENABLE_CALENDAR_CONNECTOR", "false")
    r = client.get("/v2/calendar/oauth/callback",
                   params={"state": state, "code": "abc"}, follow_redirects=False)
    assert r.status_code == 302
    assert "calendar=error" in r.headers["location"]
    assert "reason=disabled" in r.headers["location"]
    assert cal_store.get_connection("p1") is None


# ── connect/start ────────────────────────────────────────────────────────────

def test_connect_start_returns_auth_url_no_secret(client, app, env):
    _as(app, USER_A)
    r = client.post("/v2/calendar/projects/p1/connect/start")
    assert r.status_code == 200
    data = r.json()["data"]
    assert data["authorization_url"].startswith("https://accounts.google.com/")
    assert data["scopes"] == [
        "https://www.googleapis.com/auth/calendar.events.readonly"]
    from urllib.parse import parse_qs, urlparse
    q = parse_qs(urlparse(data["authorization_url"]).query)
    # The CALENDAR callback, never Gmail's.
    assert q["redirect_uri"] == [
        "https://backend.example.com/v2/calendar/oauth/callback"]
    assert "csecret" not in json.dumps(r.json())
    assert data["state"]


def test_connect_start_unauthenticated_rejected(client, app, env):
    # No dependency override → real require_auth → guest → rejection. The
    # security-relevant fact is that NO side effect happens for a guest.
    r = client.post("/v2/calendar/projects/p1/connect/start")
    assert r.status_code >= 400 and r.status_code != 302
    assert cal_store.get_connection("p1") is None
    from backend.services.orchestrator import _sqlite
    with _sqlite.connection(env) as c:
        n = c.execute("SELECT COUNT(*) AS n FROM calendar_oauth_states").fetchone()["n"]
    assert n == 0


def test_connect_start_foreign_project_404(client, app, env):
    _as(app, USER_B)  # B does not own p1
    r = client.post("/v2/calendar/projects/p1/connect/start")
    assert r.status_code == 404


def test_connect_start_unknown_project_404(client, app, env):
    _as(app, USER_A)
    assert client.post("/v2/calendar/projects/ghost/connect/start").status_code == 404


def test_connect_start_fails_closed_without_encryption(client, app, env):
    credential_crypto.set_cipher_for_tests(None)
    _as(app, USER_A)
    r = client.post("/v2/calendar/projects/p1/connect/start")
    assert r.status_code == 503
    assert r.json()["detail"]["code"] == "CREDENTIAL_ENCRYPTION_NOT_CONFIGURED"


def test_connect_start_fails_closed_without_oauth_config(client, app, env, monkeypatch):
    monkeypatch.delenv("CALENDAR_OAUTH_REDIRECT_URI", raising=False)
    _as(app, USER_A)
    r = client.post("/v2/calendar/projects/p1/connect/start")
    assert r.status_code == 503
    assert r.json()["detail"]["code"] == "CALENDAR_OAUTH_NOT_CONFIGURED"


# ── OAuth callback ───────────────────────────────────────────────────────────

def _start_state(client, app):
    _as(app, USER_A)
    r = client.post("/v2/calendar/projects/p1/connect/start")
    return r.json()["data"]["state"]


def test_callback_happy_path_stores_connection(client, app, env, monkeypatch):
    state = _start_state(client, app)
    monkeypatch.setattr(
        cal_oauth, "exchange_code",
        lambda code: cal_oauth.TokenResponse(
            "AT", "RT-secret", 3600,
            "https://www.googleapis.com/auth/calendar.events.readonly", "Bearer"))
    monkeypatch.setattr(cal_oauth, "fetch_calendar_identity", lambda at: _IDENTITY)
    r = client.get("/v2/calendar/oauth/callback",
                   params={"state": state, "code": "abc"}, follow_redirects=False)
    assert r.status_code == 302
    loc = r.headers["location"]
    assert loc.startswith("https://app.example.com/#/settings/integrations")
    assert "calendar=connected" in loc
    conn = cal_store.get_connection("p1")
    assert conn is not None
    assert conn.owner_user_id == "uA"          # authoritative — from the state
    assert conn.google_email == "me@gmail.com"
    assert conn.time_zone == "UTC"
    assert "RT-secret" not in loc              # no token in the redirect


def test_callback_stores_only_the_calendar_scope(client, app, env, monkeypatch):
    state = _start_state(client, app)
    monkeypatch.setattr(
        cal_oauth, "exchange_code",
        lambda code: cal_oauth.TokenResponse(
            "AT", "RT", 3600,
            "https://www.googleapis.com/auth/calendar.events.readonly", "Bearer"))
    monkeypatch.setattr(cal_oauth, "fetch_calendar_identity", lambda at: _IDENTITY)
    client.get("/v2/calendar/oauth/callback", params={"state": state, "code": "abc"},
               follow_redirects=False)
    scopes = cal_store.get_connection("p1").public_view()["scopes"]
    assert scopes == ["https://www.googleapis.com/auth/calendar.events.readonly"]
    assert not any("gmail" in s for s in scopes)


def test_callback_invalid_state_rejected(client, app, env):
    r = client.get("/v2/calendar/oauth/callback",
                   params={"state": "forged", "code": "abc"}, follow_redirects=False)
    assert r.status_code == 302
    assert "reason=invalid_state" in r.headers["location"]
    assert cal_store.get_connection("p1") is None


def test_callback_replay_rejected(client, app, env, monkeypatch):
    state = _start_state(client, app)
    monkeypatch.setattr(cal_oauth, "exchange_code",
                        lambda code: cal_oauth.TokenResponse("AT", "RT", 3600, "", "Bearer"))
    monkeypatch.setattr(cal_oauth, "fetch_calendar_identity", lambda at: _IDENTITY)
    r1 = client.get("/v2/calendar/oauth/callback",
                    params={"state": state, "code": "abc"}, follow_redirects=False)
    assert "calendar=connected" in r1.headers["location"]
    r2 = client.get("/v2/calendar/oauth/callback",
                    params={"state": state, "code": "abc"}, follow_redirects=False)
    assert "reason=invalid_state" in r2.headers["location"]


def test_callback_rejects_a_gmail_state(client, app, env, monkeypatch):
    """A state minted by the Gmail flow must be worthless at the Calendar
    callback — the shared Google client does NOT mean a shared state space."""
    _as(app, USER_A)
    gmail_state = client.post("/v2/gmail/projects/p1/connect/start").json()["data"]["state"]
    r = client.get("/v2/calendar/oauth/callback",
                   params={"state": gmail_state, "code": "abc"}, follow_redirects=False)
    assert "reason=invalid_state" in r.headers["location"]
    assert cal_store.get_connection("p1") is None


def test_callback_denied_consent(client, app, env):
    state = _start_state(client, app)
    r = client.get("/v2/calendar/oauth/callback",
                   params={"state": state, "error": "access_denied"},
                   follow_redirects=False)
    assert "reason=access_denied" in r.headers["location"]
    assert cal_store.get_connection("p1") is None


def test_callback_missing_code(client, app, env):
    state = _start_state(client, app)
    r = client.get("/v2/calendar/oauth/callback", params={"state": state},
                   follow_redirects=False)
    assert "reason=missing_code" in r.headers["location"]


def test_callback_no_refresh_token_on_first_connect_rejected(client, app, env, monkeypatch):
    state = _start_state(client, app)
    monkeypatch.setattr(cal_oauth, "exchange_code",
                        lambda code: cal_oauth.TokenResponse("AT", "", 3600, "", "Bearer"))
    monkeypatch.setattr(cal_oauth, "fetch_calendar_identity", lambda at: _IDENTITY)
    r = client.get("/v2/calendar/oauth/callback",
                   params={"state": state, "code": "abc"}, follow_redirects=False)
    assert "reason=no_refresh_token" in r.headers["location"]
    assert cal_store.get_connection("p1") is None


def test_callback_never_reuses_a_gmail_refresh_token(client, app, env, monkeypatch):
    """A reconnect with no new refresh token may only fall back to the CALENDAR
    connection's own token — never to Gmail's (different scope, different
    consent)."""
    gm_store.upsert_connection(project_id="p1", owner_user_id="uA",
                               google_email="me@gmail.com", scopes="",
                               refresh_token="GMAIL-RT", access_token="AT")
    state = _start_state(client, app)
    monkeypatch.setattr(cal_oauth, "exchange_code",
                        lambda code: cal_oauth.TokenResponse("AT", "", 3600, "", "Bearer"))
    monkeypatch.setattr(cal_oauth, "fetch_calendar_identity", lambda at: _IDENTITY)
    r = client.get("/v2/calendar/oauth/callback",
                   params={"state": state, "code": "abc"}, follow_redirects=False)
    assert "reason=no_refresh_token" in r.headers["location"]
    assert cal_store.get_connection("p1") is None


def test_callback_exchange_failure_reports_truthfully(client, app, env, monkeypatch):
    from backend.services.google_calendar.errors import CalendarOAuthError
    state = _start_state(client, app)

    def _boom(code):
        raise CalendarOAuthError("rejected", status=400, reason="invalid_grant")
    monkeypatch.setattr(cal_oauth, "exchange_code", _boom)
    r = client.get("/v2/calendar/oauth/callback",
                   params={"state": state, "code": "abc"}, follow_redirects=False)
    assert "reason=exchange_failed" in r.headers["location"]
    assert cal_store.get_connection("p1") is None


def test_callback_cannot_attach_to_another_users_project(client, app, env, monkeypatch):
    state = _start_state(client, app)
    from backend.services.orchestrator import _sqlite
    with _sqlite.connection(env) as c:
        c.execute("UPDATE projects SET owner_user_id=? WHERE id=?", ("uB", "p1"))
    monkeypatch.setattr(cal_oauth, "exchange_code",
                        lambda code: cal_oauth.TokenResponse("AT", "RT", 3600, "", "Bearer"))
    r = client.get("/v2/calendar/oauth/callback",
                   params={"state": state, "code": "abc"}, follow_redirects=False)
    assert "reason=ownership_mismatch" in r.headers["location"]
    assert cal_store.get_connection("p1") is None


def test_callback_redirect_target_is_fixed_server_side(client, app, env, monkeypatch):
    """No request-supplied value may steer the redirect — no open redirect."""
    state = _start_state(client, app)
    monkeypatch.setattr(cal_oauth, "exchange_code",
                        lambda code: cal_oauth.TokenResponse("AT", "RT", 3600, "", "Bearer"))
    monkeypatch.setattr(cal_oauth, "fetch_calendar_identity", lambda at: _IDENTITY)
    r = client.get("/v2/calendar/oauth/callback",
                   params={"state": state, "code": "abc",
                           "next": "https://evil.example.com",
                           "redirect_uri": "https://evil.example.com"},
                   follow_redirects=False)
    assert r.headers["location"].startswith("https://app.example.com/")
    assert "evil.example.com" not in r.headers["location"]


# ── status ───────────────────────────────────────────────────────────────────

def test_status_never_returns_token(client, app, env):
    _connect()
    _as(app, USER_A)
    r = client.get("/v2/calendar/projects/p1/connection")
    assert r.status_code == 200
    blob = json.dumps(r.json()).lower()
    assert "rt-secret" not in blob and "at-secret" not in blob and "token" not in blob
    assert r.json()["data"]["connected"] is True


def test_status_reports_not_connected(client, app, env):
    _as(app, USER_A)
    r = client.get("/v2/calendar/projects/p1/connection")
    assert r.json()["data"] == {"connection": None, "connected": False}


def test_status_foreign_project_404(client, app, env):
    _connect()
    _as(app, USER_B)
    assert client.get("/v2/calendar/projects/p1/connection").status_code == 404


# ── sync ─────────────────────────────────────────────────────────────────────

def test_sync_requires_connection(client, app, env):
    _as(app, USER_A)
    r = client.post("/v2/calendar/projects/p1/sync")
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "NOT_CONNECTED"


def test_sync_records_observations_visible_to_the_business_brain(client, app, env, monkeypatch):
    _connect()

    class _FakeClient:
        def __init__(self, conn): pass
        def list_events(self, **kw):
            from backend.services.google_calendar.client import EventsPage
            return EventsPage(
                items=[{"id": "ev1", "status": "confirmed", "summary": "Board sync",
                        "updated": "2026-03-01T09:00:00Z",
                        "start": {"dateTime": "2099-01-01T10:00:00Z"},
                        "end": {"dateTime": "2099-01-01T11:00:00Z"}}],
                next_page_token="", summary="me@gmail.com", time_zone="UTC")
    monkeypatch.setattr(cal_sync, "CalendarClient", _FakeClient)
    _as(app, USER_A)
    r = client.post("/v2/calendar/projects/p1/sync")
    assert r.status_code == 200
    assert r.json()["data"]["sync"]["recorded"] == 1
    # Visible through the EXISTING Business Brain authority path.
    from backend.services.orchestrator import project_supervisor
    assessment = project_supervisor.assess_business_brain(None, project_id="p1", user_id="uA")
    kinds = {o["kind"] for o in assessment["observations"]}
    assert "calendar.event.upcoming" in kinds


def test_sync_revoked_connection_409(client, app, env):
    _connect()
    cal_store.mark_revoked("p1")
    _as(app, USER_A)
    r = client.post("/v2/calendar/projects/p1/sync")
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "CONNECTION_REVOKED"


def test_sync_mid_flight_auth_failure_reports_reconnect(client, app, env, monkeypatch):
    from backend.services.google_calendar.errors import CalendarAuthError
    _connect()

    def _boom(conn):
        raise CalendarAuthError("revoked")
    monkeypatch.setattr(cal_sync, "sync_connection", _boom)
    _as(app, USER_A)
    r = client.post("/v2/calendar/projects/p1/sync")
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "CONNECTION_REVOKED"


def test_non_owner_cannot_sync_foreign_project(client, app, env):
    _connect()
    _as(app, USER_B)
    assert client.post("/v2/calendar/projects/p1/sync").status_code == 404


# ── disconnect ───────────────────────────────────────────────────────────────

def test_disconnect_removes_credentials(client, app, env, monkeypatch):
    _connect()
    revoked = {"called": False}
    monkeypatch.setattr(cal_oauth, "revoke_token",
                        lambda t: revoked.__setitem__("called", True) or True)
    _as(app, USER_A)
    r = client.delete("/v2/calendar/projects/p1/connection")
    assert r.status_code == 200
    assert r.json()["data"]["removed"] is True
    assert cal_store.get_connection("p1") is None
    assert revoked["called"] is True     # no sibling Google connection ⇒ safe


def test_disconnect_when_not_connected_is_a_safe_noop(client, app, env):
    _as(app, USER_A)
    r = client.delete("/v2/calendar/projects/p1/connection")
    assert r.status_code == 200
    assert r.json()["data"] == {"removed": False, "connected": False,
                                "revoked_remotely": False}


def test_disconnect_foreign_project_404(client, app, env):
    _connect()
    _as(app, USER_B)
    assert client.delete("/v2/calendar/projects/p1/connection").status_code == 404
    assert cal_store.get_connection("p1") is not None   # and nothing was removed


# ── Gmail isolation, end to end over HTTP ────────────────────────────────────

def test_disconnecting_calendar_leaves_gmail_fully_intact(client, app, env, monkeypatch):
    gm_store.upsert_connection(project_id="p1", owner_user_id="uA",
                               google_email="me@gmail.com", scopes="",
                               refresh_token="GMAIL-RT", access_token="GMAIL-AT")
    _connect(email="me@gmail.com")
    revoked = {"called": False}
    monkeypatch.setattr(cal_oauth, "revoke_token",
                        lambda t: revoked.__setitem__("called", True) or True)
    _as(app, USER_A)
    r = client.delete("/v2/calendar/projects/p1/connection")
    assert r.status_code == 200
    assert r.json()["data"]["removed"] is True
    # The REMOTE revoke was skipped — it would have killed the shared grant.
    assert revoked["called"] is False
    assert r.json()["data"]["revoked_remotely"] is False
    # Gmail is untouched and still usable.
    gm = gm_store.get_connection("p1")
    assert gm is not None and gm.status == gm_store.STATUS_CONNECTED
    assert gm_store.decrypt_refresh_token(gm) == "GMAIL-RT"
    # Gmail's own HTTP surface still reports connected.
    assert client.get("/v2/gmail/projects/p1/connection").json()["data"]["connected"] is True


def test_disconnecting_gmail_leaves_calendar_intact(client, app, env, monkeypatch):
    gm_store.upsert_connection(project_id="p1", owner_user_id="uA",
                               google_email="me@gmail.com", scopes="",
                               refresh_token="GMAIL-RT", access_token="GMAIL-AT")
    _connect(email="me@gmail.com")
    revoked = {"called": False}
    monkeypatch.setattr(gm_oauth, "revoke_token",
                        lambda t: revoked.__setitem__("called", True) or True)
    _as(app, USER_A)
    r = client.delete("/v2/gmail/projects/p1/connection")
    assert r.status_code == 200
    assert revoked["called"] is False       # symmetric guard
    cal = cal_store.get_connection("p1")
    assert cal is not None and cal.status == cal_store.STATUS_CONNECTED
    assert cal_store.decrypt_refresh_token(cal) == "RT-secret"
    assert client.get("/v2/calendar/projects/p1/connection").json()["data"]["connected"] is True


def test_gmail_disconnect_still_revokes_when_no_calendar_connection(client, app, env, monkeypatch):
    """The guard must be a no-op in the common case — Gmail's existing revoke
    behaviour is preserved when nothing else shares the grant."""
    gm_store.upsert_connection(project_id="p1", owner_user_id="uA",
                               google_email="me@gmail.com", scopes="",
                               refresh_token="GMAIL-RT", access_token="GMAIL-AT")
    revoked = {"called": False}
    monkeypatch.setattr(gm_oauth, "revoke_token",
                        lambda t: revoked.__setitem__("called", True) or True)
    _as(app, USER_A)
    r = client.delete("/v2/gmail/projects/p1/connection")
    assert revoked["called"] is True
    assert r.json()["data"]["revoked_remotely"] is True
