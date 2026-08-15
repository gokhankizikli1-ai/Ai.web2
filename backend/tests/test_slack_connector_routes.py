# coding: utf-8
"""Slack connector — HTTP surface (/v2/slack/*) + adversarial coverage.

Covers the feature gate, fail-closed config gates, ownership / cross-user
isolation, the OAuth callback's state validation (invalid / expired / replayed /
denied / ownership-mismatch), workspace-spoofing resistance, the
server-revalidated channel picker + multi-channel selection (including the
refusal to bind a channel Korvix cannot actually read), sync, disconnect with
shared-installation semantics, and the absence of any mutation route. Network +
crypto seams are faked/injected so no real Slack call or native AES backend is
needed.
"""
from __future__ import annotations

import json

import pytest

from backend.core import deps
from backend.routes import v2_slack as route_mod
from backend.services.auth.identity import User
from backend.services.gmail import crypto as credential_crypto
from backend.services.orchestrator import observations_store as obs
from backend.services.projects import store as projects_store
from backend.services.slack import oauth as sl_oauth
from backend.services.slack import setup_state as sl_setup
from backend.services.slack import store as sl_store
from backend.services.slack import sync as sl_sync

USER_A = User(id="uA", kind="email", external_id="email:a@x.com", display_name="A")
USER_B = User(id="uB", kind="email", external_id="email:b@x.com", display_name="B")

SECRET = "SLACK-CLIENT-SECRET"
BOT_TOKEN = "xoxb-REAL-BOT-TOKEN"
AUTH_CODE = "1234.5678.thecode"

CHANNELS = [
    {"id": "C_GENERAL", "name": "general", "is_private": False,
     "is_member": True, "is_archived": False},
    {"id": "C_PRODUCT", "name": "product", "is_private": True,
     "is_member": True, "is_archived": False},
    # Visible but NOT joined — must never be bindable.
    {"id": "C_LURKER", "name": "random", "is_private": False,
     "is_member": False, "is_archived": False},
    # Archived — filtered out of the picker entirely.
    {"id": "C_OLD", "name": "old", "is_private": False,
     "is_member": True, "is_archived": True},
]


@pytest.fixture()
def env(tmp_path, monkeypatch, app):
    path = str(tmp_path / "projects.db")
    monkeypatch.setenv("PROJECTS_DB_PATH", path)
    monkeypatch.setenv("ENABLE_SLACK_CONNECTOR", "true")
    monkeypatch.setenv("SLACK_CLIENT_ID", "A123.456")
    monkeypatch.setenv("SLACK_CLIENT_SECRET", SECRET)
    monkeypatch.setenv("SLACK_OAUTH_REDIRECT_URI",
                       "https://backend.example.com/v2/slack/oauth/callback")
    monkeypatch.setenv("SLACK_FRONTEND_RESULT_URL", "https://app.example.com")
    monkeypatch.setenv("SLACK_FRONTEND_RESULT_PATH", "/#/settings/integrations")
    for mod in (projects_store, sl_store, sl_setup, obs):
        monkeypatch.setattr(mod, "DB_PATH", path, raising=False)
    projects_store.init()
    sl_store._reset_for_tests(); sl_store.init_slack_tables()
    sl_setup._reset_for_tests(); sl_setup.init_slack_setup_tables()
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
    """Stands in for SlackClient in the route layer (no network)."""

    instances = []
    channels = list(CHANNELS)
    list_error = None
    info_error = None

    def __init__(self, conn):
        self.conn = conn
        FakeClient.instances.append(self)

    def list_channels(self, **_kw):
        if FakeClient.list_error:
            raise FakeClient.list_error
        return list(FakeClient.channels)

    def get_channel(self, channel_id):
        if FakeClient.info_error:
            raise FakeClient.info_error
        for c in FakeClient.channels:
            if c["id"] == channel_id:
                return c
        from backend.services.slack.errors import SlackAccessError
        raise SlackAccessError("not found", slack_error="channel_not_found")


@pytest.fixture(autouse=True)
def _fake_client(monkeypatch):
    FakeClient.instances = []
    FakeClient.list_error = None
    FakeClient.info_error = None
    FakeClient.channels = [dict(c) for c in CHANNELS]
    monkeypatch.setattr(route_mod, "SlackClient", FakeClient)
    yield


def _tokens(team_id="T_WORKSPACE"):
    return sl_oauth.TokenResponse(
        access_token=BOT_TOKEN, team_id=team_id, team_name="Korvix HQ",
        bot_user_id="U0BOT", app_id="A123",
        scope="channels:read,channels:history,groups:read,groups:history",
        token_type="bot")


