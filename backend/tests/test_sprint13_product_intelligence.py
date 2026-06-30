# coding: utf-8
"""Sprint 1.3 — Universal Product Intelligence Engine tests.

Covers: workspace classification, intent parsing, multi-intent, unknown
requests, future-workspace extensibility, blueprint generation, agent
planning, serialization, and the gated HTTP route.
"""
import json

import pytest

from backend.services.product_intelligence import (
    plan_product, understand, classify, blueprint,
    WorkspaceKind, ProductBlueprint, ProductPlan, registered_kinds,
)


# ── Classification ────────────────────────────────────────────────────────

@pytest.mark.parametrize("text,expected", [
    ("build a landing page for my startup product", WorkspaceKind.WEBSITE_APP),
    ("write a business plan and pitch deck for investors", WorkspaceKind.STARTUP),
    ("create an online store with a cart and checkout", WorkspaceKind.ECOMMERCE),
    ("a trading dashboard with crypto signals and watchlist", WorkspaceKind.TRADING),
    ("research the literature on climate policy with citations", WorkspaceKind.RESEARCH),
    ("make a 2D platformer game with levels and a leaderboard", WorkspaceKind.GAME),
    ("an internal admin tool to automate our team workflow", WorkspaceKind.PRODUCTIVITY),
])
def test_workspace_classification(text, expected):
    cls = classify(text)
    assert cls.primary is expected, (text, cls.to_dict())
    assert 0.0 < cls.confidence <= 1.0


def test_all_builtin_workspaces_registered():
    kinds = set(registered_kinds())
    assert {
        WorkspaceKind.WEBSITE_APP, WorkspaceKind.STARTUP, WorkspaceKind.ECOMMERCE,
        WorkspaceKind.TRADING, WorkspaceKind.RESEARCH, WorkspaceKind.GAME,
        WorkspaceKind.PRODUCTIVITY,
    }.issubset(kinds)


# ── Unknown / ambiguous ───────────────────────────────────────────────────

def test_unknown_request_classified_unknown():
    cls = classify("asdf qwer zxcv 12345")
    assert cls.primary is WorkspaceKind.UNKNOWN
    assert cls.confidence == 0.0


def test_unknown_blueprint_is_honest_scaffold():
    plan = plan_product("zzz nothing meaningful here qqq")
    assert plan.intent.workspace is WorkspaceKind.UNKNOWN
    assert plan.blueprint.recommended_renderer == "none"
    # It asks to clarify rather than inventing a vertical.
    assert any("clarif" in f.lower() for f in plan.blueprint.core_features)


# ── Multi-intent ──────────────────────────────────────────────────────────

def test_multi_intent_detected():
    cls = classify("build a website and an online store with trading signals")
    assert cls.is_multi_intent()
    assert len(cls.secondary) >= 1
    # secondary workspaces are real, distinct workspaces
    sec_kinds = {s.workspace for s in cls.secondary}
    assert cls.primary not in sec_kinds


# ── Intent parsing facets ─────────────────────────────────────────────────

def test_intent_extracts_audience_and_industry():
    intent = understand("build a booking website for dentists in healthcare")
    assert intent.workspace is WorkspaceKind.WEBSITE_APP
    assert "dentist" in intent.audience.lower()
    assert intent.industry == "healthcare"


def test_intent_extracts_technical_and_business_context():
    intent = understand(
        "build a saas web app with user login, payments and a database; "
        "we want subscription revenue from business customers"
    )
    assert "authentication" in intent.technical_context
    assert "payments" in intent.technical_context
    assert "database" in intent.technical_context
    assert "monetization" in intent.business_context


def test_intent_complexity_escalates():
    simple = understand("a simple single page landing")
    assert simple.complexity.value == "simple"
    complex_ = understand(
        "an enterprise multi-tenant platform with auth, payments, api integrations and admin"
    )
    assert complex_.complexity.value in ("complex", "advanced")


# ── Blueprint generation ──────────────────────────────────────────────────

def test_blueprint_has_all_sections():
    bp = plan_product("build a landing page for a fintech startup").blueprint
    assert isinstance(bp, ProductBlueprint)
    assert bp.purpose and bp.audience and bp.business_goal
    assert bp.core_features and bp.screens
    assert bp.information_architecture and bp.interaction_model
    assert bp.data_model and bp.ux_direction and bp.visual_direction
    assert bp.recommended_renderer == "html"
    assert bp.future_expansion and bp.risk_analysis and bp.success_metrics


def test_blueprint_is_renderer_independent():
    # The engine never imports a renderer; recommended_renderer is a plain
    # string hint that differs per workspace.
    assert plan_product("write a research report with sources").blueprint.recommended_renderer == "document"
    assert plan_product("make a 2D arcade game").blueprint.recommended_renderer == "simulation"
    assert plan_product("a trading dashboard with signals").blueprint.recommended_renderer == "dashboard"


