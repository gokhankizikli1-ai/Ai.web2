# coding: utf-8
# Startup Market Intelligence — source collectors.
#
# Each collector fetches CURRENT public signals for one source and
# normalizes them into RawSignal items. Contract:
#
#   * A collector NEVER raises — any failure returns
#     CollectorResult(status="unavailable", note=<honest reason>).
#   * A source that needs credentials which aren't configured returns
#     status="skipped" with a note saying which env var enables it.
#     We never fake or approximate a source we can't reach.
#   * Every collector enforces its own timeout so one slow provider
#     can't stall the whole radar request.
#
# Sources:
#   web         → existing research provider cascade (Tavily/Exa/Brave)
#   hackernews  → Algolia HN Search API (public, no key)
#   gdelt       → GDELT DOC 2.0 API (public, no key)
#   reddit      → OAuth client-credentials (REDDIT_CLIENT_ID/SECRET)
#   producthunt → GraphQL API v2 (PRODUCTHUNT_TOKEN)
from __future__ import annotations

import asyncio
import logging
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Optional

from backend.services.startup_intelligence.types import (
    CollectorResult, RawSignal,
    STATUS_AVAILABLE, STATUS_UNAVAILABLE, STATUS_SKIPPED,
)

logger = logging.getLogger(__name__)

# Per-source wall-clock ceiling. Collectors run concurrently, so the
# radar's worst case is ~one timeout, not the sum.
_HTTP_TIMEOUT_SEC = 8.0

# ── Complaint-focused query expansion ───────────────────────────────────────
# Deterministic variants around complaint intent. BOUNDED: at most
# _MAX_QUERY_VARIANTS provider calls per run — never spam providers.
_EN_QUERY_VARIANTS = (
    "{q} complaints",
    "{q} problems",
    "{q} pain points",
    "{q} frustrated users",
    "{q} alternative",
    "{q} pricing complaints",
    "why people stop using {q}",
)
_TR_QUERY_VARIANTS = (
    "{q} şikayet",
    "{q} sorun",
    "{q} kullanıcı şikayetleri",
    "{q} alternatif",
    "{q} pahalı",
    "{q} memnun değil",
)
_MAX_QUERY_VARIANTS = 6

_TR_CHARS = set("çğıöşüÇĞİÖŞÜ")
_TR_HINT_WORDS = ("için", "uygulama", "araç", "yazılım", "takip", "yönetim", "sitesi")


def _looks_turkish(query: str) -> bool:
    if any(ch in _TR_CHARS for ch in query):
        return True
    lower = f" {query.lower()} "
    return any(f" {w} " in lower for w in _TR_HINT_WORDS)


def complaint_query_variants(query: str) -> list[str]:
    """Bounded, deterministic complaint-intent expansions of the niche."""
    templates = _TR_QUERY_VARIANTS if _looks_turkish(query) else _EN_QUERY_VARIANTS
    return [t.format(q=query) for t in templates[:_MAX_QUERY_VARIANTS]]


# ── Evidence quality (0-1) ──────────────────────────────────────────────────
# Base weight by where the item came from: real discussion beats broad
# SEO/blog/news content. The analyzer adds complaint-language bonuses on
# top; both feed cluster scoring and confidence calibration.
_WEB_TYPE_QUALITY = {
    "forum": 0.85,      # reddit / HN / stackexchange style pages
    "social": 0.60,
    "unknown": 0.50,
    "blog": 0.45,       # SEO/listicle-prone
    "video": 0.40,
    "news": 0.40,
    "corporate": 0.35,  # vendor marketing pages
    "wiki": 0.35,
    "academic": 0.35,
    "government": 0.30,
}

# Listicle / SEO title shapes ("7 best AI support tools 2026", "Top 10 …",
# "Ultimate guide to …") — topical coverage, not user pain.
_LISTICLE_TITLE_RE = re.compile(
    r"(^\s*\d+\s+(best|top|great|essential|proven|ways|reasons|tips|tools)\b"
    r"|\btop\s+\d+\b|\bbest\b.*\b20\d\d\b|\bultimate guide\b|\bcomplete guide\b)",
    re.IGNORECASE,
)


def _clamp01(v: float) -> float:
    return max(0.05, min(0.95, v))


def _web_quality(citation) -> float:
    base = _WEB_TYPE_QUALITY.get(getattr(citation, "source_type", "unknown"), 0.5)
    trust = float(getattr(citation, "trust_score", 0.5) or 0.5)
    q = 0.75 * base + 0.25 * trust
    if _LISTICLE_TITLE_RE.search(citation.title or ""):
        q -= 0.20
    return _clamp01(q)


def _is_timeout(exc: Exception) -> bool:
    return "timeout" in type(exc).__name__.lower()


