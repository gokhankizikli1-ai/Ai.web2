# coding: utf-8
"""CRITICAL FIX — layout, design-diversity and real-interaction tests
(requirements #2–#9).

Pure + deterministic (no LLM / network). Verifies that different product
intents render genuinely different interfaces, that app requests render the
ACTUAL product UI (not a marketing landing), and that the product-specific
interactions are wired with sandbox-safe inline JS.
"""
from __future__ import annotations

import re

import pytest

from backend.services.generation import finalize_artifact, quality
from backend.services.generation.html_renderer import render_premium_page
from backend.services.generation.prompt_expander import expand


def _page(prompt: str) -> str:
    return render_premium_page(expand(prompt))


# ── Apple Notes: the headline regression (req #2, #3, #6) ─────────────

def test_apple_notes_is_an_app_not_a_landing():
    spec = expand("Build an Apple Notes style app")
    assert spec.intent == "application_ui"
    assert spec.layout == "editor"
    assert spec.style.get("mode_name") == "apple_minimal"
    assert spec.dark_mode is False                      # apple_minimal → light

    html = _page("Build an Apple Notes style app")
    # The actual desktop product interface: macOS window + 3 panes.
    assert 'class="ed-window"' in html                   # macOS app window
    assert 'class="ds-traffic"' in html                  # traffic-light chrome
    assert 'class="ed-toolbar"' in html and "data-format" in html  # formatting toolbar
    assert "data-folder=" in html                        # folder sidebar
    assert 'id="notes-list"' in html and "data-note" in html  # notes list
    assert 'id="note-title"' in html and 'id="note-body"' in html  # editor
    assert "data-search" in html                         # search
    assert "data-new-note" in html                       # New Note
    # NOT a marketing page — no hero / pricing / testimonials / FAQ / footer.
    assert 'id="pricing"' not in html and ">Choose plan<" not in html
    assert "★★★★★" not in html
    assert "<details" not in html                        # no FAQ accordion
    assert "<footer" not in html and "© 2023" not in html  # no marketing footer


def test_note_editor_interactions_are_wired():
    html = _page("Build a notes app")
    # Clicking a note swaps the editor; folders filter; search filters.
    assert html.count("data-note") >= 4                  # several notes
    assert 'data-in-folder=' in html and "data-searchable=" in html
    assert "<script>" in html


# ── App-vs-landing strict rule across product types (req #2) ──────────

APP_PROMPTS = [
    "Build a fitness tracking application", "Build a banking dashboard",
    "Build a crypto portfolio dashboard", "Build an AI chat application",
    "Build a CRM tool", "Build a meditation app",
]


@pytest.mark.parametrize("prompt", APP_PROMPTS)
def test_app_prompts_render_product_ui_not_marketing(prompt):
    spec = expand(prompt)
    # Sprint 1.9 added a "mobile" layout (phone shell + bottom tab bar) for
    # genuinely mobile-native products (e.g. meditation) — still a real
    # product interface, not a marketing page, so it belongs in this set.
    assert spec.layout in ("app", "editor", "mobile")
    html = _page(prompt)
    # No marketing pricing table in a real app.
    assert 'id="pricing"' not in html and ">Choose plan<" not in html


def test_launch_and_waitlist_dashboards_stay_app_shells():
    for prompt in ("Build a product launch dashboard", "Build a waitlist analytics app"):
        spec = expand(prompt)
        assert spec.intent == "dashboard"
        assert spec.layout == "app"

    explicit_landing = expand("Build a landing page for a finance analytics startup")
    assert explicit_landing.layout == "landing"


def test_balanced_density_prompt_block_is_not_data_dense():
    spec = expand("Build an analytics dashboard\n\nDESIGN_BRIEF:\n- Density: Balanced")
    block = spec.to_prompt_block()
    assert "DENSITY: balanced" in block
    assert "data-dense" not in block
    assert "balance whitespace with useful detail" in block


# ── Page architecture per product (req #3, #8) ────────────────────────

def test_fitness_screen_map():
    spec = expand("Build a fitness tracking application")
    nav = " ".join(spec.navigation).lower()
    for screen in ("dashboard", "workouts", "nutrition", "progress", "profile"):
        assert screen in nav


def test_banking_screen_map():
    spec = expand("Build a banking dashboard")
    nav = " ".join(spec.navigation).lower()
    for screen in ("accounts", "transactions", "investments"):
        assert screen in nav


# ── Ecommerce interactions (req #6) ───────────────────────────────────

