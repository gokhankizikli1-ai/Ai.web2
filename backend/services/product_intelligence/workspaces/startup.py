# coding: utf-8
"""Startup Intelligence workspace profile (planning only — no implementation)."""
from backend.services.product_intelligence.registry import WorkspaceProfile, register_workspace
from backend.services.product_intelligence.types import (
    WorkspaceKind, ProductCategory, GenerationMode, InteractionStyle,
)

PROFILE = WorkspaceProfile(
    kind=WorkspaceKind.STARTUP,
    title="Startup Intelligence",
    keywords={
        "startup": 1.3, "business plan": 1.3, "pitch deck": 1.3, "pitch": 0.9,
        "investor": 1.0, "fundraising": 1.1, "go to market": 1.1, "gtm": 1.0,
        "market analysis": 1.1, "business model": 1.1, "mvp": 0.9,
        "competitor analysis": 1.0, "validate": 0.7, "founder": 0.9,
        "revenue model": 1.0, "tam": 0.9, "saas business": 0.9,
    },
    patterns=[
        (r"\b(start|launch|found)\s+(a|my)?\s*(startup|company|business)", 1.3),
        (r"\b(business|revenue|pricing)\s+model\b", 1.1),
    ],
    default_category=ProductCategory.BUSINESS_PLAN,
    default_renderer="document",
    default_generation_mode=GenerationMode.DOCUMENT,
    default_interaction=InteractionStyle.STATIC,
    typical_industry="varies",
    typical_audience="founders / investors",
    typical_goal="validate and plan a venture",
    base_agents=["startup_analyst", "researcher", "product_strategist"],
    feature_hints=[
        "Problem & solution framing", "Market sizing (TAM/SAM/SOM)",
        "Business model", "Competitive landscape", "Go-to-market plan",
        "Financial outline",
    ],
    screen_hints=["Executive summary", "Market", "Product", "Business model", "GTM", "Financials"],
    information_architecture=[
        "Summary → problem → solution → market → model → GTM → financials → ask",
    ],
    interaction_model="Read-through strategic document with structured sections.",
    data_entities=["Segment", "Competitor", "Channel", "Revenue stream"],
    ux_direction="Concise, evidence-led, skimmable for investors.",
    visual_direction="Professional, data-forward, minimal.",
    risks=[
        "Unvalidated assumptions presented as facts",
        "Market sizing without sources",
    ],
    success_metrics=["Assumptions validated", "Clarity of differentiation", "GTM feasibility"],
    deliverables=["Business plan blueprint", "Market & competitor outline", "GTM plan"],
    future_expansion=["Live market data", "Financial model spreadsheet", "Pitch-deck export"],
)

register_workspace(PROFILE)
