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


# ── Fitness app behaviors (req #6) ────────────────────────────────────

def test_fitness_app_interactions():
    html = _page("Build a fitness tracking application")
    # Start training reveals today's workout (hidden until revealed) — laid
    # on top of the FULL premium page (hero etc. still present).
    assert "ds-hero" in html                          # premium layout preserved
    assert 'data-reveal="reveal-detail"' in html
    assert 'id="reveal-detail"' in html and "ds-hidden" in html
    # Workout cards are selectable.
    assert "data-select-group" in html and "data-select" in html
    # Nav items are wired (scroll + active state).
    assert "data-nav=" in html


# ── Dashboard behaviors (req #8) ──────────────────────────────────────

def test_dashboard_nav_and_reveal():
    html = _page("Build a banking dashboard")
    # Premium dashboard page (hero + metric cards) — NOT a simplified
    # tab/panel template.
    assert "ds-hero" in html and "ds-stat-value" in html
    assert 'data-panel="panel-1"' not in html         # no simplified panel template
    # Interactive: nav active/scroll + CTA reveals a detail block.
    assert "data-nav=" in html
    assert 'id="reveal-detail"' in html


# ── SaaS landing behaviors (req #7) ───────────────────────────────────

def test_saas_landing_interactions():
    html = _page("Build a premium SaaS landing page")
    # Pricing CTA scrolls (hero primary → pricing/get-started).
    assert "data-scroll=" in html
    # FAQ expand/collapse via native <details>.
    assert "<details" in html
    # Nav items wired for scroll/active.
    assert "data-nav=" in html


# ── Premium-preserved regression guard (the PR #192 regression) ───────

@pytest.mark.parametrize("prompt", [
    "Build a fitness tracking application",   # dashboard (regressed in #192)
    "Build a banking dashboard",
    "Build a crypto portfolio dashboard",
    "Build a premium SaaS landing page",
    "Build a restaurant website",
])
def test_premium_visual_preserved_with_interactivity(prompt):
    """Adding interactivity must NOT downgrade the premium renderer.
    Every page keeps the PR #191 premium structure/classes AND scores
    high on the quality reviewer — while remaining interactive."""
    from backend.services.generation import quality
    html = _page(prompt)
    # Premium design system + structure present.
    for marker in ["ds-nav", "ds-hero", "ds-card", "ds-grid",
                   "ds-btn-primary", "var(--", "<h1", "ds-footer"]:
        assert marker in html, f"{prompt}: missing premium marker {marker}"
    # Internal quality reviewer still rates it premium (high).
    assert quality.is_premium(html)
    score, _ = quality.score(html)
    assert score >= 90, f"{prompt}: quality regressed to {score}"
    # Still interactive.
    assert "<script>" in html and "data-nav=" in html
    # The simplified #192 panel template must NOT be used.
    assert 'data-panel="panel-1"' not in html


# ── Metadata reflects interactivity (req #10) ─────────────────────────

def test_finalize_marks_artifact_interactive():
    art = finalize_artifact(deliverable_kind="app_prototype_html", node_title="Prototype",
                            raw_reply="weak <div>My App</div>",
                            user_request="Build a fitness app")
    md = art["metadata"]
    assert md["interactive"] is True
    assert md["interactions"] >= 2
