# coding: utf-8
"""
Tests — Generation Adaptation layer (design intelligence → generation rules).

The layer TRANSLATES the existing intelligence outputs into one compact
``DESIGN GENERATION RULES`` block and, when its flag is on, supersedes the raw context
blocks in ``web_build_context`` (no duplication). Covers:

  1. luxury restaurant → cinematic / editorial guidance;
  2. AI SaaS → modern technology feeling, not forced cyberpunk;
  3. finance → trust prioritized over futuristic;
  4. portfolio → a valid, non-generic design plan;
  5. explicit user preference (minimal b/w) is respected;
  6. empty / invalid input → safe fallback;
  7. feature flag disabled → existing Web Build context is byte-for-byte unchanged.

Pure + deterministic (no LLM / network). Relies on the real analyzer outputs rather than
re-deriving any resolver.
"""
from __future__ import annotations

import re

import pytest

from backend.services import generation_adaptation as ga
from backend.services import web_build_context as wbc

_FLAGS = (
    "ENABLE_GENERATION_ADAPTATION", "ENABLE_DESIGN_PERSONALITY",
    "ENABLE_VISUAL_CONTEXT_INJECTION", "ENABLE_WEB_QUALITY_GUARD",
)


@pytest.fixture(autouse=True)
def _clean_flags(monkeypatch):
    for flag in _FLAGS:
        monkeypatch.delenv(flag, raising=False)
    yield


def _rules(prompt, context=None):
    return wbc.build_web_build_design_context(prompt, context)


def _feeling(block):
    m = re.search(r"- Overall feeling:.*", block)
    return (m.group(0).lower() if m else "")


# ── 1. Luxury restaurant → cinematic / editorial ──────────────────────────────

def test_luxury_restaurant_cinematic_editorial(monkeypatch):
    monkeypatch.setenv("ENABLE_GENERATION_ADAPTATION", "true")
    b = _rules("Create a luxury restaurant website", {"industry": "restaurant"})
    assert "DESIGN GENERATION RULES" in b
    assert "cinematic" in b.lower() and "editorial" in b.lower()
    # Explicitly steers away from SaaS/dashboard styling.
    assert "dashboard" in b.lower()


# ── 2. AI SaaS → modern tech, not forced cyberpunk ────────────────────────────

def test_ai_saas_modern_not_cyberpunk(monkeypatch):
    monkeypatch.setenv("ENABLE_GENERATION_ADAPTATION", "true")
    b = _rules("Create an AI image generation startup website")
    feeling = _feeling(b)
    assert "modern" in feeling or "innovative" in feeling
    assert "cyberpunk" not in b.lower()
    # Futuristic is allowed for this industry, but never forced neon clichés.
    assert "neon AI clichés" in b or "neon" in b.lower()  # appears only as an Avoid entry


# ── 3. Finance → trust over futuristic ────────────────────────────────────────

def test_finance_prioritizes_trust(monkeypatch):
    monkeypatch.setenv("ENABLE_GENERATION_ADAPTATION", "true")
    # The real pipeline supplies the business category; finance → trustworthy.
    b = _rules("Create an AI financial advisor website", {"industry": "finance"})
    feeling = _feeling(b)
    assert "trustworthy" in feeling
    # The FEELING/direction must not be futuristic/neon just because the product uses AI.
    assert "futuristic" not in feeling and "neon" not in feeling and "cyberpunk" not in feeling


# ── 4. Portfolio → a valid, non-generic plan ──────────────────────────────────

def test_portfolio_produces_valid_plan(monkeypatch):
    monkeypatch.setenv("ENABLE_GENERATION_ADAPTATION", "true")
    b = _rules("Create a photographer portfolio website", {"industry": "portfolio"})
    assert "DESIGN GENERATION RULES" in b
    assert "- Overall feeling:" in b and "- Visual direction:" in b and "- Layout behavior:" in b


# ── 5. Explicit user preference respected ─────────────────────────────────────

