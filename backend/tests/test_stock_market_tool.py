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


# ── Falsy-zero preservation (Bugbot Medium) ─────────────────────────────
# Halted / pre-market / freshly-IPO'd symbols can legitimately report
# volume=0 or unchanged prices. The previous `a or b` chain dropped
# these as "missing". The _first_present helper preserves zero.

def test_zero_volume_preserved(monkeypatch):
    """A halted-stock quote with volume=0 must surface 0, not None."""
    def _zero_vol(symbol):
        q = _fake_quote(symbol)
        q["volume"] = 0
        return q
    monkeypatch.setattr(stock_market_tool, "_fetch_quote_sync", _zero_vol)
    r = _run(symbol="NVDA")
    assert r["status"] == "available"
    assert r["data"]["volume"] == 0


def test_first_present_helper_preserves_zero():
    """Unit-test the helper directly so future refactors can't regress."""
    assert stock_market_tool._first_present(None, 0)    == 0
    assert stock_market_tool._first_present(None, 0.0)  == 0.0
    assert stock_market_tool._first_present(0, 1)       == 0
    assert stock_market_tool._first_present(None, None) is None
    assert stock_market_tool._first_present(None, "a", "b") == "a"
    # Crucially: empty string is NOT skipped (we want it for "exchange").
    assert stock_market_tool._first_present("", "USD") == ""


# ── Phase 8l — key-backed provider chain (Finnhub → TwelveData) ─────────
# The chat tool used to call yfinance directly, which hangs from a
# datacenter IP (Yahoo rate-limits Railway) → timeout → generic answer.
# When a key is configured the reliable market_providers chain is used
# first; with no key the legacy yfinance path is unchanged.

import backend.services.market_providers as _mp
from backend.services.market_providers.types import MarketQuote


def test_providers_configured_reflects_env(monkeypatch):
    monkeypatch.delenv("FINNHUB_API_KEY", raising=False)
    monkeypatch.delenv("TWELVE_DATA_API_KEY", raising=False)
    monkeypatch.delenv("TWELVEDATA_API_KEY", raising=False)
    assert stock_market_tool._stock_providers_configured() is False
    monkeypatch.setenv("FINNHUB_API_KEY", "k")
    assert stock_market_tool._stock_providers_configured() is True


def test_uses_market_providers_when_key_set(monkeypatch):
    """With FINNHUB_API_KEY set and a live MarketQuote, the tool returns
    the real provider's quote — NOT the brittle yfinance path."""
    monkeypatch.setenv("FINNHUB_API_KEY", "test-key")

    def _fake_quote(sym: str) -> MarketQuote:
        return MarketQuote(
            symbol=sym, asset_type="stock", price=901.5,
            change_percent=1.25, currency="USD",
            timestamp="2026-05-17T10:00:00+00:00", source="finnhub",
            is_live=True, high=905.0, low=890.0, volume=1234567,
            extra={"previous_close": 890.4, "open": 893.0},
        )
    monkeypatch.setattr(_mp, "get_stock_quote", _fake_quote)
    # If the legacy path were hit, this would blow up the test loudly.
    monkeypatch.setattr(
        stock_market_tool, "_fetch_quote_sync",
        lambda s: (_ for _ in ()).throw(AssertionError("legacy path used")),
    )

    r = _run(symbol="NVDA")
    assert r["status"] == "available"
    assert r["provider"] == "finnhub"
    assert r["is_live"] is True
    d = r["data"]
    assert d["last_price"] == 901.5
    assert d["previous_close"] == 890.4
    assert d["change_pct"] == pytest.approx(1.25, abs=1e-4)
    # Honest unknowns — never fabricated.
    assert d["fifty_two_week_high"] is None
    assert d["market_state"] == "UNKNOWN"


def test_chain_not_live_returns_unavailable_no_double_yfinance(monkeypatch):
    """Key is set but the chain (which ALREADY ends in yfinance) returns
    a non-live quote → return unavailable directly. The legacy
    _fetch_quote_sync must NOT run — calling yfinance a second time from
    the same rate-limited IP would double the worst-case hang
    (Bugbot Medium b4c7aa7c). NEVER fabricate from the dead chain."""
    monkeypatch.setenv("FINNHUB_API_KEY", "test-key")
    monkeypatch.setattr(
        _mp, "get_stock_quote",
        lambda s: MarketQuote(symbol=s, asset_type="stock", price=None,
                              change_percent=None, is_live=False,
                              error="market_data_unavailable"),
    )
    monkeypatch.setattr(
        stock_market_tool, "_fetch_quote_sync",
        lambda s: (_ for _ in ()).throw(
            AssertionError("legacy yfinance must not run after keyed chain")
        ),
    )
    r = _run(symbol="NVDA")
    assert r["status"] == "unavailable"
    assert r["is_live"] is False
    assert r["data"] is None


def test_no_key_skips_chain_uses_legacy(monkeypatch):
    """No key configured → chain is never consulted; legacy path runs
    exactly as before (deterministic, no network)."""
    monkeypatch.delenv("FINNHUB_API_KEY", raising=False)
    monkeypatch.delenv("TWELVE_DATA_API_KEY", raising=False)
    monkeypatch.delenv("TWELVEDATA_API_KEY", raising=False)

    def _boom(_s):
        raise AssertionError("chain must not be consulted without a key")
    monkeypatch.setattr(_mp, "get_stock_quote", _boom)
    monkeypatch.setattr(
        stock_market_tool, "_fetch_quote_sync", lambda s: _fake_quote(s)
    )
    r = _run(symbol="NVDA")
    assert r["status"] == "available"
    assert r["provider"] == "yahoo_finance"
