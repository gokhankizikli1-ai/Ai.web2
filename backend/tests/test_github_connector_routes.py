# coding: utf-8
"""GitHub connector — HTTP surface (/v2/github/*).

Covers the feature gate, ownership / cross-user isolation, the webhook
endpoint's HTTP contract, and the end-to-end proof that a recorded observation
becomes visible to the EXISTING Business Brain through its own authority path
(assess_business_brain) — with zero task/decision/run creation.
"""
from __future__ import annotations

import json

import pytest

from backend.core import deps
from backend.services.auth.identity import User
from backend.services.github import store as gh_store
from backend.services.github import sync as gh_sync
from backend.services.projects import store as projects_store
from backend.services.orchestrator import observations_store as obs

SECRET = "route-hook-secret"
REPO = {"id": 42, "full_name": "octo/hello"}

USER_A = User(id="uA", kind="email", external_id="email:a@x.com", display_name="A")
USER_B = User(id="uB", kind="email", external_id="email:b@x.com", display_name="B")


class _FakeClient:
    def __init__(self, iid):
        self.installation_id = iid

    def get_repo(self, full):
        return REPO

    def paginate(self, path, params=None, max_pages=None):
        if path.endswith("/pulls"):
            return [{"number": 1, "state": "open", "title": "Route PR",
                     "updated_at": "2024-01-01T00:00:00Z"}]
        return []


@pytest.fixture()
def env(tmp_path, monkeypatch, app):
    path = str(tmp_path / "projects.db")
    monkeypatch.setenv("PROJECTS_DB_PATH", path)
    monkeypatch.setenv("ENABLE_GITHUB_CONNECTOR", "true")
    monkeypatch.setenv("GITHUB_APP_WEBHOOK_SECRET", SECRET)
    for mod in (projects_store, gh_store, obs):
        monkeypatch.setattr(mod, "DB_PATH", path, raising=False)
    projects_store.init()
    gh_store.init_github_tables()
    obs.init_observations_table()
    # A project owned by user A.
    projects_store.create_project("uA", name="Proj A", project_id="p1")
    monkeypatch.setattr(gh_sync, "GitHubClient", lambda iid: _FakeClient(iid))
    yield path
    app.dependency_overrides.clear()


def _as(app, user):
    app.dependency_overrides[deps.require_auth] = lambda: user


# ── feature gate ─────────────────────────────────────────────────────────────

def test_disabled_returns_503(client, app, env, monkeypatch):
    monkeypatch.setenv("ENABLE_GITHUB_CONNECTOR", "false")
    _as(app, USER_A)
    r = client.get("/v2/github/projects/p1/connection")
    assert r.status_code == 503


# ── ownership / cross-user isolation ─────────────────────────────────────────

def test_owner_can_connect_and_read(client, app, env):
    _as(app, USER_A)
    r = client.post("/v2/github/projects/p1/connect",
                    json={"repo_full_name": "octo/hello", "installation_id": "100", "repo_id": "42"})
    assert r.status_code == 200
    conn = r.json()["data"]["connection"]
    assert conn["repo_full_name"] == "octo/hello"
    # No secret/token ever surfaced.
    assert "token" not in json.dumps(r.json()).lower()

    g = client.get("/v2/github/projects/p1/connection")
    assert g.json()["data"]["connected"] is True


def test_non_owner_cannot_connect_or_read(client, app, env):
    # User B does not own p1 → 404 (existence not revealed).
    _as(app, USER_B)
    r = client.post("/v2/github/projects/p1/connect",
                    json={"repo_full_name": "octo/hello", "installation_id": "100"})
    assert r.status_code == 404
    g = client.get("/v2/github/projects/p1/connection")
    assert g.status_code == 404
    # And nothing was connected.
    assert gh_store.get_connection("p1") is None


def test_non_owner_cannot_sync_or_disconnect(client, app, env):
    # Phase 1 rollout: a normal authenticated user cannot sync/disconnect a
    # project they do not own — enforced backend-side, not by frontend hiding.
    _as(app, USER_A)
    assert client.post("/v2/github/projects/p1/connect",
                       json={"repo_full_name": "octo/hello", "installation_id": "100"}).status_code == 200
    _as(app, USER_B)
    assert client.post("/v2/github/projects/p1/sync").status_code == 404
    assert client.delete("/v2/github/projects/p1/connection").status_code == 404
    # A's connection is untouched by B's attempts.
    assert gh_store.get_connection("p1") is not None


def test_repo_already_connected_elsewhere_conflicts(client, app, env):
    # A owns p1 and connects octo/hello. A second project (owned by B) cannot
    # claim the same (installation, repo).
    _as(app, USER_A)
    assert client.post("/v2/github/projects/p1/connect",
                       json={"repo_full_name": "octo/hello", "installation_id": "100"}).status_code == 200
    projects_store.create_project("uB", name="Proj B", project_id="p2")
    _as(app, USER_B)
    r = client.post("/v2/github/projects/p2/connect",
                    json={"repo_full_name": "octo/hello", "installation_id": "100"})
    assert r.status_code == 409


