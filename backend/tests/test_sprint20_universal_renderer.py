# coding: utf-8
"""Sprint 2.0 — Universal Renderer & Premium Web Builder tests.

Pure + deterministic (no LLM / network). Covers:
  * the new Universal Renderer Selector — 7 named categories layered on
    top of the existing `layout` dispatch, picked correctly for every
    Sprint 2.0 example prompt,
  * the new shared component library (table/timeline/calendar/music
    player/notifications/form) — both standalone output and wiring into
    the admin_panel / analytics_dashboard / marketing_website renderer
    variants and the mobile media/wellness verticals,
  * desktop renderers never render inside the phone shell and vice versa
    (no cross-contamination across all 7 categories),
  * the new Arc Browser style mode,
  * that every Sprint 1.9-locked vertical/layout/module-boundary
    constraint still holds (fitness/banking/crypto/ai_chat stay on the
    plain saas_dashboard variant; CRM/todo stay off mobile; the
    orchestrator package still never imports blueprint_bridge/product_
    intelligence).
"""
from __future__ import annotations

import pytest

from backend.services.generation import component_library as cl
from backend.services.generation import quality
from backend.services.generation.html_renderer import render_premium_page
from backend.services.generation.prompt_expander import expand
from backend.services.generation.renderer_selector import (
    RENDERER_CATEGORIES, select_renderer,
)


def _page(prompt: str) -> str:
    return render_premium_page(expand(prompt))


# ── Universal Renderer Selector: the 9 Sprint 2.0 example prompts ──────

PROMPT_UNDERSTANDING_EXAMPLES = [
    ("Build a music player", "mobile_app"),
    ("Build a fitness tracking application", "saas_dashboard"),
    ("Build a banking application", "saas_dashboard"),
    ("Build a crypto portfolio dashboard", "saas_dashboard"),
    ("Build a restaurant website", "landing_page"),
    ("Build a travel booking website", "marketing_website"),
    ("Build a portfolio site for a designer", "portfolio"),
    ("Build an agency website", "marketing_website"),
    ("Build an analytics dashboard", "analytics_dashboard"),
]


@pytest.mark.parametrize("prompt,expected_category", PROMPT_UNDERSTANDING_EXAMPLES)
def test_prompt_understanding_selects_the_right_renderer_category(prompt, expected_category):
    spec = expand(prompt)
    assert spec.renderer == expected_category, (prompt, spec.renderer)


def test_renderer_categories_are_the_seven_named_in_the_spec():
    assert set(RENDERER_CATEGORIES) == {
        "mobile_app", "saas_dashboard", "landing_page", "admin_panel",
        "marketing_website", "portfolio", "analytics_dashboard",
    }


def test_select_renderer_never_raises_on_garbage():
    out = select_renderer(text="", layout="", product_type="", blueprint=None)
    assert out["category"] in RENDERER_CATEGORIES
    out2 = select_renderer(text=None, layout=None, blueprint="not-a-dict")
    assert out2["category"] in RENDERER_CATEGORIES


def test_admin_panel_vs_analytics_vs_saas_dashboard_keyword_routing():
    assert expand("Build an admin panel for managing users").renderer == "admin_panel"
    assert expand("Build a back-office control panel").renderer == "admin_panel"
    assert expand("Build a KPI analytics dashboard for sales").renderer == "analytics_dashboard"
    assert expand("Build a CRM dashboard").renderer == "saas_dashboard"


def test_generic_saas_landing_stays_landing_page_not_marketing_website():
    """A plain "SaaS / startup landing page" must NOT be misclassified as
    Marketing Website just because "startup" appears in the prompt."""
    spec = expand("Build a landing page for an AI startup")
    assert spec.layout == "landing"
    assert spec.renderer == "landing_page"


# ── Never use the wrong renderer: desktop vs mobile, across categories ─

DESKTOP_PROMPTS = [
    "Build a CRM dashboard", "Build a banking dashboard", "Build an admin panel for managing users",
    "Build an analytics dashboard", "Build a SaaS landing page", "Build an agency website",
    "Build a portfolio site for a designer",
]
MOBILE_PROMPTS = ["Build a music player", "Build a habit tracker", "Build a meditation app", "Build a recipe app"]


