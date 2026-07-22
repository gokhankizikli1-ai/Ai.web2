# coding: utf-8
"""
Design Observability — the Design Decision Trace model.

A read-only record that answers "why did Korvix create this website style?": which
intelligence layers contributed, the final design direction, the strongest reasons, and
whether explicit user instructions overrode the defaults.

It is metadata ONLY — it never influences generation. It deliberately stores NO raw user
prompt or other sensitive content: only derived, non-identifying design decisions
(industry label, direction, reasons, avoid list). Pure and serializable.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List


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
class DesignDecisionTrace:
    """Why a given website's design direction was chosen (debug metadata only)."""

    industry: str = ""
    selected_direction: str = ""          # one-line synthesized direction

    # Per-layer contribution, in short human phrases (never raw internal fields).
    visual: str = ""
    motion: str = ""
    personality: str = ""
    quality: str = ""
    adaptation: str = ""

    priority: str = ""                    # the decision hierarchy that applied
    contributing_layers: List[str] = field(default_factory=list)
    main_reasons: List[str] = field(default_factory=list)
    avoided: List[str] = field(default_factory=list)
    user_override: bool = False           # did explicit user instructions steer the result?
    confidence: float = 0.0               # personality inference confidence (0..1)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "industry": self.industry,
            "selected_direction": self.selected_direction,
            "visual": self.visual,
            "motion": self.motion,
            "personality": self.personality,
            "quality": self.quality,
            "adaptation": self.adaptation,
            "priority": self.priority,
            "contributing_layers": _clean(self.contributing_layers, 8),
            "main_reasons": _clean(self.main_reasons, 8),
            "avoided": _clean(self.avoided, 8),
            "user_override": bool(self.user_override),
            "confidence": round(float(self.confidence), 3),
        }


__all__ = ["DesignDecisionTrace"]
