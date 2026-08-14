# coding: utf-8
"""Server-authoritative message idempotency (review fix — Phase 3 hardening).

The first cut used the server message COUNT as a sync watermark and minted a
fresh random id on every append — which is NOT idempotent: overlapping syncs
could double-append the same tail, and a >500-message history broke the
length-based watermark. The fix moves idempotency into the message authority:
every append carries a STABLE client id, UNIQUE per thread, so a retry /
concurrent / cross-tab / cross-replica re-send resolves to the ONE canonical
row. These tests prove it at the store level (SQLite here; Postgres shares the
same SQL contract — parity asserted in test E).

  A. same message posted twice        → one canonical row
  B. concurrent appends (same id)      → no duplicate (ON CONFLICT + unique idx)
  C. partial-sync retry (append tail)  → no duplicate of earlier turns
  D. >500-message conversation replay  → no duplication (id-keyed, not count)
  E. SQLite/Postgres SQL + API parity
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

import pytest


@pytest.fixture()
def store(tmp_path, monkeypatch):
    db = str(tmp_path / "sessions.db")
    monkeypatch.setenv("SESSIONS_DB_PATH", db)
    from backend.services.sessions import store as sessions_store
    monkeypatch.setattr(sessions_store, "DB_PATH", db, raising=False)
    sessions_store.init()
    return sessions_store


def _thread(store, user="uA"):
    ws = store.ensure_default_workspace(user)
    return store.create_thread(workspace_id=ws.id, title="Chat")


# ── A. exact-duplicate append ────────────────────────────────────────────────

def test_same_client_id_appended_twice_is_one_row(store):
    th = _thread(store)
    m1 = store.append_message(thread_id=th.id, role="user", content="hi",
                              client_message_id="c-1")
    m2 = store.append_message(thread_id=th.id, role="user", content="hi",
                              client_message_id="c-1")
    assert m1.id == m2.id                                  # same canonical row
    assert len(store.list_messages(th.id, limit=100)) == 1


def test_recognizes_message_by_prior_server_row_id(store):
    # A message the client received via hydration carries the SERVER row id as
    # its client id on a later re-send; that must be recognised, not re-inserted.
    th = _thread(store)
    original = store.append_message(thread_id=th.id, role="assistant",
                                    content="hello", client_message_id="c-9")
    again = store.append_message(thread_id=th.id, role="assistant",
                                 content="hello", client_message_id=original.id)
    assert again.id == original.id
    assert len(store.list_messages(th.id, limit=100)) == 1


# ── B. concurrency ───────────────────────────────────────────────────────────

def test_concurrent_appends_same_id_no_duplicate(store):
    th = _thread(store)

    def _append(_):
        return store.append_message(thread_id=th.id, role="user",
                                    content="race", client_message_id="c-race")

    with ThreadPoolExecutor(max_workers=8) as ex:
        results = list(ex.map(_append, range(8)))

    ids = {m.id for m in results}
    assert len(ids) == 1                                   # all resolved to one row
    assert len(store.list_messages(th.id, limit=100)) == 1


# ── C. partial-sync retry ────────────────────────────────────────────────────

def test_partial_sync_retry_appends_only_new(store):
    th = _thread(store)
    for cid, txt in [("c-1", "a"), ("c-2", "b")]:
        store.append_message(thread_id=th.id, role="user", content=txt, client_message_id=cid)
    # Retry re-sends the whole tail plus one new message.
    for cid, txt in [("c-1", "a"), ("c-2", "b"), ("c-3", "c")]:
        store.append_message(thread_id=th.id, role="user", content=txt, client_message_id=cid)
    msgs = store.list_messages(th.id, limit=100)
    assert [m.content for m in msgs] == ["a", "b", "c"]     # exactly three, in order


# ── D. >500-message conversation replay ──────────────────────────────────────

def test_long_conversation_replay_no_duplication(store):
    th = _thread(store)
    n = 600
    for i in range(n):
        store.append_message(thread_id=th.id, role="user", content=f"m{i}",
                             client_message_id=f"c-{i}")
    assert len(store.list_messages(th.id, limit=10_000)) == n
    # Re-send the ENTIRE history (a fresh device with no watermark) — a
    # count-based watermark would replay; an id-keyed store does not.
    for i in range(n):
        store.append_message(thread_id=th.id, role="user", content=f"m{i}",
                             client_message_id=f"c-{i}")
    assert len(store.list_messages(th.id, limit=10_000)) == n


# ── E. SQLite / Postgres parity ──────────────────────────────────────────────

def test_backend_parity_for_idempotent_append():
    import inspect
    from backend.services.sessions import store as sqlite_store, store_pg
    # Both backends accept the client idempotency key.
    for mod in (sqlite_store, store_pg):
        params = inspect.signature(mod.append_message).parameters
        assert "client_message_id" in params, f"{mod.__name__} missing client_message_id"
    # Postgres backend enforces the same per-thread uniqueness + ON CONFLICT.
    src = inspect.getsource(store_pg)
    assert "ux_sm_client" in src
    assert "ON CONFLICT (thread_id, client_message_id)" in src
    assert "DO NOTHING" in src
    assert "client_message_id" in src