def _stub_exchange(monkeypatch, tokens=None, exc=None):
    def fake(code, **_kw):
        if exc:
            raise exc
        return tokens or _tokens()

    monkeypatch.setattr(route_mod.sl_oauth, "exchange_code", fake)


def _authorize(client, app, monkeypatch, *, team_id="T_WORKSPACE", project_id="p1",
               user=USER_A):
    """Drive a real connect/start → callback round-trip and return the state."""
    _as(app, user)
    start = client.post(f"/v2/slack/projects/{project_id}/connect/start")
    state = start.json()["data"]["state"]
    _stub_exchange(monkeypatch, _tokens(team_id))
    client.get("/v2/slack/oauth/callback",
               params={"state": state, "code": AUTH_CODE}, follow_redirects=False)
    return state


def _connected(client, app, monkeypatch, *, channels=("C_GENERAL",), project_id="p1",
               user=USER_A):
    _authorize(client, app, monkeypatch, project_id=project_id, user=user)
    _as(app, user)
    return client.post(f"/v2/slack/projects/{project_id}/connect/select",
                       json={"channel_ids": list(channels)})


# ── feature gate ─────────────────────────────────────────────────────────────

def test_disabled_returns_503(client, app, env, monkeypatch):
    monkeypatch.setenv("ENABLE_SLACK_CONNECTOR", "false")
    _as(app, USER_A)
    r = client.get("/v2/slack/projects/p1/connection")
    assert r.status_code == 503
    assert r.json()["detail"]["code"] == "SLACK_CONNECTOR_DISABLED"


def test_disabled_callback_bounces_to_the_frontend(client, env, monkeypatch):
    monkeypatch.setenv("ENABLE_SLACK_CONNECTOR", "false")
    r = client.get("/v2/slack/oauth/callback", params={"state": "x", "code": "y"},
                   follow_redirects=False)
    assert r.status_code == 302
    assert r.headers["location"].startswith("https://app.example.com/#/settings/integrations")
    assert "reason=disabled" in r.headers["location"]


def test_every_project_route_is_gated(client, app, env, monkeypatch):
    monkeypatch.setenv("ENABLE_SLACK_CONNECTOR", "false")
    _as(app, USER_A)
    assert client.post("/v2/slack/projects/p1/connect/start").status_code == 503
    assert client.get("/v2/slack/projects/p1/pending-channels").status_code == 503
    assert client.post("/v2/slack/projects/p1/connect/select",
                       json={"channel_ids": ["C_GENERAL"]}).status_code == 503
    assert client.post("/v2/slack/projects/p1/sync").status_code == 503
    assert client.delete("/v2/slack/projects/p1/connection").status_code == 503


# ── connect/start ────────────────────────────────────────────────────────────

def test_connect_start_returns_an_authorization_url_without_secrets(client, app, env):
    _as(app, USER_A)
    r = client.post("/v2/slack/projects/p1/connect/start")
    assert r.status_code == 200
    data = r.json()["data"]
    assert data["authorization_url"].startswith("https://slack.com/oauth/v2/authorize?")
    assert data["state"]
    assert data["scopes"] == ["channels:read", "channels:history",
                              "groups:read", "groups:history"]
    body = json.dumps(r.json())
    assert SECRET not in body and BOT_TOKEN not in body


def test_connect_start_unauthenticated_performs_no_side_effect(client, env):
    r = client.post("/v2/slack/projects/p1/connect/start")
    assert r.status_code >= 400 and r.status_code != 302
    assert sl_store.get_connection("p1") is None
    from backend.services.orchestrator import _sqlite
    with _sqlite.connection(env) as c:
        n = c.execute("SELECT COUNT(*) AS n FROM slack_oauth_states").fetchone()["n"]
    assert n == 0


def test_connect_start_on_a_foreign_project_is_404(client, app, env):
    _as(app, USER_B)   # B does not own p1
    assert client.post("/v2/slack/projects/p1/connect/start").status_code == 404


def test_connect_start_fails_closed_without_encryption(client, app, env):
    credential_crypto.set_cipher_for_tests(None)
    _as(app, USER_A)
    r = client.post("/v2/slack/projects/p1/connect/start")
    assert r.status_code == 503
    assert r.json()["detail"]["code"] == "CREDENTIAL_ENCRYPTION_NOT_CONFIGURED"


def test_connect_start_fails_closed_without_oauth_config(client, app, env, monkeypatch):
    monkeypatch.delenv("SLACK_CLIENT_SECRET", raising=False)
    _as(app, USER_A)
    r = client.post("/v2/slack/projects/p1/connect/start")
    assert r.status_code == 503
    assert r.json()["detail"]["code"] == "SLACK_OAUTH_NOT_CONFIGURED"


