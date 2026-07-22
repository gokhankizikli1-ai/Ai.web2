# coding: utf-8
"""
Motion Intelligence — the analyzer abstraction.

The analyzer turns a Visual Strategy ("what should the brand feel like?") into a
:class:`MotionStrategy` ("how should that feeling move?"). It CONSUMES the visual
analysis and never re-derives the business analysis.

Like the Visual layer, this is an ABSTRACTION, not a function: :class:`MotionAnalyzer`
is the contract and :class:`DeterministicMotionAnalyzer` is today's implementation. A
future ``AIMotionAnalyzer`` registers under the same contract with no caller change.

The deterministic analyzer reasons over several signals — the visual style, the
(industry-derived) archetype, the Visual layer's own intensity hint, brand personality
energy, realism level and image-type hints — then composes a coherent behaviour set. It
is deterministic, bounded and total: it never raises and always returns a usable,
restrained strategy (safe premium/subtle default when the input says nothing).

It imports NOTHING from the Visual/Image/generation/billing/frontend layers — the
Visual Strategy is read by duck-typing (object OR its ``to_dict`` dict), so there is no
coupling and no circular dependency.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Protocol, runtime_checkable

from backend.services.motion_intelligence.models import (
    AnimationStyle, HeroBehavior, InteractionStyle, MotionIntensity,
    MotionStrategy, SectionBehavior, TransitionStyle,
)
from backend.services.motion_intelligence import strategies

_MAX_TEXT = 500
_INTENSITY_ORDER = [
    MotionIntensity.NONE, MotionIntensity.SUBTLE,
    MotionIntensity.MEDIUM, MotionIntensity.EXPRESSIVE,
]


def _idx(intensity: MotionIntensity) -> int:
    return _INTENSITY_ORDER.index(intensity)


def _read(source: Any, key: str) -> Any:
    """Read a field from a dict OR an object attribute (duck-typed)."""
    if isinstance(source, dict):
        return source.get(key)
    return getattr(source, key, None)


def _as_str(value: Any) -> str:
    """Coerce a value (incl. a str-Enum) to a bounded, lower-cased string."""
    if value is None:
        return ""
    text = getattr(value, "value", value)  # unwrap enums
    return str(text).strip()[:_MAX_TEXT]


def _as_list(value: Any) -> List[str]:
    if isinstance(value, (list, tuple)):
        return [str(v).strip() for v in value if str(v).strip()][:12]
    return []


def _slug(text: str) -> str:
    out = "".join(c.lower() if c.isalnum() else "_" for c in (text or "")).strip("_")
    while "__" in out:
        out = out.replace("__", "_")
    return out[:32]


@dataclass
class MotionContext:
    """Normalized motion-relevant signals extracted from a Visual Strategy."""

    visual_style: str = ""
    archetype: str = ""
    brand_personality: str = ""
    realism_level: str = ""
    visual_intensity_hint: str = ""
    image_visual_type: str = ""
    visual_avoided: List[str] = None            # type: ignore[assignment]
    visual_confidence: float = 0.0

    def __post_init__(self) -> None:
        if self.visual_avoided is None:
            self.visual_avoided = []

    @classmethod
    def from_visual(cls, source: Any) -> "MotionContext":
        """Extract from a VisualStrategy object or its dict form. Never raises."""
        if source is None:
            return cls()
        motion = _read(source, "motion_strategy") or {}
        image = _read(source, "image_strategy") or {}
        confidence = _read(source, "confidence")
        try:
            confidence = float(confidence) if confidence is not None else 0.0
        except (TypeError, ValueError):
            confidence = 0.0
        return cls(
            visual_style=_as_str(_read(source, "visual_style")),
            archetype=_as_str(_read(source, "archetype")),
            brand_personality=_as_str(_read(source, "brand_personality")),
            realism_level=_as_str(_read(source, "realism_level")),
            visual_intensity_hint=_as_str(_read(motion, "intensity")),
            image_visual_type=_as_str(_read(image, "preferred_visual_type")),
            visual_avoided=_as_list(_read(motion, "avoid_effects")),
            visual_confidence=max(0.0, min(1.0, confidence)),
        )


@runtime_checkable
class MotionAnalyzer(Protocol):
    """The analyzer contract — any implementation that turns a :class:`MotionContext`
    into a :class:`MotionStrategy` satisfies it."""

    name: str

    def analyze(self, context: MotionContext) -> MotionStrategy:
        ...


def _add(values: List[str], *items: str) -> List[str]:
    out = list(values)
    lower = {v.lower() for v in out}
    for item in items:
        if item and item.lower() not in lower:
            out.append(item)
            lower.add(item.lower())
    return out


class DeterministicMotionAnalyzer:
    """Rule-composed analyzer: resolve style + intensity from the visual signals, compose
    the baseline behaviour set, then refine by intensity, realism and image type. Isolated
    and side-effect free — it never mutates the shared profile library."""

    name = "deterministic"

    def analyze(self, context: MotionContext) -> MotionStrategy:
        style = strategies.resolve_animation_style(context.visual_style, context.archetype)
        intensity, conf = strategies.resolve_intensity(
            style, context.visual_intensity_hint, context.brand_personality)

        profile = strategies.profile_for(style)
        strategy = MotionStrategy(
            intensity=intensity,
            animation_style=style,
            hero_behavior=profile.hero_behavior,
            section_behavior=profile.section_behavior,
            interaction_style=profile.interaction_style,
            transition_style=profile.transition_style,
            preferred_effects=list(profile.preferred_effects),
            avoided_effects=list(profile.avoided_effects),
            source=self.name,
        )
        self._refine(strategy, context)
        # Blend the motion confidence with the upstream visual confidence when present.
        strategy.confidence = round(
            (conf + context.visual_confidence) / 2 if context.visual_confidence else conf, 3)
        return strategy

    def _refine(self, s: MotionStrategy, ctx: MotionContext) -> None:
        # No motion at all → collapse to a still, precise baseline.
        if s.intensity == MotionIntensity.NONE:
            s.hero_behavior = HeroBehavior.STATIC
            s.section_behavior = SectionBehavior.NONE
            s.interaction_style = InteractionStyle.PRECISE_HOVER
            s.transition_style = TransitionStyle.INSTANT
            s.preferred_effects = []
            s.avoided_effects = _add(s.avoided_effects, "excessive_motion")
            self._merge_visual_avoids(s, ctx)
            return

        realism = ctx.realism_level.lower()
        # Cinematic imagery wants slow, rich hero motion — never hyperactive.
        if realism == "cinematic":
            if s.hero_behavior in (HeroBehavior.KINETIC, HeroBehavior.SCROLL_REVEAL, HeroBehavior.FLOATING_INTERFACE):
                s.hero_behavior = HeroBehavior.SLOW_PARALLAX
            if _idx(s.intensity) > _idx(MotionIntensity.MEDIUM):
                s.intensity = MotionIntensity.MEDIUM

        # Product-UI / abstract imagery reads best with a floating interface hero.
        if ctx.image_visual_type in ("product-ui", "abstract") and s.animation_style in (
                AnimationStyle.FUTURISTIC, AnimationStyle.PREMIUM):
            s.hero_behavior = HeroBehavior.FLOATING_INTERFACE

        # Expressive energy in an otherwise calm style earns a little more life.
        if s.intensity == MotionIntensity.EXPRESSIVE and s.section_behavior == SectionBehavior.SOFT_FADE:
            s.section_behavior = SectionBehavior.SCROLL_REVEAL

        self._merge_visual_avoids(s, ctx)

    def _merge_visual_avoids(self, s: MotionStrategy, ctx: MotionContext) -> None:
        """Carry the Visual layer's 'avoid' guidance into motion vocabulary (deduped)."""
        for phrase in ctx.visual_avoided:
            slug = _slug(phrase)
            if slug:
                s.avoided_effects = _add(s.avoided_effects, slug)
        s.avoided_effects = s.avoided_effects[:8]


