# coding: utf-8
# Phase 4A — Web Research Tool (interface + placeholder)
#
# Phase 4D will connect a real provider:
#   Provider options:
#     "serper"  → Serper.dev (Google results API); Env: SERPER_API_KEY
#     "brave"   → Brave Search API; Env: BRAVE_API_KEY
#     "tavily"  → Tavily AI search (citation-ready); Env: TAVILY_API_KEY
#     "exa"     → Exa.ai (semantic search); Env: EXA_API_KEY
#
#   Set WEB_RESEARCH_PROVIDER=tavily + ENABLE_WEB_RESEARCH=true.
#
# Data types this tool will serve (Phase 4D):
#   - Web search results (title, snippet, URL)
#   - Source content extraction (article text)
#   - Competitor page analysis
#   - Market research summaries
#   - Citation-ready answer synthesis
#   - News headline aggregation
import os
import logging
from backend.services.tools.base_tool import BaseTool

logger = logging.getLogger(__name__)

_PROVIDER = os.getenv("WEB_RESEARCH_PROVIDER", "").strip().lower()


class WebResearchTool(BaseTool):
    name = "web_research"
    description = (
        "Web search, source extraction, competitor analysis, and citation-ready summaries. "
        "Phase 4D: connects to Serper / Brave / Tavily / Exa."
    )

    async def run(self, query: str, context: dict = None) -> dict:
        # Phase 4D: route to provider here.
        # context keys: type (search|scrape), max_results, region, language
        if not _PROVIDER:
            return self._unavailable(
                "Web research provider not configured. "
                "Set WEB_RESEARCH_PROVIDER=tavily (or serper / brave) and "
                "ENABLE_WEB_RESEARCH=true."
            )

        # Phase 4D: uncomment and implement provider branches.
        # if _PROVIDER == "serper":
        #     return await self._from_serper(query, context or {})
        # elif _PROVIDER == "tavily":
        #     return await self._from_tavily(query, context or {})
        # elif _PROVIDER == "brave":
        #     return await self._from_brave(query, context or {})
        # elif _PROVIDER == "exa":
        #     return await self._from_exa(query, context or {})

        return self._unavailable(
            f"Provider '{_PROVIDER}' recognised but not yet implemented (Phase 4D)."
        )

    # ── Phase 4D provider stubs ──────────────────────────────────────────

    # async def _from_serper(self, query: str, ctx: dict) -> dict:
    #     import aiohttp
    #     key  = os.environ["SERPER_API_KEY"]
    #     n    = ctx.get("max_results", 5)
    #     url  = "https://google.serper.dev/search"
    #     body = {"q": query, "num": n, "gl": ctx.get("region", "us")}
    #     async with aiohttp.ClientSession(headers={"X-API-KEY": key}) as s:
    #         async with s.post(url, json=body) as r:
    #             data = await r.json()
    #     results = [
    #         {"title": r["title"], "snippet": r["snippet"], "url": r["link"]}
    #         for r in data.get("organic", [])[:n]
    #     ]
    #     return self._ok({"query": query, "results": results}, provider="serper")

    # async def _from_tavily(self, query: str, ctx: dict) -> dict:
    #     from tavily import TavilyClient
    #     client  = TavilyClient(api_key=os.environ["TAVILY_API_KEY"])
    #     n       = ctx.get("max_results", 5)
    #     resp    = client.search(query, max_results=n, include_answer=True)
    #     return self._ok({
    #         "query":   query,
    #         "answer":  resp.get("answer"),
    #         "results": resp.get("results", [])[:n],
    #     }, provider="tavily")

    # async def _from_brave(self, query, ctx): ...
    # async def _from_exa(self, query, ctx): ...
