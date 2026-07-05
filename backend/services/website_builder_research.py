# coding: utf-8
# Web Build research pre-pass.
#
# For a FRESH website build, before the final website_builder generation call,
# run a small REAL web-research pass so the design strategy is grounded in
# current, live sources instead of the model's static priors. This reuses the
# existing, credit-counted, provider-cascading web_research path
# (build_web_search_context_block → Tavily/Exa/Brave cascade) — no new provider
# client code, no direct coupling to one vendor.
#
# Honesty contract:
#   - We ONLY report did_research=True and return sources when a real tool call
#     returned real citations with URLs.
#   - If web_research is disabled / unconfigured / returns nothing, we return
#     (None, {"did_research": False, ...}) and the caller falls back to internal
#     strategy inference. We never fabricate sources, URLs, or "researched"
#     claims.
#
# The query set is DERIVED DYNAMICALLY from the user's idea (no per-niche
# templates, no example-prompt special cases) — the idea itself plus a couple of
# neutral design/conversion dimensions.
import asyncio
import logging
import re
from typing import Optional

logger = logging.getLogger(__name__)

# Keep the pre-pass cheap + within the build's overall timeout: a few concurrent
# queries, a handful of deduped sources.
_MAX_QUERIES = 3
_MAX_SOURCES = 6


def _extract_idea(message: str) -> str:
    """Pull the raw idea out of the [WEB BUILD REQUEST] wrapper the frontend
    sends. Falls back to a trimmed message. Never raises."""
    if not message:
        return ""
    text = message
    # The frontend appends `Idea: <idea>` as the last meaningful line.
    m = re.search(r"(?im)^\s*Idea:\s*(.+)\s*$", text)
    if m:
        return m.group(1).strip()[:240]
    # Otherwise strip the request scaffolding and take the longest content line.
    lines = [
        ln.strip() for ln in text.splitlines()
        if ln.strip()
        and not ln.strip().startswith(("[", "#", "-", "STEP", "BUILD CONTEXT", "RESEARCH", "MOTION", "COPY"))
    ]
    if lines:
        return max(lines, key=len)[:240]
    return text.strip()[:240]


def _build_queries(idea: str) -> list[str]:
    """Dynamic, idea-derived research queries (generic dimensions — not tied to
    any specific niche or example prompt)."""
    core = (idea or "").strip()
    if not core:
        return []
    queries = [core]
    # Only expand when the idea is short enough to combine cleanly.
    if len(core) <= 90:
        queries.append(f"{core} website design examples")
        queries.append(f"{core} landing page conversion best practices")
    # Dedupe, cap.
    seen: set[str] = set()
    out: list[str] = []
    for q in queries:
        k = q.lower().strip()
        if k and k not in seen:
            seen.add(k)
            out.append(q)
        if len(out) >= _MAX_QUERIES:
            break
    return out


def _norm_citation(c) -> Optional[dict]:
    """Normalize a provider citation (dict) to {title,url,snippet}. Drop entries
    without a real http(s) URL so we never surface a fake/empty source."""
    if not isinstance(c, dict):
        return None
    url = (c.get("url") or "").strip()
    if not re.match(r"^https?://", url, re.I):
        return None
    title = (c.get("title") or c.get("name") or url).strip()
    snippet = (c.get("snippet") or c.get("content") or c.get("answer") or "").strip()
    return {"title": title[:160], "url": url, "snippet": snippet[:280]}


async def run_web_build_research(*, user_id: Optional[str], idea: str) -> tuple[Optional[str], dict]:
    """Run the research pre-pass. Returns (context_block, meta).

    `context_block` is a system-prompt block of REAL sources to inject, or None.
    `meta` = {did_research: bool, queries: [...], sources: [...], source_count: int}.
    Never raises — on any failure returns (None, {"did_research": False, ...}).
    """
    queries = _build_queries(_extract_idea(idea))
    meta: dict = {"did_research": False, "queries": queries, "sources": [], "source_count": 0}
    if not queries:
        return None, meta

    try:
        from backend.services.tool_extraction import build_web_search_context_block
    except Exception as e:
        logger.warning("web_build_research: import failed: %s", e)
        return None, meta

    async def _one(q: str):
        try:
            _block, payload = await build_web_search_context_block(
                user_id=user_id, query=q, triggers=("website_builder_research",),
            )
            return payload or {}
        except Exception as ex:  # noqa: BLE001 — research must never break a build
            logger.info("web_build_research: query failed (%s): %s", q[:60], ex)
            return {}

    results = await asyncio.gather(*[_one(q) for q in queries], return_exceptions=True)

    sources: list[dict] = []
    seen_urls: set[str] = set()
    for r in results:
        if not isinstance(r, dict):
            continue
        for c in (r.get("citations") or []):
            nc = _norm_citation(c)
            if nc and nc["url"] not in seen_urls:
                seen_urls.add(nc["url"])
                sources.append(nc)
            if len(sources) >= _MAX_SOURCES:
                break
        if len(sources) >= _MAX_SOURCES:
            break

    if not sources:
        logger.info("web_build_research: no real sources for idea — strategy-inference fallback")
        return None, meta

    # Build the injection block — REAL sources, inspiration-only, honest citing.
    lines = [
        "[WEB RESEARCH — REAL SOURCES]",
        "These are REAL web search results for this idea. Use them ONLY as",
        "inspiration to ground the strategy (audience, conversion patterns, trust",
        "signals, visual language). Do NOT copy their wording or layouts. In Build",
        "Plan you may cite a source URL ONLY if it appears in this list.",
        f"Queries run: {' | '.join(queries)}",
        "",
    ]
    for i, s in enumerate(sources, 1):
        lines.append(f"{i}. {s['title']} — {s['url']}")
        if s["snippet"]:
            lines.append(f"   {s['snippet']}")
    lines.append("")
    lines.append("Fold these findings into 'Strategy insight' and let them shape the")
    lines.append("sections, copy, trust signals and visual direction.")

    meta.update({"did_research": True, "sources": sources, "source_count": len(sources)})
    logger.info("web_build_research: %d real sources across %d queries", len(sources), len(queries))
    return "\n".join(lines), meta
