# coding: utf-8
"""
Phase 7 — /v2/jobs route tests.

Covers:
  * Flag-off → 503 envelope
  * Create + read happy path
  * Cross-user 404
  * List + filters + pagination metadata
  * Cancel + retry + invalid transition
  * SSE stream — initial snapshot, terminal close
  * Owner /v2/jobs/all gate (non-owner → 404)
  * Diagnostic endpoint
  * Unknown kind rejected with 400
  * Empty/invalid body → 422
"""
from __future__ import annotations

import asyncio
import time

import pytest

from backend.core.deps import current_user
from backend.services.auth.identity import User


def _make_user(uid: str, kind: str = "guest") -> User:
    return User(id=uid, kind=kind, external_id=f"{kind}:{uid}",
                display_name="")


@pytest.fixture()
def alice(app):
    user = _make_user("alice-uid")
    app.dependency_overrides[current_user] = lambda: user
    yield user
    app.dependency_overrides.pop(current_user, None)


@pytest.fixture()
def bob(app):
    user = _make_user("bob-uid")
    app.dependency_overrides[current_user] = lambda: user
    yield user
    app.dependency_overrides.pop(current_user, None)


def _wait_until(client, job_id: str, *, status: str, timeout_s: float = 5.0):
    """Poll GET /v2/jobs/{id} until the job hits the requested status
    (or a terminal status). Returns the last response."""
    deadline = time.monotonic() + timeout_s
    last = None
    while time.monotonic() < deadline:
        r = client.get(f"/v2/jobs/{job_id}")
        last = r
        if r.status_code == 200:
            cur = r.json()["data"]["job"]["status"]
            if cur == status or cur in {"succeeded", "failed", "cancelled"}:
                return r
        time.sleep(0.05)
    return last


# ── Feature gate ─────────────────────────────────────────────────────────────

def test_flag_off_returns_503(client, monkeypatch, alice):
    monkeypatch.setenv("ENABLE_JOB_QUEUE", "false")
    r = client.post("/v2/jobs", json={"kind": "echo"})
    assert r.status_code == 503
    assert r.json()["detail"]["code"] == "JOB_QUEUE_DISABLED"


# ── Create + read ────────────────────────────────────────────────────────────

def test_create_echo_returns_envelope(client, tmp_jobs_db, alice):
    r = client.post("/v2/jobs", json={
        "kind": "echo", "payload": {"hello": "world"},
    })
    assert r.status_code == 200
    body = r.json()
    job = body["data"]["job"]
    assert body["success"] is True
    assert job["kind"] == "echo"
    assert job["user_id"] == alice.id
    assert job["status"] in {"queued", "running", "succeeded"}


def test_create_unknown_kind_returns_400(client, tmp_jobs_db, alice):
    r = client.post("/v2/jobs", json={"kind": "not_a_real_kind"})
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "JOB_KIND_UNKNOWN"


def test_create_invalid_body_returns_422(client, tmp_jobs_db, alice):
    r = client.post("/v2/jobs", json={})       # missing kind
    assert r.status_code == 422


def test_get_returns_job(client, tmp_jobs_db, alice):
    rid = client.post("/v2/jobs", json={"kind": "echo"}).json()["data"]["job"]["id"]
    r = client.get(f"/v2/jobs/{rid}")
    assert r.status_code == 200
    assert r.json()["data"]["job"]["id"] == rid


def test_get_unknown_returns_404(client, tmp_jobs_db, alice):
    r = client.get("/v2/jobs/does-not-exist")
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "JOB_NOT_FOUND"


# ── Cross-user isolation ─────────────────────────────────────────────────────

def test_cross_user_get_returns_404(client, tmp_jobs_db, app):
    """Alice's job MUST NOT be visible to Bob."""
    alice = _make_user("alice-uid")
    app.dependency_overrides[current_user] = lambda: alice
    rid = client.post("/v2/jobs", json={"kind": "echo"}).json()["data"]["job"]["id"]
    bob = _make_user("bob-uid")
    app.dependency_overrides[current_user] = lambda: bob
    r = client.get(f"/v2/jobs/{rid}")
    assert r.status_code == 404
    app.dependency_overrides.pop(current_user, None)


def test_cross_user_cancel_returns_404(client, tmp_jobs_db, app):
    alice = _make_user("alice-uid")
    app.dependency_overrides[current_user] = lambda: alice
    rid = client.post("/v2/jobs", json={
        "kind": "sleep_progress",
        "payload": {"steps": 50, "step_delay_s": 0.05},
    }).json()["data"]["job"]["id"]
    bob = _make_user("bob-uid")
    app.dependency_overrides[current_user] = lambda: bob
    r = client.post(f"/v2/jobs/{rid}/cancel")
    assert r.status_code == 404
    app.dependency_overrides.pop(current_user, None)


# ── List + pagination ────────────────────────────────────────────────────────

def test_list_returns_only_caller_jobs(client, tmp_jobs_db, app):
    alice = _make_user("alice-uid")
    app.dependency_overrides[current_user] = lambda: alice
    for _ in range(2):
        client.post("/v2/jobs", json={"kind": "echo"})
    bob = _make_user("bob-uid")
    app.dependency_overrides[current_user] = lambda: bob
    client.post("/v2/jobs", json={"kind": "echo"})
    r = client.get("/v2/jobs").json()
    assert len(r["data"]["jobs"]) == 1   # only bob's
    app.dependency_overrides.pop(current_user, None)


