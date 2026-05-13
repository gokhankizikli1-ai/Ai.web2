# coding: utf-8
"""
Phase 7d — personality / system-prompt snapshot tests.

These tests don't validate the *quality* of the model's replies (no
LLM call) — they protect against regressions in the system-prompt
strings themselves. If a future edit accidentally re-introduces a
robot-corporate phrase, CI catches it before it ships.

Note: phrases like "bir yapay zeka asistani" appear INSIDE the
prompt's prohibition block as teaching examples — those are wanted
("here's what NOT to say"). The test ignores quoted occurrences and
only flags bare-declarative uses (e.g.
   `Sen Velora — bir yapay zeka asistani.`).
"""
from __future__ import annotations

import pytest


FORBIDDEN_PHRASES = [
    "bir yapay zeka asistani",
    "bir yapay zekayim",
    "yapay zeka olarak duygu",
    "duygularim yok",
    "duygu hissetmiyorum",
    "bir ai olarak",
    "bir ai asistani",
    # English assistant-cringe (in case any prompt drifts to English)
    "as an ai",
    "i am an ai",
    "i do not have emotions",
    "i don't have emotions",
    "i am an artificial intelligence",
]


def _has_forbidden_declaration(prompt: str, phrase: str) -> bool:
    """True iff `phrase` appears on a line where no `'` or `"` precedes
    it — i.e. the persona is declaring itself that way rather than
    quoting it as a forbidden example."""
    target = phrase.lower()
    for raw_line in prompt.split("\n"):
        line = raw_line.lower()
        idx = line.find(target)
        if idx == -1:
            continue
        before = line[:idx]
        if "'" in before or '"' in before:
            continue   # phrase is inside a quoted example — allowed.
        return True
    return False


# ── prompts.py (legacy chat path) ────────────────────────────────────────

def test_core_identity_has_no_forbidden_phrases():
    from prompts import _CORE_IDENTITY
    for bad in FORBIDDEN_PHRASES:
        assert not _has_forbidden_declaration(_CORE_IDENTITY, bad), \
            f"_CORE_IDENTITY contains a bare forbidden phrase: {bad!r}"


def test_chat_system_has_no_forbidden_phrases():
    from prompts import CHAT_SYSTEM
    for bad in FORBIDDEN_PHRASES:
        assert not _has_forbidden_declaration(CHAT_SYSTEM, bad), \
            f"CHAT_SYSTEM contains a bare forbidden phrase: {bad!r}"


def test_chat_system_keeps_casual_guidance():
    """The casual chat mode must telegraph short/casual reply behaviour
    so the model doesn't fall into long-monologue replies for greetings."""
    from prompts import CHAT_SYSTEM
    text = CHAT_SYSTEM.lower()
    casual_signals = ["casual", "kisa", "selam", "tek satir"]
    assert any(s in text for s in casual_signals), \
        f"CHAT_SYSTEM lost its casual-guidance signals (expected one of {casual_signals})"


# ── backend/services/ai/mode_manager.py (current path) ──────────────────

def test_mode_manager_base_has_no_forbidden_phrases():
    from backend.services.ai.mode_manager import _BASE
    for bad in FORBIDDEN_PHRASES:
        assert not _has_forbidden_declaration(_BASE, bad), \
            f"_BASE contains a bare forbidden phrase: {bad!r}"


def test_mode_manager_base_includes_examples():
    """The base persona must carry concrete casual-tone examples (e.g.
    'Nasilsin' → 'Iyiyim'). Without them the LLM falls back to
    corporate-assistant phrasing for greetings."""
    from backend.services.ai.mode_manager import _BASE
    text = _BASE.lower()
    assert "nasilsin" in text, "_BASE lost the 'Nasilsin' example"
    assert "iyiyim" in text,   "_BASE lost the 'Iyiyim' example"


def test_mode_manager_fast_prompt_keeps_short_guidance():
    from backend.services.ai.mode_manager import _FAST_PROMPT
    text = _FAST_PROMPT.lower()
    assert "kisa" in text, "_FAST_PROMPT lost short-reply guidance"


@pytest.mark.parametrize("attr", [
    "_FAST_PROMPT", "_DEEP_THINK_PROMPT", "_TRADING_PROMPT",
])
def test_every_mode_prompt_avoids_forbidden(attr):
    """Forbidden phrases must not leak into ANY mode prompt's bare
    declarations — even the serious analyst ones, which inherit from
    _BASE. Quoted prohibitions inside YASAK blocks are still allowed."""
    import backend.services.ai.mode_manager as mm
    prompt = getattr(mm, attr, None)
    if prompt is None:
        pytest.skip(f"{attr} not defined in mode_manager")
    for bad in FORBIDDEN_PHRASES:
        assert not _has_forbidden_declaration(prompt, bad), \
            f"{attr} contains a bare forbidden phrase: {bad!r}"


# ── build_system_prompt smoke ───────────────────────────────────────────

def test_build_system_prompt_returns_non_empty_for_known_modes():
    from backend.services.ai.prompt_manager import build_system_prompt
    for mode_name in ("fast", "deep_think", "trading_analyst"):
        p = build_system_prompt(mode_name)
        assert isinstance(p, str), f"{mode_name}: not a string"
        assert len(p) > 100, f"{mode_name}: prompt suspiciously short ({len(p)} chars)"
        assert "velora" in p.lower(), f"{mode_name}: persona signal missing"
