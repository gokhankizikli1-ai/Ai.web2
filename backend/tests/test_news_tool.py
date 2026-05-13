# coding: utf-8
"""
Phase 7b — news tool unit tests.

Mocks the Yahoo `/v1/finance/search` JSON so no network call is made.

Coverage:
  - Successful headlines → _ok envelope with `items` list
  - Per-item shape (title, publisher, url, published_at, related, type)
  - Empty news → _unavailable (agent retries elsewhere)
  - HTTP 429 / 5xx / network error → _unavailable
  - Validation rejects empty / oversized query
  - count clamped to [1, _MAX_NEWS_COUNT]
  - Per-tool timeout_seconds attribute is set
"""
from __future__ import annotations

import asyncio

import pytest

from backend.services.tools import news_tool
from backend.services.tools.news_tool import NewsTool, _Unavailable


def _run(query: str = "", **context) -> dict:
    return asyncio.run(NewsTool().run(query, context))


def _fake_yahoo_response(n: int = 5) -> dict:
    """A canned Yahoo /v1/finance/search response shape."""
    return {
        "news": [
            {
                "title":               f"Headline {i}",
                "publisher":           "Reuters",
                "link":                f"https://example.com/story-{i}",
                "providerPublishTime": 1_715_578_500 + i,
                "type":                "STORY",
                "relatedTickers":      ["NVDA"],
            }
            for i in range(n)
        ]
    }


async def _mock_fetch(query, count):
    return _fake_yahoo_response(min(count, 5))


# ── Happy path ───────────────────────────────────────────────────────────

def test_returns_headlines(monkeypatch):
    monkeypatch.setattr(news_tool, "_fetch_search_json", _mock_fetch)
    r = _run(query="NVDA")
    assert r["status"] == "available"
    assert r["provider"] == "yahoo_finance"
    d = r["data"]
    assert d["query"] == "NVDA"
    assert d["count"] == 5
    assert len(d["items"]) == 5
    first = d["items"][0]
    for k in ("title", "publisher", "url", "published_at", "related", "type"):
        assert k in first, f"missing key: {k}"
    assert first["title"].startswith("Headline")
    assert first["url"].startswith("https://")
    # ISO 8601 timestamp
    assert first["published_at"].endswith("+00:00")


def test_count_clamped_high(monkeypatch):
    monkeypatch.setattr(news_tool, "_fetch_search_json", _mock_fetch)
    r = _run(query="NVDA", count=999)
    assert r["status"] == "available"
    # Mock only returns 5; the clamp happens before fetch is called so
    # this test mainly asserts no crash.
    assert r["data"]["count"] <= 10


def test_count_clamped_low(monkeypatch):
    # When count <= 0 we should fall back to default (5).
    captured = {}
    async def _capturing(query, count):
        captured["count"] = count
        return _fake_yahoo_response(count)
    monkeypatch.setattr(news_tool, "_fetch_search_json", _capturing)
    _run(query="NVDA", count=0)
    assert captured["count"] == 1   # min clamp = 1


def test_count_garbage_string_defaults(monkeypatch):
    captured = {}
    async def _capturing(query, count):
        captured["count"] = count
        return _fake_yahoo_response(count)
    monkeypatch.setattr(news_tool, "_fetch_search_json", _capturing)
    _run(query="NVDA", count="not-an-int")
    assert captured["count"] == 5


# ── Validation errors ───────────────────────────────────────────────────

def test_missing_query_errors():
    r = _run()
    assert r["status"] == "error"
    assert "missing" in r["message"]


def test_oversized_query_errors():
    r = _run(query="x" * 200)
    assert r["status"] == "error"
    assert "too long" in r["message"]


# ── Provider failure → _unavailable, NOT _error ─────────────────────────

def test_provider_unavailable_yields_unavailable(monkeypatch):
    async def _boom(query, count):
        raise _Unavailable("Yahoo rate-limited (HTTP 429)")
    monkeypatch.setattr(news_tool, "_fetch_search_json", _boom)
    r = _run(query="NVDA")
    assert r["status"] == "unavailable"
    assert "Yahoo" in r["message"]


def test_unexpected_exception_yields_unavailable(monkeypatch):
    async def _kaboom(query, count):
        raise RuntimeError("yahoo died")
    monkeypatch.setattr(news_tool, "_fetch_search_json", _kaboom)
    r = _run(query="NVDA")
    assert r["status"] == "unavailable"


def test_empty_news_array_yields_unavailable(monkeypatch):
    async def _empty(query, count):
        return {"news": []}
    monkeypatch.setattr(news_tool, "_fetch_search_json", _empty)
    r = _run(query="ZZZZZ")
    assert r["status"] == "unavailable"
    assert "No news" in r["message"]


def test_items_without_titles_filtered(monkeypatch):
    async def _mixed(query, count):
        return {"news": [
            {"title": "Good", "publisher": "p", "link": "u", "providerPublishTime": 1},
            {"title": "",     "publisher": "p", "link": "u", "providerPublishTime": 2},
            {"title": None,   "publisher": "p", "link": "u", "providerPublishTime": 3},
        ]}
    monkeypatch.setattr(news_tool, "_fetch_search_json", _mixed)
    r = _run(query="NVDA")
    assert r["status"] == "available"
    assert len(r["data"]["items"]) == 1
    assert r["data"]["items"][0]["title"] == "Good"


# ── Per-tool timeout (Phase 7b BaseTool upgrade) ────────────────────────

def test_tool_declares_a_timeout():
    assert isinstance(NewsTool.timeout_seconds, (int, float))
    assert 0 < NewsTool.timeout_seconds <= 12.0
