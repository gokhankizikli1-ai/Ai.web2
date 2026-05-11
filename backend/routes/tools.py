# coding: utf-8
# /tools/health — tool enable/disable status + Phase 5.2 observability
# (cache stats + per-provider success/failure counters + safety throttle stats).
# No secrets exposed; safe to call publicly.
import logging
from fastapi import APIRouter

router = APIRouter(tags=["tools"])
logger = logging.getLogger(__name__)


@router.get("/tools/health")
def tools_health() -> dict:
    """Tools / cache / safety observability snapshot."""
    out: dict = {}
    try:
        from backend.services.tools.tool_registry import health_status
        out.update(health_status())
    except Exception as exc:
        logger.warning("/tools/health: registry unavailable: %s", exc)
        out = {
            "tools_enabled":              False,
            "market_data_enabled":        False,
            "macro_data_enabled":         False,
            "ecommerce_research_enabled": False,
            "web_research_enabled":       False,
            "registered_tools":           [],
            "phase":                      "5.2 — stabilization & polish",
            "registry_error":             str(exc),
        }

    try:
        from backend.services.cache import stats as cache_stats
        out["cache"] = cache_stats()
    except Exception as exc:
        logger.debug("/tools/health: cache stats unavailable: %s", exc)

    try:
        from backend.services.safety.guard import stats as safety_stats
        out["safety"] = safety_stats()
    except Exception as exc:
        logger.debug("/tools/health: safety stats unavailable: %s", exc)

    return out
