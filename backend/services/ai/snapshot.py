# coding: utf-8
"""
Phase 8n — concise snapshot for quick price asks (trading_analyst).

trading_analyst normally emits a mandatory 14-section operator report +
a structured JSON block. For a bare "NVDA fiyatı kaç?" that's overkill.
When the message is a short price/quote ask with NO analysis/setup
intent, ai_service appends `SNAPSHOT_DIRECTIVE` to the system prompt to
override the verbose contract for that turn only. Full-analysis requests
are untouched; non-trading modes never see this.

Kept in its own module (no heavy imports) so it is unit-testable without
pulling the OpenAI SDK in via ai_service.
"""
from __future__ import annotations

import re

_QUOTE_INTENT_KW = (
    "price", "fiyat", "kaç", "kac", "ne kadar", "how much", "quote",
    "değeri", "degeri", "worth", "trading at", "son fiyat", "güncel fiyat",
)
_ANALYSIS_KW = (
    "analiz", "analyz", "analysis", "setup", "plan", "strateji", "strategy",
    "entry", "stop", "target", "tp", "sl", "risk", "long mu", "short mu",
    "al mı", "al mi", "sat mı", "sat mi", "yorum", "derin", "detay",
    "detail", "incele", "review", "outlook", "forecast", "tahmin",
    "should i", "trade", "position", "pozisyon", "scenario", "senaryo",
    # Decision/opinion intent — "Is NVDA worth buying?" is analysis, not a
    # bare quote, even though it contains "worth" (Bugbot Medium 084f59c6).
    "buy", "buying", "sell", "selling", "invest", "investing",
)

SNAPSHOT_DIRECTIVE = (
    "\n═════════════════════════════════════════════════════════════\n"
    "QUICK-QUOTE MODE — OVERRIDE THE 14-SECTION FORMAT FOR THIS REPLY:\n"
    "The user only asked for a price/quote. Do NOT produce the 14-section\n"
    "operator report and do NOT emit the structured JSON block. Instead\n"
    "reply with a SHORT snapshot, in the user's language, using ONLY the\n"
    "values present in the [TOOL: MARKET_DATA] block:\n"
    "  • Price + daily % change\n"
    "  • Volume\n"
    "  • RSI-14\n"
    "  • SMA20 / SMA50\n"
    "  • Support / Resistance\n"
    "  • One-line bullish/bearish read (use `bias`/`bias_reason` if given)\n"
    "Rules: NEVER invent a value. If a field is absent from the data\n"
    "block, omit that line or write 'unavailable' — do not estimate.\n"
    "Keep it under ~12 lines. End with one short actionable sentence.\n"
    "If the user later asks for analysis/a setup, give the full report.\n"
    "═════════════════════════════════════════════════════════════\n"
)


def _has_kw(text: str, keywords) -> bool:
    """Word-START anchored match. A trailing \\b would block Turkish
    suffixes — `\\bfiyat\\b` never matches "fiyatı"/"fiyatını" (ı is a
    Unicode word char, so there's no boundary after 't'), silently
    killing quick-quote for the MOST common TR form (Bugbot 426cd270).
    Anchoring only the START still blocks the substring trap (bare 'sl'
    won't match 'tsla' because 'sl' isn't at a word start there) while
    allowing any suffix, and works across spaces for phrases like
    'ne kadar'."""
    for kw in keywords:
        if re.search(r"\b" + re.escape(kw), text):
            return True
    return False


def is_quick_quote_ask(message: str) -> bool:
    """True for a short price/quote question with no analysis/setup intent."""
    if not message:
        return False
    m = message.lower()
    if len(m) > 160:
        return False
    if not _has_kw(m, _QUOTE_INTENT_KW):
        return False
    if _has_kw(m, _ANALYSIS_KW):
        return False
    return True
