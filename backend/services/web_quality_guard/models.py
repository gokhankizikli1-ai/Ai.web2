# coding: utf-8
"""
Web Quality Guard — typed models.

The guard answers ONE question before generation: "what makes this website feel
professionally designed?" The answer is a :class:`QualityGuidelines` — a small set of
DESIGN-quality principles (layout, UX, visual, conversion, craft) plus anti-patterns to
avoid. It is guidance a design director would give, never technical implementation
instructions and never the user's prompt.

Pure, serializable value objects with no behaviour beyond ``to_dict``. Every list is a
handful of short phrases so the rendered block stays well under the ~300-token budget.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List


def _clean(values: List[str], limit: int) -> List[str]:
    """De-duplicate + bound a list of short principle phrases (order-preserving)."""
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
class QualityGuidelines:
    """Compact, design-level quality principles for one generated website."""

    layout_principles: List[str] = field(default_factory=list)
    ux_principles: List[str] = field(default_factory=list)
    visual_principles: List[str] = field(default_factory=list)
    conversion_principles: List[str] = field(default_factory=list)
    code_quality_principles: List[str] = field(default_factory=list)
    avoid_patterns: List[str] = field(default_factory=list)

    # Provenance (never rendered into the model-facing block).
    site_category: str = ""
    source: str = "rule_based"

    # Per-section cap keeps the rendered block bounded regardless of input.
    _CAP = 4

    def to_dict(self) -> Dict[str, Any]:
        return {
            "layout_principles": _clean(self.layout_principles, self._CAP),
            "ux_principles": _clean(self.ux_principles, self._CAP),
            "visual_principles": _clean(self.visual_principles, self._CAP),
            "conversion_principles": _clean(self.conversion_principles, self._CAP),
            "code_quality_principles": _clean(self.code_quality_principles, self._CAP),
            "avoid_patterns": _clean(self.avoid_patterns, self._CAP),
            "site_category": self.site_category,
            "source": self.source,
        }

    def is_empty(self) -> bool:
        return not any((
            self.layout_principles, self.ux_principles, self.visual_principles,
            self.conversion_principles, self.code_quality_principles, self.avoid_patterns,
        ))


__all__ = ["QualityGuidelines"]
