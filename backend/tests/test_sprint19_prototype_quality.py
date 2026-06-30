# coding: utf-8
"""Sprint 1.9 — Prototype Quality Upgrade tests.

Pure + deterministic (no LLM / network). Covers:
  * the new "mobile" app-shell layout/renderer (phone canvas, bottom tab
    bar, progress ring, profile card, list panel, FAB, inline SVG icons),
  * the new mobile-native vertical presets (habit/meditation tracker, music
    player, recipe app) and the generic-fallback reroute for unmatched
    mobile-native requests (e.g. "meditation app"),
  * ProductBlueprint data actually being used by generation (audience/
    feature overrides + classification-assist) — additive, backward
    compatible (blueprint=None behaves exactly as before this sprint),
  * the layout-aware LLM prompt guidance,
  * that nothing about the EXISTING six verticals, dashboard/landing
    renderers, or module boundaries regressed.
"""
from __future__ import annotations

import re

import pytest

from backend.services.generation import build_prompt, finalize_artifact, quality
from backend.services.generation.html_renderer import render_premium_page
from backend.services.generation.prompt_expander import expand
from backend.services.orchestrator.service import _blueprint_hint


def _page(prompt: str, blueprint=None) -> str:
    return render_premium_page(expand(prompt, blueprint=blueprint))


# ── New "mobile" layout: routing ───────────────────────────────────────

MOBILE_PROMPTS = {
    "wellness": ("Build a habit tracker", ["streak", "habit"]),
    "media":    ("Build a music player", ["playback", "playlist", "library"]),
    "food":     ("Build a recipe app", ["recipe", "cooking", "meal"]),
}


@pytest.mark.parametrize("prompt", [p for p, _ in MOBILE_PROMPTS.values()])
def test_new_verticals_route_to_mobile_layout(prompt):
    spec = expand(prompt)
    assert spec.layout == "mobile"
    assert spec.is_dashboard is True


def test_new_verticals_are_product_specific_and_distinct():
    specs = {k: expand(p) for k, (p, _) in MOBILE_PROMPTS.items()}
    names = {s.name for s in specs.values()}
    assert len(names) == len(specs)            # three distinct products
    for key, spec in specs.items():
        assert spec.product_type == key
        assert spec.name.lower() != "my app"
        assert spec.navigation and spec.sections and spec.metrics


def test_meditation_reroutes_from_generic_dashboard_to_mobile():
    """The headline structural fix: a personal wellness app used to fall
    into the generic SaaS-sidebar dashboard fallback. It now gets the
    phone-shaped mobile shell — still a real product UI, not marketing."""
    spec = expand("Build a meditation app")
    assert spec.layout == "mobile"
    assert spec.product_type == "wellness"


@pytest.mark.parametrize("prompt", ["Build a CRM tool", "Build a todo task manager"])
def test_business_tools_stay_on_dashboard_not_mobile(prompt):
    """Business/productivity tools are NOT rerouted — only genuinely
    consumer/personal mobile-native requests are."""
    spec = expand(prompt)
    assert spec.layout == "app"


# ── New "mobile" layout: renderer output quality ───────────────────────

@pytest.mark.parametrize("prompt", [p for p, _ in MOBILE_PROMPTS.values()] + ["Build a meditation app"])
def test_mobile_pages_are_premium_and_placeholder_free(prompt):
    html = _page(prompt)
    assert html.lstrip().lower().startswith("<!doctype html")
    assert quality.is_premium(html), prompt
    assert quality.score(html)[0] >= 90, (prompt, quality.score(html))


