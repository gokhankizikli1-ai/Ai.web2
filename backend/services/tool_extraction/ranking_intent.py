# coding: utf-8
"""Phase 11 — Ranking intent detection + structured context block.

When the user asks about university rankings ("QS World University
Rankings", "top universities for AI", "üniversite sıralaması") the
chat path should route through the structured `university_rankings`
tool (Wikipedia tables) — NOT generic web_research, which returns
unranked Tavily snippets the LLM has to re-rank by hand and often
hallucinates around.

Two surfaces:
  detect_ranking_intent(text) → RankingIntent | None
  build_rankings_context_block(user_id, intent, ...) → (block, payload)
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Optional


logger = logging.getLogger(__name__)


# ── Ranking systems we know how to fetch ──────────────────────────────────

# Each entry: regex pattern → canonical key for the tool. Patterns are
# multilingual; the key matches services/tools/university_rankings_tool
# _SOURCES.
_RANKING_PATTERNS: tuple[tuple[str, str], ...] = (
    # QS — most commonly named explicitly
    (r"\bqs\b.{0,30}(world|university|ranking|sıralama|tier)", "qs"),
    (r"\bqs world university\b",                                 "qs"),
    (r"\bqs sıralama",                                           "qs"),
    # THE = Times Higher Education
    (r"\btimes higher education\b",                              "the"),
    (r"\bthe (world )?university rank",                          "the"),
    (r"\bthe world ranking",                                     "the"),
    # ARWU / Shanghai
    (r"\barwu\b",                                                "arwu"),
    (r"\bshanghai ranking",                                      "arwu"),
    (r"\bacademic ranking of world universities\b",              "arwu"),
    # US News
    (r"\bus news\b.{0,30}(best|global|university)",              "us_news"),
    # CWUR
    (r"\bcwur\b",                                                "cwur"),
    (r"\bcenter for world university rankings\b",                "cwur"),
)


# Generic "top universities" / "best universities" / "üniversite
# sıralaması" — when the user doesn't name a system, default to QS
# (most-cited globally, most-recognised brand).
_GENERIC_PATTERNS: tuple[str, ...] = (
    r"\btop \d+ universit(?:y|ies)\b",
    r"\bbest universit(?:y|ies)\b",
    r"\bworld university rank",
    r"\buniversity rankings?\b",
    r"\bdünya(?:nın)? en iyi üniversit",
    r"\büniversite sıralaması",
    r"\büniversite sıralama",
    r"\ben iyi \d+ üniversit",
)


# Negative patterns — phrases that pattern-match "university" but
# AREN'T about rankings ("which university did Einstein attend").
_NEGATIVE_PATTERNS: tuple[str, ...] = (
    r"\bwhich university did\b",
    r"\buniversity of [A-Z]",       # asking about a specific named one
    r"\bhangi üniversiteye gitti",
)


@dataclass(frozen=True)
class RankingIntent:
    triggered:  bool
    system:     str               # "qs" | "the" | "arwu" | "us_news" | "cwur"
    limit:      int               # top N requested
    country:    Optional[str]     # optional country filter
    reason:     str
    triggers:   tuple[str, ...] = field(default_factory=tuple)


def _detect_country(text: str) -> Optional[str]:
    """Very lightweight country detector — only matches well-known
    English / Turkish country tokens to avoid false positives. The
    tool itself does substring matching, so we just need a coarse
    keyword.
    """
    lower = text.lower()
    for pat, country in (
        (r"\b(?:usa|united states|america|amerika|abd)\b", "United States"),
        (r"\b(?:uk|united kingdom|britain|britanya|i?ngiltere)\b", "United Kingdom"),
        (r"\bturkey\b|\btürki(?:ye|y)\b",                  "Turkey"),
        (r"\bgermany\b|\balmanya\b",                       "Germany"),
        (r"\bfrance\b|\bfransa\b",                         "France"),
        (r"\bcanada\b|\bkanada\b",                         "Canada"),
        (r"\baustralia\b|\bavustralya\b",                  "Australia"),
        (r"\bchina\b|\bçin\b",                             "China"),
        (r"\bjapan\b|\bjaponya\b",                         "Japan"),
        (r"\bsouth korea\b|\bgüney kore\b",                "South Korea"),
        (r"\bsingapore\b|\bsingapur\b",                    "Singapore"),
        (r"\bswitzerland\b|\bi̇sviçre\b|\bisviçre\b",      "Switzerland"),
        (r"\bnetherlands\b|\bhollanda\b",                  "Netherlands"),
        (r"\bspain\b|\bispanya\b",                         "Spain"),
        (r"\bitaly\b|\bi̇talya\b|\bitalya\b",              "Italy"),
        (r"\bindia\b|\bhindistan\b",                       "India"),
    ):
        if re.search(pat, lower, flags=re.IGNORECASE):
            return country
    return None


def _detect_limit(text: str) -> int:
    """Pull out 'top N' / 'ilk N' if present. Default 10."""
    m = re.search(r"\btop\s+(\d{1,3})\b", text, flags=re.IGNORECASE)
    if m:
        return max(1, min(int(m.group(1)), 100))
    m = re.search(r"\bilk\s+(\d{1,3})\b", text, flags=re.IGNORECASE)
    if m:
        return max(1, min(int(m.group(1)), 100))
    m = re.search(r"\ben iyi\s+(\d{1,3})\b", text, flags=re.IGNORECASE)
    if m:
        return max(1, min(int(m.group(1)), 100))
    return 10


def detect_ranking_intent(user_message: str) -> Optional[RankingIntent]:
    """Return a RankingIntent when the user is clearly asking for a
    university ranking. Returns None when the message is something
    else — callers fall back to the general web_search path."""
    if not user_message:
        return None
    text = user_message.strip()
    # Turkish-aware lower — mirror the trick from web_search_intent.
    lower = text.lower().replace("i̇", "i")

    # Negative gate.
    for neg in _NEGATIVE_PATTERNS:
        if re.search(neg, lower):
            return None

    # 1) Specific-system patterns win on confidence.
    triggers: list[str] = []
    system: Optional[str] = None
    for pat, key in _RANKING_PATTERNS:
        if re.search(pat, lower, flags=re.IGNORECASE | re.DOTALL):
            system = key
            triggers.append(pat)
            break

    # 2) Generic "university ranking" → default to QS.
    if system is None:
        for pat in _GENERIC_PATTERNS:
            if re.search(pat, lower, flags=re.IGNORECASE):
                system = "qs"
                triggers.append(pat)
                break

    if system is None:
        return None

    limit   = _detect_limit(text)
    country = _detect_country(text)

    return RankingIntent(
        triggered= True,
        system=    system,
        limit=     limit,
        country=   country,
        reason=    f"matched: {triggers[0]}",
        triggers=  tuple(triggers[:3]),
    )


# ── Context block builder ────────────────────────────────────────────────

# Aggregate cap mirrors the other builders so the prompt stays small.
_BLOCK_MAX_CHARS = 6_000


async def build_rankings_context_block(
    *,
    user_id:        Optional[str],
    intent:         RankingIntent,
    panel_id:       Optional[str] = None,
    project_id:     Optional[str] = None,
    correlation_id: Optional[str] = None,
    owner_debug:    bool = False,
) -> tuple[Optional[str], dict]:
    """Invoke the university_rankings tool and produce a ground-truth
    block for the LLM prompt. Returns (None, payload) on failure so
    the route emits its honest "tool attempted, no data" path."""
    try:
        from backend.services.tools.tool_registry import is_enabled, get_tool
        from backend.services.tool_executions import client as exec_client
        from backend.services.tool_extraction._safe_run import safe_run_with_timeout
    except Exception as e:
        logger.warning("ranking_intent imports failed: %s", e)
        return None, {"triggered": True, "fetched": False,
                      "reason": f"import error: {e}"}

    if not is_enabled("university_rankings"):
        return None, {"triggered": True, "fetched": False,
                      "reason": "ENABLE_UNIVERSITY_RANKINGS=false"}

    tool = get_tool("university_rankings")
    if tool is None:
        return None, {"triggered": True, "fetched": False,
                      "reason": "university_rankings tool not registered"}

    envelope: dict = {}
    with exec_client.record_run(
        user_id=        user_id or "anonymous",
        tool_id=        "university_rankings",
        input_summary=  f"ranking: {intent.system} | top {intent.limit}"
                       + (f" | {intent.country}" if intent.country else ""),
        input_payload=  {
            "ranking": intent.system, "limit": intent.limit,
            "country": intent.country, "caller": "chat_auto",
        },
        caller=         "system",
        panel_id=       panel_id,
        project_id=     project_id,
        correlation_id= correlation_id,
    ) as run:
        envelope = await safe_run_with_timeout(
            tool, intent.system, {
                "ranking": intent.system,
                "limit":   intent.limit,
                "country": intent.country,
            },
            override_timeout=12.0,
        )
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

    if envelope.get("status") != "available":
        msg = envelope.get("message") or "rankings tool returned no data"
        return None, {
            "triggered": True,
            "fetched":   False,
            "system":    intent.system,
            "limit":     intent.limit,
            "country":   intent.country,
            "reason":    msg,
        }

    data = envelope.get("data") or {}
    rows = data.get("rows") or []
    if not rows:
        return None, {
            "triggered": True,
            "fetched":   False,
            "system":    intent.system,
            "limit":     intent.limit,
            "country":   intent.country,
            "reason":    "no rows returned",
        }

    # ── Compose the assertive block ────────────────────────────────────
    header = (
        "═══════════════════════════════════════════════════════════════\n"
        "KORVIX RANKINGS TOOL — STRUCTURED DATA FROM WIKIPEDIA — DO NOT REFUSE\n"
        "═══════════════════════════════════════════════════════════════\n"
        f"I (KorvixAI) just fetched the {data.get('source_label', intent.system.upper())} "
        f"ranking table from Wikipedia. The rows below are EXACT entries "
        f"from the live page. I DO have this data.\n\n"
        "DO NOT invent ranks, scores, or universities outside this list. "
        "When the user asks for the top N, cite by rank.\n"
    )

    parts: list[str] = [header]
    parts.append(f"Source: {data.get('source_url')}")
    parts.append(f"System:  {data.get('source_label')}")
    parts.append(f"Returned: {data.get('returned')} of {data.get('total_rows')} total rows")
    if intent.country:
        parts.append(f"Country filter applied: {intent.country}")
    parts.append("")
    parts.append("| Rank | University | Country | Score |")
    parts.append("|------|------------|---------|-------|")
    for r in rows:
        rk    = r.get("rank")
        name  = (r.get("name") or "").replace("|", "/")
        ctry  = (r.get("country") or "").replace("|", "/")
        score = r.get("score")
        score_s = f"{score:g}" if isinstance(score, (int, float)) else "—"
        parts.append(f"| {rk} | {name} | {ctry} | {score_s} |")

    block = "\n".join(parts)
    if len(block) > _BLOCK_MAX_CHARS:
        block = block[:_BLOCK_MAX_CHARS] + "\n\n[truncated by context budget]"

    raw_payload = {
        "triggered":   True,
        "fetched":     True,
        "system":      intent.system,
        "limit":       intent.limit,
        "country":     intent.country,
        "source_url":  data.get("source_url"),
        "returned":    data.get("returned"),
        "total_rows":  data.get("total_rows"),
        # Non-owners get only top-3 in the SSE debug payload to keep
        # the event small; owner gets the full row list.
        "rows": rows if owner_debug else rows[:3],
    }
    logger.info(
        "rankings.build | uid=%s | system=%s | returned=%d | block_chars=%d",
        user_id, intent.system, len(rows), len(block),
    )
    return block, raw_payload


__all__ = [
    "RankingIntent",
    "detect_ranking_intent",
    "build_rankings_context_block",
]
