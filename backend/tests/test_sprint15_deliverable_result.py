# coding: utf-8
"""Sprint 1.5 — Deliverable Result API tests.

Deterministic; no LLM, no network. Seeds the orchestrator's existing runs +
deliverables stores directly and resolves them through the result layer.
"""
import json
import os
import sys
import importlib
import tempfile

import pytest


@pytest.fixture
def orch_db(monkeypatch):
    """Isolated orchestrator runs + deliverables DB."""
    fd, path = tempfile.mkstemp(suffix="-s15.db"); os.close(fd)
    monkeypatch.setenv("PROJECTS_DB_PATH", path)
    monkeypatch.setenv("JWT_SECRET_KEY", "x" * 40)
    for m in ("backend.services.orchestrator.runs_store",
              "backend.services.orchestrator.deliverables_store"):
        if m in sys.modules:
            importlib.reload(sys.modules[m])
    from backend.services.orchestrator import init_runs_table, init_deliverables_table
    init_runs_table(); init_deliverables_table()
    yield path
    try: os.unlink(path)
    except FileNotFoundError: pass


def _seed_run(run_id, user_id, project_id="p1", status_meta=None):
    from backend.services.orchestrator import create_run
    return create_run(run_id=run_id, user_id=user_id, project_id=project_id,
                      agent_id="supervisor", metadata=status_meta or {})


def _seed_deliverable(run_id, *, node_id, kind, preview, atype, body="x",
                      status="completed", project_id="p1", agent_id="coder"):
    from backend.services.orchestrator import deliverables_store as ds
    did = ds.create_deliverable(run_id=run_id, agent_id=agent_id, node_id=node_id,
                                kind=kind, project_id=project_id, status="pending")
    if status == "completed":
        ds.set_content(did, {
            "text": f"{node_id} output", "agent_id": agent_id, "node_id": node_id,
            "artifact": {"type": atype, "title": kind, "preview": preview, "content": body},
        }, status="completed")
    elif status == "failed":
        ds.set_status(did, "failed", error="boom")
    return did


# ── Lifecycle states ──────────────────────────────────────────────────────

def test_unknown_run_is_not_found(orch_db):
    from backend.services.deliverable_result import resolve_run_result, ResultStatus
    assert resolve_run_result("ghost", user_id="u1").status is ResultStatus.NOT_FOUND


def test_running_run_no_deliverables(orch_db):
    from backend.services.deliverable_result import resolve_run_result, ResultStatus
    _seed_run("r1", "u1")
    assert resolve_run_result("r1", user_id="u1").status is ResultStatus.RUNNING


def test_completed_run_returns_final_deliverable(orch_db):
    from backend.services.deliverable_result import resolve_run_result, ResultStatus
    _seed_run("r1", "u1")
    # an intermediate markdown + the final html — html must win.
    _seed_deliverable("r1", node_id="research", kind="research", preview="markdown", atype="markdown")
    _seed_deliverable("r1", node_id="code", kind="landing_page_html", preview="iframe",
                      atype="html", body="<!doctype html><h1>Hi</h1>")
    res = resolve_run_result("r1", user_id="u1")
    assert res.status is ResultStatus.COMPLETED
    assert res.renderer == "iframe"
    assert res.artifact_type == "html"
    assert res.html_preview and "<h1>Hi</h1>" in res.html_preview
    assert res.structured_data and res.structured_data["type"] == "html"
    assert len(res.source_deliverables) == 2     # both deliverables referenced


def test_latest_project_result(orch_db):
    from backend.services.deliverable_result import resolve_project_result, ResultStatus
    _seed_run("r1", "u1", project_id="pX")
    _seed_deliverable("r1", node_id="code", kind="html", preview="iframe", atype="html", project_id="pX")
    res = resolve_project_result("pX", user_id="u1")
    assert res.status is ResultStatus.COMPLETED
    assert res.project_id == "pX"


def test_no_run_for_project(orch_db):
    from backend.services.deliverable_result import resolve_project_result, ResultStatus
    assert resolve_project_result("nope", user_id="u1").status is ResultStatus.NO_RUN


