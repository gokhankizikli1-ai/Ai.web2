# coding: utf-8
"""
Tests — Design Observability layer (read-only decision trace).

Covers the read-only trace + its effect (or lack of effect) on Web Build:

  1. luxury restaurant → cinematic/editorial direction recorded;
  2. AI startup → modern/forward-looking direction (not forced elsewhere);
  3. finance → trustworthy direction recorded;
  4. portfolio → a valid trace with all contributing layers;
  5. user override → detected + reflected in the priority;
  6. empty input → safe neutral fallback (never raises);
  7. feature disabled → trace is None AND generation output is byte-for-byte unchanged.

Plus: the observability hook NEVER changes the returned prompt, and no raw prompt/
sensitive content is stored. Pure + deterministic (no LLM / network).
"""
from __future__ import annotations

import pytest

from backend.services import design_observability as obs
from backend.services import web_build_context as wbc

_FLAGS = (
    "ENABLE_DESIGN_OBSERVABILITY", "ENABLE_GENERATION_ADAPTATION",
    "ENABLE_DESIGN_PERSONALITY", "ENABLE_VISUAL_CONTEXT_INJECTION", "ENABLE_WEB_QUALITY_GUARD",
)


@pytest.fixture(autouse=True)
def _clean_flags(monkeypatch):
    for flag in _FLAGS:
        monkeypatch.delenv(flag, raising=False)
    yield


# ── 1–4. Direction recorded per industry ──────────────────────────────────────

def test_luxury_restaurant_direction(monkeypatch):
    monkeypatch.setenv("ENABLE_DESIGN_OBSERVABILITY", "true")
    t = obs.build_decision_trace("Create a luxury restaurant website", {"industry": "restaurant"})
    assert t is not None
    blob = (t.selected_direction + " " + t.visual + " " + t.motion).lower()
    assert "cinematic" in blob or "editorial" in blob
    summary = obs.format_trace(t)
    assert "DESIGN DECISION SUMMARY" in summary and "Selected Direction:" in summary


def test_ai_startup_direction(monkeypatch):
    monkeypatch.setenv("ENABLE_DESIGN_OBSERVABILITY", "true")
    t = obs.build_decision_trace("Create an AI image generation startup website")
    assert t is not None
    assert "forward" in t.selected_direction.lower() or "modern" in t.selected_direction.lower()


def test_finance_direction(monkeypatch):
    monkeypatch.setenv("ENABLE_DESIGN_OBSERVABILITY", "true")
    t = obs.build_decision_trace("Create an AI financial advisor website", {"industry": "finance"})
    assert t is not None
    assert "trustworthy" in (t.selected_direction + " " + t.personality).lower()


def test_portfolio_trace_has_all_layers(monkeypatch):
    monkeypatch.setenv("ENABLE_DESIGN_OBSERVABILITY", "true")
    t = obs.build_decision_trace("Create a photographer portfolio website", {"industry": "portfolio"})
    assert t is not None
    for layer in ("Visual Intelligence", "Motion Intelligence", "Design Personality", "Web Quality Guard"):
        assert layer in t.contributing_layers


# ── 5. User override ──────────────────────────────────────────────────────────

def test_user_override_detected(monkeypatch):
    monkeypatch.setenv("ENABLE_DESIGN_OBSERVABILITY", "true")
    t = obs.build_decision_trace("Create a minimal black and white design website")
    assert t is not None
    assert t.user_override is True
    assert t.priority.startswith("user request")
    assert "yes" in obs.format_trace(t).lower().split("user override:")[1][:6]


def test_no_override_for_plain_request(monkeypatch):
    monkeypatch.setenv("ENABLE_DESIGN_OBSERVABILITY", "true")
    t = obs.build_decision_trace("Create a luxury restaurant website", {"industry": "restaurant"})
    assert t is not None and t.user_override is False


# ── 6. Empty / invalid fallback ───────────────────────────────────────────────

@pytest.mark.parametrize("prompt,context", [
    ("", None),
    ("   ", {}),
    ("quantum llama teleportation", {"industry": "zzzz"}),
])
def test_empty_and_unknown_fallback(monkeypatch, prompt, context):
    monkeypatch.setenv("ENABLE_DESIGN_OBSERVABILITY", "true")
    t = obs.build_decision_trace(prompt, context)
    assert t is not None                     # a safe neutral trace, never a crash
    assert isinstance(obs.format_trace(t), str)


def test_garbage_context_does_not_crash(monkeypatch):
    monkeypatch.setenv("ENABLE_DESIGN_OBSERVABILITY", "true")
    for junk in (None, 123, ["a"], object()):
        assert obs.build_decision_trace("build a site", junk) is not None  # type: ignore[arg-type]


# ── 7. Feature disabled → None + no generation change ─────────────────────────

def test_disabled_returns_none():
    assert obs.build_decision_trace("Create a luxury restaurant website", {"industry": "restaurant"}) is None


def test_observe_is_noop_when_disabled(monkeypatch):
    # observe() must not run the tracker when the flag is off.
    calls = {"n": 0}
    import backend.services.design_observability.tracker as tracker_mod
    real = tracker_mod.build_trace
    monkeypatch.setattr(tracker_mod, "build_trace", lambda *a, **k: calls.__setitem__("n", calls["n"] + 1) or real(*a, **k))
    obs.observe("Create a luxury restaurant website", {"industry": "restaurant"})
    assert calls["n"] == 0


def test_generation_output_unchanged_by_observability(monkeypatch):
    # The returned design-context prompt must be byte-for-byte identical whether
    # observability is off or on (the hook is log-only).
    monkeypatch.setenv("ENABLE_GENERATION_ADAPTATION", "true")
    prompt, ctx = "Create a luxury restaurant website", {"industry": "restaurant"}

    monkeypatch.delenv("ENABLE_DESIGN_OBSERVABILITY", raising=False)
    out_off = wbc.build_web_build_design_context(prompt, ctx)

    monkeypatch.setenv("ENABLE_DESIGN_OBSERVABILITY", "true")
    out_on = wbc.build_web_build_design_context(prompt, ctx)

    assert out_off == out_on and out_off != ""


def test_all_design_flags_off_still_empty_with_observability(monkeypatch):
    monkeypatch.setenv("ENABLE_DESIGN_OBSERVABILITY", "true")
    assert wbc.build_web_build_design_context("luxury restaurant", {"industry": "restaurant"}) == ""


# ── No sensitive / raw content stored ─────────────────────────────────────────

def test_trace_stores_no_raw_prompt(monkeypatch):
    monkeypatch.setenv("ENABLE_DESIGN_OBSERVABILITY", "true")
    secret = "contact me at jane.doe@example.com about luxury restaurant"
    t = obs.build_decision_trace(secret, {"industry": "restaurant"})
    assert t is not None
    serialized = str(t.to_dict()) + obs.format_trace(t)
    assert "jane.doe@example.com" not in serialized and secret not in serialized
    assert "prompt" not in t.to_dict()
