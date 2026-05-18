# coding: utf-8
"""
Phase 9 — Signal Intelligence layer tests.

Covers the additive signal-intelligence engine:

  - pure indicators: _calc_macd, _calc_momentum, _trend_strength
    (correct on real-ish series; honest insufficient_data when short —
    NEVER fabricated numbers).
  - _build_result exposes the new macd/momentum/trend_strength keys
    additively without disturbing the existing keys.
  - build_decision: multi-factor weighted LONG/SHORT/WAIT, the
    trend-strength (ADX) gate that prefers WAIT in weak trends,
    confidence/grade, and honest unavailable on quote-only data.

Pure unit tests — no network, no external providers.
"""
from __future__ import annotations

from backend.services.tools.market_data_tool import (
    _calc_macd, _calc_momentum, _trend_strength, _build_result,
)
from backend.services.trading.intelligence import build_decision
from backend.services.trading import signals_service


# ── synthetic series ───────────────────────────────────────────────────────

def _uptrend(n: int = 160, start: float = 100.0, rate: float = 0.004):
    # Compounding (slightly convex) uptrend — a realistic trending series.
    # A pure linear ramp is a degenerate MACD input (signal EMA converges
    # onto the MACD line), so use steady geometric growth instead.
    closes = [round(start * ((1.0 + rate) ** i), 4) for i in range(n)]
    opens = [round(c / (1.0 + rate * 0.3), 4) for c in closes]
    highs = [round(c * 1.004, 4) for c in closes]
    lows = [round(c * 0.996, 4) for c in closes]
    vols = [1000.0 + i for i in range(n)]
    return opens, highs, lows, closes, vols


def _flat(n: int = 140, price: float = 50.0):
    closes = [price + (1 if i % 2 else -1) * 0.05 for i in range(n)]
    opens = list(closes)
    highs = [c + 0.1 for c in closes]
    lows = [c - 0.1 for c in closes]
    vols = [1000.0] * n
    return opens, highs, lows, closes, vols


# ── indicators ─────────────────────────────────────────────────────────────

def test_macd_uptrend_bullish_and_short_series_honest():
    _, _, _, closes, _ = _uptrend()
    m = _calc_macd(closes)
    assert m["macd"] is not None and m["signal"] is not None
    assert m["state"] in ("bullish", "bullish_cross")
    short = _calc_macd([1, 2, 3, 4, 5])
    assert short == {"macd": None, "signal": None, "hist": None,
                     "state": "insufficient_data"}


def test_momentum_states_and_honest_short():
    _, _, _, up, _ = _uptrend()
    mo = _calc_momentum(up)
    assert mo["roc_pct"] is not None and mo["roc_pct"] > 0
    assert mo["state"] in ("up", "accelerating_up")
    assert _calc_momentum([1, 2, 3])["state"] == "insufficient_data"
    assert _calc_momentum([1, 2, 3])["roc_pct"] is None


def test_trend_strength_strong_vs_flat_vs_short():
    _, h, l, c, _ = _uptrend()
    strong = _trend_strength(c, h, l)
    assert strong["adx"] is not None
    assert strong["label"] in ("strong", "very_strong")
    _, fh, fl, fc, _ = _flat()
    flat = _trend_strength(fc, fh, fl)
    assert flat["adx"] is not None
    assert flat["label"] in ("no_trend", "weak")
    short = _trend_strength([1, 2], [1, 2], [1, 2])
    assert short == {"adx": None, "label": "insufficient_data"}


def test_build_result_exposes_new_keys_additively():
    o, h, l, c, v = _uptrend()
    r = _build_result("BTCUSDT", "1h", o, h, l, c, v)
    # new additive keys present
    for k in ("macd", "momentum", "trend_strength"):
        assert k in r and isinstance(r[k], dict)
    # existing contract keys still present (no regression)
    for k in ("last_price", "rsi_14", "ema20", "trend", "support",
              "resistance", "regime", "candles_analyzed"):
        assert k in r
    assert r["macd"]["state"] in ("bullish", "bullish_cross", "neutral")


# ── decision engine ────────────────────────────────────────────────────────

