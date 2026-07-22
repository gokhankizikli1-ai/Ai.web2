# coding: utf-8
"""
Web Quality Guard — the principle library + resolver.

Two composable layers keep this useful without ballooning:
  1. a UNIVERSAL base of design-quality principles that apply to every site, and
  2. small per-category refinements (SaaS, hospitality, creative, retail, service) laid
     on top, chosen by a weighted classification of the request (industry weighted
     highest, then the free prompt) — not a single-keyword lookup.

Everything is DESIGN guidance (hierarchy, whitespace, trust, restraint), never technical
implementation detail. Pure, deterministic and total: it never raises and always returns
a usable :class:`QualityGuidelines` (the universal base when nothing else matches).
"""
from __future__ import annotations

from typing import Any, Dict, List, Tuple

from backend.services.web_quality_guard.models import QualityGuidelines

# ── Universal base — the marks of a professionally designed site ──────────────
_BASE_LAYOUT = ("strong visual hierarchy", "clear hero purpose", "balanced whitespace",
                "one focal point per section")
_BASE_UX = ("obvious primary CTA", "simple navigation", "mobile-first thinking")
_BASE_VISUAL = ("consistent typography scale", "intentional color system", "cohesive spacing rhythm")
_BASE_CONVERSION = ("explain the value quickly", "build trust with real proof")
_BASE_CRAFT = ("consistent spacing scale", "accessible color contrast", "clear content hierarchy")
_BASE_AVOID = ("template layouts", "repeated identical sections", "excessive animations",
               "random cards", "generic gradients")


# ── Category refinements — a few extra, tailored principles ────────────────────
# (layout, ux, visual, conversion, avoid) additions per site category.
_CATEGORY_RULES: Dict[str, Dict[str, Tuple[str, ...]]] = {
    "saas_tech": {
        "layout": ("lead with the core benefit, not the feature list",),
        "visual": ("show the real product UI, not abstract filler",),
        "conversion": ("prove outcomes with metrics and logos",),
    },
    "hospitality": {
        "visual": ("let photography carry the mood",),
        "conversion": ("make reservations, hours and location obvious",),
        "avoid": ("stocky brown food clichés",),
    },
    "creative_portfolio": {
        "layout": ("let the work dominate; chrome recedes",),
        "visual": ("editorial, gallery-first restraint",),
        "conversion": ("make contact and availability effortless",),
    },
    "retail_ecommerce": {
        "layout": ("product-first grid clarity",),
        "conversion": ("clear pricing and a confident add-to-cart",),
        "avoid": ("noisy backgrounds that fight the product",),
    },
    "service_local": {
        "ux": ("booking or a quote in one obvious step",),
        "conversion": ("surface contact, credentials and reviews early",),
    },
}

# ── Weighted classification lexicons (industry field weighted highest) ─────────
_CATEGORY_SIGNALS: Dict[str, Tuple[str, ...]] = {
    "saas_tech": ("saas", "software", "ai", "app", "platform", "dashboard", "api", "tech",
                  "startup", "automation", "analytics", "developer", "cloud"),
    "hospitality": ("restaurant", "cafe", "coffee", "hotel", "bakery", "food", "bar",
                    "catering", "resort", "bistro", "dining", "brewery"),
    "creative_portfolio": ("portfolio", "photographer", "designer", "artist", "studio",
                           "agency", "creative", "gallery", "director", "illustrator"),
    "retail_ecommerce": ("shop", "store", "ecommerce", "boutique", "fashion", "product",
                         "catalog", "marketplace", "clothing", "cosmetics", "retail"),
    "service_local": ("clinic", "salon", "law", "dentist", "plumber", "contractor",
                      "consulting", "service", "local", "repair", "landscaping", "fitness"),
}


def _tokens(text: str) -> List[str]:
    return [t for t in "".join(c.lower() if (c.isalnum() or c.isspace()) else " " for c in (text or "")).split() if len(t) > 1]


def classify_site(context: Dict[str, Any]) -> str:
    """Classify the request into a site category. The industry/site-type field is
    decisive; the free prompt supports it. Returns ``"generic"`` when nothing matches."""
    ctx = context if isinstance(context, dict) else {}
    industry_text = " ".join(str(ctx.get(k) or "") for k in ("industry", "sector", "siteType", "site_type")).lower()
    industry_tokens = set(_tokens(industry_text))
    prompt_tokens = set(_tokens(" ".join(str(ctx.get(k) or "") for k in ("prompt", "description", "request"))))

    best, best_score = "generic", 0.0
    for category, signals in _CATEGORY_SIGNALS.items():
        score = 0.0
        for term in signals:
            if term in industry_tokens:
                score += 3.0
            elif term in prompt_tokens:
                score += 1.0
        if score > best_score:
            best, best_score = category, score
    return best if best_score > 0 else "generic"


def resolve_guidelines(context: Dict[str, Any]) -> QualityGuidelines:
    """Compose the universal base + the matched category's refinements. Total."""
    category = classify_site(context)
    extra = _CATEGORY_RULES.get(category, {})
    # Category refinements LEAD each section so the site-specific principle survives the
    # per-section bullet cap; the universal base fills the remaining slots.
    return QualityGuidelines(
        layout_principles=list(extra.get("layout", ())) + list(_BASE_LAYOUT),
        ux_principles=list(extra.get("ux", ())) + list(_BASE_UX),
        visual_principles=list(extra.get("visual", ())) + list(_BASE_VISUAL),
        conversion_principles=list(extra.get("conversion", ())) + list(_BASE_CONVERSION),
        code_quality_principles=list(_BASE_CRAFT),
        avoid_patterns=list(_BASE_AVOID) + list(extra.get("avoid", ())),
        site_category=category,
        source="rule_based",
    )


__all__ = ["classify_site", "resolve_guidelines"]
