# coding: utf-8
"""
Phase 6 — Memory Plane store + manager tests.

Coverage:
  * schema bootstrap (init / table_counts on empty store)
  * insert / get / list_for_user
  * search_text — kind / project / agent / importance / expired filters
  * soft_delete with + without user_id ownership guard
  * expire_due — TTL eviction sweep
  * wipe_user — GDPR hard-delete
  * dedup fold (manager.create) — same content within window ⇒ same row + bump
  * secret-redaction guard (manager.create rejects credentials)
"""
from __future__ import annotations

import time

import pytest

from backend.services.memory_plane import (
    client as plane_client,
    MemoryRecord, MemoryQuery,
    IMPORTANCE_HIGH, IMPORTANCE_LOW,
)
from backend.services.memory_plane import store as mp_store
from backend.services.memory_plane.manager import manager as mp_manager


# ── Schema bootstrap ─────────────────────────────────────────────────────────

def test_init_is_idempotent(tmp_memory_plane_db):
    mp_store.init()
    mp_store.init()
    counts = mp_store.table_counts()
    assert counts == {"total": 0, "active": 0, "deleted": 0}


# ── Insert + read ────────────────────────────────────────────────────────────

def test_insert_returns_populated_record(tmp_memory_plane_db):
    rec = mp_store.insert(MemoryRecord(
        user_id="u1", content="hello world", kind="fact",
    ))
    assert rec.id is not None
    assert rec.user_id == "u1"
    assert rec.content == "hello world"
    assert rec.kind == "fact"
    assert rec.created_at is not None
    assert rec.updated_at == rec.created_at


def test_insert_rejects_blank_user(tmp_memory_plane_db):
    with pytest.raises(ValueError):
        mp_store.insert(MemoryRecord(user_id="", content="x"))


def test_insert_rejects_blank_content(tmp_memory_plane_db):
    with pytest.raises(ValueError):
        mp_store.insert(MemoryRecord(user_id="u1", content=""))


def test_get_returns_none_for_missing(tmp_memory_plane_db):
    assert mp_store.get("nope") is None
    assert mp_store.get("") is None


def test_get_returns_record(tmp_memory_plane_db):
    rec = mp_store.insert(MemoryRecord(user_id="u1", content="x"))
    got = mp_store.get(rec.id or "")
    assert got is not None
    assert got.id == rec.id


# ── list_for_user ────────────────────────────────────────────────────────────

def test_list_for_user_orders_by_importance_then_recency(tmp_memory_plane_db):
    mp_store.insert(MemoryRecord(user_id="u1", content="old low",   importance=0.2))
    time.sleep(0.01)
    mp_store.insert(MemoryRecord(user_id="u1", content="fresh low", importance=0.2))
    time.sleep(0.01)
    mp_store.insert(MemoryRecord(user_id="u1", content="high",      importance=0.9))
    items = mp_store.list_for_user("u1")
    assert [r.content for r in items] == ["high", "fresh low", "old low"]


def test_list_for_user_filters_by_project(tmp_memory_plane_db):
    mp_store.insert(MemoryRecord(user_id="u1", content="a", project_id="p1"))
    mp_store.insert(MemoryRecord(user_id="u1", content="b", project_id="p2"))
    mp_store.insert(MemoryRecord(user_id="u1", content="c"))   # no project
    only_p1 = mp_store.list_for_user("u1", project_id="p1")
    assert [r.content for r in only_p1] == ["a"]


def test_list_for_user_filters_by_kind(tmp_memory_plane_db):
    mp_store.insert(MemoryRecord(user_id="u1", content="fact",       kind="fact"))
    mp_store.insert(MemoryRecord(user_id="u1", content="preference", kind="preference"))
    prefs = mp_store.list_for_user("u1", kind="preference")
    assert [r.kind for r in prefs] == ["preference"]


def test_list_for_user_excludes_expired_by_default(tmp_memory_plane_db):
    # ttl=1 → expires immediately on the next call
    mp_store.insert(MemoryRecord(user_id="u1", content="ephemeral", ttl_seconds=1))
    mp_store.insert(MemoryRecord(user_id="u1", content="forever"))
    time.sleep(1.1)
    items = mp_store.list_for_user("u1", include_expired=False)
    assert [r.content for r in items] == ["forever"]


def test_users_are_isolated(tmp_memory_plane_db):
    mp_store.insert(MemoryRecord(user_id="alice", content="A"))
    mp_store.insert(MemoryRecord(user_id="bob",   content="B"))
    assert [r.content for r in mp_store.list_for_user("alice")] == ["A"]
    assert [r.content for r in mp_store.list_for_user("bob")]   == ["B"]


# ── search_text ──────────────────────────────────────────────────────────────

def test_search_text_matches_substring(tmp_memory_plane_db):
    mp_store.insert(MemoryRecord(user_id="u1", content="building KorvixAI"))
    mp_store.insert(MemoryRecord(user_id="u1", content="something else"))
    out = mp_store.search_text(MemoryQuery(user_id="u1", query="korvix"))
    assert len(out) == 1
    assert "Korvix" in out[0].content


def test_search_text_respects_importance_floor(tmp_memory_plane_db):
    mp_store.insert(MemoryRecord(user_id="u1", content="trivial", importance=0.1))
    mp_store.insert(MemoryRecord(user_id="u1", content="major",   importance=IMPORTANCE_HIGH))
    out = mp_store.search_text(MemoryQuery(user_id="u1", importance_floor=0.5))
    assert [r.content for r in out] == ["major"]


# ── soft / hard / TTL delete ─────────────────────────────────────────────────

