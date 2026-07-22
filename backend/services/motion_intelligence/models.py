# coding: utf-8
"""
Motion Intelligence — typed models.

Where Visual Intelligence answers "what should the brand feel like?", Motion
Intelligence answers "how should that feeling MOVE?". A :class:`MotionStrategy` is the
structured decision — energy, animation character, and the concrete hero / section /
interaction / transition behaviours — that a later PR turns into real motion. Not every
site should move the same way; some should barely move at all.

These are pure, serializable value objects with no behaviour beyond ``to_dict``. Enums
are string-valued so the whole strategy round-trips cleanly to JSON for a future Web
Build context. This module owns its OWN vocabulary and never mutates any input.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List


class MotionIntensity(str, Enum):
    """Overall energy of the site's motion."""

    NONE = "none"
    SUBTLE = "subtle"
    MEDIUM = "medium"
    EXPRESSIVE = "expressive"


class AnimationStyle(str, Enum):
    """The character of the motion — its 'design language'."""

    MINIMAL = "minimal"
    PREMIUM = "premium"
    CINEMATIC = "cinematic"
    FUTURISTIC = "futuristic"
    PLAYFUL = "playful"
    EDITORIAL = "editorial"


class HeroBehavior(str, Enum):
    """How the hero/above-the-fold area behaves."""

    STATIC = "static"
    SLOW_PARALLAX = "slow_parallax"
    SLOW_ZOOM = "slow_zoom"
    FLOATING_INTERFACE = "floating_interface"
    SCROLL_REVEAL = "scroll_reveal"
    KINETIC = "kinetic"


class SectionBehavior(str, Enum):
    """How content sections enter as the visitor scrolls."""

    NONE = "none"
    SOFT_FADE = "soft_fade"
    FADE_REVEAL = "fade_reveal"
    SCROLL_REVEAL = "scroll_reveal"
    SLIDE_IN = "slide_in"
    STAGGER_REVEAL = "stagger_reveal"


class InteractionStyle(str, Enum):
    """How interactive elements respond (hover / focus / press)."""

    NONE = "none"
    PRECISE_HOVER = "precise_hover"
    SOFT_HOVER = "soft_hover"
    RESPONSIVE_HOVER = "responsive_hover"
    PLAYFUL_HOVER = "playful_hover"


class TransitionStyle(str, Enum):
    """How states/route/content transitions feel."""

    INSTANT = "instant"
    SMOOTH_CROSSFADE = "smooth_crossfade"
    SLIDE = "slide"
    MORPH = "morph"


def _clean_list(values: List[str], limit: int = 8) -> List[str]:
    """De-duplicate + bound a list of short slugs (order-preserving)."""
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
    """The complete motion decision for one generated website."""

    intensity: MotionIntensity = MotionIntensity.SUBTLE
    animation_style: AnimationStyle = AnimationStyle.PREMIUM
    hero_behavior: HeroBehavior = HeroBehavior.SCROLL_REVEAL
    section_behavior: SectionBehavior = SectionBehavior.SOFT_FADE
    interaction_style: InteractionStyle = InteractionStyle.SOFT_HOVER
    transition_style: TransitionStyle = TransitionStyle.SMOOTH_CROSSFADE
    preferred_effects: List[str] = field(default_factory=list)
    avoided_effects: List[str] = field(default_factory=list)

    # ── Provenance (never guessed as fact) ────────────────────────────────────
    confidence: float = 0.0              # 0..1 — carried from the visual analysis
    source: str = "deterministic"        # which analyzer produced this

    def to_dict(self) -> Dict[str, Any]:
        return {
            "intensity": self.intensity.value,
            "animation_style": self.animation_style.value,
            "hero_behavior": self.hero_behavior.value,
            "section_behavior": self.section_behavior.value,
            "interaction_style": self.interaction_style.value,
            "transition_style": self.transition_style.value,
            "preferred_effects": _clean_list(self.preferred_effects),
            "avoided_effects": _clean_list(self.avoided_effects),
            "confidence": round(float(self.confidence), 3),
            "source": self.source,
        }


__all__ = [
    "MotionIntensity", "AnimationStyle", "HeroBehavior", "SectionBehavior",
    "InteractionStyle", "TransitionStyle", "MotionStrategy",
]
