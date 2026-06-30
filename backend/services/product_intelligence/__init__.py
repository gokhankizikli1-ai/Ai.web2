# coding: utf-8
"""
Universal Product Intelligence Engine.

KorvixAI is an AI Operating System, not a template generator. Every
generation begins by understanding the user's intent. This package turns
natural language into a structured, renderer-INDEPENDENT ProductPlan
(ProductIntent + ProductBlueprint) that EVERY future module consumes —
Website/App builder, Startup, Ecommerce, Trading, Research, Game Dev,
Agents — so no module invents its own interpretation logic.

Public API:
    from backend.services.product_intelligence import plan_product
    plan = plan_product("build a landing page for a fintech startup")
    plan.blueprint.recommended_renderer  # "html"
    plan.blueprint.recommended_agents    # planned, NOT executed

Extensibility: add a workspace by dropping a module under `workspaces/`
that registers a WorkspaceProfile. No existing code changes.
"""
from backend.services.product_intelligence.engine import (
    plan_product, understand, blueprint, classify,
)
from backend.services.product_intelligence.types import (
    WorkspaceKind, ProductCategory, Complexity, GenerationMode,
    InteractionStyle, ProductIntent, ProductBlueprint, ProductPlan,
    WorkspaceClassification, AgentRecommendation, PLAN_SCHEMA_VERSION,
)
from backend.services.product_intelligence.registry import (
    register_workspace, all_workspaces, registered_kinds, WorkspaceProfile,
)

__all__ = [
    # pipeline
    "plan_product", "understand", "blueprint", "classify",
    # models
    "WorkspaceKind", "ProductCategory", "Complexity", "GenerationMode",
    "InteractionStyle", "ProductIntent", "ProductBlueprint", "ProductPlan",
    "WorkspaceClassification", "AgentRecommendation", "PLAN_SCHEMA_VERSION",
    # extensibility
    "register_workspace", "all_workspaces", "registered_kinds", "WorkspaceProfile",
]