def test_list_pagination_metadata(client, tmp_jobs_db, alice):
    for _ in range(5):
        client.post("/v2/jobs", json={"kind": "echo"})
    r = client.get("/v2/jobs?limit=2&offset=1").json()
    assert r["metadata"]["limit"] == 2
    assert r["metadata"]["offset"] == 1
    assert len(r["data"]["jobs"]) == 2


def test_list_kind_filter(client, tmp_jobs_db, alice):
    client.post("/v2/jobs", json={"kind": "echo"})
    client.post("/v2/jobs", json={"kind": "sleep_progress",
                                  "payload": {"steps": 1, "step_delay_s": 0.01}})
    r = client.get("/v2/jobs?kind=sleep_progress").json()
    kinds = [j["kind"] for j in r["data"]["jobs"]]
    assert kinds == ["sleep_progress"]


# ── Cancel + retry ───────────────────────────────────────────────────────────

def test_cancel_running_job(client, tmp_jobs_db, alice):
    """Validates the cancel-API contract — does NOT depend on the
    runner actually executing.

    NOTE: TestClient (httpx.ASGITransport) tears down its event loop
    after each request, which cancels in-process background Tasks.
    Production uvicorn does NOT have this problem (single long-lived
    loop — verified by `test_cancel_running_job` in test_jobs_runner.py
    using direct asyncio.run). Here we set status=running via the
    store and exercise the route-level cancel logic in isolation.
    """
    from backend.services.jobs import store as _store
    from backend.services.jobs.types import STATUS_RUNNING
    rid = client.post("/v2/jobs", json={"kind": "echo"}).json()["data"]["job"]["id"]
    # Force a "running" state for the test (production runner would do this).
    _store.update(rid, status=STATUS_RUNNING, started_at="2026-01-01T00:00:00+00:00")
    r = client.post(f"/v2/jobs/{rid}/cancel")
    assert r.status_code == 200
    assert r.json()["data"]["job"]["status"] == "cancelled"


def test_cancel_terminal_returns_409(client, tmp_jobs_db, alice):
    rid = client.post("/v2/jobs", json={"kind": "echo"}).json()["data"]["job"]["id"]
    _wait_until(client, rid, status="succeeded")
    r = client.post(f"/v2/jobs/{rid}/cancel")
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "JOB_INVALID_TRANSITION"


def test_retry_succeeded_returns_409(client, tmp_jobs_db, alice):
    """Successful jobs are NOT retryable — only failed/cancelled are."""
    rid = client.post("/v2/jobs", json={"kind": "echo"}).json()["data"]["job"]["id"]
    _wait_until(client, rid, status="succeeded")
    r = client.post(f"/v2/jobs/{rid}/retry", json={})
    assert r.status_code == 409


def test_retry_cancelled_job(client, tmp_jobs_db, alice):
    """Force a cancelled state via the store, then exercise the
    retry-route contract. See note on test_cancel_running_job for
    why we bypass the background runner here."""
    from backend.services.jobs import store as _store
    from backend.services.jobs.types import STATUS_CANCELLED
    rid = client.post("/v2/jobs", json={"kind": "echo"}).json()["data"]["job"]["id"]
    _store.update(rid, status=STATUS_CANCELLED, cancelled_at="2026-01-01T00:00:00+00:00",
                  finished_at="2026-01-01T00:00:00+00:00")
    r = client.post(f"/v2/jobs/{rid}/retry", json={})
    assert r.status_code == 200
    # Retry resets the row to queued. The runner may or may not pick
    # it up depending on the test transport — both states are valid.
    assert r.json()["data"]["job"]["status"] in {"queued", "running", "succeeded", "failed"}


# ── Idempotency ──────────────────────────────────────────────────────────────

def test_idempotency_same_id_returned(client, tmp_jobs_db, alice):
    a = client.post("/v2/jobs", json={
        "kind": "echo", "payload": {"x": 1},
        "idempotency_key": "abc",
    }).json()["data"]["job"]["id"]
    b = client.post("/v2/jobs", json={
        "kind": "echo", "payload": {"x": 2},
        "idempotency_key": "abc",
    }).json()["data"]["job"]["id"]
    assert a == b


# ── Owner-only /v2/jobs/all ──────────────────────────────────────────────────

def test_list_all_hidden_from_non_owner(client, tmp_jobs_db, alice):
    r = client.get("/v2/jobs/all")
    # Non-owner gets a generic 404 (route effectively hidden).
    assert r.status_code == 404


# ── Diagnostic ───────────────────────────────────────────────────────────────

def test_diagnostic_endpoint(client, tmp_jobs_db, alice):
    r = client.get("/v2/jobs/health/diagnostic")
    assert r.status_code == 200
    body = r.json()
    assert body["data"]["enabled"] is True
    assert body["data"]["mode"] == "inline"
    assert "echo" in body["metadata"]["public_kinds"]


# ── SSE stream ───────────────────────────────────────────────────────────────

def test_sse_terminal_job_returns_snapshot_then_done(client, tmp_jobs_db, alice):
    """A job that finishes before the SSE consumer connects should
    still get the full picture: snapshot + done."""
    rid = client.post("/v2/jobs", json={"kind": "echo"}).json()["data"]["job"]["id"]
    _wait_until(client, rid, status="succeeded")
    r = client.get(f"/v2/jobs/{rid}/stream")
    assert r.status_code == 200
    txt = r.text
    assert "event: snapshot" in txt
    assert "event: done" in txt


def test_sse_unknown_job_returns_404(client, tmp_jobs_db, alice):
    r = client.get("/v2/jobs/nope/stream")
    assert r.status_code == 404