def _iso(ts: Optional[float]) -> Optional[str]:
    if not ts:
        return None
    try:
        return datetime.fromtimestamp(float(ts), tz=timezone.utc).isoformat()
    except Exception:
        return None


def _clip(text: str, limit: int = 400) -> str:
    """Keep snippets short — we quote public posts, we don't republish them."""
    text = " ".join((text or "").split())
    return text[:limit]


# ── web (existing research provider cascade) ────────────────────────────────

async def collect_web(query: str, timeframe_days: int, max_items: int) -> CollectorResult:
    try:
        from backend.services.research import client, active_provider
    except Exception as exc:
        return CollectorResult("web", STATUS_UNAVAILABLE,
                               note=f"research package unavailable: {exc}")

    if not active_provider():
        # Not configured is a deployment choice, not a failure.
        return CollectorResult(
            "web", STATUS_SKIPPED,
            note="Web research not configured — broad market evidence skipped "
                 "(set WEB_RESEARCH_PROVIDER + provider API key).",
        )

    variants = complaint_query_variants(query)
    per_variant = max(2, min(5, max_items // len(variants)))
    signals: list[RawSignal] = []
    seen_urls: set[str] = set()
    errors: list[str] = []

    for variant in variants:
        try:
            result = await client.search(
                variant,
                max_results=per_variant,
                depth="basic",
                include_answer=False,
                timeout=_HTTP_TIMEOUT_SEC,
            )
        except Exception as exc:  # client promises not to raise; stay safe
            errors.append(str(exc))
            continue
        if result.error:
            errors.append(result.error)
            continue
        for c in result.citations:
            if not c.url or c.url in seen_urls:
                continue
            seen_urls.add(c.url)
            signals.append(RawSignal(
                source="web",
                title=_clip(c.title, 160),
                text=_clip(c.snippet),
                url=c.url,
                published_at=c.date,
                quality=_web_quality(c),
            ))

    if signals:
        return CollectorResult("web", STATUS_AVAILABLE, signals=signals[:max_items])
    note = "web research returned no results — broad market evidence missing this run" \
        + (f" ({errors[0]})" if errors else "")
    return CollectorResult("web", STATUS_UNAVAILABLE, note=note)


# ── Hacker News (Algolia public search) ─────────────────────────────────────

async def collect_hackernews(query: str, timeframe_days: int, max_items: int) -> CollectorResult:
    try:
        import httpx
    except Exception as exc:
        return CollectorResult("hackernews", STATUS_UNAVAILABLE,
                               note=f"httpx unavailable: {exc}")

    since = datetime.now(timezone.utc) - timedelta(days=max(1, timeframe_days))
    # Two bounded queries: the plain niche + one complaint-flavored
    # variant, so discussion threads about problems surface even when
    # the plain phrase is dominated by launch/show threads.
    hn_queries = [query, complaint_query_variants(query)[1]]
    signals: list[RawSignal] = []
    seen_ids: set[str] = set()
    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT_SEC) as http:
            for q in hn_queries:
                resp = await http.get(
                    "https://hn.algolia.com/api/v1/search",
                    params={
                        "query": q,
                        "tags": "(story,comment)",
                        "hitsPerPage": str(max(10, min(40, max_items))),
                        "numericFilters": f"created_at_i>{int(since.timestamp())}",
                    },
                )
                resp.raise_for_status()
                for hit in (resp.json().get("hits") or []):
                    object_id = hit.get("objectID") or ""
                    if not object_id or object_id in seen_ids:
                        continue
                    seen_ids.add(object_id)
                    title = hit.get("title") or hit.get("story_title") or ""
                    body = hit.get("story_text") or hit.get("comment_text") or ""
                    url = hit.get("url") or f"https://news.ycombinator.com/item?id={object_id}"
                    if not (title or body):
                        continue
                    signals.append(RawSignal(
                        source="hackernews",
                        title=_clip(title, 160),
                        text=_clip(body),
                        url=url,
                        published_at=_iso(hit.get("created_at_i")),
                        engagement=int(hit.get("points") or 0) + int(hit.get("num_comments") or 0),
                        # Comments/stories with body text are real discussion;
                        # bare titles carry less complaint signal.
                        quality=0.85 if body else 0.65,
                    ))
                    if len(signals) >= max_items:
                        break
                if len(signals) >= max_items:
                    break
    except Exception as exc:
        logger.warning("[STARTUP_INTEL] hackernews fetch failed: %s", exc)
        note = ("Hacker News timed out — discussion signal unavailable this run"
                if _is_timeout(exc)
                else "Hacker News search failed — discussion signal unavailable this run")
        # Partial results from the first query still count.
        if not signals:
            return CollectorResult("hackernews", STATUS_UNAVAILABLE, note=note)

    if signals:
        return CollectorResult("hackernews", STATUS_AVAILABLE, signals=signals)
    return CollectorResult("hackernews", STATUS_UNAVAILABLE,
                           note="no Hacker News discussions matched in the timeframe")


# ── GDELT (public DOC 2.0 API — broad news/market signal) ───────────────────

async def collect_gdelt(query: str, timeframe_days: int, max_items: int) -> CollectorResult:
    try:
        import httpx
    except Exception as exc:
        return CollectorResult("gdelt", STATUS_UNAVAILABLE,
                               note=f"httpx unavailable: {exc}")

    params = {
        "query": query,
        "mode": "ArtList",
        "format": "json",
        "timespan": f"{max(1, min(90, timeframe_days))}d",
        "maxrecords": str(max(10, min(50, max_items))),
        "sort": "hybridrel",
    }
    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT_SEC) as http:
            resp = await http.get("https://api.gdeltproject.org/api/v2/doc/doc", params=params)
            resp.raise_for_status()
            # GDELT sometimes replies text/html error pages with HTTP 200.
            payload = resp.json()
    except Exception as exc:
        logger.warning("[STARTUP_INTEL] gdelt fetch failed: %s", exc)
        note = ("GDELT timed out — news/trend signal unavailable this run"
                if _is_timeout(exc)
                else "GDELT unavailable — news/trend signal missing this run")
        return CollectorResult("gdelt", STATUS_UNAVAILABLE, note=note)

    signals: list[RawSignal] = []
    seen: set[str] = set()
    for art in (payload.get("articles") or [])[:max_items]:
        url = art.get("url") or ""
        title = art.get("title") or ""
        if not url or not title or url in seen:
            continue
        seen.add(url)
        # seendate format: 20260701T120000Z → ISO
        seendate = art.get("seendate") or ""
        published = None
        try:
            published = datetime.strptime(seendate, "%Y%m%dT%H%M%SZ") \
                .replace(tzinfo=timezone.utc).isoformat()
        except Exception:
            pass
        signals.append(RawSignal(
            source="gdelt",
            title=_clip(title, 160),
            url=url,
            published_at=published,
            # News headlines are trend context, not user complaints.
            quality=0.35,
        ))

    if signals:
        return CollectorResult("gdelt", STATUS_AVAILABLE, signals=signals)
    return CollectorResult("gdelt", STATUS_UNAVAILABLE,
                           note="no GDELT articles matched — news/trend signal empty this run")


