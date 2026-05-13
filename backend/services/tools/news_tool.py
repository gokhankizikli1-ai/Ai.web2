# coding: utf-8
"""
News tool (Phase 7b).

Pulls recent news headlines for a query (ticker, company name, or topic)
from Yahoo Finance's public `/v1/finance/search` endpoint — no API key
required. The same endpoint backs Yahoo Finance's site search; using
its `news` field gives us 5-10 fresh items per query.

Returns:
  {
    "query": "NVDA",
    "count": 5,
    "items": [
      {
        "title":     "NVIDIA shares hit record on AI demand",
        "publisher": "Reuters",
        "url":       "https://...",
        "published_at": "2026-05-13T05:55:00Z",
        "related":   ["NVDA"],
        "type":      "STORY",
      },
      …
    ],
  }

Activate: ENABLE_TOOLS=true ENABLE_NEWS=true

No real-world action. Read-only headline fetch. Falls back to
_unavailable on network / rate-limit errors so the agent can route
the question elsewhere (e.g. web_research_tool when ENABLE_WEB_RESEARCH=true).
"""
from __future__ import annotations

import asyncio
import json
import logging
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import List

from backend.services.tools.base_tool import BaseTool

logger = logging.getLogger(__name__)


_DEFAULT_TIMEOUT_S = 5.0
_MAX_NEWS_COUNT    = 10
_DEFAULT_NEWS_COUNT = 5
_MAX_QUERY_LEN     = 80

_YAHOO_SEARCH_URL = "https://query2.finance.yahoo.com/v1/finance/search"
# Yahoo rejects unbranded requests; use a generic UA.
_USER_AGENT = "Mozilla/5.0 (compatible; KorvixAI/1.0; +https://korvixai.com)"


class NewsTool(BaseTool):
    name = "news"
    description = (
        "Get recent news headlines for a ticker symbol, company name, "
        "or topic (e.g. 'NVDA', 'Apple earnings', 'BTC ETF flows'). "
        "Returns up to 10 items with title, publisher, URL, and "
        "publish time. Read-only fetch from Yahoo Finance public search."
    )
    timeout_seconds = 7.0

    openai_parameters = {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Ticker, company, or topic to search news for.",
            },
            "count": {
                "type": "integer",
                "description": f"Number of headlines to return (1-{_MAX_NEWS_COUNT}, default {_DEFAULT_NEWS_COUNT}).",
            },
        },
        "required": ["query"],
        "additionalProperties": True,
    }

    async def run(self, query: str = "", context: dict = None) -> dict:
        ctx = context or {}
        q = (ctx.get("query") or query or "").strip()
        if not q:
            return self._error("missing 'query'")
        if len(q) > _MAX_QUERY_LEN:
            return self._error(f"query too long (max {_MAX_QUERY_LEN} chars)")

        # ctx.get(key, default) (not `or`) so an explicit count=0
        # clamps to 1 instead of silently becoming the default.
        raw_count = ctx.get("count", _DEFAULT_NEWS_COUNT)
        if raw_count is None:
            count = _DEFAULT_NEWS_COUNT
        else:
            try:
                count = max(1, min(_MAX_NEWS_COUNT, int(raw_count)))
            except (TypeError, ValueError):
                count = _DEFAULT_NEWS_COUNT

        try:
            raw = await asyncio.wait_for(
                _fetch_search_json(q, count),
                timeout=_DEFAULT_TIMEOUT_S,
            )
        except asyncio.TimeoutError:
            logger.info("news.timeout | query=%s", q)
            return self._unavailable(f"Yahoo Finance news timed out for {q!r}")
        except _Unavailable as exc:
            logger.info("news.unavailable | query=%s | %s", q, exc)
            return self._unavailable(str(exc))
        except Exception as exc:
            logger.warning("news.exception | query=%s | %s", q, exc)
            return self._unavailable(f"Unexpected: {exc}")

        items = _parse_items(raw, limit=count)
        if not items:
            return self._unavailable(f"No news returned for {q!r}")

        logger.info("news.ok | query=%s | items=%d", q, len(items))
        return self._ok(
            {"query": q, "count": len(items), "items": items},
            provider="yahoo_finance",
        )


# ── Fetch ────────────────────────────────────────────────────────────────

class _Unavailable(Exception):
    """News provider couldn't serve this query — agent may retry elsewhere."""


async def _fetch_search_json(query: str, count: int) -> dict:
    """Try aiohttp first (real async); fall back to urllib in a thread."""
    url = (
        _YAHOO_SEARCH_URL
        + "?"
        + urllib.parse.urlencode(
            {
                "q":         query,
                "newsCount": count,
                "quotesCount": 0,
                "enableFuzzyQuery": "false",
            }
        )
    )
    try:
        import aiohttp  # noqa: PLC0415
        async with aiohttp.ClientSession(headers={"User-Agent": _USER_AGENT}) as session:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=_DEFAULT_TIMEOUT_S)) as resp:
                if resp.status == 429:
                    raise _Unavailable("Yahoo rate-limited (HTTP 429)")
                if resp.status >= 400:
                    raise _Unavailable(f"Yahoo HTTP {resp.status}")
                return await resp.json(content_type=None)
    except ImportError:
        return await asyncio.to_thread(_fetch_search_sync, url)


def _fetch_search_sync(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": _USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=_DEFAULT_TIMEOUT_S) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as exc:
        if exc.code == 429:
            raise _Unavailable("Yahoo rate-limited (HTTP 429)") from exc
        raise _Unavailable(f"Yahoo HTTP {exc.code}") from exc
    except urllib.error.URLError as exc:
        raise _Unavailable(f"Network error: {exc.reason}") from exc


# ── Parse ────────────────────────────────────────────────────────────────

def _parse_items(raw: dict, *, limit: int) -> List[dict]:
    news = (raw or {}).get("news") or []
    items: List[dict] = []
    for entry in news[:limit]:
        title = (entry.get("title") or "").strip()
        if not title:
            continue
        publisher = entry.get("publisher") or ""
        url       = entry.get("link") or ""
        ts        = entry.get("providerPublishTime")
        published_at = _ts_to_iso(ts)
        related = entry.get("relatedTickers") or []
        items.append({
            "title":        title[:240],
            "publisher":    publisher[:80],
            "url":          url,
            "published_at": published_at,
            "related":      list(related)[:8],
            "type":         entry.get("type") or "STORY",
        })
    return items


def _ts_to_iso(ts) -> str:
    """Yahoo's providerPublishTime is unix seconds. Return ISO 8601 UTC."""
    if not ts:
        return ""
    try:
        return datetime.fromtimestamp(int(ts), tz=timezone.utc).isoformat()
    except (TypeError, ValueError, OverflowError, OSError):
        return ""


__all__ = ["NewsTool"]
