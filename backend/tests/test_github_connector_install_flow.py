# coding: utf-8
"""GitHub connector — connect flow (real GitHub App UX) + the provider-verified
identity checks that defeat installation_id spoofing AND handle an already-
installed App without any uninstall/reinstall.

Connect no longer relies exclusively on `installations/new` (which dead-ends for
users who already have the App installed with unchanged repo access). It starts a
user-to-server **authorization** that resolves whether or not the App is
installed; the callback then discovers the installations accessible to the
AUTHENTICATED GitHub user via `GET /user/installations` (provider-verified),
re-verifies each belongs to OUR App, and stores that VERIFIED set as pending. The
frontend picks the account (when several) and the repository. The query-string
`installation_id` is never trusted on its own.

Trust chain proven per callback: valid state (CSRF/owner/project) → OAuth code →
GitHub USER identity → project owner re-check → GET /user/installations
(accessible set) → each installation belongs to OUR App → stored pending. Matrix:
wrong owner, expired/replayed state, a foreign installation id that is NOT in the
user's accessible set (the spoofing attack), an accessible id that is NOT our App,
missing/bad OAuth code, a user with no installations (needs_install), a user with
several installations (account picker), repo-not-in-installation, duplicate
repo/project claim, open-redirect prevention, no token leakage.

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
REPO2 = {"id": "77", "full_name": "acme/widget", "name": "widget",
         "owner": "acme", "private": True, "archived": False}

# Installation the initiating Korvix user (uA) actually has access to.
OWN_INSTALL = "100"
# A DIFFERENT real Korvix-AI installation, belonging to another GitHub account —
# the id an attacker might substitute into the callback query string. It belongs
# to our App but is NOT in user A's accessible set.
FOREIGN_INSTALL = "200"
# A second installation user A ALSO belongs to (e.g. an org) — the multi-install
# case that produces an account picker.
SECOND_INSTALL = "300"

GOOD_CODE = "code-A"          # → user A, accesses OWN_INSTALL only
MULTI_CODE = "code-multi"     # → user A-multi, accesses OWN_INSTALL + SECOND_INSTALL
NOINSTALL_CODE = "code-none"  # → authorized but accesses NO installation


@pytest.fixture()
def env(tmp_path, monkeypatch, app):
    path = str(tmp_path / "projects.db")
    monkeypatch.setenv("PROJECTS_DB_PATH", path)
    monkeypatch.setenv("ENABLE_GITHUB_CONNECTOR", "true")
    monkeypatch.setenv("GITHUB_APP_ID", "123")
    monkeypatch.setenv("GITHUB_APP_PRIVATE_KEY", "dummy-key")
    monkeypatch.setenv("GITHUB_APP_SLUG", "korvix-ai")
    # User-to-server OAuth (identity verification) must be configured for the
    # connect flow to run at all.
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

    # OWN, FOREIGN and SECOND are all real installations of OUR App (so the
    # App-JWT check passes for each). The difference is which GitHub USER may
    # access them (encoded by the fake /user/installations below).
    def fake_get_installation(inst):
        if str(inst) in (OWN_INSTALL, FOREIGN_INSTALL, SECOND_INSTALL):
            return {"id": int(inst), "app_id": "123", "account": {"login": "octo"}}
        raise GitHubNotFoundError(f"installation {inst} not our app")

    def fake_list_repositories(inst):
        if str(inst) == OWN_INSTALL:
            return [dict(REPO)]
        if str(inst) == SECOND_INSTALL:
            return [dict(REPO2)]
        return []

    def fake_exchange(code):
        if code == GOOD_CODE:
            return "utok-A"
        if code == MULTI_CODE:
            return "utok-multi"
        if code == NOINSTALL_CODE:
            return "utok-none"
        raise GitHubAuthError("bad or expired code")

    # The provider-verified accessible set per authenticated user. This is the
    # authoritative answer that defeats installation_id spoofing.
    def fake_list_user_installations(token):
        if token == "utok-A":
            return [{"installation_id": OWN_INSTALL, "account_login": "octo", "account_type": "User"}]
        if token == "utok-multi":
            return [
                {"installation_id": OWN_INSTALL, "account_login": "octo", "account_type": "User"},
                {"installation_id": SECOND_INSTALL, "account_login": "acme", "account_type": "Organization"},
            ]
        return []  # utok-none: authorized but no installation of our App

    monkeypatch.setattr(gh_app, "get_installation", fake_get_installation)
    monkeypatch.setattr(gh_app, "list_repositories", fake_list_repositories)
    monkeypatch.setattr(gh_user, "exchange_code_for_user_token", fake_exchange)
    monkeypatch.setattr(gh_user, "list_user_installations", fake_list_user_installations)
    yield path
    app.dependency_overrides.clear()


def _as(app, user):
    app.dependency_overrides[deps.require_auth] = lambda: user


def _start(client, app, user=USER_A, project="p1"):
    _as(app, user)
    return client.post(f"/v2/github/projects/{project}/connect/start")


def _mint_state(project="p1", owner="uA"):
    return gh_setup.create_state(owner_user_id=owner, project_id=project)


def _callback(client, *, state, installation_id=None, code=GOOD_CODE, **extra):
    """Simulate GitHub's redirect to our callback. `installation_id` defaults to
    None because the primary (authorization) path does NOT carry one; pass it
    explicitly to exercise the fresh-install path."""
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


def test_connect_start_returns_authorize_and_install_urls(client, app, env):
    r = _start(client, app)
    assert r.status_code == 200
    data = r.json()["data"]
    # Primary path is user-authorization (works whether or not already installed).
    assert "login/oauth/authorize" in data["authorize_url"]
    assert "client_id=cid" in data["authorize_url"]
    assert data["state"] and f"state={data['state']}" in data["authorize_url"]
    # Install URL still offered as the "not installed yet" fallback.
    assert "github.com/apps/korvix-ai/installations/new" in data["install_url"]
    assert f"state={data['state']}" in data["install_url"]


def test_connect_start_foreign_project_404(client, app, env):
    assert _start(client, app, user=USER_B).status_code == 404


def test_connect_start_fails_closed_without_user_oauth(client, app, env, monkeypatch):
    # Without the OAuth client id/secret the flow cannot verify the authorizing
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


# ── setup callback — authorization path (already-installed, no installation_id) ─

def test_callback_authorize_path_no_installation_id_connects(client, app, env):
    """THE already-installed fix: GitHub's authorization redirect carries a code
    but NO installation_id. The callback discovers the accessible installation via
    /user/installations and stores it pending — no uninstall/reinstall, no repo
    change required."""
    state = _start(client, app).json()["data"]["state"]
    r = _callback(client, state=state)  # note: installation_id=None
    assert r.status_code == 302
    loc = r.headers["location"]
    assert loc.startswith("https://app.example.com/#/settings/integrations")
    assert "github=authorized" in loc and "project_id=p1" in loc
    pending = gh_setup.get_pending_installation("p1", owner_user_id="uA", installation_id=OWN_INSTALL)
    assert pending is not None and pending.installation_id == OWN_INSTALL
    assert gh_store.get_connection("p1") is None
    # No token / no raw installation id leaked into the redirect.
    assert "utok" not in loc and "installation_id" not in loc


def test_callback_fresh_install_with_installation_id_still_works(client, app, env):
    """New-install happy path unchanged: GitHub's install redirect carries both a
    code AND the just-installed installation_id; it is in the accessible set, so it
    is stored pending (the hint just orders the picker)."""
    state = _mint_state()
    r = _callback(client, state=state, installation_id=OWN_INSTALL)
    assert "github=authorized" in r.headers["location"]
    assert gh_setup.get_pending_installation("p1", owner_user_id="uA", installation_id=OWN_INSTALL) is not None


def test_callback_no_installations_needs_install(client, app, env):
    """User authorized but has our App on no account → needs_install (steer to the
    install path), nothing pending, no error."""
    state = _mint_state()
    r = _callback(client, state=state, code=NOINSTALL_CODE)
    loc = r.headers["location"]
    assert "github=needs_install" in loc and "project_id=p1" in loc
    assert gh_setup.list_pending_installations("p1", owner_user_id="uA") == []


def test_callback_multiple_installations_all_pending(client, app, env):
    """User with several accessible installations → all stored pending for an
    account picker; the redirect is a single `authorized` outcome."""
    state = _mint_state()
    r = _callback(client, state=state, code=MULTI_CODE)
    assert "github=authorized" in r.headers["location"]
    pend = gh_setup.list_pending_installations("p1", owner_user_id="uA")
    assert {p.installation_id for p in pend} == {OWN_INSTALL, SECOND_INSTALL}
    # Account metadata is carried for the picker (display only).
    logins = {p.installation_id: p.account_login for p in pend}
    assert logins[OWN_INSTALL] == "octo" and logins[SECOND_INSTALL] == "acme"


# ── setup callback — adversarial / spoofing ───────────────────────────────────

def test_callback_foreign_installation_id_is_ignored_SPOOFING(client, app, env):
    """THE anti-spoofing test: user A presents a VALID state and, in the query
    string, a real Korvix-AI installation (200) belonging to ANOTHER GitHub
    account. Because trust comes ONLY from /user/installations (which returns just
    OWN_INSTALL for A), the foreign id is never stored; A's own installation is."""
    state = _mint_state()
    r = _callback(client, state=state, installation_id=FOREIGN_INSTALL)
    # A's own install is bound; the foreign one is NOT.
    assert gh_setup.get_pending_installation("p1", owner_user_id="uA", installation_id=OWN_INSTALL) is not None
    assert gh_setup.get_pending_installation("p1", owner_user_id="uA", installation_id=FOREIGN_INSTALL) is None