# ── Reddit (OAuth client-credentials — optional) ────────────────────────────

async def collect_reddit(query: str, timeframe_days: int, max_items: int) -> CollectorResult:
    client_id = os.getenv("REDDIT_CLIENT_ID", "").strip()
    client_secret = os.getenv("REDDIT_CLIENT_SECRET", "").strip()
    if not client_id or not client_secret:
        return CollectorResult(
            "reddit", STATUS_SKIPPED,
            note="Reddit not configured — community complaint signal skipped "
                 "(set REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET).",
        )

    try:
        import httpx
    except Exception as exc:
        return CollectorResult("reddit", STATUS_UNAVAILABLE,
                               note=f"httpx unavailable: {exc}")

    t_param = "week" if timeframe_days <= 7 else ("month" if timeframe_days <= 31 else "year")
    headers = {"User-Agent": "korvix-startup-radar/1.0"}
    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT_SEC, headers=headers) as http:
            token_resp = await http.post(
                "https://www.reddit.com/api/v1/access_token",
                data={"grant_type": "client_credentials"},
                auth=(client_id, client_secret),
            )
            token_resp.raise_for_status()
            token = (token_resp.json() or {}).get("access_token") or ""
            if not token:
                return CollectorResult("reddit", STATUS_UNAVAILABLE,
                                       note="Reddit auth returned no token")
            search_resp = await http.get(
                "https://oauth.reddit.com/search",
                params={
                    "q": f"{query} (complaint OR problem OR alternative OR hate)",
                    "sort": "relevance",
                    "t": t_param,
                    "limit": str(max(10, min(50, max_items))),
                    "type": "link",
                },
                headers={**headers, "Authorization": f"Bearer {token}"},
            )
            search_resp.raise_for_status()
            payload = search_resp.json()
    except Exception as exc:
        logger.warning("[STARTUP_INTEL] reddit fetch failed: %s", exc)
        return CollectorResult("reddit", STATUS_UNAVAILABLE,
                               note=f"Reddit search failed: {type(exc).__name__}")

    signals: list[RawSignal] = []
    for child in ((payload.get("data") or {}).get("children") or [])[:max_items]:
        d = child.get("data") or {}
        permalink = d.get("permalink") or ""
        if not permalink:
            continue
        signals.append(RawSignal(
            source="reddit",
            title=_clip(d.get("title") or "", 160),
            text=_clip(d.get("selftext") or ""),
            url=f"https://www.reddit.com{permalink}",
            published_at=_iso(d.get("created_utc")),
            engagement=int(d.get("score") or 0) + int(d.get("num_comments") or 0),
            # Community posts are first-hand complaint territory.
            quality=0.85 if d.get("selftext") else 0.7,
        ))

    if signals:
        return CollectorResult("reddit", STATUS_AVAILABLE, signals=signals)
    return CollectorResult("reddit", STATUS_UNAVAILABLE,
                           note="no Reddit posts matched — community complaint signal empty this run")


