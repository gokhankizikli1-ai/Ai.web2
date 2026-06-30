# coding: utf-8
"""Sprint 2.1 — Renderer Personality & Premium Visual Quality Recovery.

Pure + deterministic (no LLM / network). Covers the regression this sprint
exists to fix:

  * the orchestrator-level routing gap — "Build a habit tracker"/"Build a
    music player" (no literal "app" in the prompt) used to fall through to
    the text-only `generic_creation` template with NO interactive
    prototype deliverable. A product NOUN ("tracker"/"player"/"planner"/
    "organizer") paired with a BUILD verb now routes to `app_prototype`,
  * the flat/generic "gray box" visual regression in the Sprint 2.0
    component library (the calendar/table/metric-card treatments leaned
    on flat `var(--surface-2)` fills) — replaced with gradient/tint/pill
    accents throughout,
  * per-vertical renderer PERSONALITY: wellness (calm session card +
    streak calendar), media (waveform + player), food (warm editorial
    recipe widget), fitness (training timeline + energetic accents),
    crypto/finance (watchlist + portfolio allocation, not plain text),
  * the 10 benchmark prompts from the sprint spec, each checked for the
    correct renderer category, product-specific components, and correct
    desktop/mobile mode,
  * that the Sprint 2.0 preview-reliability iframe `key` fixes are still
    in place,
  * that nothing from Sprint 1.9/2.0's locked vertical/layout/module-
    boundary contract regressed.
"""
from __future__ import annotations

import pathlib

import pytest

from backend.services.generation import quality
from backend.services.generation.html_renderer import render_premium_page
from backend.services.generation.prompt_expander import expand
from backend.services.orchestrator.templates import catalog as tmpl

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]


def _page(prompt: str) -> str:
    return render_premium_page(expand(prompt))


# ── Orchestrator routing: the root-cause fix ────────────────────────────

ROUTING_FIX_PROMPTS = [
    "Build a habit tracker", "Build a music player", "Build a workout planner",
    "Build a crypto portfolio tracker", "Build an organizer for my tasks",
]


@pytest.mark.parametrize("prompt", ROUTING_FIX_PROMPTS)
def test_product_noun_prompts_route_to_app_prototype(prompt):
    assert tmpl.choose_template(prompt, None).id == "app_prototype", prompt


@pytest.mark.parametrize("prompt", [
    "Research the best fitness trackers on the market",
    "Write a journal entry about my day",
    "research the market", "hello there",
])
def test_routing_fix_does_not_hijack_research_or_content_requests(prompt):
    assert tmpl.choose_template(prompt, None).id != "app_prototype", prompt


def test_app_hint_prompts_still_route_correctly():
    """The pre-existing literal-"app" routing is unaffected."""
    for req in ("Build a fitness app", "Design a dashboard", "Build a simple game", "Create a CRM"):
        assert tmpl.choose_template(req, None).id == "app_prototype", req


# ── Renderer personality: each vertical gets distinct components ───────

def test_wellness_personality_calm_calendar_and_session_card():
    html = _page("Build a habit tracker")
    assert 'data-component="calendar"' in html
    assert 'data-component="action-card"' in html
    assert "cl-action-calm" in html
    assert "cl-streak-badge" in html        # streak count called out, not just a bare grid
    html2 = _page("Build a meditation app")
    assert 'data-component="action-card"' in html2


def test_media_personality_waveform_and_player():
    html = _page("Build a music player")
    assert 'data-component="music-player"' in html
    assert 'data-component="waveform"' in html


def test_food_personality_warm_editorial():
    html = _page("Build a recipe app")
    assert 'data-component="food-panel"' in html
    assert 'data-component="ingredients"' in html
    assert 'data-component="recipe-steps"' in html


def test_fitness_personality_training_timeline():
    html = _page("Build a fitness tracking application")
    assert "Training timeline" in html
    assert 'data-component="timeline"' in html
    assert 'class="db-shell"' in html and 'class="db-sidebar"' in html  # still the locked dashboard shell


def test_crypto_personality_watchlist_and_portfolio():
    html = _page("Build a crypto portfolio dashboard")
    assert 'data-component="watchlist-row"' in html
    assert 'data-component="portfolio-card"' in html
    assert "Watchlist" in html


def test_other_verticals_do_not_get_unrelated_personality_widgets():
    """Personality widgets are vertical-specific, not bled into every
    product (banking shouldn't get a watchlist; a notes app shouldn't get
    a waveform)."""
    banking = _page("Build a banking dashboard")
    assert 'data-component="watchlist-row"' not in banking
    notes = _page("Build an Apple Notes style app")
    assert 'data-component="waveform"' not in notes
    assert 'data-component="food-panel"' not in notes


# ── Premium metric cards everywhere (no more flat plain-text stat pairs) ─

DASHBOARD_PROMPTS = ["Build a fitness tracking application", "Build a banking dashboard",
                     "Build a crypto portfolio dashboard", "Build an AI chat application",
                     "Build a CRM dashboard"]


