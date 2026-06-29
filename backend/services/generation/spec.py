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
    # CRITICAL FIX — product intent + interface architecture.
    layout: str = "landing"         # app|editor|ecommerce|booking|landing|portfolio
    intent: str = "landing_page"    # one of the 12 product intents
    style: Dict[str, Any] = field(default_factory=dict)        # resolved style mode
    capabilities: Dict[str, bool] = field(default_factory=dict)  # needs_* flags
    data: Dict[str, Any] = field(default_factory=dict)        # layout-specific seed data

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["sections"] = [s.to_dict() if isinstance(s, Section) else s for s in self.sections]
        return d

    # ── Compact spec block injected into the (invisible) LLM prompt ────
    def to_prompt_block(self) -> str:
        lines = [
            f"PRODUCT INTENT: {self.intent} (render as the actual {self.layout} interface — NOT a marketing page unless the layout is 'landing'/'portfolio')",
            f"VISUAL STYLE: {self.style.get('label', 'modern')} ({self.style.get('mode', 'dark')} mode)",
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
        on = [k.replace("needs_", "") for k, v in (self.capabilities or {}).items() if v]
        if on:
            lines.append("REQUIRED SURFACES: " + ", ".join(on))
            off = [k.replace("needs_", "") for k, v in self.capabilities.items() if not v]
            if off:
                lines.append("DO NOT INCLUDE: " + ", ".join(off))
        return "\n".join(lines)


__all__ = ["Section", "ProductSpec"]