def test_soft_delete_hides_row_from_reads(tmp_memory_plane_db):
    rec = mp_store.insert(MemoryRecord(user_id="u1", content="bye"))
    assert mp_store.soft_delete(rec.id or "") is True
    assert mp_store.get(rec.id or "") is None
    assert mp_store.list_for_user("u1") == []
    counts = mp_store.table_counts()
    assert counts["total"] == 1 and counts["active"] == 0 and counts["deleted"] == 1


def test_soft_delete_with_user_id_ownership_guard(tmp_memory_plane_db):
    rec = mp_store.insert(MemoryRecord(user_id="alice", content="mine"))
    # bob tries to delete alice's row → false; row still active
    assert mp_store.soft_delete(rec.id or "", user_id="bob") is False
    assert mp_store.get(rec.id or "") is not None


def test_expire_due_evicts_expired_rows(tmp_memory_plane_db):
    rec = mp_store.insert(MemoryRecord(user_id="u1", content="x", ttl_seconds=1))
    mp_store.insert(MemoryRecord(user_id="u1", content="y"))     # no ttl
    time.sleep(1.1)
    evicted = mp_store.expire_due()
    assert evicted == 1
    assert mp_store.get(rec.id or "") is None


def test_wipe_user_removes_all_rows(tmp_memory_plane_db):
    mp_store.insert(MemoryRecord(user_id="alice", content="1"))
    mp_store.insert(MemoryRecord(user_id="alice", content="2"))
    mp_store.insert(MemoryRecord(user_id="bob",   content="3"))
    n = mp_store.wipe_user("alice")
    assert n == 2
    assert mp_store.list_for_user("alice") == []
    assert len(mp_store.list_for_user("bob")) == 1


# ── update helpers ───────────────────────────────────────────────────────────

def test_update_importance_clamps(tmp_memory_plane_db):
    rec = mp_store.insert(MemoryRecord(user_id="u1", content="x", importance=0.5))
    assert mp_store.update_importance(rec.id or "", 1.5) is True
    got = mp_store.get(rec.id or "")
    assert got is not None and got.importance == 1.0


def test_update_embedding_roundtrip(tmp_memory_plane_db):
    rec = mp_store.insert(MemoryRecord(user_id="u1", content="x"))
    emb = [0.1, 0.2, 0.3, 0.4]
    assert mp_store.update_embedding(rec.id or "", emb) is True
    got = mp_store.get(rec.id or "")
    assert got is not None and got.embedding == emb


# ── Manager: dedup fold ──────────────────────────────────────────────────────

def test_manager_dedup_folds_identical_content(tmp_memory_plane_db):
    a = mp_manager.create(
        user_id="u1", content="I like Vercel for FE deploys",
        kind="preference", importance=0.5,
    )
    b = mp_manager.create(
        user_id="u1", content="I like Vercel for FE deploys",
        kind="preference", importance=0.5,
    )
    assert a is not None and b is not None
    assert a.id == b.id
    # Dedup hits should bump importance (capped at 1.0).
    assert b.importance is not None and b.importance > (a.importance or 0.0)
    # Only one row in the store.
    assert len(mp_store.list_for_user("u1")) == 1


def test_manager_dedup_does_not_fold_different_kinds(tmp_memory_plane_db):
    a = mp_manager.create(user_id="u1", content="same text", kind="fact")
    b = mp_manager.create(user_id="u1", content="same text", kind="preference")
    assert a is not None and b is not None and a.id != b.id


# ── Manager: secret redaction ────────────────────────────────────────────────

def test_manager_rejects_password_assignment(tmp_memory_plane_db):
    out = mp_manager.create(
        user_id="u1",
        content="my password=hunter2 for the admin panel",
    )
    assert out is None
    assert mp_store.list_for_user("u1") == []


def test_manager_rejects_openai_key(tmp_memory_plane_db):
    out = mp_manager.create(
        user_id="u1",
        content="key is sk-aBcDeFgHiJkLmNoPqRsTuVwXyZ12345678901234",
    )
    assert out is None


def test_manager_rejects_jwt_shaped_token(tmp_memory_plane_db):
    out = mp_manager.create(
        user_id="u1",
        content="paste your token eyJabc123def.eyJzdWIiOiJhYWEifQ.abcdef987654",
    )
    assert out is None


# ── Public client gate ───────────────────────────────────────────────────────

def test_client_disabled_is_noop(monkeypatch, tmp_memory_plane_db):
    """When the flag is off, every mutating method short-circuits."""
    monkeypatch.setenv("ENABLE_MEMORY_PLANE", "false")
    out = plane_client.create(user_id="u1", content="x")
    assert out is None
    assert plane_client.list_user("u1") == []
    assert plane_client.search("u1", query="x") == []
    assert plane_client.delete("anything", user_id="u1") is False


def test_client_enabled_endtoend(tmp_memory_plane_db):
    """Flag on (set by the fixture). The client should be a thin pass-through."""
    rec = plane_client.create(user_id="u1", content="note via client", kind="fact")
    assert rec is not None and rec.id is not None
    fetched = plane_client.get(rec.id, user_id="u1")
    assert fetched is not None and fetched.content == "note via client"
    assert plane_client.delete(rec.id, user_id="u1") is True
    assert plane_client.get(rec.id, user_id="u1") is None


def test_client_get_other_user_returns_none(tmp_memory_plane_db):
    """Ownership guard: get(record_id, user_id=...) hides rows that
    belong to another user."""
    rec = plane_client.create(user_id="alice", content="secret-ish")
    assert rec is not None
    assert plane_client.get(rec.id or "", user_id="bob") is None
