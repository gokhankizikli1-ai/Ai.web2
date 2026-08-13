# coding: utf-8
"""GitHub connector — pure normalization contract.

Covers the observation-shape + deterministic, state-transition-aware
provider_event_id (external_id) guarantees. No DB, no network, no model.
"""
from __future__ import annotations

from backend.services.github import normalize
from backend.services.orchestrator.observations_store import (
    IMPORTANCE_HIGH, IMPORTANCE_LOW, IMPORTANCE_NORMAL,
)

REPO = {"id": 42, "full_name": "octo/hello"}


# ── pull requests ────────────────────────────────────────────────────────────

def test_pr_opened_normalizes():
    o = normalize.normalize_pull_request(
        {"number": 7, "state": "open", "title": "Add feature",
         "user": {"login": "alice"}, "html_url": "u",
         "base": {"ref": "main"}, "head": {"ref": "feat"},
         "created_at": "2024-01-01T00:00:00Z", "updated_at": "2024-01-02T00:00:00Z"},
        REPO)
    assert o["kind"] == "github.pull_request.opened"
    assert o["external_id"] == "github:pr:42:7:opened"
    assert o["source"] == "github"
    assert o["observed_at"] == "2024-01-02T00:00:00Z"
    assert o["importance"] == IMPORTANCE_NORMAL
    assert o["payload"]["author"] == "alice"
    assert o["payload"]["base_ref"] == "main"
    # bounded evidence only — no diff / file blobs
    assert set(o["payload"]).issubset(
        {"repo", "number", "title", "state", "merged", "author",
         "base_ref", "head_ref", "url"})


def test_pr_merged_is_distinct_transition_from_opened():
    opened = normalize.normalize_pull_request({"number": 7, "state": "open", "title": "x"}, REPO)
    merged = normalize.normalize_pull_request(
        {"number": 7, "state": "closed", "merged": True,
         "merged_at": "2024-02-01T00:00:00Z", "title": "x"}, REPO)
    assert opened["external_id"] == "github:pr:42:7:opened"
    assert merged["external_id"] == "github:pr:42:7:merged"
    assert merged["kind"] == "github.pull_request.merged"
    assert merged["observed_at"] == "2024-02-01T00:00:00Z"
    # A real transition ⇒ two different idempotency keys ⇒ two observations.
    assert opened["external_id"] != merged["external_id"]


def test_pr_closed_without_merge_is_closed_not_merged():
    o = normalize.normalize_pull_request(
        {"number": 9, "state": "closed", "merged": False,
         "closed_at": "2024-03-01T00:00:00Z", "title": "y"}, REPO)
    assert o["external_id"] == "github:pr:42:9:closed"
    assert o["kind"] == "github.pull_request.closed"


def test_pr_webhook_action_overrides_state():
    # action="closed" + merged ⇒ merged transition (webhook path).
    o = normalize.normalize_pull_request(
        {"number": 5, "state": "closed", "merged": True,
         "merged_at": "2024-01-01T00:00:00Z", "title": "z"},
        REPO, action="closed")
    assert o["external_id"] == "github:pr:42:5:merged"


def test_pr_repo_id_survives_rename():
    # external_id keys on the stable numeric id, so a full_name change does not
    # fork the identity.
    a = normalize.normalize_pull_request({"number": 1, "state": "open", "title": "t"},
                                         {"id": 99, "full_name": "old/name"})
    b = normalize.normalize_pull_request({"number": 1, "state": "open", "title": "t"},
                                         {"id": 99, "full_name": "new/name"})
    assert a["external_id"] == b["external_id"] == "github:pr:99:1:opened"


def test_pr_missing_number_rejected():
    assert normalize.normalize_pull_request({"state": "open"}, REPO) is None
    assert normalize.normalize_pull_request("not a dict", REPO) is None


# ── issues ───────────────────────────────────────────────────────────────────

def test_issue_open_close_are_distinct():
    opened = normalize.normalize_issue(
        {"number": 3, "state": "open", "title": "Bug", "user": {"login": "bob"}}, REPO)
    closed = normalize.normalize_issue(
        {"number": 3, "state": "closed", "title": "Bug",
         "closed_at": "2024-05-01T00:00:00Z"}, REPO)
    assert opened["external_id"] == "github:issue:42:3:opened"
    assert closed["external_id"] == "github:issue:42:3:closed"
    assert opened["importance"] == IMPORTANCE_NORMAL
    assert closed["importance"] == IMPORTANCE_LOW


def test_issue_endpoint_pr_is_skipped():
    # GitHub's issues endpoint also returns PRs (they carry `pull_request`);
    # those must NOT be normalized here.
    assert normalize.normalize_issue(
        {"number": 3, "state": "open", "title": "PR", "pull_request": {"url": "x"}}, REPO) is None


# ── CI: workflow / check runs ────────────────────────────────────────────────

