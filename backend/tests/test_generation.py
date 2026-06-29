# coding: utf-8
"""EPIC 2 — premium generation engine tests.

Pure + deterministic (no LLM / network). Covers prompt expansion, the
design system, the component catalog, the quality reviewer, the premium
HTML renderer, and the engine's build_prompt / finalize_artifact + the
renderer-registry swap seam.
"""
from __future__ import annotations

import re

import pytest

from backend.services.generation import build_prompt, finalize_artifact, register_renderer
from backend.services.generation.prompt_expander import expand
from backend.services.generation.design_system import design_system_css, DESIGN_TOKENS
from backend.services.generation.components import detect_components
from backend.services.generation.html_renderer import render_premium_page
from backend.services.generation import quality


SUCCESS_PROMPTS = {
    "fitness":    ("Build a fitness tracking application", ["Workout", "Calorie", "BMI"]),
    "ai_chat":    ("Build an AI chat application",         ["Conversation", "model", "history"]),
    "banking":    ("Build a banking dashboard",            ["balance", "transaction", "Investment"]),
    "saas":       ("Build a premium SaaS landing page",    ["Pricing", "FAQ", "Features"]),
    "restaurant": ("Build a restaurant website",           ["Menu", "Reserv", "Gallery"]),
    "crypto":     ("Build a crypto portfolio dashboard",   ["Portfolio", "Holdings", "P&L"]),
}


# ── Prompt expansion ──────────────────────────────────────────────────

def test_expand_classifies_each_success_prompt():
    for key, (prompt, _) in SUCCESS_PROMPTS.items():
        spec = expand(prompt)
        assert spec.product_type == key, f"{prompt} -> {spec.product_type}"
        assert spec.name and spec.name.lower() != "my app"
        assert spec.navigation and spec.sections


def test_expand_is_distinct_per_type():
    names = {expand(p).name for p, _ in SUCCESS_PROMPTS.values()}
    assert len(names) == len(SUCCESS_PROMPTS)   # six distinct products


# ── Design system ─────────────────────────────────────────────────────

def test_design_system_css_has_tokens_dark_light_responsive():
    css = design_system_css("#22c55e", "#84cc16")
    assert "--accent" in css and "#22c55e" in css
    assert "--bg" in css and ".light" in css          # dark + light modes
    assert "@media" in css                            # responsive
    assert "transition" in css and "@keyframes" in css  # motion
    assert DESIGN_TOKENS["breakpoints"]["md"] == "768px"


# ── Premium renderer + the six success criteria ──────────────────────

def test_render_premium_page_is_valid_and_distinct():
    titles = set()
    for key, (prompt, markers) in SUCCESS_PROMPTS.items():
        html = render_premium_page(expand(prompt))
        assert html.lstrip().lower().startswith("<!doctype html")
        assert "viewport" in html.lower()             # responsive meta
        assert "var(--" in html                       # design system
        assert not quality.has_placeholders(html), f"{key} has placeholders"
        # context-aware: at least one app-specific marker present
        assert any(m.lower() in html.lower() for m in markers), f"{key} missing {markers}"
        titles.add(html[:200])
    assert len(titles) == len(SUCCESS_PROMPTS)         # completely different


def test_render_premium_page_navigation_links_target_existing_ids():
    for prompt, _ in SUCCESS_PROMPTS.values():
        html = render_premium_page(expand(prompt))
        ids = set(re.findall(r'\bid="([^"]+)"', html))
        hrefs = re.findall(r'href="#([^"]+)"', html)
        assert hrefs
        assert set(hrefs) <= ids


def test_components_detected_in_premium_page():
    html = render_premium_page(expand("Build a premium SaaS landing page"))
    comps = detect_components(html)
    assert "Navbar" in comps and "Footer" in comps
    assert len(comps) >= 4


# ── Quality reviewer ──────────────────────────────────────────────────

def test_quality_scores_premium_high_and_junk_low():
    good = render_premium_page(expand("Build a fitness app"))
    s_good, _ = quality.score(good)
    assert s_good >= quality.QUALITY_THRESHOLD
    assert quality.is_premium(good)

    junk = "<html><body><h1>My App</h1><p>Feature 1</p><p>Lorem ipsum</p></body></html>"
    s_junk, issues = quality.score(junk)
    assert s_junk < quality.QUALITY_THRESHOLD
    assert quality.has_placeholders(junk)
    assert not quality.is_premium(junk)


