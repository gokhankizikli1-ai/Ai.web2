# coding: utf-8
"""GitHub connector — install-flow (real GitHub App installation UX).

Covers connect/start, the setup callback, pending-installation repositories, and
connect/select — including the adversarial matrix: wrong owner, expired/replayed
state, forged/foreign installation id, repo-not-in-installation, duplicate
repo/project claim, open-redirect prevention, and no token leakage.

The GitHub App API seams (installation verification + repo listing) are faked, so
no real GitHub call is made and no private key / crypto backend is needed.
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
from backend.services.github.errors import GitHubNotFoundError
from backend.services.projects import store as projects_store

USER_A = User(id="uA", kind="email", external_id="email:a@x.com", display_name="A")
USER_B = User(id="uB", kind="email", external_id="email:b@x.com", display_name="B")

REPO = {"id": "42", "full_name": "octo/hello", "name": "hello",
        "owner": "octo", "private": False, "archived": False}
VALID_INSTALL = "100"


@pytest.fixture()
def env(tmp_path, monkeypatch, app):
    path = str(tmp_path / "projects.db")
    monkeypatch.setenv("PROJECTS_DB_PATH", path)
    monkeypatch.setenv("ENABLE_GITHUB_CONNECTOR", "true")
    # install_configured() = App creds present AND a slug (or URL override).
    monkeypatch.setenv("GITHUB_APP_ID", "123")
    monkeypatch.setenv("GITHUB_APP_PRIVATE_KEY", "dummy-key")
    monkeypatch.setenv("GITHUB_APP_SLUG", "korvix-ai")
    monkeypatch.setenv("GITHUB_FRONTEND_RESULT_URL", "https://app.example.com")
    monkeypatch.setenv("GITHUB_FRONTEND_RESULT_PATH", "/#/settings/integrations")
    monkeypatch.setenv("GITHUB_HTML_BASE", "https://github.com")
    for mod in (projects_store, gh_store, gh_setup):
        monkeypatch.setattr(mod, "DB_PATH", path, raising=False)
    projects_store._reset_for_tests(); projects_store.init()
    gh_store._reset_for_tests(); gh_store.init_github_tables()
    gh_setup._reset_for_tests(); gh_setup.init_github_setup_tables()
    projects_store.create_project("uA", name="Proj A", project_id="p1")

    # Fake the GitHub App API seams (no real GitHub, no crypto).
    def fake_get_installation(inst):
        if str(inst) == VALID_INSTALL:
            return {"id": int(inst), "app_id": "123", "account": {"login": "octo"}}
        raise GitHubNotFoundError(f"installation {inst} not found")

    def fake_list_repositories(inst):
        return [dict(REPO)] if str(inst) == VALID_INSTALL else []

    monkeypatch.setattr(gh_app, "get_installation", fake_get_installation)
    monkeypatch.setattr(gh_app, "list_repositories", fake_list_repositories)
    yield path
    app.dependency_overrides.clear()


def _as(app, user):
    app.dependency_overrides[deps.require_auth] = lambda: user


def _start(client, app, user=USER_A, project="p1"):
    _as(app, user)
    return client.post(f"/v2/github/projects/{project}/connect/start")


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
    r = _start(client, app, user=USER_B)
    assert r.status_code == 404


def test_connect_start_fails_closed_without_slug(client, app, env, monkeypatch):
    monkeypatch.delenv("GITHUB_APP_SLUG", raising=False)
    monkeypatch.delenv("GITHUB_APP_INSTALL_URL", raising=False)
    r = _start(client, app)
    assert r.status_code == 503
    assert r.json()["detail"]["code"] == "GITHUB_APP_NOT_CONFIGURED"


def test_connect_start_unauthenticated_rejected(client, app, env):
    r = client.post("/v2/github/projects/p1/connect/start")   # no override → guest
    assert r.status_code >= 400 and r.status_code != 302
    # No state minted for a guest.
    from backend.services.orchestrator import _sqlite
    with _sqlite.connection(env) as c:
        n = c.execute("SELECT COUNT(*) AS n FROM github_setup_states").fetchone()["n"]
    assert n == 0


# ── setup callback ────────────────────────────────────────────────────────────

def _mint_state(project="p1", owner="uA"):
    return gh_setup.create_state(owner_user_id=owner, project_id=project)


def test_callback_happy_path_stores_pending_and_redirects(client, app, env):
    state = _start(client, app).json()["data"]["state"]
    r = client.get("/v2/github/setup/callback",
                   params={"state": state, "installation_id": VALID_INSTALL, "setup_action": "install"},
                   follow_redirects=False)
    assert r.status_code == 302
    loc = r.headers["location"]
    assert loc.startswith("https://app.example.com/#/settings/integrations")
    assert "github=installed" in loc and "project_id=p1" in loc
    # Pending stored, id only — no connection yet, no token in the redirect.
    pending = gh_setup.get_pending_installation("p1", owner_user_id="uA")
    assert pending is not None and pending.installation_id == VALID_INSTALL
    assert gh_store.get_connection("p1") is None
    assert VALID_INSTALL not in loc or "installation_id" not in loc  # id not echoed as a param


def test_callback_invalid_state_rejected(client, app, env):
    r = client.get("/v2/github/setup/callback",
                   params={"state": "forged", "installation_id": VALID_INSTALL},
                   follow_redirects=False)
    assert "reason=invalid_state" in r.headers["location"]
    assert gh_setup.get_pending_installation("p1", owner_user_id="uA") is None


def test_callback_replayed_state_rejected(client, app, env):
    state = _mint_state()
    ok = client.get("/v2/github/setup/callback",
                    params={"state": state, "installation_id": VALID_INSTALL}, follow_redirects=False)
    assert "github=installed" in ok.headers["location"]
    replay = client.get("/v2/github/setup/callback",
                        params={"state": state, "installation_id": VALID_INSTALL}, follow_redirects=False)
    assert "reason=invalid_state" in replay.headers["location"]


def test_callback_expired_state_rejected(client, app, env):
    state = _mint_state()
    from backend.services.orchestrator import _sqlite
    past = (datetime.utcnow() - timedelta(minutes=30)).isoformat() + "Z"
    with _sqlite.connection(env) as c:
        c.execute("UPDATE github_setup_states SET expires_at=? WHERE state=?", (past, state))
    r = client.get("/v2/github/setup/callback",
                   params={"state": state, "installation_id": VALID_INSTALL}, follow_redirects=False)
    assert "reason=invalid_state" in r.headers["location"]


def test_callback_forged_installation_rejected(client, app, env):
    state = _mint_state()
    r = client.get("/v2/github/setup/callback",
                   params={"state": state, "installation_id": "999999"},   # not our App
                   follow_redirects=False)
    assert "reason=installation_unverified" in r.headers["location"]
    assert gh_setup.get_pending_installation("p1", owner_user_id="uA") is None


def test_callback_missing_installation(client, app, env):
    state = _mint_state()
    r = client.get("/v2/github/setup/callback", params={"state": state}, follow_redirects=False)
    assert "reason=missing_installation" in r.headers["location"]


def test_callback_ownership_mismatch_rejected(client, app, env):
    state = _mint_state()
    from backend.services.orchestrator import _sqlite
    with _sqlite.connection(env) as c:
        c.execute("UPDATE projects SET owner_user_id=? WHERE id=?", ("uB", "p1"))
    r = client.get("/v2/github/setup/callback",
                   params={"state": state, "installation_id": VALID_INSTALL}, follow_redirects=False)
    assert "reason=ownership_mismatch" in r.headers["location"]


def test_callback_disabled_redirects_error(client, app, env, monkeypatch):
    monkeypatch.setenv("ENABLE_GITHUB_CONNECTOR", "false")
    r = client.get("/v2/github/setup/callback",
                   params={"state": "x", "installation_id": VALID_INSTALL}, follow_redirects=False)
    assert "reason=disabled" in r.headers["location"]


# ── pending repositories ──────────────────────────────────────────────────────

def _install(client, app):
    state = _mint_state()
    client.get("/v2/github/setup/callback",
               params={"state": state, "installation_id": VALID_INSTALL}, follow_redirects=False)


def test_pending_repos_owner_lists_repositories(client, app, env):
    _install(client, app)
    _as(app, USER_A)
    r = client.get("/v2/github/projects/p1/pending-installation/repositories")
    assert r.status_code == 200
    repos = r.json()["data"]["repositories"]
    assert [x["full_name"] for x in repos] == ["octo/hello"]
    assert "token" not in json.dumps(r.json()).lower()


def test_pending_repos_foreign_user_404(client, app, env):
    _install(client, app)
    _as(app, USER_B)
    assert client.get("/v2/github/projects/p1/pending-installation/repositories").status_code == 404


def test_pending_repos_without_pending_404(client, app, env):
    _as(app, USER_A)
    r = client.get("/v2/github/projects/p1/pending-installation/repositories")
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "NO_PENDING_INSTALL"


# ── connect/select (finalize) ─────────────────────────────────────────────────

def test_select_happy_path_connects_and_clears_pending(client, app, env):
    _install(client, app)
    _as(app, USER_A)
    r = client.post("/v2/github/projects/p1/connect/select", json={"repo_full_name": "octo/hello"})
    assert r.status_code == 200
    conn = r.json()["data"]["connection"]
    assert conn["repo_full_name"] == "octo/hello" and conn["installation_id"] == VALID_INSTALL
    assert "token" not in json.dumps(r.json()).lower()
    # Pending consumed; the authoritative connection store now holds it.
    assert gh_setup.get_pending_installation("p1", owner_user_id="uA") is None
    assert gh_store.get_connection("p1").repo_full_name == "octo/hello"


def test_select_repo_not_in_installation_rejected(client, app, env):
    _install(client, app)
    _as(app, USER_A)
    r = client.post("/v2/github/projects/p1/connect/select", json={"repo_full_name": "octo/other"})
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "REPO_NOT_IN_INSTALLATION"
    assert gh_store.get_connection("p1") is None


def test_select_without_pending_409(client, app, env):
    _as(app, USER_A)
    r = client.post("/v2/github/projects/p1/connect/select", json={"repo_full_name": "octo/hello"})
    assert r.status_code == 409


def test_select_foreign_project_404(client, app, env):
    _install(client, app)
    _as(app, USER_B)
    r = client.post("/v2/github/projects/p1/connect/select", json={"repo_full_name": "octo/hello"})
    assert r.status_code == 404


def test_select_duplicate_repo_claim_conflicts(client, app, env):
    # p1 (uA) claims octo/hello under install 100. A second project p2 (uB) with
    # its own pending install for the SAME repo/installation cannot claim it.
    _install(client, app)
    _as(app, USER_A)
    assert client.post("/v2/github/projects/p1/connect/select",
                       json={"repo_full_name": "octo/hello"}).status_code == 200

    projects_store.create_project("uB", name="Proj B", project_id="p2")
    gh_setup.upsert_pending_installation(project_id="p2", owner_user_id="uB", installation_id=VALID_INSTALL)
    _as(app, USER_B)
    r = client.post("/v2/github/projects/p2/connect/select", json={"repo_full_name": "octo/hello"})
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "REPO_ALREADY_CONNECTED"


# ── low-level /connect backward compatibility preserved ───────────────────────

def test_legacy_connect_route_still_works(client, app, env):
    _as(app, USER_A)
    r = client.post("/v2/github/projects/p1/connect",
                    json={"repo_full_name": "octo/hello", "installation_id": "100", "repo_id": "42"})
    assert r.status_code == 200
    assert r.json()["data"]["connection"]["repo_full_name"] == "octo/hello"