def _bull_data():
    return {
        "last_price": 100.0,
        "trend": "uptrend",
        "bos": "bullish_bos",
        "rsi_14": 60.0,
        "volume_trend": "increasing",
        "ema20": 99.0, "ema50": 95.0,
        "support": 92.0, "resistance": 112.0,
        "macd": {"state": "bullish_cross"},
        "momentum": {"state": "accelerating_up", "roc_pct": 4.2},
        "trend_strength": {"adx": 38.0, "label": "strong"},
        "mtf_alignment": {"alignment": "bullish"},
    }


def test_decision_long_when_factors_align():
    d = build_decision(_bull_data(), {}, data_quality="full")
    assert d["available"] is True
    assert d["direction"] == "LONG"
    assert d["score"] > 0 and d["bull_weight"] > d["bear_weight"]
    assert d["confidence_pct"] >= 50
    assert d["grade"] in ("A", "B", "C")
    assert d["invalidation"] and "support 92" in d["invalidation"].lower()
    assert any(f["factor"] == "MACD" for f in d["factors"])


def test_decision_short_when_bearish():
    data = {
        "trend": "downtrend", "bos": "bearish_bos", "rsi_14": 38.0,
        "volume_trend": "decreasing", "ema20": 49.0, "ema50": 53.0,
        "support": 45.0, "resistance": 58.0,
        "macd": {"state": "bearish"},
        "momentum": {"state": "accelerating_down", "roc_pct": -3.1},
        "trend_strength": {"adx": 30.0, "label": "strong"},
        "mtf_alignment": {"alignment": "bearish"},
    }
    d = build_decision(data, {}, data_quality="full")
    assert d["direction"] == "SHORT"
    assert d["score"] < 0
    assert "resistance 58" in (d["invalidation"] or "").lower()


def test_weak_trend_gate_prefers_wait():
    # Net edge of exactly 4 (one trend bull=3 + volume bull=1) but the
    # trend-strength gate requires >=6 in a weak/no-trend regime -> WAIT.
    data = {
        "trend": "uptrend",                 # bull 3
        "volume_trend": "increasing",       # bull 1  -> net +4
        "trend_strength": {"adx": 15.0, "label": "no_trend"},
    }
    d = build_decision(data, {}, data_quality="full")
    assert d["direction"] == "WAIT"
    assert "gate" in d["rationale"].lower() or "wait" in d["rationale"].lower()


def test_decision_quote_only_is_honest_unavailable():
    d = build_decision({"last_price": 187.4}, {}, data_quality="quote_only")
    assert d["available"] is False
    assert d["direction"] == "WAIT"
    assert d["confidence_pct"] == 0
    assert d["factors"] == []
    assert "quote-only" in d["unavailable_reason"].lower()


def test_decision_no_factors_is_honest_wait():
    d = build_decision({"last_price": 10.0}, {}, data_quality="ohlc_daily")
    assert d["available"] is True
    assert d["direction"] == "WAIT"
    assert d["factors"] == []
    assert d["confidence_pct"] <= 25


def test_signal_carries_intel_additively():
    tool_result = {
        "status": "available",
        "provider": "binance",
        "timestamp": "2026-05-18T00:00:00+00:00",
        "data": {
            "symbol": "BTCUSDT", "last_price": 100.0, "change_24h_pct": 1.0,
            "timeframe": "4h", "trend": "uptrend", "bos": "bullish_bos",
            "rsi_14": 60.0, "support": 92.0, "resistance": 112.0,
            "macd": {"state": "bullish"},
            "momentum": {"state": "up", "roc_pct": 2.0},
            "trend_strength": {"adx": 30.0, "label": "strong"},
            "data_quality": {"level": "full"},
            "plan": {"directional_bias": "LONG", "setup_grade": 7},
        },
    }
    sig = signals_service.map_tool_result_to_signal("BTCUSDT", "4h", tool_result)
    assert sig["intel"] and sig["intel"]["available"] is True
    assert sig["intel"]["direction"] == "LONG"
    # legacy contract fields are UNCHANGED (additive guarantee)
    assert sig["direction"] == "LONG"
    assert "confidence_pct" in sig and "setup_grade" in sig
    empty = signals_service._empty_signal("X", "4h", error="no_data")
    assert empty["intel"] is None