def test_callback_foreign_id_with_no_access_binds_nothing(client, app, env):
    """A user with NO accessible installations who presents a foreign
    installation_id binds NOTHING (needs_install), proving a spoofed id can never
    become pending on its own."""
    state = _mint_state()
    r = _callback(client, state=state, code=NOINSTALL_CODE, installation_id=FOREIGN_INSTALL)
    assert "github=needs_install" in r.headers["location"]
    assert gh_setup.get_pending_installation("p1", owner_user_id="uA", installation_id=FOREIGN_INSTALL) is None
    assert gh_setup.list_pending_installations("p1", owner_user_id="uA") == []


def test_callback_accessible_but_not_our_app_rejected(client, app, env, monkeypatch):
    """An installation reported as accessible to the user but which fails the
    App-JWT ownership re-check (not our App) is dropped. When it is the only
    candidate, the callback fails closed as unverified."""
    def only_foreign(token):
        # Report an id our get_installation fake will reject as not-our-app.
        return [{"installation_id": "999999", "account_login": "x", "account_type": "User"}]
    monkeypatch.setattr(gh_user, "list_user_installations", only_foreign)
    state = _mint_state()
    r = _callback(client, state=state)
    assert "reason=installation_unverified" in r.headers["location"]
    assert gh_setup.list_pending_installations("p1", owner_user_id="uA") == []


