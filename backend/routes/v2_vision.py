# coding: utf-8
"""/v2/assets/{id}/analyze + /v2/assets/{id}/analysis — Phase 8 vision."""
from __future__ import annotations

import logging
import os
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, Path

from backend.core.deps import current_user
from backend.core.responses import ok as envelope_ok
from backend.services.assets import client as assets_client
from backend.services.auth.identity import User
from backend.services.billing.entitlements import gating
from backend.services.billing.usage import service as usage
from backend.services.billing.usage.enforcement import require_quota
from backend.services.vision import client as vision_client


logger = logging.getLogger(__name__)

# Mounted ALONGSIDE /v2/assets (separate file for readability) so the
# spec'd endpoint paths `/v2/assets/{id}/analyze` and
# `/v2/assets/{id}/analysis` land where the spec puts them.
router = APIRouter(prefix="/v2/assets", tags=["vision-v2"])


def _assets_disabled_503() -> HTTPException:
    return HTTPException(
        status_code=503,
        detail={"code": "ASSET_SYSTEM_DISABLED",
                "message": "Asset system is disabled. Set ENABLE_ASSET_SYSTEM=true."},
    )


def _assets_enabled() -> bool:
    return os.getenv("ENABLE_ASSET_SYSTEM", "false").strip().lower() == "true"


@router.post(
    "/{asset_id}/analyze",
    dependencies=[
        Depends(gating.require_feature(gating.FEATURE_VISION_ANALYSIS)),
        Depends(require_quota(usage.METRIC_VISION_ANALYSES)),
    ],
)
def analyze_asset(
    asset_id: str = Path(..., max_length=128),
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    """Trigger or refresh analysis for one asset. Returns the structured
    AnalysisResult. When the vision pipeline is disabled OR the asset
    is missing, returns a structured response (not a crash)."""
    if not _assets_enabled():
        raise _assets_disabled_503()
    rec = assets_client.get(asset_id, user_id=user.id)
    if rec is None:
        raise HTTPException(status_code=404,
                            detail={"code": "ASSET_NOT_FOUND",
                                    "message": "asset not found"})
    result = vision_client.analyze(asset_id, user_id=user.id, force=True)
    if result is None:
        # Vision pipeline disabled OR analyzer returned no result.
        # Return a 200 with `disabled=True` so the FE shows a clear
        # "analysis pipeline disabled" state rather than 503-ing the
        # whole asset interaction.
        return envelope_ok(
            data={
                "analysis": None,
                "disabled": not vision_client.is_enabled(),
                "asset":    rec.to_dict(),
            },
            endpoint=f"/v2/assets/{asset_id}/analyze",
            user_id=user.id,
        )
    return envelope_ok(
        data={"analysis": result.to_dict(), "asset": rec.to_dict()},
        endpoint=f"/v2/assets/{asset_id}/analyze",
        user_id=user.id,
    )


@router.get("/{asset_id}/analysis")
def get_analysis(
    asset_id: str = Path(..., max_length=128),
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    """Return the cached analysis. 404 when no analysis has been run.
    Read-only — does NOT trigger the analyzer."""
    if not _assets_enabled():
        raise _assets_disabled_503()
    rec = assets_client.get(asset_id, user_id=user.id)
    if rec is None:
        raise HTTPException(status_code=404,
                            detail={"code": "ASSET_NOT_FOUND",
                                    "message": "asset not found"})
    cached = vision_client.get_cached(asset_id)
    if cached is None:
        raise HTTPException(status_code=404,
                            detail={"code": "ANALYSIS_NOT_FOUND",
                                    "message": "no analysis stored for this asset"})
    return envelope_ok(
        data={"analysis": cached, "asset": rec.to_dict()},
        endpoint=f"/v2/assets/{asset_id}/analysis",
        user_id=user.id,
    )


__all__ = ["router"]
