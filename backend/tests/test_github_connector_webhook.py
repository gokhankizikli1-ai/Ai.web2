# coding: utf-8
"""GitHub connector — webhook handler: signature, dedup, routing, isolation."""
from __future__ import annotations

import json

import pytest

from backend.services.github import store as gh_store
from backend.services.github import webhook as gh_webhook
from backend.services.orchestrator import observations_store as obs

SECRET = "hook-secret-xyz"
REPO = {"id": 42, "full_name": "octo/hello"}


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
    return path


def _body(event_payload) -> bytes:
    return json.dumps(event_payload).encode("utf-8")


# ── signature verification ───────────────────────────────────────────────────

def test_valid_signature_accepted():
    body = _body({"zen": "x"})
    sig = gh_webhook.compute_signature(body, SECRET)
    assert sig.startswith("sha256=")
    assert gh_webhook.verify_signature(body, sig, SECRET) is True


def test_invalid_and_missing_signature_rejected():
    body = _body({"zen": "x"})
    good = gh_webhook.compute_signature(body, SECRET)
    assert gh_webhook.verify_signature(body, good, "wrong-secret") is False
    assert gh_webhook.verify_signature(body, "", SECRET) is False
    assert gh_webhook.verify_signature(body, "sha1=deadbeef", SECRET) is False
    assert gh_webhook.verify_signature(body, good, "") is False  # no secret ⇒ fail closed
    # tampered body ⇒ mismatch
    assert gh_webhook.verify_signature(_body({"zen": "y"}), good, SECRET) is False


# ── handle_delivery (assumes verified bytes) ─────────────────────────────────

def _pr_payload(number, action, *, installation="100"):
    return {
        "action": action,
        "installation": {"id": installation},
        "repository": REPO,
        "pull_request": {"number": number, "state": "open", "title": "T"},
    }


def test_handle_records_observation_under_project_scope(env):
    body = _body(_pr_payload(1, "opened"))
    res = gh_webhook.handle_delivery(raw_body=body, event="pull_request", delivery_id="d1")
    assert res.status == "recorded"
    assert res.recorded == 1
    assert res.projects == ["p1"]
    recorded = obs.list_observations("p1")
    assert len(recorded) == 1
    assert recorded[0]["user_id"] == "uA"            # connection owner, not payload
    assert recorded[0]["kind"] == "github.pull_request.opened"


def test_duplicate_delivery_id_is_not_reprocessed(env):
    body = _body(_pr_payload(1, "opened"))
    r1 = gh_webhook.handle_delivery(raw_body=body, event="pull_request", delivery_id="dup")
    r2 = gh_webhook.handle_delivery(raw_body=body, event="pull_request", delivery_id="dup")
    assert r1.status == "recorded"
    assert r2.status == "duplicate"
    assert len(obs.list_observations("p1")) == 1     # not double-recorded


def test_observation_idempotency_across_distinct_deliveries(env):
    # Same state delivered under two different delivery ids (e.g. sync overlap):
    # the store's external_id uniqueness still prevents a duplicate observation.
    body = _body(_pr_payload(1, "opened"))
    gh_webhook.handle_delivery(raw_body=body, event="pull_request", delivery_id="a")
    r2 = gh_webhook.handle_delivery(raw_body=body, event="pull_request", delivery_id="b")
    assert r2.status == "duplicate"
    assert r2.deduplicated == 1
    assert len(obs.list_observations("p1")) == 1


def test_state_transition_creates_new_observation(env):
    gh_webhook.handle_delivery(raw_body=_body(_pr_payload(1, "opened")),
                               event="pull_request", delivery_id="a")
    merged = {"action": "closed", "installation": {"id": "100"}, "repository": REPO,
              "pull_request": {"number": 1, "state": "closed", "merged": True,
                               "merged_at": "2024-01-01T00:00:00Z", "title": "T"}}
    res = gh_webhook.handle_delivery(raw_body=_body(merged), event="pull_request", delivery_id="b")
    assert res.status == "recorded"
    kinds = {o["kind"] for o in obs.list_observations("p1")}
    assert kinds == {"github.pull_request.opened", "github.pull_request.merged"}


def test_unsupported_event_is_safe_ignored(env):
    res = gh_webhook.handle_delivery(raw_body=_body({"repository": REPO}),
                                     event="star", delivery_id="s1")
    assert res.status == "ignored"
    assert obs.list_observations("p1") == []


def test_ping_is_ignored(env):
    res = gh_webhook.handle_delivery(raw_body=_body({"zen": "x", "repository": REPO}),
                                     event="ping", delivery_id="pg")
    assert res.status == "ignored"


def test_unknown_repo_fails_safe(env):
    # A repo/installation with no connection resolves to nothing → ignored, no
    # observation written anywhere.
    payload = {"action": "opened", "installation": {"id": "999"},
               "repository": {"id": 7, "full_name": "someone/else"},
               "pull_request": {"number": 1, "state": "open", "title": "T"}}
    res = gh_webhook.handle_delivery(raw_body=_body(payload), event="pull_request", delivery_id="u1")
    assert res.status == "ignored"
    assert res.reason.startswith("no project connected")
    assert obs.list_observations("p1") == []


def test_cross_project_isolation(env):
    # Second project owned by a DIFFERENT user, connected to a DIFFERENT repo.
    gh_store.upsert_connection(project_id="p2", owner_user_id="uB",
                               installation_id="200", repo_full_name="octo/other", repo_id="99")
    # An event for repo octo/hello (installation 100) must land ONLY in p1/uA.
    gh_webhook.handle_delivery(raw_body=_body(_pr_payload(1, "opened")),
                               event="pull_request", delivery_id="x")
    assert len(obs.list_observations("p1")) == 1
    assert obs.list_observations("p2") == []       # no leak into user B's project


def test_malformed_json_is_rejected(env):
    res = gh_webhook.handle_delivery(raw_body=b"{not json",
                                     event="pull_request", delivery_id="m1")
    assert res.status == "rejected"


def test_missing_installation_or_repo_ignored(env):
    res = gh_webhook.handle_delivery(
        raw_body=_body({"action": "opened",
                        "pull_request": {"number": 1, "state": "open", "title": "T"}}),
        event="pull_request", delivery_id="mi")
    assert res.status == "ignored"