def test_ecommerce_layout_and_interactions():
    spec = expand("Build an online clothing store")
    assert spec.layout == "ecommerce"
    nav = " ".join(spec.navigation).lower()
    assert "shop" in nav and "cart" in nav
    html = _page("Build an online clothing store")
    assert "data-product=" in html                       # product cards
    assert "data-add-cart" in html and 'id="cart-count"' in html  # cart counter
    assert "data-filter=" in html                        # category filter
    assert 'id="product-detail"' in html                 # product detail panel


# ── Booking interactions (req #6) ─────────────────────────────────────

def test_booking_layout_and_interactions():
    spec = expand("Build a hotel booking website")
    assert spec.layout == "booking"
    html = _page("Build a hotel booking website")
    assert "data-room=" in html                          # selectable rooms
    assert 'id="booking-summary"' in html                # live summary
    assert 'id="summary-room"' in html and 'id="summary-price"' in html
    assert "data-book" in html and 'id="book-status"' in html  # confirm


# ── Design diversity: different prompts → different look (req #4) ──────

DIVERSE = [
    "Build an Apple Notes style app",       # apple_minimal / editor
    "Build a SaaS landing page",            # stripe_gradient / landing
    "Build an online clothing store",       # ecommerce_editorial / ecommerce
    "Build a hotel booking website",        # healthcare_clean / booking
    "Build a banking dashboard",            # fintech_glass / app
    "Build a portfolio site for a designer",# luxury_editorial / portfolio
]


def test_layouts_are_diverse():
    layouts = {expand(p).layout for p in DIVERSE}
    assert len(layouts) >= 4, layouts


def test_styles_are_diverse():
    modes = {expand(p).style.get("mode_name") for p in DIVERSE}
    assert len(modes) >= 4, modes


def test_pages_are_visually_distinct():
    """Two products under different style modes produce materially
    different stylesheets (font / radius / background / mode)."""
    notes = _page("Build an Apple Notes style app")     # light, system font
    saas = _page("Build a SaaS landing page")           # dark, gradient
    assert 'class="light"' in notes and 'class="light"' not in saas
    # Different document titles → different products.
    t1 = re.search(r"<title>([^<]+)</title>", notes).group(1)
    t2 = re.search(r"<title>([^<]+)</title>", saas).group(1)
    assert t1 != t2


# ── Real interactions + sandbox safety on every new layout (req #5,#9)─

@pytest.mark.parametrize("prompt", DIVERSE + [
    "Build a CRM tool", "Build a gaming leaderboard",
])
def test_pages_interactive_and_sandbox_safe(prompt):
    html = _page(prompt)
    # At least one wired interaction is present.
    markers = ["data-nav=", "data-reveal=", "data-scroll=", "data-select-group",
               "<details", "data-tab=", "data-folder=", "data-note", "data-search",
               "data-add-cart", "data-filter=", "data-room=", "data-book"]
    assert sum(m in html for m in markers) >= 2, prompt
    # Exactly one inline script, no external script tag.
    assert "<script>" in html and "<script " not in html
    # No external resources / network primitives.
    assert not re.search(r'(src|href)\s*=\s*["\']https?:', html), prompt
    for bad in ("fetch(", "XMLHttpRequest", "eval(", "new Function", "import(",
                "WebSocket", "sendBeacon"):
        assert bad not in html, (prompt, bad)
    assert "default-src 'none'" in html


# ── No placeholder junk on a broad prompt set (req #7) ────────────────

@pytest.mark.parametrize("prompt", DIVERSE + APP_PROMPTS + [
    "Build a todo task manager", "Build a recipe app", "Build a music player",
])
def test_no_placeholder_junk(prompt):
    html = _page(prompt)
    assert not quality.has_placeholders(html), prompt
    assert quality.is_premium(html), prompt
    low = html.lower()
    for junk in ("feature 1", "my app", "lorem ipsum", "© 2023", "your app"):
        assert junk not in low, f"{prompt}: {junk}"


# ── Metadata carries the new intent/layout/style (req #10) ────────────

def test_finalize_metadata_reports_intent_layout_style():
    art = finalize_artifact(deliverable_kind="app_prototype_html", node_title="P",
                            raw_reply="weak <div>My App</div>",
                            user_request="Build an Apple Notes style app")
    md = art["metadata"]
    assert md["intent"] == "application_ui"
    assert md["layout"] == "editor"
    assert md["style"] == "apple_minimal"
    assert md["interactive"] is True
    assert md["interactions"] >= 2
