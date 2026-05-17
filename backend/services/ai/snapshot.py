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
    """Whole-word/phrase match. Substring matching is wrong here: bare
    'sl' would hit 'tsla', 'tp' would hit countless tokens. \\b around
    each escaped keyword (works across spaces for phrases like
    'ne kadar')."""
    for kw in keywords:
        if re.search(r"\b" + re.escape(kw) + r"\b", text):
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
