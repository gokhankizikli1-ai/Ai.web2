# coding: utf-8
"""Phase 11 — Brave Search provider (https://api.search.brave.com).

Brave's API is GET-based with a query string, unlike Tavily/Exa. Same
public surface — `search()` returns a `SearchResult` and never raises so
the cascade in `client.py` can fall through cleanly on failure.

API:
  GET https://api.search.brave.com/res/v1/web/search?q=...&count=10
  Headers:
    X-Subscription-Token: $BRAVE_API_KEY
    Accept:               application/json
    Accept-Encoding:      gzip

Response:
  {"web": {"results": [
     {"title": "...", "url": "...", "description": "...",
      "page_age": "2024-05-10T...", "language": "en", ...},
     ...
  ]}}
"""
from __future__ import annotations

import os
import json
import time
import logging
import asyncio
import urllib.parse
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

BRAVE_URL       = "https://api.search.brave.com/res/v1/web/search"
DEFAULT_TIMEOUT = float(os.getenv("R11_BRAVE_TIMEOUT_SEC", "6"))
CACHE_TTL       = float(os.getenv("R11_BRAVE_CACHE_TTL_SEC", "300"))
PROVIDER_NAME   = "brave"


async def search(
    query: str,
    *,
    max_results: int = 5,
    depth: str = "basic",
    include_answer: bool = True,        # Brave has no "answer" field; ignored
    include_domains: Optional[list[str]] = None,
    exclude_domains: Optional[list[str]] = None,
    timeout: float = DEFAULT_TIMEOUT,
) -> SearchResult:
    """Run a Brave Search. Never raises — returns SearchResult.error on failure."""
    t0 = time.monotonic()
    api_key = os.getenv("BRAVE_API_KEY", "").strip()
    if not api_key:
        return SearchResult(
            query=query, provider=PROVIDER_NAME,
            error="BRAVE_API_KEY missing",
        )
    if not query or not query.strip():
        return SearchResult(query="", provider=PROVIDER_NAME, error="empty_query")

    max_results = max(1, min(20, int(max_results)))   # Brave allows up to 20

    cache_key = _cache_key(query, max_results, include_domains, exclude_domains)
    cached = cache_get(cache_key)
    if cached is not None:
        sr = _rebuild_from_cache(cached)
        sr.cached = True
        sr.elapsed_ms = int((time.monotonic() - t0) * 1000)
        return sr

    # Brave doesn't support exclude_domains in a query param the way Google
    # does; we filter client-side after the response lands.
    params: dict = {
        "q":      query,
        "count":  max_results,
        "safesearch": "moderate",
    }
    if include_domains:
        # Brave supports `site:` operator chaining; OR them in.
        sites = " OR ".join(f"site:{d}" for d in include_domains[:5])
        params["q"] = f"{query} ({sites})"

    url = f"{BRAVE_URL}?{urllib.parse.urlencode(params)}"

    try:
        raw = await _fetch_json(url, api_key=api_key, timeout=timeout)
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

    web = raw.get("web") or {}
    raw_results = web.get("results") or []

    # Client-side exclude_domains filter.
    excl = {d.lower().lstrip("www.") for d in (exclude_domains or [])}
    citations: list[Citation] = []
    for r in raw_results:
        if not isinstance(r, dict):
            continue
        url_ = r.get("url", "") or ""
        host = _host(url_)
        if excl and any(host == d or host.endswith("." + d) for d in excl):
            continue
        citations.append(normalize_citation(
            title    = r.get("title", ""),
            url      = url_,
            snippet  = r.get("description", "") or "",
            date     = _parse_page_age(r.get("page_age")),
            raw_score= None,        # Brave does not surface a score
            provider = PROVIDER_NAME,
        ))
    citations = dedupe_citations(citations)[:max_results]

    result = SearchResult(
        query      = query,
        answer     = None,
        citations  = citations,
        provider   = PROVIDER_NAME,
        elapsed_ms = int((time.monotonic() - t0) * 1000),
    )

    try:
        cache_set(cache_key, result.to_dict(), CACHE_TTL)
    except Exception:
        pass
    return result


# ── HTTP ────────────────────────────────────────────────────────────────────

class _ApiAuthError(Exception): pass
class _ApiRateLimitError(Exception): pass


async def _fetch_json(url: str, *, api_key: str, timeout: float) -> dict:
    headers = {
        "Accept":               "application/json",
        "Accept-Encoding":      "gzip",
        "X-Subscription-Token": api_key,
    }

    try:
        import aiohttp  # noqa: PLC0415
        async with aiohttp.ClientSession() as s:
            async with s.get(url, headers=headers,
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
        req = urllib.request.Request(url, headers=headers, method="GET")
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


def _host(url: str) -> str:
    try:
        from urllib.parse import urlparse
        h = (urlparse(url).hostname or "").lower()
        return h[4:] if h.startswith("www.") else h
    except Exception:
        return ""


def _parse_page_age(raw) -> Optional[str]:
    """Brave returns ISO-8601 with timezone — clip to YYYY-MM-DD for the citation."""
    if not raw or not isinstance(raw, str):
        return None
    return raw[:10] if len(raw) >= 10 else None


def _cache_key(
    query: str, max_results: int,
    include: Optional[list[str]], exclude: Optional[list[str]],
) -> str:
    inc = ",".join(sorted(include or []))
    exc = ",".join(sorted(exclude or []))
    return f"RESEARCH:brave:{max_results}:{inc}:{exc}:{(query or '').strip().lower()}"


def _rebuild_from_cache(d: dict) -> SearchResult:
    cits = [Citation(**c) for c in (d.get("citations") or []) if isinstance(c, dict)]
    return SearchResult(
        query=d.get("query", ""),
        answer=d.get("answer"),
        citations=cits,
        provider=d.get("provider", PROVIDER_NAME),
        cached=False,
        elapsed_ms=int(d.get("elapsed_ms", 0)),
        truncated=bool(d.get("truncated", False)),
        error=d.get("error"),
    )


__all__ = ["search", "PROVIDER_NAME"]