def test_failed_run_returns_failure(orch_db):
    from backend.services.deliverable_result import resolve_run_result, ResultStatus
    from backend.services.orchestrator.runs_store import error_run
    _seed_run("r1", "u1")
    error_run("r1", error="agent exploded")
    res = resolve_run_result("r1", user_id="u1")
    assert res.status is ResultStatus.FAILED
    assert any("exploded" in e for e in res.errors)
    # no fabricated content
    assert res.content is None and res.html_preview is None


def test_cancelled_run_returns_cancelled(orch_db):
    from backend.services.deliverable_result import resolve_run_result, ResultStatus
    from backend.services.orchestrator.runs_store import error_run
    _seed_run("r1", "u1")
    error_run("r1", error="cancelled", metadata={"cancelled": True})
    res = resolve_run_result("r1", user_id="u1")
    assert res.status is ResultStatus.CANCELLED


def test_partial_requires_include_flag(orch_db):
    from backend.services.deliverable_result import resolve_run_result, ResultStatus
    _seed_run("r1", "u1")
    # one completed deliverable while the run is still 'running'
    _seed_deliverable("r1", node_id="a", kind="markdown", preview="markdown", atype="markdown")
    assert resolve_run_result("r1", user_id="u1").status is ResultStatus.PARTIAL
    inc = resolve_run_result("r1", user_id="u1", include_partial=True)
    assert inc.status is ResultStatus.PARTIAL
    assert inc.content is not None        # partial content surfaced when asked


def test_artifact_type_filter(orch_db):
    from backend.services.deliverable_result import resolve_run_result, ResultStatus
    _seed_run("r1", "u1")
    _seed_deliverable("r1", node_id="code", kind="html", preview="iframe", atype="html")
    # hit
    assert resolve_run_result("r1", user_id="u1", artifact_type="html").status is ResultStatus.COMPLETED
    # miss → ARTIFACT_NOT_FOUND (NOT a fabricated result)
    miss = resolve_run_result("r1", user_id="u1", artifact_type="game_code")
    assert miss.status is ResultStatus.ARTIFACT_NOT_FOUND
    assert miss.content is None


def test_renderer_filter(orch_db):
    from backend.services.deliverable_result import resolve_run_result, ResultStatus
    _seed_run("r1", "u1")
    _seed_deliverable("r1", node_id="code", kind="html", preview="iframe", atype="html")
    assert resolve_run_result("r1", user_id="u1", renderer="iframe").status is ResultStatus.COMPLETED
    assert resolve_run_result("r1", user_id="u1", renderer="markdown").status is ResultStatus.ARTIFACT_NOT_FOUND


def test_cross_user_run_blocked(orch_db):
    from backend.services.deliverable_result import resolve_run_result, ResultStatus
    _seed_run("r1", "alice")
    _seed_deliverable("r1", node_id="code", kind="html", preview="iframe", atype="html")
    # mallory cannot see alice's run (existence-hidden via get_run_snapshot)
    assert resolve_run_result("r1", user_id="mallory").status is ResultStatus.NOT_FOUND


def test_future_artifact_type_does_not_crash(orch_db):
    from backend.services.deliverable_result import resolve_run_result, ResultStatus
    _seed_run("r1", "u1")
    # a not-yet-implemented artifact type + unknown preview must pass through
    _seed_deliverable("r1", node_id="g", kind="game_design_document",
                      preview="game_doc", atype="game_design_document", body="# GDD")
    res = resolve_run_result("r1", user_id="u1")
    assert res.status is ResultStatus.COMPLETED
    assert res.artifact_type == "game_design_document"
    assert res.renderer == "game_doc"      # unknown renderer passed through, no crash


def test_stable_json_schema(orch_db):
    from backend.services.deliverable_result import resolve_run_result
    _seed_run("r1", "u1")
    _seed_deliverable("r1", node_id="code", kind="html", preview="iframe", atype="html")
    d = resolve_run_result("r1", user_id="u1").to_dict()
    json.dumps(d)   # serializable
    assert set(d) == {
        "status", "project_id", "run_id", "workflow_id", "artifact_id",
        "artifact_type", "renderer", "title", "summary", "content",
        "html_preview", "structured_data", "source_deliverables",
        "warnings", "errors", "created_at", "updated_at",
    }


# ── Module boundaries ─────────────────────────────────────────────────────

