# coding: utf-8
"""
Image Intelligence — the Design Intent object.

The Design Intent is the structured brief the whole layer reasons over. It captures
WHAT the site is (industry, audience, brand positioning), HOW it should feel
(emotional tone, visual/image style, color palette) and WHAT it must accomplish
(conversion goal) — plus the concrete per-slot image requirements the ranking engine
scores candidates against.

It is assembled from two sources, both optional:
  • the deterministic image-needs plan the caller already computes (one per slot), and
  • an optional ``context`` dict the Web Builder can pass through from the frontend
    spec (identity + design system).

Nothing here does I/O; :func:`build_design_intent` never raises and always returns a
usable object (empty strings / neutral defaults when a signal is absent).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

# Orientation → (min sensible aspect ratio, ideal aspect ratio, max sensible ratio),
# expressed as width / height. Drives composition scoring per slot.
_ORIENTATION_ASPECT = {
    "landscape": (1.20, 1.78, 2.60),  # ~4:3 … 16:9 … ultrawide
    "portrait": (0.45, 0.72, 0.90),   # ~9:16 … 3:4
    "square": (0.85, 1.00, 1.20),
}

# Purpose → whether the slot is conversion-critical and how large it should read.
# Used by the conversion scorer; a hero above the fold is worth more than a small
# gallery thumbnail, and it must not be low-resolution.
_PURPOSE_PROFILE = {
    "hero": {"critical": True, "min_megapixels": 1.4},
    "background": {"critical": True, "min_megapixels": 1.6},
    "product": {"critical": True, "min_megapixels": 0.5},
    "gallery": {"critical": False, "min_megapixels": 0.4},
    "project": {"critical": False, "min_megapixels": 0.5},
    "about": {"critical": False, "min_megapixels": 0.5},
    "team": {"critical": False, "min_megapixels": 0.3},
    "other": {"critical": False, "min_megapixels": 0.3},
}


@dataclass
class ImageRequirement:
    """The requirement for a single image slot in the site."""

    slot_id: str
    purpose: str = "other"                 # hero|background|product|gallery|project|about|team|other
    orientation: str = "landscape"         # landscape|portrait|square
    subject: str = ""                      # the search subject / query for this slot
    alt_text: str = ""
    required: bool = False

    @property
    def is_conversion_critical(self) -> bool:
        return bool(_PURPOSE_PROFILE.get(self.purpose, _PURPOSE_PROFILE["other"])["critical"]) or self.required

    @property
    def min_megapixels(self) -> float:
        return float(_PURPOSE_PROFILE.get(self.purpose, _PURPOSE_PROFILE["other"])["min_megapixels"])

    def aspect_band(self) -> tuple:
        return _ORIENTATION_ASPECT.get(self.orientation, _ORIENTATION_ASPECT["landscape"])


@dataclass
class DesignIntent:
    """The structured design brief that drives image selection."""

    industry: str = ""
    target_audience: str = ""
    brand_style: str = ""
    emotional_tone: str = ""
    color_palette: List[str] = field(default_factory=list)
    image_style: str = ""
    required_sections: List[str] = field(default_factory=list)
    hero_image_requirement: Optional[ImageRequirement] = None
    section_image_requirements: List[ImageRequirement] = field(default_factory=list)
    conversion_goal: str = ""

    def all_requirements(self) -> List[ImageRequirement]:
        reqs: List[ImageRequirement] = []
        if self.hero_image_requirement is not None:
            reqs.append(self.hero_image_requirement)
        reqs.extend(self.section_image_requirements)
        return reqs

    def requirement_for(self, slot_id: str) -> Optional[ImageRequirement]:
        for req in self.all_requirements():
            if req.slot_id == slot_id:
                return req
        return None

    def vocabulary(self) -> List[str]:
        """Lower-cased intent keywords used to bias relevance scoring toward on-brand
        subjects (industry + style + tone + audience), de-duplicated."""
        parts: List[str] = []
        for text in (self.industry, self.image_style, self.brand_style,
                     self.emotional_tone, self.target_audience):
            parts.extend(_tokens(text))
        seen: set = set()
        out: List[str] = []
        for token in parts:
            if token not in seen:
                seen.add(token)
                out.append(token)
        return out


# ── Builders ──────────────────────────────────────────────────────────────────

def _s(value: Any, limit: int = 120) -> str:
    return str(value).strip()[:limit] if isinstance(value, (str, int, float)) else ""


def _str_list(value: Any, limit: int = 12) -> List[str]:
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, (list, tuple)):
        return []
    out: List[str] = []
    for item in value:
        text = _s(item, 60)
        if text:
            out.append(text)
        if len(out) >= limit:
            break
    return out


def _tokens(text: str) -> List[str]:
    return [t for t in "".join(c.lower() if (c.isalnum() or c.isspace()) else " " for c in (text or "")).split() if len(t) > 1]


def _requirement_from_need(need: Dict[str, Any]) -> Optional[ImageRequirement]:
    slot_id = _s(need.get("slotId"), 120)
    if not slot_id:
        return None
    purpose = _s(need.get("purpose"), 40).lower() or "other"
    if purpose not in _PURPOSE_PROFILE:
        purpose = "other"
    orientation = _s(need.get("orientation"), 16).lower()
    if orientation not in _ORIENTATION_ASPECT:
        orientation = "landscape"
    return ImageRequirement(
        slot_id=slot_id,
        purpose=purpose,
        orientation=orientation,
        subject=_s(need.get("query"), 120),
        alt_text=_s(need.get("altText"), 200),
        required=bool(need.get("required")),
    )


def build_design_intent(
    needs: List[Dict[str, Any]],
    context: Optional[Dict[str, Any]] = None,
) -> DesignIntent:
    """Assemble a :class:`DesignIntent` from the image-needs plan and optional context.

    ``needs`` are the same per-slot dicts the sourcing service already receives
    (``slotId``/``query``/``orientation``/``purpose``/``altText``/``required``).
    ``context`` is an OPTIONAL sanitized dict the Web Builder may forward from the
    frontend spec — any subset of: ``industry``/``sector``, ``targetAudience``/
    ``audience``, ``brandStyle``, ``emotionalTone``/``tone``, ``colorPalette``/
    ``palette``, ``imageStyle``, ``requiredSections``, ``conversionGoal``/``goal``.

    Missing signal degrades gracefully — the resulting intent is always usable.
    """
    ctx = context if isinstance(context, dict) else {}

    requirements: List[ImageRequirement] = []
    hero: Optional[ImageRequirement] = None
    for raw in (needs or []):
        if not isinstance(raw, dict):
            continue
        req = _requirement_from_need(raw)
        if req is None:
            continue
        if hero is None and (req.purpose in ("hero", "background") or req.required):
            hero = req
        else:
            requirements.append(req)

    # If no explicit hero was found, the first requirement anchors the hero slot so the
    # conversion scorer always has a primary asset to weigh.
    if hero is None and requirements:
        hero = requirements.pop(0)

    palette = _str_list(ctx.get("colorPalette") or ctx.get("palette"))
    return DesignIntent(
        industry=_s(ctx.get("industry") or ctx.get("sector")),
        target_audience=_s(ctx.get("targetAudience") or ctx.get("audience")),
        brand_style=_s(ctx.get("brandStyle") or ctx.get("style")),
        emotional_tone=_s(ctx.get("emotionalTone") or ctx.get("tone")),
        color_palette=palette,
        image_style=_s(ctx.get("imageStyle")),
        required_sections=_str_list(ctx.get("requiredSections")),
        hero_image_requirement=hero,
        section_image_requirements=requirements,
        conversion_goal=_s(ctx.get("conversionGoal") or ctx.get("goal")),
    )


__all__ = ["ImageRequirement", "DesignIntent", "build_design_intent"]
