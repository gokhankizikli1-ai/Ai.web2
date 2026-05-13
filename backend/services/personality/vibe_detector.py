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
# `test_token_tuples_are_clean`. When two tokens overlap by substring,
# keep the SHORTER one: `joined.count(short)` matches inside any text
# that contains the longer form, so the shorter token covers both.
# Examples: " selam" catches both " selam" and " selamlar";
#           " tesekkur" catches " tesekkurler";
#           " nasil" catches both " nasil" and " nasilsin".
_TURKISH_WORD_HINTS = (
    " selam", " merhaba", " naber",
    " iyiyim", " kotuyum", " idare ediyor",
    " tesekkur", " rica", " saol", " sagol",
    " evet", " hayir", " olur", " olmaz",
    " nasil",   # was " nasilsin" — keep the shorter form (Bugbot Medium f96febf8)
    " neden", " cunku", " ama ", " ancak",
    " bence", " sence",
    " icin", " gibi", " kadar", " yine", " yok", " var",
    # Unambiguous-Turkish casual tokens (also live in _CASUAL_TOKENS
    # for tone detection). Including them here preserves Turkish
    # language classification for casual messages like "naber abi"
    # or "valla iyiyim" now that language detection no longer
    # consults casual_hits (Bugbot Medium 5fd59862 fix).
    " kanka", " lan ", " valla", " abi ", " moruq",
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
    " lan ", " valla", " moruq", " keke", " bi ", " bi'",
    # NOTE: " be " removed — Bugbot Medium 5fd59862-bdae. The English
    # word "be" is too common to safely use as a tone signal ("I'll
    # be there", "should be fine"). Turkish "be" usage as a
    # particle ("Selam be kanka") is rare enough that the loss is
    # negligible compared to the false-positive risk.
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
    # and lower) almost never appear in English text — a single one
    # flips the bit. For diacritic-less Turkish chat ("selam ya iyiyim")
    # we rely on the word-hint path, which now includes the
    # unambiguously-Turkish casual tokens (kanka / lan / valla / abi /
    # moruq) so "naber abi" still classifies correctly.
    #
    # casual_hits / formal_hits are NO LONGER used as language signals:
    # tokens like " ya ", " be " collide with English vocabulary and
    # caused false-positive Turkish classification (Bugbot Medium
    # 5fd59862). Tone scoring still uses them; language sticks to
    # Turkish-specific evidence.
    text = "".join(msgs)
    turkish_char_score = sum(1 for c in text if c in _TURKISH_CHARS)
    turkish_word_score = sum(joined.count(w) for w in _TURKISH_WORD_HINTS)
    is_turkish = (
        turkish_char_score >= 1
        or turkish_word_score >= 1
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
