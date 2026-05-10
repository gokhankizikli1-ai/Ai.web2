# coding: utf-8
# Phase 4A — Tool Registry
# Central store for tool instances + feature-flag checks.
# All env vars default to "false" so production is unaffected until explicitly enabled.
import os
import logging
from typing import Dict

logger = logging.getLogger(__name__)

# ── Feature flags (read once at import time) ───────────────────────────────
_flag = lambda key: os.getenv(key, "false").strip().lower() == "true"

ENABLE_TOOLS              = _flag("ENABLE_TOOLS")
ENABLE_MARKET_DATA        = _flag("ENABLE_MARKET_DATA")
ENABLE_ECOMMERCE_RESEARCH = _flag("ENABLE_ECOMMERCE_RESEARCH")
ENABLE_WEB_RESEARCH       = _flag("ENABLE_WEB_RESEARCH")

# Per-tool flag map — used by is_enabled()
_TOOL_FLAGS: Dict[str, bool] = {
    "market_data":          ENABLE_MARKET_DATA,
    "ecommerce_research":   ENABLE_ECOMMERCE_RESEARCH,
    "web_research":         ENABLE_WEB_RESEARCH,
}

# ── Registry store ─────────────────────────────────────────────────────────
_registry: Dict[str, object] = {}   # tool_name → BaseTool instance


def register(tool) -> None:
    """Register a tool instance. Duplicate names overwrite silently."""
    _registry[tool.name] = tool
    logger.debug("tool registered: %s", tool.name)


def get_tool(name: str):
    """Return registered tool by name, or None."""
    return _registry.get(name)


def is_enabled(tool_name: str) -> bool:
    """Return True only when ENABLE_TOOLS=true AND the specific flag is true."""
    if not ENABLE_TOOLS:
        return False
    return _TOOL_FLAGS.get(tool_name, False)


def health_status() -> dict:
    """Return a public-safe status dict (no secrets exposed)."""
    return {
        "tools_enabled":              ENABLE_TOOLS,
        "market_data_enabled":        ENABLE_MARKET_DATA,
        "ecommerce_research_enabled": ENABLE_ECOMMERCE_RESEARCH,
        "web_research_enabled":       ENABLE_WEB_RESEARCH,
        "registered_tools":           list(_registry.keys()),
        "phase": "4A — architecture foundation (providers not yet connected)",
    }