def test_workflow_failure_is_high_importance_success_is_low():
    fail = normalize.normalize_workflow_run(
        {"id": 111, "status": "completed", "conclusion": "failure",
         "name": "CI", "head_branch": "main", "updated_at": "2024-06-01T00:00:00Z"}, REPO)
    ok = normalize.normalize_workflow_run(
        {"id": 112, "status": "completed", "conclusion": "success",
         "name": "CI", "head_branch": "main"}, REPO)
    assert fail["kind"] == "github.check.failed"
    assert fail["importance"] == IMPORTANCE_HIGH
    assert fail["external_id"] == "github:workflow_run:42:111:failure"
    assert ok["kind"] == "github.check.succeeded"
    assert ok["importance"] == IMPORTANCE_LOW


def test_workflow_failure_then_recovery_distinct_ids():
    # check failed → passed must be two observations (different run ids AND
    # different conclusions both fork the id).
    fail = normalize.normalize_workflow_run(
        {"id": 200, "status": "completed", "conclusion": "failure", "name": "CI"}, REPO)
    passed = normalize.normalize_workflow_run(
        {"id": 201, "status": "completed", "conclusion": "success", "name": "CI"}, REPO)
    assert fail["external_id"] != passed["external_id"]


def test_incomplete_workflow_run_is_not_observed():
    assert normalize.normalize_workflow_run(
        {"id": 1, "status": "in_progress"}, REPO) is None
    assert normalize.normalize_workflow_run(
        {"id": 1, "status": "completed", "conclusion": ""}, REPO) is None


def test_check_run_failure():
    o = normalize.normalize_check_run(
        {"id": 5, "status": "completed", "conclusion": "timed_out", "name": "lint"}, REPO)
    assert o["external_id"] == "github:check_run:42:5:timed_out"
    assert o["importance"] == IMPORTANCE_HIGH


# ── deployments ──────────────────────────────────────────────────────────────

def test_deployment_created_and_status_transitions():
    created = normalize.normalize_deployment(
        {"id": 77, "environment": "prod", "ref": "abc", "created_at": "2024-07-01T00:00:00Z"}, REPO)
    assert created["external_id"] == "github:deployment:42:77:created"
    assert created["importance"] == IMPORTANCE_NORMAL

    pending = normalize.normalize_deployment_status(
        {"state": "pending", "created_at": "2024-07-01T00:00:01Z"}, {"id": 77}, REPO)
    success = normalize.normalize_deployment_status(
        {"state": "success", "created_at": "2024-07-01T00:05:00Z"}, {"id": 77}, REPO)
    failure = normalize.normalize_deployment_status(
        {"state": "failure", "created_at": "2024-07-01T00:05:00Z"}, {"id": 77}, REPO)
    assert pending["external_id"] == "github:deployment_status:42:77:pending"
    assert success["external_id"] == "github:deployment_status:42:77:success"
    assert failure["external_id"] == "github:deployment_status:42:77:failure"
    # pending → success → failure are three distinct observations.
    assert len({pending["external_id"], success["external_id"], failure["external_id"]}) == 3
    assert failure["importance"] == IMPORTANCE_HIGH
    assert success["importance"] == IMPORTANCE_NORMAL


# ── commits ──────────────────────────────────────────────────────────────────

def test_commit_keyed_by_immutable_sha_rest_and_push_converge():
    rest = normalize.normalize_commit(
        {"sha": "deadbeefcafe", "commit": {"message": "Fix\nbody",
         "author": {"name": "Ann", "date": "2024-08-01T00:00:00Z"}},
         "author": {"login": "ann"}, "html_url": "u"}, REPO)
    push = normalize.normalize_commit(
        {"id": "deadbeefcafe", "message": "Fix\nbody",
         "author": {"name": "Ann"}, "timestamp": "2024-08-01T00:00:00Z", "url": "u"}, REPO)
    assert rest["external_id"] == push["external_id"] == "github:commit:42:deadbeefcafe"
    assert rest["payload"]["message"] == "Fix"   # first line only
    assert rest["importance"] == IMPORTANCE_LOW


# ── webhook dispatcher ───────────────────────────────────────────────────────

def test_webhook_dispatch_maps_events():
    payload = {"action": "opened", "repository": REPO,
               "pull_request": {"number": 1, "state": "open", "title": "t"}}
    out = normalize.normalize_webhook_event("pull_request", payload)
    assert len(out) == 1 and out[0]["external_id"] == "github:pr:42:1:opened"


def test_webhook_ping_and_unsupported_are_safe_ignored():
    assert normalize.normalize_webhook_event("ping", {"zen": "x", "repository": REPO}) == []
    assert normalize.normalize_webhook_event("star", {"repository": REPO}) == []
    assert normalize.normalize_webhook_event("pull_request", "not a dict") == []


def test_webhook_push_fans_out_per_commit_bounded():
    commits = [{"id": f"sha{i:040d}", "message": f"c{i}",
                "author": {"name": "x"}, "timestamp": "2024-01-01T00:00:00Z"}
               for i in range(50)]
    out = normalize.normalize_webhook_event("push", {"repository": REPO, "commits": commits})
    # capped at _MAX_COMMITS_PER_PUSH (20) — one push can't fan out unbounded.
    assert len(out) == 20
    assert all(o["kind"] == "github.commit.pushed" for o in out)
