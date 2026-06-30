# coding: utf-8
"""
Intent parser — natural language → ProductIntent.

Combines the workspace classifier with lightweight, deterministic
extraction of the remaining intent facets (audience, industry, complexity,
generation mode, business/technical context, deliverables). Profile defaults
seed each facet; signals in the text refine them. No LLM / no network so the
parser is fast and fully testable; the same `parse_intent()` contract can
later be backed by an LLM extractor.
"""
from __future__ import annotations

import re
from typing import List, Optional

from backend.services.product_intelligence import classifier as _classifier
from backend.services.product_intelligence.registry import get_workspace
from backend.services.product_intelligence.types import (
    WorkspaceKind, ProductCategory, Complexity, GenerationMode,
    InteractionStyle, ProductIntent, WorkspaceClassification,
)

# ── Facet signal tables (data, not switch logic) ─────────────────────────

_INDUSTRY_SIGNALS = {
    "fintech": ["fintech", "bank", "payment", "lending", "trading", "crypto", "finance"],
    "healthcare": ["health", "medical", "clinic", "patient", "fitness", "wellness"],
    "education": ["education", "course", "student", "learn", "school", "tutoring"],
    "retail": ["retail", "store", "shop", "ecommerce", "fashion", "product"],
    "saas": ["saas", "b2b", "dashboard", "subscription", "platform"],
    "real_estate": ["real estate", "property", "rental", "listing"],
    "travel": ["travel", "booking", "hotel", "flight", "trip"],
    "food": ["restaurant", "food", "recipe", "menu", "delivery"],
    "gaming": ["game", "gaming", "player", "arcade"],
    "media": ["blog", "news", "content", "media", "publishing"],
}

_AUDIENCE_PATTERNS = [
    r"\bfor\s+([a-z][a-z\s]{2,40}?)(?:\.|,|;|$| to | who | that )",
    r"\btargeting\s+([a-z][a-z\s]{2,40})",
    r"\baimed at\s+([a-z][a-z\s]{2,40})",
]

_TECH_SIGNALS = {
    "authentication": ["login", "sign up", "auth", "account", "user accounts"],
    "payments": ["payment", "checkout", "stripe", "billing", "subscription"],
    "database": ["database", "store data", "records", "crud", "persistence"],
    "api": ["api", "integration", "webhook", "third-party"],
    "realtime": ["realtime", "real-time", "live", "websocket", "streaming"],
    "ai": ["ai", "ml", "machine learning", "llm", "chatbot", "recommendation"],
    "mobile": ["mobile", "ios", "android", "app store"],
}

_BUSINESS_SIGNALS = {
    "monetization": ["revenue", "monetize", "pricing", "subscription", "paid", "sell"],
    "b2b": ["b2b", "enterprise", "business customers", "teams"],
    "b2c": ["b2c", "consumers", "customers", "users"],
    "marketplace": ["marketplace", "two-sided", "buyers and sellers"],
    "lead_gen": ["leads", "sign-ups", "conversions", "waitlist"],
}

_COMPLEXITY_HINTS = {
    Complexity.ADVANCED: ["enterprise", "scale", "multi-tenant", "microservice",
                          "complex", "advanced", "integrations", "real-time at scale"],
    Complexity.COMPLEX: ["dashboard", "auth", "database", "payments", "multi-page",
                         "backend", "api", "accounts", "admin"],
    Complexity.MODERATE: ["form", "a few pages", "catalog", "interactive", "filters"],
    Complexity.SIMPLE: ["simple", "single page", "landing", "quick", "minimal", "just a"],
}

_MOBILE_RE = re.compile(r"\b(mobile app|ios app|android app|mobile-first)\b", re.IGNORECASE)


def _contains_any(text: str, needles: List[str]) -> List[str]:
    low = text.lower()
    return [n for n in needles if n in low]


def _infer_industry(text: str, default: str) -> str:
    best = None
    best_hits = 0
    for industry, sigs in _INDUSTRY_SIGNALS.items():
        hits = len(_contains_any(text, sigs))
        if hits > best_hits:
            best, best_hits = industry, hits
    return best or default


def _infer_audience(text: str, default: str) -> str:
    for pat in _AUDIENCE_PATTERNS:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            aud = m.group(1).strip().rstrip(".,;")
            if 2 < len(aud) <= 40:
                return aud
    return default


def _infer_complexity(text: str) -> Complexity:
    # Highest-tier hint wins; default MODERATE.
    for level in (Complexity.ADVANCED, Complexity.COMPLEX, Complexity.MODERATE, Complexity.SIMPLE):
        if _contains_any(text, _COMPLEXITY_HINTS[level]):
            return level
    # Length-based fallback.
    words = len(text.split())
    if words <= 8:
        return Complexity.SIMPLE
    if words >= 40:
        return Complexity.COMPLEX
    return Complexity.MODERATE


def _infer_context(text: str, table: dict) -> str:
    hits = [key for key, sigs in table.items() if _contains_any(text, sigs)]
    return ", ".join(hits)


def parse_intent(
    text: str,
    classification: Optional[WorkspaceClassification] = None,
) -> ProductIntent:
    """Turn natural language into a structured ProductIntent."""
    text = (text or "").strip()
    cls = classification or _classifier.classify(text)
    workspace = cls.primary
    profile = get_workspace(workspace)

    # Seed facets from the workspace profile (or generic defaults).
    category = profile.default_category if profile else ProductCategory.OTHER
    gen_mode = profile.default_generation_mode if profile else GenerationMode.DOCUMENT
    interaction = profile.default_interaction if profile else InteractionStyle.STATIC
    industry_default = profile.typical_industry if profile else "general"
    audience_default = profile.typical_audience if profile else "general users"
    goal_default = (profile.typical_goal if profile else "") or "deliver the requested outcome"
    deliverables = list(profile.deliverables) if profile else ["Product blueprint"]

    # Refine from the text.
    industry = _infer_industry(text, industry_default)
    audience = _infer_audience(text, audience_default)
    complexity = _infer_complexity(text)
    technical_context = _infer_context(text, _TECH_SIGNALS)
    business_context = _infer_context(text, _BUSINESS_SIGNALS)

    # Mobile override (category only — never touches a renderer).
    if _MOBILE_RE.search(text) and category in (ProductCategory.WEB_APP, ProductCategory.OTHER):
        category = ProductCategory.MOBILE_APP

    # Product type: best single keyword the profile matched, else category.
    product_type = category.value
    if cls.scores:
        primary_score = next((s for s in cls.scores if s.workspace == workspace), None)
        if primary_score and primary_score.matched_signals:
            # prefer a multiword/explicit signal as the human-readable type
            sig = sorted(primary_score.matched_signals, key=len, reverse=True)[0]
            if " " in sig or len(sig) > 3:
                product_type = sig

    primary_goal = goal_default
    if business_context:
        primary_goal = f"{goal_default} ({business_context})"

    return ProductIntent(
        raw_text=text,
        workspace=workspace,
        product_category=category,
        product_type=product_type,
        industry=industry,
        audience=audience,
        primary_goal=primary_goal,
        complexity=complexity,
        generation_mode=gen_mode,
        interaction_style=interaction,
        business_context=business_context,
        technical_context=technical_context,
        expected_deliverables=deliverables,
        confidence=cls.confidence,
        classification=cls,
        signals={
            "matched": [s.to_dict() for s in cls.scores],
        },
    )


__all__ = ["parse_intent"]