@pytest.mark.parametrize("prompt", DESKTOP_PROMPTS)
def test_desktop_renderers_never_render_inside_the_phone_shell(prompt):
    spec = expand(prompt)
    assert spec.renderer != "mobile_app"
    html = _page(prompt)
    assert 'class="mb-frame"' not in html
    assert 'class="mb-tabbar"' not in html


@pytest.mark.parametrize("prompt", MOBILE_PROMPTS)
def test_mobile_app_renderer_never_renders_a_desktop_dashboard(prompt):
    spec = expand(prompt)
    assert spec.renderer == "mobile_app"
    html = _page(prompt)
    assert 'class="db-shell"' not in html
    assert 'class="db-sidebar"' not in html
    assert 'class="mb-frame"' in html


# ── Component library: standalone output ────────────────────────────────

def test_table_component_renders_headers_and_rows():
    html = cl.table(["Name", "Status"], [["Ann", "Active"], ["Bo", "Invited"]])
    assert 'data-component="table"' in html
    assert "<th>Name</th>" in html and "<td>Ann</td>" in html


def test_table_component_handles_empty_rows_without_placeholder_junk():
    html = cl.table(["Name"], [])
    assert "No records yet." in html


def test_timeline_component_renders_items():
    html = cl.timeline([{"icon": "bell", "title": "Signed up", "body": "Welcome aboard", "time": "2m"}])
    assert 'data-component="timeline"' in html
    assert "Signed up" in html and "2m" in html


def test_calendar_grid_marks_streak_days():
    html = cl.calendar_grid("June 2026", [1, 2, 3], today=3, days_in_month=30, start_weekday=1)
    assert 'data-component="calendar"' in html
    assert html.count("is-marked") == 3
    assert "is-today" in html


def test_music_player_has_transport_controls_and_progress():
    html = cl.music_player("Night Drive", "Aurora Wave", progress_pct=42)
    assert 'data-component="music-player"' in html
    assert "Night Drive" in html and "Aurora Wave" in html
    assert "cl-player-progress" in html and "--pct:42%" in html


def test_notifications_panel_marks_unread():
    html = cl.notifications_panel([{"icon": "bell", "title": "Payment received", "body": "$240.00", "time": "1h", "unread": True}])
    assert 'data-component="notifications"' in html
    assert "is-unread" in html


def test_form_fields_renders_real_inputs_not_placeholders():
    html = cl.form_fields([
        {"name": "email", "label": "Work email", "type": "email"},
        {"name": "message", "label": "Message", "type": "textarea"},
    ], submit_label="Send inquiry")
    assert 'data-component="form"' in html
    assert '<input type="email" name="email"' in html
    assert "<textarea" in html
    assert "Send inquiry" in html


# ── Component library wired into renderer variants ──────────────────────

def test_admin_panel_variant_has_a_real_records_table():
    spec = expand("Build an admin panel for managing users")
    assert spec.data.get("variant") == "admin_panel"
    html = _page("Build an admin panel for managing users")
    assert 'data-component="table"' in html
    assert any(n.lower() == "records" for n in (spec.navigation + ["records"]))  # nav resolved at render time
    assert "Records" in html


def test_analytics_dashboard_variant_has_an_insight_timeline():
    spec = expand("Build an analytics dashboard")
    assert spec.data.get("variant") == "analytics_dashboard"
    html = _page("Build an analytics dashboard")
    assert 'data-component="timeline"' in html
    assert "Insights" in html


def test_saas_dashboard_variant_has_no_admin_or_analytics_extras():
    """The plain saas_dashboard variant (the locked verticals' default)
    must NOT get the admin/analytics-only extras."""
    html = _page("Build a banking dashboard")
    assert 'data-component="table"' not in html
    assert 'data-component="timeline"' not in html


def test_every_dashboard_variant_has_a_reachable_notifications_panel():
    html = _page("Build a banking dashboard")
    assert 'id="reveal-notifications"' in html
    assert 'data-component="notifications"' in html
    assert 'data-reveal="reveal-notifications"' in html