def test_connect_requires_installation(client, app, env):
    _as(app, USER_A)
    r = client.post("/v2/github/projects/p1/connect", json={"repo_full_name": "octo/hello"})
    assert r.status_code == 400  # no installation + no GITHUB_DEFAULT_INSTALLATION_ID


def test_sync_requires_connection_first(client, app, env):
    _as(app, USER_A)
    r = client.post("/v2/github/projects/p1/sync")
    assert r.status_code == 409


# ── end-to-end: sync route → Business Brain visibility, no side effects ───────

def test_sync_route_records_observations_visible_to_business_brain(client, app, env):
    _as(app, USER_A)
    client.post("/v2/github/projects/p1/connect",
                json={"repo_full_name": "octo/hello", "installation_id": "100", "repo_id": "42"})
    r = client.post("/v2/github/projects/p1/sync")
    assert r.status_code == 200
    report = r.json()["data"]["sync"]
    assert report["ok"] is True and report["recorded"] == 1

    # The recorded observation is visible through the EXISTING authority path.
    from backend.services.orchestrator import project_supervisor
    assessment = project_supervisor.assess_business_brain(None, project_id="p1", user_id="uA")
    kinds = {o["kind"] for o in assessment["observations"]}
    assert "github.pull_request.opened" in kinds
    # ...and the connector promoted NOTHING to execution.
    from backend.services.orchestrator import candidate_actions_store, tasks_store
    monkey_ok = candidate_actions_store.list_candidate_actions("p1") == []
    assert monkey_ok
    assert tasks_store.list_tasks_for_project("p1") == []


# ── webhook endpoint HTTP contract ───────────────────────────────────────────

def _sign(body: bytes) -> str:
    from backend.services.github import webhook as gh_webhook
    return gh_webhook.compute_signature(body, SECRET)


def test_webhook_rejects_bad_signature(client, app, env):
    body = json.dumps({"action": "opened", "installation": {"id": "100"},
                       "repository": REPO,
                       "pull_request": {"number": 1, "state": "open", "title": "T"}}).encode()
    r = client.post("/v2/github/webhooks/github", content=body,
                    headers={"X-Hub-Signature-256": "sha256=deadbeef",
                             "X-GitHub-Event": "pull_request", "X-GitHub-Delivery": "d1"})
    assert r.status_code == 401
    assert obs.list_observations("p1") == []


def test_webhook_accepts_valid_signature_and_records(client, app, env):
    gh_store.upsert_connection(project_id="p1", owner_user_id="uA",
                               installation_id="100", repo_full_name="octo/hello", repo_id="42")
    body = json.dumps({"action": "opened", "installation": {"id": "100"},
                       "repository": REPO,
                       "pull_request": {"number": 5, "state": "open", "title": "Hook PR"}}).encode()
    r = client.post("/v2/github/webhooks/github", content=body,
                    headers={"X-Hub-Signature-256": _sign(body),
                             "X-GitHub-Event": "pull_request", "X-GitHub-Delivery": "d2"})
    assert r.status_code == 200
    assert r.json()["data"]["status"] == "recorded"
    recorded = obs.list_observations("p1")
    assert len(recorded) == 1 and recorded[0]["user_id"] == "uA"


def test_webhook_duplicate_delivery_is_idempotent(client, app, env):
    gh_store.upsert_connection(project_id="p1", owner_user_id="uA",
                               installation_id="100", repo_full_name="octo/hello", repo_id="42")
    body = json.dumps({"action": "opened", "installation": {"id": "100"},
                       "repository": REPO,
                       "pull_request": {"number": 5, "state": "open", "title": "Hook PR"}}).encode()
    hdrs = {"X-Hub-Signature-256": _sign(body),
            "X-GitHub-Event": "pull_request", "X-GitHub-Delivery": "same"}
    r1 = client.post("/v2/github/webhooks/github", content=body, headers=hdrs)
    r2 = client.post("/v2/github/webhooks/github", content=body, headers=hdrs)
    assert r1.json()["data"]["status"] == "recorded"
    assert r2.json()["data"]["status"] == "duplicate"
    assert len(obs.list_observations("p1")) == 1


def test_webhook_unconfigured_secret_fails_closed(client, app, env, monkeypatch):
    monkeypatch.setenv("GITHUB_APP_WEBHOOK_SECRET", "")
    body = json.dumps({"repository": REPO}).encode()
    r = client.post("/v2/github/webhooks/github", content=body,
                    headers={"X-GitHub-Event": "ping", "X-GitHub-Delivery": "p"})
    assert r.status_code == 503


def test_webhook_payload_too_large(client, app, env, monkeypatch):
    monkeypatch.setenv("GITHUB_WEBHOOK_MAX_BYTES", "50")
    body = json.dumps({"repository": REPO, "pad": "x" * 500}).encode()
    r = client.post("/v2/github/webhooks/github", content=body,
                    headers={"X-Hub-Signature-256": _sign(body),
                             "X-GitHub-Event": "push", "X-GitHub-Delivery": "big"})
    assert r.status_code == 413
