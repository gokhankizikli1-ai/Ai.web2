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

    # Phase M1 — memory service stats (legacy vs new client).
    try:
        from backend.services.memory_service import stats as memory_stats
        out["memory"] = memory_stats()
    except Exception as exc:
        logger.debug("/tools/health: memory stats unavailable: %s", exc)

    # Phase M2 — sessions service stats (workspaces / threads / messages).
    try:
        import os as _os
        from backend.services.sessions import client as _sessions_client
        out["sessions"] = {
            "enabled":           _os.getenv("ENABLE_SESSIONS", "false").strip().lower() == "true",
            "flag_enable_sessions": _os.getenv("ENABLE_SESSIONS", "false").strip().lower() == "true",
            **_sessions_client.stats(),
        }
    except Exception as exc:
        logger.debug("/tools/health: sessions stats unavailable: %s", exc)

    # Phase A1 — agent runtime stats (research mode only when flag is on).
    try:
        from backend.services.agent import stats as agent_stats
        out["agent"] = agent_stats()
    except Exception as exc:
        logger.debug("/tools/health: agent stats unavailable: %s", exc)

    # Phase R1 — research provider stats (Tavily today).
    try:
        from backend.services.research import stats as research_stats
        out["research"] = research_stats()
    except Exception as exc:
        logger.debug("/tools/health: research stats unavailable: %s", exc)

    return out
