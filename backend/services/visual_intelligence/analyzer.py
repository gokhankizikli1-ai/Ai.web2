# coding: utf-8
"""
Visual Intelligence — the analyzer abstraction.

The analyzer turns understanding (industry, audience, brand descriptors, emotional
hint) into a structured :class:`VisualStrategy`. It is deliberately an ABSTRACTION,
not a function: :class:`VisualAnalyzer` is the contract, and today's
:class:`DeterministicVisualAnalyzer` is one implementation. A future
``AIVisualAnalyzer`` (LLM-backed) can be registered under the same contract without any
caller change — the seam is ready, the wiring is not part of this PR.

The deterministic analyzer works in two composable stages so it is a reasoning layer,
not a keyword table:
  1. RESOLVE a brand archetype by scoring every profile against the whole signal
     surface (see :mod:`.strategies`);
  2. REFINE that baseline with orthogonal modifiers (luxury / bold / playful / minimal /
     calm) detected in the input, so two brands in the same industry can diverge.

Everything is deterministic, bounded and total — it never raises and always returns a
usable strategy (neutral when the input says nothing).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Protocol, runtime_checkable

from backend.services.visual_intelligence.models import (
    ImageStrategy, MotionIntensity, MotionStrategy, RealismLevel, VisualStrategy,
)
from backend.services.visual_intelligence import strategies

# Bounds so a pathologically long prompt can never blow up analysis cost.
_MAX_TEXT = 2000
_MAX_TOKENS = 400

_INTENSITY_ORDER = [
    MotionIntensity.NONE, MotionIntensity.MINIMAL, MotionIntensity.SUBTLE,
    MotionIntensity.MODERATE, MotionIntensity.EXPRESSIVE, MotionIntensity.DYNAMIC,
]

# Orthogonal refinement lexicons (tone/character, independent of industry).
_LUXURY = frozenset({"luxury", "luxurious", "premium", "elegant", "exclusive", "high-end",
                     "upscale", "sophisticated", "bespoke", "opulent", "first-class"})
_BOLD = frozenset({"bold", "dramatic", "striking", "powerful", "edgy", "daring", "loud", "punchy"})
_PLAYFUL = frozenset({"playful", "fun", "vibrant", "lively", "cheerful", "whimsical", "quirky", "friendly"})
_MINIMAL = frozenset({"minimal", "minimalist", "clean", "simple", "understated", "essential", "sparse"})
_CALM = frozenset({"calm", "serene", "gentle", "soft", "soothing", "tranquil", "quiet", "relaxed"})


def _tokens_of(text: str) -> List[str]:
    raw = "".join(c.lower() if (c.isalnum() or c.isspace()) else " " for c in (text or "")).split()
    out: List[str] = []
    seen: set = set()
    for tok in raw:
        if len(tok) > 1 and tok not in seen:
            seen.add(tok)
            out.append(tok)
        if len(out) >= _MAX_TOKENS:
            break
    return out


@dataclass
class VisualContext:
    """Normalized input for the analyzer — decoupled from any specific upstream type.

    Build it from a plain context dict (:meth:`from_dict`) or from an existing Design
    Intent (:meth:`from_design_intent`, duck-typed so this module never imports the
    Image Intelligence layer)."""

    industry: str = ""
    audience: str = ""
    brand_signals: str = ""       # brand style / personality descriptors
    emotional_hint: str = ""
    image_style_hint: str = ""
    conversion_goal: str = ""
    prompt: str = ""

    def signal_text(self) -> str:
        parts = [self.industry, self.audience, self.brand_signals, self.emotional_hint,
                 self.image_style_hint, self.conversion_goal, self.prompt]
        return " ".join(p for p in parts if p).strip().lower()[:_MAX_TEXT]

    def tokens(self) -> List[str]:
        return _tokens_of(self.signal_text())

    @staticmethod
    def _first(d: Dict[str, Any], *keys: str) -> str:
        for key in keys:
            value = d.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
            if isinstance(value, (list, tuple)) and value:
                return " ".join(str(v) for v in value if v)[:400]
        return ""

    @classmethod
    def from_dict(cls, data: Optional[Dict[str, Any]]) -> "VisualContext":
        d = data if isinstance(data, dict) else {}
        return cls(
            industry=cls._first(d, "industry", "sector", "subsector"),
            audience=cls._first(d, "audience", "targetAudience", "target_audience"),
            brand_signals=cls._first(d, "brand_style", "brandStyle", "brand_personality", "style"),
            emotional_hint=cls._first(d, "emotional_tone", "emotionalTone", "emotional_goal", "tone"),
            image_style_hint=cls._first(d, "image_style", "imageStyle"),
            conversion_goal=cls._first(d, "conversion_goal", "conversionGoal", "goal"),
            prompt=cls._first(d, "prompt", "request", "description"),
        )

    @classmethod
    def from_design_intent(cls, intent: Any) -> "VisualContext":
        """Adapt an existing Design Intent (duck-typed — no hard dependency)."""
        g = lambda name: str(getattr(intent, name, "") or "").strip()  # noqa: E731
        return cls(
            industry=g("industry"),
            audience=g("target_audience"),
            brand_signals=g("brand_style"),
            emotional_hint=g("emotional_tone"),
            image_style_hint=g("image_style"),
            conversion_goal=g("conversion_goal"),
        )


@runtime_checkable
class VisualAnalyzer(Protocol):
    """The analyzer contract. Any implementation (deterministic today, AI later) that
    turns a :class:`VisualContext` into a :class:`VisualStrategy` satisfies it."""

    name: str

    def analyze(self, context: VisualContext) -> VisualStrategy:
        ...


# ── Refinement helpers ────────────────────────────────────────────────────────

def _shift_intensity(intensity: MotionIntensity, delta: int) -> MotionIntensity:
    idx = _INTENSITY_ORDER.index(intensity)
    return _INTENSITY_ORDER[max(0, min(len(_INTENSITY_ORDER) - 1, idx + delta))]


def _add(values: List[str], *items: str) -> List[str]:
    out = list(values)
    for item in items:
        if item and item.lower() not in {v.lower() for v in out}:
            out.append(item)
    return out


def _emotional_goal(profile: strategies.VisualProfile, hint: str) -> str:
    if hint:
        return f"evoke a feeling that is {hint}"
    lead = profile.brand_personality.split(",")[0].strip() or "considered"
    return f"leave visitors with an impression that is {lead} and intentional"


class DeterministicVisualAnalyzer:
    """Rule-composed analyzer: resolve an archetype, then apply tone refinements.

    Isolated and side-effect free — it reads a :class:`VisualContext` and returns a new
    :class:`VisualStrategy`; it never mutates the shared archetype library."""

    name = "deterministic"

    def analyze(self, context: VisualContext) -> VisualStrategy:
        tokens = context.tokens()
        text = context.signal_text()
        profile, confidence = strategies.resolve_profile(tokens, text, context.industry)

        # Copy the archetype's image/motion so refinements never touch the shared library.
        image = ImageStrategy(
            preferred_visual_type=profile.image.preferred_visual_type,
            photography_style=profile.image.photography_style,
            composition=profile.image.composition,
            avoid_patterns=list(profile.image.avoid_patterns),
        )
        motion = MotionStrategy(
            intensity=profile.motion.intensity,
            animation_style=profile.motion.animation_style,
            preferred_effects=list(profile.motion.preferred_effects),
            avoid_effects=list(profile.motion.avoid_effects),
        )
        strategy = VisualStrategy(
            industry=context.industry,
            audience=context.audience,
            brand_personality=profile.brand_personality,
            emotional_goal=_emotional_goal(profile, context.emotional_hint),
            visual_style=profile.visual_style,
            color_direction=profile.color_direction,
            typography_direction=profile.typography_direction,
            image_strategy=image,
            motion_strategy=motion,
            realism_level=profile.realism_level,
            archetype=profile.key,
            confidence=confidence,
            source=self.name,
        )
        self._refine(strategy, set(tokens))
        return strategy

    def _refine(self, s: VisualStrategy, tokens: set) -> None:
        """Apply orthogonal tone modifiers on top of the baseline archetype."""
        if tokens & _LUXURY:
            s.realism_level = RealismLevel.CINEMATIC
            s.motion_strategy.intensity = min(
                s.motion_strategy.intensity, MotionIntensity.SUBTLE, key=_INTENSITY_ORDER.index)
            s.motion_strategy.avoid_effects = _add(s.motion_strategy.avoid_effects, "flashy or bright playful animations")
            s.motion_strategy.preferred_effects = _add(s.motion_strategy.preferred_effects, "slow elegant reveal")
            if "editorial" not in s.typography_direction.lower():
                s.typography_direction = f"editorial {s.typography_direction}"
        if tokens & _BOLD:
            s.motion_strategy.intensity = _shift_intensity(s.motion_strategy.intensity, +1)
            if "display" not in s.typography_direction.lower():
                s.typography_direction = f"oversized display type, {s.typography_direction}"
            s.image_strategy.composition = _join(s.image_strategy.composition, "edge-to-edge, confident crops")
        if tokens & _PLAYFUL:
            s.motion_strategy.intensity = _shift_intensity(s.motion_strategy.intensity, +1)
            s.motion_strategy.preferred_effects = _add(s.motion_strategy.preferred_effects, "lively micro-interactions")
        if tokens & _MINIMAL:
            s.motion_strategy.intensity = _shift_intensity(s.motion_strategy.intensity, -1)
            s.image_strategy.avoid_patterns = _add(s.image_strategy.avoid_patterns, "clutter", "decorative noise")
            if "disciplined" not in s.typography_direction.lower():
                s.typography_direction = f"{s.typography_direction}, disciplined spacing"
        if tokens & _CALM:
            s.motion_strategy.intensity = _shift_intensity(s.motion_strategy.intensity, -1)
            s.motion_strategy.preferred_effects = _add(s.motion_strategy.preferred_effects, "gentle fades")
            s.motion_strategy.avoid_effects = _add(s.motion_strategy.avoid_effects, "fast or aggressive motion")


def _join(base: str, addition: str) -> str:
    base = (base or "").strip()
    if not base:
        return addition
    return f"{base}, {addition}" if addition.lower() not in base.lower() else base


# ── Registry (the extension seam for a future AI analyzer) ─────────────────────

_ANALYZERS: Dict[str, VisualAnalyzer] = {}
_DEFAULT = "deterministic"


def register_analyzer(analyzer: VisualAnalyzer) -> None:
    _ANALYZERS[analyzer.name] = analyzer


def get_analyzer(name: Optional[str] = None) -> VisualAnalyzer:
    if not _ANALYZERS:
        register_analyzer(DeterministicVisualAnalyzer())
    return _ANALYZERS.get(name or _DEFAULT, _ANALYZERS[_DEFAULT])


register_analyzer(DeterministicVisualAnalyzer())


def _to_context(source: Any) -> VisualContext:
    if isinstance(source, VisualContext):
        return source
    if isinstance(source, dict):
        return VisualContext.from_dict(source)
    if source is None:
        return VisualContext()
    # Anything else is treated as a duck-typed Design Intent.
    return VisualContext.from_design_intent(source)


def analyze(source: Any, analyzer_name: Optional[str] = None) -> VisualStrategy:
    """Analyze a context dict / Design Intent / :class:`VisualContext` into a
    :class:`VisualStrategy`. Never raises — any failure yields a neutral strategy."""
    try:
        return get_analyzer(analyzer_name).analyze(_to_context(source))
    except Exception:  # noqa: BLE001 — analysis must never break a caller
        return DeterministicVisualAnalyzer().analyze(VisualContext())


__all__ = [
    "VisualContext", "VisualAnalyzer", "DeterministicVisualAnalyzer",
    "analyze", "get_analyzer", "register_analyzer",
]
