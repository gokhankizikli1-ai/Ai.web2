# coding: utf-8
"""Phase 7 — workspace observability reconstructed from backend truth.

The workspace must rebuild runner health, pending approvals, build
artifacts, and next action from durable backend state after a refresh /
reopen — never from localStorage. These tests exercise get_run_snapshot's
observability block directly.
"""
from __future__ import annotations

import importlib

import pytest


@pytest.fixture()
def orch_env(tmp_path, monkeypatch):
    monkeypatch.setenv("PROJECTS_DB_PATH", str(tmp_path / "projects.db"))
    from backend.services.orchestrator import (
        runs_store, tasks_store, deliverables_store, service,
    )
    importlib.reload(runs_store)
    importlib.reload(tasks_store)
    importlib.reload(deliverables_store)
    importlib.reload(service)
    runs_store.init_runs_table()
    tasks_store.init_tasks_table()
    deliverables_store.init_deliverables_table()
    return runs_store, tasks_store, deliverables_store, service


def test_runner_health_survives_reopen(orch_env):
    runs_store, _, _, service = orch_env
    rid = runs_store.create_run(user_id="u1", agent_id="supervisor", project_id="p1")
    # Simulate the run having been kicked with the runner healthy.
    runs_store.update_run_metadata(rid, {"runner_started": True, "runner_error": None})

    snap = service.get_run_snapshot(rid, user_id="u1")
    assert snap is not None
    assert snap["runner_started"] is True
    assert snap["observability"]["runner_healthy"] is True


def test_runner_error_surfaced_truthfully(orch_env):
    runs_store, _, _, service = orch_env
    rid = runs_store.create_run(user_id="u1", agent_id="supervisor", project_id="p1")
    runs_store.update_run_metadata(
        rid, {"runner_started": False, "runner_error": "ENABLE_WORKFLOW_RUNNER is false"},
    )
    snap = service.get_run_snapshot(rid, user_id="u1")
    assert snap["runner_error"] == "ENABLE_WORKFLOW_RUNNER is false"
    assert snap["observability"]["runner_healthy"] is False
    assert snap["observability"]["next_action"] == "resolve_runner_error"


def test_pending_approval_and_build_artifact_surfaced(orch_env):
    runs_store, _, ds, service = orch_env
    rid = runs_store.create_run(user_id="u1", agent_id="supervisor", project_id="p1")
    runs_store.update_run_metadata(rid, {"runner_started": True})

    # A build awaiting approval. In the Phase-2 pause model an awaiting
    # deliverable is OPEN (pending), not failed — a pending approval is only
    # "pending" while the deliverable is still open and the run non-terminal.
    d_block = ds.create_deliverable(run_id=rid, agent_id="b", node_id="app",
                                    kind="app_build", project_id="p1")
    ds.set_content(d_block, {
        "build_type": "app", "capability": "app_build",
        "build_status": "awaiting_approval",
        "requires_approval": True, "fingerprint": "abc123",
    }, status="pending")
    # A completed web build (reference).
    d_web = ds.create_deliverable(run_id=rid, agent_id="b", node_id="web",
                                  kind="web_build", project_id="p1")
    ds.set_content(d_web, {
        "build_type": "web", "build_status": "completed",
        "artifact_ref": "webrun:1", "build_ref": "b1",
    }, status="completed")

    snap = service.get_run_snapshot(rid, user_id="u1")
    obs = snap["observability"]
    assert len(obs["pending_approvals"]) == 1
    assert obs["pending_approvals"][0]["capability"] == "app_build"
    assert obs["pending_approvals"][0]["fingerprint"] == "abc123"
    assert len(obs["build_artifacts"]) == 1
    assert obs["build_artifacts"][0]["artifact_ref"] == "webrun:1"
    # Pending approval drives the recommended next action.
    assert obs["next_action"] == "approve_pending_operation"


def test_cross_user_snapshot_isolation(orch_env):
    runs_store, _, _, service = orch_env
    rid = runs_store.create_run(user_id="owner", agent_id="supervisor", project_id="p1")
    # Another user must not read it.
    assert service.get_run_snapshot(rid, user_id="intruder") is None
    assert service.get_run_snapshot(rid, user_id="owner") is not None
