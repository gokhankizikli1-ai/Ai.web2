# coding: utf-8
"""Sprint 1.12 — generated preview UI quality pass (mobile app shell).

Three reusable, visual-only improvements to the shared mobile app-shell
renderer: a real status bar (device realism), a dominant lead metric
instead of four equal-weight cards (the flat-metric-grid anti-pattern),
and a background pill on the active bottom-tab (real app chrome).
Deterministic, no LLM / network.
"""
from __future__ import annotations

import re

from backend.services.generation.html_renderer import render_premium_page
from backend.services.generation.prompt_expander import expand

MOBILE_PROMPTS = ["Build a habit tracker", "Build a music player", "Build a recipe app"]


def _page(p: str) -> str:
    return render_premium_page(expand(p))


def test_mobile_shell_has_a_device_status_bar():
    for p in MOBILE_PROMPTS:
        html = _page(p)
        assert 'class="mb-statusbar"' in html
        assert "mb-statusbar-icons" in html


def test_mobile_metric_grid_has_a_dominant_lead_metric():
    for p in MOBILE_PROMPTS:
        html = _page(p)
        assert "mb-metric-lead" in html
        assert "mb-metric-sub" in html
        # the lead card must still carry the base metric-card class too
        assert 'class="mb-metric-card mb-metric-lead"' in html


def test_no_duplicate_ids_after_status_bar_and_metric_changes():
    for p in MOBILE_PROMPTS:
        html = _page(p)
        ids = re.findall(r'\bid="([^"]+)"', html)
        dupes = {i for i in ids if ids.count(i) > 1}
        assert not dupes, (p, dupes)
