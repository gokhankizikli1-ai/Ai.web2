# coding: utf-8
"""
Tests — Design Intelligence → the REAL frontend_builder production path.

Covers the integration seam that connects the existing intelligence to the isolated
``frontend_builder`` model (the one that writes the actual React source):

  1. flag OFF  → the seam contributes NOTHING (frontend_builder prompt byte-for-byte old);
  2. flag ON + initial build → a single DESIGN GENERATION RULES block is produced;
  3. task gating → review / repair / revision / contract-repair are NEVER injected;
  4. no duplication → exactly one rules block;
  5. no leakage → no scores / confidence / enums / reasoning / raw prompt echo;
  6. the-intelligence-decides → different businesses get different image/motion strategy;
  7. flag independence → the orchestrator path (build_generation_rules) is unchanged;
  8. fail-open → malformed / empty / signal-less messages yield "".

Pure + deterministic (static intelligence; no LLM / network). Run with ``--noconftest``
(the repo conftest imports fastapi, which the frontend seam does not need).
"""
from __future__ import annotations

import json

import pytest

from backend.services.web_build_context import frontend_rules as fr
from backend.services import generation_adaptation as ga


# ── helpers ───────────────────────────────────────────────────────────────────

def _message(spec: dict, sub_marker: str = "") -> str:
    head = "[FRONTEND BUILDER REQUEST]\n"
    if sub_marker:
        head += sub_marker + "\n"
    return (
        head
        + "Contract version: frontend-spec-v1\n"
        + "BEGIN_FRONTEND_BUILD_SPEC_JSON\n"
        + json.dumps(spec)
        + "\nEND_FRONTEND_BUILD_SPEC_JSON"
    )


_RESTAURANT = {
    "prompt": "Build a website for an elegant fine-dining restaurant",
    "identity": {"sector": "hospitality", "subsector": "fine dining", "siteType": "restaurant"},
}
_AI_STARTUP = {
    "prompt": "Landing page for an AI analytics startup",
    "identity": {"sector": "technology", "subsector": "ai saas", "siteType": "startup"},
}
_FINANCE = {
    "prompt": "Website for a wealth management firm",
    "identity": {"sector": "finance", "subsector": "wealth management", "siteType": "finance"},
}


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    monkeypatch.delenv("ENABLE_FRONTEND_DESIGN_RULES", raising=False)
    monkeypatch.delenv("ENABLE_GENERATION_ADAPTATION", raising=False)
    yield


# ── 1. Flag OFF → byte-for-byte unchanged ─────────────────────────────────────

def test_flag_off_contributes_nothing():
    assert fr.is_enabled() is False
    # The seam returns "" → the caller's ``sys_p + ""`` is identical to ``sys_p``.
    assert fr.build_frontend_builder_rules(_message(_RESTAURANT)) == ""


def test_flag_off_is_the_default():
    # No env var set at all (fixture deletes it) → disabled.
    assert fr.is_enabled() is False


# ── 2. Flag ON + initial build → one rules block ──────────────────────────────

def test_enabled_initial_build_produces_rules(monkeypatch):
    monkeypatch.setenv("ENABLE_FRONTEND_DESIGN_RULES", "true")
    out = fr.build_frontend_builder_rules(_message(_RESTAURANT))
    assert out.startswith("DESIGN GENERATION RULES")
    assert "- Overall feeling:" in out
    assert "- Image strategy:" in out
    assert "- Motion behavior:" in out
    assert "- Layout behavior:" in out
    assert "- Avoid:" in out
    # The exact priority order the product requires.
    assert ("explicit user request > industry/business need > brand personality > "
            "visual direction > quality recommendations > generic defaults") in out


# ── 3. Task gating — only the initial build ───────────────────────────────────

@pytest.mark.parametrize("marker", [
    "[FRONTEND REVIEW REQUEST]",
    "[FRONTEND CONTRACT REPAIR REQUEST]",
    "[FRONTEND REPAIR REQUEST]",
    "[FRONTEND REVISION REQUEST]",
])
def test_subtasks_never_injected(monkeypatch, marker):
    monkeypatch.setenv("ENABLE_FRONTEND_DESIGN_RULES", "true")
    assert fr.build_frontend_builder_rules(_message(_RESTAURANT, marker)) == ""


def test_non_frontend_builder_message_ignored(monkeypatch):
    monkeypatch.setenv("ENABLE_FRONTEND_DESIGN_RULES", "true")
    assert fr.build_frontend_builder_rules("just some other chat message") == ""


# ── 4. No duplicated block ────────────────────────────────────────────────────

