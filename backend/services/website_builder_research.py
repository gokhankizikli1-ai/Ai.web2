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
# Observability contract — research must NEVER silently fail. Every call
# returns a rich `meta` that says exactly what happened, so the frontend (and
# the owner/admin debug panel) can distinguish:
#     used_sources  — real providers ran and returned real URLs
#     disabled      — research is turned off / no provider configured
#     failed        — a provider was attempted but errored
#     no_sources    — a provider ran but returned nothing usable
# and, when did_research is False, a human-readable `fallback_reason`.
#
# Honesty contract:
#   - We ONLY report did_research=True and return sources when a real tool call
#     returned real citations with URLs.
#   - We NEVER fabricate sources, URLs, providers, or "researched" claims.
#   - We NEVER log API keys or secrets — only provider names, booleans, counts,
#     and error type/messages.
#
# The query set is DERIVED DYNAMICALLY from the user's idea (no per-niche
# templates, no example-prompt special cases) — the idea itself plus a couple of
# neutral design/conversion dimensions.
import asyncio
import logging
import os
import re
from typing import Optional

logger = logging.getLogger(__name__)

# Keep the pre-pass cheap + within the build's overall timeout: a few concurrent
# queries, a handful of deduped sources.
_MAX_QUERIES = 3
_MAX_SOURCES = 6

# Status values surfaced in meta["status"]. Kept as a small vocabulary the
# frontend maps to honest UI copy.
STATUS_USED = "used_sources"
STATUS_DISABLED = "disabled"
STATUS_FAILED = "failed"
STATUS_NO_SOURCES = "no_sources"


def _meta(
    *,
    status: str,
    did_research: bool = False,
    queries: Optional[list] = None,
    provider: Optional[str] = None,
    attempted: Optional[list] = None,
    sources: Optional[list] = None,
    fallback_reason: Optional[str] = None,
) -> dict:
    """Build the canonical research meta dict. Every field is always present so
    the caller/frontend never has to guess a shape."""
    srcs = sources or []
    return {
        "did_research":        bool(did_research),
        "status":              status,
        "provider":            provider,
        "attempted_providers": list(attempted or []),
        "queries":             list(queries or []),
        "query_count":         len(queries or []),
        "sources":             srcs,
        "source_count":        len(srcs),
        "fallback_reason":     fallback_reason,
    }


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


def _preflight() -> tuple[bool, Optional[str], list[str], bool]:
    """Inspect env + config WITHOUT calling any provider. Returns
    (enabled, disabled_reason, attempted_providers, via_celery).

    `enabled` is False when research is turned off or unconfigured — with a
    precise `disabled_reason` naming the exact blocking flag. `enabled` True
    means it's safe to attempt the real cascade; `attempted_providers` is the
    configured chain (primary + fallbacks) that a call would try.
    """
    try:
        from backend.services.tools.tool_registry import _flag, is_enabled
    except Exception as e:  # noqa: BLE001
        return False, f"tool registry import failed: {e}", [], False

    tools_on = _flag("ENABLE_TOOLS")
    web_on = _flag("ENABLE_WEB_RESEARCH")
    if not tools_on:
        return False, "ENABLE_TOOLS is off", [], False
    if not web_on:
        return False, "ENABLE_WEB_RESEARCH is off", [], False
    if not is_enabled("web_research"):
        # Belt-and-suspenders: registry may gate on something else.
        return False, "web_research tool is not enabled", [], False

    # Provider config — a valid primary is required by the cascade.
    try:
        from backend.services.research.client import (
            active_provider, active_fallbacks,
        )
        primary = active_provider()
        fallbacks = active_fallbacks()
    except Exception as e:  # noqa: BLE001
        return False, f"research client import failed: {e}", [], False

    chain = ([primary] if primary else []) + list(fallbacks)
    if not primary:
        # Cascade fails closed when no primary is set, even if fallbacks exist.
        return False, "WEB_RESEARCH_PROVIDER is not set", chain, False

    try:
        from backend.services.tool_extraction.web_search_intent import (
            _route_research_via_celery,
        )
        via_celery = bool(_route_research_via_celery())
    except Exception:  # noqa: BLE001
        via_celery = False

    return True, None, chain, via_celery


