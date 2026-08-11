# coding: utf-8
"""
Image Intelligence — configuration & feature gating.

The whole layer is OFF by default. When ``ENABLE_SMART_IMAGES`` is not the exact
string ``"true"`` (case-insensitive), :func:`is_enabled` returns ``False`` and the
existing deterministic sourcing behaviour is used unchanged — so enabling the flag
is the ONLY thing that ever routes generation through the ranking engine.

Environment variables (all optional; all read per-call so a deploy can flip them
without a code change):

    ENABLE_SMART_IMAGES            master flag. "true" turns the ranking engine on.
                                   Default: off → legacy deterministic selection.

    SMART_IMAGE_WEIGHT_RELEVANCE   float, weight of the industry/query relevance
    SMART_IMAGE_WEIGHT_QUALITY     float, weight of the resolution/quality score
    SMART_IMAGE_WEIGHT_STYLE       float, weight of the brand-style match
    SMART_IMAGE_WEIGHT_COLOR       float, weight of the color-harmony score
    SMART_IMAGE_WEIGHT_COMPOSITION float, weight of the composition score
    SMART_IMAGE_WEIGHT_CONVERSION  float, weight of the conversion-impact score
                                   (weights are normalized; any subset may be set.)

No provider keys live here — those stay in ``web_build_images.stock`` (server-side
only). This module never performs I/O and never raises.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Dict

# The six ranking dimensions the engine scores every candidate on. Kept here as the
# single source of truth so scorers, weights and the public breakdown stay in sync.
RANKING_DIMENSIONS = (
    "relevance",
    "quality",
    "style",
    "color",
    "composition",
    "conversion",
)

# Sensible defaults. Relevance and conversion dominate (they decide whether an image
# is on-topic and whether it earns its place in a converting layout); the rest refine.
_DEFAULT_WEIGHTS: Dict[str, float] = {
    "relevance": 0.30,
    "quality": 0.15,
    "style": 0.15,
    "color": 0.15,
    "composition": 0.10,
    "conversion": 0.15,
}

_ENV_WEIGHT_PREFIX = "SMART_IMAGE_WEIGHT_"


def is_enabled() -> bool:
    """True only when ``ENABLE_SMART_IMAGES`` is explicitly ``"true"``."""
    return (os.getenv("ENABLE_SMART_IMAGES", "false") or "").strip().lower() == "true"


def visual_rerank_enabled() -> bool:
    """True only when ``ENABLE_SMART_IMAGE_VISUAL_RERANK`` is explicitly ``"true"`` (Phase 1 visual
    rerank of high-impact photographic slots). Default OFF ⇒ the smart path is byte-identical when
    unset. Per-call read so a deploy can flip it without a redeploy (mirrors ``is_enabled``)."""
    return (os.getenv("ENABLE_SMART_IMAGE_VISUAL_RERANK", "false") or "").strip().lower() == "true"


def visual_rerank_topn() -> int:
    """How many TOP metadata-ranked candidates a high-impact slot's single vision call inspects.
    Bounded to [2, 5]; default 3. Never grows the candidate pool (it only re-orders the top-N)."""
    try:
        n = int(os.getenv("SMART_IMAGE_VISUAL_RERANK_TOPN", "3"))
    except (TypeError, ValueError):
        n = 3
    return max(2, min(5, n))


def visual_rerank_budget() -> int:
    """Maximum vision calls per build (high-impact slots only). Bounded to [0, 4]; default 2 — enough
    for a hero (+ background / primary-about) without a per-candidate cost explosion."""
    try:
        b = int(os.getenv("SMART_IMAGE_VISUAL_RERANK_BUDGET", "2"))
    except (TypeError, ValueError):
        b = 2
    return max(0, min(4, b))


def _read_weight(dimension: str) -> float:
    raw = os.getenv(f"{_ENV_WEIGHT_PREFIX}{dimension.upper()}")
    if raw is None:
        return _DEFAULT_WEIGHTS[dimension]
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return _DEFAULT_WEIGHTS[dimension]
    return value if value >= 0 else _DEFAULT_WEIGHTS[dimension]


@dataclass(frozen=True)
class RankingWeights:
    """Normalized, per-dimension weights that sum to 1.0."""

    weights: Dict[str, float]

    def of(self, dimension: str) -> float:
        return self.weights.get(dimension, 0.0)


def load_weights() -> RankingWeights:
    """Read (optionally env-overridden) weights and normalize them to sum to 1.0.

    Falls back to the built-in defaults if the configured weights are unusable
    (e.g. every weight set to 0). Never raises.
    """
    raw = {dim: _read_weight(dim) for dim in RANKING_DIMENSIONS}
    total = sum(raw.values())
    if total <= 0:
        raw = dict(_DEFAULT_WEIGHTS)
        total = sum(raw.values())
    return RankingWeights(weights={dim: value / total for dim, value in raw.items()})


__all__ = [
    "RANKING_DIMENSIONS",
    "RankingWeights",
    "is_enabled",
    "load_weights",
    "visual_rerank_enabled",
    "visual_rerank_topn",
    "visual_rerank_budget",
]