def test_no_renderer_or_builder_dependency():
    import backend.services.deliverable_result as dr
    import pathlib
    root = pathlib.Path(dr.__file__).parent
    joined = "\n".join(f.read_text(encoding="utf-8") for f in root.rglob("*.py"))
    for bad in ("website_builder", "generation.renderers", "import WebsiteBuilder"):
        assert bad not in joined


def test_product_intelligence_does_not_import_result_layer():
    import backend.services.product_intelligence as pi
    import pathlib
    root = pathlib.Path(pi.__file__).parent
    joined = "\n".join(f.read_text(encoding="utf-8") for f in root.rglob("*.py"))
    assert "deliverable_result" not in joined


# ── HTTP route ────────────────────────────────────────────────────────────

@pytest.fixture
def results_app(orch_db, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.routes import v2_results
    monkeypatch.setattr(v2_results.settings, "ENABLE_DELIVERABLE_RESULT_API", True)
    app = FastAPI(); app.include_router(v2_results.router)
    return TestClient(app)


def _bearer(sub):
    from backend.services.auth import tokens
    t, _ = tokens.issue(sub=sub, token_type="access", ttl_seconds=3600)
    return {"Authorization": f"Bearer {t}"}


def test_route_disabled_returns_503(orch_db, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.routes import v2_results
    monkeypatch.setattr(v2_results.settings, "ENABLE_DELIVERABLE_RESULT_API", False)
    app = FastAPI(); app.include_router(v2_results.router)
    c = TestClient(app)
    assert c.get("/v2/orchestrator/runs/r1/result").status_code == 503
    assert c.get("/v2/orchestrator/results/health").status_code == 200


def test_route_returns_result_and_blocks_cross_user(results_app):
    _seed_run("r1", "alice")
    _seed_deliverable("r1", node_id="code", kind="html", preview="iframe", atype="html", body="<h1>ok</h1>")
    r = results_app.get("/v2/orchestrator/runs/r1/result", headers=_bearer("alice"))
    assert r.status_code == 200
    j = r.json()
    assert j["result"]["status"] == "completed"
    assert j["result"]["renderer"] == "iframe"
    assert "feature_flags" in j
    # cross-user → not_found status (no leak)
    r2 = results_app.get("/v2/orchestrator/runs/r1/result", headers=_bearer("mallory"))
    assert r2.json()["result"]["status"] == "not_found"


def test_project_route_cross_user_404(results_app, monkeypatch, orch_db):
    monkeypatch.setenv("ENABLE_PROJECTS", "true")
    import importlib
    pstore = importlib.import_module("backend.services.projects.store")
    monkeypatch.setattr(pstore, "DB_PATH", orch_db, raising=False)
    monkeypatch.setattr(pstore, "_INITIALIZED", False, raising=False)
    pstore.init()
    proj = pstore.create_project("alice", name="Alice")
    r = results_app.get(f"/v2/orchestrator/projects/{proj.id}/result", headers=_bearer("mallory"))
    assert r.status_code == 404


# ── Bridge references the result route ────────────────────────────────────

def test_bridge_execution_includes_result_route(monkeypatch):
    """When the bridge executes and returns a run_id, the orchestrate route
    references where to fetch the result later (no synchronous wait)."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.routes import v2_intelligence_orchestrate as bridge_route
    import backend.services.blueprint_bridge as bb
    from backend.services.blueprint_bridge.types import ExecutionResult

    monkeypatch.setattr(bridge_route.settings, "ENABLE_BLUEPRINT_ORCHESTRATOR_BRIDGE", True)
    monkeypatch.setenv("JWT_SECRET_KEY", "x" * 40)

    async def _fake_execute(req, *, user_id):
        return ExecutionResult(executed=True, run_id="run-xyz", project_id="proj-1",
                               workflow_id="wf-1", status="running")
    # The route does `from ... import execute as _execute` at call time, so
    # patching the package attribute is picked up.
    monkeypatch.setattr(bb, "execute", _fake_execute)

    app = FastAPI(); app.include_router(bridge_route.router)
    c = TestClient(app)
    r = c.post("/v2/intelligence/orchestrate",
               headers=_bearer("alice"),
               json={"prompt": "build a site", "dry_run": False, "execute": True})
    assert r.status_code == 200
    j = r.json()
    assert j["mode"] == "execute"
    assert j["execution"]["run_id"] == "run-xyz"
    assert j["result_route"] == "/v2/orchestrator/runs/run-xyz/result"