def test_single_rules_block(monkeypatch):
    monkeypatch.setenv("ENABLE_FRONTEND_DESIGN_RULES", "true")
    out = fr.build_frontend_builder_rules(_message(_AI_STARTUP))
    assert out.count("DESIGN GENERATION RULES") == 1
    # The user's raw prompt is guidance-derived, never echoed verbatim into the block.
    assert "Landing page for an AI analytics startup" not in out


# ── 5. No internal data leakage ───────────────────────────────────────────────

def test_no_internal_data_leaks(monkeypatch):
    monkeypatch.setenv("ENABLE_FRONTEND_DESIGN_RULES", "true")
    blob = fr.build_frontend_builder_rules(_message(_FINANCE)).lower()
    for forbidden in ("confidence", "score", "matched", "archetype", "avoid_patterns",
                      "avoid_effects", "to_dict", "0.", "reasoning", "trustworthy_premium",
                      "cinematic_elegant", "enum"):
        assert forbidden not in blob, forbidden


# ── 6. The intelligence decides (not a template) ──────────────────────────────

def test_different_businesses_get_different_strategy(monkeypatch):
    monkeypatch.setenv("ENABLE_FRONTEND_DESIGN_RULES", "true")
    resto = fr.build_frontend_builder_rules(_message(_RESTAURANT))
    ai = fr.build_frontend_builder_rules(_message(_AI_STARTUP))
    assert resto != ai
    # Restaurant → real architectural photography + cinematic; AI → abstract product visuals.
    assert "photography" in resto.lower()
    assert "abstract" in ai.lower()
    # AI must NOT be forced into neon/cyberpunk — the guard phrase is present, and the
    # feeling is not a raw "futuristic" template dump.
    assert "neon" in ai.lower()  # only as an AVOID / guard clause
    assert "never apply generic futuristic or neon" in ai.lower()


def test_image_strategy_decides_medium(monkeypatch):
    monkeypatch.setenv("ENABLE_FRONTEND_DESIGN_RULES", "true")
    ai = fr.build_frontend_builder_rules(_message(_AI_STARTUP))
    # An AI startup should lead with abstract/product visuals rather than literal stock photos.
    img_line = next(ln for ln in ai.splitlines() if ln.startswith("- Image strategy:"))
    assert "abstract" in img_line.lower() or "product" in img_line.lower()


# ── 7. Flag independence — orchestrator path is unchanged ─────────────────────

def test_orchestrator_flag_still_gates_build_generation_rules(monkeypatch):
    # The frontend flag must NOT turn on the orchestrator's generation_adaptation.
    monkeypatch.setenv("ENABLE_FRONTEND_DESIGN_RULES", "true")
    monkeypatch.delenv("ENABLE_GENERATION_ADAPTATION", raising=False)
    assert ga.is_enabled() is False
    assert ga.build_generation_rules("Build a fine-dining restaurant site",
                                     {"industry": "hospitality"}) == ""
    # …but the flag-independent composer the frontend seam reuses DOES produce the block.
    assert ga.compose_generation_rules("Build a fine-dining restaurant site",
                                       {"industry": "hospitality"}).startswith("DESIGN GENERATION RULES")


def test_compose_equals_build_when_orchestrator_enabled(monkeypatch):
    monkeypatch.setenv("ENABLE_GENERATION_ADAPTATION", "true")
    req, ctx = "Build a wealth management site", {"industry": "finance"}
    assert ga.build_generation_rules(req, ctx) == ga.compose_generation_rules(req, ctx)


# ── 8. Fail-open ──────────────────────────────────────────────────────────────

def test_malformed_json_fails_open(monkeypatch):
    monkeypatch.setenv("ENABLE_FRONTEND_DESIGN_RULES", "true")
    bad = ("[FRONTEND BUILDER REQUEST]\nBEGIN_FRONTEND_BUILD_SPEC_JSON\n"
           "{not valid json,,}\nEND_FRONTEND_BUILD_SPEC_JSON")
    assert fr.build_frontend_builder_rules(bad) == ""


def test_missing_markers_fails_open(monkeypatch):
    monkeypatch.setenv("ENABLE_FRONTEND_DESIGN_RULES", "true")
    assert fr.build_frontend_builder_rules("[FRONTEND BUILDER REQUEST] no spec markers here") == ""


def test_empty_signal_produces_nothing(monkeypatch):
    monkeypatch.setenv("ENABLE_FRONTEND_DESIGN_RULES", "true")
    # A spec with neither a prompt nor any identity signal → no generic block.
    assert fr.build_frontend_builder_rules(_message({"identity": {}})) == ""


def test_deterministic(monkeypatch):
    monkeypatch.setenv("ENABLE_FRONTEND_DESIGN_RULES", "true")
    msg = _message(_FINANCE)
    assert fr.build_frontend_builder_rules(msg) == fr.build_frontend_builder_rules(msg)
