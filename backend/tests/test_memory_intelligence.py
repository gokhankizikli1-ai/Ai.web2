# coding: utf-8
"""
Phase 8c — Memory Intelligence v1 tests.

Coverage:
  - Feature-flag no-op contract (all writes/reads return empty when off)
  - Roundtrip via the public client when flag is on
  - Heuristic extractor: KorvixAI mention, "kendi AI", English "I'm building"
  - Redaction: secrets / API keys / emails short-circuit extraction
  - Per-user isolation (no leakage across user_ids)
  - Per-user cap enforced (LRU eviction)
  - Dedup: identical recent records skipped
  - "No hallucinated memory" — empty user → empty snippets
"""
from __future__ import annotations

import pytest

from backend.services.memory_intelligence import (
    is_enabled,
    record,
    extract_and_record,
    fetch_snippets,
    clear,
    MemoryRecord,
)
from backend.services.memory_intelligence import store as mem_store
from backend.services.memory_intelligence import extractor as mem_extractor


@pytest.fixture(autouse=True)
def _reset_store():
    """Every test starts with an empty store."""
    mem_store._reset_for_tests()
    yield
    mem_store._reset_for_tests()


@pytest.fixture
def memory_on(monkeypatch):
    """Enable the feature flag for the duration of a test."""
    monkeypatch.setenv("ENABLE_MEMORY_INTELLIGENCE", "true")


# ── Feature-flag contract ───────────────────────────────────────────────

def test_flag_off_record_is_no_op(monkeypatch):
    monkeypatch.delenv("ENABLE_MEMORY_INTELLIGENCE", raising=False)
    assert is_enabled() is False
    r = record("u1", "project", "test fact")
    assert r is None
    assert fetch_snippets("u1") == []


def test_flag_off_extract_is_no_op(monkeypatch):
    monkeypatch.delenv("ENABLE_MEMORY_INTELLIGENCE", raising=False)
    assert extract_and_record("u1", "Kendi ai mi gelistiriyorum") == []
    assert fetch_snippets("u1") == []


def test_flag_off_clear_returns_zero(monkeypatch):
    monkeypatch.delenv("ENABLE_MEMORY_INTELLIGENCE", raising=False)
    assert clear("u1") == 0


def test_flag_flip_is_observed_without_restart(monkeypatch):
    """Phase 6b dynamic-env pattern — flipping the flag mid-process
    must take effect on the very next call."""
    monkeypatch.delenv("ENABLE_MEMORY_INTELLIGENCE", raising=False)
    assert is_enabled() is False
    monkeypatch.setenv("ENABLE_MEMORY_INTELLIGENCE", "true")
    assert is_enabled() is True
    monkeypatch.setenv("ENABLE_MEMORY_INTELLIGENCE", "false")
    assert is_enabled() is False


# ── Roundtrip ───────────────────────────────────────────────────────────

def test_record_then_fetch(memory_on):
    r = record("u1", "project", "Kullanici KorvixAI projesini gelistiriyor")
    assert isinstance(r, MemoryRecord)
    snippets = fetch_snippets("u1")
    assert snippets == ["Kullanici KorvixAI projesini gelistiriyor"]


def test_fetch_returns_most_recent_n(memory_on):
    for i in range(5):
        record("u1", "fact", f"fact {i}")
    snippets = fetch_snippets("u1", limit=3)
    assert snippets == ["fact 2", "fact 3", "fact 4"]


def test_users_are_isolated(memory_on):
    record("alice", "project", "Alice fact")
    record("bob",   "project", "Bob fact")
    assert fetch_snippets("alice") == ["Alice fact"]
    assert fetch_snippets("bob")   == ["Bob fact"]


def test_empty_user_returns_empty_snippets(memory_on):
    assert fetch_snippets("never-seen") == []


def test_clear_removes_user_records(memory_on):
    record("u1", "fact", "a"); record("u1", "fact", "b")
    assert len(fetch_snippets("u1", limit=10)) == 2
    n = clear("u1")
    assert n == 2
    assert fetch_snippets("u1") == []


def test_invalid_kind_rejected(memory_on):
    r = record("u1", "not-a-real-kind", "test")
    assert r is None
    assert fetch_snippets("u1") == []


def test_blank_user_id_rejected(memory_on):
    assert record("", "fact", "x") is None
    assert record("   ", "fact", "x") is None


# ── Dedup + cap ─────────────────────────────────────────────────────────

