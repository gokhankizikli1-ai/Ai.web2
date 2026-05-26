# coding: utf-8
"""
Phase 7 — Jobs store tests.

Covers:
  * Schema bootstrap (init / table_counts)
  * insert / get / list_for_user / list_all
  * idempotency lookup
  * update — column whitelist + JSON columns
  * delete + wipe_user (GDPR)
"""
from __future__ import annotations

import pytest

from backend.services.jobs import store as jobs_store
from backend.services.jobs.types import (
    JobRecord, STATUS_QUEUED, STATUS_RUNNING, STATUS_SUCCEEDED,
    STATUS_FAILED, STATUS_CANCELLED,
)


# ── Schema bootstrap ─────────────────────────────────────────────────────────

def test_init_is_idempotent(tmp_jobs_db):
    jobs_store.init()
    jobs_store.init()
    counts = jobs_store.table_counts()
    assert counts["total"] == 0
    assert counts["queued"] == 0


# ── Insert + read ────────────────────────────────────────────────────────────

def test_insert_returns_populated_record(tmp_jobs_db):
    rec = jobs_store.insert(JobRecord(
        kind="echo", user_id="u1",
        payload={"message": "hi"},
    ))
    assert rec.id is not None
    assert rec.kind == "echo"
    assert rec.user_id == "u1"
    assert rec.status == "queued"
    assert rec.payload == {"message": "hi"}
    assert rec.created_at is not None


def test_insert_requires_user_id(tmp_jobs_db):
    with pytest.raises(ValueError):
        jobs_store.insert(JobRecord(kind="echo", user_id=""))


def test_insert_requires_kind(tmp_jobs_db):
    with pytest.raises(ValueError):
        jobs_store.insert(JobRecord(kind="", user_id="u1"))


def test_get_returns_record(tmp_jobs_db):
    rec = jobs_store.insert(JobRecord(kind="echo", user_id="u1"))
    got = jobs_store.get(rec.id or "")
    assert got is not None
    assert got.id == rec.id


def test_get_unknown_returns_none(tmp_jobs_db):
    assert jobs_store.get("nope") is None
    assert jobs_store.get("") is None


# ── list_for_user ────────────────────────────────────────────────────────────

def test_list_for_user_orders_newest_first(tmp_jobs_db):
    a = jobs_store.insert(JobRecord(kind="echo", user_id="u1"))
    b = jobs_store.insert(JobRecord(kind="echo", user_id="u1"))
    items = jobs_store.list_for_user("u1")
    assert [r.id for r in items] == [b.id, a.id]


def test_list_for_user_filters_kind(tmp_jobs_db):
    jobs_store.insert(JobRecord(kind="echo",            user_id="u1"))
    jobs_store.insert(JobRecord(kind="sleep_progress",  user_id="u1"))
    out = jobs_store.list_for_user("u1", kind="sleep_progress")
    assert [r.kind for r in out] == ["sleep_progress"]


def test_list_for_user_filters_status(tmp_jobs_db):
    a = jobs_store.insert(JobRecord(kind="echo", user_id="u1"))
    jobs_store.update(a.id or "", status=STATUS_SUCCEEDED)
    jobs_store.insert(JobRecord(kind="echo", user_id="u1"))
    out = jobs_store.list_for_user("u1", status=STATUS_SUCCEEDED)
    assert len(out) == 1


def test_list_for_user_filters_project(tmp_jobs_db):
    jobs_store.insert(JobRecord(kind="echo", user_id="u1", project_id="p1"))
    jobs_store.insert(JobRecord(kind="echo", user_id="u1", project_id="p2"))
    out = jobs_store.list_for_user("u1", project_id="p1")
    assert [r.project_id for r in out] == ["p1"]


def test_users_are_isolated(tmp_jobs_db):
    jobs_store.insert(JobRecord(kind="echo", user_id="alice"))
    jobs_store.insert(JobRecord(kind="echo", user_id="bob"))
    assert len(jobs_store.list_for_user("alice")) == 1
    assert len(jobs_store.list_for_user("bob")) == 1


# ── Idempotency ──────────────────────────────────────────────────────────────

def test_idempotency_key_unique_per_user_kind(tmp_jobs_db):
    a = jobs_store.insert(JobRecord(
        kind="echo", user_id="u1", idempotency_key="k1",
    ))
    # Same (user, kind, key) → IntegrityError
    import sqlite3
    with pytest.raises(sqlite3.IntegrityError):
        jobs_store.insert(JobRecord(
            kind="echo", user_id="u1", idempotency_key="k1",
        ))
    # Different user → allowed
    jobs_store.insert(JobRecord(
        kind="echo", user_id="u2", idempotency_key="k1",
    ))
    # Different kind → allowed
    jobs_store.insert(JobRecord(
        kind="sleep_progress", user_id="u1", idempotency_key="k1",
    ))
    # NULL key → no constraint
    jobs_store.insert(JobRecord(kind="echo", user_id="u1", idempotency_key=None))
    jobs_store.insert(JobRecord(kind="echo", user_id="u1", idempotency_key=None))