def test_quality_requires_viewport_meta_not_just_word():
    premium = render_premium_page(expand("Build a premium SaaS landing page"))
    no_meta = premium.replace(
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        "<!-- viewport is handled by CSS -->",
    )
    assert not quality.has_viewport_meta(no_meta)

    _, issues = quality.score(no_meta)
    assert "not responsive (missing viewport / media queries)" in issues


# ── Engine: build_prompt ──────────────────────────────────────────────

def test_build_prompt_expands_invisibly_for_page_kinds():
    p = build_prompt(deliverable_kind="app_prototype_html", node_role="coder",
                     base_instructions="Build the prototype",
                     user_request="Build a fitness app")
    assert "PRODUCT SPECIFICATION" in p
    assert "NEVER output placeholders" in p
    assert "Navbar" in p                  # component catalog injected
    assert "fitness" in p.lower()


def test_build_prompt_light_context_for_markdown_kinds():
    p = build_prompt(deliverable_kind="app_concept", node_role="product_strategist",
                     base_instructions="Define the concept",
                     user_request="Build a banking dashboard")
    assert "Define the concept" in p
    assert "PRODUCT CONTEXT" in p


# ── Engine: finalize_artifact ─────────────────────────────────────────

def test_finalize_weak_reply_falls_back_to_premium(monkeypatch):
    art = finalize_artifact(deliverable_kind="app_prototype_html", node_title="Prototype",
                            raw_reply="here you go: <div>My App</div> Feature 1",
                            user_request="Build a fitness app")
    assert art["type"] == "html" and art["preview"] == "iframe"
    assert art["content"].lstrip().lower().startswith("<!doctype html")
    assert not quality.has_placeholders(art["content"])
    md = art["metadata"]
    assert md["source"] == "generated"          # quality gate → premium fallback
    assert md["responsive"] is True and md["dark_mode"] is True
    assert md["components_used"] and md["complexity"] in {"low", "medium", "high"}
    assert md["files"] and md["files"][0].endswith(".html")
    assert md["product_type"] == "fitness"


def test_finalize_keeps_premium_model_output():
    premium = render_premium_page(expand("Build a premium SaaS landing page"))
    art = finalize_artifact(deliverable_kind="landing_page_html", node_title="Page",
                            raw_reply=f"Sure!\n```html\n{premium}\n```",
                            user_request="Build a SaaS landing page")
    assert art["type"] == "html"
    assert art["metadata"]["source"] == "model"   # good LLM output kept
    assert "Cadence" in art["content"]


def test_finalize_injects_missing_viewport_meta_into_model_output():
    premium = render_premium_page(expand("Build a premium SaaS landing page"))
    no_meta = premium.replace("<head>", '<head data-note="viewport-copy">').replace(
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        "<!-- viewport is handled by CSS -->",
    )
    art = finalize_artifact(deliverable_kind="landing_page_html", node_title="Page",
                            raw_reply=no_meta,
                            user_request="Build a SaaS landing page")
    assert art["metadata"]["source"] == "model"
    assert quality.has_viewport_meta(art["content"])
    assert art["metadata"]["responsive"] is True


def test_finalize_markdown_kind_delegates_with_metadata():
    art = finalize_artifact(deliverable_kind="app_concept", node_title="Concept",
                            raw_reply="## Concept\nA great product.",
                            user_request="Build a fitness app")
    assert art["type"] == "markdown"
    assert "metadata" in art


# ── Future-proofing: renderer registry swap ───────────────────────────

def test_renderer_registry_swap(monkeypatch):
    class _FakeReactRenderer:
        name = "react_vite"
        def build_prompt(self, *, base_instructions, spec): return "REACT_PROMPT"
        def finalize(self, *, node_title, raw_reply, spec):
            return {"type": "react_component", "title": node_title, "language": "tsx",
                    "content": "export default()=>null", "files": [], "preview": "code",
                    "download": {"filename": "App.tsx", "mime": "text/plain"}, "metadata": {}}
    register_renderer("react_vite", _FakeReactRenderer())
    monkeypatch.setenv("GENERATION_RENDERER", "react_vite")
    art = finalize_artifact(deliverable_kind="app_prototype_html", node_title="P",
                            raw_reply="x", user_request="Build a fitness app")
    assert art["type"] == "react_component"   # orchestration unchanged; renderer swapped
    p = build_prompt(deliverable_kind="app_prototype_html", node_role="coder",
                     base_instructions="b", user_request="Build a fitness app")
    assert p == "REACT_PROMPT"
