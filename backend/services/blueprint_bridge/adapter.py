# coding: utf-8
"""
Adapter — ProductBlueprint → OrchestrationRequest.

Pure, deterministic mapping. The ONLY place that knows how a product
workspace maps onto an orchestrator template lives here (as data), so the
orchestrator never hardcodes verticals and product_intelligence never knows
the orchestrator exists.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from backend.services.blueprint_bridge.types import OrchestrationRequest
from backend.services.product_intelligence.types import (
    ProductBlueprint, WorkspaceKind,
)

# Workspace → preferred existing orchestrator template id. These are EXISTING
# templates (no new vertical templates are created by this sprint). When the
# preferred template is unavailable (e.g. landing_page gated off) or the
# workspace is unknown, the adapter falls back to None and lets the
# orchestrator pick from the preserved user_request.
_WORKSPACE_TEMPLATE: Dict[WorkspaceKind, str] = {
    WorkspaceKind.WEBSITE_APP:  "landing_page",     # falls back to app_prototype if gated
    WorkspaceKind.ECOMMERCE:    "landing_page",
    WorkspaceKind.GAME:         "app_prototype",
    WorkspaceKind.PRODUCTIVITY: "app_prototype",
    WorkspaceKind.TRADING:      "app_prototype",
    WorkspaceKind.STARTUP:      "generic_research",
    WorkspaceKind.RESEARCH:     "generic_research",
    # GENERAL / UNKNOWN → None (let the orchestrator choose).
}
_TEMPLATE_FALLBACK = "app_prototype"


def _resolve_suggested_template(workspace: WorkspaceKind) -> Optional[str]:
    """Best-effort template id for a workspace, honouring availability.

    Uses the orchestrator's OWN catalog to check whether the preferred
    template exists/enabled — it never invents a template. Returns None when
    no suitable template is available so the orchestrator decides.
    """
    preferred = _WORKSPACE_TEMPLATE.get(workspace)
    if preferred is None:
        return None
    try:
        from backend.services.orchestrator.templates import catalog
        if catalog.get_template(preferred) is not None:
            return preferred
        # Preferred is gated off / missing → try the always-on fallback.
        if catalog.get_template(_TEMPLATE_FALLBACK) is not None:
            return _TEMPLATE_FALLBACK
    except Exception:  # pragma: no cover — defensive; let orchestrator choose
        return None
    return None


def blueprint_to_request(
    blueprint: ProductBlueprint,
    *,
    user_request: str,
    project_id: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> OrchestrationRequest:
    """Convert a ProductBlueprint into an orchestrator-ready request.

    Preserves: the original prompt, workspace, product category, audience,
    core features, recommended agents, deliverables, renderer, complexity,
    risks and success metrics.
    """
    intent = blueprint.intent
    complexity = intent.complexity.value if intent else "moderate"
    category = intent.product_category.value if intent else "other"

    return OrchestrationRequest(
        user_request=user_request,
        workspace=blueprint.workspace.value,
        product_category=category,
        audience=blueprint.audience,
        complexity=complexity,
        recommended_renderer=blueprint.recommended_renderer,
        core_features=list(blueprint.core_features),
        recommended_agents=[a.agent_id for a in blueprint.recommended_agents],
        recommended_deliverables=(
            list(intent.expected_deliverables) if intent else []
        ),
        risk_analysis=list(blueprint.risk_analysis),
        success_metrics=list(blueprint.success_metrics),
        suggested_template_id=_resolve_suggested_template(blueprint.workspace),
        project_id=project_id,
        metadata=dict(metadata or {}),
    )


__all__ = ["blueprint_to_request"]
