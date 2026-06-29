# coding: utf-8
"""CRITICAL FIX — Product Intent Classifier tests (requirement #1, #2, #8).

Pure + deterministic. Verifies the request → intent → layout → capability
mapping, the strict app-vs-landing rule, and Design-Diversity style
resolution.
"""
from __future__ import annotations

import pytest

from backend.services.generation.intent import INTENTS, classify
from backend.services.generation.styles import STYLE_MODES, resolve_style_mode


# ── Each of the 12 intents is reachable ───────────────────────────────

@pytest.mark.parametrize("prompt,intent", [
    ("Build a note-taking app",            "application_ui"),
    ("Build a meditation app",             "application_ui"),
    ("Build a kanban task manager",        "productivity_tool"),
    ("Build an analytics dashboard",       "dashboard"),
    ("Build a SaaS landing page",          "landing_page"),
    ("Build a company website",            "website"),
    ("Build an online store",              "ecommerce"),
    ("Build a hotel booking app",          "booking"),
    ("Build a portfolio site for a designer", "portfolio"),
    ("Build an admin panel",               "admin_panel"),
    ("Build an AI chatbot",                "ai_tool"),
    ("Build a banking app",                "finance_tool"),
    ("Build a game leaderboard UI",        "game_ui"),
])
def test_intent_classification(prompt, intent):
    pi = classify(prompt)
    assert pi.intent == intent, f"{prompt!r} -> {pi.intent}"
    assert pi.intent in INTENTS


# ── Strict app-vs-landing rule (requirement #2) ───────────────────────

@pytest.mark.parametrize("prompt", [
    "Build an Apple Notes style app", "Build a notes app", "Build a CRM tool",
    "Build a fitness tracking application", "Build a banking dashboard",
    "Build a habit tracker", "Build an AI chat app",
])
def test_app_requests_never_render_as_landing(prompt):
    pi = classify(prompt)
    assert pi.layout != "landing", f"{prompt} wrongly routed to a landing page"
    assert pi.intent not in ("landing_page", "website", "portfolio")


@pytest.mark.parametrize("prompt", [
    "Build a SaaS landing page", "Build a marketing site", "Build a company website",
])
def test_marketing_requests_render_as_landing(prompt):
    pi = classify(prompt)
    assert pi.layout in ("landing", "portfolio")


# ── Notes / editor sub-layout (the headline regression) ───────────────

@pytest.mark.parametrize("prompt", [
    "Build an Apple Notes style app", "Build a notes app",
    "Build a markdown editor", "Build a journaling app",
])
def test_note_apps_use_editor_layout(prompt):
    pi = classify(prompt)
    assert pi.intent == "application_ui"
    assert pi.layout == "editor"
    assert pi.capabilities["needs_editor"] is True


# ── Capability flags only enable surfaces the product needs ───────────

def test_capabilities_app_has_no_marketing_surfaces():
    caps = classify("Build a notes app").capabilities
    assert caps["needs_editor"] is True
    assert caps["needs_pricing"] is False
    assert caps["needs_landing"] is False


def test_capabilities_landing_has_marketing_surfaces():
    caps = classify("Build a SaaS landing page").capabilities
    assert caps["needs_landing"] is True
    assert caps["needs_pricing"] is True
    assert caps["needs_editor"] is False


# ── Design Diversity: explicit style keyword wins ─────────────────────

def test_apple_keyword_resolves_apple_minimal():
    assert resolve_style_mode("Build an Apple Notes style app", "application_ui") == "apple_minimal"
    assert STYLE_MODES["apple_minimal"]["mode"] == "light"


@pytest.mark.parametrize("prompt,mode", [
    ("Make it look like Linear", "linear_dark"),
    ("Stripe style payments page", "stripe_gradient"),
    ("A Notion clone", "notion_clean"),
    ("Raycast style command bar", "raycast_command"),
    ("A neon cyberpunk gaming UI", "gaming_neon"),
])
def test_explicit_style_keywords(prompt, mode):
    assert resolve_style_mode(prompt, "application_ui") == mode


def test_intent_default_style_is_dark_for_generic_app():
    # No explicit style keyword → generic app stays dark (so it doesn't
    # silently flip every app to a light theme).
    assert STYLE_MODES[resolve_style_mode("Build a meditation app", "application_ui")]["mode"] == "dark"
