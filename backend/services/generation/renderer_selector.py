# coding: utf-8
# Sprint 2.0 — Universal Renderer Selector.
#
# Layer ON TOP of the existing `layout` dispatch (app/editor/ecommerce/
# booking/landing/portfolio/mobile) that every renderer module and dozens
# of locked tests already depend on. This module never changes which
# `layout`/renderer module actually renders the page — it only (a) labels
# the choice with one of the 7 product-facing renderer categories the
# Sprint 2.0 spec names, and (b) for the two layouts that currently fan
# out into more than one named category (`app` → SaaS Dashboard / Admin
# Panel / Analytics Dashboard, `landing` → Landing Page / Marketing
# Website) picks a `variant` so the renderer module can compose slightly
# different content emphasis without forking the layout itself.
#
# Pure + deterministic. Never raises.

from __future__ import annotations

import re
from typing import Any, Dict, Optional

# The 7 product-facing renderer categories (Sprint 2.0 objective #1).
RENDERER_CATEGORIES = (
    "mobile_app", "saas_dashboard", "landing_page", "admin_panel",
    "marketing_website", "portfolio", "analytics_dashboard",
)

# Internal `layout` → default category. `app` and `landing` are further
# refined below (they're the two layouts that cover more than one named
# category). Layouts with no dedicated named category (editor/ecommerce/
# booking) get the closest sensible label for metadata purposes only —
# they keep rendering through their own dedicated renderer module either way.
_LAYOUT_TO_CATEGORY: Dict[str, str] = {
    "mobile":    "mobile_app",
    "portfolio": "portfolio",
    "landing":   "landing_page",
    "app":       "saas_dashboard",
    "editor":    "saas_dashboard",
    "ecommerce": "marketing_website",
    "booking":   "marketing_website",
}

_ADMIN_RE = re.compile(
    r"\badmin(?:istrat\w*)?\s*(?:panel|dashboard|console)?\b|"
    r"back[\s-]*office|control\s*panel|management\s*console|\bcms\b", re.I,
)
_ANALYTICS_RE = re.compile(
    r"\banalytics?\b|\bkpi\b|\binsights?\b|\bdata\s*viz|"
    r"\bmetrics?\s*dashboard\b|\btelemetry\b|\breporting\s*dashboard\b", re.I,
)
# Deliberately narrow: a generic "startup"/"SaaS" landing page must stay
# `landing_page`. Only an explicit agency/marketing-site/brand-site signal
# upgrades a landing-layout request to `marketing_website`.
_MARKETING_RE = re.compile(
    r"\bagency\b|\bmarketing\s*(?:site|website|page|agency)\b|"
    r"\bbrand(?:ing)?\s*(?:site|website|studio|agency)\b", re.I,
)


def select_renderer(*, text: str, layout: str, product_type: str = "",
                    blueprint: Optional[Dict[str, Any]] = None) -> Dict[str, Optional[str]]:
    """Pick the Sprint 2.0 renderer category (+ optional content variant)
    for an already-classified request. Never changes `layout` — purely a
    labeling/composition-hint layer on top of it.

    Returns {"category": one of RENDERER_CATEGORIES, "layout": layout,
    "variant": str|None}."""
    t = text or ""
    layout = (layout or "").lower()
    category = _LAYOUT_TO_CATEGORY.get(layout, "saas_dashboard")
    variant: Optional[str] = None

    bp = blueprint if isinstance(blueprint, dict) else {}
    blueprint_category = str(bp.get("product_category") or "").strip().lower()

    if layout == "app":
        if _ADMIN_RE.search(t) or blueprint_category == "admin":
            category, variant = "admin_panel", "admin_panel"
        elif _ANALYTICS_RE.search(t) or blueprint_category == "analytics":
            category, variant = "analytics_dashboard", "analytics_dashboard"
        else:
            category, variant = "saas_dashboard", "saas_dashboard"
    elif layout == "landing":
        if _MARKETING_RE.search(t):
            category, variant = "marketing_website", "marketing_website"
        else:
            category, variant = "landing_page", "landing_page"

    return {"category": category, "layout": layout, "variant": variant}


__all__ = ["RENDERER_CATEGORIES", "select_renderer"]
