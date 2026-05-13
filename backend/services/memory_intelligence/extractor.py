# coding: utf-8
"""
Heuristic memory extractor — runs against one user message, returns 0-N
(kind, text) tuples ready for store.write().

Pure logic, no LLM call. Designed to catch the high-signal patterns
the brief calls out:

  - User mentions building their own AI / "kendi ai" / "kendi yapay
    zeka" → KIND_PROJECT
  - User mentions "KorvixAI" / "korvix ai" in any case → KIND_PROJECT
    (the canonical returning-user signal from the spec)
  - English "I'm building X" / "working on X" / "developing X"
    → KIND_PROJECT

Auto-redaction: if the message contains an obvious secret marker
(password / api_key / bearer token / email / sk-... key) the extractor
returns []. Better to miss a memory than to persist a credential.

Snippet phrasing is Turkish — the prompt teaches the model how to
read them; the model itself replies in the user's language regardless.
"""
from __future__ import annotations

import re
from typing import List, Tuple

from backend.services.memory_intelligence.store import (
    KIND_PROJECT,
    KIND_PREFERENCE,
)


_MAX_INPUT_CHARS = 4_000   # don't even try to extract from giant messages


# ── Redaction guards ─────────────────────────────────────────────────────

# Any one of these patterns short-circuits the extractor → store nothing.
_SECRET_PATTERNS = [
    re.compile(r"\bpassword\s*[:=]", re.IGNORECASE),
    re.compile(r"\bparola\s*[:=]",   re.IGNORECASE),
    re.compile(r"\bsifre\s*[:=]",    re.IGNORECASE),
    re.compile(r"\bapi[_\-\s]?key\b", re.IGNORECASE),
    re.compile(r"\bauthorization\s*[:=]", re.IGNORECASE),
    re.compile(r"\bbearer\s+[A-Za-z0-9._\-]{8,}", re.IGNORECASE),
    re.compile(r"\bsk-[A-Za-z0-9_\-]{16,}"),          # OpenAI-style key
    re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}"),  # email
    re.compile(r"\b\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b"),     # card-ish
]


def _has_secret(text: str) -> bool:
    return any(p.search(text) for p in _SECRET_PATTERNS)


# ── Pattern matchers ─────────────────────────────────────────────────────
# Each returns either a snippet string or None.

# Turkish: "kendi (yapay zeka|ai|ai'mi|ai'ni|ai projemi) (gelistiriyorum|
# yapiyorum|build edyorum|yaziyorum)"
# Casual variations are common: "kendi ai mi gelistiriyorum",
# "kendi yapay zekamı geliştiriyorum", "kendi AI projem var", etc.
_TR_OWN_AI = re.compile(
    r"\bkendi\s+(?:ai\b|yapay\s+zeka|ai\W*projem|ai\W*mi)",
    re.IGNORECASE,
)

# English: "(I'm|im|i am|i'm) (building|working on|developing) [SOMETHING]"
# We capture the trailing object so the snippet carries it (truncated).
_EN_BUILDING = re.compile(
    r"\b(?:i'?m|i\s+am)\s+(?:building|working on|developing|making|creating)\s+([^.!?\n]{2,80})",
    re.IGNORECASE,
)

# KorvixAI mention (any case, any spacing). The canonical returning-user
# signal from the spec.
_KORVIXAI = re.compile(r"\bkorvix\s*[a-z]*\s*ai\b", re.IGNORECASE)


def extract(message: str) -> List[Tuple[str, str]]:
    """Return list of (kind, snippet_text) tuples to be stored.

    Empty list when:
      - message is empty / non-string / too long
      - message contains a redaction pattern
      - no high-signal phrase matches

    The same message can produce multiple records (e.g. a sentence
    that mentions both KorvixAI AND building something) — caller can
    rely on store.write()'s dedup to suppress identical re-runs.
    """
    if not isinstance(message, str):
        return []
    text = message.strip()
    if not text or len(text) > _MAX_INPUT_CHARS:
        return []
    if _has_secret(text):
        return []

    found: List[Tuple[str, str]] = []
    low = text.lower()

    # 1. KorvixAI mention — strongest project signal.
    if _KORVIXAI.search(low):
        found.append((
            KIND_PROJECT,
            "Kullanici KorvixAI projesi uzerinde calisiyor",
        ))

    # 2. Turkish "kendi ai / yapay zeka" pattern.
    if _TR_OWN_AI.search(low):
        found.append((
            KIND_PROJECT,
            "Kullanici kendi yapay zeka projesini gelistiriyor",
        ))

    # 3. English "I'm building X" — capture X.
    m = _EN_BUILDING.search(text)   # original case so the snippet reads well
    if m:
        target = m.group(1).strip().strip(",.;")
        if target and len(target) <= 80:
            found.append((
                KIND_PROJECT,
                f"Kullanici '{target}' projesini gelistiriyor",
            ))

    return found


__all__ = ["extract"]
