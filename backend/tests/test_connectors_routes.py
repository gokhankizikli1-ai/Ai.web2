# coding: utf-8
"""/v2/connectors — the ACCOUNT-LEVEL HTTP surface + adversarial coverage.

The account-level model removes repeated OAuth, which means a single mistake here
would let one account reach another's provider grant. These tests pin the
boundaries rather than the happy path:

  * every route is authenticated, and identity comes ONLY from the server
    session — no route reads an owner or authorization id from the client;
  * a project the caller does not own is existence-hidden (404), for both
    binding and unbinding;
  * a second project binds WITHOUT any OAuth;
  * unbinding one project never disconnects the provider for the others;
  * account disconnect reports how many projects it affects, and takes them all;
  * sync is BINDING-level: it only touches projects the caller owns, and an
    account-level authorization with no bindings syncs nothing at all;
  * no response ever carries credential material.
"""
from __future__ import annotations

import json

import pytest

from backend.core import deps
from backend.services.auth.identity import User
from backend.services.connectors import store as shared
from backend.services.gmail import crypto as credential_crypto
from backend.services.gmail import store as gm_store
from backend.services.orchestrator import observations_store as obs
from backend.services.projects import store as projects_store
from backend.services.slack import setup_state as sl_setup
from backend.services.slack import store as sl_store

USER_A = User(id="uA", kind="email", external_id="email:a@x.com", display_name="A")
USER_B = User(id="uB", kind="email", external_id="email:b@x.com", display_name="B")


@pytest.fixture()
def env(tmp_path, monkeypatch, app):
    path = str(tmp_path / "projects.db")
    monkeypatch.setenv("PROJECTS_DB_PATH", path)
    monkeypatch.setenv("ENABLE_GMAIL_CONNECTOR", "true")
    monkeypatch.setenv("ENABLE_SLACK_CONNECTOR", "true")
    monkeypatch.setenv("GMAIL_OAUTH_CLIENT_ID", "client.apps.googleusercontent.com")
    monkeypatch.setenv("GMAIL_OAUTH_CLIENT_SECRET", "gmail-secret")
    monkeypatch.setenv("GMAIL_OAUTH_REDIRECT_URI",
                       "https://backend.example.com/v2/gmail/oauth/callback")
    for mod in (projects_store, obs, sl_setup):
        monkeypatch.setattr(mod, "DB_PATH", path, raising=False)
    projects_store.init()
    shared._reset_for_tests(); shared.init_tables()
    obs.init_observations_table()
    credential_crypto.set_cipher_for_tests(credential_crypto._ReversibleTestCipher())
    projects_store.create_project("uA", name="Proj A", project_id="pA1")
    projects_store.create_project("uA", name="Proj A2", project_id="pA2")
    projects_store.create_project("uB", name="Proj B", project_id="pB1")
    yield path
    credential_crypto.set_cipher_for_tests(None)
    app.dependency_overrides.clear()


def _as(app, user):
    app.dependency_overrides[deps.require_auth] = lambda: user


def _authorize_gmail(owner="uA", email="me@x.com"):
    return gm_store.authorize_account(
        owner_user_id=owner, google_email=email, scopes="gmail.readonly",
        refresh_token="RT", access_token="AT")


# ── auth ─────────────────────────────────────────────────────────────────────

def test_every_route_requires_authentication(client, env, app):
    """No dependency override → real require_auth → guest → MissingTokenError.
    (The default test app ships without the v2 envelope handler, so that
    surfaces as a 500 rather than a 401; the security-relevant fact is that the
    route REJECTS and performs NO side effect for a guest.)"""
    app.dependency_overrides.clear()
    for method, path in (
        ("get", "/v2/connectors"),
        ("get", "/v2/connectors/gmail"),
        ("post", "/v2/connectors/gmail/connect/start"),
        ("get", "/v2/connectors/gmail/projects"),
        ("put", "/v2/connectors/gmail/projects/pA1"),
        ("delete", "/v2/connectors/gmail/projects/pA1"),
        ("delete", "/v2/connectors/gmail"),
        ("post", "/v2/connectors/gmail/sync"),
    ):
        r = getattr(client, method)(path)
        assert r.status_code >= 400, f"{method} {path} was reachable unauthenticated"
        assert r.status_code != 302, f"{method} {path} redirected a guest"
    # …and nothing was created on the way.
    assert shared.list_authorizations("uA") == []
    assert shared.list_project_bindings("pA1") == []


