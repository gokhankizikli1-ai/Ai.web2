# coding: utf-8
# Phase R1 — Tavily provider.
#
# Tavily REST API (no SDK dependency added):
#   POST https://api.tavily.com/search
#   { "api_key": "...", "query": "...", "max_results": 5,
#     "search_depth": "basic" | "advanced",
#     "include_answer": true,
#     "include_domains": [], "exclude_domains": [] }
#
# Response:
#   { "answer": "...", "query": "...",
#     "results": [ { "title", "url", "content", "score", "published_date" } ] }
#
# All API errors are caught and surfaced as SearchResult(error=...). Network
# timeouts default to 8s. Results are cached via backend.services.cache for
# the duration of `R1_TAVILY_CACHE_TTL_SEC` (default 300 = 5 min).
import os
import json
import time
import logging
import asyncio
import urllib.request
import urllib.error
from typing import Optional

from backend.services.research.types import SearchResult, Citation
from backend.services.research.citations import normalize_citation, dedupe_citations

try:
    from backend.services.cache import cache_get, cache_set, record_fetch as _record_fetch
except Exception:
    def cache_get(_):              return None  # noqa: E704
    def cache_set(*_a, **_kw):     return None  # noqa: E704
    def _record_fetch(*_a, **_kw): return None  # noqa: E704

logger = logging.getLogger(__name__)

TAVILY_URL    = "https://api.tavily.com/search"
DEFAULT_TIMEOUT = float(os.getenv("R1_TAVILY_TIMEOUT_SEC", "8"))
CACHE_TTL       = float(os.getenv("R1_TAVILY_CACHE_TTL_SEC", "300"))
PROVIDER_NAME   = "tavily"


# ── Public entry ────────────────────────────────────────────────────────────

async def search(
    query: str,
    *,
    max_results: int = 5,
    depth: str = "basic",                # "basic" | "advanced"
    include_answer: bool = True,
    include_domains: Optional[list[str]] = None,
    exclude_domains: Optional[list[str]] = None,
    timeout: float = DEFAULT_TIMEOUT,
) -> SearchResult:
    """Run a Tavily search. Never raises — returns SearchResult.error on failure."""
    t0 = time.monotonic()
    api_key = os.getenv("TAVILY_API_KEY", "").strip()
    if not api_key:
        return SearchResult(
            query=query, provider=PROVIDER_NAME,
            error="TAVILY_API_KEY missing — set it on Railway to enable real web research",
        )
    if not query or not query.strip():
        return SearchResult(query="", provider=PROVIDER_NAME, error="empty_query")

    max_results = max(1, min(10, int(max_results)))

    cache_key = _cache_key(query, max_results, depth, include_domains, exclude_domains)
    cached = cache_get(cache_key)
    if cached is not None:
        # cached value is the same SearchResult.to_dict() shape; rebuild minimal
        sr = _rebuild_from_cache(cached)
        sr.cached = True
        sr.elapsed_ms = int((time.monotonic() - t0) * 1000)
        return sr

    payload = {
        "api_key":        api_key,
        "query":          query,
        "max_results":    max_results,
        "search_depth":   "advanced" if depth == "advanced" else "basic",
        "include_answer": bool(include_answer),
    }
    if include_domains: payload["include_domains"] = include_domains[:20]
    if exclude_domains: payload["exclude_domains"] = exclude_domains[:20]

    try:
        raw = await _fetch_json(TAVILY_URL, payload, timeout=timeout)
        _record_fetch(PROVIDER_NAME, ok=True)
    except _ApiAuthError as exc:
        _record_fetch(PROVIDER_NAME, ok=False, reason=str(exc))
        return SearchResult(query=query, provider=PROVIDER_NAME, error=f"auth: {exc}",
                            elapsed_ms=int((time.monotonic() - t0) * 1000))
    except _ApiRateLimitError as exc:
        _record_fetch(PROVIDER_NAME, ok=False, reason=str(exc))
        return SearchResult(query=query, provider=PROVIDER_NAME, error=f"rate_limit: {exc}",
                            elapsed_ms=int((time.monotonic() - t0) * 1000))
    except asyncio.TimeoutError:
        _record_fetch(PROVIDER_NAME, ok=False, reason="timeout")
        return SearchResult(query=query, provider=PROVIDER_NAME, error="timeout",
                            elapsed_ms=int((time.monotonic() - t0) * 1000))
    except Exception as exc:
        _record_fetch(PROVIDER_NAME, ok=False, reason=str(exc))
        return SearchResult(query=query, provider=PROVIDER_NAME, error=f"http: {exc}",
                            elapsed_ms=int((time.monotonic() - t0) * 1000))

    if not isinstance(raw, dict):
        return SearchResult(query=query, provider=PROVIDER_NAME, error="bad_response_type",
                            elapsed_ms=int((time.monotonic() - t0) * 1000))

    raw_results = raw.get("results") or []
    citations: list[Citation] = []
    for r in raw_results:
        if not isinstance(r, dict):
            continue
        citations.append(normalize_citation(
            title    = r.get("title", ""),
            url      = r.get("url", ""),
            snippet  = r.get("content", ""),
            date     = r.get("published_date") or r.get("publishedDate"),
            raw_score= r.get("score"),
            provider = PROVIDER_NAME,
        ))
    citations = dedupe_citations(citations)[:max_results]

    result = SearchResult(
        query      = query,
        answer     = raw.get("answer"),
        citations  = citations,
        provider   = PROVIDER_NAME,
        elapsed_ms = int((time.monotonic() - t0) * 1000),
    )

    # Cache by serialized dict to keep cache backing simple.
    try:
        cache_set(cache_key, result.to_dict(), CACHE_TTL)
    except Exception:
        pass
    return result