async def run_web_build_research(*, user_id: Optional[str], idea: str) -> tuple[Optional[str], dict]:
    """Run the research pre-pass. Returns (context_block, meta).

    `context_block` is a system-prompt block of REAL sources to inject, or None.
    `meta` is the canonical research dict (see `_meta`) — ALWAYS populated with
    a status + fallback_reason so research can never fail silently.
    Never raises — on any failure returns (None, <meta with status/reason>).
    """
    queries = _build_queries(_extract_idea(idea))
    if not queries:
        logger.info(
            "web_build_research | uid=%s | no idea text to research — strategy fallback",
            user_id,
        )
        return None, _meta(
            status=STATUS_NO_SOURCES,
            queries=[],
            fallback_reason="no idea text to research",
        )

    # ── Preflight: is research even enabled + configured? ────────────────
    enabled, disabled_reason, attempted, via_celery = _preflight()
    logger.info(
        "web_build_research | uid=%s | enabled=%s | via_celery=%s | "
        "attempted=%s | query_count=%d | reason=%s",
        user_id, enabled, via_celery, attempted, len(queries),
        disabled_reason or "-",
    )
    if not enabled:
        return None, _meta(
            status=STATUS_DISABLED,
            queries=queries,
            attempted=attempted,
            fallback_reason=disabled_reason or "web research disabled",
        )

    try:
        from backend.services.tool_extraction import build_web_search_context_block
    except Exception as e:  # noqa: BLE001
        logger.warning("web_build_research | uid=%s | import failed: %s", user_id, e)
        return None, _meta(
            status=STATUS_FAILED,
            queries=queries,
            attempted=attempted,
            fallback_reason=f"search import failed: {type(e).__name__}",
        )

    async def _one(q: str) -> dict:
        try:
            _block, payload = await build_web_search_context_block(
                user_id=user_id, query=q, triggers=("website_builder_research",),
            )
            return payload or {}
        except Exception as ex:  # noqa: BLE001 — research must never break a build
            logger.info(
                "web_build_research | uid=%s | query failed (%s): %s",
                user_id, q[:60], ex,
            )
            return {"error": f"{type(ex).__name__}: {ex}"}

    results = await asyncio.gather(*[_one(q) for q in queries], return_exceptions=True)

    sources: list[dict] = []
    seen_urls: set[str] = set()
    answered_provider: Optional[str] = None
    errors: list[str] = []
    for r in results:
        if not isinstance(r, dict):
            errors.append(str(r)[:120])
            continue
        # Remember which provider actually answered + any failure reason.
        if r.get("provider") and not answered_provider:
            answered_provider = str(r.get("provider"))
        err = r.get("error") or r.get("reason")
        if err:
            errors.append(str(err)[:120])
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
        # Distinguish a real failure (provider errored) from a clean empty.
        reason = errors[0] if errors else "providers returned no usable sources"
        status = STATUS_FAILED if errors else STATUS_NO_SOURCES
        logger.info(
            "web_build_research | uid=%s | did_research=false | status=%s | "
            "provider=%s | attempted=%s | reason=%s",
            user_id, status, answered_provider or "-", attempted, reason,
        )
        return None, _meta(
            status=status,
            queries=queries,
            provider=answered_provider,
            attempted=attempted,
            fallback_reason=reason,
        )

    # Build the injection block — REAL sources synthesized into a structured
    # BUILD INTELLIGENCE brief the final generation must actually USE (not just
    # cite). Sources are inspiration only; never copy wording or layouts.
    lines = [
        "[BUILD INTELLIGENCE — GROUNDED IN LIVE WEB RESEARCH]",
        "I ran REAL web research for this idea. Before writing the build, SYNTHESIZE",
        "these findings into a structured Build Intelligence brief and let it drive",
        "EVERY downstream decision — do not treat research as decoration.",
        "",
        "Derive and then USE these (skip any that don't apply — never invent facts):",
        "  • positioning / core idea / audience / user intent / market category",
        "  • adjacent patterns + conversion patterns worth adopting (not copying)",
        "  • trust barriers → the specific trust signals that answer them",
        "  • emotional tone + visual direction (palette, type, motion, metaphor)",
        "  • section architecture that fits THIS concept + the CTA hierarchy",
        "  • component/visual ideas + a differentiation angle vs. look-alikes",
        "Rules: dedupe overlapping findings; prefer useful patterns over generic",
        "facts; do NOT copy source wording or layouts; cite a source URL in Build",
        "Plan ONLY if it appears in the list below.",
        f"Queries run: {' | '.join(queries)}",
        "",
        "Real sources:",
    ]
    for i, s in enumerate(sources, 1):
        lines.append(f"{i}. {s['title']} — {s['url']}")
        if s["snippet"]:
            lines.append(f"   {s['snippet']}")
    lines.append("")
    lines.append("Fold the synthesis into 'Research insight' in Build Plan, and let it shape")
    lines.append("the sections, copy, CTA hierarchy, trust signals, visual system and motion.")

    logger.info(
        "web_build_research | uid=%s | did_research=true | status=used_sources | "
        "provider=%s | source_count=%d | query_count=%d",
        user_id, answered_provider or "-", len(sources), len(queries),
    )
    return "\n".join(lines), _meta(
        status=STATUS_USED,
        did_research=True,
        queries=queries,
        provider=answered_provider,
        attempted=attempted,
        sources=sources,
    )
