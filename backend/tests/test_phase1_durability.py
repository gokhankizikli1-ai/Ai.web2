# coding: utf-8
"""Phase 1 — durability + transaction-safety hardening for the orchestrator
trio (runs / tasks / deliverables).

These tests pin the concrete guarantees the Phase 1 hardening adds:

  * WAL journal mode + a busy_timeout on the shared connection.
  * Read-modify-write helpers (finish_run, mark_*, set_status/set_content)
    are lost-update safe under concurrency (BEGIN IMMEDIATE serialises the
    metadata merge + version bump).
  * State survives "reopening" the store (a fresh connection reads what a
    prior connection committed) — the restart/redeploy invariant.
  * Cross-user isolation on list_runs.
  * Duplicate-id inserts are a safe no-op.

Everything runs against a temp projects.db pointed at by PROJECTS_DB_PATH,
so it never touches a real deployment DB.
"""
from __future__ import annotations

import os
import threading

import pytest


@pytest.fixture()
def stores(tmp_path, monkeypatch):
    """Point every orchestrator-trio store at a fresh temp projects.db and
    return the reloaded modules."""
    db = str(tmp_path / "projects.db")
    monkeypatch.setenv("PROJECTS_DB_PATH", db)
    # The stores resolve DB_PATH at import time, so reload them under the
    # patched env to bind the temp file.
    import importlib
    from backend.services.orchestrator import (
        _sqlite, runs_store, tasks_store, deliverables_store,
    )
    importlib.reload(runs_store)
    importlib.reload(tasks_store)
    importlib.reload(deliverables_store)
    runs_store.init_runs_table()
    tasks_store.init_tasks_table()
    deliverables_store.init_deliverables_table()
    assert runs_store.DB_PATH == db
    return _sqlite, runs_store, tasks_store, deliverables_store


def test_wal_and_busy_timeout_enabled(stores):
    _sqlite, runs_store, *_ = stores
    with _sqlite.connection(runs_store.DB_PATH) as c:
        assert c.execute("PRAGMA journal_mode").fetchone()[0].lower() == "wal"
        assert int(c.execute("PRAGMA busy_timeout").fetchone()[0]) >= 15000


def test_create_and_reopen_survives(stores):
    """The restart invariant: what one connection commits, a later fresh
    connection reads back."""
    _sqlite, runs_store, tasks_store, deliverables_store = stores
    rid = runs_store.create_run(user_id="u1", agent_id="supervisor", project_id="p1")
    tid = tasks_store.create_task(
        run_id=rid, title="Research", assigned_agent="researcher", project_id="p1",
    )
    did = deliverables_store.create_deliverable(
        run_id=rid, agent_id="researcher", node_id="research", kind="markdown",
        project_id="p1",
    )
    runs_store.finish_run(rid, reply_chars=42)
    tasks_store.mark_completed(tid, result_summary="found it")
    deliverables_store.set_content(did, {"text": "hello"}, status="completed")

    # Simulate a restart: drop any module caches by re-reading through a
    # brand-new connection path (get_* opens a fresh connection each call).
    assert runs_store.get_run(rid)["status"] == "finished"
    assert runs_store.get_run(rid)["reply_chars"] == 42
    assert tasks_store.get_task(tid)["status"] == "completed"
    d = deliverables_store.get_deliverable(did)
    assert d["status"] == "completed"
    assert d["content"] == {"text": "hello"}
    assert d["version"] == 1


def test_cross_user_isolation(stores):
    _sqlite, runs_store, *_ = stores
    runs_store.create_run(user_id="alice", agent_id="supervisor", project_id="pA")
    runs_store.create_run(user_id="bob", agent_id="supervisor", project_id="pB")
    alice = runs_store.list_runs(user_id="alice")
    bob = runs_store.list_runs(user_id="bob")
    assert len(alice) == 1 and alice[0]["user_id"] == "alice"
    assert len(bob) == 1 and bob[0]["user_id"] == "bob"


def test_duplicate_run_id_is_noop(stores):
    _sqlite, runs_store, *_ = stores
    rid = runs_store.create_run(
        user_id="u1", agent_id="supervisor", run_id="fixed-id",
    )
    assert rid == "fixed-id"
    # Re-inserting the same id must not raise and must not create a 2nd row
    # or overwrite the first.
    again = runs_store.create_run(
        user_id="someone-else", agent_id="other", run_id="fixed-id",
    )
    assert again == "fixed-id"
    rows = runs_store.list_runs(limit=500)
    assert sum(1 for r in rows if r["id"] == "fixed-id") == 1
    assert runs_store.get_run("fixed-id")["user_id"] == "u1"


def test_concurrent_metadata_merges_no_lost_update(stores):
    """20 threads each merge a distinct metadata key into the SAME run.
    Under the old deferred-isolation read-modify-write, interleaving would
    clobber keys. With BEGIN IMMEDIATE every key must survive."""
    _sqlite, runs_store, *_ = stores
    rid = runs_store.create_run(user_id="u1", agent_id="supervisor")

    n = 20
    barrier = threading.Barrier(n)
    errors: list = []

    def worker(i: int) -> None:
        try:
            barrier.wait()
            runs_store.finish_run(rid, metadata={f"k{i}": i})
        except Exception as exc:  # pragma: no cover
            errors.append(exc)

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert not errors, errors
    meta = runs_store.get_run(rid)["metadata"]
    for i in range(n):
        assert meta.get(f"k{i}") == i, f"lost update: k{i} missing from {meta}"


def test_concurrent_version_bumps_are_monotonic(stores):
    """set_content bumps version. Concurrent bumps under BEGIN IMMEDIATE
    must land at exactly N (no two writers reading the same base version)."""
    _sqlite, runs_store, tasks_store, deliverables_store = stores
    rid = runs_store.create_run(user_id="u1", agent_id="supervisor")
    did = deliverables_store.create_deliverable(
        run_id=rid, agent_id="a", node_id="n", kind="markdown",
    )

    n = 15
    barrier = threading.Barrier(n)

    def worker(i: int) -> None:
        barrier.wait()
        deliverables_store.set_content(did, {"i": i}, bump_version=True)

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    # Started at version 0; N successful bumps ⇒ exactly N.
    assert deliverables_store.get_deliverable(did)["version"] == n
