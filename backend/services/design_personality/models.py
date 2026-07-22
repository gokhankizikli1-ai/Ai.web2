# coding: utf-8
"""
Design Personality Intelligence — typed models.

The layer infers a DESIGN PERSONALITY from the user's request — the single decision that
stops every generated site from defaulting to the same generic "futuristic AI" styling.
An AI product is only futuristic when nothing more specific applies; an AI banking app is
trustworthy, an AI toy for kids is playful. From that personality it derives a visual
direction, a motion direction, and an avoid list.

Pure, serializable value objects with no behaviour beyond ``to_dict``. Enum is string-
valued so the profile round-trips cleanly to JSON for a future Web Build context.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List


class DesignPersonality(str, Enum):
    """The inferred design personality — the 'who is this brand' decision."""

    FUTURISTIC = "futuristic"                          # innovative, cutting-edge tech
    CINEMATIC_ELEGANT = "cinematic_elegant"            # luxury, exclusive, refined
    PLAYFUL = "playful"                                # fun, friendly, energetic
    TRUSTWORTHY_PREMIUM = "trustworthy_premium"        # credible, secure, assured
    NATURAL_EDITORIAL = "natural_editorial"            # warm, authentic, handcrafted
    MINIMAL_MODERN = "minimal_modern"                  # refined, understated, precise
    BOLD_CREATIVE = "bold_creative"                    # expressive, confident, editorial
    APPROACHABLE_PROFESSIONAL = "approachable_professional"  # safe, neutral default


def _clean(values: List[str], limit: int = 8) -> List[str]:
    out: List[str] = []
    seen: set = set()
    for value in values or []:
        text = " ".join(str(value).split()).strip()
        key = text.lower()
        if text and key not in seen:
            seen.add(key)
            out.append(text)
        if len(out) >= limit:
            break
    return out


@dataclass
class DesignPersonalityProfile:
    """The inferred personality and the directions it implies."""

    design_personality: DesignPersonality = DesignPersonality.APPROACHABLE_PROFESSIONAL
    visual_direction: str = ""
    motion_direction: str = ""
    avoid_list: List[str] = field(default_factory=list)

    # Provenance — how confident and why (matched signals help debugging, never rendered).
    confidence: float = 0.0
    matched_signals: List[str] = field(default_factory=list)
    source: str = "deterministic"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "design_personality": self.design_personality.value,
            "visual_direction": self.visual_direction,
            "motion_direction": self.motion_direction,
            "avoid_list": _clean(self.avoid_list),
            "confidence": round(float(self.confidence), 3),
            "matched_signals": _clean(self.matched_signals, 12),
            "source": self.source,
        }


__all__ = ["DesignPersonality", "DesignPersonalityProfile"]