def test_unknown_provider_is_404(client, env, app):
    _as(app, USER_A)
    assert client.get("/v2/connectors/notaprovider").status_code == 404
    assert client.delete("/v2/connectors/notaprovider").status_code == 404


# ── account overview ─────────────────────────────────────────────────────────

def test_overview_lists_every_connector_with_account_state(client, env, app):
    _as(app, USER_A)
    r = client.get("/v2/connectors")
    assert r.status_code == 200
    rows = r.json()["data"]["connectors"]
    providers = [c["provider"] for c in rows]
    assert providers == ["gmail", "calendar", "github", "vercel", "slack"]
    # Nothing authorized yet — and no project dropdown is needed to say so.
    assert all(c["authorization"] is None for c in rows)
    # Providers describe their REAL resource shape.
    kinds = {c["provider"]: c["resource_kind"] for c in rows}
    assert kinds["gmail"] == "account" and kinds["slack"] == "multi"


def test_overview_reports_usage_and_never_a_credential(client, env, app):
    auth = _authorize_gmail()
    gm_store.bind_project(project_id="pA1", owner_user_id="uA", authorization_id=auth.id)
    _as(app, USER_A)
    r = client.get("/v2/connectors")
    body = json.dumps(r.json())
    gmail = next(c for c in r.json()["data"]["connectors"] if c["provider"] == "gmail")
    assert gmail["authorization"]["account_label"] == "me@x.com"
    assert gmail["authorization"]["project_count"] == 1
    assert gmail["authorization"]["projects"][0]["project_name"] == "Proj A"
    # No token material, and not even the encrypted envelope, is exposed.
    assert "RT" not in body and "credentials" not in body and "f1:" not in body


def test_overview_never_shows_another_owners_authorization(client, env, app):
    _authorize_gmail(owner="uB", email="b@x.com")
    _as(app, USER_A)
    r = client.get("/v2/connectors")
    gmail = next(c for c in r.json()["data"]["connectors"] if c["provider"] == "gmail")
    assert gmail["authorization"] is None
    assert "b@x.com" not in json.dumps(r.json())


# ── authorize once, bind many ────────────────────────────────────────────────

def test_second_project_binds_without_any_oauth(client, env, app):
    auth = _authorize_gmail()
    _as(app, USER_A)

    r1 = client.put("/v2/connectors/gmail/projects/pA1")
    assert r1.status_code == 200
    r2 = client.put("/v2/connectors/gmail/projects/pA2")
    assert r2.status_code == 200
    # Still ONE grant.
    assert len(shared.list_authorizations("uA", provider="gmail")) == 1
    assert shared.count_project_bindings(auth.id) == 2
    # Neither response asked the browser to go anywhere.
    for r in (r1, r2):
        assert "authorization_url" not in json.dumps(r.json())


def test_binding_a_project_you_do_not_own_is_existence_hidden(client, env, app):
    _authorize_gmail()
    _as(app, USER_A)
    r = client.put("/v2/connectors/gmail/projects/pB1")
    assert r.status_code == 404
    assert gm_store.get_connection("pB1") is None


