# coding: utf-8
# Phase 4A — Tool package initializer.
# Registers all tool instances into the registry at import time.
# Every import is guarded so a broken tool never kills the app startup.
import logging

logger = logging.getLogger(__name__)

try:
    from backend.services.tools.tool_registry import register
    from backend.services.tools.market_data_tool import MarketDataTool
    from backend.services.tools.macro_data_tool import MacroDataTool
    from backend.services.tools.ecommerce_research_tool import EcommerceResearchTool
    from backend.services.tools.web_research_tool import WebResearchTool
    from backend.services.tools.calculator_tool import CalculatorTool
    from backend.services.tools.current_time_tool import CurrentTimeTool
    from backend.services.tools.stock_market_tool import StockMarketTool
    from backend.services.tools.news_tool import NewsTool
    # Phase 10 — read-only foundation tools.
    from backend.services.tools.browser_tool import BrowserFetchTool
    from backend.services.tools.github_tool import GithubRepoTool
    # Phase 11 — structured university rankings extractor.
    from backend.services.tools.university_rankings_tool import UniversityRankingsTool

    register(MarketDataTool())
    register(MacroDataTool())
    register(EcommerceResearchTool())
    register(WebResearchTool())
    register(CalculatorTool())
    register(CurrentTimeTool())
    register(StockMarketTool())
    register(NewsTool())
    register(BrowserFetchTool())
    register(GithubRepoTool())
    register(UniversityRankingsTool())
    logger.debug("tool package: 11 tools registered")
except Exception as _exc:
    logger.warning("tool package: registration failed (%s) — tools unavailable", _exc)
