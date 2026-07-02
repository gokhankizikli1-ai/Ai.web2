# coding: utf-8
"""
Startup Market Intelligence — /v2/startup/* HTTP surface.

Thin wrapper over backend.services.startup_intelligence (the Market
Complaint Radar engine). Gated by ENABLE_STARTUP_MARKET_INTEL — the flag
is read dynamically on every request (tool_registry pattern) so flipping
it on Railway takes effect without a restart. Analysis is stateless and
non-sensitive, so it's guest-allowed (identity resolved for audit only).

Endpoints:
  GET  /v2/startup/market-complaints/health  — flag + per-source config state
  POST /v2/startup/market-complaints         — run the radar
"""
from __future__ import annotations

import logging
import os

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from backend.core.deps import current_user
from backend.services.auth.identity import User

router = APIRouter(prefix="/v2/startup", tags=["startup"])
logger = logging.getLogger(__name__)


def _enabled() -> bool:
    return os.getenv("ENABLE_STARTUP_MARKET_INTEL", "false").strip().lower() == "true"


def _ensure_enabled() -> None:
    if not _enabled():
        raise HTTPException(
            status_code=503,
            detail={
                "error": "startup_market_intel_disabled",
                "message": "Startup Market Intelligence is disabled. "
                           "Set ENABLE_STARTUP_MARKET_INTEL=true.",
                "rollback": "Unset ENABLE_STARTUP_MARKET_INTEL (or set 'false') "
                            "to disable again.",
            },
        )


class MarketComplaintsBody(BaseModel):
    query: str = Field(..., min_length=2, max_length=200)
    industry: str = Field(default="", max_length=120)
    region: str = Field(default="global", max_length=64)
    timeframe_days: int = Field(default=30, ge=1, le=90)
    sources: list[str] = Field(
        default_factory=lambda: ["web", "hackernews", "gdelt", "reddit", "producthunt"],
        max_length=8,
    )
    max_items: int = Field(default=80, ge=10, le=120)


@router.get("/market-complaints/health")
def market_complaints_health() -> dict:
    """Always callable — lets the frontend render source toggles honestly
    (which sources are configured) before the user runs an analysis."""
    try:
        from backend.services.research.client import active_provider
        web_configured = bool(active_provider())
    except Exception:
        web_configured = False
    return {
        "enabled": _enabled(),
        "sources": {
            # public endpoints — reachable without keys
            "hackernews": {"configured": True, "requires_key": False},
            "gdelt": {"configured": True, "requires_key": False},
            # key-gated
            "web": {"configured": web_configured, "requires_key": True},
            "reddit": {
                "configured": bool(os.getenv("REDDIT_CLIENT_ID", "").strip()
                                   and os.getenv("REDDIT_CLIENT_SECRET", "").strip()),
                "requires_key": True,
            },
            "producthunt": {
                "configured": bool(os.getenv("PRODUCTHUNT_TOKEN", "").strip()),
                "requires_key": True,
            },
        },
    }


@router.post("/market-complaints")
async def market_complaints(
    body: MarketComplaintsBody,
    user: User = Depends(current_user),
) -> dict:
    """Run the Market Complaint Radar. Partial source failure is normal
    and reported in data_freshness; only an engine-level crash is a 500,
    and it never leaks a stack trace."""
    _ensure_enabled()
    try:
        from backend.services.startup_intelligence import analyze_market_complaints
        report = await analyze_market_complaints(
            body.query,
            industry=body.industry,
            region=body.region,
            timeframe_days=body.timeframe_days,
            sources=body.sources,
            max_items=body.max_items,
        )
    except Exception as exc:
        logger.error("[STARTUP_INTEL] radar failed for %r: %s", body.query, exc)
        raise HTTPException(
            status_code=500,
            detail={
                "error": "startup_market_intel_failed",
                "message": "Market complaint analysis failed. Try again — "
                           "if it persists, check backend logs.",
            },
        )
    logger.info(
        "[STARTUP_INTEL] query=%r | uid=%s | sources_ok=%s | clusters=%d | cached=%s",
        body.query, user.id,
        report.get("summary", {}).get("total_sources"),
        len(report.get("complaint_clusters", [])),
        report.get("cached", False),
    )
    return report


__all__ = ["router"]
