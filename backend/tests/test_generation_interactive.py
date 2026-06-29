# coding: utf-8
"""EPIC 2 / M2 — interactive prototype behavior tests.

Verify generated HTML is interactive (data-attribute-wired inline JS) AND
sandbox-safe (no external resources, no network, no eval). Pure +
deterministic.
"""
from __future__ import annotations

import re

import pytest

from backend.services.generation import finalize_artifact
from backend.services.generation.html_renderer import render_premium_page
from backend.services.generation.prompt_expander import expand


def _page(prompt: str) -> str:
    return render_premium_page(expand(prompt))


# ── Sandbox safety (req #9) ───────────────────────────────────────────

@pytest.mark.parametrize("prompt", [
    "Build a fitness tracking application",
    "Build an AI chat application",
    "Build a banking dashboard",
    "Build a premium SaaS landing page",
    "Build a restaurant website",
    "Build a crypto portfolio dashboard",
])
def test_pages_are_sandbox_safe(prompt):
    html = _page(prompt)
    # No external resource of any kind (no fonts CDN, no script/img src URLs).
    assert not re.search(r'(src|href)\s*=\s*["\']https?:', html), "external resource"
    # No network / unsafe primitives in the inline script.
    for bad in ("fetch(", "XMLHttpRequest", "eval(", "new Function", "import(",
                "navigator.sendBeacon", "WebSocket"):
        assert bad not in html, bad
    # Strict CSP that blocks network.
    assert "Content-Security-Policy" in html and "default-src 'none'" in html
    # Exactly one inline script, no external script tag.
    assert "<script>" in html and "<script " not in html


# ── Interactivity present (req #5) ────────────────────────────────────

@pytest.mark.parametrize("prompt,min_interactions", [
    ("Build a fitness tracking application", 3),
    ("Build an AI chat application", 2),
    ("Build a banking dashboard", 2),
    ("Build a premium SaaS landing page", 3),
    ("Build a restaurant website", 2),
    ("Build a crypto portfolio dashboard", 2),
])
def test_pages_have_meaningful_interactions(prompt, min_interactions):
    html = _page(prompt)
    markers = ["data-nav=", "data-reveal=", "data-scroll=", "data-select-group", "<details"]
    assert sum(m in html for m in markers) >= min_interactions


LANDING = ["Build a premium SaaS landing page", "Build a restaurant website"]
APPS = ["Build a fitness tracking application", "Build a banking dashboard",
        "Build a crypto portfolio dashboard", "Build an AI chat application"]


# ── Fitness app behaviors (req #6) ────────────────────────────────────

def test_fitness_app_interactions():
    html = _page("Build a fitness tracking application")
    # Rich pseudo-pages that switch (Dashboard / Workouts / Nutrition / …).
    assert 'data-panel="page-0"' in html and 'data-panel="page-1"' in html
    assert 'data-nav="page-0"' in html
    # Start training reveals today's workout (hidden until revealed).
    assert 'data-reveal="reveal-detail"' in html
    assert 'id="reveal-detail"' in html and "ds-hidden" in html
    # Workout cards selectable.
    assert "data-select-group" in html and "data-select" in html


# ── Dashboard behaviors (req #8) ──────────────────────────────────────

def test_dashboard_panel_switching():
    html = _page("Build a banking dashboard")
    # Full pseudo-page panels switch via nav; first active, others hidden.
    assert 'data-panel="page-0"' in html and 'data-panel="page-1"' in html
    assert 'data-nav="page-0"' in html and 'class="is-active"' in html
    assert "ds-hidden" in html                         # non-active pages hidden
    # Rich dashboard content (metric bento + chart bars + activity feed).
    assert 'class="ds-bento"' in html
    assert 'class="ds-stat-value"' in html
    assert 'class="ds-bars"' in html
    assert "ds-feed-item" in html


# ── SaaS landing behaviors (req #4, #7) ───────────────────────────────

def test_saas_landing_sections():
    html = _page("Build a premium SaaS landing page")
    assert 'class="ds-hero"' in html                   # premium hero element
    assert 'class="ds-bento"' in html                  # feature bento
    assert "ds-mock-bar" in html                       # product preview mockup
    assert 'class="ds-logos"' in html                  # social proof
    assert "ds-plan-featured" in html and "Choose plan" in html  # pricing
    assert "★★★★★" in html                              # testimonials
    assert "<details" in html                          # FAQ accordion
    assert "data-scroll=" in html and "data-nav=" in html


# ── Premium-preserved regression guard ────────────────────────────────

@pytest.mark.parametrize("prompt", LANDING + APPS)
def test_premium_visual_preserved(prompt):
    """Visual quality must stay premium (the PR #192 regression). Every
    page uses the real premium components (not flat blocks), scores high
    on the quality reviewer, and stays interactive."""
    from backend.services.generation import quality
    html = _page(prompt)
    # Real premium component USAGE (class="..."), not just CSS defs.
    for marker in ['class="ds-nav"', 'class="ds-bento"', 'class="ds-card', 'class="ds-bars"',
                   'class="ds-footer"', "var(--", "<h1"]:
        assert marker in html, f"{prompt}: missing {marker}"
    assert quality.is_premium(html)
    assert quality.score(html)[0] >= 95, f"{prompt}: quality {quality.score(html)[0]}"
    assert "<script>" in html and "data-nav=" in html


def test_no_placeholder_junk():
    for prompt in LANDING + APPS:
        html = _page(prompt).lower()
        for junk in ["feature 1", "my app", "lorem ipsum", "© 2023",
                     "section 1", "card 1", "your app"]:
            assert junk not in html, f"{prompt}: contains {junk!r}"


# ── Metadata reflects interactivity (req #10) ─────────────────────────

def test_finalize_marks_artifact_interactive():
    art = finalize_artifact(deliverable_kind="app_prototype_html", node_title="Prototype",
                            raw_reply="weak <div>My App</div>",
                            user_request="Build a fitness app")
    md = art["metadata"]
    assert md["interactive"] is True
    assert md["interactions"] >= 2
