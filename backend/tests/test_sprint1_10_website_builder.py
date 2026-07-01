# coding: utf-8
"""Sprint 1.10 — Website Builder generation-pipeline hardening.

Pure quality/reliability work on the shared landing renderer + generic
"Website Builder" fallback spec + the shared quality gate. No new
architecture: every assertion here locks in things the renderer/spec
already do, or fixes a real bug (duplicate DOM ids from a section-id
collision and from the shared `spark()` SVG helper, and a hardcoded
secondary-CTA scroll target) in existing code. Deterministic, no LLM /
network.
"""
from __future__ import annotations

import re

from backend.services.generation import quality
from backend.services.generation.html_renderer import render_premium_page
from backend.services.generation.prompt_expander import expand
from backend.services.generation.renderers.base import spark

LANDING_PROMPTS = [
    "Build a SaaS landing page for a project management tool",
    "Build a website for a local bakery",
    "Build a marketing website for a design agency",
    "Build a restaurant website",
]


def _page(p: str) -> str:
    return render_premium_page(expand(p))


# ── No duplicate DOM ids (bug fix: testimonials' untitled fallback used
#    to collide with the always-rendered logos section's id="customers") ──

def test_landing_pages_never_render_duplicate_ids():
    for p in LANDING_PROMPTS:
        html = _page(p)
        ids = re.findall(r'\bid="([^"]+)"', html)
        dupes = {i for i in ids if ids.count(i) > 1}
        assert not dupes, f"{p}: duplicate DOM ids {dupes}"


# ── The hero's own secondary CTA and the closing CTA band's secondary
#    button must point at the ACTUAL features-section id (bug fix: both
#    used to hardcode "features" even when the section rendered under a
#    different slug, e.g. a titled features section) ─────────────────────

def test_cta_secondary_button_targets_the_real_features_section():
    html = _page("Build a SaaS landing page for a project management tool")
    ids = set(re.findall(r'\bid="([^"]+)"', html))
    # secondary (ghost) CTA buttons live in the hero and the closing CTA
    # band; both must point at the real features-section id, not a
    # hardcoded "features" that may not match a titled section's slug.
    ghost_targets = re.findall(r'class="ds-btn ds-btn-ghost[^"]*"\s+data-scroll="([^"]+)"', html)
    assert len(ghost_targets) >= 2, "expected a hero + CTA-band secondary button"
    for t in ghost_targets:
        assert t in ids, f"dead ghost-CTA scroll target #{t}"
        assert t != "features", "should resolve to the real section slug, not the literal fallback"


# ── shared spark() SVG helper: each call must get its own gradient id
#    (bug fix — every renderer that calls spark() more than once on one
#    page, e.g. landing's hero + panel, or dashboard's trend + momentum
#    cards, used to render two <linearGradient id="g"> elements) ─────────

def test_spark_helper_never_reuses_a_gradient_id():
    first, second = spark(), spark()
    id1 = re.search(r'linearGradient id="([^"]+)"', first).group(1)
    id2 = re.search(r'linearGradient id="([^"]+)"', second).group(1)
    assert id1 != id2
    assert f'url(#{id1})' in first
    assert f'url(#{id2})' in second


# ── Split hero + section-rhythm bands present on every landing page ──────

def test_landing_hero_is_split_with_visual_rhythm():
    for p in LANDING_PROMPTS:
        html = _page(p)
        assert 'class="ld-hero"' in html
        assert "ld-hero-visual" in html and "ld-hero-copy" in html
        assert "ld-tone-alt" in html, f"{p}: no alternating section band"


# ── The generic "Website Builder" fallback (any unmatched vertical) now
#    matches the depth of the hand-built verticals instead of being the
#    thinnest spec in the system ──────────────────────────────────────────

def test_generic_website_fallback_has_real_depth():
    spec = expand("Build a website for a local bakery")
    kinds = [s.kind for s in spec.sections]
    assert "testimonials" in kinds and "faq" in kinds
    assert len(spec.sections) >= 5


# ── Quality gate: structural depth matters, not just byte count ──────────

def test_quality_score_rewards_multi_section_depth_over_bulk():
    dense_single_section = "<html><body><section>" + ("x" * 3000) + "</section></body></html>"
    multi_section = "<html><body>" + "".join(f"<section>part {i} {'y' * 300}</section>" for i in range(4)) + "</body></html>"
    dense_score, _ = quality.score(dense_single_section)
    multi_score, _ = quality.score(multi_section)
    assert multi_score > dense_score


# ── Every deterministic renderer category stays comfortably premium
#    after the quality-gate refinement (no cross-category regression) ────

def test_all_renderer_categories_still_score_premium():
    prompts = [
        "Build a fitness tracking application", "Build a banking dashboard",
        "Build a habit tracker", "Build a music player", "Build an Apple Notes style app",
        "Build an online store for sneakers", "Build a hotel booking site",
        "Build a portfolio site for a designer", "Build a SaaS landing page",
        "Build an agency website", "Build a CRM dashboard",
    ]
    for p in prompts:
        html = _page(p)
        assert quality.is_premium(html), p
        assert quality.score(html)[0] >= 85, (p, quality.score(html))
