# coding: utf-8
"""Completion Phase 3 — shared cross-replica step-dispatch claim.

The claim is the shared authority that prevents two replicas from
double-dispatching (and double-paying for) the same workflow step. These
tests exercise the SQLite backend (a shared file simulating a shared store),
plus the runner integration: two dispatches of the same step create exactly
one job, and a crash-before-create claim does not deadlock.
"""
from __future__ import annotations

import asyncio
import importlib
import threading
import time

import pytest


@pytest.fixture()
def claim_env(tmp_path, monkeypatch):
    monkeypatch.setenv("PROJECTS_DB_PATH", str(tmp_path / "projects.db"))
    # Force the SQLite backend (no Postgres in tests).
    monkeypatch.delenv("ENABLE_POSTGRES_BACKEND", raising=False)
    from backend.services.orchestrator import step_claim
    importlib.reload(step_claim)
    return step_claim


def test_backend_is_sqlite_without_postgres(claim_env):
    assert claim_env.backend() == "sqlite"


def test_fresh_claim_blocks_second(claim_env):
    sc = claim_env
    assert sc.try_claim("wf:1:step:a", owner="A") is True
    assert sc.try_claim("wf:1:step:a", owner="B") is False
    assert sc.is_claimed("wf:1:step:a") is True
    # A different key is independent.
    assert sc.try_claim("wf:1:step:b", owner="B") is True


def test_release_allows_reclaim(claim_env):
    sc = claim_env
    assert sc.try_claim("k", owner="A") is True
    sc.release("k")
    assert sc.is_claimed("k") is False
    assert sc.try_claim("k", owner="B") is True


def test_concurrent_claim_single_winner(claim_env):
    """20 threads race for the SAME key against the shared claims file.
    Exactly one must win."""
    sc = claim_env
    n = 20
    barrier = threading.Barrier(n)
    wins = []
    lock = threading.Lock()

    def worker(i):
        barrier.wait()
        if sc.try_claim("hot-key", owner=f"r{i}"):
            with lock:
                wins.append(i)

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(wins) == 1, wins


def test_stale_claim_is_reclaimable(claim_env, monkeypatch):
    """A claim older than the TTL is reclaimable — a crash-before-dispatch
    cannot deadlock a step forever."""
    sc = claim_env
    # Tiny TTL so the claim goes stale immediately.
    monkeypatch.setattr(sc, "_ttl_seconds", lambda: 30)
    # Insert a claim with an artificially old timestamp (> TTL ago).
    sc._sqlite_init()
    from backend.services.orchestrator import _sqlite
    with _sqlite.writer_tx(sc.DB_PATH) as c:
        c.execute(
            "INSERT OR REPLACE INTO workflow_step_claims (key, owner, workflow_id, claimed_at) "
            "VALUES (?,?,?,?)",
            ("stale", "dead-replica", "wf", time.time() - 10_000),
        )
    # A fresh claimer can reclaim the stale key.
    assert sc.try_claim("stale", owner="live-replica") is True


# ── Runner integration: two dispatches → exactly one job ─────────────────

def test_two_runner_dispatch_creates_single_job(tmp_jobs_db, tmp_path, monkeypatch):
    """Simulate two replicas dispatching the SAME step against a shared jobs
    store + shared claim store: exactly one job is created; the loser
    attaches to it."""
    monkeypatch.setenv("PROJECTS_DB_PATH", str(tmp_path / "projects.db"))
    monkeypatch.delenv("ENABLE_POSTGRES_BACKEND", raising=False)
    from backend.services.orchestrator import step_claim
    importlib.reload(step_claim)
    from backend.services.workflows import runner as wf_runner
    from backend.services.workflows.steps import Step, STEP_STATUS_DISPATCHED
    from backend.services.jobs import store as jobs_store

    def _fresh_step():
        return Step(id="s1", label="build", kind="job",
                    payload={"kind": "echo", "input": {"m": "hi"}})

    async def _run():
        step_a = _fresh_step()
        await wf_runner._dispatch_step("u1", "p1", "wfX", step_a)
        # Second "replica": same workflow+step id → claim held → attach.
        step_b = _fresh_step()
        await wf_runner._dispatch_step("u1", "p1", "wfX", step_b)
        return step_a, step_b

    a, b = asyncio.run(_run())
    assert a.status == STEP_STATUS_DISPATCHED
    assert a.dispatched_id is not None
    # The loser attached to the SAME job (no duplicate dispatch).
    assert b.dispatched_id == a.dispatched_id
    # Exactly one job carries the stable key.
    existing = jobs_store.get_by_idempotency_key(
        user_id="u1", kind="echo", idempotency_key="wf:wfX:step:s1")
    assert existing is not None and existing.id == a.dispatched_id


def test_crash_before_job_create_no_deadlock(tmp_jobs_db, tmp_path, monkeypatch):
    """Claim acquired but the owner crashed before creating the job. A
    fresh dispatch cannot see a job → stays pending; once the claim goes
    stale it is reclaimed and the job is created (no permanent deadlock)."""
    monkeypatch.setenv("PROJECTS_DB_PATH", str(tmp_path / "projects.db"))
    monkeypatch.delenv("ENABLE_POSTGRES_BACKEND", raising=False)
    from backend.services.orchestrator import step_claim
    importlib.reload(step_claim)
    from backend.services.workflows import runner as wf_runner
    from backend.services.workflows.steps import (
        Step, STEP_STATUS_PENDING, STEP_STATUS_DISPATCHED,
    )

    key = "wf:wfY:step:s1"
    # A "crashed" replica holds the claim but never created a job.
    assert step_claim.try_claim(key, owner="dead") is True

    step = Step(id="s1", kind="job", payload={"kind": "echo", "input": {}})

    async def _dispatch():
        await wf_runner._dispatch_step("u1", "p1", "wfY", step)

    asyncio.run(_dispatch())
    # No job visible, claim held → step remained pending (not failed, not hung).
    assert step.status == STEP_STATUS_PENDING
    assert step.dispatched_id is None

    # Claim goes stale → next dispatch reclaims + creates the job.
    monkeypatch.setattr(step_claim, "_ttl_seconds", lambda: 0)
    step2 = Step(id="s1", kind="job", payload={"kind": "echo", "input": {}})
    asyncio.run(wf_runner._dispatch_step("u1", "p1", "wfY", step2))
    assert step2.status == STEP_STATUS_DISPATCHED
    assert step2.dispatched_id is not None
