# coding: utf-8
"""
Image Intelligence — the ranking engine.

Every candidate receives a per-dimension breakdown and a weighted ``final_score``.
This is NOT a keyword matcher: relevance is token-coverage weighted by intent
vocabulary, color is real HSL harmony against the brand palette, quality/composition
read the actual pixel dimensions and aspect ratio, and conversion weighs the slot's
role in the funnel.

The six scorers are registered functions, so a new dimension can be added by
appending a :class:`Scorer` and giving it a weight in ``config`` — the engine and the
output breakdown pick it up automatically. Each scorer returns 0-100 and is total.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Dict, List

from backend.services.image_intelligence import color as color_util
from backend.services.image_intelligence.config import RANKING_DIMENSIONS, RankingWeights, load_weights
from backend.services.image_intelligence.design_intent import DesignIntent, ImageRequirement
from backend.services.image_intelligence.providers import ImageCandidate

# Generic terms that carry no discriminating signal — excluded from relevance overlap
# so "modern professional stock photo" doesn't reward every candidate equally.
_STOPWORDS = frozenset({
    "the", "and", "for", "with", "a", "an", "of", "in", "on", "to", "photo", "photos",
    "image", "images", "picture", "stock", "background", "shot", "view", "modern",
    "professional", "premium", "quality", "beautiful", "nice", "good",
})


def _tokens(text: str) -> List[str]:
    raw = "".join(c.lower() if (c.isalnum() or c.isspace()) else " " for c in (text or "")).split()
    return [t for t in raw if len(t) > 1 and t not in _STOPWORDS]


# ── Individual scorers (DesignIntent, ImageRequirement, ImageCandidate) → 0-100 ──

def score_relevance(intent: DesignIntent, req: ImageRequirement, cand: ImageCandidate) -> float:
    """How well the candidate's description covers the slot subject + intent vocabulary.

    Coverage of the slot's own query tokens dominates; the industry/style vocabulary
    provides a secondary on-brand bias. A candidate with no description is not zero —
    it falls back to a neutral floor so a good-but-undescribed photo still competes.
    """
    subject_tokens = set(_tokens(req.subject))
    vocab_tokens = set(intent.vocabulary())
    haystack = set(_tokens(f"{cand.alt} {cand.photographer_name}"))
    if not cand.alt:
        return 45.0  # undescribed — neutral, let quality/color decide

    if subject_tokens:
        covered = len(subject_tokens & haystack) / len(subject_tokens)
    else:
        covered = 0.5
    subject_score = 100.0 * covered

    if vocab_tokens:
        vocab_hits = len(vocab_tokens & haystack)
        vocab_score = min(100.0, 55.0 + 15.0 * vocab_hits)
    else:
        vocab_score = 60.0

    return round(0.72 * subject_score + 0.28 * vocab_score, 2)


def score_quality(intent: DesignIntent, req: ImageRequirement, cand: ImageCandidate) -> float:
    """Resolution as a quality proxy, gated against the slot's minimum megapixels."""
    mp = cand.megapixels
    if mp <= 0:
        return 50.0  # unknown dimensions — neutral
    floor = req.min_megapixels
    if mp < floor:
        # Below the slot's needs — scale down proportionally (never a hard zero).
        return round(max(10.0, 60.0 * (mp / floor)), 2)
    # At/above the floor: smoothly reward more resolution up to ~6 MP, then plateau.
    headroom = min(1.0, (mp - floor) / max(0.5, 6.0 - floor))
    return round(min(100.0, 75.0 + 25.0 * headroom), 2)


def score_style(intent: DesignIntent, req: ImageRequirement, cand: ImageCandidate) -> float:
    """Brand-style match: orientation correctness + image-style vocabulary presence."""
    ar = cand.aspect_ratio
    if ar is None:
        orientation_score = 60.0
    else:
        if req.orientation == "portrait":
            orientation_score = 100.0 if ar < 0.95 else (55.0 if ar < 1.1 else 25.0)
        elif req.orientation == "square":
            orientation_score = 100.0 if 0.85 <= ar <= 1.2 else 45.0
        else:  # landscape
            orientation_score = 100.0 if ar > 1.15 else (55.0 if ar > 0.98 else 25.0)

    style_tokens = set(_tokens(f"{intent.image_style} {intent.brand_style}"))
    if style_tokens:
        hits = len(style_tokens & set(_tokens(cand.alt)))
        style_score = min(100.0, 60.0 + 20.0 * hits)
    else:
        style_score = 65.0
    return round(0.6 * orientation_score + 0.4 * style_score, 2)


