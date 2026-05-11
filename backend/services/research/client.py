# coding: utf-8
# Phase R1 — ResearchClient.
#
# Provider-agnostic public surface for web research. Today (R1) the only
# implemented provider is Tavily; Serper / Brave / Exa slot in here in
# follow-up PRs by adding a new module + branch.
#
# Routing rule:
#   WEB_RESEARCH_PROVIDER=tavily          (default for R1)
#   WEB_RESEARCH_PROVIDER=<unknown>       → returns provider_not_implemented error
#   WEB_RESEARCH_PROVIDER unset / empty   → returns provider_not_configured error
#
# Callers (web_research_tool, future agent / workflows) never import providers
# directly — they call `client.search(...)`.
import os
import logging
import threading
from typing import Optional

from backend.services.research.types import SearchResult

logger = logging.getLogger(__name__)

# ── Observability counters (surfaced via /tools/health) ─────────────────────
_LOCK = threading.Lock()
_COUNTS = {
    "searches_total":   0,
    "searches_ok":      0,
    "searches_error":   0,
    "by_provider":      {},          # name → count
    "last_error":       "",
}


def _bump(provider: str, *, ok: bool, error: str = "") -> None:
    with _LOCK:
        _COUNTS["searches_total"] += 1
        if ok:
            _COUNTS["searches_ok"] += 1
        else:
            _COUNTS["searches_error"] += 1
            if error:
                _COUNTS["last_error"] = error[:140]
        bp = _COUNTS.get("by_provider", {})
        bp[provider] = bp.get(provider, 0) + 1
        _COUNTS["by_provider"] = bp


def stats() -> dict:
    with _LOCK:
        return {
            **_COUNTS,
            "configured_provider": active_provider(),
            "available_providers": ["tavily"],   # extend as new modules land
            "cache_ttl_sec":       float(os.getenv("R1_TAVILY_CACHE_TTL_SEC", "300")),
        }


def active_provider() -> str:
    return os.getenv("WEB_RESEARCH_PROVIDER", "").strip().lower()


# ── Public API ──────────────────────────────────────────────────────────────

class ResearchClient:
    """Stable provider-agnostic surface. Never raises."""

    async def search(
        self,
        query: str,
        *,
        max_results: int = 5,
        depth: str = "basic",
        include_answer: bool = True,
        include_domains: Optional[list[str]] = None,
        exclude_domains: Optional[list[str]] = None,
        timeout: Optional[float] = None,
    ) -> SearchResult:
        provider = active_provider()
        if not provider:
            r = SearchResult(query=query or "", error="provider_not_configured")
            _bump("none", ok=False, error="provider_not_configured")
            return r

        if provider == "tavily":
            from backend.services.research import tavily
            kwargs = {
                "max_results":    max_results,
                "depth":          depth,
                "include_answer": include_answer,
                "include_domains": include_domains,
                "exclude_domains": exclude_domains,
            }
            if timeout is not None:
                kwargs["timeout"] = timeout
            result = await tavily.search(query, **kwargs)
            _bump("tavily", ok=(result.error is None), error=result.error or "")
            return result

        # Unknown provider: structured error, no exception
        r = SearchResult(query=query or "", provider=provider,
                         error=f"provider_not_implemented: {provider}")
        _bump(provider or "unknown", ok=False, error=r.error)
        return r


client = ResearchClient()

__all__ = ["ResearchClient", "client", "stats", "active_provider"]
