# coding: utf-8
"""
Context builder — assembles a `[KISA BAGLAM]` block to prepend to the
system prompt.

Format (Turkish — matches the prompt's HAFIZA & BAGLAM section):

  [KISA BAGLAM]
  - Kullanici vibe: casual, kisa cumleler, emoji rare, dil tr
  - Onceki konularda gectikleri:
    • Kullanici KorvixAI projesini gelistiriyor
    • Daha once trading sinyallerinden bahsetti
  - Selami zaten verdin. Tekrar 'Merhaba' deme — direkt konuya gec.

Design choices
- Returns "" (empty string) when there's nothing useful to surface.
  The caller can unconditionally prepend the result; an empty result
  keeps the prompt exactly as if the personality layer were off.
- Memory snippets are passed in by the caller; this module does NOT
  query the memory service. Decoupling lets us test the formatter in
  isolation and lets future callers (legacy /chat, /v2/agent/*, etc.)
  pull memory however they prefer.
- Snippets are truncated to 120 chars each and capped at 3 entries so
  the block stays a short prefix, never a wall of text.
"""
from __future__ import annotations

from typing import Iterable, List, Optional

from backend.services.personality.vibe_detector import detect_vibe


_MAX_SNIPPETS         = 3
_MAX_SNIPPET_CHARS    = 120
_BLOCK_HEADER         = "[KISA BAGLAM]"

# detect_vibe() returns English labels; the prompt teaches the model
# Turkish (kisa / orta / uzun). Translate the length dimension so the
# output the model sees matches the language of the rules it was
# taught. Tone (casual/formal/neutral) and emoji_use (frequent/rare/
# none) are left as-is because the prompt already references them in
# their English forms (Bugbot Medium 3a6e34ca).
_LENGTH_TR = {
    "short":   "kisa",
    "medium":  "orta",
    "long":    "uzun",
    "unknown": "bilinmeyen",
}


def build_short_context_block(
    *,
    recent_user_messages: Optional[Iterable[str]] = None,
    memory_snippets:      Optional[Iterable[str]] = None,
    already_greeted:      bool = False,
) -> str:
    """Build a `[KISA BAGLAM]` block from optional inputs.

    Args
      recent_user_messages: last 1-5 user-turn texts (used for vibe).
      memory_snippets:      already-summarised facts about the user.
                            Pass plain strings; this module formats
                            them but does NOT verify their content.
      already_greeted:      True when the assistant has greeted the user
                            in this conversation; tells the model not to
                            double-greet.

    Returns
      "" when nothing useful to surface, else a multi-line string
      terminated by a newline so it can be prepended directly to the
      system prompt.
    """
    parts: List[str] = []

    msgs = list(recent_user_messages) if recent_user_messages else []
    vibe = detect_vibe(msgs)
    if msgs and (vibe["tone"] != "neutral" or vibe["length"] != "unknown" or vibe["emoji_use"] != "none"):
        length_tr = _LENGTH_TR.get(vibe["length"], vibe["length"])
        parts.append(
            f"- Kullanici vibe: {vibe['tone']}, {length_tr} cumleler, "
            f"emoji {vibe['emoji_use']}, dil {vibe['lang']}"
        )

    snippets = _clean_snippets(memory_snippets)
    if snippets:
        parts.append("- Onceki konularda gectikleri:")
        for s in snippets:
            parts.append(f"  • {s}")

    if already_greeted:
        parts.append(
            "- Selami zaten verdin. Tekrar 'Merhaba' deme — direkt konuya gec."
        )

    if not parts:
        return ""

    return _BLOCK_HEADER + "\n" + "\n".join(parts) + "\n"


def _clean_snippets(snippets: Optional[Iterable[str]]) -> List[str]:
    out: List[str] = []
    for raw in snippets or ():
        if not isinstance(raw, str):
            continue
        s = raw.strip()
        if not s:
            continue
        if len(s) > _MAX_SNIPPET_CHARS:
            s = s[: _MAX_SNIPPET_CHARS - 1].rstrip() + "…"
        out.append(s)
        if len(out) >= _MAX_SNIPPETS:
            break
    return out


__all__ = ["build_short_context_block"]
