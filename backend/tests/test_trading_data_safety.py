# coding: utf-8
"""
Phase 8d — trading data safety tests.

Goal: prove the backend never serves fabricated prices as real.

Coverage:
  - Every BaseTool envelope carries `is_live` (True for _ok, False for
    _unavailable / _error).
  - The stock_market tool surfaces is_live=True on success and is_live=
    False when the provider fails / refuses to serve.
  - signals_service routing: provider down → is_live=False on every
    signal, no fabricated prices in the data.
  - filter_live_signals strips non-live entries in production mode.
  - is_demo_mode() refuses to activate in production even if the flag
    is on (defensive — protects against misconfiguration).
  - safe_empty_response shape is what the frontend expects to render
    "Market data unavailable right now".
"""
from __future__ import annotations

import asyncio
from unittest.mock import patch

import pytest

from backend.services.tools.base_tool import BaseTool
from backend.services.tools.stock_market_tool import StockMarketTool
from backend.services.tools import stock_market_tool as smt
from backend.services.tools.stock_market_tool import _Unavailable
from backend.services.trading import safety as trading_safety
from backend.services.trading.signals_service import map_tool_result_to_signal


# ── BaseTool envelope ───────────────────────────────────────────────────

class _DummyTool(BaseTool):
    name = "dummy_safety_test"
    description = "test"

    async def run(self, query="", context=None):
        return self._ok({"x": 1}, provider="testprov")


def test_ok_sets_is_live_true():
    r = asyncio.run(_DummyTool().run())
    assert r["is_live"] is True
    assert r["source"] == "testprov"
    assert r["provider"] == "testprov"
    assert r["timestamp"]


def test_unavailable_sets_is_live_false():
    r = _DummyTool()._unavailable("provider down")
    assert r["is_live"] is False
    assert r["source"] is None
    assert r["data"] is None


def test_error_sets_is_live_false():
    r = _DummyTool()._error("bad input")
    assert r["is_live"] is False
    assert r["status"] == "error"
    assert r["data"] is None


def test_ok_can_be_marked_not_live():
    """A tool returning cached / simulated data must be able to set
    is_live=False explicitly, so demo-mode code paths are honest."""
    tool = _DummyTool()
    r = tool._ok({"cached": True}, provider="cache", is_live=False)
    assert r["is_live"] is False
    assert r["status"] == "available"


# ── stock_market tool ───────────────────────────────────────────────────

def _fake_quote():
    return {
        "symbol":         "NVDA",
        "name":           "NVIDIA Corporation",
        "currency":       "USD",
        "exchange":       "NMS",
        "market_state":   "REGULAR",
        "last_price":     900.0,
        "previous_close": 890.0,
        "open":           895.0,
        "day_high":       905.0,
        "day_low":        893.0,
        "volume":         12_345_678,
        "change":         10.0,
        "change_pct":     1.12,
        "fifty_two_week_high": 974.0,
        "fifty_two_week_low":  450.0,
        "as_of":          "2026-05-13T08:25:00+00:00",
    }


def test_stock_market_real_data_is_live(monkeypatch):
    monkeypatch.setattr(smt, "_fetch_quote_sync", lambda s: _fake_quote())
    r = asyncio.run(StockMarketTool().run("NVDA", {}))
    assert r["is_live"] is True
    assert r["source"] == "yahoo_finance"
    assert r["data"]["last_price"] == 900.0


def test_stock_market_provider_failure_not_live(monkeypatch):
    def _boom(symbol):
        raise _Unavailable("Yahoo HTTP 429")
    monkeypatch.setattr(smt, "_fetch_quote_sync", _boom)
    r = asyncio.run(StockMarketTool().run("NVDA", {}))
    assert r["is_live"] is False
    assert r["data"] is None
    assert r["status"] == "unavailable"


def test_stock_market_validation_error_not_live():
    r = asyncio.run(StockMarketTool().run("", {}))
    assert r["is_live"] is False
    assert r["status"] == "error"
    assert r["data"] is None


# ── signals_service routing ─────────────────────────────────────────────

def test_signal_unavailable_emits_no_fake_prices():
    """When the market_data tool reports unavailable, the resulting
    signal must have is_live=False AND every price-like field None.
    No fabrication anywhere."""
    tool_result = {
        "tool":      "market_data",
        "status":    "unavailable",
        "data":      None,
        "provider":  None,
        "is_live":   False,
        "message":   "rate limited",
    }
    sig = map_tool_result_to_signal("AAPL", "1d", tool_result)
    assert sig["is_live"] is False
    # Every price-like field must be None — never a stale or made-up number.
    for key in (
        "price", "entry", "stop_loss", "take_profit_1",
        "take_profit_2", "change_24h_pct", "risk_reward",
    ):
        assert sig.get(key) is None, f"signal leaks {key}={sig.get(key)!r} when not live"
    assert sig["direction"] == "NO_TRADE"


