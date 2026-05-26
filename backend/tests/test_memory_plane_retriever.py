# coding: utf-8
"""
Phase 6 — MemoryRetriever ranking tests.

The retriever is the single semantic-ready abstraction over the SQL
store. These tests pin down the ranking contract so the future
embedding-cosine layer can replace `_text_overlap` without changing
the public behaviour.
"""
from __future__ import annotations

import pytest

from backend.services.memory_plane import (
    MemoryRecord, MemoryQuery,
    IMPORTANCE_DEFAULT, IMPORTANCE_HIGH, IMPORTANCE_LOW,
)
from backend.services.memory_plane import store as mp_store
from backend.services.memory_plane.retriever import retriever


def _seed(user_id: str, **kwargs) -> MemoryRecord:
    """Insert one row, fill in required defaults."""
    return mp_store.insert(MemoryRecord(user_id=user_id, **kwargs))


# ── No-query path returns SQL ordering ───────────────────────────────────────

def test_search_no_query_returns_sql_order(tmp_memory_plane_db):
    _seed("u1", content="low",  importance=IMPORTANCE_LOW)
    _seed("u1", content="high", importance=IMPORTANCE_HIGH)
    out = retriever.search(MemoryQuery(user_id="u1"))
    assert [r.content for r in out] == ["high", "low"]


# ── Free-text query path runs the ranker ─────────────────────────────────────

def test_search_text_boosts_token_overlap(tmp_memory_plane_db):
    """Text-overlap should outweigh importance when importances are
    similar — that's the whole point of search."""
    _seed("u1", content="vercel deploy config", importance=0.5)
    _seed("u1", content="trading strategy notes", importance=0.5)
    out = retriever.search(MemoryQuery(user_id="u1", query="vercel deploy"))
    assert len(out) == 2
    # Most relevant first.
    assert out[0].content == "vercel deploy config"


def test_search_text_high_importance_overrides_low_match(tmp_memory_plane_db):
    """A weak match on a HIGH-importance row beats a stronger match
    on a near-trivial row — the composite score wins."""
    _seed("u1", content="critical key fact about trading", importance=IMPORTANCE_HIGH)
    _seed("u1", content="trading trading trading",         importance=0.1)
    out = retriever.search(MemoryQuery(user_id="u1", query="trading"))
    # Both should appear; HIGH importance should rank first.
    assert out[0].content == "critical key fact about trading"


# ── Filters are forwarded ────────────────────────────────────────────────────

def test_search_kind_filter(tmp_memory_plane_db):
    _seed("u1", content="a", kind="fact")
    _seed("u1", content="b", kind="preference")
    out = retriever.search(MemoryQuery(user_id="u1", kind="preference"))
    assert [r.kind for r in out] == ["preference"]


def test_search_project_filter(tmp_memory_plane_db):
    _seed("u1", content="a", project_id="p1")
    _seed("u1", content="b", project_id="p2")
    out = retriever.search(MemoryQuery(user_id="u1", project_id="p2"))
    assert [r.project_id for r in out] == ["p2"]


def test_search_agent_filter(tmp_memory_plane_db):
    _seed("u1", content="a", agent_id="alpha")
    _seed("u1", content="b", agent_id="beta")
    out = retriever.search(MemoryQuery(user_id="u1", agent_id="beta"))
    assert [r.agent_id for r in out] == ["beta"]


# ── top_for_context convenience ──────────────────────────────────────────────

def test_top_for_context_returns_at_most_n(tmp_memory_plane_db):
    for i in range(10):
        _seed("u1", content=f"fact {i}", importance=0.5)
    out = retriever.top_for_context("u1", limit=3)
    assert len(out) == 3


def test_top_for_context_zero_user_returns_empty(tmp_memory_plane_db):
    assert retriever.top_for_context("") == []
    assert retriever.top_for_context(None) == []   # type: ignore[arg-type]
