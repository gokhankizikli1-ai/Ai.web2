# coding: utf-8
"""GitHub connector — bounded initial (backfill) sync.

Brings USEFUL RECENT GitHub state for a connected project into the Business
Brain as normalized observations. This is deliberately NOT a full-history
crawl:

  * BOUNDED — each resource fetches at most `sync_max_pages` (config, ≤5) pages
    of `sync_page_size` (config, ≤100) items. Nothing walks the whole repo.
  * IDEMPOTENT — every observation carries a deterministic, state-aware
    `external_id`, so re-running the sync (or a webhook that already delivered
    the same state) writes no duplicate (dedup happens in the store).
  * SOURCE-TIME TRUTHFUL — observations are ordered by GitHub's own timestamps,
    so a backfill of old state never masquerades as "new change".
  * PARTIAL-FAILURE TOLERANT — a provider failure on one resource is recorded
    as a typed error for that resource and the sync continues with the others;
    a failure is NEVER converted into an empty success.
  * ZERO model calls, ZERO embeddings. Pure REST reads + SQLite writes.

Prioritized signals: recent pull requests, recent issues, recent CI
(Actions workflow runs), recent deployments, recent commit activity.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List

from backend.services.github import normalize
from backend.services.github.client import GitHubClient
from backend.services.github.errors import GitHubError
from backend.services.github.ingest import IngestResult, ingest_many
from backend.services.github.store import GitHubConnection, get_connection

logger = logging.getLogger(__name__)


@dataclass
class SyncReport:
    project_id: str
    repo_full_name: str
    recorded: int = 0
    deduplicated: int = 0
    rejected: int = 0
    # resource → typed error string; empty ⇒ that resource synced cleanly.
    errors: Dict[str, str] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        """A sync is only "ok" when NO resource failed. Partial failure is
        surfaced truthfully, never smoothed into success."""
        return not self.errors

    def as_dict(self) -> Dict[str, Any]:
        return {
            "project_id": self.project_id,
            "repo": self.repo_full_name,
            "recorded": self.recorded,
            "deduplicated": self.deduplicated,
            "rejected": self.rejected,
            "errors": dict(self.errors),
            "ok": self.ok,
        }

    def _merge(self, r: IngestResult) -> None:
        self.recorded += r.recorded
        self.deduplicated += r.deduplicated
        self.rejected += r.rejected


def initial_sync(project_id: str) -> SyncReport:
    """Run the bounded backfill for a connected project. Requires an existing
    connection (created via the connect route). Returns a truthful report."""
    conn = get_connection(project_id)
    if conn is None:
        return SyncReport(project_id=str(project_id), repo_full_name="",
                          errors={"connection": "no GitHub connection for project"})
    return sync_connection(conn)


def sync_connection(conn: GitHubConnection) -> SyncReport:
    report = SyncReport(project_id=conn.project_id, repo_full_name=conn.repo_full_name)
    client = GitHubClient(conn.installation_id)
    owner_repo = conn.repo_full_name

    # Resolve the repo once for the stable numeric id (repo rename resilience)
    # and to fail fast+truthfully on a bad installation/repo before fanning out.
    try:
        repo = client.get_repo(owner_repo)
    except GitHubError as exc:
        report.errors["repo"] = _err(exc)
        return report

    def _run(resource: str, fetch) -> None:
        try:
            items = fetch()
        except GitHubError as exc:
            report.errors[resource] = _err(exc)
            return
        report._merge(ingest_many(conn, items))

    _run("pull_requests", lambda: _pull_requests(client, owner_repo, repo))
    _run("issues", lambda: _issues(client, owner_repo, repo))
    _run("workflow_runs", lambda: _workflow_runs(client, owner_repo, repo))
    _run("deployments", lambda: _deployments(client, owner_repo, repo))
    _run("commits", lambda: _commits(client, owner_repo, repo))
    return report


# ── per-resource fetch+normalize (bounded) ───────────────────────────────────

def _owner_repo(full: str) -> str:
    return full.strip().strip("/")


def _pull_requests(client: GitHubClient, full: str, repo: Dict[str, Any]) -> List[Dict[str, Any]]:
    items = client.paginate(
        f"/repos/{_owner_repo(full)}/pulls",
        params={"state": "all", "sort": "updated", "direction": "desc"},
    )
    out = []
    for pr in items:
        o = normalize.normalize_pull_request(pr, repo)
        if o:
            out.append(o)
    return out


def _issues(client: GitHubClient, full: str, repo: Dict[str, Any]) -> List[Dict[str, Any]]:
    items = client.paginate(
        f"/repos/{_owner_repo(full)}/issues",
        params={"state": "all", "sort": "updated", "direction": "desc"},
    )
    out = []
    for issue in items:
        o = normalize.normalize_issue(issue, repo)  # PRs are filtered inside
        if o:
            out.append(o)
    return out


def _workflow_runs(client: GitHubClient, full: str, repo: Dict[str, Any]) -> List[Dict[str, Any]]:
    data = client.paginate(
        f"/repos/{_owner_repo(full)}/actions/runs",
        params={"status": "completed"},
    )
    # The Actions runs endpoint wraps the list in {"workflow_runs":[...]}. When
    # a single page is returned as that dict, unwrap it; when paginate already
    # flattened list pages, items are the runs themselves.
    runs: List[Dict[str, Any]] = []
    for entry in data:
        if isinstance(entry, dict) and isinstance(entry.get("workflow_runs"), list):
            runs.extend(x for x in entry["workflow_runs"] if isinstance(x, dict))
        elif isinstance(entry, dict):
            runs.append(entry)
    out = []
    for run in runs:
        o = normalize.normalize_workflow_run(run, repo)
        if o:
            out.append(o)
    return out


def _deployments(client: GitHubClient, full: str, repo: Dict[str, Any]) -> List[Dict[str, Any]]:
    items = client.paginate(f"/repos/{_owner_repo(full)}/deployments")
    out = []
    for dep in items:
        o = normalize.normalize_deployment(dep, repo)
        if o:
            out.append(o)
    return out


def _commits(client: GitHubClient, full: str, repo: Dict[str, Any]) -> List[Dict[str, Any]]:
    items = client.paginate(f"/repos/{_owner_repo(full)}/commits")
    out = []
    for commit in items:
        o = normalize.normalize_commit(commit, repo)
        if o:
            out.append(o)
    return out


def _err(exc: GitHubError) -> str:
    status = getattr(exc, "status", None)
    return f"{type(exc).__name__}" + (f" (HTTP {status})" if status else "")


__all__ = ["SyncReport", "initial_sync", "sync_connection"]
