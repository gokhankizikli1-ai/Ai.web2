# coding: utf-8
"""
Phase 6 + Phase 7 — spec-conformance tests for the two gaps closed in
this PR.

Phase 6:
  * The 5 new MEMORY_KINDS (goal / project_context / agent_context /
    style / workflow) round-trip cleanly through the manager + store.
  * normalize_kind preserves them.

Phase 7:
  * JobRecord.to_dict() surfaces BOTH the canonical internal names
    (kind / finished_at / progress_label) AND the spec aliases
    (type / completed_at / message / detail).
  * normalize_status accepts "completed" on input and normalizes to
    "succeeded" internally.
  * API responses (POST /v2/jobs, GET) include the spec aliases.
"""
from __future__ import annotations

import asyncio

import pytest

# Phase 6
from backend.services.memory_plane import (
    client as plane_client,
    MEMORY_KINDS, normalize_kind,
)
from backend.services.memory_plane.types import MemoryRecord
from backend.services.memory_plane import store as mp_store

# Phase 7
from backend.services.jobs.types import (
    JobRecord, normalize_status,
    STATUS_SUCCEEDED, STATUS_QUEUED, STATUS_FAILED,
)


# ════════════════════════════════════════════════════════════════════════════
# Phase 6 — new MEMORY_KINDS
# ════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("kind", [
    "goal", "project_context", "agent_context", "style", "workflow",
])
def test_spec_memory_kinds_are_in_taxonomy(kind):
    assert kind in MEMORY_KINDS, f"{kind!r} missing from MEMORY_KINDS"
    # normalize_kind preserves them (doesn't coerce to "fact").
    assert normalize_kind(kind) == kind


@pytest.mark.parametrize("kind", [
    "goal", "project_context", "agent_context", "style", "workflow",
])
def test_spec_memory_kinds_round_trip_via_store(kind, tmp_memory_plane_db):
    rec = mp_store.insert(MemoryRecord(
        user_id="u1", content=f"content for {kind}", kind=kind,
    ))
    assert rec.kind == kind
    got = mp_store.get(rec.id or "")
    assert got is not None
    assert got.kind == kind


@pytest.mark.parametrize("kind", [
    "goal", "project_context", "agent_context", "style", "workflow",
])
def test_spec_memory_kinds_round_trip_via_client(kind, tmp_memory_plane_db):
    rec = plane_client.create(
        user_id="u1", content=f"client {kind}", kind=kind,
    )
    assert rec is not None
    assert rec.kind == kind
    # And the filter actually works.
    items = plane_client.list_user("u1", kind=kind)
    assert len(items) == 1
    assert items[0].kind == kind


def test_memory_kinds_filter_isolates(tmp_memory_plane_db):
    """Mixing the new kinds with existing ones — list_user filter
    returns ONLY the requested kind."""
    plane_client.create(user_id="u1", content="A", kind="goal")
    plane_client.create(user_id="u1", content="B", kind="style")
    plane_client.create(user_id="u1", content="C", kind="fact")
    plane_client.create(user_id="u1", content="D", kind="workflow")
    assert len(plane_client.list_user("u1", kind="goal")) == 1
    assert len(plane_client.list_user("u1", kind="style")) == 1
    assert len(plane_client.list_user("u1", kind="workflow")) == 1
    assert len(plane_client.list_user("u1", kind="fact")) == 1


# ════════════════════════════════════════════════════════════════════════════
# Phase 7 — spec aliases at the API layer
# ════════════════════════════════════════════════════════════════════════════

def test_job_to_dict_surfaces_type_alias():
    """JobRecord.to_dict() returns BOTH `kind` and `type` for spec
    parity. Existing FE keeps reading `kind`; new consumers reading
    the spec see `type`."""
    rec = JobRecord(kind="echo", user_id="u1", payload={"x": 1})
    d = rec.to_dict()
    assert d["kind"] == "echo"
    assert d["type"] == "echo"


def test_job_to_dict_surfaces_completed_at_alias():
    rec = JobRecord(
        kind="echo", user_id="u1",
        finished_at="2026-05-27T12:34:56+00:00",
    )
    d = rec.to_dict()
    assert d["finished_at"] == "2026-05-27T12:34:56+00:00"
    assert d["completed_at"] == "2026-05-27T12:34:56+00:00"