def test_recent_duplicates_skipped(memory_on):
    """The store skips an identical (kind, text) row when the same
    one appears in the last 5 records — so a chatty user mentioning
    KorvixAI five times doesn't fill their slot with duplicates."""
    for _ in range(5):
        record("u1", "project", "KorvixAI")
    assert len(fetch_snippets("u1", limit=10)) == 1


def test_per_user_cap_evicts_oldest(memory_on):
    """When the cap is hit, OLDEST records evict. We write 60 distinct
    rows; the cap is 50; fetching all should return the most-recent 50."""
    for i in range(60):
        record("u1", "fact", f"row {i:03d}")
    snippets = fetch_snippets("u1", limit=100)
    # We get the most-recent 50 (oldest 10 evicted).
    assert len(snippets) == mem_store.MAX_RECORDS_PER_USER
    assert snippets[0]  == "row 010"
    assert snippets[-1] == "row 059"


# ── Extractor heuristics ────────────────────────────────────────────────

@pytest.mark.parametrize("message", [
    "Kendi ai mi gelistiriyorum",
    "Kendi yapay zekamı geliştiriyorum",
    "Aslinda kendi ai projem var",
])
def test_extractor_catches_kendi_ai_patterns(memory_on, message):
    out = extract_and_record("u1", message)
    assert any(r.kind == "project" for r in out)
    snippets = fetch_snippets("u1")
    assert any("kendi yapay zeka projesi" in s.lower() for s in snippets)


def test_extractor_catches_korvixai_mention(memory_on):
    out = extract_and_record("u1", "KorvixAI çok hoş bir isim olmuş.")
    assert any(r.kind == "project" for r in out)
    assert "KorvixAI" in fetch_snippets("u1")[0]


def test_extractor_catches_english_building(memory_on):
    out = extract_and_record("u1", "I'm building a sentiment analyzer for crypto.")
    assert any(r.kind == "project" for r in out)
    s = fetch_snippets("u1")[0]
    assert "sentiment analyzer" in s


def test_extractor_no_match_no_record(memory_on):
    """Random chit-chat must NOT create memory rows."""
    out = extract_and_record("u1", "Selam, bugün hava güzel.")
    assert out == []
    assert fetch_snippets("u1") == []


# ── Redaction / safety ──────────────────────────────────────────────────

@pytest.mark.parametrize("hostile", [
    "My password: hunter2 and I'm building a great app",
    "api_key=sk-abcdef0123456789abcdef0123456789",
    "Reach me at alice@example.com — kendi ai gelistiriyorum",
    "Bearer eyJhbGciOiJIUzI1NiJ9.fakefakefakefakefake",
    "Card: 4111 1111 1111 1111 — I'm building stuff",
])
def test_redaction_short_circuits_extraction(memory_on, hostile):
    """When a message contains a secret marker, the extractor must
    refuse to persist ANYTHING — including high-signal project
    snippets in the SAME message. Failing closed protects the user
    even at the cost of missing a memory."""
    out = extract_and_record("u1", hostile)
    assert out == []
    assert fetch_snippets("u1") == []


def test_oversized_message_skipped(memory_on):
    """Messages over 4000 chars are ignored — protects against accidental
    full-document paste blowing up the store."""
    out = extract_and_record("u1", "korvixai " + "x " * 3000)
    assert out == []


# ── Direct extractor unit tests ─────────────────────────────────────────
# These don't require the flag (extractor itself is pure logic).

def test_extractor_module_handles_non_string():
    assert mem_extractor.extract(None) == []          # type: ignore[arg-type]
    assert mem_extractor.extract(123)  == []          # type: ignore[arg-type]
    assert mem_extractor.extract([])   == []          # type: ignore[arg-type]


def test_extractor_module_handles_empty():
    assert mem_extractor.extract("") == []
    assert mem_extractor.extract("   ") == []


# ── Snippet bridge: works with personality.build_short_context_block ────

def test_snippets_feed_cleanly_into_personality_block(memory_on):
    """The whole point of fetch_snippets() is to feed the personality
    layer's [KISA BAGLAM] block. Pin the contract."""
    from backend.services.personality import build_short_context_block

    record("u1", "project", "Kullanici KorvixAI projesini gelistiriyor")
    record("u1", "project", "Daha once trading sinyallerinden bahsetti")

    snippets = fetch_snippets("u1")
    block = build_short_context_block(
        recent_user_messages=["Bugun ne yapacagiz?"],
        memory_snippets=snippets,
    )
    assert "[KISA BAGLAM]" in block
    assert "KorvixAI" in block
    assert "trading sinyallerinden" in block
