# coding: utf-8
# Phase 4A — Tool package initializer.
# Registers all tool instances into the registry at import time.
# Every import is guarded so a broken tool never kills the app startup.
import logging

logger = logging.getLogger(__name__)

try:
    from backend.services.tools.tool_registry import register
    from backend.services.tools.market_data_tool import MarketDataTool
    from backend.services.tools.ecommerce_research_tool import EcommerceResearchTool
    from backend.services.tools.web_research_tool import WebResearchTool

    register(MarketDataTool())
    register(EcommerceResearchTool())
    register(WebResearchTool())
    logger.debug("tool package: 3 tools registered")
except Exception as _exc:
    logger.warning("tool package: registration failed (%s) — tools unavailable", _exc)