# ── Product Hunt (GraphQL v2 — optional) ────────────────────────────────────

async def collect_producthunt(query: str, timeframe_days: int, max_items: int) -> CollectorResult:
    token = os.getenv("PRODUCTHUNT_TOKEN", "").strip()
    if not token:
        return CollectorResult(
            "producthunt", STATUS_SKIPPED,
            note="Product Hunt not configured — launch signal skipped "
                 "(set PRODUCTHUNT_TOKEN).",
        )

    try:
        import httpx
    except Exception as exc:
        return CollectorResult("producthunt", STATUS_UNAVAILABLE,
                               note=f"httpx unavailable: {exc}")

    # The public PH API has no keyword search on posts — we fetch recent
    # launches in the timeframe and keyword-match locally. That's honest:
    # signal = "recent PH launches matching the niche", nothing more.
    posted_after = (datetime.now(timezone.utc)
                    - timedelta(days=max(1, min(90, timeframe_days)))).isoformat()
    gql = {
        "query": """
            query($after: DateTime!) {
              posts(first: 50, order: VOTES, postedAfter: $after) {
                nodes {
                  name tagline description url votesCount commentsCount createdAt
                }
              }
            }
        """,
        "variables": {"after": posted_after},
    }
    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT_SEC) as http:
            resp = await http.post(
                "https://api.producthunt.com/v2/api/graphql",
                json=gql,
                headers={"Authorization": f"Bearer {token}"},
            )
            resp.raise_for_status()
            payload = resp.json()
    except Exception as exc:
        logger.warning("[STARTUP_INTEL] producthunt fetch failed: %s", exc)
        return CollectorResult("producthunt", STATUS_UNAVAILABLE,
                               note=f"Product Hunt query failed: {type(exc).__name__}")

    tokens = [t for t in query.lower().split() if len(t) >= 3]
    signals: list[RawSignal] = []
    nodes = (((payload.get("data") or {}).get("posts") or {}).get("nodes") or [])
    for node in nodes:
        haystack = " ".join([
            node.get("name") or "", node.get("tagline") or "",
            node.get("description") or "",
        ]).lower()
        if tokens and not any(t in haystack for t in tokens):
            continue
        signals.append(RawSignal(
            source="producthunt",
            title=_clip(f"{node.get('name') or ''} — {node.get('tagline') or ''}", 160),
            text=_clip(node.get("description") or ""),
            url=node.get("url") or "",
            published_at=node.get("createdAt"),
            engagement=int(node.get("votesCount") or 0) + int(node.get("commentsCount") or 0),
            # Launch copy signals market activity, not complaints.
            quality=0.5,
        ))
        if len(signals) >= max_items:
            break

    if signals:
        return CollectorResult("producthunt", STATUS_AVAILABLE, signals=signals)
    return CollectorResult("producthunt", STATUS_UNAVAILABLE,
                           note="no recent PH launches matched the niche")


# ── Fan-out ─────────────────────────────────────────────────────────────────

_COLLECTORS = {
    "web": collect_web,
    "hackernews": collect_hackernews,
    "gdelt": collect_gdelt,
    "reddit": collect_reddit,
    "producthunt": collect_producthunt,
}


async def collect_all(
    query: str,
    timeframe_days: int,
    sources: list[str],
    max_items: int,
) -> dict[str, CollectorResult]:
    """Run requested collectors concurrently. Sources NOT requested are
    marked "skipped". A collector crash is downgraded to "unavailable" —
    one dead source never kills the radar."""
    requested = [s for s in _COLLECTORS if s in sources]
    per_source = max(10, max_items // max(1, len(requested))) if requested else 0

    async def _run(source: str) -> CollectorResult:
        try:
            return await _COLLECTORS[source](query, timeframe_days, per_source)
        except Exception as exc:  # absolute backstop — collectors shouldn't raise
            logger.warning("[STARTUP_INTEL] collector %s crashed: %s", source, exc)
            return CollectorResult(source, STATUS_UNAVAILABLE,
                                   note=f"collector error: {type(exc).__name__}")

    results = await asyncio.gather(*[_run(s) for s in requested])
    out = {r.source: r for r in results}
    for source in _COLLECTORS:
        if source not in out:
            out[source] = CollectorResult(source, STATUS_SKIPPED,
                                          note="source not selected")
    return out


__all__ = ["collect_all"]