# ── OAuth callback ───────────────────────────────────────────────────────────

def test_callback_stores_an_encrypted_token_and_the_authoritative_workspace(
        client, app, env, monkeypatch):
    _authorize(client, app, monkeypatch)
    conn = sl_store.get_connection("p1")
    assert conn is not None
    assert conn.owner_user_id == "uA"          # from the STATE, not a query param
    assert conn.team_id == "T_WORKSPACE"       # from the TOKEN, not a query param
    assert conn.team_name == "Korvix HQ"
    assert conn.status == sl_store.STATUS_PENDING_SELECTION
    assert BOT_TOKEN not in conn.bot_token_enc
    assert sl_store.decrypt_bot_token(conn) == BOT_TOKEN


def test_callback_never_persists_the_authorization_code(client, app, env, monkeypatch):
    _authorize(client, app, monkeypatch)
    from backend.services.orchestrator import _sqlite
    with _sqlite.connection(env) as c:
        tables = [r["name"] for r in c.execute(
            "SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
        dump = ""
        for t in tables:
            for row in c.execute(f"SELECT * FROM {t}").fetchall():
                dump += json.dumps(dict(row), default=str)
    assert AUTH_CODE not in dump
    assert BOT_TOKEN not in dump


def test_callback_redirects_only_to_the_fixed_frontend(client, app, env, monkeypatch):
    _as(app, USER_A)
    state = client.post("/v2/slack/projects/p1/connect/start").json()["data"]["state"]
    _stub_exchange(monkeypatch)
    r = client.get("/v2/slack/oauth/callback",
                   params={"state": state, "code": AUTH_CODE,
                           # Attacker-supplied redirect + workspace params: ignored.
                           "next": "https://evil.example.com/steal",
                           "redirect_uri": "https://evil.example.com/x",
                           "team": "T_ATTACKER", "team_id": "T_ATTACKER"},
                   follow_redirects=False)
    assert r.status_code == 302
    loc = r.headers["location"]
    assert loc.startswith("https://app.example.com/#/settings/integrations")
    assert "evil.example.com" not in loc
    assert "slack=authorized" in loc
    # Workspace spoofing is ineffective: the team came from the token exchange.
    assert sl_store.get_connection("p1").team_id == "T_WORKSPACE"


def test_callback_rejects_an_invalid_state(client, env, monkeypatch):
    _stub_exchange(monkeypatch)
    r = client.get("/v2/slack/oauth/callback",
                   params={"state": "forged", "code": AUTH_CODE},
                   follow_redirects=False)
    assert "reason=invalid_state" in r.headers["location"]
    assert sl_store.get_connection("p1") is None


def test_callback_rejects_a_replayed_state(client, app, env, monkeypatch):
    state = _authorize(client, app, monkeypatch)
    sl_store.delete_connection("p1")
    r = client.get("/v2/slack/oauth/callback",
                   params={"state": state, "code": AUTH_CODE}, follow_redirects=False)
    assert "reason=invalid_state" in r.headers["location"]
    assert sl_store.get_connection("p1") is None


def test_callback_rejects_an_expired_state(client, app, env, monkeypatch):
    _as(app, USER_A)
    state = client.post("/v2/slack/projects/p1/connect/start").json()["data"]["state"]
    from datetime import datetime, timedelta
    from backend.services.orchestrator import _sqlite
    stale = (datetime.utcnow() - timedelta(seconds=1)).isoformat() + "Z"
    with _sqlite.connection(env) as c:
        c.execute("UPDATE slack_oauth_states SET expires_at=? WHERE state=?",
                  (stale, state))
    _stub_exchange(monkeypatch)
    r = client.get("/v2/slack/oauth/callback",
                   params={"state": state, "code": AUTH_CODE}, follow_redirects=False)
    assert "reason=invalid_state" in r.headers["location"]
    assert sl_store.get_connection("p1") is None


def test_callback_cannot_bind_another_users_project(client, app, env, monkeypatch):
    """A state minted for B's project can never attach to A's project: the
    callback reads the target ONLY from the state."""
    _as(app, USER_B)
    state_b = client.post("/v2/slack/projects/pB/connect/start").json()["data"]["state"]
    _stub_exchange(monkeypatch)
    client.get("/v2/slack/oauth/callback",
               params={"state": state_b, "code": AUTH_CODE, "project_id": "p1"},
               follow_redirects=False)
    assert sl_store.get_connection("p1") is None
    assert sl_store.get_connection("pB").owner_user_id == "uB"


def test_callback_rejects_an_ownership_mismatch(client, app, env, monkeypatch):
    _as(app, USER_A)
    state = client.post("/v2/slack/projects/p1/connect/start").json()["data"]["state"]
    _stub_exchange(monkeypatch)
    # The project is reassigned mid-flow.
    from backend.services.orchestrator import _sqlite
    with _sqlite.connection(env) as c:
        c.execute("UPDATE projects SET owner_user_id='uB' WHERE id='p1'")
    r = client.get("/v2/slack/oauth/callback",
                   params={"state": state, "code": AUTH_CODE}, follow_redirects=False)
    assert "reason=ownership_mismatch" in r.headers["location"]
    assert sl_store.get_connection("p1") is None


def test_callback_reports_denied_consent(client, app, env):
    _as(app, USER_A)
    state = client.post("/v2/slack/projects/p1/connect/start").json()["data"]["state"]
    r = client.get("/v2/slack/oauth/callback",
                   params={"state": state, "error": "access_denied"},
                   follow_redirects=False)
    assert "reason=access_denied" in r.headers["location"]
    assert sl_store.get_connection("p1") is None


def test_callback_reports_a_missing_code(client, app, env):
    state = sl_setup.create_state(owner_user_id="uA", project_id="p1")
    r = client.get("/v2/slack/oauth/callback", params={"state": state},
                   follow_redirects=False)
    assert "reason=missing_code" in r.headers["location"]


def test_callback_reports_a_failed_exchange_without_leaking(client, app, env, monkeypatch):
    from backend.services.slack.errors import SlackOAuthError
    _as(app, USER_A)
    state = client.post("/v2/slack/projects/p1/connect/start").json()["data"]["state"]
    _stub_exchange(monkeypatch, exc=SlackOAuthError("nope", reason="invalid_code"))
    r = client.get("/v2/slack/oauth/callback",
                   params={"state": state, "code": AUTH_CODE}, follow_redirects=False)
    loc = r.headers["location"]
    assert "reason=exchange_failed" in loc
    assert SECRET not in loc and AUTH_CODE not in loc
    assert sl_store.get_connection("p1") is None


def test_callback_fails_closed_without_encryption(client, app, env, monkeypatch):
    _as(app, USER_A)
    state = client.post("/v2/slack/projects/p1/connect/start").json()["data"]["state"]
    _stub_exchange(monkeypatch)
    credential_crypto.set_cipher_for_tests(None)
    r = client.get("/v2/slack/oauth/callback",
                   params={"state": state, "code": AUTH_CODE}, follow_redirects=False)
    assert "reason=encryption_unavailable" in r.headers["location"]
    assert sl_store.get_connection("p1") is None


def test_callback_prepopulates_the_pending_channel_set(client, app, env, monkeypatch):
    _authorize(client, app, monkeypatch)
    pending = sl_setup.list_pending_channels("p1", owner_user_id="uA")
    # Archived channels never reach the picker.
    assert {p.channel_id for p in pending} == {"C_GENERAL", "C_PRODUCT", "C_LURKER"}


def test_a_provider_hiccup_while_prepopulating_is_not_fatal(client, app, env, monkeypatch):
    from backend.services.slack.errors import SlackServerError
    FakeClient.list_error = SlackServerError("down", status=500)
    _authorize(client, app, monkeypatch)
    assert sl_store.get_connection("p1") is not None   # the install still stored


# ── pending channels ─────────────────────────────────────────────────────────

def test_pending_channels_are_owner_only(client, app, env, monkeypatch):
    _authorize(client, app, monkeypatch)
    _as(app, USER_B)
    assert client.get("/v2/slack/projects/p1/pending-channels").status_code == 404


def test_pending_channels_return_display_metadata_only(client, app, env, monkeypatch):
    _authorize(client, app, monkeypatch)
    _as(app, USER_A)
    r = client.get("/v2/slack/projects/p1/pending-channels")
    assert r.status_code == 200
    data = r.json()["data"]
    assert data["count"] == 3
    assert data["max_selected"] == 10
    assert set(data["channels"][0]) == {"channel_id", "name", "is_private", "is_member"}
    body = json.dumps(r.json())
    assert BOT_TOKEN not in body and SECRET not in body


def test_pending_channels_surface_slack_membership_truth(client, app, env, monkeypatch):
    _authorize(client, app, monkeypatch)
    _as(app, USER_A)
    by_id = {c["channel_id"]: c for c in
             client.get("/v2/slack/projects/p1/pending-channels").json()["data"]["channels"]}
    assert by_id["C_GENERAL"]["is_member"] is True
    assert by_id["C_LURKER"]["is_member"] is False
    assert by_id["C_PRODUCT"]["is_private"] is True


def test_pending_channels_refresh_when_the_stored_set_is_empty(client, app, env,
                                                               monkeypatch):
    _authorize(client, app, monkeypatch)
    sl_setup.delete_pending_channels("p1")
    FakeClient.channels = [{"id": "C_NEW", "name": "fresh", "is_member": True,
                            "is_private": False, "is_archived": False}]
    _as(app, USER_A)
    r = client.get("/v2/slack/projects/p1/pending-channels")
    assert [c["channel_id"] for c in r.json()["data"]["channels"]] == ["C_NEW"]


def test_pending_channels_require_an_installation(client, app, env):
    _as(app, USER_A)
    r = client.get("/v2/slack/projects/p1/pending-channels")
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "NOT_CONNECTED"


def test_pending_channels_surface_a_provider_failure(client, app, env, monkeypatch):
    from backend.services.slack.errors import SlackServerError
    _authorize(client, app, monkeypatch)
    sl_setup.delete_pending_channels("p1")
    FakeClient.list_error = SlackServerError("down", status=500)
    _as(app, USER_A)
    r = client.get("/v2/slack/projects/p1/pending-channels")
    assert r.status_code == 502
    assert r.json()["detail"]["code"] == "SLACK_UNAVAILABLE"


def test_pending_channels_report_a_rate_limit_rather_than_an_empty_workspace(
        client, app, env, monkeypatch):
    from backend.services.slack.errors import SlackRateLimitError
    _authorize(client, app, monkeypatch)
    sl_setup.delete_pending_channels("p1")
    FakeClient.list_error = SlackRateLimitError("slow down", slack_error="ratelimited")
    _as(app, USER_A)
    r = client.get("/v2/slack/projects/p1/pending-channels")
    assert r.status_code == 429
    assert r.json()["detail"]["code"] == "SLACK_RATE_LIMITED"


def test_select_reports_a_rate_limit(client, app, env, monkeypatch):
    from backend.services.slack.errors import SlackRateLimitError
    _authorize(client, app, monkeypatch)
    FakeClient.info_error = SlackRateLimitError("slow down", slack_error="ratelimited")
    _as(app, USER_A)
    r = client.post("/v2/slack/projects/p1/connect/select",
                    json={"channel_ids": ["C_GENERAL"]})
    assert r.status_code == 429
    assert r.json()["detail"]["code"] == "SLACK_RATE_LIMITED"
    assert sl_store.get_connection("p1").is_connected is False


def test_pending_channels_report_a_revoked_installation(client, app, env, monkeypatch):
    _authorize(client, app, monkeypatch)
    sl_store.mark_revoked("p1")
    _as(app, USER_A)
    r = client.get("/v2/slack/projects/p1/pending-channels")
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "CONNECTION_REVOKED"


# ── connect/select (triple validation) ──────────────────────────────────────

def test_select_binds_multiple_revalidated_channels(client, app, env, monkeypatch):
    r = _connected(client, app, monkeypatch, channels=("C_GENERAL", "C_PRODUCT"))
    assert r.status_code == 200
    conn = r.json()["data"]["connection"]
    assert conn["connected"] is True
    assert {c["channel_id"] for c in conn["channels"]} == {"C_GENERAL", "C_PRODUCT"}
    assert conn["channel_count"] == 2
    assert conn["team_name"] == "Korvix HQ"
    assert BOT_TOKEN not in json.dumps(r.json())
    # The pending set is cleared once a choice is made.
    assert sl_setup.list_pending_channels("p1", owner_user_id="uA") == []


def test_select_rejects_a_channel_outside_the_pending_set(client, app, env, monkeypatch):
    """Arbitrary channel-id injection."""
    _authorize(client, app, monkeypatch)
    _as(app, USER_A)
    r = client.post("/v2/slack/projects/p1/connect/select",
                    json={"channel_ids": ["C_SOMEONE_ELSES_PRIVATE"]})
    # 400 (bad request body), not 404 — the project IS the caller's; only the
    # supplied id is invalid, and a 404 would render as "project not available".
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "NO_PENDING_CHANNEL"
    assert sl_store.get_connection("p1").is_connected is False


def test_select_refuses_a_channel_korvix_is_not_a_member_of(client, app, env, monkeypatch):
    """A bot can only read history of a channel it belongs to, so binding a
    non-member channel would claim access Korvix does not have."""
    _authorize(client, app, monkeypatch)
    _as(app, USER_A)
    r = client.post("/v2/slack/projects/p1/connect/select",
                    json={"channel_ids": ["C_LURKER"]})
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "CHANNEL_NOT_JOINED"
    assert sl_store.get_connection("p1").is_connected is False


def test_select_refuses_an_inaccessible_private_channel(client, app, env, monkeypatch):
    """A private channel the bot is not in is invisible to Slack's own lookup —
    the live revalidation is what catches a stale pending row."""
    _authorize(client, app, monkeypatch)
    FakeClient.channels = [c for c in FakeClient.channels if c["id"] != "C_PRODUCT"]
    _as(app, USER_A)
    r = client.post("/v2/slack/projects/p1/connect/select",
                    json={"channel_ids": ["C_PRODUCT"]})
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "CHANNEL_NOT_ACCESSIBLE"
    assert sl_store.get_connection("p1").is_connected is False


def test_select_refuses_an_archived_channel(client, app, env, monkeypatch):
    _authorize(client, app, monkeypatch)
    sl_setup.replace_pending_channels(
        project_id="p1", owner_user_id="uA",
        channels=[{"channel_id": "C_OLD", "name": "old", "is_member": True}])
    _as(app, USER_A)
    r = client.post("/v2/slack/projects/p1/connect/select",
                    json={"channel_ids": ["C_OLD"]})
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "CHANNEL_NOT_ACCESSIBLE"


def test_select_is_all_or_nothing(client, app, env, monkeypatch):
    """One bad id in the list must not partially bind the good ones."""
    _authorize(client, app, monkeypatch)
    _as(app, USER_A)
    r = client.post("/v2/slack/projects/p1/connect/select",
                    json={"channel_ids": ["C_GENERAL", "C_LURKER"]})
    assert r.status_code == 400
    assert sl_store.get_connection("p1").channels == ()


def test_select_enforces_the_channel_cap(client, app, env, monkeypatch):
    monkeypatch.setenv("SLACK_MAX_SELECTED_CHANNELS", "1")
    _authorize(client, app, monkeypatch)
    _as(app, USER_A)
    r = client.post("/v2/slack/projects/p1/connect/select",
                    json={"channel_ids": ["C_GENERAL", "C_PRODUCT"]})
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "TOO_MANY_CHANNELS"
    assert sl_store.get_connection("p1").is_connected is False


def test_select_rejects_an_empty_or_oversized_body(client, app, env, monkeypatch):
    _authorize(client, app, monkeypatch)
    _as(app, USER_A)
    assert client.post("/v2/slack/projects/p1/connect/select",
                       json={"channel_ids": []}).status_code == 422
    assert client.post("/v2/slack/projects/p1/connect/select",
                       json={"channel_ids": [" ", ""]}).status_code == 422
    assert client.post("/v2/slack/projects/p1/connect/select",
                       json={"channel_ids": [f"C{i}" for i in range(40)]}
                       ).status_code == 422


def test_select_is_owner_only(client, app, env, monkeypatch):
    _authorize(client, app, monkeypatch)
    _as(app, USER_B)
    r = client.post("/v2/slack/projects/p1/connect/select",
                    json={"channel_ids": ["C_GENERAL"]})
    assert r.status_code == 404
    assert sl_store.get_connection("p1").is_connected is False


def test_select_requires_an_installation(client, app, env):
    _as(app, USER_A)
    r = client.post("/v2/slack/projects/p1/connect/select",
                    json={"channel_ids": ["C_GENERAL"]})
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "NOT_CONNECTED"


def test_select_reports_a_revoked_installation(client, app, env, monkeypatch):
    from backend.services.slack.errors import SlackAuthError
    _authorize(client, app, monkeypatch)
    FakeClient.info_error = SlackAuthError("dead", slack_error="invalid_auth")
    _as(app, USER_A)
    r = client.post("/v2/slack/projects/p1/connect/select",
                    json={"channel_ids": ["C_GENERAL"]})
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "CONNECTION_REVOKED"


def test_reselecting_replaces_the_channel_set(client, app, env, monkeypatch):
    _connected(client, app, monkeypatch, channels=("C_GENERAL", "C_PRODUCT"))
    # The picker is re-populated from the live set for the "change" path.
    _as(app, USER_A)
    client.get("/v2/slack/projects/p1/pending-channels?refresh=true")
    r = client.post("/v2/slack/projects/p1/connect/select",
                    json={"channel_ids": ["C_PRODUCT"]})
    assert r.status_code == 200
    assert [c["channel_id"] for c in r.json()["data"]["connection"]["channels"]] == \
        ["C_PRODUCT"]


# ── connection status ────────────────────────────────────────────────────────

def test_connection_status_never_leaks_a_token(client, app, env, monkeypatch):
    _authorize(client, app, monkeypatch)
    _as(app, USER_A)
    r = client.get("/v2/slack/projects/p1/connection")
    body = json.dumps(r.json())
    assert BOT_TOKEN not in body and SECRET not in body
    assert "bot_token" not in body and "access_token" not in body
    data = r.json()["data"]
    assert data["connected"] is False                        # selection pending
    assert data["connection"]["needs_channel_selection"] is True
    assert data["connection"]["team_name"] == "Korvix HQ"


def test_connection_status_is_owner_scoped(client, app, env, monkeypatch):
    _authorize(client, app, monkeypatch)
    _as(app, USER_B)
    assert client.get("/v2/slack/projects/p1/connection").status_code == 404


def test_an_unconnected_project_reports_null(client, app, env):
    _as(app, USER_A)
    r = client.get("/v2/slack/projects/p1/connection")
    assert r.json()["data"] == {"connection": None, "connected": False}


# ── sync ─────────────────────────────────────────────────────────────────────

def test_sync_runs_and_reports_truthfully(client, app, env, monkeypatch):
    _connected(client, app, monkeypatch)
    monkeypatch.setattr(
        route_mod.sl_sync, "sync_connection",
        lambda conn, **k: sl_sync.SyncReport(project_id=conn.project_id,
                                             team_id=conn.team_id, channels=1,
                                             channels_read=1, messages=4,
                                             recorded=3, deduplicated=1))
    r = client.post("/v2/slack/projects/p1/sync")
    assert r.status_code == 200
    sync = r.json()["data"]["sync"]
    assert (sync["recorded"], sync["deduplicated"], sync["ok"]) == (3, 1, True)


def test_sync_reports_a_partial_failure_truthfully(client, app, env, monkeypatch):
    _connected(client, app, monkeypatch)
    monkeypatch.setattr(
        route_mod.sl_sync, "sync_connection",
        lambda conn, **k: sl_sync.SyncReport(
            project_id=conn.project_id, team_id=conn.team_id, channels=2,
            channels_read=1, errors={"channel:C_PRODUCT": "SlackAccessError (not_in_channel)"}))
    sync = client.post("/v2/slack/projects/p1/sync").json()["data"]["sync"]
    assert sync["ok"] is False
    assert sync["errors"]["channel:C_PRODUCT"].startswith("SlackAccessError")


def test_sync_requires_selected_channels(client, app, env, monkeypatch):
    _authorize(client, app, monkeypatch)
    _as(app, USER_A)
    r = client.post("/v2/slack/projects/p1/sync")
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "CHANNEL_SELECTION_REQUIRED"


def test_sync_requires_a_connection(client, app, env):
    _as(app, USER_A)
    r = client.post("/v2/slack/projects/p1/sync")
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "NOT_CONNECTED"


def test_sync_reports_a_revoked_installation(client, app, env, monkeypatch):
    _connected(client, app, monkeypatch)
    sl_store.mark_revoked("p1")
    r = client.post("/v2/slack/projects/p1/sync")
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "CONNECTION_REVOKED"


def test_sync_reports_a_token_that_died_mid_sync(client, app, env, monkeypatch):
    _connected(client, app, monkeypatch)

    def _dies(conn, **_k):
        sl_store.mark_revoked(conn.project_id)
        return sl_sync.SyncReport(project_id=conn.project_id, team_id=conn.team_id,
                                  errors={"connection": "SlackAuthError (invalid_auth)"})

    monkeypatch.setattr(route_mod.sl_sync, "sync_connection", _dies)
    r = client.post("/v2/slack/projects/p1/sync")
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "CONNECTION_REVOKED"


def test_sync_is_owner_scoped(client, app, env, monkeypatch):
    _connected(client, app, monkeypatch)
    _as(app, USER_B)
    assert client.post("/v2/slack/projects/p1/sync").status_code == 404


def test_project_a_cannot_ingest_slack_observations_into_project_b(
        client, app, env, monkeypatch):
    """Sync writes and the caller reads only within their own (user, project)."""
    _connected(client, app, monkeypatch)
    obs.record_observation(user_id="uB", project_id="pB", source="slack",
                           kind="slack.message.created", summary="B's chat",
                           external_id="slack:message:T:C:1.0")

    def _writes(conn, **_k):
        obs.record_observation(user_id=conn.owner_user_id, project_id=conn.project_id,
                               source="slack", kind="slack.message.created",
                               summary="A's chat", external_id="slack:message:T:C:2.0")
        return sl_sync.SyncReport(project_id=conn.project_id, team_id=conn.team_id,
                                  recorded=1)

    monkeypatch.setattr(route_mod.sl_sync, "sync_connection", _writes)
    client.post("/v2/slack/projects/p1/sync")
    assert [o["summary"] for o in obs.list_observations("p1", user_id="uA")] == ["A's chat"]
    assert [o["summary"] for o in obs.list_observations("pB", user_id="uB")] == ["B's chat"]
    assert obs.list_observations("p1", user_id="uB") == []


# ── disconnect ───────────────────────────────────────────────────────────────

def test_disconnect_removes_local_state_only(client, app, env, monkeypatch):
    _connected(client, app, monkeypatch)
    r = client.delete("/v2/slack/projects/p1/connection")
    assert r.status_code == 200
    assert r.json()["data"] == {"removed": True, "connected": False,
                                "workspace_still_connected": False}
    assert sl_store.get_connection("p1") is None
    assert sl_setup.list_pending_channels("p1", owner_user_id="uA") == []


def test_disconnect_is_idempotent(client, app, env):
    _as(app, USER_A)
    r = client.delete("/v2/slack/projects/p1/connection")
    assert r.json()["data"]["removed"] is False


def test_disconnect_cannot_touch_another_users_connector(client, app, env, monkeypatch):
    _connected(client, app, monkeypatch)
    _as(app, USER_B)
    assert client.delete("/v2/slack/projects/p1/connection").status_code == 404
    assert sl_store.get_connection("p1") is not None


def test_disconnect_never_breaks_a_sibling_project_on_the_same_workspace(
        client, app, env, monkeypatch):
    """Slack installs an app once per workspace, so a remote revoke here would
    break every other Korvix project bound to it. Disconnect is local-only and
    says so truthfully."""
    _connected(client, app, monkeypatch, channels=("C_GENERAL",))
    _connected(client, app, monkeypatch, project_id="pB", user=USER_B,
               channels=("C_GENERAL",))

    _as(app, USER_A)
    r = client.delete("/v2/slack/projects/p1/connection")
    assert r.json()["data"]["workspace_still_connected"] is True
    sibling = sl_store.get_connection("pB")
    assert sibling is not None and sibling.is_connected is True
    assert sl_store.decrypt_bot_token(sibling) == BOT_TOKEN


# ── no mutation surface ──────────────────────────────────────────────────────

def test_router_exposes_no_slack_mutation_route(app):
    """The whole /v2/slack surface must contain no post/send/invite/archive/
    react/file path — read + local connection management only."""
    paths = {r.path for r in route_mod.router.routes}
    for forbidden in ("message", "post", "send", "invite", "kick", "archive",
                      "rename", "reaction", "file", "upload", "webhook",
                      "events", "revoke"):
        assert not any(forbidden in p for p in paths), f"{forbidden} route exists"
    deletes = [r.path for r in route_mod.router.routes
               if "DELETE" in getattr(r, "methods", set())]
    assert deletes == ["/v2/slack/projects/{project_id}/connection"]


def test_the_route_module_never_calls_a_model_or_a_scheduler():
    import inspect
    src = inspect.getsource(route_mod).split('"""', 2)[-1].lower()
    for forbidden in ("openai", "anthropic", "embedding", "celery", "cron",
                      "background_tasks"):
        assert forbidden not in src


def test_a_connection_owned_by_another_account_fails_closed(client, app, env,
                                                            monkeypatch):
    """`owner_user_id` on the connection row is what scopes every ingested
    observation. If it ever diverged from the project's current owner, a sync
    would file this project's Slack activity under a user who no longer owns it —
    so every read/write path refuses, and only disconnect stays available."""
    _connected(client, app, monkeypatch)
    from backend.services.orchestrator import _sqlite
    with _sqlite.connection(env) as c:
        c.execute("UPDATE slack_connections SET owner_user_id='uSTALE' WHERE project_id='p1'")
    _as(app, USER_A)
    for call in (
        lambda: client.get("/v2/slack/projects/p1/pending-channels"),
        lambda: client.post("/v2/slack/projects/p1/connect/select",
                            json={"channel_ids": ["C_GENERAL"]}),
        lambda: client.post("/v2/slack/projects/p1/sync"),
    ):
        r = call()
        assert r.status_code == 409
        assert r.json()["detail"]["code"] == "CONNECTION_OWNER_MISMATCH"
    # ...and the owner can still clear the stale row.
    assert client.delete("/v2/slack/projects/p1/connection").status_code == 200
    assert sl_store.get_connection("p1") is None


def test_regular_authenticated_users_can_use_the_connector(client, app, env, monkeypatch):
    """The connector is NOT owner-only: any authenticated user may connect a
    project they own. Ownership — not a role — is the security boundary."""
    projects_store.create_project("uB", name="B's own", project_id="pB2")
    _as(app, USER_B)
    assert client.post("/v2/slack/projects/pB2/connect/start").status_code == 200
    assert client.get("/v2/slack/projects/pB2/connection").status_code == 200
