# coding: utf-8
"""/v2/recreate — Phase 8 website recreation."""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Path
from pydantic import BaseModel, Field

from backend.core.deps import current_user
from backend.core.responses import ok as envelope_ok
from backend.services.auth.identity import User
from backend.services.billing.entitlements import gating
from backend.services.billing.usage import service as usage
from backend.services.billing.usage.enforcement import require_quota
from backend.services.website_recreation import client as rc_client
from backend.services.vision import client as vision_client


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v2/recreate", tags=["recreate-v2"])


def _ensure_enabled() -> None:
    if not os.getenv("ENABLE_WEBSITE_RECREATION", "false").strip().lower() == "true":
        raise HTTPException(
            status_code=503,
            detail={"code": "WEBSITE_RECREATION_DISABLED",
                    "message": "Website recreation is disabled. Set ENABLE_WEBSITE_RECREATION=true.",
                    "rollback": "Unset ENABLE_WEBSITE_RECREATION to disable."},
        )


class AnalyzeBody(BaseModel):
    asset_id:    str = Field(..., min_length=1, max_length=128)
    user_prompt: Optional[str] = Field(None, max_length=2000)


@router.post(
    "/analyze",
    dependencies=[
        Depends(gating.require_feature(gating.FEATURE_WEBSITE_RECREATION)),
        Depends(require_quota(usage.METRIC_WEBSITE_RECREATIONS)),
    ],
)
def analyze_design(
    body: AnalyzeBody,
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    """Produce a structured rebuild plan from a screenshot asset."""
    _ensure_enabled()
    result = rc_client.analyze(
        asset_id=body.asset_id, user_id=user.id,
        user_prompt=body.user_prompt,
    )
    if result is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "RECREATION_ASSET_MISSING",
                    "message": "asset not found or recreation disabled"},
        )
    return envelope_ok(
        data={"recreation": result.to_dict()},
        endpoint="/v2/recreate/analyze",
        user_id=user.id,
    )


@router.get("/{asset_id}")
def get_recreation(
    asset_id: str = Path(..., max_length=128),
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    """Return a fresh recreation result for an asset. Phase 8 recreation
    is heuristic-only and cheap to recompute, so we don't yet cache —
    a recreation cache lands when the LLM-driven path is wired."""
    _ensure_enabled()
    result = rc_client.analyze(asset_id=asset_id, user_id=user.id)
    if result is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "RECREATION_ASSET_MISSING",
                    "message": "asset not found or recreation disabled"},
        )
    return envelope_ok(
        data={"recreation": result.to_dict()},
        endpoint=f"/v2/recreate/{asset_id}",
        user_id=user.id,
    )


__all__ = ["router"]
