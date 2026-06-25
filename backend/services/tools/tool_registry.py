# coding: utf-8
# Phase 4A — Tool Registry
# Central store for tool instances + feature-flag checks.
# All env vars default to "false" so production is unaffected until explicitly enabled.
#
# Phase 6d note: flags are now read DYNAMICALLY on every call (Phase 6b's
# pattern). Flipping ENABLE_TOOLS / ENABLE_CALCULATOR / etc. on Railway
# takes effect on the very next request — no restart needed. The
# module-level ENABLE_* constants below are kept ONLY for backward
# compatibility with callers that already imported them; they reflect
# the value at import time and are no longer authoritative.
import logging
import os
import threading
from collections import deque
from datetime import datetime, timezone
from typing import Dict, List

logger = logging.getLogger(__name__)


def _flag(key: str) -> bool:
    """Read an env-var boolean flag dynamically. Returns False unless the
    value is the literal string 'true' (case-insensitive, whitespace-stripped)."""
    return os.getenv(key, "false").strip().lower() == "true"


# Per-tool flag name table — single source of truth for which env var
# gates which tool. Adding a tool here is the one place callers need to
# touch when registering a new BaseTool.
_TOOL_FLAG_NAMES: Dict[str, str] = {
    "market_data":        "ENABLE_MARKET_DATA",
    "macro_data":         "ENABLE_MACRO_DATA",
    "ecommerce_research": "ENABLE_ECOMMERCE_RESEARCH",
    "web_research":       "ENABLE_WEB_RESEARCH",
    "calculator":         "ENABLE_CALCULATOR",
    "current_time":       "ENABLE_CURRENT_TIME",
    "stock_market":       "ENABLE_STOCK_MARKET",
    "news":               "ENABLE_NEWS",
}


# ── Back-compat constants (import-time snapshot — do not rely on these
#    for runtime decisions; call is_enabled() instead) ────────────────────
ENABLE_TOOLS              = _flag("ENABLE_TOOLS")
ENABLE_MARKET_DATA        = _flag("ENABLE_MARKET_DATA")
ENABLE_MACRO_DATA         = _flag("ENABLE_MACRO_DATA")
ENABLE_ECOMMERCE_RESEARCH = _flag("ENABLE_ECOMMERCE_RESEARCH")
ENABLE_WEB_RESEARCH       = _flag("ENABLE_WEB_RESEARCH")
ENABLE_CALCULATOR         = _flag("ENABLE_CALCULATOR")
ENABLE_CURRENT_TIME       = _flag("ENABLE_CURRENT_TIME")
ENABLE_STOCK_MARKET       = _flag("ENABLE_STOCK_MARKET")
ENABLE_NEWS               = _flag("ENABLE_NEWS")


# ── Registry store ─────────────────────────────────────────────────────────
_registry: Dict[str, object] = {}   # tool_name → BaseTool instance
_history_lock = threading.Lock()
_tool_history = deque(maxlen=500)


def register(tool) -> None:
    """Register a tool instance. Duplicate names overwrite silently."""
    _registry[tool.name] = tool
    logger.debug("tool registered: %s", tool.name)


def get_tool(name: str):
    """Return registered tool by name, or None."""
    return _registry.get(name)


def record_call(tool_name: str, result: dict = None) -> None:
    """Record a recent tool invocation for owner diagnostics."""
    result = result if isinstance(result, dict) else {}
    with _history_lock:
        _tool_history.appendleft({
            "tool":      tool_name,
            "status":    result.get("status", "unknown"),
            "provider":  result.get("provider"),
            "timestamp": result.get("timestamp") or datetime.now(timezone.utc).isoformat(),
        })


def recent_calls(limit: int = 25) -> List[dict]:
    """Return recent tool invocations, newest first."""
    n = int(max(1, min(limit, 200)))
    with _history_lock:
        return list(_tool_history)[:n]


def is_enabled(tool_name: str) -> bool:
    """Return True only when ENABLE_TOOLS=true AND the tool's per-tool flag
    is true. Both are read from the environment dynamically on every call."""
    if not _flag("ENABLE_TOOLS"):
        return False
    flag_name = _TOOL_FLAG_NAMES.get(tool_name)
    if not flag_name:
        return False
    return _flag(flag_name)


def health_status() -> dict:
    """Return a public-safe status dict (no secrets exposed). Reads every
    flag dynamically so /tools/health reflects the live config without
    a restart."""
    return {
        "tools_enabled":              _flag("ENABLE_TOOLS"),
        "market_data_enabled":        _flag("ENABLE_MARKET_DATA"),
        "macro_data_enabled":         _flag("ENABLE_MACRO_DATA"),
        "ecommerce_research_enabled": _flag("ENABLE_ECOMMERCE_RESEARCH"),
        "web_research_enabled":       _flag("ENABLE_WEB_RESEARCH"),
        "calculator_enabled":         _flag("ENABLE_CALCULATOR"),
        "current_time_enabled":       _flag("ENABLE_CURRENT_TIME"),
        "stock_market_enabled":       _flag("ENABLE_STOCK_MARKET"),
        "news_enabled":               _flag("ENABLE_NEWS"),
        "registered_tools":           list(_registry.keys()),
        "phase": "7b — stock_market + news + per-tool timeouts + 'market' mode",
    }
