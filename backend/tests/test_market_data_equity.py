# coding: utf-8
"""
Phase 8m — market_data equity routing through the reliable provider chain.

trading_analyst mode runs only `market_data`. Its crypto-only parse_symbol
returned None for "NVDA fiyatı kaç", so _try_binance silently defaulted to
BTCUSDT and the model got Bitcoin data for a stock question. These tests
pin the new behaviour: equity questions short-circuit to the
Finnhub→TwelveData chain; crypto and no-key paths are untouched.
"""
from __future__ import annotations

import asyncio

import pytest

import backend.services.market_providers as _mp
from backend.services.market_providers.types import MarketQuote
from backend.services.tools import market_data_tool
from backend.services.tools.market_data_tool import MarketDataTool


def _run(query: str, ctx=None) -> dict:
    return asyncio.run(MarketDataTool().run(query, ctx or {}))


# ── Symbol extraction ────────────────────────────────────────────────────

@pytest.mark.parametrize("msg,expected", [
    ("NVDA fiyatı kaç", "NVDA"),
    ("what is AAPL price today", "AAPL"),
    ("is TSLA a buy", "TSLA"),
    ("analyze BRK.B for me", "BRK.B"),
    ("the price of stock now", None),     # all stopwords
    ("BTC fiyatı kaç", None),             # crypto — owned by parse_symbol
    ("ETH/USDT analiz", None),            # crypto pair
    # Bugbot Medium 67253298 — first-person English must not extract "I"
    # (nor the following verb). Uppercase-as-typed wins.
    ("I want NVDA price", "NVDA"),
    ("can I buy AAPL", "AAPL"),
    ("i want nvda price", "NVDA"),        # all-lowercase fallback
    ("I WANT NVDA", "NVDA"),              # all-caps prose
    ("I", None),                          # bare pronoun only
])
def test_parse_equity_symbol(msg, expected):
    assert market_data_tool._parse_equity_symbol(msg) == expected


@pytest.mark.parametrize("sym,ok", [
    ("NVDA", True), ("AAPL", True), ("BRK.B", True), ("F", True),
    ("BTC", False),        # crypto ticker
    ("BTCUSDT", False),    # quoted pair
    ("BTC-USD", False),    # too long / crypto base
    ("PRICE", False),      # stopword
    ("TOOLONGX", False),
])
def test_looks_equity(sym, ok):
    assert market_data_tool._looks_equity(sym) is ok


# ── Equity short-circuit ─────────────────────────────────────────────────

def _live(sym: str) -> MarketQuote:
    return MarketQuote(
        symbol=sym, asset_type="stock", price=901.5, change_percent=1.25,
        currency="USD", timestamp="2026-05-17T12:00:00+00:00",
        source="finnhub", is_live=True, high=905.0, low=890.0,
        volume=1.2e7, extra={"previous_close": 890.4, "open": 893.0},
    )


def test_equity_uses_market_providers_when_key_set(monkeypatch):
    monkeypatch.setenv("FINNHUB_API_KEY", "k")
    monkeypatch.setattr(_mp, "get_stock_quote", _live)
    # If the crypto chain were reached this would blow up loudly.
    monkeypatch.setattr(
        MarketDataTool, "_try_binance",
        lambda self, q, c: (_ for _ in ()).throw(AssertionError("crypto chain hit")),
    )
    r = _run("NVDA fiyatı kaç")
    assert r["status"] == "available"
    assert r["provider"] == "finnhub"
    assert r["is_live"] is True
    d = r["data"]
    assert d["symbol"] == "NVDA"
    assert d["last_price"] == 901.5
    assert d["change_24h_pct"] == pytest.approx(1.25)
    assert d["asset_class"] == "equity"


def test_equity_chain_dead_returns_error_not_bitcoin(monkeypatch):
    """Chain has no live quote → clean error. NEVER fall back to the
    crypto chain (which would return BTCUSDT data for an NVDA question)."""
    monkeypatch.setenv("FINNHUB_API_KEY", "k")
    monkeypatch.setattr(
        _mp, "get_stock_quote",
        lambda s: MarketQuote(symbol=s, asset_type="stock", price=None,
                              change_percent=None, is_live=False,
                              error="market_data_unavailable"),
    )
    monkeypatch.setattr(
        MarketDataTool, "_try_binance",
        lambda self, q, c: (_ for _ in ()).throw(AssertionError("crypto chain hit")),
    )
    r = _run("NVDA fiyatı kaç")
    assert r["status"] == "error"
    assert "NVDA" in r["message"]
    assert r["data"] is None


def test_crypto_query_not_hijacked(monkeypatch):
    """A crypto ticker → parse_symbol owns it; equity branch must not run
    even with a key set."""
    monkeypatch.setenv("FINNHUB_API_KEY", "k")
    monkeypatch.setattr(
        _mp, "get_stock_quote",
        lambda s: (_ for _ in ()).throw(AssertionError("equity path used for crypto")),
    )
    called = {}
    async def _fake_binance(self, q, c):
        called["binance"] = True
        return self._ok({"symbol": "BTCUSDT", "last_price": 1}, provider="binance")
    monkeypatch.setattr(MarketDataTool, "_try_binance", _fake_binance)
    r = _run("BTC fiyatı kaç")
    assert called.get("binance") is True
    assert r["provider"] == "binance"


# ── Phase 8n — equity daily indicators ───────────────────────────────────

