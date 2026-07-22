# coding: utf-8
"""
Image Intelligence — Visual Strategy → image search CONTEXT adapter.

Smart Image Intelligence already builds context-aware queries, searches providers and
ranks candidates. This adapter improves ONLY its INPUT: it turns the Visual Intelligence
output (brand feeling, visual style, photography style) into a compact
:class:`ImageContext` of positive search terms — so discovery leans toward on-brand,
editorial imagery and away from generic stock. It does NOT touch the query builder,
providers, search or ranking.

It is gated by ``ENABLE_VISUAL_IMAGE_CONTEXT`` (default off). When off, the enrichment
is a strict no-op and image behaviour is byte-for-byte identical.

Design rules honoured here:
  • no internal Visual Strategy fields are exposed (no archetype / confidence / source /
    realism enums) — only human search keywords;
  • no raw JSON ever reaches a provider — the terms merge into the existing text query;
  • the original user prompt is never duplicated;
  • the addition is small (bounded well under ~150 tokens);
  • everything is total — any failure returns the context unchanged.

Dependencies: only Visual Intelligence output (lazily, and only when enabled). It never
imports providers, the frontend, ranking, or the query builder, so there is no cycle.
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from typing import Any, Dict, List

logger = logging.getLogger(__name__)

# Bounds — the whole ImageContext stays well under ~150 tokens (~4 chars/token).
_MAX_QUERY_MODIFIER_WORDS = 10
_MAX_QUERY_MODIFIER_CHARS = 80
_MAX_STYLE_KEYWORDS = 6
_MAX_AVOID_KEYWORDS = 6
_MAX_MERGED_CHARS = 180

_STOPWORDS = frozenset({
    "the", "and", "with", "for", "a", "an", "of", "in", "on", "to", "photography",
    "photo", "photos", "image", "images", "quality", "high", "natural", "light",
    "lighting", "style", "shots", "shot",
})

# visual-style family → a few restrained, stock-search-friendly positive keywords.
# Ordered most-distinctive first so a compound style ("premium futuristic") resolves to
# its defining family rather than a broad "premium" match.
_STYLE_FAMILIES: List[tuple] = [
    (("futuristic", "tech", "digital"), ("modern", "clean", "product ui")),
    (("cinematic", "luxury", "premium", "elegant"), ("editorial", "high-end", "natural lighting")),
    (("natural", "artisan", "handcrafted", "editorial", "serene"), ("authentic", "lifestyle", "natural lighting")),
    (("minimal", "understated"), ("minimal", "negative space", "crisp")),
    (("playful", "vibrant", "bold"), ("vibrant", "candid", "energetic")),
    (("corporate", "professional", "commercial"), ("professional", "crisp", "polished")),
]
_DEFAULT_STYLE_KEYWORDS = ("professional", "natural lighting")

# Baseline negatives — the terms that most often produce "generic stock" results.
_BASE_AVOID = ("generic", "cheap stock", "low quality")


def is_enabled() -> bool:
    """True only when ``ENABLE_VISUAL_IMAGE_CONTEXT`` is explicitly ``"true"``."""
    return (os.getenv("ENABLE_VISUAL_IMAGE_CONTEXT", "false") or "").strip().lower() == "true"


@dataclass
class ImageContext:
    """Compact, provider-agnostic search hints derived from a Visual Strategy."""

    query_modifier: str = ""
    style_keywords: List[str] = field(default_factory=list)
    avoid_keywords: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "query_modifier": self.query_modifier,
            "style_keywords": list(self.style_keywords),
            "avoid_keywords": list(self.avoid_keywords),
        }

    def is_empty(self) -> bool:
        return not self.query_modifier and not self.style_keywords


def _get(source: Any, key: str) -> Any:
    if isinstance(source, dict):
        return source.get(key)
    return getattr(source, key, None)


def _words(text: str) -> List[str]:
    raw = "".join(c.lower() if (c.isalnum() or c.isspace()) else " " for c in (text or "")).split()
    return [w for w in raw if len(w) > 1]


def _dedup(words: List[str]) -> List[str]:
    out: List[str] = []
    seen: set = set()
    for w in words:
        if w not in seen:
            seen.add(w)
            out.append(w)
    return out


def _salient(text: str, limit: int) -> List[str]:
    return [w for w in _dedup(_words(text)) if w not in _STOPWORDS][:limit]


def _humanize(value: Any) -> str:
    return " ".join(str(getattr(value, "value", value)).replace("_", " ").split()).strip()


def _bound(words: List[str], max_words: int, max_chars: int) -> str:
    out: List[str] = []
    total = 0
    for w in words:
        if len(out) >= max_words:
            break
        extra = (1 if out else 0) + len(w)
        if total + extra > max_chars:
            break
        out.append(w)
        total += extra
    return " ".join(out)


def build_image_context(visual_strategy: Any) -> ImageContext:
    """Convert a Visual Strategy (object or its ``to_dict`` dict) into an
    :class:`ImageContext`. Pure and total — never raises, never reads internal fields."""
    if visual_strategy is None:
        return ImageContext()
    try:
        visual_style = str(_get(visual_strategy, "visual_style") or "").strip()
        personality = str(_get(visual_strategy, "brand_personality") or "").strip()
        image = _get(visual_strategy, "image_strategy") or {}
        photography = str(_get(image, "photography_style") or "").strip()
        avoid_patterns = _get(image, "avoid_patterns")

        # query_modifier: the visual style + the leading personality trait + the salient
        # photography subject, de-duplicated and bounded. Never the user prompt.
        lead_personality = _salient(personality, 1)
        modifier_words = _dedup(
            _words(visual_style) + lead_personality + _salient(photography, 3))
        query_modifier = _bound(modifier_words, _MAX_QUERY_MODIFIER_WORDS, _MAX_QUERY_MODIFIER_CHARS)

        # style_keywords: the matching visual-style family + a salient photography noun.
        style_text = f"{visual_style} {personality}".lower()
        family: tuple = _DEFAULT_STYLE_KEYWORDS
        for triggers, keywords in _STYLE_FAMILIES:
            if any(t in style_text for t in triggers):
                family = keywords
                break
        style_keywords: List[str] = []
        seen: set = set()
        for kw in list(family) + _salient(photography, 2):
            k = kw.strip()
            if k and k.lower() not in seen:
                seen.add(k.lower())
                style_keywords.append(k)
            if len(style_keywords) >= _MAX_STYLE_KEYWORDS:
                break

        # avoid_keywords: baseline generic-stock negatives + what the Visual layer flagged.
        avoid: List[str] = list(_BASE_AVOID)
        if isinstance(avoid_patterns, (list, tuple)):
            for pat in avoid_patterns:
                human = _humanize(pat)
                if human and human.lower() not in {a.lower() for a in avoid}:
                    avoid.append(human)
                if len(avoid) >= _MAX_AVOID_KEYWORDS:
                    break

        return ImageContext(
            query_modifier=query_modifier,
            style_keywords=style_keywords,
            avoid_keywords=avoid[:_MAX_AVOID_KEYWORDS],
        )
    except Exception as exc:  # noqa: BLE001 — conversion must never break discovery
        logger.debug("[VIS_IMG_CTX] build_image_context soft-failed: %s", type(exc).__name__)
        return ImageContext()


def enrich_design_context(context: Any) -> Any:
    """Flag-gated wiring: derive a Visual Strategy from the incoming design context and
    fold its positive image keywords into the context's ``imageStyle`` — the field the
    existing query builder already consumes — so discovery gets richer, on-brand input
    with NO change to the query builder, providers, search or ranking.

    Returns the context UNCHANGED when the flag is off, when there is no usable context,
    or on any failure. Never raises. Only positive terms are folded in (providers have no
    reliable negative-term support); the negatives remain available on the ImageContext.
    """
    if not is_enabled():
        return context
    if not isinstance(context, dict) or not context:
        return context
    try:
        # Lazy import — only when enabled — so this adapter carries no import-time
        # dependency and cannot create a cycle.
        from backend.services import visual_intelligence

        visual = visual_intelligence.analyze(context)
        ic = build_image_context(visual)
        if ic.is_empty():
            return context

        addition = " ".join([ic.query_modifier, *ic.style_keywords]).strip()
        if not addition:
            return context
        enriched = dict(context)
        existing = str(enriched.get("imageStyle") or enriched.get("image_style") or "").strip()
        merged_words = _dedup(_words(f"{existing} {addition}"))
        enriched["imageStyle"] = _bound(merged_words, max_words=24, max_chars=_MAX_MERGED_CHARS)
        return enriched
    except Exception as exc:  # noqa: BLE001 — enrichment must never break discovery
        logger.debug("[VIS_IMG_CTX] enrich_design_context soft-failed: %s", type(exc).__name__)
        return context


__all__ = ["ImageContext", "is_enabled", "build_image_context", "enrich_design_context"]
