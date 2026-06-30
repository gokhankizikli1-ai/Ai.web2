# coding: utf-8
"""
Universal Product Intelligence — typed models.

KorvixAI is an AI Operating System, not a template generator. Every
generation begins by UNDERSTANDING intent. These models are the shared
contract that turns natural language into a structured plan that EVERY
future module (Website/App builder, Startup, Ecommerce, Trading, Research,
Game Dev, Agents) consumes — so no module invents its own interpretation
logic.

Strongly typed, renderer-independent, JSON-serializable. Nothing here
imports a renderer, a provider, or a builder.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple


# ── Enumerations ──────────────────────────────────────────────────────────

class WorkspaceKind(str, Enum):
    """The product vertical a request belongs to. Extensible: add a value +
    register a WorkspaceProfile; no existing code changes."""
    WEBSITE_APP = "website_app"
    STARTUP = "startup"
    ECOMMERCE = "ecommerce"
    TRADING = "trading"
    RESEARCH = "research"
    GAME = "game"
    PRODUCTIVITY = "productivity"
    GENERAL = "general"          # recognised but non-specific
    UNKNOWN = "unknown"          # could not classify with confidence


class ProductCategory(str, Enum):
    MARKETING_SITE = "marketing_site"
    WEB_APP = "web_app"
    MOBILE_APP = "mobile_app"
    DASHBOARD = "dashboard"
    STORE = "store"
    GAME = "game"
    RESEARCH_REPORT = "research_report"
    BUSINESS_PLAN = "business_plan"
    TRADING_SYSTEM = "trading_system"
    AUTOMATION = "automation"
    CONTENT = "content"
    OTHER = "other"


class Complexity(str, Enum):
    SIMPLE = "simple"          # single screen / one concern
    MODERATE = "moderate"      # a few screens, light data
    COMPLEX = "complex"        # multi-screen, real data model
    ADVANCED = "advanced"      # multi-system, integrations, scale


class GenerationMode(str, Enum):
    PROTOTYPE = "prototype"            # quick clickable preview
    STATIC_SITE = "static_site"       # informational, low interactivity
    INTERACTIVE_APP = "interactive_app"
    DOCUMENT = "document"             # report / plan / brief
    ANALYSIS = "analysis"            # data analysis / signals
    SIMULATION = "simulation"        # game / interactive sim


class InteractionStyle(str, Enum):
    STATIC = "static"
    INTERACTIVE = "interactive"
    CONVERSATIONAL = "conversational"
    REALTIME = "realtime"
    DATA_DRIVEN = "data_driven"


# ── ProductIntent ─────────────────────────────────────────────────────────

@dataclass
class WorkspaceScore:
    workspace: WorkspaceKind
    confidence: float                 # 0..1
    matched_signals: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "workspace": self.workspace.value,
            "confidence": round(self.confidence, 4),
            "matched_signals": self.matched_signals,
        }


@dataclass
class WorkspaceClassification:
    """Confidence-based, multi-intent classification result."""
    primary: WorkspaceKind
    confidence: float
    scores: List[WorkspaceScore] = field(default_factory=list)

    @property
    def secondary(self) -> List[WorkspaceScore]:
        return [s for s in self.scores if s.workspace != self.primary and s.confidence > 0]

    def is_multi_intent(self, threshold: float = 0.25) -> bool:
        strong = [s for s in self.scores if s.confidence >= threshold]
        return len(strong) >= 2

    def to_dict(self) -> dict:
        return {
            "primary": self.primary.value,
            "confidence": round(self.confidence, 4),
            "multi_intent": self.is_multi_intent(),
            "scores": [s.to_dict() for s in self.scores],
        }


@dataclass
class ProductIntent:
    """Structured understanding of WHAT the user wants — before anything is
    built. The universal input every downstream module consumes."""
    raw_text: str
    workspace: WorkspaceKind
    product_category: ProductCategory
    product_type: str
    industry: str
    audience: str
    primary_goal: str
    complexity: Complexity
    generation_mode: GenerationMode
    interaction_style: InteractionStyle
    business_context: str
    technical_context: str
    expected_deliverables: List[str] = field(default_factory=list)
    confidence: float = 0.0
    classification: Optional[WorkspaceClassification] = None
    signals: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "raw_text": self.raw_text,
            "workspace": self.workspace.value,
            "product_category": self.product_category.value,
            "product_type": self.product_type,
            "industry": self.industry,
            "audience": self.audience,
            "primary_goal": self.primary_goal,
            "complexity": self.complexity.value,
            "generation_mode": self.generation_mode.value,
            "interaction_style": self.interaction_style.value,
            "business_context": self.business_context,
            "technical_context": self.technical_context,
            "expected_deliverables": list(self.expected_deliverables),
            "confidence": round(self.confidence, 4),
            "classification": self.classification.to_dict() if self.classification else None,
            "signals": self.signals,
        }


# ── Agent planning (planning ONLY — never executed here) ──────────────────

@dataclass
class AgentRecommendation:
    agent_id: str
    role: str
    responsibility: str
    priority: int = 5                 # 1 (first) .. 9 (later)
    reason: str = ""

    def to_dict(self) -> dict:
        return {
            "agent_id": self.agent_id,
            "role": self.role,
            "responsibility": self.responsibility,
            "priority": self.priority,
            "reason": self.reason,
        }


# ── ProductBlueprint ──────────────────────────────────────────────────────

@dataclass
class ProductBlueprint:
    """A complete, renderer-INDEPENDENT plan of what should be built. Any
    module (website builder, game dev, startup, research, trading) can
    consume this without knowing how the others render it."""
    workspace: WorkspaceKind
    purpose: str
    audience: str
    business_goal: str
    core_features: List[str] = field(default_factory=list)
    screens: List[str] = field(default_factory=list)
    information_architecture: List[str] = field(default_factory=list)
    interaction_model: str = ""
    data_model: List[str] = field(default_factory=list)
    ux_direction: str = ""
    visual_direction: str = ""
    recommended_agents: List[AgentRecommendation] = field(default_factory=list)
    recommended_renderer: str = "none"
    future_expansion: List[str] = field(default_factory=list)
    risk_analysis: List[str] = field(default_factory=list)
    success_metrics: List[str] = field(default_factory=list)
    intent: Optional[ProductIntent] = None

    def to_dict(self) -> dict:
        return {
            "workspace": self.workspace.value,
            "purpose": self.purpose,
            "audience": self.audience,
            "business_goal": self.business_goal,
            "core_features": list(self.core_features),
            "screens": list(self.screens),
            "information_architecture": list(self.information_architecture),
            "interaction_model": self.interaction_model,
            "data_model": list(self.data_model),
            "ux_direction": self.ux_direction,
            "visual_direction": self.visual_direction,
            "recommended_agents": [a.to_dict() for a in self.recommended_agents],
            "recommended_renderer": self.recommended_renderer,
            "future_expansion": list(self.future_expansion),
            "risk_analysis": list(self.risk_analysis),
            "success_metrics": list(self.success_metrics),
            "intent": self.intent.to_dict() if self.intent else None,
        }


# ── ProductPlan (engine output) ───────────────────────────────────────────

PLAN_SCHEMA_VERSION = "1.0"


@dataclass
class ProductPlan:
    """The full output of the intelligence engine: the understanding
    (intent) + the plan (blueprint). This is the stable artifact every
    future module consumes."""
    intent: ProductIntent
    blueprint: ProductBlueprint
    schema_version: str = PLAN_SCHEMA_VERSION
    planner: str = "heuristic-v1"      # seam for a future LLM-backed planner

    def to_dict(self) -> dict:
        return {
            "schema_version": self.schema_version,
            "planner": self.planner,
            "intent": self.intent.to_dict(),
            "blueprint": self.blueprint.to_dict(),
        }


__all__ = [
    "WorkspaceKind", "ProductCategory", "Complexity", "GenerationMode",
    "InteractionStyle", "WorkspaceScore", "WorkspaceClassification",
    "ProductIntent", "AgentRecommendation", "ProductBlueprint",
    "ProductPlan", "PLAN_SCHEMA_VERSION",
]
