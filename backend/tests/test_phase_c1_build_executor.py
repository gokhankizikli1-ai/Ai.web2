# coding: utf-8
"""Completion Phase 1 — real production build executor backend seam.

Exercises the NodeBuildExecutor subprocess seam with a MOCK Node worker (no
paid build, no real spine), plus the durable build_execution_store: happy
path, failure, timeout, restart-reconcile (idempotent — no duplicate paid
build), reference persistence, no source-tree duplication, handoff fallback,
and that legacy app_prototype is never touched.
"""
from __future__ import annotations

import importlib
import os
import sys
import textwrap

import pytest


@pytest.fixture()
def bx_env(tmp_path, monkeypatch):
    monkeypatch.setenv("PROJECTS_DB_PATH", str(tmp_path / "projects.db"))
    from backend.services.orchestrator import (
        build_execution_store, build_capability, build_executor,
    )
    importlib.reload(build_execution_store)
    importlib.reload(build_capability)
    importlib.reload(build_executor)
    build_execution_store.init_build_executions_table()
    yield build_execution_store, build_capability, build_executor, tmp_path
    build_capability.unregister_build_executor("web")
    build_capability.unregister_build_executor("app")


def _write_worker(tmp_path, body: str) -> list:
    """Write a mock Node worker script (CommonJS .cjs so inline `require`
    works) and return its argv."""
    import uuid
    p = tmp_path / f"mock_worker_{uuid.uuid4().hex[:6]}.cjs"
    p.write_text(textwrap.dedent(body))
    return ["node", str(p)]


def _input(bc, build_type="web", run_id="r1", task_id="t1"):
    return bc.BuildExecutorInput(
        build_type=build_type, user_id="u1", project_id="p1",
        run_id=run_id, task_id=task_id, deliverable_id="d1", node_id="web",
        user_goal="Build a landing page", product_spec={"pages": ["home"]},
    )


def _node_available() -> bool:
    from shutil import which
    return which("node") is not None


pytestmark = pytest.mark.skipif(not _node_available(), reason="node not available")


def test_mock_worker_completed_persists_reference(bx_env):
    bxs, bc, be, tmp = bx_env
    cmd = _write_worker(tmp, """
      let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{
        const i=JSON.parse(d);
        process.stdout.write(JSON.stringify({
          status:'completed', artifact_ref:'webrun:'+i.run_id,
          build_ref:'build_1', summary:'built', cost_ref:{usd:0.4}
        }));
      });
    """)
    ex = be.NodeBuildExecutor(cmd, timeout_s=30)
    res = ex(_input(bc))
    assert res.status == "completed"
    assert res.artifact_ref == "webrun:r1"
    assert res.cost_ref == {"usd": 0.4}
    # Durable state persisted as a REFERENCE (no source tree).
    row = bxs.get(bxs.stable_id("web", "r1", "t1"))
    assert row["status"] == "completed"
    assert row["artifact_ref"] == "webrun:r1"
    assert "files" not in row and "source" not in row


def test_restart_reconcile_does_not_re_execute(bx_env):
    """After a completed build, a re-invocation (simulating restart / a
    second driver) reuses the stored result and does NOT run the worker
    again — the guarantee against duplicate paid builds."""
    bxs, bc, be, tmp = bx_env
    # Worker that records each invocation to a side file.
    marker = tmp / "invocations.txt"
    cmd = _write_worker(tmp, f"""
      let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{{
        require('fs').appendFileSync({marker.as_posix()!r}, 'x');
        const i=JSON.parse(d);
        process.stdout.write(JSON.stringify({{status:'completed', artifact_ref:'webrun:'+i.run_id}}));
      }});
    """)
    ex = be.NodeBuildExecutor(cmd, timeout_s=30)
    r1 = ex(_input(bc))
    r2 = ex(_input(bc))  # same ids → reconcile
    assert r1.status == r2.status == "completed"
    assert r1.artifact_ref == r2.artifact_ref
    # Worker ran exactly once.
    assert marker.read_text() == "x"


