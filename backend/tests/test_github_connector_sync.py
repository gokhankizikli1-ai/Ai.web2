# coding: utf-8
"""GitHub connector — bounded initial sync + cost/side-effect guarantees.

No real GitHub: the REST client is replaced by a fake returning fixtures.
"""
from __future__ import annotations

import pytest

from backend.services.github import store as gh_store
from backend.services.github import sync as gh_sync
from backend.services.github.errors import GitHubServerError
from backend.services.orchestrator import observations_store as obs

REPO = {"id": 42, "full_name": "octo/hello"}

_PULLS = [
    {"number": 1, "state": "open", "title": "Open PR", "updated_at": "2024-01-02T00:00:00Z"},
    {"number": 2, "state": "closed", "merged": True, "merged_at": "2024-01-03T00:00:00Z",
     "title": "Merged PR"},
]
_ISSUES = [
    {"number": 10, "state": "open", "title": "Bug"},
    {"number": 11, "state": "open", "title": "PR-as-issue", "pull_request": {"url": "x"}},  # skipped
]
_RUNS = [{"id": 900, "status": "completed", "conclusion": "failure", "name": "CI"}]
_DEPLOYS = [{"id": 700, "environment": "prod", "ref": "abc", "created_at": "2024-01-01T00:00:00Z"}]
_COMMITS = [{"sha": "a" * 40, "commit": {"message": "c1", "author": {"name": "x", "date": "2024-01-01T00:00:00Z"}}}]


class _FakeClient:
    def __init__(self, installation_id, *, fail=None):
        self.installation_id = installation_id
        self._fail = fail or set()

    def get_repo(self, full):
        if "repo" in self._fail:
            raise GitHubServerError("boom", status=500)
        return REPO

    def paginate(self, path, params=None, max_pages=None):
        if path.endswith("/pulls"):
            if "pulls" in self._fail:
                raise GitHubServerError("boom", status=500)
            return list(_PULLS)
        if path.endswith("/issues"):
            return list(_ISSUES)
        if path.endswith("/actions/runs"):
            return [{"workflow_runs": list(_RUNS)}]
        if path.endswith("/deployments"):
            return list(_DEPLOYS)
        if path.endswith("/commits"):
            return list(_COMMITS)
        return []


@pytest.fixture()
def env(tmp_path, monkeypatch):
    path = str(tmp_path / "projects.db")
    monkeypatch.setenv("PROJECTS_DB_PATH", path)
    monkeypatch.setattr(gh_store, "DB_PATH", path, raising=False)
    monkeypatch.setattr(obs, "DB_PATH", path, raising=False)
    gh_store.init_github_tables()
    obs.init_observations_table()
    gh_store.upsert_connection(project_id="p1", owner_user_id="uA",
                               installation_id="100", repo_full_name="octo/hello", repo_id="42")
    monkeypatch.setattr(gh_sync, "GitHubClient", lambda iid: _FakeClient(iid))
    return path


def test_initial_sync_records_observations(env):
    report = gh_sync.initial_sync("p1")
    assert report.ok is True
    # 2 PRs + 1 issue (the PR-as-issue is filtered) + 1 CI failure + 1 deploy + 1 commit
    assert report.recorded == 6
    recorded = obs.list_observations("p1")
    kinds = sorted(o["kind"] for o in recorded)
    assert "github.pull_request.merged" in kinds
    assert "github.pull_request.opened" in kinds
    assert "github.issue.opened" in kinds
    assert "github.check.failed" in kinds
    assert "github.deployment.created" in kinds
    assert "github.commit.pushed" in kinds
    assert all(o["source"] == "github" for o in recorded)
    # scoped to the connection's owner
    assert all(o["user_id"] == "uA" and o["project_id"] == "p1" for o in recorded)


def test_sync_is_idempotent(env):
    first = gh_sync.initial_sync("p1")
    assert first.recorded == 6 and first.deduplicated == 0
    second = gh_sync.initial_sync("p1")
    # Re-running writes NO duplicate observations (deterministic external_id).
    assert second.recorded == 0
    assert second.deduplicated == 6
    assert len(obs.list_observations("p1")) == 6