def test_sma_helper():
    assert market_data_tool._sma([1, 2, 3, 4], 2) == 3.5
    assert market_data_tool._sma([1, 2], 5) is None
    assert market_data_tool._sma([], 3) is None


@pytest.mark.parametrize("price,s20,s50,rsi,expected", [
    (110, 100, 90, 60, "bullish"),     # price>SMA20, SMA20>SMA50
    (80, 100, 110, 40, "bearish"),     # price<SMA20, SMA20<SMA50
    (100, 100, 100, 50, "neutral"),
    (110, 100, 90, 75, "neutral"),     # uptrend but overbought cancels
])
def test_equity_bias(price, s20, s50, rsi, expected):
    bias, reason = market_data_tool._equity_bias(price, s20, s50, rsi)
    assert bias == expected
    assert reason  # non-empty explanation


def _closes(n=60, start=100.0, step=1.0):
    """Generally rising series with small zig-zag so RSI isn't a
    degenerate 100 (all-gains)."""
    return [round(start + i * step + (0.4 if i % 2 else -0.4), 4) for i in range(n)]


def _candles(closes):
    """Synthetic daily candles with UNIQUE ascending datetimes (date
    collisions would scramble the post-sort order)."""
    vals = []
    for i, c in enumerate(closes):
        vals.append({
            "datetime": f"2026-{(i // 28) + 1:02d}-{(i % 28) + 1:02d}",
            "open": str(c - 0.5), "high": str(c + 1.0),
            "low": str(c - 1.0), "close": str(c), "volume": "1000000",
        })
    return {"status": "ok", "values": vals}


def test_equity_daily_indicators_computed(monkeypatch):
    monkeypatch.setenv("TWELVE_DATA_API_KEY", "k")
    closes = _closes(60)

    async def _fake_fetch(url, timeout=10, cache_ttl=0):
        assert "time_series" in url
        return _candles(closes)
    monkeypatch.setattr(market_data_tool, "_fetch_json", _fake_fetch)

    out = asyncio.run(market_data_tool._equity_daily_indicators("NVDA", closes[-1]))
    assert out is not None
    assert out["candles_analyzed"] == 60
    assert out["sma20"] == pytest.approx(sum(closes[-20:]) / 20, abs=0.01)
    assert out["sma50"] == pytest.approx(sum(closes[-50:]) / 50, abs=0.01)
    assert out["sma20"] > out["sma50"]            # rising series
    assert 0 <= out["rsi_14"] <= 100
    assert out["support"] is not None and out["resistance"] is not None
    assert out["bias"] in ("bullish", "neutral")  # uptrend, RSI may be hot


def test_equity_daily_indicators_no_key(monkeypatch):
    monkeypatch.delenv("TWELVE_DATA_API_KEY", raising=False)
    monkeypatch.delenv("TWELVEDATA_API_KEY", raising=False)
    out = asyncio.run(market_data_tool._equity_daily_indicators("NVDA", 100.0))
    assert out is None


def test_equity_payload_includes_indicators_when_keys(monkeypatch):
    monkeypatch.setenv("FINNHUB_API_KEY", "fk")
    monkeypatch.setenv("TWELVE_DATA_API_KEY", "tk")
    monkeypatch.setattr(_mp, "get_stock_quote", _live)

    async def _fake_fetch(url, timeout=10, cache_ttl=0):
        return _candles(_closes(60))
    monkeypatch.setattr(market_data_tool, "_fetch_json", _fake_fetch)

    r = _run("NVDA price")
    assert r["status"] == "available"
    d = r["data"]
    assert d["data_quality"]["level"] == "ohlc_daily"
    assert d["timeframe"] == "1d"
    assert d["sma20"] is not None and d["sma50"] is not None
    assert 0 <= d["rsi_14"] <= 100
    assert d["last_price"] == 901.5            # quote price, NOT a candle close


def test_equity_payload_quote_only_without_twelvedata(monkeypatch):
    monkeypatch.setenv("FINNHUB_API_KEY", "fk")
    monkeypatch.delenv("TWELVE_DATA_API_KEY", raising=False)
    monkeypatch.delenv("TWELVEDATA_API_KEY", raising=False)
    monkeypatch.setattr(_mp, "get_stock_quote", _live)
    r = _run("NVDA price")
    assert r["status"] == "available"
    d = r["data"]
    assert d["data_quality"]["level"] == "quote_only"
    assert d["timeframe"] == "quote"   # NOT "1d" — no candles fetched
    assert "sma20" not in d
    assert d["last_price"] == 901.5


def test_no_key_skips_equity_branch(monkeypatch):
    monkeypatch.delenv("FINNHUB_API_KEY", raising=False)
    monkeypatch.delenv("TWELVE_DATA_API_KEY", raising=False)
    monkeypatch.delenv("TWELVEDATA_API_KEY", raising=False)
    monkeypatch.setattr(
        _mp, "get_stock_quote",
        lambda s: (_ for _ in ()).throw(AssertionError("chain consulted without key")),
    )
    called = {}
    async def _fake_binance(self, q, c):
        called["binance"] = True
        return self._ok({"symbol": "BTCUSDT", "last_price": 1}, provider="binance")
    monkeypatch.setattr(MarketDataTool, "_try_binance", _fake_binance)
    r = _run("NVDA fiyatı kaç")
    assert called.get("binance") is True   # legacy path, unchanged