def test_callback_missing_code_rejected(client, app, env):
    state = _mint_state()
    r = _callback(client, state=state, code=None)
    assert "reason=user_auth_required" in r.headers["location"]
    assert gh_setup.list_pending_installations("p1", owner_user_id="uA") == []


def test_callback_bad_code_rejected(client, app, env):
    state = _mint_state()
    r = _callback(client, state=state, code="bad-code")
    assert "reason=user_auth_failed" in r.headers["location"]
    assert gh_setup.list_pending_installations("p1", owner_user_id="uA") == []


def test_callback_invalid_state_rejected(client, app, env):
    r = _callback(client, state="forged")
    assert "reason=invalid_state" in r.headers["location"]
    assert gh_setup.list_pending_installations("p1", owner_user_id="uA") == []


def test_callback_replayed_state_rejected(client, app, env):
    state = _mint_state()
    assert "github=authorized" in _callback(client, state=state).headers["location"]
    assert "reason=invalid_state" in _callback(client, state=state).headers["location"]


def test_callback_expired_state_rejected(client, app, env):
    state = _mint_state()
    from backend.services.orchestrator import _sqlite
    past = (datetime.utcnow() - timedelta(minutes=30)).isoformat() + "Z"
    with _sqlite.connection(env) as c:
        c.execute("UPDATE github_setup_states SET expires_at=? WHERE state=?", (past, state))
    assert "reason=invalid_state" in _callback(client, state=state).headers["location"]


def test_callback_ownership_mismatch_rejected(client, app, env):
    state = _mint_state()
    from backend.services.orchestrator import _sqlite
    with _sqlite.connection(env) as c:
        c.execute("UPDATE projects SET owner_user_id=? WHERE id=?", ("uB", "p1"))
    r = _callback(client, state=state)
    assert "reason=ownership_mismatch" in r.headers["location"]
    assert gh_setup.list_pending_installations("p1", owner_user_id="uA") == []


def test_callback_disabled_redirects_error(client, app, env, monkeypatch):
    monkeypatch.setenv("ENABLE_GITHUB_CONNECTOR", "false")
    r = _callback(client, state="x")
    assert "reason=disabled" in r.headers["location"]


# ── pending installations list ────────────────────────────────────────────────

def _install(client, app, code=GOOD_CODE):
    _callback(client, state=_mint_state(), code=code)


def test_pending_installations_single(client, app, env):
    _install(client, app)
    _as(app, USER_A)
    r = client.get("/v2/github/projects/p1/pending-installations")
    assert r.status_code == 200
    data = r.json()["data"]
    assert data["count"] == 1
    assert data["installations"][0]["installation_id"] == OWN_INSTALL
    assert data["installations"][0]["account_login"] == "octo"


def test_pending_installations_multiple(client, app, env):
    _install(client, app, code=MULTI_CODE)
    _as(app, USER_A)
    r = client.get("/v2/github/projects/p1/pending-installations")
    assert r.status_code == 200
    ids = {i["installation_id"] for i in r.json()["data"]["installations"]}
    assert ids == {OWN_INSTALL, SECOND_INSTALL}