def test_get_by_idempotency_key(tmp_jobs_db):
    a = jobs_store.insert(JobRecord(
        kind="echo", user_id="u1", idempotency_key="abc",
    ))
    got = jobs_store.get_by_idempotency_key(
        user_id="u1", kind="echo", idempotency_key="abc",
    )
    assert got is not None and got.id == a.id
    # Mismatched key → None
    assert jobs_store.get_by_idempotency_key(
        user_id="u1", kind="echo", idempotency_key="other",
    ) is None


# ── Update ───────────────────────────────────────────────────────────────────

def test_update_status_and_progress(tmp_jobs_db):
    rec = jobs_store.insert(JobRecord(kind="echo", user_id="u1"))
    out = jobs_store.update(rec.id or "", status=STATUS_RUNNING, progress=42,
                            progress_label="halfway")
    assert out is not None
    assert out.status == STATUS_RUNNING
    assert out.progress == 42
    assert out.progress_label == "halfway"


def test_update_clamps_progress(tmp_jobs_db):
    rec = jobs_store.insert(JobRecord(kind="echo", user_id="u1"))
    jobs_store.update(rec.id or "", progress=200)
    got = jobs_store.get(rec.id or "")
    assert got.progress == 100
    jobs_store.update(rec.id or "", progress=-5)
    assert jobs_store.get(rec.id or "").progress == 0


def test_update_persists_result_json(tmp_jobs_db):
    rec = jobs_store.insert(JobRecord(kind="echo", user_id="u1"))
    jobs_store.update(rec.id or "", result={"x": 1, "y": "z"})
    got = jobs_store.get(rec.id or "")
    assert got.result == {"x": 1, "y": "z"}


def test_update_persists_error_json(tmp_jobs_db):
    rec = jobs_store.insert(JobRecord(kind="echo", user_id="u1"))
    jobs_store.update(rec.id or "",
                      status=STATUS_FAILED,
                      error={"code": "BOOM", "message": "exploded"})
    got = jobs_store.get(rec.id or "")
    assert got.error == {"code": "BOOM", "message": "exploded"}


def test_update_ignores_unknown_columns(tmp_jobs_db):
    """Defensive — caller passes a bad column name; the store should
    drop it silently rather than running unparseable SQL."""
    rec = jobs_store.insert(JobRecord(kind="echo", user_id="u1"))
    out = jobs_store.update(rec.id or "", nonexistent_column="abc",
                            status=STATUS_RUNNING)
    # status still gets applied, the bogus key is dropped.
    assert out is not None
    assert out.status == STATUS_RUNNING


# ── Delete / wipe ────────────────────────────────────────────────────────────

def test_delete_removes_row(tmp_jobs_db):
    rec = jobs_store.insert(JobRecord(kind="echo", user_id="u1"))
    assert jobs_store.delete(rec.id or "") is True
    assert jobs_store.get(rec.id or "") is None


def test_wipe_user_removes_all_user_rows(tmp_jobs_db):
    jobs_store.insert(JobRecord(kind="echo", user_id="alice"))
    jobs_store.insert(JobRecord(kind="echo", user_id="alice"))
    jobs_store.insert(JobRecord(kind="echo", user_id="bob"))
    n = jobs_store.wipe_user("alice")
    assert n == 2
    assert jobs_store.list_for_user("alice") == []
    assert len(jobs_store.list_for_user("bob")) == 1


# ── Cross-user list ──────────────────────────────────────────────────────────

def test_list_all_returns_everything(tmp_jobs_db):
    jobs_store.insert(JobRecord(kind="echo", user_id="u1"))
    jobs_store.insert(JobRecord(kind="echo", user_id="u2"))
    jobs_store.insert(JobRecord(kind="sleep_progress", user_id="u3"))
    out = jobs_store.list_all()
    assert len(out) == 3


def test_list_all_filters_status(tmp_jobs_db):
    a = jobs_store.insert(JobRecord(kind="echo", user_id="u1"))
    jobs_store.update(a.id or "", status=STATUS_SUCCEEDED)
    jobs_store.insert(JobRecord(kind="echo", user_id="u2"))
    out = jobs_store.list_all(status=STATUS_SUCCEEDED)
    assert len(out) == 1


# ── Health ───────────────────────────────────────────────────────────────────

def test_table_counts_groups_by_status(tmp_jobs_db):
    jobs_store.insert(JobRecord(kind="echo", user_id="u1"))
    a = jobs_store.insert(JobRecord(kind="echo", user_id="u1"))
    jobs_store.update(a.id or "", status=STATUS_RUNNING)
    b = jobs_store.insert(JobRecord(kind="echo", user_id="u1"))
    jobs_store.update(b.id or "", status=STATUS_SUCCEEDED)
    counts = jobs_store.table_counts()
    assert counts["total"]     == 3
    assert counts["queued"]    == 1
    assert counts["running"]   == 1
    assert counts["succeeded"] == 1