def test_unbinding_a_project_you_do_not_own_is_existence_hidden(client, env, app):
    b_auth = _authorize_gmail(owner="uB", email="b@x.com")
    gm_store.bind_project(project_id="pB1", owner_user_id="uB", authorization_id=b_auth.id)
    _as(app, USER_A)
    r = client.delete("/v2/connectors/gmail/projects/pB1")
    assert r.status_code == 404
    # B's binding is untouched.
    assert gm_store.get_connection("pB1") is not None


def test_binding_without_an_authorization_is_a_clean_conflict(client, env, app):
    _as(app, USER_A)
    r = client.put("/v2/connectors/gmail/projects/pA1")
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "NOT_AUTHORIZED"


def test_a_disabled_connector_refuses_to_bind(client, env, app, monkeypatch):
    _authorize_gmail()
    monkeypatch.setenv("ENABLE_GMAIL_CONNECTOR", "false")
    _as(app, USER_A)
    r = client.put("/v2/connectors/gmail/projects/pA1")
    assert r.status_code == 503


# ── project access listing ───────────────────────────────────────────────────

def test_project_list_shows_only_the_callers_projects(client, env, app):
    auth = _authorize_gmail()
    gm_store.bind_project(project_id="pA1", owner_user_id="uA", authorization_id=auth.id)
    _as(app, USER_A)
    data = client.get("/v2/connectors/gmail/projects").json()["data"]
    ids = [p["project_id"] for p in data["projects"]]
    assert set(ids) == {"pA1", "pA2"}
    assert "pB1" not in ids
    bound = {p["project_id"]: p["bound"] for p in data["projects"]}
    assert bound == {"pA1": True, "pA2": False}


# ── remove-from-project vs disconnect-account ────────────────────────────────

def test_removing_one_project_leaves_the_others_connected(client, env, app):
    auth = _authorize_gmail()
    _as(app, USER_A)
    client.put("/v2/connectors/gmail/projects/pA1")
    client.put("/v2/connectors/gmail/projects/pA2")

    r = client.delete("/v2/connectors/gmail/projects/pA1")
    assert r.status_code == 200
    data = r.json()["data"]
    assert data["removed"] is True
    assert data["authorization_still_connected"] is True
    assert data["remaining_projects"] == 1
    assert gm_store.get_connection("pA1") is None
    assert gm_store.get_connection("pA2") is not None
    assert shared.get_authorization(auth.id) is not None


def test_account_disconnect_reports_and_removes_every_binding(client, env, app):
    auth = _authorize_gmail()
    _as(app, USER_A)
    client.put("/v2/connectors/gmail/projects/pA1")
    client.put("/v2/connectors/gmail/projects/pA2")

    r = client.delete("/v2/connectors/gmail")
    assert r.status_code == 200
    data = r.json()["data"]
    assert data["removed"] is True
    # The number the confirmation dialog has to show.
    assert data["projects_affected"] == 2
    assert shared.get_authorization(auth.id) is None
    assert gm_store.get_connection("pA1") is None
    assert gm_store.get_connection("pA2") is None


def test_account_disconnect_never_touches_another_owner(client, env, app):
    a = _authorize_gmail(owner="uA", email="shared@x.com")
    b = _authorize_gmail(owner="uB", email="shared@x.com")
    gm_store.bind_project(project_id="pB1", owner_user_id="uB", authorization_id=b.id)
    _as(app, USER_A)
    client.put("/v2/connectors/gmail/projects/pA1")

    assert client.delete("/v2/connectors/gmail").status_code == 200
    assert shared.get_authorization(a.id) is None
    assert shared.get_authorization(b.id) is not None
    assert gm_store.get_connection("pB1") is not None


def test_disconnecting_a_connector_that_was_never_connected_is_a_clean_noop(client, env, app):
    _as(app, USER_A)
    r = client.delete("/v2/connectors/gmail")
    assert r.status_code == 200
    assert r.json()["data"] == {
        "removed": False, "authorized": False, "revoked_remotely": False,
        "projects_affected": 0,
    }


# ── sync scoping ─────────────────────────────────────────────────────────────