def test_sync_partial_failure_is_truthful_not_false_success(env, monkeypatch):
    monkeypatch.setattr(gh_sync, "GitHubClient", lambda iid: _FakeClient(iid, fail={"pulls"}))
    report = gh_sync.sync_connection(gh_store.get_connection("p1"))
    # The failing resource is surfaced; the sync is NOT reported ok...
    assert report.ok is False
    assert "pull_requests" in report.errors
    assert "GitHubServerError" in report.errors["pull_requests"]
    # ...but the healthy resources still produced observations (no all-or-nothing).
    assert report.recorded == 4   # issue + CI + deploy + commit (PRs failed)


def test_sync_repo_failure_aborts_with_typed_error(env, monkeypatch):
    monkeypatch.setattr(gh_sync, "GitHubClient", lambda iid: _FakeClient(iid, fail={"repo"}))
    report = gh_sync.sync_connection(gh_store.get_connection("p1"))
    assert report.ok is False
    assert "repo" in report.errors
    assert report.recorded == 0
    assert obs.list_observations("p1") == []


def test_sync_without_connection_reports_error(env):
    report = gh_sync.initial_sync("nonexistent")
    assert report.ok is False
    assert "connection" in report.errors


# ── cost + side-effect guarantees ────────────────────────────────────────────

def test_sync_creates_no_tasks_decisions_or_runs(env, monkeypatch):
    from backend.services.orchestrator import candidate_actions_store, decisions_store, tasks_store
    for mod in (candidate_actions_store, decisions_store, tasks_store):
        monkeypatch.setattr(mod, "DB_PATH", env, raising=False)
    gh_sync.initial_sync("p1")
    # Observations exist...
    assert len(obs.list_observations("p1")) == 6
    # ...but the connector promoted NOTHING to a candidate/decision/task.
    assert candidate_actions_store.list_candidate_actions("p1") == []
    assert decisions_store.active_decisions("p1") == []
    assert tasks_store.list_tasks_for_project("p1") == []


# ── bounded initial import (no repeated-click backfill) ──────────────────────

class _RecordingClient(_FakeClient):
    """Captures the max_pages passed to paginate per resource."""
    def __init__(self, installation_id, *, fail=None):
        super().__init__(installation_id, fail=fail)
        self.max_pages_seen = []

    def paginate(self, path, params=None, max_pages=None):
        self.max_pages_seen.append(max_pages)
        return super().paginate(path, params=params, max_pages=max_pages)


def test_first_sync_uses_initial_page_cap_then_incremental(env, monkeypatch):
    # First sync of a fresh connection fetches the larger INITIAL page cap so the
    # user does not have to press "Sync now" repeatedly; the next sync drops to
    # the lighter incremental cap.
    monkeypatch.setenv("GITHUB_SYNC_INITIAL_MAX_PAGES", "4")
    monkeypatch.setenv("GITHUB_SYNC_MAX_PAGES", "1")
    rec = _RecordingClient("100")
    monkeypatch.setattr(gh_sync, "GitHubClient", lambda iid: rec)

    gh_sync.initial_sync("p1")
    assert rec.max_pages_seen and set(rec.max_pages_seen) == {4}   # every resource

    # last_sync_at is now stamped → the second sync is incremental.
    conn = gh_store.get_connection("p1")
    assert conn.last_sync_at  # first sync recorded a timestamp
    rec2 = _RecordingClient("100")
    monkeypatch.setattr(gh_sync, "GitHubClient", lambda iid: rec2)
    gh_sync.sync_connection(conn)
    assert set(rec2.max_pages_seen) == {1}


def test_sync_marks_last_sync_even_on_partial_failure(env, monkeypatch):
    monkeypatch.setattr(gh_sync, "GitHubClient", lambda iid: _FakeClient(iid, fail={"pulls"}))
    report = gh_sync.sync_connection(gh_store.get_connection("p1"))
    assert report.ok is False
    # Some resources still ingested → last_sync_at is stamped (mirrors Gmail).
    assert gh_store.get_connection("p1").last_sync_at


def test_github_package_imports_no_ai_or_model_modules():
    # A static guarantee that the connector cannot make a model/embedding call:
    # its source imports no provider / ai_client / embedding module.
    import pathlib
    pkg = pathlib.Path(gh_sync.__file__).parent
    forbidden = ("providers", "ai_client", "anthropic", "openai",
                 "embedding", "embeddings", "ai_router", "prompts")
    for py in pkg.glob("*.py"):
        src = py.read_text()
        for term in forbidden:
            assert f"import {term}" not in src and f"from {term}" not in src, \
                f"{py.name} references AI/model module '{term}'"
            assert f"services.providers" not in src, f"{py.name} imports providers"
