# coding: utf-8
# EPIC 2 — Reusable component library.
#
# The catalog the generator assembles from (instead of random HTML), and
# a detector that reports which components a generated page actually
# uses (surfaced in artifact metadata). Pure data + regex — testable.

from __future__ import annotations

import re
from typing import Dict, List

# name → one-line "when to use" guidance, fed to the (invisible) LLM prompt.
COMPONENT_CATALOG: Dict[str, str] = {
    "Navbar":          "Top navigation with brand + links + primary CTA.",
    "Sidebar":         "Left navigation rail for app/dashboard layouts.",
    "Hero":            "Above-the-fold headline, sub-copy and primary actions.",
    "CTA":             "Focused call-to-action band.",
    "Feature Grid":    "Responsive grid of feature cards with icons.",
    "Dashboard Cards": "Metric/summary cards for dashboards.",
    "Statistics":      "Big-number stats with trend deltas.",
    "Charts":          "Mock chart/sparkline visualisations.",
    "Pricing Tables":  "Tiered pricing plans with highlights.",
    "Testimonials":    "Social-proof quotes with attribution.",
    "FAQ":             "Expandable common questions.",
    "Search Bar":      "Prominent search input.",
    "Notifications":   "Alert/notification surface.",
    "Calendar":        "Date/schedule view.",
    "Authentication":  "Sign-in / sign-up forms.",
    "Forms":           "Inputs for booking, contact, settings.",
    "Settings":        "Preference panels.",
    "Profile":         "User profile surface.",
    "Footer":          "Site footer with links + legal.",
    "Empty States":    "Friendly empty/zero-data states.",
    "Loading States":  "Skeletons/spinners for async content.",
}

ALL_COMPONENTS: List[str] = list(COMPONENT_CATALOG.keys())

# Detection signals: component → regexes that, if matched in the HTML,
# indicate the component is present.
_DETECT = {
    "Navbar":         [r"ds-nav\b", r"<nav[\s>]"],
    "Sidebar":        [r"ds-sidebar", r"aside[\s>].*nav", r"sidebar"],
    "Hero":           [r"ds-hero", r"hero"],
    "CTA":            [r"ds-cta|class=\"[^\"]*cta", r">\s*(get started|start free|reserve|connect wallet)"],
    "Feature Grid":   [r"ds-grid", r"feature"],
    "Dashboard Cards":[r"ds-card", r"ds-stat"],
    "Statistics":     [r"ds-stat", r"stat-value"],
    "Charts":         [r"chart|spark|svg"],
    "Pricing Tables": [r"pricing|/mo|per user|per month"],
    "Testimonials":   [r"testimonial|—\s*\w|★"],
    "FAQ":            [r"faq|frequently asked|<details"],
    "Search Bar":     [r"type=\"search\"|search"],
    "Footer":         [r"ds-footer", r"<footer"],
    "Forms":          [r"<form|<input|reserve|contact"],
}


def detect_components(html: str) -> List[str]:
    """Return the catalog components detected in `html`, in catalog order."""
    h = (html or "").lower()
    found: List[str] = []
    for name, patterns in _DETECT.items():
        if any(re.search(p, h, re.I) for p in patterns):
            found.append(name)
    return found


def catalog_prompt_block() -> str:
    """The component menu injected into the (invisible) LLM prompt."""
    return "\n".join(f"- {n}: {d}" for n, d in COMPONENT_CATALOG.items())


__all__ = ["COMPONENT_CATALOG", "ALL_COMPONENTS", "detect_components", "catalog_prompt_block"]