def test_mobile_shell_has_the_requested_components():
    html = _page("Build a habit tracker")
    assert 'class="mb-frame"' in html                    # phone-width canvas
    assert 'class="mb-topbar"' in html                    # top app-bar
    assert 'class="mb-tabbar"' in html and "mb-tab" in html  # bottom tab bar
    assert html.count('data-nav="mpage-') >= 3            # multiple tab destinations
    assert "ds-ring" in html                               # progress ring
    assert 'class="mb-metric-card"' in html                # metric grid
    assert 'class="mb-list-item"' in html                  # list items
    assert 'class="mb-fab"' in html                        # FAB action button
    assert 'class="mb-pill' in html                        # quick-action buttons
    assert '<svg class="ds-svg-icon"' in html               # inline SVG icons, no icon font/CDN


def test_mobile_shell_is_not_a_sidebar_dashboard():
    html = _page("Build a habit tracker")
    assert 'class="db-shell"' not in html
    assert 'class="db-sidebar"' not in html


def test_mobile_shell_sandbox_safe_and_interactive():
    html = _page("Build a music player")
    assert not re.search(r'(src|href)\s*=\s*["\']https?:', html)
    for bad in ("fetch(", "XMLHttpRequest", "eval(", "new Function", "import(", "WebSocket"):
        assert bad not in html
    assert "default-src 'none'" in html
    assert "<script>" in html and "<script " not in html
    assert "data-nav=" in html and "data-reveal=" in html


def test_mobile_reveal_panel_reachable_regardless_of_active_tab():
    """The FAB's data-reveal target must NOT be nested inside a hidden
    per-tab panel, or it would be unreachable from any tab but the first."""
    html = _page("Build a recipe app")
    reveal_idx = html.index('id="reveal-detail"')
    # The reveal section must not be inside any `ds-hidden` per-tab section
    # boundary — i.e. it sits in <main> as its own top-level sibling.
    last_panel_close = html.rindex("</section>", 0, reveal_idx)
    between = html[last_panel_close:reveal_idx]
    assert "data-panel=" not in between


# ── Existing 6 verticals + dashboard/landing renderers unaffected ──────

EXISTING_APP_VERTICALS = [
    "Build a fitness tracking application", "Build a banking dashboard",
    "Build a crypto portfolio dashboard", "Build an AI chat application",
]


@pytest.mark.parametrize("prompt", EXISTING_APP_VERTICALS)
def test_existing_verticals_still_use_dashboard_shell(prompt):
    spec = expand(prompt)
    assert spec.layout == "app"
    html = _page(prompt)
    assert 'class="db-shell"' in html
    assert 'class="db-sidebar"' in html


def test_existing_landing_renderer_unaffected():
    html = _page("Build a premium SaaS landing page")
    assert 'class="ds-hero"' in html and 'class="ds-logos"' in html


# ── ProductBlueprint wiring (the architectural fix) ─────────────────────

def test_expand_without_blueprint_is_byte_identical_to_before():
    """blueprint=None (the default — the common direct-orchestrator-run
    path) must behave exactly as it did before this sprint."""
    a = expand("Build a fitness tracking application")
    b = expand("Build a fitness tracking application", blueprint=None)
    assert a.audience == b.audience
    assert a.primary_goals == b.primary_goals
    assert a.layout == b.layout == "app"


def test_blueprint_overrides_audience_and_appends_features():
    blueprint = {
        "workspace": "productivity", "product_category": "fitness",
        "audience": "Busy parents who need 20-minute home workouts.",
        "core_features": ["Quick 20-min routines", "No equipment needed"],
        "recommended_renderer": "app",
    }
    spec = expand("Build a fitness app", blueprint=blueprint)
    assert spec.audience == blueprint["audience"]
    assert spec.primary_goals == blueprint["core_features"]
    feats = next(s for s in spec.sections if s.kind == "features")
    titles = [str(i.get("title", "")) for i in feats.items]
    assert any("Quick 20-min routines" in t for t in titles)
    # The preset's own curated features are preserved, not replaced.
    assert any("Workout Planner" in t for t in titles)


def test_blueprint_widens_classification_for_a_terse_prompt():
    """A blueprint-classified product_category helps route an otherwise
    ambiguous prompt — Product Intelligence's work is actually used."""
    spec = expand("build me something", blueprint={"product_category": "fitness"})
    assert spec.product_type == "fitness"