@pytest.mark.parametrize("prompt", DASHBOARD_PROMPTS)
def test_dashboard_overview_uses_premium_metric_cards(prompt):
    html = _page(prompt)
    assert 'data-component="metric-card"' in html
    assert "cl-metric-ic" in html          # gradient icon badge, not a bare label/value pair


# ── Calendar/streak grid no longer reads as flat gray boxes ────────────

def test_calendar_unmarked_days_are_not_flat_filled():
    html = _page("Build a habit tracker")
    i = html.index("cl-cal-day {")
    block = html[i:i + 400]
    assert "background:transparent" in block
    assert "border-radius:9999px" in block  # pill/circle, not a square


# ── Benchmark prompts (Sprint 2.1 §8) ───────────────────────────────────

BENCHMARK = [
    ("Build a meditation app", "mobile_app", "mobile"),
    ("Build a habit tracker", "mobile_app", "mobile"),
    ("Build a music player", "mobile_app", "mobile"),
    ("Build a recipe app", "mobile_app", "mobile"),
    ("Build a fitness app", "saas_dashboard", "app"),
    ("Build a CRM dashboard", "saas_dashboard", "app"),
    ("Build a crypto trading dashboard", "saas_dashboard", "app"),
    ("Build a finance analytics dashboard", "analytics_dashboard", "app"),
    ("Build a landing page for an AI startup", "landing_page", "landing"),
]


@pytest.mark.parametrize("prompt,expected_category,expected_layout", BENCHMARK)
def test_benchmark_prompts_select_correct_renderer_and_layout(prompt, expected_category, expected_layout):
    spec = expand(prompt)
    assert spec.renderer == expected_category, (prompt, spec.renderer)
    assert spec.layout == expected_layout, (prompt, spec.layout)
    html = _page(prompt)
    assert html.lstrip().lower().startswith("<!doctype html")
    if expected_layout == "mobile":
        assert 'class="mb-frame"' in html
        assert 'class="db-shell"' not in html
    else:
        assert 'class="mb-frame"' not in html


@pytest.mark.parametrize("prompt,_cat,_layout", BENCHMARK)
def test_benchmark_prompts_are_premium_and_placeholder_free(prompt, _cat, _layout):
    html = _page(prompt)
    assert not quality.has_placeholders(html), prompt
    assert quality.is_premium(html), prompt
    assert quality.score(html)[0] >= 90, (prompt, quality.score(html))


def test_benchmark_prompts_route_to_an_app_or_web_template_not_creation():
    """Every benchmark prompt produces an artifact-emitting template
    (app_prototype or landing_page), never the text-only generic_creation
    — the headline acceptance bar for this sprint."""
    for prompt, _cat, _layout in BENCHMARK:
        tid = tmpl.choose_template(prompt, None).id
        assert tid in ("app_prototype", "landing_page"), (prompt, tid)


# ── Sprint 1.9/2.0-locked verticals: unaffected by personality work ────

LOCKED_APP_VERTICALS = [
    "Build a fitness tracking application", "Build a banking dashboard",
    "Build a crypto portfolio dashboard", "Build an AI chat application",
]


@pytest.mark.parametrize("prompt", LOCKED_APP_VERTICALS)
def test_locked_verticals_still_use_dashboard_shell(prompt):
    spec = expand(prompt)
    assert spec.layout == "app"
    html = _page(prompt)
    assert 'class="db-shell"' in html and 'class="db-sidebar"' in html


@pytest.mark.parametrize("prompt", ["Build a CRM tool", "Build a todo task manager"])
def test_crm_and_todo_still_stay_off_mobile(prompt):
    assert expand(prompt).layout == "app"


def test_orchestrator_still_does_not_import_blueprint_bridge_or_pi():
    import backend.services.orchestrator as orch
    root = pathlib.Path(orch.__file__).parent
    joined = "\n".join(f.read_text(encoding="utf-8") for f in root.rglob("*.py"))
    assert "product_intelligence" not in joined
    assert "blueprint_bridge" not in joined


# ── Preview reliability (Sprint 2.0) still in place ─────────────────────

def test_preview_iframe_key_fixes_still_present():
    """Guards against accidentally reverting the Sprint 2.0 preview-
    staleness fix while doing this sprint's visual work."""
    preview_result = (REPO_ROOT / "src/components/PreviewResult.tsx").read_text(encoding="utf-8")
    assert "key={payload.artifact_id" in preview_result

    deliverables_viewer = (REPO_ROOT / "src/components/results/DeliverablesViewer.tsx").read_text(encoding="utf-8")
    assert "key={`${id}-${resolved.body.length}`}" in deliverables_viewer

    modal = (REPO_ROOT / "src/components/DeliverablePreviewModal.tsx").read_text(encoding="utf-8")
    assert "deliverable.id" in modal and "r.body.length" in modal
