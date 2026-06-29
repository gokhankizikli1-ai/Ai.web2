# coding: utf-8
"""CRITICAL REBUILD — strict product-specific renderer tests (req #9).

Each product family must render its OWN real interface architecture (not a
shared navbar/cards/footer template), with working interactions, premium
quality, no placeholder junk, and structurally different output per type.
Pure + deterministic (no LLM / network).
"""
from __future__ import annotations

import re

import pytest

from backend.services.generation import quality
from backend.services.generation.html_renderer import render_premium_page
from backend.services.generation.prompt_expander import expand


def _page(p: str) -> str:
    return render_premium_page(expand(p))


# ── Apple Notes / editor: real macOS desktop app ─────────────────────

def test_notes_editor_is_a_real_desktop_app():
    spec = expand("Build an Apple Notes style app")
    assert spec.intent in ("application_ui", "productivity_tool")
    assert spec.layout == "editor"
    html = _page("Build an Apple Notes style app")
    # macOS app chrome + 3-pane shell.
    assert 'class="ed-window"' in html and 'class="ds-traffic"' in html
    assert 'class="ed-sidebar"' in html                 # left folders/tags sidebar
    assert 'id="notes-list"' in html                    # middle notes list
    assert html.count("class=\"ed-note") >= 5           # several real notes
    assert 'class="ed-main"' in html and 'id="note-body"' in html  # right editor
    assert 'class="ed-toolbar"' in html and html.count("data-format") >= 6  # formatting toolbar
    assert "data-search" in html                        # search input
    assert "data-new-note" in html                      # new note button
    assert "data-folder=" in html                       # folder switching
    assert 'id="note-meta"' in html                     # note metadata
    # NOT a website: no hero / pricing / testimonials / footer / © 2023.
    assert 'class="ds-hero"' not in html and 'id="pricing"' not in html
    assert "★★★★★" not in html and "<footer" not in html
    assert "© 2023" not in html


# ── Dashboard: sidebar + topbar + charts + feed + panels ─────────────

@pytest.mark.parametrize("prompt", ["Build a banking dashboard",
                                    "Build a fitness tracking application",
                                    "Build a CRM tool"])
def test_dashboard_is_a_real_dashboard(prompt):
    html = _page(prompt)
    assert 'class="db-shell"' in html                   # app shell
    assert 'class="db-sidebar"' in html                 # sidebar navigation
    assert 'class="ds-nav db-topbar"' in html           # top bar
    assert 'class="ds-bars"' in html                    # chart mockup
    assert 'class="ds-feed"' in html                    # activity feed
    assert 'data-panel="page-0"' in html and 'data-panel="page-1"' in html  # panels
    assert "data-tab=" in html                          # tab switching
    assert 'class="ds-stat-value"' in html              # metric cards
    assert 'id="reveal-detail"' in html                 # detail panel
    assert 'class="ds-hero"' not in html                # no landing hero


# ── Ecommerce: grid + filters + cart + detail + checkout ─────────────

def test_ecommerce_is_a_real_store():
    html = _page("Build an online clothing store")
    assert "data-product=" in html and html.count("data-product=") >= 4   # product grid
    assert "data-filter=" in html                       # category filters
    assert 'id="cart"' in html and 'id="cart-count"' in html  # cart panel + counter
    assert 'id="cart-items"' in html                    # cart line items
    assert 'id="product-detail"' in html                # product detail drawer
    assert "data-add-cart" in html                      # add-to-cart behavior
    assert 'id="checkout-status"' in html               # checkout preview/state
    assert 'class="ds-drawer"' in html                  # real slide-in drawers


# ── Booking: search + rooms + dates/guests + summary + confirm ───────

def test_booking_is_a_real_booking_flow():
    html = _page("Build a hotel booking website")
    assert 'class="bk-searchbar"' in html               # search bar
    assert "Check-in" in html and "Check-out" in html   # date selectors
    assert 'id="guest-count"' in html and "data-step=" in html  # guests stepper
    assert "data-room=" in html and html.count("data-room=") >= 2  # room cards
    assert 'class="bk-feats"' in html                   # room detail (features)
    assert 'id="booking-summary"' in html               # live summary
    assert 'id="summary-room"' in html and 'id="summary-total"' in html
    assert "data-book" in html and 'id="book-status"' in html  # confirmation state


# ── Landing: hero + mockup + pricing + testimonials + FAQ ────────────

def test_landing_is_premium():
    html = _page("Build a premium SaaS landing page")
    assert 'class="ds-hero"' in html                    # strong hero
    assert 'class="ds-mock' in html and "ds-mock-bar" in html  # product mockup
    assert 'class="ds-logos"' in html                   # social proof
    assert 'class="ds-bento"' in html                   # bento feature grid
    assert 'id="pricing"' in html and ">Choose plan<" in html   # pricing
    assert "★★★★★" in html                               # testimonials
    assert "<details" in html                           # FAQ accordion
    assert 'id="get-started"' in html                   # CTA
    assert "<footer" in html                            # footer


# ── Visual quality + interactivity + no junk across the board ────────

ALL_PROMPTS = [
    "Build an Apple Notes style app", "Build a banking dashboard",
    "Build an online clothing store", "Build a hotel booking website",
    "Build a premium SaaS landing page", "Build a portfolio site for a designer",
    "Build a CRM tool", "Build a recipe app", "Build a meditation app",
]


@pytest.mark.parametrize("prompt", ALL_PROMPTS)
def test_quality_and_no_placeholder_junk(prompt):
    html = _page(prompt)
    assert quality.is_premium(html), prompt
    low = html.lower()
    for junk in ("my app", "feature 1", "lorem ipsum", "© 2023", "your app", "section 1"):
        assert junk not in low, f"{prompt}: {junk}"


@pytest.mark.parametrize("prompt", ALL_PROMPTS)
def test_interactive_js_present_and_sandbox_safe(prompt):
    html = _page(prompt)
    assert "<script>" in html and "<script " not in html       # one inline script
    assert "default-src 'none'" in html                        # network-blocking CSP
    assert not re.search(r'(src|href)\s*=\s*["\']https?:', html), prompt
    for bad in ("fetch(", "XMLHttpRequest", "eval(", "new Function", "import(",
                "WebSocket", "sendBeacon"):
        assert bad not in html, (prompt, bad)


# ── Structurally different output per product type ───────────────────

def test_outputs_are_structurally_distinct():
    primary = {
        "Build an Apple Notes style app":         'class="ed-window"',
        "Build a banking dashboard":              'class="db-shell"',
        "Build an online clothing store":         'class="sh-hero',
        "Build a hotel booking website":          'class="bk-searchbar"',
        "Build a premium SaaS landing page":      'class="ds-hero"',
        "Build a portfolio site for a designer":  'class="pf-hero',
    }
    pages = {p: _page(p) for p in primary}
    # Each product shows its OWN shell …
    for p, marker in primary.items():
        assert marker in pages[p], f"{p}: missing {marker}"
    # … and NOT the other products' distinctive shells.
    for p, marker in primary.items():
        for other, om in primary.items():
            if other != p and om != 'class="ds-hero"':   # ds-hero is landing-only; others don't use it
                assert om not in pages[p], f"{p} unexpectedly contains {om}"
