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
    # Turkish robot-AI declarations
    "bir yapay zeka asistani",
    "bir yapay zekayim",
    "yapay zeka olarak duygu",
    "duygularim yok",
    "duygu hissetmiyorum",
    "bir ai olarak",
    "bir ai asistani",
    "ben bir yapay zeka olarak",
    # English equivalents (the assistant must avoid these in any path)
    "as an ai",
    "i am an ai",
    "i do not have emotions",
    "i don't have emotions",
    "i am an artificial intelligence",
    "i am an artificial intelligence assistant",
    # Hard "always Turkish" rule — Phase 8b multilingual requires the
    # opposite, so a prompt edit re-introducing this would break the
    # spec.
    "her zaman turkce. modern",
    "always reply in turkish",
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


# ── Phase 8b — multilingual personality ─────────────────────────────────
# These assertions encode the spec from the Phase 8b brief:
#   - reply in the user's language
#   - English casual + identity examples present
#   - mixed-language example present
#   - no "Always Turkish" rule

@pytest.mark.parametrize("source", ["_BASE", "_CORE_IDENTITY"])
def test_multilingual_rule_explicit(source):
    """The persona must instruct the model to match the user's language,
    not enforce a single language."""
    if source == "_BASE":
        from backend.services.ai.mode_manager import _BASE as prompt
    else:
        from prompts import _CORE_IDENTITY as prompt
    low = prompt.lower()
    # Multilingual signal must be present in one of several forms.
    signals = [
        "match the user's language",
        "kullanici turkce yazdiysa",
        "user writes english",
        "mirror the mix",
        "do not switch languages",
    ]
    assert any(s in low for s in signals), \
        f"{source} is missing the multilingual instruction (looking for any of {signals})"


@pytest.mark.parametrize("source", ["_BASE", "_CORE_IDENTITY"])
def test_english_casual_examples_present(source):
    """English casual examples ('how are you' → 'doing good',
    'what are you' → 'I'm KorvixAI…') must be on the prompt so the
    model has concrete patterns to follow when the user writes English."""
    if source == "_BASE":
        from backend.services.ai.mode_manager import _BASE as prompt
    else:
        from prompts import _CORE_IDENTITY as prompt
    low = prompt.lower()
    assert "how are you" in low, f"{source}: missing 'how are you' example"
    assert "doing good" in low,   f"{source}: missing 'doing good' reply example"
    assert "what are you" in low, f"{source}: missing 'what are you' identity example"
    assert "i'm korvixai" in low, f"{source}: missing 'I'm KorvixAI' self-id example"


@pytest.mark.parametrize("source", ["_BASE", "_CORE_IDENTITY"])
def test_mixed_language_example_present(source):
    """At least one mixed Turkish/English example so the model knows to
    mirror the user's mix rather than normalize to one language."""
    if source == "_BASE":
        from backend.services.ai.mode_manager import _BASE as prompt
    else:
        from prompts import _CORE_IDENTITY as prompt
    low = prompt.lower()
    # The canonical mixed example from the spec.
    assert "hey, sen nasil yapiyorsun" in low or "mixed" in low, \
        f"{source}: lost the mixed-language example / signal"


@pytest.mark.parametrize("source", ["_BASE", "_CORE_IDENTITY"])
def test_no_blanket_language_mixing_ban(source):
    """The old persona had a blanket 'Ingilizce-Turkce karistirmak' (don't
    mix English-Turkish) rule in YASAK. Phase 8b's DIL block explicitly
    instructs the model to mirror the user's mix when they mix — those
    two rules directly contradict each other. The blanket ban must be
    replaced by a conditional one ('don't mix UNLESS the user does').

    Regression for Bugbot High eda11479."""
    if source == "_BASE":
        from backend.services.ai.mode_manager import _BASE as prompt
    else:
        from prompts import _CORE_IDENTITY as prompt
    low = prompt.lower()
    # The exact old phrasings — neither in Turkish-dash nor space form
    # may appear as a bare bullet anywhere in the prompt.
    blanket_bans = [
        "ingilizce-turkce karistirmak",
        "ingilizce turkce karistirmak",
    ]
    for ban in blanket_bans:
        # The phrase may appear inside a longer explanatory sentence
        # (e.g. "Kullanici tek dilde yazdiysa rastgele baska dili
        # karistirmak.") — that's fine. The bug is when it appears
        # as a bullet/declaration with no "tek dilde" / "unless"
        # qualifier nearby. Heuristic: find the phrase, then check
        # the preceding 80 chars on the same line for a qualifier.
        idx = low.find(ban)
        if idx == -1:
            continue
        line_start = low.rfind("\n", 0, idx) + 1
        before = low[line_start:idx]
        if "tek dilde" in before or "unless" in before or "kullanici" in before:
            continue   # qualified — OK
        pytest.fail(
            f"{source} contains a blanket language-mixing ban: {ban!r}. "
            f"Phase 8b requires mirroring the user's mix, so the ban "
            f"must be conditional ('don't mix UNLESS the user does')."
        )


@pytest.mark.parametrize("source", ["_BASE", "_CORE_IDENTITY"])
def test_korvixai_returning_user_example_present(source):
    """The 'kendi ai gelistiriyorum' → 'KorvixAI tarafinda mi …' pattern
    is the canonical returning-user example. Phase 8b refreshed the
    phrasing — pin both pieces (input + the KorvixAI recognition)."""
    if source == "_BASE":
        from backend.services.ai.mode_manager import _BASE as prompt
    else:
        from prompts import _CORE_IDENTITY as prompt
    low = prompt.lower()
    assert "kendi ai" in low or "kendi yapay zeka" in low, \
        f"{source}: missing 'kendi (yapay zeka|ai)' input example"
    assert "korvixai" in low, \
        f"{source}: missing 'KorvixAI' recognition in the example"
