# coding: utf-8
"""Sprint 1.11 — Website Builder typography/hierarchy/consistency pass.

Three focused, reusable fixes to the shared landing renderer: every
section head now pairs an eyebrow label with its heading (matching the
hero/CTA band pattern instead of being the flatter outlier), testimonial
cards get an avatar for the same "real person" trust signal the hero's
proof row already uses, and the footer's column grid is genuinely
responsive instead of a hardcoded 4-column inline style. Deterministic,
no LLM / network.
"""
from __future__ import annotations

import re

from backend.services.generation.html_renderer import render_premium_page
from backend.services.generation.prompt_expander import expand

LANDING_PROMPTS = [
    "Build a SaaS landing page for a project management tool",
    "Build a website for a local bakery",
]


def _page(p: str) -> str:
    return render_premium_page(expand(p))


def test_every_section_head_gets_an_eyebrow_label():
    html = _page("Build a SaaS landing page for a project management tool")
    eyebrows = re.findall(r'ld-section-eyebrow">([^<]+)<', html)
    assert set(eyebrows) >= {"Features", "Pricing", "Testimonials", "FAQ"}


def test_testimonial_cards_show_an_avatar_for_trust():
    html = _page("Build a SaaS landing page for a project management tool")
    # one avatar for the hero's proof-row stack, plus one per testimonial card
    assert html.count('class="ds-avatar"') >= 3


def test_footer_grid_is_responsive_not_a_hardcoded_inline_style():
    html = _page("Build a website for a local bakery")
    assert 'class="ld-footer-grid"' in html
    # the 4-column rule must live in the (media-query-able) stylesheet,
    # not as an inline style attribute on the footer's grid div
    assert 'style="display:grid;grid-template-columns:1.4fr 1fr 1fr 1fr' not in html
    assert "@media (max-width:720px) { .ld-footer-grid" in html