# ── HTTP helper ─────────────────────────────────────────────────────────────

class _ApiAuthError(Exception): pass
class _ApiRateLimitError(Exception): pass


async def _fetch_json(url: str, payload: dict, *, timeout: float) -> dict:
    """
    aiohttp first (in requirements); urllib fallback.
    401/403 → _ApiAuthError, 429/5xx → _ApiRateLimitError, other non-200 → RuntimeError.
    """
    body = json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json"}

    try:
        import aiohttp  # noqa: PLC0415
        async with aiohttp.ClientSession() as s:
            async with s.post(url, data=body, headers=headers,
                              timeout=aiohttp.ClientTimeout(total=timeout)) as resp:
                if resp.status in (401, 403):
                    raise _ApiAuthError(f"HTTP {resp.status}")
                if resp.status == 429 or 500 <= resp.status < 600:
                    raise _ApiRateLimitError(f"HTTP {resp.status}")
                if resp.status != 200:
                    raise RuntimeError(f"HTTP {resp.status}")
                return await resp.json(content_type=None)
    except ImportError:
        pass

    def _sync():
        req = urllib.request.Request(url, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as exc:
            if exc.code in (401, 403):
                raise _ApiAuthError(f"HTTP {exc.code}") from exc
            if exc.code == 429 or 500 <= exc.code < 600:
                raise _ApiRateLimitError(f"HTTP {exc.code}") from exc
            raise RuntimeError(f"HTTP {exc.code}") from exc

    return await asyncio.get_event_loop().run_in_executor(None, _sync)


# ── Cache helpers ───────────────────────────────────────────────────────────

def _cache_key(
    query: str, max_results: int, depth: str,
    include: Optional[list[str]], exclude: Optional[list[str]],
) -> str:
    inc = ",".join(sorted(include or []))
    exc = ",".join(sorted(exclude or []))
    return f"RESEARCH:tavily:{depth}:{max_results}:{inc}:{exc}:{(query or '').strip().lower()}"


def _rebuild_from_cache(d: dict) -> SearchResult:
    cits = [Citation(**c) for c in (d.get("citations") or []) if isinstance(c, dict)]
    return SearchResult(
        query=d.get("query", ""),
        answer=d.get("answer"),
        citations=cits,
        provider=d.get("provider", PROVIDER_NAME),
        cached=False,        # caller sets True after rebuild
        elapsed_ms=int(d.get("elapsed_ms", 0)),
        truncated=bool(d.get("truncated", False)),
        error=d.get("error"),
    )


__all__ = ["search", "PROVIDER_NAME"]
