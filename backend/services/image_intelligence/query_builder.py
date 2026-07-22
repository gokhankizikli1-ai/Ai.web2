# coding: utf-8
"""
Image Intelligence — context-aware search-query builder.

The ranking engine can only pick an excellent image if the provider search returns a
strong candidate pool. Searching for the bare slot subject ("restaurant interior")
yields a generic pool; the rich Design Intent (industry, brand style, tone, image
style) and the slot's own role (purpose, orientation) are used during RANKING but not
during DISCOVERY.

This module closes that gap. It composes a deterministic, cheap, safe provider query
from the requirement's subject + the most relevant intent signals + restrained,
stock-search-friendly composition hints chosen by slot purpose and orientation.

Design rules (deliberate, not decorative):
  • the subject is the STRONGEST part and always leads the query;
  • signals are added in priority order, then de-duplicated word-by-word so no term
    repeats and the query never balloons;
  • purpose picks the composition hints — a hero is not a team portrait — and
    "copy space"/"cinematic" are added ONLY where they belong, never to every image;
  • orientation adds a complementary text hint (the provider orientation FILTER is
    unchanged and authoritative — this only nudges composition);
  • the final query is bounded (words + characters, under the provider cap) and always
    ends on a word boundary;
  • no LLM, no I/O, no raw user prompt, no CTA copy; total — any failure falls back to
    the sanitized subject.
"""
from __future__ import annotations

import re
from typing import List

from backend.services.image_intelligence.design_intent import DesignIntent, ImageRequirement

# Bounds — kept comfortably under the provider query cap (stock.MAX_QUERY = 120) and
# short enough that the search stays focused rather than punctuation-heavy prose.
_MAX_WORDS = 14
_MAX_CHARS = 115

# Keep letters/numbers/spaces + a few safe separators; everything else becomes a space
# so a query can never smuggle operators, markup or secrets into a provider request.
_STRIP = re.compile(r"[^0-9A-Za-zÀ-ɏЀ-ӿ\s\-&',]")
_WS = re.compile(r"\s+")

# Purposes where the audience is a genuine VISUAL subject (people / lived-in context).
# Elsewhere audience is business framing, not a photo subject, so it is omitted.
_AUDIENCE_PURPOSES = {"about", "team"}

# Tokens in the design intent that justify a cinematic/editorial hero treatment. Absent
# these, a hero stays clean and neutral (no "cinematic" on every industry).
_CINEMATIC_SIGNALS = frozenset({
    "cinematic", "cinema", "film", "filmic", "dramatic", "moody", "editorial",
    "luxury", "luxurious", "premium", "elegant", "atmospheric", "bold",
})


def _sanitize(text: str) -> str:
    """Strip to safe search characters, collapse whitespace, bound length on a word
    boundary (never a partial-word fragment). Total."""
    if not text:
        return ""
    cleaned = _WS.sub(" ", _STRIP.sub(" ", str(text))).strip()
    if len(cleaned) <= 120:
        return cleaned
    cut = cleaned[:120]
    if cleaned[120] != " ":  # would slice mid-word → drop the partial trailing word
        cut = cut.rsplit(" ", 1)[0]
    return cut.strip()


def _supports_cinematic(intent: DesignIntent) -> bool:
    haystack = f"{intent.image_style} {intent.brand_style} {intent.emotional_tone}".lower()
    return any(sig in haystack for sig in _CINEMATIC_SIGNALS)


def _purpose_hints(purpose: str, intent: DesignIntent) -> List[str]:
    """Restrained, stock-search-friendly composition hints for the slot's role."""
    if purpose in ("hero", "background"):
        hints = ["wide composition", "copy space", "uncluttered background"]
        # Cinematic/editorial ONLY when the brand actually reads that way.
        if _supports_cinematic(intent):
            hints.insert(1, "cinematic")
        return hints
    if purpose == "product":
        return ["product photography", "clean composition", "commercial lighting"]
    if purpose in ("gallery", "project"):
        return ["editorial photography", "detailed"]
    if purpose == "about":
        return ["authentic environment", "natural lifestyle"]
    if purpose == "team":
        return ["professional portrait", "natural expression", "clean background"]
    return []


def _orientation_hint(orientation: str) -> str:
    """A text hint that COMPLEMENTS (never replaces) the provider orientation filter."""
    return {
        "landscape": "wide composition",
        "portrait": "vertical composition",
        "square": "balanced framing",
    }.get(orientation, "")


def _bounded_join(words: List[str]) -> str:
    """Join words within the word + char budget, always ending on a word boundary."""
    out: List[str] = []
    total = 0
    for word in words:
        if len(out) >= _MAX_WORDS:
            break
        extra = (1 if out else 0) + len(word)
        if total + extra > _MAX_CHARS:
            break
        out.append(word)
        total += extra
    return " ".join(out)


def _build(intent: DesignIntent, requirement: ImageRequirement) -> str:
    subject = _sanitize(requirement.subject)

    # Priority-ordered signal phrases. Subject leads (strongest), then the brand/industry/
    # style/tone aesthetic, THEN the slot's purpose composition hints (kept high enough
    # that the slot's role always shapes the search), audience where it is a real subject,
    # and finally the orientation hint. Later, length-bounding trims from the tail.
    phrases: List[str] = [
        subject,
        _sanitize(intent.brand_style),
        _sanitize(intent.industry),
        _sanitize(intent.image_style),
        _sanitize(intent.emotional_tone),
    ]
    phrases.extend(_purpose_hints(requirement.purpose, intent))
    if requirement.purpose in _AUDIENCE_PURPOSES:
        phrases.append(_sanitize(intent.target_audience))
    hint = _orientation_hint(requirement.orientation)
    if hint:
        phrases.append(hint)

    # Flatten to words and de-duplicate case-insensitively, preserving first occurrence,
    # so no term repeats (subject words therefore also suppress later duplicates). Drop
    # 1-char fragments so a truncated field can never leak a stray letter into the query.
    seen: set = set()
    words: List[str] = []
    for phrase in phrases:
        for word in phrase.split():
            low = word.lower()
            if len(low) < 2 or low in seen:
                continue
            seen.add(low)
            words.append(low)

    return _bounded_join(words) or subject


def build_search_query(intent: DesignIntent, requirement: ImageRequirement) -> str:
    """Compose the context-aware provider query for a slot. Never raises — on any
    failure it returns the sanitized subject so discovery still runs."""
    try:
        return _build(intent, requirement)
    except Exception:  # noqa: BLE001 — query construction must never break sourcing
        try:
            return _sanitize(getattr(requirement, "subject", "") or "")
        except Exception:  # noqa: BLE001
            return ""


__all__ = ["build_search_query"]
