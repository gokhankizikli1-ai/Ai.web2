# coding: utf-8
"""Phase 3 — production Web/App build capability bridge.

Verifies the thin orchestrator→builder adapter with a MOCKED executor (no
paid build, no model call). Covers: web build, app build, references (not
source trees) in the deliverable, the durable handoff default when no
executor is registered, failure propagation, upstream-context threading,
and that app_build.run never routes into the legacy app_prototype flow.
"""
from __future__ import annotations

import importlib
from types import SimpleNamespace

import pytest


@pytest.fixture()
def build_env(tmp_path, monkeypatch):
    monkeypatch.setenv("PROJECTS_DB_PATH", str(tmp_path / "projects.db"))
    from backend.services.orchestrator import (
        deliverables_store, tasks_store, build_capability,
    )
    importlib.reload(deliverables_store)
    importlib.reload(tasks_store)
    importlib.reload(build_capability)
    deliverables_store.init_deliverables_table()
    tasks_store.init_tasks_table()
    yield build_capability, deliverables_store, tasks_store
    build_capability.unregister_build_executor("web")
    build_capability.unregister_build_executor("app")


def _ctx(payload, user_id="u1"):
    from backend.services.jobs.registry import JobContext

    async def _report(pct, label=None):
        return None

    async def _cancelled():
        return False

    record = SimpleNamespace(id="job1", user_id=user_id, payload=payload)
    return JobContext(record=record, report_progress=_report,
                      is_cancelled=_cancelled)


def _make_nodes(bc, ds, ts, *, node_id, build_type):
    run_id = "runB"
    did = ds.create_deliverable(
        run_id=run_id, agent_id="builder", node_id=node_id,
        kind=bc.DELIVERABLE_KIND[build_type], project_id="projB",
    )
    tid = ts.create_task(
        run_id=run_id, title=f"{build_type} build", assigned_agent="builder",
        project_id="projB",
    )
    return run_id, did, tid


@pytest.mark.asyncio
async def test_web_build_capability_with_mock_executor(build_env):
    bc, ds, ts = build_env
    seen = {}

    async def _mock_web(inp):
        seen["input"] = inp
        return bc.BuildExecutorResult(
            status="completed",
            artifact_ref="webrun:abc123",
            build_ref="build_987",
            summary="Landing page built: hero, features, pricing, CTA",
            cost_ref={"usd": 0.42, "provider": "mock"},
        )

    bc.register_build_executor("web", _mock_web)
    run_id, did, tid = _make_nodes(bc, ds, ts, node_id="web", build_type="web")

    result = await bc._web_build_handler(_ctx({
        "run_id": run_id, "node_id": "web", "deliverable_id": did,
        "task_id": tid, "project_id": "projB",
        "user_request": "Build a landing page for a restaurant SaaS",
    }))

    assert result["build_status"] == "completed"
    assert result["artifact_ref"] == "webrun:abc123"
    # Executor received bounded, structured input.
    assert seen["input"].build_type == "web"
    assert "restaurant" in seen["input"].user_goal
    # Deliverable stores a REFERENCE, not a source tree.
    d = ds.get_deliverable(did)
    assert d["status"] == "completed"
    assert d["content"]["artifact_ref"] == "webrun:abc123"
    assert d["content"]["build_ref"] == "build_987"
    assert "files" not in d["content"] and "source" not in d["content"]
    assert ts.get_task(tid)["status"] == "completed"


@pytest.mark.asyncio
async def test_app_build_capability_is_not_legacy_app_prototype(build_env):
    bc, ds, ts = build_env
    seen = {}

    async def _mock_app(inp):
        seen["input"] = inp
        return bc.BuildExecutorResult(
            status="completed", artifact_ref="apprun:xyz",
            build_ref="appbuild_1", summary="Multi-screen app built",
        )

    bc.register_build_executor("app", _mock_app)
    run_id, did, tid = _make_nodes(bc, ds, ts, node_id="app", build_type="app")

    result = await bc._app_build_handler(_ctx({
        "run_id": run_id, "node_id": "app", "deliverable_id": did,
        "task_id": tid, "project_id": "projB",
        "user_request": "Build an inventory app",
    }))

    assert result["build_type"] == "app"
    assert result["build_status"] == "completed"
    d = ds.get_deliverable(did)
    # The production App Build deliverable kind is 'app_build', NOT the
    # legacy 'app_prototype_html'.
    assert d["kind"] == "app_build"
    assert d["kind"] != "app_prototype_html"


@pytest.mark.asyncio
async def test_default_executor_is_truthful_handoff_not_fake_completed(build_env):
    """No real executor registered → a durable HANDOFF record, never a
    fabricated 'completed with source'. No paid call happens."""
    bc, ds, ts = build_env
    run_id, did, tid = _make_nodes(bc, ds, ts, node_id="web", build_type="web")

    result = await bc._web_build_handler(_ctx({
        "run_id": run_id, "node_id": "web", "deliverable_id": did,
        "task_id": tid, "project_id": "projB", "user_request": "site",
    }))

    assert result["build_status"] == "handoff"
    assert result["artifact_ref"].startswith("buildreq:web:")
    d = ds.get_deliverable(did)
    assert d["content"]["build_status"] == "handoff"


@pytest.mark.asyncio
async def test_build_failure_propagates(build_env):
    bc, ds, ts = build_env

    async def _boom(inp):
        return bc.BuildExecutorResult(status="failed", detail="acceptance gate rejected")

    bc.register_build_executor("web", _boom)
    run_id, did, tid = _make_nodes(bc, ds, ts, node_id="web", build_type="web")

    with pytest.raises(RuntimeError):
        await bc._web_build_handler(_ctx({
            "run_id": run_id, "node_id": "web", "deliverable_id": did,
            "task_id": tid, "project_id": "projB", "user_request": "site",
        }))
    assert ds.get_deliverable(did)["status"] == "failed"
    assert ts.get_task(tid)["status"] == "failed"


@pytest.mark.asyncio
async def test_build_receives_upstream_context(build_env):
    """A build task that depends on a 'product' node receives that node's
    deliverable via the Phase-2 projection, threaded into executor input."""
    bc, ds, ts = build_env
    # Upstream product spec deliverable.
    up = ds.create_deliverable(
        run_id="runB", agent_id="product", node_id="product",
        kind="markdown", project_id="projB",
    )
    ds.set_content(up, {"text": "Product: reservations + inventory for SMB restaurants"},
                   status="completed")

    captured = {}

    async def _mock_web(inp):
        captured["ctx"] = inp.upstream_context
        return bc.BuildExecutorResult(status="completed", artifact_ref="r")

    bc.register_build_executor("web", _mock_web)
    _, did, tid = _make_nodes(bc, ds, ts, node_id="web", build_type="web")

    await bc._web_build_handler(_ctx({
        "run_id": "runB", "node_id": "web", "deliverable_id": did,
        "task_id": tid, "project_id": "projB", "user_request": "site",
        "depends_on": ["product"],
    }))
    assert "SMB restaurants" in captured["ctx"]
    assert "UPSTREAM RESULT" in captured["ctx"]


def test_kinds_registered(build_env):
    bc, _, _ = build_env
    from backend.services.jobs.registry import is_registered
    bc.ensure_registered()
    assert is_registered("web_build.run")
    assert is_registered("app_build.run")