# ── Agent planning (planning only) ────────────────────────────────────────

def test_agent_plan_is_recommendation_only():
    bp = plan_product("an online store selling shoes with checkout and payments").blueprint
    ids = [a.agent_id for a in bp.recommended_agents]
    assert "merchandiser" in ids                 # core ecommerce role
    assert "security_engineer" in ids            # payments → security review
    # recommendations carry role + reason; nothing is executed
    for a in bp.recommended_agents:
        assert a.role and a.responsibility
        assert 1 <= a.priority <= 9


def test_complex_build_adds_qa():
    bp = plan_product(
        "enterprise web app with auth, database, api and admin dashboard"
    ).blueprint
    assert "qa_engineer" in [a.agent_id for a in bp.recommended_agents]


# ── Serialization ─────────────────────────────────────────────────────────

def test_plan_is_json_serializable():
    plan = plan_product("build a landing page for a startup")
    d = plan.to_dict()
    # round-trips through JSON without custom encoders
    s = json.dumps(d)
    back = json.loads(s)
    assert back["intent"]["workspace"] == "website_app"
    assert back["blueprint"]["recommended_renderer"] == "html"
    assert back["schema_version"] == "1.0"
    assert isinstance(back["blueprint"]["recommended_agents"], list)


# ── Extensibility: add a future workspace WITHOUT touching existing code ──

def test_future_workspace_extensibility(monkeypatch):
    """A new workspace can be added purely by registering a profile — the
    classifier/intent/blueprint all pick it up with no code changes."""
    from backend.services.product_intelligence import (
        register_workspace, WorkspaceProfile,
    )
    from backend.services.product_intelligence import registry as _registry
    from backend.services.product_intelligence.types import (
        ProductCategory, GenerationMode, InteractionStyle,
    )

    # Use a real enum member not used by a builtin profile to prove a brand
    # new vertical slots in (GENERAL is unregistered by default).
    profile = WorkspaceProfile(
        kind=WorkspaceKind.GENERAL,
        title="Music Studio",
        keywords={"music studio": 5.0, "compose a song": 5.0, "midi": 3.0},
        default_category=ProductCategory.CONTENT,
        default_renderer="audio",
        default_generation_mode=GenerationMode.SIMULATION,
        default_interaction=InteractionStyle.INTERACTIVE,
        base_agents=["composer"],
        feature_hints=["Track editor", "Instrument library"],
        screen_hints=["Studio"],
        information_architecture=["Studio → tracks → export"],
        interaction_model="Real-time audio editing",
        data_entities=["Track", "Instrument"],
        ux_direction="Creative, low-latency",
        visual_direction="Dark studio UI",
        deliverables=["Studio blueprint"],
    )
    try:
        register_workspace(profile)
        plan = plan_product("open a music studio to compose a song with midi")
        assert plan.intent.workspace is WorkspaceKind.GENERAL
        assert plan.blueprint.recommended_renderer == "audio"
        assert "composer" in [a.agent_id for a in plan.blueprint.recommended_agents]
        assert "Track editor" in plan.blueprint.core_features
    finally:
        # Clean up so we don't leak the test workspace into other tests.
        _registry._REGISTRY.pop(WorkspaceKind.GENERAL, None)


# ── HTTP route (gated) ────────────────────────────────────────────────────

@pytest.fixture
def intel_app(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.routes import v2_intelligence
    # Patch the settings object the ROUTE module references — other tests in
    # the suite reload backend.core.config, so a fresh import can be a
    # different object than the one the route bound at import time.
    monkeypatch.setattr(v2_intelligence.settings, "ENABLE_PRODUCT_INTELLIGENCE", True)
    app = FastAPI(); app.include_router(v2_intelligence.router)
    return TestClient(app)


def test_route_plan_returns_blueprint(intel_app):
    r = intel_app.post("/v2/intelligence/plan",
                       json={"text": "build a trading dashboard with crypto signals"})
    assert r.status_code == 200
    plan = r.json()["plan"]
    assert plan["intent"]["workspace"] == "trading"
    assert plan["blueprint"]["recommended_renderer"] == "dashboard"


def test_route_disabled_returns_503(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.routes import v2_intelligence
    monkeypatch.setattr(v2_intelligence.settings, "ENABLE_PRODUCT_INTELLIGENCE", False)
    app = FastAPI(); app.include_router(v2_intelligence.router)
    c = TestClient(app)
    assert c.post("/v2/intelligence/plan", json={"text": "x"}).status_code == 503
    # health is always callable
    assert c.get("/v2/intelligence/health").status_code == 200