def test_blueprint_keywords_do_not_override_explicit_app_intent():
    blueprint = {
        "product_category": "ecommerce",
        "core_features": ["Shopping cart", "Checkout flow"],
    }
    spec = expand("Build an app", blueprint=blueprint)
    assert spec.layout == "app"
    assert spec.product_type == "app"


def test_blueprint_never_changes_an_explicit_vertical_match():
    """An explicit keyword in the prompt itself still wins regardless of a
    (possibly stale/contradictory) blueprint hint — defensive ordering."""
    spec = expand("Build a banking dashboard", blueprint={"product_category": "fitness"})
    assert spec.product_type == "banking"


def test_build_prompt_and_finalize_artifact_accept_blueprint_kwarg():
    blueprint = {"product_category": "fitness", "audience": "Marathon runners."}
    p = build_prompt(deliverable_kind="app_prototype_html", node_role="coder",
                     base_instructions="Build it", user_request="Build a fitness app",
                     blueprint=blueprint)
    assert "Marathon runners" in p

    art = finalize_artifact(deliverable_kind="app_prototype_html", node_title="P",
                            raw_reply="weak <div>My App</div>",
                            user_request="Build a fitness app", blueprint=blueprint)
    assert art["type"] == "html"
    assert not quality.has_placeholders(art["content"])


# ── orchestrator-layer blueprint hint extraction (service.py) ──────────

def test_service_blueprint_hint_extracts_known_fields_only():
    meta = {
        "source": "blueprint_bridge", "workspace": "productivity",
        "product_category": "fitness", "audience": "Busy parents",
        "complexity": "low", "recommended_renderer": "app",
        "core_features": ["Quick routines"], "recommended_agents": ["coder"],
        "irrelevant_field": "x",
    }
    hint = _blueprint_hint(meta)
    assert hint["workspace"] == "productivity"
    assert hint["core_features"] == ["Quick routines"]
    assert "recommended_agents" not in hint
    assert "irrelevant_field" not in hint
    assert "source" not in hint


@pytest.mark.parametrize("meta", [None, {}, {"kind": "project_run"}])
def test_service_blueprint_hint_is_none_for_plain_runs(meta):
    assert _blueprint_hint(meta) is None


def test_service_blueprint_hint_never_raises_on_garbage():
    assert _blueprint_hint({"core_features": "not-a-list"}) is not None  # truthy string kept as-is, no crash
    assert _blueprint_hint("not-even-a-dict") is None


# ── LLM-path prompt guidance (layout-aware) ─────────────────────────────

def test_llm_prompt_gives_mobile_shell_guidance_for_mobile_layout():
    p = build_prompt(deliverable_kind="app_prototype_html", node_role="coder",
                     base_instructions="Build it", user_request="Build a habit tracker")
    assert "MOBILE APP SHELL" in p
    assert "BOTTOM TAB BAR" in p


def test_llm_prompt_gives_dashboard_guidance_for_app_layout():
    p = build_prompt(deliverable_kind="app_prototype_html", node_role="coder",
                     base_instructions="Build it", user_request="Build a banking dashboard")
    assert "SAAS APP SHELL" in p


def test_llm_prompt_forbids_external_icon_dependencies():
    p = build_prompt(deliverable_kind="landing_page_html", node_role="coder",
                     base_instructions="Build it", user_request="Build a SaaS landing page")
    assert "inline SVG or CSS-only" in p


# ── Module boundaries preserved (Sprint 1.4's contract) ─────────────────

def test_orchestrator_still_does_not_import_blueprint_bridge_or_pi():
    import backend.services.orchestrator as orch
    import pathlib
    root = pathlib.Path(orch.__file__).parent
    joined = "\n".join(f.read_text(encoding="utf-8") for f in root.rglob("*.py"))
    assert "product_intelligence" not in joined
    assert "blueprint_bridge" not in joined
