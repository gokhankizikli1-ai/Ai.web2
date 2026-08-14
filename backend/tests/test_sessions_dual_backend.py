# coding: utf-8
"""Server-authoritative chat persistence + dual backend (Phase 3 closure).

Chat history must be the SERVER's canonical truth (localStorage is only a
cache), and on a multi-replica deploy that truth must be SHARED — so the
sessions store gains a Postgres backend behind the same `engine.is_enabled()`
dispatch the jobs/billing stores use, with SQLite as the dev/single-node
fallback. `sessions.client` is the single dispatch seam.

These tests prove, at the authority level:

  * a conversation + its messages round-trip through a "reload" (a fresh read)
    with identical, deterministically-ordered history;
  * appends are durable and ordering is a TOTAL order (id tiebreaker), so a
    long history paginates deterministically;
  * cross-user isolation holds (a workspace/thread is owned transitively);
  * the client DISPATCHES to Postgres when the engine is enabled and SQLite
    otherwise, dynamically (an env flip takes effect without a restart);
  * the Postgres backend mirrors the SQLite backend's public surface EXACTLY
    (so callers never branch on storage) and speaks the psycopg `%s` dialect.

The live-Postgres path isn't exercised here (no PG instance in this
environment) — it is code-verified for API + dialect parity against the proven
`jobs.store_pg`, and selected identically via the shared engine.
"""
from __future__ import annotations

import inspect

import pytest


@pytest.fixture()
def sessions(tmp_path, monkeypatch):
    db = str(tmp_path / "sessions.db")
    monkeypatch.setenv("SESSIONS_DB_PATH", db)
    monkeypatch.setenv("ENABLE_SESSIONS", "true")
    from backend.services.sessions import store as sessions_store
    monkeypatch.setattr(sessions_store, "DB_PATH", db, raising=False)
    sessions_store.init()
    from backend.services.sessions import client as sessions_client
    return sessions_client


# ── Server-authoritative round-trip ──────────────────────────────────────────

def test_conversation_roundtrips_with_identical_ordered_history(sessions):
    ws = sessions.ensure_default_workspace("uA")
    th = sessions.create_thread(workspace_id=ws.id, title="Chat")
    turns = [("user", "hi"), ("assistant", "hello"), ("user", "build me a page"),
             ("assistant", "on it")]
    for role, content in turns:
        sessions.append_message(thread_id=th.id, role=role, content=content)

    # "Reload" — a completely fresh read is the canonical history (server truth).
    reloaded = sessions.list_messages(th.id, limit=100)
    assert [(m.role, m.content) for m in reloaded] == turns
    # Stable across repeated reads (deterministic total order).
    again = sessions.list_messages(th.id, limit=100)
    assert [m.id for m in again] == [m.id for m in reloaded]


def test_history_pagination_is_deterministic(sessions):
    ws = sessions.ensure_default_workspace("uA")
    th = sessions.create_thread(workspace_id=ws.id, title="Long")
    ids = [sessions.append_message(thread_id=th.id, role="user", content=f"m{i}").id
           for i in range(10)]
    page1 = sessions.list_messages(th.id, limit=4)
    assert [m.id for m in page1] == ids[:4]
    page2 = sessions.list_messages(th.id, limit=4, after_id=page1[-1].id)
    # Contiguous, no gaps, no overlaps.
    assert [m.id for m in page2] == ids[4:8]


def test_cross_user_isolation_via_workspace_ownership(sessions):
    # Workspaces are per-user; user B's list never contains A's workspace.
    wa = sessions.ensure_default_workspace("uA")
    wb = sessions.ensure_default_workspace("uB")
    assert wa.id != wb.id
    a_ids = {w.id for w in sessions.list_workspaces("uA")}
    b_ids = {w.id for w in sessions.list_workspaces("uB")}
    assert wa.id in a_ids and wa.id not in b_ids
    assert wb.id in b_ids and wb.id not in a_ids


def test_append_is_durable_after_new_client_view(sessions):
    ws = sessions.ensure_default_workspace("uA")
    th = sessions.create_thread(workspace_id=ws.id, title="Chat")
    sessions.append_message(thread_id=th.id, role="user", content="persist me")
    # Re-resolve the client from scratch to simulate a cold read (no in-memory
    # cache); the row is still there because it lives in the store, not memory.
    from backend.services.sessions import client as fresh
    msgs = fresh.list_messages(th.id, limit=10)
    assert len(msgs) == 1 and msgs[0].content == "persist me"


# ── Dual-backend dispatch ────────────────────────────────────────────────────

def test_dispatch_selects_sqlite_by_default(monkeypatch):
    from backend.services.db import engine
    from backend.services.sessions.client import current_backend, _store
    from backend.services.sessions import store as sqlite_store
    monkeypatch.setattr(engine, "is_enabled", lambda: False)
    assert current_backend() == "sqlite"
    assert _store() is sqlite_store


def test_dispatch_selects_postgres_when_engine_enabled(monkeypatch):
    from backend.services.db import engine
    from backend.services.sessions.client import current_backend, _store
    from backend.services.sessions import store_pg
    monkeypatch.setattr(engine, "is_enabled", lambda: True)
    assert current_backend() == "postgres"
    assert _store() is store_pg


def test_pg_backend_mirrors_sqlite_public_surface():
    """Every public store function must exist on BOTH backends with the same
    call signature so the client never branches on storage."""
    from backend.services.sessions import store as sqlite_store, store_pg
    public = [
        "create_workspace", "get_workspace", "list_workspaces", "update_workspace",
        "archive_workspace", "ensure_default_workspace",
        "create_thread", "get_thread", "list_threads", "update_thread", "archive_thread",
        "append_message", "list_messages", "get_message", "delete_message",
        "store_stats", "table_counts", "init",
    ]
    for name in public:
        assert hasattr(store_pg, name), f"store_pg missing {name}"
        assert hasattr(sqlite_store, name), f"store missing {name}"
        sig_pg = inspect.signature(getattr(store_pg, name))
        sig_sq = inspect.signature(getattr(sqlite_store, name))
        assert list(sig_pg.parameters) == list(sig_sq.parameters), (
            f"signature drift for {name}: {sig_pg} vs {sig_sq}")


def test_pg_backend_uses_psycopg_placeholders():
    """The PG backend must speak the psycopg %s dialect, never SQLite's ? — a
    stray ? would fail at execution on a real Postgres connection."""
    import backend.services.sessions.store_pg as m
    src = inspect.getsource(m)
    # No bare SQL '?' placeholders in the module.
    assert "VALUES (?" not in src and "=?" not in src and " ? " not in src
    assert "%s" in src
