# coding: utf-8
# Phase R1 — Research service package.
#
# Public API:
#   from backend.services.research import client, Citation, SearchResult
#
# Modules:
#   types.py       Citation + SearchResult dataclasses + SOURCE_TYPES taxonomy
#   citations.py   normalize_citation, dedupe_citations, trust_score
#   tavily.py      Tavily provider (HTTP, no SDK dependency)
#   client.py      ResearchClient — provider-agnostic surface
#
# Env vars:
#   WEB_RESEARCH_PROVIDER=tavily        (required to do anything)
#   TAVILY_API_KEY=<key>                (required when provider=tavily)
#   R1_TAVILY_CACHE_TTL_SEC=300         (optional override)
#   R1_TAVILY_TIMEOUT_SEC=8             (optional override)
from backend.services.research.client    import client, ResearchClient, stats, active_provider
from backend.services.research.types     import Citation, SearchResult, SOURCE_TYPES
from backend.services.research.citations import (
    normalize_citation, dedupe_citations, trust_score, detect_source_type,
)

__all__ = [
    "client",
    "ResearchClient",
    "stats",
    "active_provider",
    "Citation",
    "SearchResult",
    "SOURCE_TYPES",
    "normalize_citation",
    "dedupe_citations",
    "trust_score",
    "detect_source_type",
]
