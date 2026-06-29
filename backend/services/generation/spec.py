# coding: utf-8
# EPIC 2 — ProductSpec: the internal, expanded product specification.
#
# The user's one-line prompt is NEVER used directly. It is expanded into
# this structured spec (product type, audience, goals, navigation,
# sections, metrics, theme, components, copy) which drives both the LLM
# prompt and the deterministic premium renderer. The user never sees it.

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List


@dataclass
class Section:
    """One rendered section of the generated app/site."""
    kind: str                       # hero|features|metrics|pricing|faq|testimonials|list|gallery|cta|panel
    title: str = ""
    subtitle: str = ""
    items: List[Dict[str, Any]] = field(default_factory=list)  # cards/rows/etc.

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class ProductSpec:
    product_type: str               # fitness|banking|ai_chat|restaurant|saas|crypto|dashboard|app|website
    name: str                       # real product name (never "My App")
    tagline: str
    description: str
    audience: str
    primary_goals: List[str]
    ux_goals: List[str]
    navigation: List[str]
    sections: List[Section]
    metrics: List[Dict[str, str]]   # dashboard stat cards [{label,value,delta}]
    cta_primary: str
    cta_secondary: str
    theme: Dict[str, str]           # {accent, accent2, mode}
    components: List[str]
    is_dashboard: bool = False
    responsive: bool = True
    dark_mode: bool = True

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["sections"] = [s.to_dict() if isinstance(s, Section) else s for s in self.sections]
        return d

    # ── Compact spec block injected into the (invisible) LLM prompt ────
    def to_prompt_block(self) -> str:
        lines = [
            f"PRODUCT TYPE: {self.product_type}",
            f"PRODUCT NAME: {self.name}",
            f"TAGLINE: {self.tagline}",
            f"TARGET AUDIENCE: {self.audience}",
            f"PRIMARY GOALS: {', '.join(self.primary_goals)}",
            f"UX GOALS: {', '.join(self.ux_goals)}",
            f"NAVIGATION: {', '.join(self.navigation)}",
            f"REQUIRED SECTIONS: {', '.join(s.kind + ('/' + s.title if s.title else '') for s in self.sections)}",
            f"PRIMARY CTA: {self.cta_primary}",
            f"THEME: {self.theme.get('mode','dark')} mode, accent {self.theme.get('accent')}",
            f"RESPONSIVE: yes (mobile-first)",
            f"DARK MODE: {'yes' if self.dark_mode else 'no'}",
        ]
        if self.metrics:
            lines.append("DASHBOARD WIDGETS: " + ", ".join(m["label"] for m in self.metrics))
        return "\n".join(lines)


__all__ = ["Section", "ProductSpec"]
