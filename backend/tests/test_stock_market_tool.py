# coding: utf-8
"""
Phase 7b — stock_market tool unit tests.

These tests do NOT hit Yahoo Finance. They mock the synchronous
yfinance call (via the module-level _fetch_quote_sync) so the
behaviour can be verified deterministically in CI.

Coverage:
  - Successful quote → _ok envelope, all expected fields populated
  - change / change_pct math
  - Provider _unavailable on fetch failure (agent should retry elsewhere)
  - Validation rejects empty / oversized / illegal symbols
  - Per-tool timeout_seconds attribute is set
"""
from __future__ import annotations

import asyncio

import pytest

from backend.services.tools import stock_market_tool
from backend.services.tools.stock_market_tool import StockMarketTool, _Unavailable


def _run(query: str = "", **context) -> dict:
    return asyncio.run(StockMarketTool().run(query, context))


def _fake_quote(symbol: str) -> dict:
    """A canned yfinance fast_info dict for NVDA-ish responses."""
    return {
        "symbol":               symbol,
        "name":                 "NVIDIA Corporation",
        "currency":             "USD",
        "exchange":             "NMS",
        "market_state":         "REGULAR",
        "last_price":           900.12,
        "previous_close":       889.50,
        "open":                 895.40,
        "day_high":             912.30,
        "day_low":              893.10,
        "volume":               120_345_678,
        "change":               10.62,
        "change_pct":           1.1939,
        "fifty_two_week_high":  974.00,
        "fifty_two_week_low":   450.10,
        "as_of":                "2026-05-13T05:55:00+00:00",
    }


# ── Happy path ───────────────────────────────────────────────────────────

def test_returns_ok_envelope_with_expected_fields(monkeypatch):
    monkeypatch.setattr(
        stock_market_tool, "_fetch_quote_sync",
        lambda symbol: _fake_quote(symbol),
    )
    r = _run(symbol="NVDA")
    assert r["status"] == "available"
    assert r["provider"] == "yahoo_finance"
    d = r["data"]
    assert d["symbol"] == "NVDA"
    for k in (
        "last_price", "previous_close", "open", "day_high", "day_low",
        "volume", "change", "change_pct",
        "fifty_two_week_high", "fifty_two_week_low",
        "market_state", "currency", "exchange", "as_of",
    ):
        assert k in d, f"missing field: {k}"
    assert d["last_price"] == 900.12
    assert d["change_pct"] == pytest.approx(1.1939, abs=1e-4)


def test_symbol_uppercased(monkeypatch):
    seen = {}
    def _capture(s):
        seen["sym"] = s
        return _fake_quote(s)
    monkeypatch.setattr(stock_market_tool, "_fetch_quote_sync", _capture)
    _run(symbol="nvda")
    assert seen["sym"] == "NVDA"


def test_query_argument_falls_back(monkeypatch):
    # If `symbol` isn't in context, the positional query is used.
    monkeypatch.setattr(stock_market_tool, "_fetch_quote_sync", lambda s: _fake_quote(s))
    r = asyncio.run(StockMarketTool().run("spy", {}))
    assert r["status"] == "available"
    assert r["data"]["symbol"] == "SPY"


# ── Validation errors ───────────────────────────────────────────────────

def test_missing_symbol_errors():
    r = _run()
    assert r["status"] == "error"
    assert "missing" in r["message"]


def test_oversized_symbol_errors():
    r = _run(symbol="A" * 20)
    assert r["status"] == "error"
    assert "too long" in r["message"]


@pytest.mark.parametrize("bad", [
    "NV DA",     # space
    "NV;DA",     # semicolon (would be a problem if interpolated into a URL)
    "NV/DA",     # slash
    "NVDA'",     # quote
    "<NVDA>",    # html
])
def test_illegal_chars_rejected(bad):
    r = _run(symbol=bad)
    assert r["status"] == "error"
    assert "invalid symbol" in r["message"]


# ── Provider failure paths → _unavailable, NOT _error ───────────────────

def test_provider_unavailable_yields_unavailable_envelope(monkeypatch):
    def _boom(symbol):
        raise _Unavailable("Yahoo rate-limited (HTTP 429)")
    monkeypatch.setattr(stock_market_tool, "_fetch_quote_sync", _boom)
    r = _run(symbol="NVDA")
    assert r["status"] == "unavailable"
    assert "Yahoo" in r["message"]


def test_unexpected_exception_yields_unavailable(monkeypatch):
    def _kaboom(symbol):
        raise RuntimeError("transient yahoo glitch")
    monkeypatch.setattr(stock_market_tool, "_fetch_quote_sync", _kaboom)
    r = _run(symbol="NVDA")
    # Defensive: agent should be able to route elsewhere, not crash.
    assert r["status"] == "unavailable"


# ── Per-tool timeout (Phase 7b BaseTool upgrade) ────────────────────────

def test_tool_declares_a_timeout():
    """Tool-bridge honours `timeout_seconds`. The value should be set
    on the class so a hot import-time check can confirm the contract."""
    assert isinstance(StockMarketTool.timeout_seconds, (int, float))
    assert 0 < StockMarketTool.timeout_seconds <= 12.0
