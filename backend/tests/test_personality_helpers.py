# coding: utf-8
"""
Phase 8 — vibe detector + context builder unit tests.

Pure-logic helpers; no LLM, no I/O. These tests pin down the dict
shape returned by `detect_vibe` and the string format produced by
`build_short_context_block` so a future personality-tuning edit
can't silently change either contract.
"""
from __future__ import annotations

import pytest

from backend.services.personality import detect_vibe, build_short_context_block


# ── detect_vibe ──────────────────────────────────────────────────────────

def test_empty_input_returns_neutral_unknowns():
    v = detect_vibe([])
    assert v == {
        "tone":      "neutral",
        "length":    "unknown",
        "emoji_use": "none",
        "lang":      "unknown",
    }


def test_short_casual_turkish_with_emoji():
    v = detect_vibe([
        "Selam ya 😄",
        "naber abi",
        "valla iyiyim",
    ])
    assert v["tone"]      == "casual"
    assert v["length"]    == "short"
    assert v["emoji_use"] in ("rare", "frequent")
    assert v["lang"]      == "tr"


def test_long_formal_english_no_emoji():
    long_text = (
        "I would like to request a detailed technical analysis covering the "
        "specifics of the proposed architectural changes including their "
        "trade-offs and any second-order effects across the system."
    )
    v = detect_vibe([long_text])
    assert v["length"]    == "long"
    assert v["emoji_use"] == "none"
    assert v["tone"]      == "neutral"   # no formal/casual Turkish tokens
    assert v["lang"]      == "en"


def test_formal_turkish_signals():
    v = detect_vibe([
        "Iyi gunler dilerim, rica ederim bir konuda yardiminizi rica edebilir miyim?",
        "Tesekkur ederim, saygilarimla.",
    ])
    assert v["tone"] == "formal"
    assert v["lang"] == "tr"


def test_medium_length_bucket():
    v = detect_vibe([
        "Bu hafta market durumuyla ilgili kisa bir gozlem yazmamiz lazim galiba",
    ])
    assert v["length"] == "medium"


def test_emoji_frequency_buckets():
    rare   = detect_vibe(["Selam 😄 sade bir mesaj"])
    none   = detect_vibe(["Selam, sade bir mesaj"])
    many   = detect_vibe(["😄😎🚀 cok hava attim", "🔥 yine 🔥"])
    assert rare["emoji_use"]  == "rare"
    assert none["emoji_use"]  == "none"
    assert many["emoji_use"]  == "frequent"


def test_whitespace_and_non_string_filtered():
    v = detect_vibe(["", "   ", None, 123, "Selam ya 😄"])    # type: ignore[list-item]
    # Only the last entry survives — short, casual, tr, 1 emoji.
    assert v["length"]    == "short"
    assert v["tone"]      == "casual"
    assert v["emoji_use"] == "rare"


# ── build_short_context_block ────────────────────────────────────────────

def test_empty_inputs_return_empty_string():
    assert build_short_context_block() == ""
    assert build_short_context_block(recent_user_messages=[], memory_snippets=[]) == ""


def test_block_with_recent_messages_includes_vibe():
    block = build_short_context_block(
        recent_user_messages=["Selam ya 😄", "naber abi"],
    )
    assert "[KISA BAGLAM]" in block
    assert "vibe" in block.lower()
    assert "casual" in block
    assert "short" in block


def test_block_with_memory_snippets_formatted():
    block = build_short_context_block(
        memory_snippets=[
            "Kullanici KorvixAI projesini gelistiriyor",
            "Daha once trading sinyallerinden bahsetti",
        ],
    )
    assert "Onceki konularda gectikleri" in block
    assert "KorvixAI" in block
    assert "trading sinyallerinden" in block


def test_block_caps_memory_snippets_at_three():
    snippets = [f"Fact number {i}" for i in range(10)]
    block = build_short_context_block(memory_snippets=snippets)
    # 3 cap → bullet count = 3.
    assert block.count("\n  • ") == 3