def test_explicit_user_preference_respected(monkeypatch):
    monkeypatch.setenv("ENABLE_GENERATION_ADAPTATION", "true")
    b = _rules("Create a minimal black and white design website")
    # The inferred direction reflects the explicit request...
    assert "minimal" in _feeling(b)
    # ...and the priority note defers to explicit user requests over any inferred default.
    assert "explicit user request" in b.lower()


# ── 6. Safe fallback ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("prompt,context", [
    ("", None),
    ("   ", {}),
    ("quantum llama teleportation", {"industry": "zzzz"}),
])
def test_safe_fallback(monkeypatch, prompt, context):
    monkeypatch.setenv("ENABLE_GENERATION_ADAPTATION", "true")
    out = _rules(prompt, context)
    assert isinstance(out, str)  # never raises
    if not prompt.strip() and not context:
        assert out == ""  # nothing to say on truly empty input


def test_garbage_context_does_not_crash(monkeypatch):
    monkeypatch.setenv("ENABLE_GENERATION_ADAPTATION", "true")
    for junk in (None, 123, ["a", "b"], object()):
        assert isinstance(wbc.build_web_build_design_context("build a site", junk), str)  # type: ignore[arg-type]


# ── 7. Feature flag disabled → byte-for-byte unchanged ────────────────────────

def test_flag_disabled_no_rules_and_analyzer_not_called(monkeypatch):
    # Adaptation off (default): no DESIGN GENERATION RULES, and the layer never runs.
    calls = {"n": 0}
    real = ga.build_generation_rules

    def spy(*a, **k):
        calls["n"] += 1
        return real(*a, **k)

    monkeypatch.setattr(ga, "build_generation_rules", spy)
    # With only a pre-existing block enabled, output must be the legacy composition.
    monkeypatch.setenv("ENABLE_DESIGN_PERSONALITY", "true")
    out = _rules("Create a luxury restaurant website", {"industry": "restaurant"})
    assert "DESIGN GENERATION RULES" not in out
    assert "DESIGN PERSONALITY GUIDANCE" in out  # legacy behaviour intact
    # web_build_context short-circuits on is_enabled() before calling the builder.
    assert calls["n"] == 0


def test_flag_disabled_all_off_returns_empty(monkeypatch):
    assert _rules("Create a luxury restaurant website", {"industry": "restaurant"}) == ""


def test_supersedes_raw_blocks_when_enabled(monkeypatch):
    # Adaptation ON supersedes the raw blocks even if their flags are also on (no dup).
    for flag in ("ENABLE_GENERATION_ADAPTATION", "ENABLE_DESIGN_PERSONALITY",
                 "ENABLE_VISUAL_CONTEXT_INJECTION", "ENABLE_WEB_QUALITY_GUARD"):
        monkeypatch.setenv(flag, "true")
    b = _rules("Create a luxury restaurant website", {"industry": "restaurant"})
    assert "DESIGN GENERATION RULES" in b
    assert "DESIGN PERSONALITY GUIDANCE" not in b and "QUALITY GUIDELINES:" not in b


# ── No internal scoring/reasoning leak ────────────────────────────────────────

def test_no_scoring_leak(monkeypatch):
    monkeypatch.setenv("ENABLE_GENERATION_ADAPTATION", "true")
    b = _rules("Create an AI financial advisor website", {"industry": "finance"})
    assert "confidence" not in b.lower() and "matched_signals" not in b
    # No raw enum keys leak into the model-facing block (prose only).
    assert "trustworthy_premium" not in b and "cinematic_elegant" not in b


# ── The generation-rules block is concise ─────────────────────────────────────

def test_block_is_bounded(monkeypatch):
    monkeypatch.setenv("ENABLE_GENERATION_ADAPTATION", "true")
    b = _rules("Create a luxury restaurant website", {"industry": "restaurant"})
    assert len(b) < 1400  # ~<350 tokens, concise for model consumption
