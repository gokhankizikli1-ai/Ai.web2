# coding: utf-8
"""
Agent planner — decides WHICH agents should participate. Planning only; this
module NEVER executes an agent. Output is a list of AgentRecommendation that a
future orchestration layer can consume.

The agent roster is data (AGENT_CATALOG), and the plan is the workspace's
base agents + context-driven additions. No switch statements.
"""
from __future__ import annotations

from typing import Dict, List

from backend.services.product_intelligence.registry import get_workspace
from backend.services.product_intelligence.types import (
    ProductIntent, AgentRecommendation, Complexity,
)

# agent_id → (role, responsibility, default priority)
AGENT_CATALOG: Dict[str, tuple] = {
    "researcher":        ("Research Agent", "Gather and synthesise grounded context", 1),
    "startup_analyst":   ("Startup Analyst", "Market sizing, business model, GTM", 2),
    "product_strategist":("Product Strategist", "Define scope, features and priorities", 2),
    "ux_designer":       ("UX Designer", "Information architecture and interaction design", 3),
    "brand_designer":    ("Brand Designer", "Visual direction and identity", 3),
    "copywriter":        ("Copywriter", "Product copy and messaging", 4),
    "frontend_engineer": ("Frontend Engineer", "Build the interface / prototype", 5),
    "backend_engineer":  ("Backend Engineer", "Data model, APIs, persistence", 5),
    "merchandiser":      ("Merchandiser", "Catalog, pricing and merchandising", 4),
    "game_designer":     ("Game Designer", "Mechanics, loop and progression", 2),
    "game_developer":    ("Game Developer", "Implement the game loop and state", 5),
    "market_scanner":    ("Market Scanner", "Pull live market data and watchlists", 2),
    "trading_analyst":   ("Trading Analyst", "Signals, indicators and theses", 3),
    "risk_officer":      ("Risk Officer", "Risk limits and validation", 4),
    "reporter":          ("Reporter", "Compose the briefing / report", 6),
    "analyst":           ("Analyst", "Analyse findings and draw conclusions", 4),
    "qa_engineer":       ("QA Engineer", "Validate behaviour and quality", 7),
    "security_engineer": ("Security Engineer", "Auth, authz and data-safety review", 6),
}


def _rec(agent_id: str, reason: str, priority_override: int | None = None) -> AgentRecommendation:
    role, responsibility, default_priority = AGENT_CATALOG.get(
        agent_id, (agent_id.replace("_", " ").title(), "", 5),
    )
    return AgentRecommendation(
        agent_id=agent_id, role=role, responsibility=responsibility,
        priority=priority_override if priority_override is not None else default_priority,
        reason=reason,
    )


def plan_agents(intent: ProductIntent) -> List[AgentRecommendation]:
    """Recommend the agent panel for an intent. Deterministic + additive."""
    profile = get_workspace(intent.workspace)
    chosen: Dict[str, AgentRecommendation] = {}

    # 1) Base panel from the workspace profile.
    if profile:
        for aid in profile.base_agents:
            chosen[aid] = _rec(aid, reason=f"core {profile.title} role")

    # 2) Context-driven additions (data-derived, not hardcoded per workspace).
    tech = intent.technical_context or ""
    if any(k in tech for k in ("authentication", "payments")):
        chosen.setdefault("security_engineer",
                          _rec("security_engineer", "auth/payments present → security review"))
    if any(k in tech for k in ("database", "api")):
        chosen.setdefault("backend_engineer",
                          _rec("backend_engineer", "data model / API surface required"))
    if intent.business_context:
        chosen.setdefault("product_strategist",
                          _rec("product_strategist", "business context needs scoping"))

    # 3) Complexity escalation → always QA on complex+ builds.
    if intent.complexity in (Complexity.COMPLEX, Complexity.ADVANCED):
        chosen.setdefault("qa_engineer", _rec("qa_engineer", "complex build → QA pass"))

    # 4) Always ensure SOMEONE plans when nothing matched.
    if not chosen:
        chosen["product_strategist"] = _rec("product_strategist", "fallback planner")

    return sorted(chosen.values(), key=lambda r: (r.priority, r.agent_id))


__all__ = ["plan_agents", "AGENT_CATALOG"]