def test_block_truncates_long_snippets():
    long = "Cok cok cok uzun bir bilgi " * 20    # ~480 chars
    block = build_short_context_block(memory_snippets=[long])
    # Truncation marker present, total snippet length bounded.
    assert "…" in block
    # 120-char cap + bullet prefix ≈ 124 chars on that line.
    for line in block.splitlines():
        assert len(line) <= 150


def test_block_already_greeted_signal():
    block = build_short_context_block(already_greeted=True)
    assert "Selami zaten verdin" in block
    assert "Merhaba" in block


def test_block_handles_garbage_snippet_types_gracefully():
    block = build_short_context_block(
        memory_snippets=[None, 42, "", "   ", "Gercek bilgi"],   # type: ignore[list-item]
    )
    # Only the real string survives.
    assert "Gercek bilgi" in block
    assert "None" not in block
    assert "42" not in block


def test_block_returns_terminated_string():
    block = build_short_context_block(
        recent_user_messages=["Selam ya 😄"],
    )
    assert block.endswith("\n")


# ── snapshot tests on the prompts that teach the model the format ───────

def test_base_prompt_documents_kisa_baglam_format():
    """The system prompt must describe the [KISA BAGLAM] header so the
    model knows what to do when the chat orchestrator prepends one."""
    from backend.services.ai.mode_manager import _BASE
    assert "[KISA BAGLAM]" in _BASE
    assert "HAFIZA" in _BASE
    # The hallucination guard must be present too.
    low = _BASE.lower()
    assert "blokta olmayan" in low, "_BASE lost the hallucination guard"


def test_base_prompt_includes_korvixai_example():
    """Concrete example pin: the 'kendi ai mi gelistiriyorum' →
    'KorvixAI icin mi calisiyorsun yine?' pattern from the user spec."""
    from backend.services.ai.mode_manager import _BASE
    assert "kendi ai mi gelistiriyorum" in _BASE.lower()
    assert "korvixai" in _BASE.lower()


def test_legacy_core_identity_documents_format():
    """The legacy chat path uses prompts.py — its persona must teach
    the same [KISA BAGLAM] format so both code paths agree."""
    from prompts import _CORE_IDENTITY
    assert "[KISA BAGLAM]" in _CORE_IDENTITY
    assert "HAFIZA" in _CORE_IDENTITY


# ── Token-tuple hygiene (Bugbot Medium regression guard) ────────────────
# `joined.count(tok) for tok in _TOKENS` double-counts when:
#   1. The tuple contains the same token twice ("iyi gunler" + "iyi gunler")
#   2. One token is a substring of another ("iyi gunler" inside
#      "iyi gunler dilerim").
# Both inflate the tone score and bias detection.

@pytest.mark.parametrize("attr", ["_CASUAL_TOKENS", "_FORMAL_TOKENS", "_TURKISH_WORD_HINTS"])
def test_token_tuples_are_clean(attr):
    from backend.services.personality import vibe_detector as vd
    tokens = getattr(vd, attr)

    # No duplicates.
    assert len(tokens) == len(set(tokens)), \
        f"{attr} contains duplicate tokens: {sorted(set(t for t in tokens if tokens.count(t) > 1))}"

    # No token is a substring of another in the same tuple.
    sorted_tokens = sorted(tokens, key=len)
    for i, small in enumerate(sorted_tokens):
        for big in sorted_tokens[i + 1:]:
            assert small not in big, (
                f"{attr}: {small!r} is a substring of {big!r}. "
                f"Both would match the same user text, double-counting."
            )


def test_formal_score_not_inflated_by_duplicates():
    """A single 'iyi gunler dilerim' must contribute at most 1 to the
    formal score, not 3. Regression for Bugbot Medium
    3674cd42-5f77-4a37-a49c-a089f33fea8b."""
    v = detect_vibe([
        "Iyi gunler dilerim, bir soru var.",
        "Selam ya kanka",       # one strong casual signal
    ])
    # With the deduped tokens, casual should win or at least not lose
    # to a single formal salutation.
    assert v["tone"] in ("casual", "neutral"), \
        f"Single 'iyi gunler dilerim' is now over-counted as formal: {v}"
