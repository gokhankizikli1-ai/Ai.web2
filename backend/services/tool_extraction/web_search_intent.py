# coding: utf-8
"""Phase 11 fix — intent-based web search auto-invocation.

When the user asks a question that REQUIRES current information
(latest news, today's prices, competitor research, etc.) but doesn't
paste a URL, the existing browser_fetch path doesn't fire and the
LLM falls back to "I can't access the internet" templates.

This module fixes that by detecting search-INTENT in the user's
message and auto-invoking the `web_research` tool (Tavily-backed)
BEFORE the LLM stream opens. Results are folded into the prompt
with the same assertive framing + dual-injection pattern that
made the GitHub and browser fixes work.

Activation chain (any link missing → no-op, LLM behaves as before):
  ENABLE_TOOLS=true            (master)
  ENABLE_WEB_RESEARCH=true     (per-tool flag from Phase 4D)
  WEB_RESEARCH_PROVIDER=tavily (provider selection)
  TAVILY_API_KEY=<key>         (provider auth)

Intent detection is regex+keyword based, multilingual (EN + TR).
Designed to be CONSERVATIVE — false negatives (treating a
search-worthy query as plain chat) are cheaper than false
positives (burning Tavily credits on small talk).
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Optional


logger = logging.getLogger(__name__)


# ── Intent signals ────────────────────────────────────────────────────────
#
# Three families:
#   - TEMPORAL  →  "current", "today", "latest", "right now" etc.
#                  Almost always implies fresh-data need.
#   - RESEARCH  →  "compare", "research", "analyze", "find me",
#                  "what's the price", "trends in".
#   - DOMAIN    →  "stock", "news", "competitor", "university",
#                  "pricing", "startup", "trend report" — domain
#                  cues that typically need external sources.
#
# Multilingual: every English signal has its TR / common transliterated
# counterpart so a Turkish-speaking user gets the same auto-invocation.

_TEMPORAL_SIGNALS: tuple[str, ...] = (
    # English
    "latest", "today", "today's", "current", "currently", "right now",
    "this week", "this month", "this year",
    "recently", "recent", "live", "happening now", "breaking",
    "as of", "right now", "real-time", "real time", "realtime",
    # Turkish
    "bugün", "bugünkü", "şu an", "şu anki", "şimdi", "şimdiki",
    "güncel", "günümüzdeki", "son", "son durum", "en son",
    "geçen hafta", "bu hafta", "bu ay", "bu yıl",
    "anlık", "canlı", "gerçek zamanlı", "yakın zamanda",
)

# Phrases that EXPLICITLY ask the assistant to search the web. Highest
# weight — these alone should trigger regardless of other signals.
_EXPLICIT_SEARCH_PHRASES: tuple[str, ...] = (
    # English
    "search the web", "search online", "look up online", "look up on the web",
    "google it", "google for", "find online", "search for",
    "browse the web", "check online",
    # Turkish
    "internetten araştır", "webden bul", "webde ara", "internetten ara",
    "online araştır", "googleda ara", "google'da ara",
    "internetten bilgi", "internetten kontrol et",
)

# Research / analysis verbs.
_RESEARCH_SIGNALS: tuple[str, ...] = (
    "compare", "comparison", "vs", "versus",
    "research", "analyze", "analysis", "analyse",
    "trends in", "trend report", "market analysis", "market trends",
    "competitor analysis", "competitor research", "competitors of",
    "industry overview", "industry analysis",
    "best ", "top 10 ", "top 5 ", "top 3 ",
    "review of", "reviews of",
    # Phase 11 final — production-observed phrasings the user listed.
    "startup research", "company research", "company analysis",
    "website analysis", "site analysis", "site audit",
    "ecommerce trends", "saas trends", "ai tools",
    "ai startup", "ai startups", "university comparison",
    "pricing research", "pricing analysis", "stock analysis",
    "find the best", "what are the best", "which is the best",
    "summarise", "summarize", "summary of", "tldr of",
    # Turkish
    "karşılaştır", "kıyasla", "karşılaştırma",
    "araştır", "araştırma", "analiz et", "analiz",
    "rapor", "raporu",
    "rakip", "rakipler", "rakip analiz",
    "trend", "trendler", "pazar analiz", "pazar trend",
    "en iyi ", "ilk 10", "ilk 5", "ilk 3",
    "şirket araştırması", "üniversite karşılaştırması",
    "fiyat analizi", "pazar araştırması",
)

# Domain words that almost always imply external sources.
_DOMAIN_SIGNALS: tuple[str, ...] = (
    "news", "headlines", "breaking news", "press release",
    "stock price", "share price", "market cap", "earnings",
    "pricing", "price of", "how much does", "how much is",
    "competitor", "competitors",
    "university", "universities", "college ranking",
    "startup", "saas tools", "ai tools", "best tools",
    "documentation", "docs for",
    "weather", "forecast",
    # Phase 11 final — common domain words the user listed.
    "company", "industry", "market", "sector",
    "saas", "platform", "service", "vendor",
    "website", "landing page",
    # Turkish
    "haber", "haberler", "manşet",
    "hisse", "borsa", "piyasa değeri", "kâr açıklaması",
    "fiyat", "ne kadar", "kaç tl", "kaç para",
    "üniversite", "üniversiteler",
    "girişim", "yapay zeka aracı", "ai aracı",
    "dokümantasyon", "doküman",
    "hava durumu",
    "şirket", "sektör", "pazar",
    "web sitesi", "site",
)


# Phrases that NEGATE the intent — when present, even strong temporal
# signals shouldn't fire (e.g. "tell me a joke about today's weather"
# is small talk, not research).
_NEGATIVE_PATTERNS: tuple[str, ...] = (
    r"\btell me a joke\b",
    r"\bwrite (?:a |me )?(?:poem|story|haiku|essay)\b",
    r"\bunit test\b",          # likely a coding question, not research
    r"\bbir şaka\b",           # TR "a joke"
    # Phase 11 final — after threshold dropped to 0.4, short
    # "Hello, how are you today?" started false-firing. Greetings
    # ending in a question mark with < 8 words are chitchat.
    r"^\s*(hello|hi|hey|merhaba|selam|good morning|good afternoon|"
    r"good evening|günaydın|iyi günler|iyi akşamlar)[,!.\s]",
)


# ── Result ────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class WebSearchIntent:
    triggered:   bool
    confidence:  float       # 0-1; >= 0.5 triggers auto-invocation
    triggers:    tuple[str, ...]  # which signals fired (for logging)
    query:       str         # cleaned query to send to web_research
    reason:      str         # short human-readable explanation


def _contains_any(text_lower: str, phrases: tuple[str, ...]) -> list[str]:
    return [p for p in phrases if p in text_lower]


def detect_web_search_intent(user_message: str) -> WebSearchIntent:
    """Decide whether to auto-invoke web_research for this turn.

    Returns a WebSearchIntent with `triggered=True` when the signal
    is strong enough. Conservative — when in doubt, don't fire.
    """
    if not user_message or not user_message.strip():
        return WebSearchIntent(False, 0.0, (), "", "empty message")
    text = user_message.strip()
    # Turkish-aware lowering. Python's default `.lower()` of the
    # Turkish capital İ produces "i + COMBINING DOT ABOVE" instead of
    # plain "i", which would break exact-string matches against our
    # trigger list ("internetten araştır" wouldn't fire on
    # "İnternetten araştır"). Normalising the combining sequence
    # restores the match.
    lower = text.lower().replace("i̇", "i")

    # Negative patterns short-circuit — "tell me a joke about today" is
    # not a research request.
    for neg in _NEGATIVE_PATTERNS:
        if re.search(neg, lower, flags=re.IGNORECASE):
            return WebSearchIntent(False, 0.0, (), text,
                                   f"negative pattern: {neg}")

    # Explicit search phrases are the strongest signal.
    explicit_hits = _contains_any(lower, _EXPLICIT_SEARCH_PHRASES)
    if explicit_hits:
        return WebSearchIntent(
            True, 0.95, tuple(explicit_hits[:3]),
            text, f"explicit search phrase: {explicit_hits[0]}",
        )

    # Score: temporal + research + domain signals each add weight.
    temporal = _contains_any(lower, _TEMPORAL_SIGNALS)
    research = _contains_any(lower, _RESEARCH_SIGNALS)
    domain   = _contains_any(lower, _DOMAIN_SIGNALS)

    score = 0.0
    triggers: list[str] = []
    if temporal:
        score += 0.45
        triggers.extend(temporal[:2])
    if research:
        score += 0.40
        triggers.extend(research[:2])
    if domain:
        score += 0.30
        triggers.extend(domain[:2])

    # Length bonus — a 20+ word question is more likely to be a real
    # research request than chit-chat. Length alone never triggers.
    word_count = len(re.findall(r"\S+", text))
    if word_count >= 20:
        score += 0.10

    # Phase 11 final — lowered from 0.5 to 0.4 after production
    # observation that prompts like "ai tools 2026" / "company
    # research on Stripe" scored exactly 0.30-0.40 from a single
    # domain hit. False positives are still cheap (one Tavily call)
    # compared to false negatives (LLM returns the bad fallback
    # template).
    triggered = score >= 0.4
    return WebSearchIntent(
        triggered=  triggered,
        confidence= min(1.0, round(score, 2)),
        triggers=   tuple(triggers[:6]),
        query=      text,
        reason=(
            f"score={score:.2f} "
            f"(temporal={len(temporal)}, research={len(research)}, "
            f"domain={len(domain)}, words={word_count})"
        ),
    )


# ── Block builder ─────────────────────────────────────────────────────────

# Aggregate budget; web_research returns up to 10 citations + an
# answer string. Trim to fit the prompt.
_TOTAL_CHAR_CAP = 14_000
_DEFAULT_MAX_RESULTS = 5


async def build_web_search_context_block(
    *,
    user_id:        Optional[str],
    query:          str,
    triggers:       tuple[str, ...],
    panel_id:       Optional[str] = None,
    project_id:     Optional[str] = None,
    correlation_id: Optional[str] = None,
    owner_debug:    bool = False,
) -> tuple[Optional[str], dict]:
    """Invoke web_research and return `(block, raw_payload)`.

    `raw_payload` carries:
      { triggered: True, query, triggers, citations: [...], answer,
        provider, fetched: bool, error?: str }

    Returns `(None, {triggered: False, ...})` when:
      - web_research tool not enabled,
      - provider not configured (no TAVILY_API_KEY),
      - search returned no usable results.
    """
    if not query:
        return None, {"triggered": False, "reason": "empty query"}

    try:
        from backend.services.tools.tool_registry import is_enabled, get_tool
        from backend.services.tool_executions import client as exec_client
    except Exception as e:
        logger.warning("web_search: import failed: %s", e)
        return None, {"triggered": False, "reason": f"import error: {e}"}

    if not is_enabled("web_research"):
        return None, {"triggered": False, "reason": "ENABLE_WEB_RESEARCH=false"}

    tool = get_tool("web_research")
    if tool is None:
        return None, {"triggered": False, "reason": "web_research tool not registered"}

    envelope: dict = {}
    # 1) Initial call, logged through the execution layer.
    with exec_client.record_run(
        user_id=        user_id or "anonymous",
        tool_id=        "web_research",
        input_summary=  f"search: {query[:120]}",
        input_payload=  {"query": query, "caller": "chat_auto",
                         "triggers": list(triggers)},
        caller=         "system",
        panel_id=       panel_id,
        project_id=     project_id,
        correlation_id= correlation_id,
    ) as run:
        try:
            envelope = await tool.safe_run(query, {
                "query": query,
                "max_results": _DEFAULT_MAX_RESULTS,
                "depth": "basic",
            })
        except Exception as exc:
            run.failure("TOOL_RAISED", str(exc) or "web_research raised")
            envelope = {}
        status = (envelope or {}).get("status") or "error"
        provider = (envelope or {}).get("provider")
        if status == "available":
            run.success(output=envelope, provider=provider,
                        cost_estimate=float(getattr(tool, "cost_estimate", 0.0)))
        elif status == "unavailable":
            run.failure("TOOL_UNAVAILABLE",
                        (envelope or {}).get("message") or "unavailable",
                        provider=provider)
        else:
            run.failure("TOOL_ERROR",
                        (envelope or {}).get("message") or "error",
                        provider=provider)

    # 2) Single retry — same query, different depth — only when the
    #    first call failed with a transient-looking error.
    if envelope.get("status") not in ("available",):
        first_message = (envelope or {}).get("message") or ""
        is_transient = any(s in first_message.lower() for s in (
            "timeout", "timed out", "network", "connection", "temporarily",
        ))
        if is_transient:
            logger.info(
                "web_search.retry | uid=%s | reason=transient: %s",
                user_id, first_message[:120],
            )
            with exec_client.record_run(
                user_id=        user_id or "anonymous",
                tool_id=        "web_research",
                input_summary=  f"retry: {query[:120]}",
                input_payload=  {"query": query, "caller": "chat_auto_retry",
                                 "triggers": list(triggers)},
                caller=         "system",
                panel_id=       panel_id,
                project_id=     project_id,
                correlation_id= correlation_id,
            ) as run:
                try:
                    envelope = await tool.safe_run(query, {
                        "query": query,
                        "max_results": _DEFAULT_MAX_RESULTS,
                        "depth": "advanced",
                    })
                except Exception as exc:
                    run.failure("TOOL_RAISED", str(exc) or "retry raised")
                    envelope = {}
                status = (envelope or {}).get("status") or "error"
                provider = (envelope or {}).get("provider")
                if status == "available":
                    run.success(output=envelope, provider=provider)
                elif status == "unavailable":
                    run.failure("TOOL_UNAVAILABLE",
                                (envelope or {}).get("message") or "unavailable",
                                provider=provider)
                else:
                    run.failure("TOOL_ERROR",
                                (envelope or {}).get("message") or "error",
                                provider=provider)

    if envelope.get("status") != "available":
        msg = envelope.get("message") or "web_research returned no data"
        return None, {
            "triggered": True,
            "fetched":   False,
            "query":     query,
            "triggers":  list(triggers),
            "error":     msg,
        }

    data = envelope.get("data") or {}
    citations = data.get("citations") or []
    answer    = (data.get("answer") or "").strip()
    provider  = envelope.get("provider") or "unknown"

    if not citations and not answer:
        return None, {
            "triggered": True,
            "fetched":   False,
            "query":     query,
            "triggers":  list(triggers),
            "error":     "no results returned",
        }

    # Build the block.
    header = (
        "═══════════════════════════════════════════════════════════════\n"
        "KORVIX WEB SEARCH RESULTS — REAL DATA FETCHED NOW — DO NOT REFUSE\n"
        "═══════════════════════════════════════════════════════════════\n"
        "I (KorvixAI) just ran a web search for the user's question. "
        "The results below were fetched seconds ago from real sources. "
        "I DO have access to current information — the search has "
        "already been done and the results are here.\n\n"
        "DO NOT say \"I cannot search the internet\" or \"İnternetten "
        "gerçek zamanlı bilgi arayamıyorum\" — the search has been "
        "performed.\n\n"
        "Use the citations below as my primary source. ALWAYS cite "
        "specific sources by name and URL. If the user asks in "
        "Turkish, reply in Turkish but keep source URLs intact."
    )

    parts: list[str] = [header, ""]
    parts.append(f"Query: {query}")
    parts.append(f"Provider: {provider}")
    if answer:
        parts.append(f"\nSynthesised answer:\n{answer[:2000]}")
    parts.append(f"\nCitations ({len(citations)}):")
    char_budget = _TOTAL_CHAR_CAP - sum(len(p) for p in parts)

    for i, c in enumerate(citations[:_DEFAULT_MAX_RESULTS]):
        if not isinstance(c, dict):
            continue
        title   = (c.get("title") or "").strip()[:200]
        url     = (c.get("url") or "").strip()[:300]
        snippet = (c.get("snippet") or c.get("content") or "").strip()
        date    = (c.get("published_date") or c.get("date") or "")
        if not (title or url):
            continue
        # Per-citation budget — ~2 KB each.
        if len(snippet) > 1500:
            snippet = snippet[:1500] + "…"
        line = (
            f"\n  [{i + 1}] {title}\n"
            f"      url: {url}\n"
            f"      date: {date}\n"
            f"      excerpt: {snippet}"
        )
        if len(line) > char_budget:
            parts.append("\n  [...remaining citations truncated by context budget]")
            break
        parts.append(line)
        char_budget -= len(line)

    block = "\n".join(parts)

    raw_payload = {
        "triggered": True,
        "fetched":   True,
        "query":     query,
        "triggers":  list(triggers),
        "provider":  provider,
        "answer":    answer if owner_debug else (answer[:200] + ("…" if len(answer) > 200 else "")),
        "citations": (
            citations if owner_debug
            else [{"title": c.get("title"), "url": c.get("url"),
                   "date":  c.get("published_date") or c.get("date")}
                  for c in citations if isinstance(c, dict)]
        ),
        "count": len(citations),
    }

    logger.info(
        "web_search.build | uid=%s | query=%s | citations=%d | "
        "provider=%s | block_chars=%d",
        user_id, query[:80], len(citations), provider, len(block),
    )
    return block, raw_payload


__all__ = [
    "WebSearchIntent",
    "detect_web_search_intent",
    "build_web_search_context_block",
]