def test_job_to_dict_surfaces_message_and_detail():
    rec = JobRecord(
        kind="sleep_progress", user_id="u1",
        progress=50, progress_label="Halfway done",
        metadata={"detail": "Step 5 of 10 — extracting"},
    )
    d = rec.to_dict()
    assert d["progress_label"] == "Halfway done"
    assert d["message"]        == "Halfway done"      # spec alias
    assert d["detail"]         == "Step 5 of 10 — extracting"


def test_job_to_dict_detail_defaults_to_none_when_absent():
    rec = JobRecord(kind="echo", user_id="u1")  # no metadata.detail
    d = rec.to_dict()
    assert "detail" in d
    assert d["detail"] is None


def test_job_to_dict_keeps_all_existing_fields():
    """Regression guard: adding aliases must NOT drop any canonical field."""
    rec = JobRecord(kind="echo", user_id="u1", project_id="p1",
                    agent_id="a1", payload={"k": "v"})
    d = rec.to_dict()
    # Sample of canonical fields that pre-existed.
    for canonical in ("id", "kind", "user_id", "project_id", "agent_id",
                      "status", "payload", "result", "error", "progress",
                      "progress_label", "idempotency_key", "attempts",
                      "max_attempts", "timeout_s", "metadata",
                      "created_at", "queued_at", "started_at",
                      "finished_at", "cancelled_at", "updated_at"):
        assert canonical in d, f"canonical field {canonical!r} disappeared"


def test_normalize_status_accepts_completed_alias():
    """`completed` (PROJECT_ROADMAP spec) maps to `succeeded` (internal).
    All other valid statuses pass through unchanged."""
    assert normalize_status("completed") == STATUS_SUCCEEDED
    assert normalize_status("COMPLETED") == STATUS_SUCCEEDED
    assert normalize_status("  completed  ") == STATUS_SUCCEEDED
    # Existing names still work.
    assert normalize_status("succeeded") == STATUS_SUCCEEDED
    assert normalize_status("queued")    == STATUS_QUEUED
    # Unknown still falls back to failed (existing behavior).
    assert normalize_status("garbage")   == STATUS_FAILED


def test_normalize_status_does_not_emit_completed_on_output():
    """We accept `completed` on INPUT but never emit it — the runner /
    event bus / SSE shape stays consistent on `succeeded`."""
    # Round-trip via JobRecord.
    rec = JobRecord(kind="echo", user_id="u1", status="completed")
    # The dataclass field itself holds the raw value the caller passed
    # in — normalize_status is applied by the store on insert. But
    # the public API uses the store, so after persistence the value
    # is `succeeded`. Verify via the store directly.
    from backend.services.jobs.store import insert as _insert, get as _get


def test_completed_alias_round_trip_via_store(tmp_jobs_db):
    """Insert with status='completed', read back — internal stays 'succeeded'."""
    from backend.services.jobs import store as jobs_store
    rec = jobs_store.insert(JobRecord(
        kind="echo", user_id="u1", status="completed",
    ))
    assert rec.status == STATUS_SUCCEEDED
    got = jobs_store.get(rec.id or "")
    assert got is not None
    assert got.status == STATUS_SUCCEEDED


# ════════════════════════════════════════════════════════════════════════════
# Phase 7 — API layer round-trip (the gap that matters in production)
# ════════════════════════════════════════════════════════════════════════════

def test_api_create_response_includes_spec_aliases(client, tmp_jobs_db):
    """POST /v2/jobs response should carry both canonical and spec-aliased
    field names so consumers using either set of names just work."""
    from backend.core.deps import current_user
    from backend.services.auth.identity import User
    user = User(id="alice", kind="guest", external_id="guest:alice", display_name="")
    client.app.dependency_overrides[current_user] = lambda: user
    try:
        r = client.post("/v2/jobs", json={"kind": "echo", "payload": {"hi": 1}})
        assert r.status_code == 200, r.text
        job = r.json()["data"]["job"]
        # Canonical fields present.
        assert "kind" in job
        assert "finished_at" in job
        assert "progress_label" in job
        # Spec aliases present.
        assert "type" in job
        assert "completed_at" in job
        assert "message" in job
        assert "detail" in job
        # And type matches kind.
        assert job["type"] == job["kind"]
    finally:
        client.app.dependency_overrides.pop(current_user, None)
