# coding: utf-8
"""
Visual Intelligence — typed models.

The Visual Strategy is the structured "design brief" that answers the question the
current pipeline never asks: *how should this brand feel?* It sits BESIDE the existing
Design Intent (which captures WHAT to build) and captures the intentional visual world
a human designer would choose — personality, emotional goal, palette/typography
direction, and concrete image + motion strategies.

These are pure, serializable value objects. They hold NO behaviour beyond
``to_dict`` and never perform I/O. Enums are string-valued so the whole strategy
round-trips cleanly to JSON for a future Web Build context.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List


class RealismLevel(str, Enum):
    """How literal vs. abstract the site's imagery should read."""

    ABSTRACT = "abstract"        # shapes, gradients, generated/UI visuals
    STYLIZED = "stylized"        # illustrative / graphic treatment
    NATURAL = "natural"          # authentic, true-to-life photography
    PHOTOREAL = "photoreal"      # crisp, high-fidelity product/commercial photography
    CINEMATIC = "cinematic"      # dramatic, lit, editorial photography


class MotionIntensity(str, Enum):
    """Overall energy of the site's motion, from still to kinetic."""

    NONE = "none"
    MINIMAL = "minimal"
    SUBTLE = "subtle"
    MODERATE = "moderate"
    EXPRESSIVE = "expressive"
    DYNAMIC = "dynamic"


def _clean_list(values: List[str], limit: int = 8) -> List[str]:
    """De-duplicate + bound a list of short descriptors (order-preserving)."""
    out: List[str] = []
    seen: set = set()
    for value in values or []:
        text = str(value).strip()
        key = text.lower()
        if text and key not in seen:
            seen.add(key)
            out.append(text)
        if len(out) >= limit:
            break
    return out


@dataclass
class MotionStrategy:
    """How the site should move — energy, signature style, and what to avoid."""

    intensity: MotionIntensity = MotionIntensity.SUBTLE
    animation_style: str = ""                                # e.g. "slow parallax, subtle reveal"
    preferred_effects: List[str] = field(default_factory=list)
    avoid_effects: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "intensity": self.intensity.value,
            "animation_style": self.animation_style,
            "preferred_effects": _clean_list(self.preferred_effects),
            "avoid_effects": _clean_list(self.avoid_effects),
        }


@dataclass
class ImageStrategy:
    """What the site's imagery should be — type, style, composition, and anti-patterns."""

    preferred_visual_type: str = ""      # photography | abstract | product-ui | illustration | mixed
    photography_style: str = ""          # e.g. "cinematic architectural photography"
    composition: str = ""                # e.g. "wide, editorial, generous negative space"
    avoid_patterns: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "preferred_visual_type": self.preferred_visual_type,
            "photography_style": self.photography_style,
            "composition": self.composition,
            "avoid_patterns": _clean_list(self.avoid_patterns),
        }


@dataclass
class VisualStrategy:
    """The complete visual brief for one generated website."""

    # ── Understanding (the "why") ─────────────────────────────────────────────
    industry: str = ""
    audience: str = ""
    brand_personality: str = ""          # e.g. "exclusive, elegant, calm"
    emotional_goal: str = ""             # the feeling a visitor should leave with

    # ── Direction (the "how") ─────────────────────────────────────────────────
    visual_style: str = ""               # e.g. "cinematic luxury"
    color_direction: str = ""            # e.g. "warm natural neutrals with deep espresso accents"
    typography_direction: str = ""       # e.g. "editorial serif headlines, clean sans body"

    image_strategy: ImageStrategy = field(default_factory=ImageStrategy)
    motion_strategy: MotionStrategy = field(default_factory=MotionStrategy)
    realism_level: RealismLevel = RealismLevel.NATURAL

    # ── Provenance (never guessed as fact) ────────────────────────────────────
    archetype: str = ""                  # the resolved visual archetype key
    confidence: float = 0.0              # 0..1 — how strongly the input matched
    source: str = "deterministic"        # which analyzer produced this

    def to_dict(self) -> Dict[str, Any]:
        return {
            "industry": self.industry,
            "audience": self.audience,
            "brand_personality": self.brand_personality,
            "emotional_goal": self.emotional_goal,
            "visual_style": self.visual_style,
            "color_direction": self.color_direction,
            "typography_direction": self.typography_direction,
            "image_strategy": self.image_strategy.to_dict(),
            "motion_strategy": self.motion_strategy.to_dict(),
            "realism_level": self.realism_level.value,
            "archetype": self.archetype,
            "confidence": round(float(self.confidence), 3),
            "source": self.source,
        }


__all__ = [
    "RealismLevel", "MotionIntensity",
    "MotionStrategy", "ImageStrategy", "VisualStrategy",
]
