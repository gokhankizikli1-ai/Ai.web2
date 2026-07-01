# coding: utf-8
# CRITICAL FIX — Product Intent Classifier (requirement #1 + #2).
#
# Before anything is rendered, the user's request is classified into a
# PRODUCT INTENT. This is the single fix for the root cause: the engine
# used to default every unmatched request to a marketing landing page.
#
# The classifier answers three questions:
#   1. intent      — WHAT kind of product is this (12 categories).
#   2. layout      — WHICH interface shape to render (app/editor/ecommerce/
#                    booking/dashboard/landing/website/portfolio).
#   3. capabilities— WHICH surfaces the product actually needs (so we only
#                    add pricing/about/FAQ when the product type calls for
#                    it — an app does NOT get a marketing hero + pricing).
#
# STRICT APP-vs-LANDING RULE (requirement #2): app / dashboard / editor /
# notes / CRM / tool requests render the ACTUAL PRODUCT INTERFACE. Only
# landing / website / marketing / portfolio requests render a landing.
#
# Deterministic, rule-based, no LLM/network — fast, free, testable.

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Dict, List, Tuple

from backend.services.generation.styles import resolve_style_mode

# The twelve product intents (requirement #1).
INTENTS = [
    "application_ui", "dashboard", "landing_page", "website", "ecommerce",
    "booking", "portfolio", "admin_panel", "productivity_tool", "ai_tool",
    "finance_tool", "game_ui",
]

# Intent → interface layout the renderer dispatches on.
_LAYOUT_BY_INTENT = {
    "application_ui":    "app",
    "productivity_tool": "app",
    "dashboard":         "app",
    "admin_panel":       "app",
    "ai_tool":           "app",
    "finance_tool":      "app",
    "game_ui":           "app",
    "ecommerce":         "ecommerce",
    "booking":           "booking",
    "landing_page":      "landing",
    "website":           "landing",
    "portfolio":         "portfolio",
}


@dataclass
class ProductIntent:
    intent: str                                  # one of INTENTS
    layout: str                                  # app|editor|ecommerce|booking|landing|portfolio
    style_mode: str                              # resolved Design Diversity mode
    capabilities: Dict[str, bool] = field(default_factory=dict)
    confidence: float = 0.0


# ── Capability flags (requirement #1) ─────────────────────────────────
# Which surfaces a product type actually needs. Marketing surfaces
# (landing/pricing/about) are OFF for real apps.

_CAP_KEYS = [
    "needs_landing", "needs_pricing", "needs_about", "needs_dashboard",
    "needs_auth", "needs_settings", "needs_product_cards", "needs_editor",
    "needs_checkout", "needs_booking",
]


def _caps(**on: bool) -> Dict[str, bool]:
    base = {k: False for k in _CAP_KEYS}
    base.update(on)
    return base


_CAPABILITIES = {
    "application_ui":    _caps(needs_editor=True, needs_settings=True, needs_auth=True),
    "productivity_tool": _caps(needs_editor=True, needs_settings=True, needs_auth=True),
    "dashboard":         _caps(needs_dashboard=True, needs_settings=True, needs_auth=True),
    "admin_panel":       _caps(needs_dashboard=True, needs_settings=True, needs_auth=True),
    "ai_tool":           _caps(needs_editor=True, needs_settings=True, needs_auth=True),
    "finance_tool":      _caps(needs_dashboard=True, needs_settings=True, needs_auth=True),
    "game_ui":           _caps(needs_dashboard=True, needs_settings=True),
    "ecommerce":         _caps(needs_product_cards=True, needs_checkout=True, needs_auth=True),
    "booking":           _caps(needs_booking=True, needs_about=True, needs_auth=True),
    "landing_page":      _caps(needs_landing=True, needs_pricing=True, needs_about=True),
    "website":           _caps(needs_landing=True, needs_about=True),
    "portfolio":         _caps(needs_landing=True, needs_about=True),
}


# ── Keyword rules (ordered: most specific first) ──────────────────────
# A request matching an earlier rule wins. App/editor/tool signals are
# placed BEFORE generic "landing/website" so "notes app" never falls to
# a marketing page.

