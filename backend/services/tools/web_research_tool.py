# coding: utf-8
# Phase 4D / R1 — Web Research Tool.
#
# R1 lights up the real provider path. The tool now delegates to
# backend.services.research.client (provider-agnostic), which today routes
# WEB_RESEARCH_PROVIDER=tavily to backend.services.research.tavily.
#
# Activation chain:
#   ENABLE_TOOLS=true                  (master switch — Phase 4A)
#   ENABLE_WEB_RESEARCH=true           (per-tool flag — Phase 4A)
#   WEB_RESEARCH_PROVIDER=tavily       (provider selection — R1)
#   TAVILY_API_KEY=<key>               (provider auth — R1)
#
# Any link in the chain missing → tool reports `unavailable` with a clear
# message; the agent / orchestrator continues without the tool.
import logging
from backend.services.tools.base_tool import BaseTool

logger = logging.getLogger(__name__)


# Default schema surfaced to the OpenAI function-calling layer (Phase A1).
# Keep parameters PERMISSIVE so the LLM can call the tool without strict
# argument shape pressure; the tool internally clamps/defaults.
WEB_RESEARCH_OPENAI_PARAMETERS = {
    "type": "object",
    "properties": {
        "query": {
            "type": "string",
            "description": "The natural-language question to search for.",
        },
        "max_results": {
            "type": "integer",
            "description": "Optional max number of citations to return (1-10, default 5).",
            "minimum": 1, "maximum": 10,
        },
        "depth": {
            "type": "string",
            "enum": ["basic", "advanced"],
            "description": "Search depth. Advanced is slower but better grounded.",
        },
        "include_domains": {
            "type": "array", "items": {"type": "string"},
            "description": "Optional allow-list of domains.",
        },
        "exclude_domains": {
            "type": "array", "items": {"type": "string"},
            "description": "Optional deny-list of domains.",
        },
    },
    "required": ["query"],
    "additionalProperties": True,
}


class WebResearchTool(BaseTool):
    name = "web_research"
    description = (
        "Search the web for current information and return up to 10 citation-ready "
        "results. Each citation includes title, url, snippet, publication date, "
        "source_type (news/academic/government/forum/wiki/blog/social/...), and "
        "a heuristic trust_score (0-1). Use this when the user asks about "
        "recent events, current data, or anything beyond model training cutoff."
    )

    # Surfaces the schema to the agent.tool_bridge → OpenAI function-calling.
    openai_parameters = WEB_RESEARCH_OPENAI_PARAMETERS

    async def run(self, query: str, context: dict = None) -> dict:
        ctx = context or {}

        # Lazy import keeps the package import cheap and tolerant of breakage.
        try:
            from backend.services.research import client, active_provider
        except Exception as exc:
            return self._unavailable(f"research package unavailable: {exc}")

        provider = active_provider()
        if not provider:
            return self._unavailable(
                "Web research provider not configured. "
                "Set WEB_RESEARCH_PROVIDER=tavily (or serper / brave / exa) "
                "and ENABLE_WEB_RESEARCH=true."
            )

        q = (query or ctx.get("query") or "").strip()
        if not q:
            return self._unavailable("empty query")

        try:
            result = await client.search(
                q,
                max_results    = int(ctx.get("max_results", 5)),
                depth          = ctx.get("depth", "basic"),
                include_answer = bool(ctx.get("include_answer", True)),
                include_domains = ctx.get("include_domains"),
                exclude_domains = ctx.get("exclude_domains"),
            )
        except Exception as exc:
            logger.warning("web_research: client.search exception: %s", exc)
            return self._error(f"client_exception: {exc}")

        if result.error:
            return self._unavailable(result.error)

        return self._ok(
            {
                "query":      result.query,
                "answer":     result.answer,
                "citations":  [c.to_dict() for c in result.citations],
                "count":      len(result.citations),
                "cached":     result.cached,
                "elapsed_ms": result.elapsed_ms,
            },
            provider=result.provider or provider,
        )
