# coding: utf-8
"""Sprint 1.4 — Blueprint → Orchestrator bridge tests.

Deterministic; no real LLM calls (the agent runtime is monkeypatched for the
single execution test). Covers adapter mapping, dry-run safety, gated
execution, identity, cross-user blocking, module separation, and the route.
"""
import importlib
import os
import sys
import tempfile

import pytest

from backend.services.blueprint_bridge import (
    plan_to_orchestration, dry_run, execution_prerequisites,
    OrchestrationRequest, DryRunResult,
)


def _token(sub):
    from backend.services.auth import tokens
    tok, _ = tokens.issue(sub=sub, token_type="access", ttl_seconds=3600)
    return {"Authorization": f"Bearer {tok}"}


# ── Adapter: blueprint → request (preservation) ───────────────────────────

def test_blueprint_to_request_preserves_fields():
    plan, req = plan_to_orchestration(
        "build an online store to sell shoes with checkout and payments"
    )
    assert isinstance(req, OrchestrationRequest)
    assert req.user_request.startswith("build an online store")   # prompt preserved
    assert req.workspace == "ecommerce"                            # workspace preserved
    assert req.product_category == plan.intent.product_category.value
    assert req.audience == plan.blueprint.audience
    assert req.complexity == plan.intent.complexity.value
    assert req.recommended_renderer == plan.blueprint.recommended_renderer
    assert req.core_features == plan.blueprint.core_features
    # recommended agents preserved (ids)
    assert req.recommended_agents == [a.agent_id for a in plan.blueprint.recommended_agents]
    assert "merchandiser" in req.recommended_agents
    # deliverables + risks + metrics preserved
    assert req.recommended_deliverables == plan.intent.expected_deliverables
    assert req.risk_analysis == plan.blueprint.risk_analysis
    assert req.success_metrics == plan.blueprint.success_metrics


def test_renderer_recommendation_preserved_per_workspace():
    assert plan_to_orchestration("write a research report with sources")[1].recommended_renderer == "document"
    assert plan_to_orchestration("make a 2D arcade game")[1].recommended_renderer == "simulation"
    assert plan_to_orchestration("a trading dashboard with signals")[1].recommended_renderer == "dashboard"


def test_unknown_workspace_produces_safe_request():
    plan, req = plan_to_orchestration("zzz qqq nothing here")
    assert req.workspace == "unknown"
    assert req.suggested_template_id is None     # no template forced
    dr = dry_run(req)
    # orchestrator still resolves a safe (existing) template for the preview
    assert dr.resolved_template_id   # non-empty
    assert isinstance(dr, DryRunResult)


# ── Dry-run safety (NO execution) ─────────────────────────────────────────

def test_dry_run_does_not_execute_jobs(monkeypatch):
    # Point the orchestrator stores at a temp DB and assert NO run rows are
    # created by a dry-run.
    fd, path = tempfile.mkstemp(suffix="-bridge-dry.db"); os.close(fd)
    monkeypatch.setenv("PROJECTS_DB_PATH", path)
    for m in ("backend.services.orchestrator.runs_store",):
        if m in sys.modules:
            importlib.reload(sys.modules[m])
    from backend.services.orchestrator import init_runs_table, list_runs, runs_stats
    init_runs_table()
    before = runs_stats()

    _, req = plan_to_orchestration("build a landing page for a startup")
    dr = dry_run(req)
    assert dr.proposed_steps and dr.proposed_agents
    # No runs were created — dry-run is pure.
    after = runs_stats()
    assert after.get("total", 0) == before.get("total", 0)
    assert list_runs(user_id="anyone") == []
    try: os.unlink(path)
    except FileNotFoundError: pass


def test_dry_run_reports_missing_prerequisites():
    # With orchestration flags off, dry-run lists what's missing for a real run.
    _, req = plan_to_orchestration("build a site")
    dr = dry_run(req)
    assert "ENABLE_PROJECT_ORCHESTRATOR" in dr.missing_prerequisites


# ── Module separation (no boundary violations) ────────────────────────────

