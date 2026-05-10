# coding: utf-8
# Phase 4A — Tools health endpoint.
# GET /tools/health — returns enabled/disabled status of all tool flags.
# No secrets exposed. Safe to call publicly.
import logging
from fastapi import APIRouter

router = APIRouter(tags=["tools"])
logger = logging.getLogger(__name__)


@router.get("/tools/health")
def tools_health() -> dict:
    """
    Returns the current enable/disable status of every tool.
    Use this to verify env vars are picked up correctly before enabling tools.
    """
    try:
        from backend.services.tools.tool_registry import health_status
        return health_status()
    except Exception as exc:
        logger.warning("/tools/health: registry unavailable: %s", exc)
        return {
            "tools_enabled":              False,
            "market_data_enabled":        False,
            "ecommerce_research_enabled": False,
            "web_research_enabled":       False,
            "registered_tools":           [],
            "phase":                      "4A — architecture foundation",
            "error":                      str(exc),
        }