_RULES: List[Tuple[re.Pattern, str]] = [
    # Legal / contract / compliance work → a document-workflow DASHBOARD.
    # Placed before the editor rule so "legal document review tool" routes
    # to the legal ops surface instead of falling into the notes editor
    # via its bare "document" keyword.
    (re.compile(r"\b(legal\w*|law\s*firm|lawyer|attorney|paralegal|complian\w*|"
                r"contract\s*(?:review|management|workflow|analysis)|clauses?|"
                r"document\s*(?:review|workflow|approval|intake)|\bnda\b)\b", re.I), "dashboard"),
    # Editors / note-taking / writing / productivity tools → real app UI.
    (re.compile(r"\b(notes?|note[\s-]*taking|notepad|markdown|editor|writing|"
                r"document|docs?\s*app|word\s*processor|wiki|journal\w*|outliner)\b", re.I), "application_ui"),
    (re.compile(r"\b(todo|to-do|task\s*manager|kanban|project\s*management|"
                r"planner|productivity|calendar\s*app|email\s*client|crm|"
                r"spreadsheet|whiteboard|workspace\s*app)\b", re.I), "productivity_tool"),
    # AI tools / chat.
    (re.compile(r"\b(ai\s*(?:chat|tool|assistant|app)|chatbot|chat\s*app|"
                r"llm|copilot|prompt|conversation)\b", re.I), "ai_tool"),
    # Portfolio / personal site / resume (before finance so "portfolio
    # site" is not mistaken for an investment portfolio).
    (re.compile(r"\b(portfolio\s*(?:site|website|page)|personal\s*(?:site|website)|"
                r"design(?:er)?\s*portfolio|resume|cv\b|showcase\s*site|"
                r"photographer\s*site|portfolio\s*for)\b", re.I), "portfolio"),
    # Explicit marketing surfaces → landing. Placed HIGH (before finance/
    # ecommerce/admin/dashboard/fitness) — a request that explicitly says
    # "landing page" / "marketing site" / "SaaS landing" is about a
    # MARKETING PAGE FOR a product, even when it also names the product's
    # own domain ("landing page for a finance analytics startup" must not
    # fall to the generic "analytics" → dashboard rule below it).
    (re.compile(r"\b(landing\s*page|marketing\s*(?:site|page)|"
                r"product\s*launch|waitlist|coming\s*soon|saas\s*landing|"
                r"startup\s*(?:site|landing|website))\b", re.I), "landing_page"),
    # Finance / banking / crypto.
    (re.compile(r"\b(bank|banking|fintech|wallet|crypto|trading|stock|equit|"
                r"invest|expense|budget|accounting|payroll|finance\s*(?:app|tool))\b", re.I), "finance_tool"),
    # Ecommerce / shop / store.
    (re.compile(r"\b(e[\s-]*commerce|online\s*(?:store|shop)|web\s*shop|store|shop|"
                r"storefront|marketplace|cart|checkout|product\s*catalog|"
                r"fashion|boutique|clothing|sell\s+(?:online|products))\b", re.I), "ecommerce"),
    # Booking / reservations / hotel / travel / appointments.
    (re.compile(r"\b(book(?:ing)?|reservation|hotel|flight|travel|appointment|"
                r"rental|stays?|airbnb|restaurant\s*(?:booking|reservation)|"
                r"schedule\s*(?:appointment|visit))\b", re.I), "booking"),
    # Admin / internal tooling.
    (re.compile(r"\b(admin\s*(?:panel|dashboard)?|back[\s-]*office|"
                r"internal\s*tool|cms|control\s*panel|management\s*console)\b", re.I), "admin_panel"),
    # Analytics / monitoring dashboards.
    (re.compile(r"\b(dashboard|analytics|metrics|monitoring|reporting|"
                r"data\s*viz|kpi|telemetry|stats?\s*panel)\b", re.I), "dashboard"),
    # Games.
    (re.compile(r"\b(game|gaming|esports?|arcade|leaderboard|player\s*ui|"
                r"game\s*ui|game\s*hud)\b", re.I), "game_ui"),
    # Generic fitness / health apps → application_ui (real product), not marketing.
    (re.compile(r"\b(fitness|workout|gym|exercise|calorie|nutrition|"
                r"meditation|sleep\s*tracker|habit)\b", re.I), "application_ui"),
    # Generic content website.
    (re.compile(r"\b(website|web\s*site|web\s*page|homepage|company\s*site|"
                r"agency\s*site|blog)\b", re.I), "website"),
    # Generic "app"/"tool"/"platform"/"software" → real application UI
    # (this is the root-cause fix: was defaulting to a landing page).
    (re.compile(r"\b(app|application|tool|platform|software|system|"
                r"tracker|manager|client|console)\b", re.I), "application_ui"),
]


def classify(user_request: str) -> ProductIntent:
    """Classify a free-text request into a ProductIntent. Never raises.

    The default for an ambiguous request is `application_ui` (a real
    product interface), NOT a landing page — only explicit landing /
    website / portfolio signals produce a marketing layout."""
    text = (user_request or "").strip()
    intent = "application_ui"
    confidence = 0.35
    for pattern, name in _RULES:
        if pattern.search(text):
            intent, confidence = name, 0.9
            break

    layout = _LAYOUT_BY_INTENT.get(intent, "app")
    caps = dict(_CAPABILITIES.get(intent, _CAPABILITIES["application_ui"]))

    # Editor sub-layout: note/doc/writing apps get the 3-pane editor shell.
    if intent in ("application_ui", "productivity_tool") and re.search(
        r"\b(notes?|notepad|markdown|editor|writing|document|docs?|journal\w*|wiki|outliner)\b",
        text, re.I,
    ):
        layout = "editor"
        caps["needs_editor"] = True

    style_mode = resolve_style_mode(text, intent)
    return ProductIntent(intent=intent, layout=layout, style_mode=style_mode,
                         capabilities=caps, confidence=confidence)


__all__ = ["INTENTS", "ProductIntent", "classify"]
