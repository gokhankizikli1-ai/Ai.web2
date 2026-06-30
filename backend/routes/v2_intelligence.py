# coding: utf-8
"""
Sprint 1.3 — Universal Product Intelligence HTTP surface.

Thin wrapper over backend.services.product_intelligence. The engine is a pure
library that other modules import directly; this route just exposes it over
HTTP for the frontend and external consumers. Gated by
ENABLE_PRODUCT_INTELLIGENCE (default off → 503). Planning is stateless and
non-sensitive, so it's guest-allowed (identity is resolved for audit/quotas
but no resource ownership is involved).
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Request, Depends
from pydantic import BaseModel, Field

from backend.core.config import settings
from backend.core.deps import current_user
from backend.services.auth.identity import User

router = APIRouter(prefix="/v2/intelligence", tags=["intelligence"])
logger = logging.getLogger(__name__)


def _ensure_enabled() -> None:
    if not settings.ENABLE_PRODUCT_INTELLIGENCE:
        raise HTTPException(
            status_code=503,
            detail={
                "error": "product_intelligence_disabled",
                "message": "Product Intelligence is disabled. Set ENABLE_PRODUCT_INTELLIGENCE=true.",
                "rollback": "Unset ENABLE_PRODUCT_INTELLIGENCE (or set 'false') to disable again.",
            },
        )


class PlanBody(BaseModel):
    text: str = Field(..., min_length=1, max_length=8000)


@router.get("/health")
def intelligence_health() -> dict:
    """Always callable — reports flag state + registered workspaces."""
    enabled = settings.ENABLE_PRODUCT_INTELLIGENCE
    workspaces: list = []
    try:
        from backend.services.product_intelligence import registered_kinds
        workspaces = [k.value for k in registered_kinds()]
    except Exception as exc:  # pragma: no cover — defensive
        logger.warning("intelligence health: registry unavailable: %s", exc)
    return {
        "enabled": enabled,
        "phase": "1.3 — universal product intelligence",
        "workspaces": workspaces,
    }


@router.get("/workspaces")
def list_workspaces(user: User = Depends(current_user)) -> dict:
    _ensure_enabled()
    from backend.services.product_intelligence import all_workspaces
    return {
        "workspaces": [
            {
                "kind": p.kind.value,
                "title": p.title,
                "default_renderer": p.default_renderer,
                "base_agents": p.base_agents,
            }
            for p in all_workspaces()
        ],
    }


@router.post("/classify")
def classify_route(body: PlanBody, user: User = Depends(current_user)) -> dict:
    _ensure_enabled()
    from backend.services.product_intelligence import classify
    return {"classification": classify(body.text).to_dict()}


@router.post("/plan")
def plan_route(body: PlanBody, user: User = Depends(current_user)) -> dict:
    """Natural language → ProductPlan (intent + blueprint). The artifact every
    future module consumes before building anything."""
    _ensure_enabled()
    from backend.services.product_intelligence import plan_product
    plan = plan_product(body.text)
    return {"plan": plan.to_dict()}


__all__ = ["router"]