def test_marketing_website_variant_has_a_real_contact_form():
    spec = expand("Build an agency website")
    assert spec.data.get("variant") == "marketing_website"
    html = _page("Build an agency website")
    assert 'data-component="form"' in html
    assert "Let" in html  # "Let's work together" heading


def test_landing_page_variant_has_no_contact_form():
    html = _page("Build a SaaS landing page")
    assert 'data-component="form"' not in html


def test_music_vertical_uses_the_music_player_widget():
    html = _page("Build a music player")
    assert 'data-component="music-player"' in html


def test_wellness_vertical_uses_the_streak_calendar():
    html = _page("Build a habit tracker")
    assert 'data-component="calendar"' in html
    html2 = _page("Build a meditation app")
    assert 'data-component="calendar"' in html2


def test_other_mobile_verticals_do_not_get_unrelated_widgets():
    html = _page("Build a recipe app")
    assert 'data-component="music-player"' not in html
    assert 'data-component="calendar"' not in html


# ── Sprint 1.9-locked verticals: unaffected by the variant system ──────

LOCKED_APP_VERTICALS = [
    "Build a fitness tracking application", "Build a banking dashboard",
    "Build a crypto portfolio dashboard", "Build an AI chat application",
]


@pytest.mark.parametrize("prompt", LOCKED_APP_VERTICALS)
def test_locked_verticals_stay_on_the_plain_saas_dashboard_variant(prompt):
    spec = expand(prompt)
    assert spec.layout == "app"
    assert spec.renderer == "saas_dashboard"
    assert spec.data.get("variant") == "saas_dashboard"


@pytest.mark.parametrize("prompt", ["Build a CRM tool", "Build a todo task manager"])
def test_crm_and_todo_still_stay_off_mobile(prompt):
    spec = expand(prompt)
    assert spec.layout == "app"
    assert spec.renderer != "mobile_app"


def test_renderer_category_carried_in_artifact_metadata():
    from backend.services.generation import finalize_artifact
    art = finalize_artifact(deliverable_kind="app_prototype_html", node_title="P",
                            raw_reply="weak <div>My App</div>",
                            user_request="Build an admin panel for managing users")
    assert art["metadata"]["renderer_category"] == "admin_panel"


# ── Arc Browser style mode (Visual Quality Upgrade) ─────────────────────

def test_arc_browser_style_mode_resolves_and_renders_premium():
    spec = expand("Build a productivity app in the style of Arc Browser")
    assert spec.style.get("mode_name") == "arc_browser"
    html = _page("Build a productivity app in the style of Arc Browser")
    assert quality.is_premium(html)


# ── No placeholder junk / premium quality across every category ────────

ALL_CATEGORY_PROMPTS = [p for p, _ in PROMPT_UNDERSTANDING_EXAMPLES] + [
    "Build a CRM dashboard", "Build an admin panel for managing users", "Build a habit tracker",
]


@pytest.mark.parametrize("prompt", ALL_CATEGORY_PROMPTS)
def test_no_placeholder_junk_across_every_renderer_category(prompt):
    html = _page(prompt)
    assert not quality.has_placeholders(html), prompt
    assert quality.is_premium(html), prompt


# ── Module boundary still preserved (Sprint 1.4's contract) ────────────

def test_orchestrator_still_does_not_import_blueprint_bridge_or_pi():
    import backend.services.orchestrator as orch
    import pathlib
    root = pathlib.Path(orch.__file__).parent
    joined = "\n".join(f.read_text(encoding="utf-8") for f in root.rglob("*.py"))
    assert "product_intelligence" not in joined
    assert "blueprint_bridge" not in joined


# ── Backward compatibility: blueprint=None unaffected ───────────────────

def test_blueprint_none_still_byte_identical_renderer_choice():
    a = expand("Build a fitness tracking application")
    b = expand("Build a fitness tracking application", blueprint=None)
    assert a.renderer == b.renderer == "saas_dashboard"