def test_pending_installations_foreign_user_empty(client, app, env):
    _install(client, app)
    _as(app, USER_B)
    r = client.get("/v2/github/projects/p1/pending-installations")
    # USER_B does not own the project → 404 (never reveal it exists).
    assert r.status_code == 404


# ── pending repositories ──────────────────────────────────────────────────────

def test_pending_repos_owner_lists_repositories(client, app, env):
    _install(client, app)
    _as(app, USER_A)
    r = client.get("/v2/github/projects/p1/pending-installation/repositories")
    assert r.status_code == 200
    assert [x["full_name"] for x in r.json()["data"]["repositories"]] == ["octo/hello"]
    assert r.json()["data"]["installation_id"] == OWN_INSTALL
    assert "token" not in json.dumps(r.json()).lower()


def test_pending_repos_by_installation_id(client, app, env):
    _install(client, app, code=MULTI_CODE)
    _as(app, USER_A)
    r = client.get("/v2/github/projects/p1/pending-installation/repositories",
                   params={"installation_id": SECOND_INSTALL})
    assert r.status_code == 200
    assert [x["full_name"] for x in r.json()["data"]["repositories"]] == ["acme/widget"]


def test_pending_repos_choice_required_when_multiple(client, app, env):
    _install(client, app, code=MULTI_CODE)
    _as(app, USER_A)
    r = client.get("/v2/github/projects/p1/pending-installation/repositories")
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "INSTALLATION_CHOICE_REQUIRED"


def test_pending_repos_unknown_installation_id_404(client, app, env):
    _install(client, app)
    _as(app, USER_A)
    r = client.get("/v2/github/projects/p1/pending-installation/repositories",
                   params={"installation_id": FOREIGN_INSTALL})
    assert r.status_code == 404 and r.json()["detail"]["code"] == "NO_PENDING_INSTALL"


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
    """Already-installed → authorize → select → connected. This is the exact case
    that previously dead-ended; it now succeeds with no repo-access change."""
    _install(client, app)
    _as(app, USER_A)
    r = client.post("/v2/github/projects/p1/connect/select", json={"repo_full_name": "octo/hello"})
    assert r.status_code == 200
    conn = r.json()["data"]["connection"]
    assert conn["repo_full_name"] == "octo/hello" and conn["installation_id"] == OWN_INSTALL
    assert "token" not in json.dumps(r.json()).lower()
    assert gh_setup.list_pending_installations("p1", owner_user_id="uA") == []
    assert gh_store.get_connection("p1").repo_full_name == "octo/hello"


def test_select_with_installation_id_from_multiple(client, app, env):
    _install(client, app, code=MULTI_CODE)
    _as(app, USER_A)
    r = client.post("/v2/github/projects/p1/connect/select",
                    json={"repo_full_name": "acme/widget", "installation_id": SECOND_INSTALL})
    assert r.status_code == 200
    conn = r.json()["data"]["connection"]
    assert conn["repo_full_name"] == "acme/widget" and conn["installation_id"] == SECOND_INSTALL
    # Selecting one clears the WHOLE pending set for the project.
    assert gh_setup.list_pending_installations("p1", owner_user_id="uA") == []


def test_select_choice_required_when_multiple_and_no_id(client, app, env):
    _install(client, app, code=MULTI_CODE)
    _as(app, USER_A)
    r = client.post("/v2/github/projects/p1/connect/select", json={"repo_full_name": "octo/hello"})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "INSTALLATION_CHOICE_REQUIRED"
    assert gh_store.get_connection("p1") is None


def test_select_foreign_installation_id_rejected(client, app, env):
    """A client-supplied installation_id that is not in the verified pending set
    is rejected (never trusted)."""
    _install(client, app)
    _as(app, USER_A)
    r = client.post("/v2/github/projects/p1/connect/select",
                    json={"repo_full_name": "octo/hello", "installation_id": FOREIGN_INSTALL})
    assert r.status_code == 404 and r.json()["detail"]["code"] == "NO_PENDING_INSTALL"
    assert gh_store.get_connection("p1") is None


def test_select_repo_not_in_installation_rejected(client, app, env):
    _install(client, app)
    _as(app, USER_A)
    r = client.post("/v2/github/projects/p1/connect/select", json={"repo_full_name": "octo/other"})
    assert r.status_code == 400 and r.json()["detail"]["code"] == "REPO_NOT_IN_INSTALLATION"
    assert gh_store.get_connection("p1") is None


def test_select_without_pending_404(client, app, env):
    _as(app, USER_A)
    assert client.post("/v2/github/projects/p1/connect/select",
                       json={"repo_full_name": "octo/hello"}).status_code == 404


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
    gh_setup.replace_pending_installations(
        project_id="p2", owner_user_id="uB",
        installations=[{"installation_id": OWN_INSTALL, "account_login": "octo", "account_type": "User"}])
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
