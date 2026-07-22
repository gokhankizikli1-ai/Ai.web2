# coding: utf-8
"""
Motion Intelligence — animation-style profiles + the resolution layer.

Two composable stages keep this a reasoning layer, not a keyword table:

  1. RESOLVE an :class:`AnimationStyle` from the visual analysis — the chosen
     ``visual_style`` wins when explicit, else the (industry-derived) ``archetype``
     provides it, else a safe ``premium`` default. RESOLVE the base
     :class:`MotionIntensity` primarily from the Visual layer's own intensity hint
     (so business analysis is consumed, never duplicated), then nudge it by brand
     personality energy and floor it for styles that carry signature motion.

  2. COMPOSE a coherent baseline behaviour set (hero / section / interaction /
     transition + preferred/avoided effects) from the resolved animation style, then
     let :mod:`.analyzer` apply intensity/realism refinements on top.

Pure, deterministic, total. No I/O, no randomness, never raises. It imports nothing
from the Visual/Image/generation layers — the analyzer passes in plain values.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Tuple

from backend.services.motion_intelligence.models import (
    AnimationStyle, HeroBehavior, InteractionStyle, MotionIntensity,
    SectionBehavior, TransitionStyle,
)


@dataclass(frozen=True)
class MotionProfile:
    """The baseline behaviour set for one animation style."""

    hero_behavior: HeroBehavior
    section_behavior: SectionBehavior
    interaction_style: InteractionStyle
    transition_style: TransitionStyle
    preferred_effects: Tuple[str, ...] = ()
    avoided_effects: Tuple[str, ...] = ()


# ── Baseline behaviour per animation style ────────────────────────────────────
# Deliberately restrained. Intensity + realism refinements (in the analyzer) adjust
# these; nothing here is mutated at runtime.
_PROFILES: Dict[AnimationStyle, MotionProfile] = {
    AnimationStyle.CINEMATIC: MotionProfile(
        hero_behavior=HeroBehavior.SLOW_PARALLAX,
        section_behavior=SectionBehavior.FADE_REVEAL,
        interaction_style=InteractionStyle.SOFT_HOVER,
        transition_style=TransitionStyle.SMOOTH_CROSSFADE,
        preferred_effects=("slow_parallax", "fade_reveal", "image_zoom"),
        avoided_effects=("bouncy", "fast", "neon"),
    ),
    AnimationStyle.EDITORIAL: MotionProfile(
        hero_behavior=HeroBehavior.SLOW_ZOOM,
        section_behavior=SectionBehavior.SOFT_FADE,
        interaction_style=InteractionStyle.SOFT_HOVER,
        transition_style=TransitionStyle.SMOOTH_CROSSFADE,
        preferred_effects=("slow_zoom", "soft_fade", "text_reveal"),
        avoided_effects=("cyber", "aggressive_motion", "glitch"),
    ),
    AnimationStyle.FUTURISTIC: MotionProfile(
        hero_behavior=HeroBehavior.FLOATING_INTERFACE,
        section_behavior=SectionBehavior.SCROLL_REVEAL,
        interaction_style=InteractionStyle.RESPONSIVE_HOVER,
        transition_style=TransitionStyle.MORPH,
        preferred_effects=("gradient_motion", "floating_cards", "scroll_reveal"),
        avoided_effects=("cartoon", "excessive_particles"),
    ),
    AnimationStyle.PREMIUM: MotionProfile(
        hero_behavior=HeroBehavior.SCROLL_REVEAL,
        section_behavior=SectionBehavior.SCROLL_REVEAL,
        interaction_style=InteractionStyle.RESPONSIVE_HOVER,
        transition_style=TransitionStyle.SMOOTH_CROSSFADE,
        preferred_effects=("fade_up", "subtle_parallax", "count_up"),
        avoided_effects=("bouncy", "playful_wobble", "excessive_parallax"),
    ),
    AnimationStyle.MINIMAL: MotionProfile(
        hero_behavior=HeroBehavior.STATIC,
        section_behavior=SectionBehavior.SOFT_FADE,
        interaction_style=InteractionStyle.PRECISE_HOVER,
        transition_style=TransitionStyle.SMOOTH_CROSSFADE,
        preferred_effects=("fade", "subtle_translate"),
        avoided_effects=("decorative_motion", "parallax_overload", "bounce"),
    ),
    AnimationStyle.PLAYFUL: MotionProfile(
        hero_behavior=HeroBehavior.KINETIC,
        section_behavior=SectionBehavior.STAGGER_REVEAL,
        interaction_style=InteractionStyle.PLAYFUL_HOVER,
        transition_style=TransitionStyle.SLIDE,
        preferred_effects=("spring_bounce", "hover_pop", "stagger"),
        avoided_effects=("somber_slow_fade", "static_rigidity"),
    ),
}

_DEFAULT_STYLE = AnimationStyle.PREMIUM

# Styles whose identity IS motion — never let refinement drop them to "none".
_SIGNATURE_STYLES = frozenset({
    AnimationStyle.CINEMATIC, AnimationStyle.FUTURISTIC,
    AnimationStyle.PREMIUM, AnimationStyle.EDITORIAL,
})

# archetype (from Visual Intelligence) → animation style. Industry-stable baseline.
_ARCHETYPE_STYLE: Dict[str, AnimationStyle] = {
    "luxury_hospitality": AnimationStyle.CINEMATIC,
    "artisan_craft": AnimationStyle.EDITORIAL,
    "futuristic_tech": AnimationStyle.FUTURISTIC,
    "wellness_natural": AnimationStyle.MINIMAL,
    "bold_creative": AnimationStyle.CINEMATIC,
    "corporate_trust": AnimationStyle.PREMIUM,
    "playful_friendly": AnimationStyle.PLAYFUL,
    "minimal_modern": AnimationStyle.MINIMAL,
    "retail_ecommerce": AnimationStyle.PREMIUM,
    "modern_professional": AnimationStyle.PREMIUM,
}

# Explicit visual-style words → animation style (chosen aesthetic overrides archetype).
_STYLE_KEYWORDS: Tuple[Tuple[Tuple[str, ...], AnimationStyle], ...] = (
    (("futuristic", "tech", "digital"), AnimationStyle.FUTURISTIC),
    (("cinematic", "luxury", "dramatic"), AnimationStyle.CINEMATIC),
    (("playful", "vibrant", "fun"), AnimationStyle.PLAYFUL),
    (("editorial", "natural", "artisan", "handcrafted"), AnimationStyle.EDITORIAL),
    (("minimal", "clean", "understated", "sparse"), AnimationStyle.MINIMAL),
    (("premium", "corporate", "commercial", "professional"), AnimationStyle.PREMIUM),
)

_INTENSITY_ORDER = [
    MotionIntensity.NONE, MotionIntensity.SUBTLE,
    MotionIntensity.MEDIUM, MotionIntensity.EXPRESSIVE,
]

# Personality/energy words that shift the baseline intensity.
_LOW_ENERGY = frozenset({"calm", "serene", "gentle", "elegant", "refined", "understated",
                         "minimal", "quiet", "subtle", "tranquil", "intentional"})
_HIGH_ENERGY = frozenset({"energetic", "dynamic", "vibrant", "playful", "bold", "lively",
                          "expressive", "cheerful", "kinetic", "loud"})

# Visual-layer intensity vocabulary (broader) → this module's 4-level scale.
_VISUAL_INTENSITY_MAP: Dict[str, MotionIntensity] = {
    "none": MotionIntensity.NONE,
    "minimal": MotionIntensity.SUBTLE,
    "subtle": MotionIntensity.SUBTLE,
    "moderate": MotionIntensity.MEDIUM,
    "medium": MotionIntensity.MEDIUM,
    "expressive": MotionIntensity.EXPRESSIVE,
    "dynamic": MotionIntensity.EXPRESSIVE,
}


def profile_for(style: AnimationStyle) -> MotionProfile:
    return _PROFILES.get(style, _PROFILES[_DEFAULT_STYLE])


def resolve_animation_style(visual_style_text: str, archetype: str) -> AnimationStyle:
    """Pick the animation style. Explicit visual-style words win (the brand's chosen
    aesthetic); else the archetype maps to one; else a safe premium default."""
    text = (visual_style_text or "").lower()
    for words, style in _STYLE_KEYWORDS:
        if any(w in text for w in words):
            return style
    key = (archetype or "").strip().lower()
    if key in _ARCHETYPE_STYLE:
        return _ARCHETYPE_STYLE[key]
    return _DEFAULT_STYLE


def _shift(intensity: MotionIntensity, delta: int) -> MotionIntensity:
    idx = _INTENSITY_ORDER.index(intensity)
    return _INTENSITY_ORDER[max(0, min(len(_INTENSITY_ORDER) - 1, idx + delta))]


def resolve_intensity(
    style: AnimationStyle, visual_intensity_hint: str, personality_text: str,
) -> Tuple[MotionIntensity, float]:
    """Resolve intensity primarily from the Visual layer's own hint (consuming, not
    re-deriving, the business analysis), nudged by personality energy and floored for
    signature styles so a "cinematic luxury" brand never resolves to no motion.

    Returns (intensity, confidence) where confidence reflects how much signal backed it.
    """
    hint = (visual_intensity_hint or "").strip().lower()
    base = _VISUAL_INTENSITY_MAP.get(hint)
    had_hint = base is not None
    if base is None:
        # No visual hint → a restrained default keyed to the style's character.
        base = MotionIntensity.MEDIUM if style in (AnimationStyle.FUTURISTIC, AnimationStyle.PLAYFUL) else MotionIntensity.SUBTLE

    tokens = set(_words(personality_text))
    nudged = 0
    if tokens & _LOW_ENERGY:
        base = _shift(base, -1); nudged += 1
    if tokens & _HIGH_ENERGY:
        base = _shift(base, +1); nudged += 1

    # Floors: signature styles keep at least subtle motion; playful stays lively.
    if style in _SIGNATURE_STYLES and _INTENSITY_ORDER.index(base) < _INTENSITY_ORDER.index(MotionIntensity.SUBTLE):
        base = MotionIntensity.SUBTLE
    if style == AnimationStyle.PLAYFUL and _INTENSITY_ORDER.index(base) < _INTENSITY_ORDER.index(MotionIntensity.MEDIUM):
        base = MotionIntensity.MEDIUM

    confidence = 0.75 if had_hint else 0.45
    if nudged:
        confidence = min(0.9, confidence + 0.1)
    return base, round(confidence, 3)


def _words(text: str) -> List[str]:
    return [t for t in "".join(c.lower() if (c.isalnum() or c.isspace()) else " " for c in (text or "")).split() if len(t) > 1]


__all__ = [
    "MotionProfile", "profile_for", "resolve_animation_style", "resolve_intensity",
]
