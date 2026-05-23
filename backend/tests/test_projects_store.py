# coding: utf-8
"""Phase 2 — projects.store unit tests.

Uses a per-test temporary SQLite file so tests are isolated and the
repo's projects.db is never touched. Pure-Python; no FastAPI/HTTP
boilerplate — those are tested via the route layer.
"""
import os
import tempfile
import importlib
import pytest


@pytest.fixture
def store():
    """Fresh projects.store wired to a temp DB for each test."""
    fd, path = tempfile.mkstemp(suffix="-projects.db")
    os.close(fd)
    os.environ["PROJECTS_DB_PATH"] = path
    # Re-import the module so DB_PATH picks up the new env var.
    from backend.services.projects import store as _store
    importlib.reload(_store)
    _store.init()
    try:
        yield _store
    finally:
        try:
            os.unlink(path)
        except FileNotFoundError:
            pass


def test_create_and_list_project(store):
    p = store.create_project("u-1", name="Proj A", description="hello")
    assert p.name == "Proj A"
    assert p.owner_user_id == "u-1"
    assert p.status == "active"
    assert p.archived_at is None

    lst = store.list_projects("u-1")
    assert len(lst) == 1 and lst[0].id == p.id


def test_project_id_can_be_preserved_for_migration(store):
    """The localStorage → backend backfill needs to keep existing ids."""
    pid = "pid-from-localstorage-42"
    p = store.create_project("u-1", name="Imported", project_id=pid)
    assert p.id == pid
    assert store.get_project(pid).name == "Imported"


def test_create_with_existing_id_is_idempotent(store):
    pid = "stable-pid"
    p1 = store.create_project("u-1", name="First", project_id=pid)
    p2 = store.create_project("u-1", name="Second", project_id=pid)
    # Idempotent — same row, no exception
    assert p1.id == p2.id == pid


def test_update_project_status_archive_then_restore(store):
    p = store.create_project("u-1", name="P", description="d")
    archived = store.update_project(p.id, status="archived")
    assert archived.status == "archived" and archived.archived_at

    # Archived projects hidden from default list, visible with include_archived
    assert store.list_projects("u-1") == []
    assert len(store.list_projects("u-1", include_archived=True)) == 1

    restored = store.update_project(p.id, status="active")
    assert restored.status == "active" and restored.archived_at is None


def test_unknown_status_falls_back_to_existing(store):
    p = store.create_project("u-1", name="P")
    same = store.update_project(p.id, status="garbage")
    assert same.status == "active"  # invalid → keep existing


def test_delete_project_cascades(store):
    p = store.create_project("u-1", name="P")
    store.add_memory(p.id, content="memory note")
    store.create_agent(p.id, name="Agent")
    store.attach_thread(p.id, "thread-abc")
    store.register_file(p.id, path="readme.md")

    assert store.delete_project(p.id) is True
    assert store.get_project(p.id) is None
    assert store.list_memory(p.id) == []
    assert store.list_agents(p.id) == []
    assert store.list_project_threads(p.id) == []
    assert store.list_files(p.id) == []


def test_memory_ordering_and_limit(store):
    p = store.create_project("u-1", name="P")
    for i in range(5):
        store.add_memory(p.id, content=f"note-{i}")
    # Newest first by default
    mem = store.list_memory(p.id)
    assert [m.content for m in mem] == ["note-4", "note-3", "note-2", "note-1", "note-0"]
    # Limit + oldest first
    older = store.list_memory(p.id, limit=2, newest_first=False)
    assert [m.content for m in older] == ["note-0", "note-1"]


def test_memory_kind_normalization(store):
    p = store.create_project("u-1", name="P")
    m = store.add_memory(p.id, content="x", kind="weird_kind")
    # Unknown kind → "note"
    assert m.kind == "note"
    m2 = store.add_memory(p.id, content="y", kind="decision")
    assert m2.kind == "decision"


def test_empty_content_memory_returns_none(store):
    p = store.create_project("u-1", name="P")
    assert store.add_memory(p.id, content="   ") is None


def test_memory_against_unknown_project_returns_none(store):
    assert store.add_memory("ghost-id", content="x") is None


def test_thread_binding_and_reverse_lookup(store):
    p = store.create_project("u-1", name="P")
    assert store.attach_thread(p.id, "thread-1") is True
    assert store.get_project_of_thread("thread-1") == p.id
    # Idempotent — second attach is a no-op (INSERT OR IGNORE)
    assert store.attach_thread(p.id, "thread-1") is True
    assert len(store.list_project_threads(p.id)) == 1
    assert store.detach_thread(p.id, "thread-1") is True
    assert store.get_project_of_thread("thread-1") is None


def test_agent_crud(store):
    p = store.create_project("u-1", name="P")
    a = store.create_agent(p.id, name="Backend Eng", role="backend",
                            system_prompt="You design APIs.")
    assert a.name == "Backend Eng"
    a2 = store.update_agent(a.id, system_prompt="You design REST APIs.")
    assert a2.system_prompt == "You design REST APIs."
    assert store.delete_agent(a.id) is True
    assert store.list_agents(p.id) == []


def test_files_placeholder(store):
    p = store.create_project("u-1", name="P")
    f = store.register_file(p.id, path="design.fig", mime="application/octet-stream",
                              size_bytes=1234, sha256="deadbeef", storage_url="")
    assert f and f.path == "design.fig"
    assert len(store.list_files(p.id)) == 1


def test_context_block_skipped_when_flag_off(store, monkeypatch):
    p = store.create_project("u-1", name="My Proj", description="A test project.")
    store.add_memory(p.id, content="Important fact", kind="fact")
    # Flag OFF — context block must be None to avoid breaking chat when
    # the projects table exists but the feature is disabled.
    monkeypatch.delenv("ENABLE_PROJECTS", raising=False)
    from backend.services.projects import build_project_context_block
    assert build_project_context_block(p.id) is None


def test_context_block_returns_text_when_flag_on(store, monkeypatch):
    monkeypatch.setenv("ENABLE_PROJECTS", "true")
    p = store.create_project("u-1", name="My Proj", description="A test project.")
    store.add_memory(p.id, content="Stack: Next.js + Postgres", kind="fact")
    store.add_memory(p.id, content="Targeting EU mid-market", kind="note")
    from backend.services.projects import build_project_context_block
    blk = build_project_context_block(p.id)
    assert blk is not None
    assert "My Proj" in blk
    assert "Stack: Next.js + Postgres" in blk
    assert "Targeting EU mid-market" in blk
    # Newest first
    targeting_idx = blk.find("Targeting EU mid-market")
    stack_idx = blk.find("Stack: Next.js")
    assert targeting_idx < stack_idx


def test_context_block_none_for_empty_project(store, monkeypatch):
    monkeypatch.setenv("ENABLE_PROJECTS", "true")
    p = store.create_project("u-1", name="Empty", description="")
    from backend.services.projects import build_project_context_block
    assert build_project_context_block(p.id) is None


def test_context_var_isolated_per_call(store, monkeypatch):
    """Setting + resetting must not leak across calls."""
    monkeypatch.setenv("ENABLE_PROJECTS", "true")
    from backend.services.projects.context import (
        set_current_project_context, reset_current_project_context,
        get_current_project_context,
    )
    assert get_current_project_context() == ""
    tok = set_current_project_context("hello")
    assert get_current_project_context() == "hello"
    reset_current_project_context(tok)
    assert get_current_project_context() == ""