def test_product_intelligence_has_no_orchestrator_or_builder_import():
    import backend.services.product_intelligence as pi
    import pathlib
    root = pathlib.Path(pi.__file__).parent
    for f in root.rglob("*.py"):
        src = f.read_text(encoding="utf-8")
        # the package must not IMPORT the orchestrator, a renderer, or a builder
        for bad in ("import backend.services.orchestrator",
                    "from backend.services.orchestrator",
                    "website_builder", "generation.renderers", "blueprint_bridge"):
            assert bad not in src, f"{f} leaks a dependency: {bad}"


def test_orchestrator_does_not_import_product_intelligence_or_verticals():
    import backend.services.orchestrator as orch
    import pathlib
    root = pathlib.Path(orch.__file__).parent
    joined = "\n".join(
        f.read_text(encoding="utf-8") for f in root.rglob("*.py")
    )
    # orchestrator must not depend on product intelligence or the bridge
    assert "product_intelligence" not in joined
    assert "blueprint_bridge" not in joined
    # and verticals must not be hardcoded into the orchestrator
    for vertical in ("WebsiteBuilder", "game_engine", "ecommerce_checkout"):
        assert vertical not in joined


# ── Route ─────────────────────────────────────────────────────────────────

@pytest.fixture
def bridge_app(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.routes import v2_intelligence_orchestrate as bridge_route
    monkeypatch.setattr(bridge_route.settings, "ENABLE_BLUEPRINT_ORCHESTRATOR_BRIDGE", True)
    monkeypatch.setenv("JWT_SECRET_KEY", "x" * 40)
    app = FastAPI(); app.include_router(bridge_route.router)
    return TestClient(app)


def test_route_disabled_returns_503(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.routes import v2_intelligence_orchestrate as bridge_route
    monkeypatch.setattr(bridge_route.settings, "ENABLE_BLUEPRINT_ORCHESTRATOR_BRIDGE", False)
    app = FastAPI(); app.include_router(bridge_route.router)
    c = TestClient(app)
    assert c.post("/v2/intelligence/orchestrate", json={"prompt": "x"}).status_code == 503
    assert c.get("/v2/intelligence/orchestrate/health").status_code == 200  # always callable


def test_route_dry_run_returns_stable_json(bridge_app):
    r = bridge_app.post("/v2/intelligence/orchestrate",
                        json={"prompt": "build a trading dashboard with crypto signals"})
    assert r.status_code == 200
    j = r.json()
    assert j["mode"] == "dry_run"
    assert set(j).issuperset({"plan", "blueprint", "orchestration_request",
                              "dry_run", "feature_flags", "disabled_prerequisites"})
    assert j["orchestration_request"]["workspace"] == "trading"
    assert j["dry_run"]["recommended_renderer"] == "dashboard"
    # no execution happened
    assert "execution" not in j


def test_route_execute_with_flags_off_is_not_mocked(bridge_app):
    # execute requested but orchestrator flags are off → executed False with
    # the disabled prerequisites listed (NEVER a silent mock run).
    r = bridge_app.post("/v2/intelligence/orchestrate",
                        json={"prompt": "build a site", "dry_run": False, "execute": True})
    assert r.status_code == 200
    j = r.json()
    assert j["mode"] == "execute"
    assert j["execution"]["executed"] is False
    assert j["execution"]["run_id"] is None
    assert "ENABLE_PROJECT_ORCHESTRATOR" in j["execution"]["disabled_prerequisites"]


# ── Gated execution (real orchestrator run, fake agent) ───────────────────

@pytest.fixture
def execution_app(monkeypatch):
    """Full orchestrator wiring with the agent runtime faked, plus the bridge
    enabled — so the EXECUTION path creates a real run without an LLM call."""
    fd, path = tempfile.mkstemp(suffix="-bridge-exec.db"); os.close(fd)
    monkeypatch.setenv("PROJECTS_DB_PATH", path)
    monkeypatch.setenv("JWT_SECRET_KEY", "x" * 40)
    # All flags the bridge requires for execution.
    for flag in ("ENABLE_BLUEPRINT_ORCHESTRATOR_BRIDGE", "ENABLE_PRODUCT_INTELLIGENCE",
                 "ENABLE_PROJECT_ORCHESTRATOR", "ENABLE_WORKFLOWS",
                 "ENABLE_WORKFLOW_RUNNER", "ENABLE_JOB_QUEUE"):
        monkeypatch.setenv(flag, "true")
    monkeypatch.setenv("WORKFLOW_RUNNER_POLL_INTERVAL_SEC", "0.05")

    # Isolate orchestrator + jobs + workflows + panels DBs.
    import importlib
    rstore = importlib.import_module("backend.services.orchestrator.runs_store")
    tstore = importlib.import_module("backend.services.orchestrator.tasks_store")
    dstore = importlib.import_module("backend.services.orchestrator.deliverables_store")
    for st in (rstore, tstore, dstore):
        monkeypatch.setattr(st, "DB_PATH", path, raising=False)

    def _tmp_db(envname, suffix, module):
        fd2, p2 = tempfile.mkstemp(suffix=suffix); os.close(fd2)
        monkeypatch.setenv(envname, p2)
        mod = importlib.import_module(module)
        monkeypatch.setattr(mod, "_INITIALIZED", False, raising=False)
        mod.init()
        return p2
    _tmp_db("JOBS_DB_PATH", "-exec-jobs.db", "backend.services.jobs.store")
    _tmp_db("WORKFLOWS_DB_PATH", "-exec-wf.db", "backend.services.workflows.store")
    _tmp_db("PANELS_DB_PATH", "-exec-panels.db", "backend.services.panels.store")

    from backend.services.orchestrator import init_runs_table, init_tasks_table, init_deliverables_table
    init_runs_table(); init_tasks_table(); init_deliverables_table()

    # Fake the agent runtime so no LLM is called.
    ark = importlib.import_module("backend.services.orchestrator.agent_run_kind")
    from backend.services.agent.types import AgentResponse

    async def _fake_run_agent(req):
        return AgentResponse(reply=f"[{getattr(req, 'mode', 'agent')}] done", mode=getattr(req, "mode", "x"), model="fake")
    monkeypatch.setattr(ark, "run_agent", _fake_run_agent)

    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.routes import v2_intelligence_orchestrate as bridge_route
    monkeypatch.setattr(bridge_route.settings, "ENABLE_BLUEPRINT_ORCHESTRATOR_BRIDGE", True)
    app = FastAPI(); app.include_router(bridge_route.router)
    yield TestClient(app)
    try: os.unlink(path)
    except FileNotFoundError: pass


def test_execution_creates_real_run_under_authenticated_identity(execution_app):
    r = execution_app.post(
        "/v2/intelligence/orchestrate",
        headers=_token("alice"),
        json={"prompt": "research the future of remote work", "dry_run": False, "execute": True},
    )
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["mode"] == "execute"
    assert j["execution"]["executed"] is True
    assert j["execution"]["run_id"]
    assert not j["execution"]["disabled_prerequisites"]
    # The run is owned by the authenticated identity (alice), not a body field.
    from backend.services.orchestrator import list_runs
    assert any(row["user_id"] == "alice" for row in list_runs(user_id="alice"))


def test_execution_cross_user_project_blocked(execution_app, monkeypatch):
    # alice owns a project; mallory cannot orchestrate into it.
    monkeypatch.setenv("ENABLE_PROJECTS", "true")
    import importlib
    pstore = importlib.import_module("backend.services.projects.store")
    monkeypatch.setattr(pstore, "DB_PATH",
                        os.environ["PROJECTS_DB_PATH"], raising=False)
    monkeypatch.setattr(pstore, "_INITIALIZED", False, raising=False)
    pstore.init()
    proj = pstore.create_project("alice", name="Alice proj")
    r = execution_app.post(
        "/v2/intelligence/orchestrate",
        headers=_token("mallory"),
        json={"prompt": "build a site", "project_id": proj.id, "dry_run": True},
    )
    assert r.status_code == 404
