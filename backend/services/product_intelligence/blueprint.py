# coding: utf-8
"""
Blueprint builder — ProductIntent → ProductBlueprint.

Renderer-INDEPENDENT. The builder seeds the blueprint from the matched
workspace profile (so each vertical contributes its own structure without a
switch statement) and personalises purpose/audience/goal from the intent.
The result is a complete plan any future module can consume — the website
builder, game dev, startup, research, trading — without depending on each
other.
"""
from __future__ import annotations

from backend.services.product_intelligence.agents import plan_agents
from backend.services.product_intelligence.registry import get_workspace
from backend.services.product_intelligence.types import (
    ProductIntent, ProductBlueprint, WorkspaceKind,
)


def _truncate(text: str, n: int = 160) -> str:
    text = (text or "").strip()
    return text if len(text) <= n else text[: n - 1].rstrip() + "…"


def build_blueprint(intent: ProductIntent) -> ProductBlueprint:
    """Assemble a complete, renderer-independent blueprint for an intent."""
    profile = get_workspace(intent.workspace)

    # Purpose/goal/audience are personalised from the intent; everything
    # structural is seeded from the workspace profile (or generic fallbacks).
    purpose = (
        f"Deliver a {profile.title.lower()} solution"
        if profile else "Deliver the requested product"
    )
    if intent.raw_text:
        purpose = f"{purpose} for: \"{_truncate(intent.raw_text)}\""

    if profile:
        bp = ProductBlueprint(
            workspace=intent.workspace,
            purpose=purpose,
            audience=intent.audience,
            business_goal=intent.primary_goal,
            core_features=list(profile.feature_hints),
            screens=list(profile.screen_hints),
            information_architecture=list(profile.information_architecture),
            interaction_model=profile.interaction_model,
            data_model=list(profile.data_entities),
            ux_direction=profile.ux_direction,
            visual_direction=profile.visual_direction,
            recommended_renderer=profile.default_renderer,
            future_expansion=list(profile.future_expansion),
            risk_analysis=list(profile.risks),
            success_metrics=list(profile.success_metrics),
            intent=intent,
        )
    else:
        # UNKNOWN / GENERAL — produce an honest, minimal scaffold rather than
        # inventing a vertical. The caller can ask the user to clarify.
        bp = ProductBlueprint(
            workspace=intent.workspace,
            purpose=purpose,
            audience=intent.audience,
            business_goal=intent.primary_goal,
            core_features=["Clarify the primary outcome", "Identify the target user"],
            screens=[],
            information_architecture=["To be determined after clarifying the goal"],
            interaction_model="To be determined",
            data_model=[],
            ux_direction="Pending clarification of the product direction",
            visual_direction="Pending",
            recommended_renderer="none",
            future_expansion=[],
            risk_analysis=["Request is ambiguous — clarify before building"],
            success_metrics=["A clear, classifiable product goal is established"],
            intent=intent,
        )

    bp.recommended_agents = plan_agents(intent)
    return bp


__all__ = ["build_blueprint"]
