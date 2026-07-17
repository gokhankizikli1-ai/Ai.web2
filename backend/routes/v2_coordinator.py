# coding: utf-8
"""/v2/coordinator — Phase 9 plan-preview endpoint.

Stateless: takes a user message + optional asset hints and returns the
Coordinator's Plan (which agent(s) to invoke and why). DOES NOT
execute any agents — that's a follow-up PR. The FE renders the plan
as a small preview chip the user can dismiss or proceed with.

Behind ENABLE_COORDINATOR. Default off so this PR ships dark.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from backend.core.deps import current_user
from backend.core.responses import ok as envelope_ok
from backend.services.auth.identity import User
from backend.services.coordinator import coordinator, is_enabled


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v2", tags=["coordinator-v2"])


def _ensure_enabled() -> None:
    """A DISABLED feature is a persistent configuration state, NOT a temporary
    server outage — it must map to 409 (canonical "not enabled"), never 503.
    Returning 503 here made a flag-off endpoint look like "AI temporarily busy"
    in Railway HTTP logs (POST /v2/coordinator/plan → 503) and to any client that
    treats 503 as a retryable outage. The coordinator is a pure in-process
    rule-based planner with NO external dependency (no Redis/provider/DB/LLM), so
    it has no legitimate temporary-unavailability mode at all."""
    if not is_enabled():
        raise HTTPException(
            status_code=409,
            detail={
                "code":     "COORDINATOR_DISABLED",
                "message":  "Coordinator is not enabled on this deployment.",
                "rollback": "Set ENABLE_COORDINATOR=true to enable.",
            },
        )


class PlanBody(BaseModel):
    message:          str = Field(..., min_length=0, max_length=16_000)
    project_id:       Optional[str] = Field(None, max_length=64)
    # Mime types of any attachments the user has already uploaded. Used
    # by the asset-driven rules (image → UX, doc → researcher). Empty /
    # absent = text-only request.
    asset_mime_types: Optional[List[str]] = Field(None, max_length=20)


class ClassifyBody(BaseModel):
    """Phase 9 part 2 — fast complexity probe. Returns a tiny dict the
    FE uses to decide whether to render the panel-spawn affordance.
    Cheaper than /plan; no agent ids are returned."""
    message:          str = Field(..., min_length=0, max_length=16_000)
    asset_mime_types: Optional[List[str]] = Field(None, max_length=20)


@router.post("/coordinator/plan")
def build_plan(
    body: PlanBody,
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    """Return the Coordinator's plan for this request.

    Stateless, fast (no LLM call, no DB read). Always returns a
    well-formed Plan — even when no rule fires we surface a single
    supervisor invocation with a clear reason so the FE can show
    "no specialist needed" rather than a blank state.
    """
    _ensure_enabled()
    try:
        plan = coordinator.analyze(
            user_message=     body.message,
            project_id=       body.project_id,
            asset_mime_types= body.asset_mime_types,
        )
    except HTTPException:
        raise
    except Exception as exc:
        # A bug in the pure rule-based planner is an internal error (bounded 500),
        # NOT a temporary outage — never dress it up as 503 "busy". No prompt,
        # payload or trace is returned.
        logger.warning("coordinator.plan | uid=%s | internal_error=%s", user.id, type(exc).__name__)
        raise HTTPException(
            status_code=500,
            detail={"code": "COORDINATOR_ERROR", "message": "Coordinator plan failed."},
        )
    logger.info(
        "coordinator.plan | uid=%s | intent=%s | confidence=%.2f | agents=%d | method=%s",
        user.id, plan.intent, plan.confidence, len(plan.agents), plan.routing_method,
    )
    return envelope_ok(
        data={"plan": plan.to_dict()},
        endpoint="/v2/coordinator/plan",
        user_id=user.id,
    )


@router.post("/coordinator/classify")
def classify(
    body: ClassifyBody,
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    """Cheap complexity probe used by the FE to decide whether to
    offer the "spawn panel" affordance. Pure rule-based, no LLM call,
    no DB read."""
    _ensure_enabled()
    result = coordinator.classify(
        user_message=     body.message,
        asset_mime_types= body.asset_mime_types,
    )
    logger.info(
        "coordinator.classify | uid=%s | complexity=%s | should_spawn=%s | "
        "triggers=%d",
        user.id, result["complexity"], result["should_spawn_panel"],
        len(result.get("triggers", [])),
    )
    return envelope_ok(
        data={"classification": result},
        endpoint="/v2/coordinator/classify",
        user_id=user.id,
    )


__all__ = ["router"]