# ── Registry (the extension seam for a future AI analyzer) ─────────────────────

_ANALYZERS: Dict[str, MotionAnalyzer] = {}
_DEFAULT = "deterministic"


def register_analyzer(analyzer: MotionAnalyzer) -> None:
    _ANALYZERS[analyzer.name] = analyzer


def get_analyzer(name: Optional[str] = None) -> MotionAnalyzer:
    if not _ANALYZERS:
        register_analyzer(DeterministicMotionAnalyzer())
    return _ANALYZERS.get(name or _DEFAULT, _ANALYZERS[_DEFAULT])


register_analyzer(DeterministicMotionAnalyzer())


def _to_context(source: Any) -> MotionContext:
    if isinstance(source, MotionContext):
        return source
    return MotionContext.from_visual(source)


def analyze(source: Any, analyzer_name: Optional[str] = None) -> MotionStrategy:
    """Analyze a Visual Strategy (object / dict / :class:`MotionContext`) into a
    :class:`MotionStrategy`. Never raises — any failure yields a safe default."""
    try:
        return get_analyzer(analyzer_name).analyze(_to_context(source))
    except Exception:  # noqa: BLE001 — analysis must never break a caller
        return DeterministicMotionAnalyzer().analyze(MotionContext())


__all__ = [
    "MotionContext", "MotionAnalyzer", "DeterministicMotionAnalyzer",
    "analyze", "get_analyzer", "register_analyzer",
]
