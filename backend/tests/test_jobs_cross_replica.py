# coding: utf-8
"""Phase 3 (shared jobs) — cross-replica reconciliation.

Two API replicas share ONE jobs store (Postgres in production; here the
shared SQLite file stands in — the store's reconciliation contract is
identical across both backends: atomic (user_id, kind, idempotency_key)
uniqueness + a stale-worker resurrection guard that never moves a
TERMINAL job back to `running`).

Each test frames a distinct multi-replica hazard:

  * shared observation  — replica B reads the row replica A wrote
  * duplicate create    — two replicas, same idempotency_key → ONE job
  * crash window A      — worker dies mid-run → orphan reaper reconciles
  * crash window B      — job finishes on A; a stale worker on B cannot
                          resurrect it to running (lost-update guard)
  * crash window C      — cancel wins; a stale worker cannot un-cancel
  * timeout             — timed-out (failed) job is not resurrectable
  * retry               — a terminal job CAN be re-queued (allowed path)

CODE-VERIFIED on the shared-SQLite substrate; the Postgres path enforces
the same contract atomically (ON CONFLICT + guarded UPDATE) and is
LIVE-verified on Railway per the PR notes.
"""
from __future__ import annotations

import pytest

from backend.services.jobs import store
from backend.services.jobs.errors import JobIdempotencyConflict
from backend.services.jobs.orphan_reaper import reap_orphans
from backend.services.jobs.types import (
    JobRecord, STATUS_QUEUED, STATUS_RUNNING, STATUS_SUCCEEDED,
    STATUS_FAILED, STATUS_CANCELLED,
)


def _iso(minutes_ago: int = 0) -> str:
    from datetime import datetime, timezone, timedelta
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).isoformat()


# ── Shared observation ─────────────────────────────────────────────────────

def test_replica_b_observes_replica_a_write(tmp_jobs_db):
    """A job created on replica A is fully visible on replica B — one
    shared truth, not a per-replica cache."""
    created = store.insert(JobRecord(kind="echo", user_id="u1",
                                     project_id="proj-1"))
    # Replica B only has the id (e.g. from an SSE reconnect) and reads.
    seen = store.get(created.id)
    assert seen is not None
    assert seen.project_id == "proj-1"
    # Replica A advances progress; replica B sees it.
    store.update(created.id, status=STATUS_RUNNING, progress=55)
    assert store.get(created.id).progress == 55


# ── Duplicate create across replicas ───────────────────────────────────────

def test_two_replicas_same_idempotency_key_yield_one_job(tmp_jobs_db):
    """Both replicas submit the same logical job concurrently. The store
    admits exactly one; the loser gets a JobIdempotencyConflict and can
    reconcile to the winner via get_by_idempotency_key."""
    a = store.insert(JobRecord(kind="echo", user_id="u1", idempotency_key="ship"))
    with pytest.raises(JobIdempotencyConflict):
        store.insert(JobRecord(kind="echo", user_id="u1", idempotency_key="ship"))
    # Loser reconciles to the canonical row.
    winner = store.get_by_idempotency_key(user_id="u1", kind="echo",
                                          idempotency_key="ship")
    assert winner is not None and winner.id == a.id
    # Exactly one row exists for that user.
    assert len(store.list_for_user("u1")) == 1


# ── Crash window A: worker dies mid-run → reaper reconciles ────────────────

def test_crash_window_a_orphan_running_row_is_reaped(tmp_jobs_db):
    """Replica A claims + starts a job, then its worker is SIGKILLed —
    the row is stuck in `running`. The orphan reaper (run from any
    replica) reconciles it to `failed`."""
    rec = store.insert(JobRecord(kind="echo", user_id="u1"))
    # Started 30 min ago and never finished (worker crashed).
    store.update(rec.id, status=STATUS_RUNNING, started_at=_iso(minutes_ago=30))
    result = reap_orphans(dry_run=False)
    assert result.reaped >= 1
    got = store.get(rec.id)
    assert got.status == STATUS_FAILED
    assert got.error and got.error.get("message") == "orphan_reaped"


