# coding: utf-8
"""
Integration tests — Design Personality Intelligence → Web Build context.

Covers the seam in ``backend.services.web_build_context`` that wires
``design_personality.build_design_personality`` into the model-facing design context:

  1. flag-off parity — analyzer not called, no guidance added, context unchanged;
  2. flag-on integration — analyzer called exactly once, guidance attached;
  3. domain precedence — AI+domain beats the weak "AI = futuristic" signal;
  4. explicit user preference is preserved (not overridden by an inferred aesthetic);
  5. safe fallback — empty / garbage context never crashes;
  6. profile is optional / backward compatible (None when disabled, serializes when on).

Pure + deterministic (no LLM / network). Tests rely on the real analyzer behaviour
rather than re-deriving its resolver.
"""
from __future__ import annotations

import re

import pytest

from backend.services import web_build_context as wbc
from backend.services import design_personality as dp

_FLAGS = ("ENABLE_DESIGN_PERSONALITY", "ENABLE_VISUAL_CONTEXT_INJECTION", "ENABLE_WEB_QUALITY_GUARD")


@pytest.fixture(autouse=True)
def _clean_flags(monkeypatch):
    """Every test starts with all three context flags off/unset."""
    for flag in _FLAGS:
        monkeypatch.delenv(flag, raising=False)
    yield


def _personality_in(block: str):
    m = re.search(r"Personality: ([a-z ]+)", block)
    return m.group(1).strip() if m else None


# ── 1. Flag-off parity ────────────────────────────────────────────────────────

def test_flag_off_returns_empty_and_never_runs_analyzer(monkeypatch):
    calls = {"n": 0}
    real = dp.analyze

    def spy(*a, **k):
        calls["n"] += 1
        return real(*a, **k)

    # Spy the ANALYZER itself (build_design_personality gates BEFORE running it).
    monkeypatch.setattr(dp, "analyze", spy)
    out = wbc.build_web_build_design_context("AI banking app", {"industry": "finance"})
    assert out == ""
    assert calls["n"] == 0, "the analyzer must not run when the flag is off"
    assert "DESIGN PERSONALITY GUIDANCE" not in out
    # The package's own flag gate keeps behaviour identical (None when off).
    assert dp.build_design_personality({"prompt": "AI banking app"}) is None


def test_flag_off_parity_matches_legacy_other_blocks(monkeypatch):
    # With only the (pre-existing) quality flag on, output must not contain any
    # personality guidance — i.e. the new layer is inert when its flag is off.
    monkeypatch.setenv("ENABLE_WEB_QUALITY_GUARD", "true")
    out = wbc.build_web_build_design_context("premium saas platform", {"industry": "saas"})
    assert "QUALITY GUIDELINES:" in out
    assert "DESIGN PERSONALITY GUIDANCE" not in out


def test_visual_block_unbiased_when_personality_flag_off(monkeypatch):
    # Visual injection ON, personality OFF: the DESIGN INTELLIGENCE block appears with no
    # personality guidance and no bias applied — byte-for-byte the pre-integration path.
    monkeypatch.setenv("ENABLE_VISUAL_CONTEXT_INJECTION", "true")
    out = wbc.build_web_build_design_context("AI banking app", {"industry": "finance"})
    assert "DESIGN INTELLIGENCE:" in out
    assert "DESIGN PERSONALITY GUIDANCE" not in out
    # Stable/idempotent (no hidden state from the new inference path).
    assert out == wbc.build_web_build_design_context("AI banking app", {"industry": "finance"})


# ── 2. Flag-on integration ────────────────────────────────────────────────────

