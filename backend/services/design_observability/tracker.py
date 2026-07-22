# coding: utf-8
"""
Design Observability — build the Design Decision Trace.

Read-only: it CONSUMES the existing intelligence outputs (design personality, Visual
Strategy, Motion Strategy, Quality Guidelines, and whether Generation Adaptation is on)
and records a compact trace of the decision. It never analyses anything new, never
influences generation, and never stores the raw user prompt (the prompt is used only
transiently to run the existing analyzers).

Total and fail-open: any failure yields a minimal neutral trace, never an exception.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from backend.services.design_observability.models import DesignDecisionTrace

_MAX_REQUEST = 2000
_SIGNAL_KEYS = (
    "industry", "sector", "subsector", "audience", "targetAudience", "target_audience",
    "brand_style", "brandStyle", "emotional_tone", "emotionalTone", "image_style", "imageStyle",
)
_INDUSTRY_KEYS = ("industry", "sector", "subsector", "siteType", "site_type")

# personality value → a one-line "selected direction" label (prose, not the raw key).
_DIRECTION = {
    "trustworthy_premium": "Trustworthy professional experience",
    "cinematic_elegant": "Cinematic premium experience",
    "playful": "Friendly playful experience",
    "natural_editorial": "Warm editorial experience",
    "minimal_modern": "Minimal modern experience",
    "bold_creative": "Bold creative experience",
    "futuristic": "Modern forward-looking experience",
    "approachable_professional": "Clean modern experience",
}

# Explicit user-preference markers → the user is steering the design (override).
_OVERRIDE_MARKERS = (
    "black and white", "minimal", "minimalist", "monochrome", "no futuristic",
    "not futuristic", "no neon", "avoid ", "don't ", "do not ", "without ", "must be ",
    "make it ", "dark mode", "light mode", "vintage", "retro", "brutalist",
)


def _text(value: Any, limit: int = 120) -> str:
    if value is None:
        return ""
    raw = getattr(value, "value", value)
    return " ".join(str(raw).split()).strip()[:limit]


def _get(source: Any, key: str) -> Any:
    if isinstance(source, dict):
        return source.get(key)
    return getattr(source, key, None)


def _humanize(value: Any) -> str:
    return _text(str(getattr(value, "value", value)).replace("_", " "))


def _signal(user_request: str, context: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    signal: Dict[str, Any] = {"prompt": (user_request or "")[:_MAX_REQUEST]}
    if isinstance(context, dict):
        for key in _SIGNAL_KEYS:
            value = context.get(key)
            if isinstance(value, str) and value.strip():
                signal[key] = value.strip()[:200]
    return signal


def _industry(context: Optional[Dict[str, Any]]) -> str:
    if isinstance(context, dict):
        for key in _INDUSTRY_KEYS:
            value = context.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()[:120]
    return ""


def _detect_override(user_request: str) -> bool:
    text = (user_request or "").lower()
    return any(marker in text for marker in _OVERRIDE_MARKERS)


def _merge_avoids(*lists: Any) -> List[str]:
    out: List[str] = []
    seen: set = set()
    for lst in lists:
        if not isinstance(lst, (list, tuple)):
            continue
        for item in lst:
            human = _humanize(item)
            if human and human.lower() not in seen:
                seen.add(human.lower())
                out.append(human)
    return out[:6]


def build_trace(user_request: str, context: Optional[Dict[str, Any]] = None) -> DesignDecisionTrace:
    """Assemble the Design Decision Trace from the existing intelligence outputs. Never
    raises — returns a minimal neutral trace on any failure."""
    try:
        from backend.services import (
            design_personality, generation_adaptation, motion_intelligence,
            visual_intelligence, web_quality_guard,
        )

        industry = _industry(context)
        signal = _signal(user_request, context)
        source: Dict[str, Any] = dict(context) if isinstance(context, dict) else {}
        source["prompt"] = (user_request or "")[:_MAX_REQUEST]

        personality = design_personality.analyze(source)
        visual = visual_intelligence.analyze(signal)
        motion = motion_intelligence.analyze(visual)
        quality = web_quality_guard.build_quality_guidelines(
            {"prompt": signal["prompt"], "industry": industry})

        p_value = str(getattr(_get(personality, "design_personality"), "value", "") or "")
        visual_style = _text(_get(visual, "visual_style"), 80)
        image = _get(visual, "image_strategy") or {}
        photography = _text(_get(image, "photography_style"), 90)
        motion_intensity = _humanize(_get(motion, "intensity"))
        motion_style = _humanize(_get(motion, "animation_style"))
        adaptation_on = bool(getattr(generation_adaptation, "is_enabled", lambda: False)())

        # Short per-layer phrases.
        visual_phrase = _text(f"{visual_style}{('; ' + photography) if photography else ''}", 140)
        motion_phrase = _text(f"{motion_intensity} {motion_style}".strip(), 60)
        personality_phrase = _humanize(p_value) or "approachable professional"
        quality_top = _merge_avoids(_get(quality, "avoid_patterns"))
        quality_phrase = "avoid " + ", ".join(quality_top[:2]) if quality_top else "professional design principles"

        override = _detect_override(user_request)
        priority = (
            "user request > industry > personality > visual > quality > defaults"
            if override else
            "industry > personality > visual > quality > defaults"
        )

        reasons: List[str] = []
        if visual_style:
            reasons.append(f"{visual_style} visual direction")
        if photography:
            reasons.append(f"{photography.split(',')[0].strip()} preferred")
        if motion_phrase:
            reasons.append(f"{motion_phrase} motion recommended")
        if override:
            reasons.append("Explicit user style preference honored")

        avoided = _merge_avoids(
            _get(personality, "avoid_list"),
            _get(_get(visual, "image_strategy") or {}, "avoid_patterns"),
            _get(quality, "avoid_patterns"),
        )

        contributing = ["Visual Intelligence", "Motion Intelligence",
                        "Design Personality", "Web Quality Guard"]
        if adaptation_on:
            contributing.append("Generation Adaptation")

        return DesignDecisionTrace(
            industry=industry,
            selected_direction=_DIRECTION.get(p_value, _DIRECTION["approachable_professional"]),
            visual=visual_phrase,
            motion=motion_phrase,
            personality=personality_phrase,
            quality=quality_phrase,
            adaptation=(f"{(industry or personality_phrase)} generation rules applied"
                        if adaptation_on else "generation adaptation not applied"),
            priority=priority,
            contributing_layers=contributing,
            main_reasons=[r for r in reasons if r],
            avoided=avoided,
            user_override=override,
            confidence=float(getattr(personality, "confidence", 0.0) or 0.0),
        )
    except Exception:  # noqa: BLE001 — observability must never break anything
        return DesignDecisionTrace(
            selected_direction="Clean modern experience",
            priority="industry > personality > visual > quality > defaults",
        )


__all__ = ["build_trace"]