def test_crash_window_a_fresh_running_row_is_not_reaped(tmp_jobs_db):
    """A job that started seconds ago is NOT stale — the reaper must not
    kill a healthy in-flight job on another replica."""
    rec = store.insert(JobRecord(kind="echo", user_id="u1"))
    store.update(rec.id, status=STATUS_RUNNING, started_at=_iso(minutes_ago=0))
    result = reap_orphans(dry_run=False)
    assert store.get(rec.id).status == STATUS_RUNNING
    assert result.reaped == 0


# ── Crash window B: finished on A, stale worker on B ──────────────────────

def test_crash_window_b_stale_worker_cannot_resurrect_succeeded(tmp_jobs_db):
    """Replica A completes the job. A duplicate/stale worker on replica B
    (that never saw the completion) tries to mark it `running` again. The
    guard refuses — the succeeded result is preserved."""
    rec = store.insert(JobRecord(kind="echo", user_id="u1"))
    store.update(rec.id, status=STATUS_SUCCEEDED, result={"artifact": "web"},
                 finished_at=_iso())
    # Stale worker on B:
    store.update(rec.id, status=STATUS_RUNNING, progress=10)
    got = store.get(rec.id)
    assert got.status == STATUS_SUCCEEDED
    assert got.result == {"artifact": "web"}


def test_crash_window_b_stale_worker_cannot_resurrect_failed(tmp_jobs_db):
    rec = store.insert(JobRecord(kind="echo", user_id="u1"))
    store.update(rec.id, status=STATUS_FAILED, error={"code": "BOOM"},
                 finished_at=_iso())
    store.update(rec.id, status=STATUS_RUNNING)
    assert store.get(rec.id).status == STATUS_FAILED


# ── Crash window C: cancel wins the race ──────────────────────────────────

def test_crash_window_c_cancel_is_not_undone_by_stale_worker(tmp_jobs_db):
    """A user cancels on replica A; a stale worker on B tries to keep
    running. Cancellation is durable — the worker cannot un-cancel."""
    rec = store.insert(JobRecord(kind="echo", user_id="u1"))
    store.update(rec.id, status=STATUS_RUNNING, started_at=_iso())
    store.update(rec.id, status=STATUS_CANCELLED, cancelled_at=_iso(),
                 finished_at=_iso())
    # Stale worker on B keeps going:
    store.update(rec.id, status=STATUS_RUNNING, progress=90)
    assert store.get(rec.id).status == STATUS_CANCELLED


# ── Timeout terminal is not resurrectable ─────────────────────────────────

def test_timed_out_job_is_not_resurrectable(tmp_jobs_db):
    rec = store.insert(JobRecord(kind="echo", user_id="u1"))
    store.update(rec.id, status=STATUS_FAILED,
                 error={"code": "JOB_TIMEOUT"}, finished_at=_iso())
    store.update(rec.id, status=STATUS_RUNNING)
    got = store.get(rec.id)
    assert got.status == STATUS_FAILED
    assert got.error.get("code") == "JOB_TIMEOUT"


# ── Retry: terminal → queued IS allowed (not a resurrection) ──────────────

def test_retry_requeue_is_allowed_across_replicas(tmp_jobs_db):
    """The guard blocks terminal→running, but retry legitimately moves a
    terminal job to `queued` — that path must remain open so a failed job
    can be re-driven by any replica."""
    rec = store.insert(JobRecord(kind="echo", user_id="u1"))
    store.update(rec.id, status=STATUS_FAILED, error={"code": "X"},
                 finished_at=_iso())
    # Retry re-queues (allowed).
    store.update(rec.id, status=STATUS_QUEUED, error=None, finished_at=None)
    assert store.get(rec.id).status == STATUS_QUEUED
    # And a worker may now legitimately pick it up (queued→running allowed).
    store.update(rec.id, status=STATUS_RUNNING, started_at=_iso())
    assert store.get(rec.id).status == STATUS_RUNNING
