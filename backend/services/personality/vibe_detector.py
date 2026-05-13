# coding: utf-8
"""
Vibe detector — light heuristics on recent user messages.

No LLM call, no network, no I/O. Pure functions over the message text.
The output is a small dict consumed by `context_builder` to populate
the `[KISA BAGLAM]` block prepended to the system prompt.

Output schema:
  {
    "tone":      "casual" | "formal" | "neutral",
    "length":   "short"  | "medium" | "long" | "unknown",
    "emoji_use": "frequent" | "rare" | "none",
    "lang":      "tr" | "en" | "unknown",
  }

Heuristics — intentionally simple. They're a signal, not ground truth.
Bad classifications harm tone matching but never break behaviour: the
model still has the user's actual messages on hand.
"""
from __future__ import annotations

import re
from typing import Iterable, List


# Common BMP / SMP emoji ranges. Doesn't cover everything (skin-tone
# modifiers, regional flags) but enough to detect "this person uses
# emojis a lot" vs "this person uses none."
_EMOJI_RANGES = (
    "\U0001F300-\U0001FAFF"   # Misc symbols/pictographs + extended pictographs
    "\U00002600-\U000027BF"   # Misc dingbats (☀️ ✨ etc.)
    "\U0001F600-\U0001F64F"   # Emoticons
    "\U0001F900-\U0001F9FF"   # Supplemental symbols
)
_EMOJI_PATTERN = re.compile(f"[{_EMOJI_RANGES}]")

# Turkish-specific characters used for a quick language sniff. Includes
# both lowercase AND uppercase forms — the score is computed against the
# original-case text (not the lowercased copy used for tone tokens) so
# messages like "Şimdi", "Çünkü", "Görüyorum" still register.
_TURKISH_CHARS = set("şŞğĞüÜöÖçÇıİ")

# Plain-ASCII Turkish chat words — many users write without diacritics
# (e.g. "selam ya iyiyim"). Each hit adds to the Turkish-language
# score so we don't classify those messages as English.
# NOTE: keep tokens unique and non-overlapping — see
# `test_token_tuples_are_clean`. " selam " is dropped in favour of
# " selam" (the longer form is a superstring); " tesekkur" covers
# " tesekkurler" the same way; " nasilsin" catches " nasil"; etc.
_TURKISH_WORD_HINTS = (
    " selam", " merhaba", " naber",
    " iyiyim", " kotuyum", " idare ediyor",
    " tesekkur", " rica", " saol", " sagol",
    " evet", " hayir", " olur", " olmaz",
    " nasilsin", " neden", " cunku", " ama ", " ancak",
    " bence", " sence",
    " icin", " gibi", " kadar", " yine", " yok", " var",
)

# Lightweight tone signals — Turkish casual vs. formal. Tokens are
# intentionally short common substrings (each prefixed/suffixed with a
# space when needed to avoid mid-word matches like "rica" inside
# "tarica"). MUST be deduplicated and non-overlapping: no token may be
# a substring of another in the same tuple, otherwise `joined.count(tok)`
# double-counts the same phrase. The regression test
# `test_token_tuples_are_clean` enforces both.
_CASUAL_TOKENS = (
    " ya ", " yaa", " yha", " hee", " abi ", " kanka", " kanks",
    " lan ", " valla", " be ", " moruq", " keke", " bi ", " bi'",
)
_FORMAL_TOKENS = (
    "efendim",
    "iyi gunler",          # also catches "iyi gunler dilerim" (superstring intentionally removed)
    "iyi aksamlar",
    "rica ederim",
    "tesekkur ederim",
    "saygilarimla",
)


def detect_vibe(recent_user_messages: Iterable[str]) -> dict:
    """Light vibe heuristics from the user's recent messages.

    Pass the last 1-5 user messages (assistant turns are not useful for
    user-vibe detection). Empty / whitespace-only entries are filtered
    automatically. Order does not matter.
    """
    msgs: List[str] = []
    for m in recent_user_messages or []:
        if isinstance(m, str) and m.strip():
            msgs.append(m)

    if not msgs:
        return {
            "tone":      "neutral",
            "length":    "unknown",
            "emoji_use": "none",
            "lang":      "unknown",
        }

    avg_len = sum(len(m) for m in msgs) / len(msgs)
    if avg_len < 30:
        length = "short"
    elif avg_len < 120:
        length = "medium"
    else:
        length = "long"

    emoji_total = sum(len(_EMOJI_PATTERN.findall(m)) for m in msgs)
    if emoji_total >= 2:
        emoji_use = "frequent"
    elif emoji_total >= 1:
        emoji_use = "rare"
    else:
        emoji_use = "none"

    joined = (" " + " ".join(msgs).lower() + " ")
    casual_hits = sum(joined.count(tok) for tok in _CASUAL_TOKENS)
    formal_hits = sum(joined.count(tok) for tok in _FORMAL_TOKENS)
    if casual_hits > formal_hits:
        tone = "casual"
    elif formal_hits > casual_hits:
        tone = "formal"
    else:
        tone = "neutral"

    # Language sniff. Turkish-specific characters (ş/ğ/ç/ö/ü/ı, upper
    # and lower) almost never appear in English text — a single one is
    # enough to flip the bit. For diacritic-less Turkish chat
    # ("selam ya iyiyim") we still need the word-hint / tone-token paths
    # since the char-score alone is 0 there.
    text = "".join(msgs)
    turkish_char_score = sum(1 for c in text if c in _TURKISH_CHARS)
    turkish_word_score = sum(joined.count(w) for w in _TURKISH_WORD_HINTS)
    is_turkish = (
        turkish_char_score >= 1
        or turkish_word_score >= 1
        or casual_hits >= 1
        or formal_hits >= 1
    )
    if is_turkish:
        lang = "tr"
    elif any(c.isascii() and c.isalpha() for c in text):
        lang = "en"
    else:
        lang = "unknown"

    return {
        "tone":      tone,
        "length":    length,
        "emoji_use": emoji_use,
        "lang":      lang,
    }


__all__ = ["detect_vibe"]