def test_flag_on_infers_once_and_attaches_guidance(monkeypatch):
    monkeypatch.setenv("ENABLE_DESIGN_PERSONALITY", "true")
    calls = {"n": 0}
    real = dp.analyze

    def spy(*a, **k):
        calls["n"] += 1
        return real(*a, **k)

    monkeypatch.setattr(dp, "analyze", spy)
    out = wbc.build_web_build_design_context("AI advisor for banks", {"industry": "finance"})

    assert calls["n"] == 1, "the profile must be inferred exactly once per build"
    assert "DESIGN PERSONALITY GUIDANCE" in out
    assert "Personality: trustworthy premium" in out
    assert "Visual direction:" in out and "Motion direction:" in out
    assert "Avoid (negative constraints):" in out and "Confidence:" in out


def test_flag_on_does_not_leak_raw_scoring(monkeypatch):
    monkeypatch.setenv("ENABLE_DESIGN_PERSONALITY", "true")
    out = wbc.build_web_build_design_context("AI advisor for banks", {"industry": "finance"})
    # Internal scoring/reasoning must never appear in the model-facing block.
    assert "matched_signals" not in out and "confidence=" not in out


# ── 3. Domain precedence (anti "AI = futuristic") ─────────────────────────────

@pytest.mark.parametrize("prompt,context,expected", [
    ("AI banking app for wealth management", {"industry": "finance"}, "trustworthy premium"),
    ("AI powered toy for children", None, "playful"),
    ("AI concierge for a luxury resort", None, "cinematic elegant"),
    ("AI analytics dashboard", None, "futuristic"),
    ("artisan restaurant with an AI menu", None, "natural editorial"),
])
def test_domain_precedence(monkeypatch, prompt, context, expected):
    monkeypatch.setenv("ENABLE_DESIGN_PERSONALITY", "true")
    out = wbc.build_web_build_design_context(prompt, context)
    assert _personality_in(out) == expected


# ── 4. Explicit user preference is preserved ──────────────────────────────────

def test_explicit_trustworthy_request_not_overridden(monkeypatch):
    monkeypatch.setenv("ENABLE_DESIGN_PERSONALITY", "true")
    out = wbc.build_web_build_design_context(
        "Create a conservative and trustworthy financial website. "
        "Do not use futuristic neon visuals.",
        {"industry": "finance"},
    )
    assert _personality_in(out) == "trustworthy premium"
    # The inferred personality header must not be futuristic...
    header = out.split("Never default")[0]
    assert "Personality: futuristic" not in header
    # ...and the guidance explicitly defers to the user's explicit request.
    assert "Explicit user requests override inferred preferences" in out


# ── 5. Safe fallback ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("prompt,context", [
    ("", None),
    ("   ", {}),
    ("quantum llama teleportation", {"industry": "zzzz"}),
    ("", {"industry": ""}),
])
def test_safe_fallback_never_crashes(monkeypatch, prompt, context):
    monkeypatch.setenv("ENABLE_DESIGN_PERSONALITY", "true")
    # Must not raise for empty / unknown / contradictory input.
    out = wbc.build_web_build_design_context(prompt, context)
    assert isinstance(out, str)


def test_garbage_context_does_not_crash(monkeypatch):
    monkeypatch.setenv("ENABLE_DESIGN_PERSONALITY", "true")
    for junk in (None, 123, ["a", "b"], object()):
        out = wbc.build_web_build_design_context("build me a site", junk)  # type: ignore[arg-type]
        assert isinstance(out, str)


# ── 6. Optional profile / backward compatibility ──────────────────────────────

def test_profile_is_optional_when_disabled():
    # Contract: None when the flag is off (no forced field, no schema regression).
    assert dp.build_design_personality({"prompt": "AI bank"}) is None


def test_profile_serializes_when_enabled(monkeypatch):
    monkeypatch.setenv("ENABLE_DESIGN_PERSONALITY", "true")
    profile = dp.build_design_personality({"industry": "finance", "prompt": "AI advisor"})
    assert profile is not None
    data = profile.to_dict()
    # The four required outputs plus optional provenance are all present + serializable.
    for key in ("design_personality", "visual_direction", "motion_direction",
                "avoid_list", "confidence"):
        assert key in data
    assert data["design_personality"] == "trustworthy_premium"
    assert isinstance(data["avoid_list"], list)
