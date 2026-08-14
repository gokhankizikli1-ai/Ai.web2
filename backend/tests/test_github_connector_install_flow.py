# coding: utf-8
"""GitHub connector — install-flow (real GitHub App installation UX) + the
install-time identity verification that defeats installation_id spoofing.

Trust chain proven per callback: valid state (CSRF/owner/project) → project owner
re-check → OAuth code → GitHub USER identity → installation belongs to OUR App →
the USER may access that installation (GET /user/installations). Adversarial
matrix: wrong owner, expired/replayed state, forged installation id, an
installation belonging to ANOTHER GitHub account (the spoofing attack), missing/
bad OAuth code, repo-not-in-installation, duplicate repo/project claim, open-
redirect prevention, no token leakage.

All GitHub App API + OAuth seams are faked — no real GitHub call, no crypto.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta

import pytest

from backend.core import deps
from backend.services.auth.identity import User
from backend.services.github import app_api as gh_app
from backend.services.github import setup_state as gh_setup
from backend.services.github import store as gh_store
from backend.services.github import user_auth as gh_user
from backend.services.github.errors import GitHubAuthError, GitHubNotFoundError
from backend.services.projects import store as projects_store

USER_A = User(id="uA", kind="email", external_id="email:a@x.com", display_name="A")
USER_B = User(id="uB", kind="email", external_id="email:b@x.com", display_name="B")

REPO = {"id": "42", "full_name": "octo/hello", "name": "hello",
        "owner": "octo", "private": False, "archived": False}
# Installation the initiating Korvix user (uA / GitHub "code-A") actually owns.
OWN_INSTALL = "100"
# A DIFFERENT real Korvix-AI installation, belonging to another GitHub account —
# the id an attacker might substitute into the callback.
FOREIGN_INSTALL = "200"
GOOD_CODE = "code-A"


@pytest.fixture()
def env(tmp_path, monkeypatch, app):
    path = str(tmp_path / "projects.db")
    monkeypatch.setenv("PROJECTS_DB_PATH", path)
    monkeypatch.setenv("ENABLE_GITHUB_CONNECTOR", "true")
    monkeypatch.setenv("GITHUB_APP_ID", "123")
    monkeypatch.setenv("GITHUB_APP_PRIVATE_KEY", "dummy-key")
    monkeypatch.setenv("GITHUB_APP_SLUG", "korvix-ai")
    # User-to-server OAuth (identity verification) must be configured for the
    # install flow to run at all.
    monkeypatch.setenv("GITHUB_APP_CLIENT_ID", "cid")
    monkeypatch.setenv("GITHUB_APP_CLIENT_SECRET", "csecret")
    monkeypatch.setenv("GITHUB_FRONTEND_RESULT_URL", "https://app.example.com")
    monkeypatch.setenv("GITHUB_FRONTEND_RESULT_PATH", "/#/settings/integrations")
    monkeypatch.setenv("GITHUB_HTML_BASE", "https://github.com")
    for mod in (projects_store, gh_store, gh_setup):
        monkeypatch.setattr(mod, "DB_PATH", path, raising=False)
    projects_store._reset_for_tests(); projects_store.init()
    gh_store._reset_for_tests(); gh_store.init_github_tables()
    gh_setup._reset_for_tests(); gh_setup.init_github_setup_tables()
    projects_store.create_project("uA", name="Proj A", project_id="p1")

    # BOTH installations are real installations of OUR App (so the App-JWT check
    # passes for each). The difference is which GitHub USER may access them.
    def fake_get_installation(inst):
        if str(inst) in (OWN_INSTALL, FOREIGN_INSTALL):
            return {"id": int(inst), "app_id": "123", "account": {"login": "octo"}}
        raise GitHubNotFoundError(f"installation {inst} not our app")

    def fake_list_repositories(inst):
        return [dict(REPO)] if str(inst) == OWN_INSTALL else []

    def fake_exchange(code):
        if code == GOOD_CODE:
            return "utok-A"          # identifies GitHub user A
        raise GitHubAuthError("bad or expired code")

    # User A can access ONLY their own installation (100), NOT the foreign one.
    def fake_list_user_installs(token):
        return {OWN_INSTALL} if token == "utok-A" else set()

    monkeypatch.setattr(gh_app, "get_installation", fake_get_installation)
    monkeypatch.setattr(gh_app, "list_repositories", fake_list_repositories)
    monkeypatch.setattr(gh_user, "exchange_code_for_user_token", fake_exchange)
    monkeypatch.setattr(gh_user, "list_user_installation_ids", fake_list_user_installs)
    yield path
    app.dependency_overrides.clear()


def _as(app, user):
    app.dependency_overrides[deps.require_auth] = lambda: user


def _start(client, app, user=USER_A, project="p1"):
    _as(app, user)
    return client.post(f"/v2/github/projects/{project}/connect/start")


def _mint_state(project="p1", owner="uA"):
    return gh_setup.create_state(owner_user_id=owner, project_id=project)


def _callback(client, *, state, installation_id=OWN_INSTALL, code=GOOD_CODE, **extra):
    params = {"state": state, "setup_action": "install", **extra}
    if installation_id is not None:
        params["installation_id"] = installation_id
    if code is not None:
        params["code"] = code
    return client.get("/v2/github/setup/callback", params=params, follow_redirects=False)


# ── connect/start ─────────────────────────────────────────────────────────────

def test_disabled_returns_503(client, app, env, monkeypatch):
    monkeypatch.setenv("ENABLE_GITHUB_CONNECTOR", "false")
    _as(app, USER_A)
    assert client.post("/v2/github/projects/p1/connect/start").status_code == 503


def test_connect_start_returns_install_url_and_state(client, app, env):
    r = _start(client, app)
    assert r.status_code == 200
    data = r.json()["data"]
    assert "github.com/apps/korvix-ai/installations/new" in data["install_url"]
    assert data["state"] and f"state={data['state']}" in data["install_url"]


def test_connect_start_foreign_project_404(client, app, env):
    assert _start(client, app, user=USER_B).status_code == 404


def test_connect_start_fails_closed_without_user_oauth(client, app, env, monkeypatch):
    # Without the OAuth client id/secret the flow cannot verify the installing
    # user — connect/start must fail closed rather than fall back to trusting the
    # callback installation_id.
    monkeypatch.delenv("GITHUB_APP_CLIENT_ID", raising=False)
    monkeypatch.delenv("GITHUB_APP_CLIENT_SECRET", raising=False)
    r = _start(client, app)
    assert r.status_code == 503
    assert r.json()["detail"]["code"] == "GITHUB_APP_NOT_CONFIGURED"


def test_connect_start_fails_closed_without_slug(client, app, env, monkeypatch):
    monkeypatch.delenv("GITHUB_APP_SLUG", raising=False)
    monkeypatch.delenv("GITHUB_APP_INSTALL_URL", raising=False)
    assert _start(client, app).status_code == 503


def test_connect_start_unauthenticated_rejected(client, app, env):
    r = client.post("/v2/github/projects/p1/connect/start")
    assert r.status_code >= 400 and r.status_code != 302
    from backend.services.orchestrator import _sqlite
    with _sqlite.connection(env) as c:
        n = c.execute("SELECT COUNT(*) AS n FROM github_setup_states").fetchone()["n"]
    assert n == 0


# ── setup callback — happy path + identity verification ───────────────────────

def test_callback_happy_path_stores_pending_and_redirects(client, app, env):
    state = _start(client, app).json()["data"]["state"]
    r = _callback(client, state=state)
    assert r.status_code == 302
    loc = r.headers["location"]
    assert loc.startswith("https://app.example.com/#/settings/integrations")
    assert "github=installed" in loc and "project_id=p1" in loc
    pending = gh_setup.get_pending_installation("p1", owner_user_id="uA")
    assert pending is not None and pending.installation_id == OWN_INSTALL
    assert gh_store.get_connection("p1") is None
    # No token / no raw installation id leaked into the redirect.
    assert "utok" not in loc and "installation_id" not in loc


def test_callback_foreign_installation_is_rejected_SPOOFING(client, app, env):
    # THE anti-spoofing test: user A presents a VALID state and a real Korvix-AI
    # installation (200) that belongs to ANOTHER GitHub account. state is valid,
    # the installation belongs to our App — but A is NOT authorized for it, so it
    # MUST be rejected and NOTHING is bound.
    state = _mint_state()
    r = _callback(client, state=state, installation_id=FOREIGN_INSTALL)
    assert "reason=installation_not_authorized" in r.headers["location"]
    assert gh_setup.get_pending_installation("p1", owner_user_id="uA") is None
    assert gh_store.get_connection("p1") is None


def test_callback_missing_code_rejected(client, app, env):
    state = _mint_state()
    r = _callback(client, state=state, code=None)
    assert "reason=user_auth_required" in r.headers["location"]
    assert gh_setup.get_pending_installation("p1", owner_user_id="uA") is None


def test_callback_bad_code_rejected(client, app, env):
    state = _mint_state()
    r = _callback(client, state=state, code="bad-code")
    assert "reason=user_auth_failed" in r.headers["location"]
    assert gh_setup.get_pending_installation("p1", owner_user_id="uA") is None


def test_callback_invalid_state_rejected(client, app, env):
    r = _callback(client, state="forged")
    assert "reason=invalid_state" in r.headers["location"]
    assert gh_setup.get_pending_installation("p1", owner_user_id="uA") is None


def test_callback_replayed_state_rejected(client, app, env):
    state = _mint_state()
    assert "github=installed" in _callback(client, state=state).headers["location"]
    assert "reason=invalid_state" in _callback(client, state=state).headers["location"]


def test_callback_expired_state_rejected(client, app, env):
    state = _mint_state()
    from backend.services.orchestrator import _sqlite
    past = (datetime.utcnow() - timedelta(minutes=30)).isoformat() + "Z"
    with _sqlite.connection(env) as c:
        c.execute("UPDATE github_setup_states SET expires_at=? WHERE state=?", (past, state))
    assert "reason=invalid_state" in _callback(client, state=state).headers["location"]


def test_callback_forged_installation_not_our_app_rejected(client, app, env):
    state = _mint_state()
    r = _callback(client, state=state, installation_id="999999")   # not our App
    assert "reason=installation_unverified" in r.headers["location"]
    assert gh_setup.get_pending_installation("p1", owner_user_id="uA") is None


def test_callback_missing_installation(client, app, env):
    state = _mint_state()
    r = _callback(client, state=state, installation_id=None)
    assert "reason=missing_installation" in r.headers["location"]


def test_callback_ownership_mismatch_rejected(client, app, env):
    state = _mint_state()
    from backend.services.orchestrator import _sqlite
    with _sqlite.connection(env) as c:
        c.execute("UPDATE projects SET owner_user_id=? WHERE id=?", ("uB", "p1"))
    r = _callback(client, state=state)
    assert "reason=ownership_mismatch" in r.headers["location"]


def test_callback_disabled_redirects_error(client, app, env, monkeypatch):
    monkeypatch.setenv("ENABLE_GITHUB_CONNECTOR", "false")
    r = _callback(client, state="x")
    assert "reason=disabled" in r.headers["location"]


# ── pending repositories ──────────────────────────────────────────────────────

def _install(client, app):
    _callback(client, state=_mint_state())


def test_pending_repos_owner_lists_repositories(client, app, env):
    _install(client, app)
    _as(app, USER_A)
    r = client.get("/v2/github/projects/p1/pending-installation/repositories")
    assert r.status_code == 200
    assert [x["full_name"] for x in r.json()["data"]["repositories"]] == ["octo/hello"]
    assert "token" not in json.dumps(r.json()).lower()


def test_pending_repos_foreign_user_404(client, app, env):
    _install(client, app)
    _as(app, USER_B)
    assert client.get("/v2/github/projects/p1/pending-installation/repositories").status_code == 404


def test_pending_repos_without_pending_404(client, app, env):
    _as(app, USER_A)
    r = client.get("/v2/github/projects/p1/pending-installation/repositories")
    assert r.status_code == 404 and r.json()["detail"]["code"] == "NO_PENDING_INSTALL"


# ── connect/select (finalize) ─────────────────────────────────────────────────

def test_select_happy_path_connects_and_clears_pending(client, app, env):
    _install(client, app)
    _as(app, USER_A)
    r = client.post("/v2/github/projects/p1/connect/select", json={"repo_full_name": "octo/hello"})
    assert r.status_code == 200
    conn = r.json()["data"]["connection"]
    assert conn["repo_full_name"] == "octo/hello" and conn["installation_id"] == OWN_INSTALL
    assert "token" not in json.dumps(r.json()).lower()
    assert gh_setup.get_pending_installation("p1", owner_user_id="uA") is None
    assert gh_store.get_connection("p1").repo_full_name == "octo/hello"


def test_select_repo_not_in_installation_rejected(client, app, env):
    _install(client, app)
    _as(app, USER_A)
    r = client.post("/v2/github/projects/p1/connect/select", json={"repo_full_name": "octo/other"})
    assert r.status_code == 400 and r.json()["detail"]["code"] == "REPO_NOT_IN_INSTALLATION"
    assert gh_store.get_connection("p1") is None


def test_select_without_pending_409(client, app, env):
    _as(app, USER_A)
    assert client.post("/v2/github/projects/p1/connect/select",
                       json={"repo_full_name": "octo/hello"}).status_code == 409


def test_select_foreign_project_404(client, app, env):
    _install(client, app)
    _as(app, USER_B)
    assert client.post("/v2/github/projects/p1/connect/select",
                       json={"repo_full_name": "octo/hello"}).status_code == 404


def test_select_duplicate_repo_claim_conflicts(client, app, env):
    _install(client, app)
    _as(app, USER_A)
    assert client.post("/v2/github/projects/p1/connect/select",
                       json={"repo_full_name": "octo/hello"}).status_code == 200
    projects_store.create_project("uB", name="Proj B", project_id="p2")
    gh_setup.upsert_pending_installation(project_id="p2", owner_user_id="uB", installation_id=OWN_INSTALL)
    _as(app, USER_B)
    r = client.post("/v2/github/projects/p2/connect/select", json={"repo_full_name": "octo/hello"})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "REPO_ALREADY_CONNECTED"


# ── low-level /connect backward compatibility preserved ───────────────────────

def test_legacy_connect_route_still_works(client, app, env):
    _as(app, USER_A)
    r = client.post("/v2/github/projects/p1/connect",
                    json={"repo_full_name": "octo/hello", "installation_id": "100", "repo_id": "42"})
    assert r.status_code == 200
    assert r.json()["data"]["connection"]["repo_full_name"] == "octo/hello"
