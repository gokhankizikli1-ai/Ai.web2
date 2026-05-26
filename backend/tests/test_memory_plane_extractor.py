# coding: utf-8
"""
Phase 6 — Heuristic extractor tests.

Covers:
  * KorvixAI / Turkish kendi-AI / English "I'm building" patterns
  * Preference + decision + relationship + task-outcome patterns
  * Secret-redaction guard (passwords, OpenAI/Anthropic/AWS/GitHub keys, JWTs, email, card)
  * Bounded output (cap, min length, dedup-within-message)
  * `score_importance` heuristic
"""
from __future__ import annotations

import pytest

from backend.services.memory_plane.extractor import (
    extract, contains_secret_content, score_importance,
    ExtractionCandidate,
)
from backend.services.memory_plane.types import (
    IMPORTANCE_DEFAULT, IMPORTANCE_HIGH, IMPORTANCE_LOW,
)


# ── KorvixAI / project / building patterns ───────────────────────────────────

def test_extract_korvixai_high_importance():
    out = extract("Working on KorvixAI all weekend.")
    assert len(out) == 1
    assert out[0].kind == "fact"
    assert "KorvixAI" in out[0].content
    assert out[0].importance == IMPORTANCE_HIGH


def test_extract_turkish_own_ai():
    out = extract("Ben kendi yapay zekamı geliştiriyorum")
    assert any(c.metadata.get("pattern") == "tr_own_ai" for c in out)


def test_extract_english_building():
    out = extract("I'm building a new ecommerce store with Shopify")
    targets = [c for c in out if c.metadata.get("pattern") == "en_building"]
    assert len(targets) == 1
    assert "ecommerce store" in targets[0].content.lower()


def test_extract_preference():
    out = extract("I prefer short and direct replies, please")
    prefs = [c for c in out if c.kind == "preference"]
    assert len(prefs) >= 1
    assert "short and direct" in prefs[0].content.lower()


def test_extract_decision_high_importance():
    out = extract("We decided to use Vercel for the frontend deploys")
    decs = [c for c in out if c.kind == "decision"]
    assert len(decs) == 1
    assert decs[0].importance == IMPORTANCE_HIGH


def test_extract_relationship_is():
    out = extract("Mehmet is the CFO of the company")
    rels = [c for c in out if c.kind == "relationship"]
    assert any("CFO" in c.content for c in rels)


def test_extract_relationship_at():
    out = extract("Alice works at Anthropic now")
    rels = [c for c in out if c.kind == "relationship"]
    assert any("Anthropic" in c.content for c in rels)


def test_extract_task_outcome():
    out = extract("We shipped the new pricing page yesterday")
    tasks = [c for c in out if c.kind == "task_outcome"]
    assert len(tasks) == 1


def test_extract_task_outcome_assistant_role_is_lower_importance():
    out_user      = extract("We shipped feature X", role="user")
    out_assistant = extract("We shipped feature X", role="assistant")
    u_score = next(c.importance for c in out_user if c.kind == "task_outcome")
    a_score = next(c.importance for c in out_assistant if c.kind == "task_outcome")
    assert a_score < u_score
    assert a_score == IMPORTANCE_LOW


# ── Secret-redaction guard ───────────────────────────────────────────────────

@pytest.mark.parametrize("secret", [
    "password=hunter2",
    "parola = abc",
    "sifre: xyz",
    "api_key = abc123",
    "Authorization: Bearer abcdef1234567890",
    "key sk-abcdefghijklmnopqrstuvwxyz0123456789",
    "key sk-ant-abcdefghijklmnop0123456789",
    "token ghp_abcdefghijklmnopqrstuvwxyz12345",
    "AKIAIOSFODNN7EXAMPLE",
    "AIzaSyDdI0hCZtE6vySjMm-WEfRq1234567890123",
    "eyJabcdefghij.eyJzdWIiOiIxMjMifQ.abcdefghijklmn",
    "contact me at user@example.com",
    "card 4111-1111-1111-1111",
])
def test_contains_secret_content_blocks(secret):
    assert contains_secret_content(secret) is True
    # The full pipeline should also skip extraction on these messages.
    assert extract(secret) == []


def test_contains_secret_content_negative():
    assert contains_secret_content("just a normal sentence") is False


# ── Boundary conditions ──────────────────────────────────────────────────────

def test_extract_empty_returns_empty():
    assert extract("") == []
    assert extract("   ") == []


def test_extract_non_string_returns_empty():
    assert extract(None) == []        # type: ignore[arg-type]
    assert extract(12345) == []       # type: ignore[arg-type]


def test_extract_huge_input_short_circuits():
    huge = "x" * 10_000
    assert extract(huge) == []


def test_extract_deduplicates_within_message():
    # KorvixAI mentioned multiple times → still ONE KorvixAI candidate.
    out = extract("KorvixAI rocks. I love KorvixAI. KorvixAI forever.")
    korvix = [c for c in out if c.metadata.get("pattern") == "korvixai"]
    assert len(korvix) == 1


# ── score_importance ─────────────────────────────────────────────────────────

def test_score_importance_default():
    assert score_importance("just a fact") == IMPORTANCE_DEFAULT


def test_score_importance_bump_for_important():
    s = score_importance("This is critical to remember about the deploy")
    assert s > IMPORTANCE_DEFAULT


def test_score_importance_dip_for_acknowledgement():
    s = score_importance("ok")
    assert s < IMPORTANCE_DEFAULT


def test_score_importance_korvixai_bump():
    s = score_importance("notes for KorvixAI")
    assert s > IMPORTANCE_DEFAULT


def test_score_importance_clamps():
    # Synthetic content that should accumulate well over 1.0 before clamping.
    s = score_importance("critical: must remember the KorvixAI shipped decision")
    assert 0.0 <= s <= 1.0