def test_signal_available_with_no_last_price_is_not_live():
    """Even when status='available' the signal must refuse to be 'live'
    if the data dict lacks a usable last_price. Catches a provider that
    returned 200 OK but no price."""
    tool_result = {
        "tool":      "market_data",
        "status":    "available",
        "data":      {"symbol": "AAPL"},   # NO last_price
        "provider":  "yahoo",
        "is_live":   True,
        "message":   None,
    }
    sig = map_tool_result_to_signal("AAPL", "1d", tool_result)
    assert sig["is_live"] is False
    assert sig["price"] is None
    assert sig["direction"] == "NO_TRADE"


# ── safety module ───────────────────────────────────────────────────────

def test_filter_live_signals_strips_non_live_in_production(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.delenv("ENABLE_TRADING_DEMO_MODE", raising=False)
    signals = [
        {"symbol": "BTC",  "is_live": True,  "price": 70000},
        {"symbol": "AAPL", "is_live": False, "price": None},
        {"symbol": "NVDA", "is_live": None,  "price": 900},      # ambiguous → drop
        {"symbol": "TSLA", "is_live": "true", "price": 200},     # string, not bool → drop
        {"symbol": "ETH",  "is_live": True,  "price": 3500},
        "not-a-dict",
    ]
    out = trading_safety.filter_live_signals(signals)
    assert [s["symbol"] for s in out] == ["BTC", "ETH"]


def test_filter_live_signals_keeps_all_in_demo_mode(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "staging")
    monkeypatch.setenv("ENABLE_TRADING_DEMO_MODE", "true")
    signals = [
        {"symbol": "BTC",  "is_live": True,  "price": 70000},
        {"symbol": "AAPL", "is_live": False, "price": 100},
    ]
    out = trading_safety.filter_live_signals(signals)
    # Demo mode keeps non-live entries so dev can render the demo UI.
    assert len(out) == 2


def test_demo_mode_refuses_to_activate_in_production(monkeypatch):
    """Defensive: even if an operator sets ENABLE_TRADING_DEMO_MODE=true
    on a Railway prod environment by mistake, the env guard keeps it off."""
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("ENABLE_TRADING_DEMO_MODE", "true")
    assert trading_safety.is_demo_mode() is False
    # And filter still strips non-live entries.
    out = trading_safety.filter_live_signals([{"symbol": "AAPL", "is_live": False}])
    assert out == []


def test_demo_mode_activates_in_staging(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "staging")
    monkeypatch.setenv("ENABLE_TRADING_DEMO_MODE", "true")
    assert trading_safety.is_demo_mode() is True


def test_demo_mode_off_by_default(monkeypatch):
    monkeypatch.delenv("ENABLE_TRADING_DEMO_MODE", raising=False)
    assert trading_safety.is_demo_mode() is False


# ── safe_empty_response shape ───────────────────────────────────────────

def test_safe_empty_response_shape(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.delenv("ENABLE_TRADING_DEMO_MODE", raising=False)
    r = trading_safety.safe_empty_response(symbols=["AAPL", "NVDA", "TSLA"])
    assert r["signals"]    == []
    assert r["is_live"]    is False
    assert r["demo_mode"]  is False
    assert r["live_count"] == 0
    assert r["requested"]  == ["AAPL", "NVDA", "TSLA"]
    # The exact frontend trigger string for the "Market data unavailable"
    # UX. Keep this stable so a future copy change is intentional.
    assert "Market data unavailable" in r["message"]


def test_safe_empty_response_never_invents_signals():
    """The whole point: requesting prices for AAPL / NVDA / TSLA must
    NOT produce any entry with those symbols + a price. Just an empty
    list and a clean unavailable message."""
    r = trading_safety.safe_empty_response(symbols=["AAPL", "NVDA", "TSLA"])
    blob = repr(r)
    # The symbols may appear in `requested` (that's fine — caller's input
    # echoed back) but never as a price entry.
    for symbol in ("AAPL", "NVDA", "TSLA"):
        # No "symbol: X, price: Y" pattern anywhere.
        assert f"'{symbol}'" in blob or f'"{symbol}"' in blob, "should echo requested"
    assert r["signals"] == []
    assert r["live_count"] == 0


def test_is_live_signal_strict_on_truthy_non_bool():
    """`is_live = "true"` or `is_live = 1` should NOT count as live —
    only the actual boolean True passes. Strict on purpose."""
    assert trading_safety.is_live_signal({"is_live": True}) is True
    assert trading_safety.is_live_signal({"is_live": False}) is False
    assert trading_safety.is_live_signal({"is_live": None}) is False
    assert trading_safety.is_live_signal({"is_live": "true"}) is False
    assert trading_safety.is_live_signal({"is_live": 1}) is False
    assert trading_safety.is_live_signal({}) is False
    assert trading_safety.is_live_signal("not-a-dict") is False
    assert trading_safety.is_live_signal(None) is False
