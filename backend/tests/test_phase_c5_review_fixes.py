# coding: utf-8
"""Merge-gate review fixes.

Defect 1 — a NodeBuildExecutor `handoff` was recorded as build_execution
`failed`, contradicting the deliverable (`completed`+build_status=handoff) and
flipping to a hard failure on restart-reconcile. Now `handoff` is a first-class
terminal state, consistent across runs.

Defect 2 — observability surfaced pending_approvals (and next_action=approve)
even for cancelled/skipped deliverables, so a cancelled run falsely looked like
it was awaiting approval. Now pending approvals are gated on open deliverable +
non-terminal run, and a stable failure_code is emitted.
"""
from __future__ import annotations

import importlib
import os
import textwrap
from types import SimpleNamespace

import pytest


def _node_available() -> bool:
    from shutil import which
    return which("node") is not None


@pytest.fixture()
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("PROJECTS_DB_PATH", str(tmp_path / "projects.db"))
    from backend.services.orchestrator import (
        build_execution_store, build_capability, build_executor,
        deliverables_store, tasks_store, service, runs_store, state_model,
    )
    for m in (build_execution_store, deliverables_store, tasks_store,
              runs_store, build_capability, build_executor, service, state_model):
        importlib.reload(m)
    build_execution_store.init_build_executions_table()
    deliverables_store.init_deliverables_table()
    tasks_store.init_tasks_table()
    runs_store.init_runs_table()
    yield SimpleNamespace(
        bx=build_execution_store, bc=build_capability, be=build_executor,
        ds=deliverables_store, ts=tasks_store, svc=service, rs=runs_store,
        sm=state_model, tmp=tmp_path)
    build_capability.unregister_build_executor("web")
    build_capability.unregister_build_executor("app")


# ── Defect 1 — handoff consistency ───────────────────────────────────────

def test_state_model_handoff_is_terminal(env):
    sm = env.sm
    assert sm.BUILD_HANDOFF in sm.BUILD_TERMINAL
    assert sm.is_legal_transition(sm.BUILD_TRANSITIONS, "running", "handoff")
    assert not sm.is_legal_transition(sm.BUILD_TRANSITIONS, "handoff", "running")


@pytest.mark.skipif(not _node_available(), reason="node not available")
def test_handoff_records_handoff_not_failed(env):
    """A worker that returns handoff records build_execution=handoff (not
    failed), and reconcile keeps it a handoff — never flips to failure."""
    worker = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
        "build-worker", "korvix-build-worker.mjs")
    ex = env.be.NodeBuildExecutor(["node", worker], timeout_s=30)
    inp = env.bc.BuildExecutorInput(
        build_type="web", user_id="u1", project_id="p1", run_id="r1",
        task_id="t1", deliverable_id="d1", node_id="web", user_goal="site")

    r1 = ex(inp)
    assert r1.status == "handoff"
    row = env.bx.get(env.bx.stable_id("web", "r1", "t1"))
    assert row["status"] == "handoff"          # NOT "failed"

    # Restart/reconcile: same ids → still handoff, never a spurious failure.
    r2 = ex(inp)
    assert r2.status == "handoff"
    assert env.bx.get(env.bx.stable_id("web", "r1", "t1"))["status"] == "handoff"


@pytest.mark.asyncio
@pytest.mark.skipif(not _node_available(), reason="node not available")
async def test_deliverable_and_build_execution_agree_on_handoff(env):
    """No two-store contradiction: build_execution=handoff and the
    deliverable content=build_status handoff both agree."""
    worker = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
        "build-worker", "korvix-build-worker.mjs")
    env.be.register(["node", worker])

    did = env.ds.create_deliverable(run_id="r1", agent_id="b", node_id="web",
                                    kind="web_build", project_id="p1")
    tid = env.ts.create_task(run_id="r1", title="web", assigned_agent="b", project_id="p1")

    from backend.services.jobs.registry import JobContext

    async def _rep(p, l=None):
        return None

    async def _canc():
        return False

    rec = SimpleNamespace(id="job1", user_id="u1", idempotency_key="wf:w:step:web",
                          payload={"run_id": "r1", "node_id": "web", "deliverable_id": did,
                                   "task_id": tid, "project_id": "p1", "user_request": "site"})
    ctx = JobContext(record=rec, report_progress=_rep, is_cancelled=_canc)
    out = await env.bc._web_build_handler(ctx)

    assert out["build_status"] == "handoff"
    d = env.ds.get_deliverable(did)
    assert d["content"]["build_status"] == "handoff"
    bxrow = env.bx.get(env.bx.stable_id("web", "r1", tid))
    assert bxrow["status"] == "handoff"        # agrees with the deliverable


# ── Defect 2 — observability truthfulness ────────────────────────────────

def test_cancelled_run_has_no_pending_approval(env):
    svc = env.svc
    rid = env.rs.create_run(run_id="rC", user_id="u1", agent_id="s", project_id="p1")
    env.rs.update_run_metadata(rid, {"runner_started": True})
    # A build deliverable that was awaiting approval, then the run was
    # cancelled → deliverable skipped, but content still has requires_approval.
    did = env.ds.create_deliverable(run_id=rid, agent_id="b", node_id="web",
                                    kind="web_build", project_id="p1")
    env.ds.set_content(did, {"build_type": "web", "capability": "web_build",
                             "requires_approval": True, "fingerprint": "fp",
                             "build_status": "awaiting_approval"}, status="skipped")

    obs = svc._build_observability(rid, "u1", "p1", env.ds.list_for_run(rid),
                                   "cancelled", True, None)
    assert obs["pending_approvals"] == []
    assert obs["next_action"] == "review_cancelled"
    assert obs["failure_code"] == env.sm.CODE_WORKFLOW_CANCELLED


def test_open_run_still_shows_pending_approval(env):
    svc = env.svc
    rid = env.rs.create_run(run_id="rO", user_id="u1", agent_id="s", project_id="p1")
    did = env.ds.create_deliverable(run_id=rid, agent_id="b", node_id="web",
                                    kind="web_build", project_id="p1")
    env.ds.set_content(did, {"build_type": "web", "capability": "web_build",
                             "requires_approval": True, "fingerprint": "fp",
                             "build_status": "awaiting_approval"}, status="pending")
    obs = svc._build_observability(rid, "u1", "p1", env.ds.list_for_run(rid),
                                   "awaiting_approval", True, None)
    assert len(obs["pending_approvals"]) == 1
    assert obs["next_action"] == "approve_pending_operation"
    assert obs["failure_code"] is None


def test_failed_run_emits_failure_code(env):
    svc = env.svc
    rid = env.rs.create_run(run_id="rF", user_id="u1", agent_id="s", project_id="p1")
    did = env.ds.create_deliverable(run_id=rid, agent_id="b", node_id="app",
                                    kind="app_build", project_id="p1")
    env.ds.set_status(did, "failed", error="build worker timed out after 900s")
    obs = svc._build_observability(rid, "u1", "p1", env.ds.list_for_run(rid),
                                   "failed", True, None)
    assert obs["failure_code"] == env.sm.CODE_BUILD_TIMEOUT
    assert obs["next_action"] == "review_failure"