def score_color(intent: DesignIntent, req: ImageRequirement, cand: ImageCandidate) -> float:
    """Harmony of the candidate's dominant color with the brand palette (real HSL math)."""
    return color_util.harmony_score(cand.dominant_color, intent.color_palette)


def score_composition(intent: DesignIntent, req: ImageRequirement, cand: ImageCandidate) -> float:
    """Aspect-ratio suitability for the slot — ideal ratio scores highest, extremes fall off."""
    ar = cand.aspect_ratio
    if ar is None:
        return 55.0
    low, ideal, high = req.aspect_band()
    if ar < low:
        return round(max(20.0, 70.0 * (ar / low)), 2)
    if ar > high:
        return round(max(20.0, 70.0 * (high / ar)), 2)
    # Inside the sensible band: peak at the ideal ratio, taper toward the edges.
    span = (ideal - low) if ar <= ideal else (high - ideal)
    proximity = 1.0 - (abs(ar - ideal) / span) if span > 0 else 1.0
    return round(75.0 + 25.0 * max(0.0, proximity), 2)


def score_conversion(intent: DesignIntent, req: ImageRequirement, cand: ImageCandidate) -> float:
    """Conversion impact: conversion-critical slots demand large, high-resolution imagery.

    A hero/background/product slot with a big, high-res photo scores high; the same
    slot with a small image is penalized because a weak hero costs conversions. Non-
    critical slots are judged more leniently.
    """
    mp = cand.megapixels
    if req.is_conversion_critical:
        if mp <= 0:
            return 55.0
        base = 100.0 if mp >= 2.0 else (75.0 + 25.0 * (mp / 2.0))
        # A wide, landscape hero reads as more "designed" above the fold.
        ar = cand.aspect_ratio
        if req.orientation == "landscape" and ar is not None and ar < 1.1:
            base -= 15.0
        return round(max(20.0, min(100.0, base)), 2)
    # Supporting slot — resolution matters less; keep it in a comfortable mid band.
    if mp <= 0:
        return 60.0
    return round(min(100.0, 65.0 + 20.0 * min(1.0, mp / 1.5)), 2)


# scorer registry: dimension name → scoring function.
Scorer = Callable[[DesignIntent, ImageRequirement, ImageCandidate], float]

_SCORERS: Dict[str, Scorer] = {
    "relevance": score_relevance,
    "quality": score_quality,
    "style": score_style,
    "color": score_color,
    "composition": score_composition,
    "conversion": score_conversion,
}


def register_scorer(dimension: str, scorer: Scorer) -> None:
    """Register (or override) a scoring dimension. Give it a weight via config to
    influence the final score; unweighted dimensions contribute 0."""
    _SCORERS[dimension] = scorer


@dataclass
class ScoredImage:
    """A candidate with its per-dimension breakdown and weighted final score."""

    candidate: ImageCandidate
    breakdown: Dict[str, float] = field(default_factory=dict)
    final_score: float = 0.0

    def as_metadata(self) -> Dict[str, float]:
        """Compact, serializable score breakdown (matches the feature's example shape)."""
        out = {f"{dim}Score": round(self.breakdown.get(dim, 0.0), 2) for dim in RANKING_DIMENSIONS}
        out["finalScore"] = round(self.final_score, 2)
        return out


class ImageRankingEngine:
    """Scores and ranks candidates for a design intent. Stateless and reusable."""

    def __init__(self, weights: RankingWeights | None = None) -> None:
        self._weights = weights or load_weights()

    def score(self, intent: DesignIntent, req: ImageRequirement, cand: ImageCandidate) -> ScoredImage:
        breakdown: Dict[str, float] = {}
        final = 0.0
        for dimension, scorer in _SCORERS.items():
            try:
                value = float(scorer(intent, req, cand))
            except Exception:  # noqa: BLE001 — a broken scorer must never sink ranking
                value = 0.0
            value = max(0.0, min(100.0, value))
            breakdown[dimension] = round(value, 2)
            final += self._weights.of(dimension) * value
        return ScoredImage(candidate=cand, breakdown=breakdown, final_score=round(final, 2))

    def rank(
        self, intent: DesignIntent, req: ImageRequirement, candidates: List[ImageCandidate],
    ) -> List[ScoredImage]:
        """Return candidates scored and sorted best-first (stable for equal scores)."""
        scored = [self.score(intent, req, cand) for cand in candidates]
        scored.sort(key=lambda s: s.final_score, reverse=True)
        return scored


__all__ = [
    "ImageRankingEngine", "ScoredImage", "Scorer", "register_scorer",
    "score_relevance", "score_quality", "score_style",
    "score_color", "score_composition", "score_conversion",
]