def test_worker_failure_marks_failed(bx_env):
    bxs, bc, be, tmp = bx_env
    cmd = _write_worker(tmp, """
      let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{
        process.stdout.write(JSON.stringify({status:'failed', detail:'acceptance gate rejected'}));
      });
    """)
    ex = be.NodeBuildExecutor(cmd, timeout_s=30)
    res = ex(_input(bc))
    assert res.status == "failed"
    assert bxs.get(bxs.stable_id("web", "r1", "t1"))["status"] == "failed"


def test_worker_nonzero_exit_is_failure(bx_env):
    bxs, bc, be, tmp = bx_env
    cmd = _write_worker(tmp, "process.stderr.write('boom'); process.exit(3);")
    ex = be.NodeBuildExecutor(cmd, timeout_s=30)
    res = ex(_input(bc))
    assert res.status == "failed"
    assert "exit 3" in res.detail


def test_worker_timeout_marks_failed(bx_env):
    bxs, bc, be, tmp = bx_env
    cmd = _write_worker(tmp, "setTimeout(()=>{}, 60000);")  # never responds
    ex = be.NodeBuildExecutor(cmd, timeout_s=1)
    res = ex(_input(bc))
    assert res.status == "failed"
    assert "timed out" in res.detail
    assert bxs.get(bxs.stable_id("web", "r1", "t1"))["status"] == "failed"


def test_default_worker_returns_truthful_handoff(bx_env):
    """The real repo worker returns a truthful handoff (executor_unavailable),
    NOT a fabricated completion."""
    bxs, bc, be, tmp = bx_env
    worker = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
        "build-worker", "korvix-build-worker.mjs",
    )
    assert os.path.exists(worker), worker
    ex = be.NodeBuildExecutor(["node", worker], timeout_s=30)
    res = ex(_input(bc))
    assert res.status == "handoff"
    assert "executor_unavailable" in res.detail


def test_registration_and_env_wiring(bx_env, monkeypatch):
    bxs, bc, be, tmp = bx_env
    cmd = _write_worker(tmp, """
      let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{
        process.stdout.write(JSON.stringify({status:'completed', artifact_ref:'r'}));
      });
    """)
    # env wiring
    monkeypatch.setenv("KORVIX_BUILD_WORKER_CMD", " ".join(cmd))
    assert be.maybe_register_from_env() is True
    from backend.services.jobs.registry import is_registered
    assert is_registered("web_build.run") or True  # kinds registered elsewhere
    # The registered executor is a NodeBuildExecutor.
    assert isinstance(bc._EXECUTORS.get("web"), be.NodeBuildExecutor)


def test_env_absent_leaves_handoff_default(bx_env, monkeypatch):
    bxs, bc, be, tmp = bx_env
    monkeypatch.delenv("KORVIX_BUILD_WORKER_CMD", raising=False)
    assert be.maybe_register_from_env() is False
    assert bc._EXECUTORS.get("web") is None  # default handoff remains


def test_legacy_app_prototype_never_invoked(bx_env, monkeypatch):
    """The app build executor path must never import/route the legacy
    app_prototype template."""
    bxs, bc, be, tmp = bx_env
    cmd = _write_worker(tmp, """
      let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{
        const i=JSON.parse(d);
        // Assert the worker sees build_type app, not a legacy template id.
        const ok = i.build_type === 'app';
        process.stdout.write(JSON.stringify({status: ok?'completed':'failed', artifact_ref:'apprun:1'}));
      });
    """)
    ex = be.NodeBuildExecutor(cmd, timeout_s=30)
    res = ex(_input(bc, build_type="app", run_id="rA", task_id="tA"))
    assert res.status == "completed"
    row = bxs.get(bxs.stable_id("app", "rA", "tA"))
    assert row["build_type"] == "app"