def test_sync_of_an_unused_authorization_touches_nothing(client, env, app):
    _authorize_gmail()
    _as(app, USER_A)
    r = client.post("/v2/connectors/gmail/sync")
    assert r.status_code == 200
    # An ACCOUNT-level authorization must never produce account-global reads.
    assert r.json()["data"]["projects"] == 0
    assert r.json()["data"]["results"] == []


def test_sync_only_visits_projects_the_caller_owns(client, env, app, monkeypatch):
    """Defence in depth: even if a binding's denormalized owner drifted, sync
    re-checks the project's CURRENT owner before reading anything into it."""
    auth = _authorize_gmail()
    gm_store.bind_project(project_id="pA1", owner_user_id="uA", authorization_id=auth.id)
    # A binding that points at a project owned by someone else.
    shared.set_binding(
        project_id="pB1", authorization_id=auth.id, owner_user_id="uA",
        resources=[{"resource_id": "", "resource_label": "", "resource": {}}],
    )

    visited = []
    from backend.services.gmail import sync as gm_sync

    class _Report:
        def as_dict(self):
            return {"ok": True}

    def _fake_sync(conn):
        visited.append(conn.project_id)
        return _Report()

    monkeypatch.setattr(gm_sync, "sync_connection", _fake_sync)
    _as(app, USER_A)
    r = client.post("/v2/connectors/gmail/sync")
    assert r.status_code == 200
    assert visited == ["pA1"], "sync must skip a project the caller does not own"


def test_sync_reports_a_project_that_still_needs_resource_selection(client, env, app):
    conn = sl_store.upsert_installation(
        project_id="pA1", owner_user_id="uA", bot_token="xoxb", team_id="T1")
    assert conn is not None and conn.needs_channel_selection
    _as(app, USER_A)
    r = client.post("/v2/connectors/slack/sync")
    assert r.status_code == 200
    results = r.json()["data"]["results"]
    assert results == [{"project_id": "pA1", "ok": False,
                        "reason": "needs_resource_selection"}]


# ── account-level connect start ──────────────────────────────────────────────

def test_connect_start_mints_a_project_less_state_bound_to_the_caller(client, env, app):
    from backend.services.gmail import state_store as gm_state
    _as(app, USER_A)
    r = client.post("/v2/connectors/gmail/connect/start")
    assert r.status_code == 200
    state = r.json()["data"]["state"]
    assert r.json()["data"]["authorization_url"].startswith("https://")
    consumed = gm_state.consume(state)
    assert consumed is not None
    assert consumed.owner_user_id == "uA"
    # No project — that is what makes it an ACCOUNT authorization.
    assert consumed.project_id == ""


def test_connect_start_fails_closed_without_credential_encryption(client, env, app):
    credential_crypto.set_cipher_for_tests(None)
    _as(app, USER_A)
    r = client.post("/v2/connectors/gmail/connect/start")
    assert r.status_code == 503
    assert r.json()["detail"]["code"] == "CREDENTIAL_ENCRYPTION_NOT_CONFIGURED"


def test_connect_start_on_a_disabled_connector_is_503(client, env, app, monkeypatch):
    monkeypatch.setenv("ENABLE_GMAIL_CONNECTOR", "false")
    _as(app, USER_A)
    assert client.post("/v2/connectors/gmail/connect/start").status_code == 503


# ── no mutation surface toward providers ─────────────────────────────────────

def test_router_exposes_no_provider_write_capability(env):
    """This router coordinates Korvix-side state only. It must never grow a path
    that sends, posts, deploys or otherwise writes to a provider."""
    import inspect
    from backend.routes import v2_connectors as route_mod
    src = inspect.getsource(route_mod).split('"""', 2)[-1].lower()
    for forbidden in ("send_message", "create_deployment", "post_message",
                      "send_email", "openai", "anthropic"):
        assert forbidden not in src
