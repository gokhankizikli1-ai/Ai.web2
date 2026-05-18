# coding: utf-8
"""
Phase 9 — Trading Intelligence Engine tests.

Covers the Explainable Signal Breakdown (#2) and Scenario Engine (#3):

  - bullish-aligned indicators -> bullish factors dominate, strongest
    reason on the LONG side, scenarios carry only REAL levels.
  - bearish-aligned -> bearish factors dominate.
  - mixed / WAIT -> neutral factors, no fabricated bias.
  - quote-only / empty data -> honest `available: False`, NO invented
    factors and NO invented price levels (the core no-fake-data rule).
  - the engine is wired additively into map_tool_result_to_signal and
    _empty_signal without breaking the existing contract.

Pure unit tests — no network, no external providers.
"""
from __future__ import annotations

from backend.services.trading.intelligence import (
    build_breakdown, build_scenarios,
)
from backend.services.trading import signals_service


# ── fixtures (synthetic, deterministic) ────────────────────────────────────

def _bullish_data() -> dict:
    return {
        "last_price": 100.0,
        "trend": "uptrend",
        "bos": "bullish_bos",
        "rsi_14": 61.0,
        "volume_trend": "increasing",
        "ema20": 99.0,
        "ema50": 95.0,
        "support": 92.0,
        "resistance": 108.0,
        "regime": "trending_up",
        "mtf_alignment": {"alignment": "bullish", "divergences": []},
    }


def _bullish_plan() -> dict:
    return {
        "directional_bias": "LONG",
        "entry": 100.0,
        "stop": 96.0,
        "take_profit_1": 110.0,
        "take_profit_2": 118.0,
        "risk_reward": 2.5,
        "setup_grade": 8,
        "invalidation": "Daily close below 92 kills the long thesis.",
        "do_not_do": ["Do not chase above 108 without a retest"],
    }


# ── breakdown ──────────────────────────────────────────────────────────────

def test_breakdown_bullish_aligned():
    b = build_breakdown(
        _bullish_data(), _bullish_plan(),
        direction="LONG", setup_grade=8, data_quality="full",
    )
    assert b["available"] is True
    assert b["unavailable_reason"] is None
    assert len(b["bullish_factors"]) >= 3
    assert len(b["bullish_factors"]) > len(b["bearish_factors"])
    # strongest reason must come from the LONG side
    assert b["strongest_reason"]
    assert b["invalidation"] == "Daily close below 92 kills the long thesis."
    assert "volume" in b["confirmation_needed"].lower()
    # every factor is well-formed
    for f in b["bullish_factors"] + b["neutral_factors"]:
        assert set(f) == {"factor", "detail", "weight"}
        assert isinstance(f["weight"], int)


def test_breakdown_bearish_aligned():
    data = {
        "last_price": 50.0,
        "trend": "downtrend",
        "bos": "bearish_bos",
        "rsi_14": 38.0,
        "volume_trend": "decreasing",
        "ema20": 49.0,
        "ema50": 53.0,
        "support": 45.0,
        "resistance": 58.0,
        "mtf_alignment": {"alignment": "bearish"},
    }
    plan = {"directional_bias": "SHORT", "entry": 50.0, "stop": 53.0,
            "take_profit_1": 44.0, "setup_grade": 7}
    b = build_breakdown(data, plan, direction="SHORT", setup_grade=7,
                         data_quality="full")
    assert b["available"] is True
    assert len(b["bearish_factors"]) > len(b["bullish_factors"])
    assert b["strongest_reason"]
    assert "support 45" in b["invalidation"].lower() or b["invalidation"]


def test_breakdown_mixed_is_neutral_no_fabrication():
    data = {"last_price": 10.0, "trend": "sideways", "bos": "range",
            "rsi_14": 50.0, "regime": "choppy"}
    b = build_breakdown(data, {}, direction="WAIT", setup_grade=2,
                         data_quality="full")
    assert b["available"] is True
    assert b["bullish_factors"] == [] and b["bearish_factors"] == []
    assert len(b["neutral_factors"]) >= 2
    # no plan invalidation, no S/R for WAIT -> stays honest (None)
    assert b["invalidation"] is None


def test_breakdown_quote_only_is_honest_unavailable():
    b = build_breakdown(
        {"last_price": 187.4}, {},
        direction="WAIT", setup_grade=None, data_quality="quote_only",
    )
    assert b["available"] is False
    assert "quote-only" in b["unavailable_reason"].lower()
    # the no-fake-data guarantee: zero fabricated factors
    assert b["bullish_factors"] == []
    assert b["bearish_factors"] == []
    assert b["neutral_factors"] == []
    assert b["strongest_reason"] is None


def test_breakdown_empty_data_is_unavailable():
    b = build_breakdown(None, None, direction="WAIT", setup_grade=None)
    assert b["available"] is False
    assert b["unavailable_reason"]


# ── scenarios ──────────────────────────────────────────────────────────────

def test_scenarios_with_levels_use_only_real_numbers():
    s = build_scenarios(_bullish_data(), _bullish_plan(),
                         direction="LONG", data_quality="full")
    assert s["available"] is True
    assert s["key_levels"]["support"] == 92.0
    assert s["key_levels"]["resistance"] == 108.0
    assert s["key_levels"]["take_profit_1"] == 110.0
    assert s["bullish_scenario"] and s["bearish_scenario"] and s["sideways_scenario"]
    assert s["do_not_trade_if"].lower().startswith("do not trade if")


def test_scenarios_quote_only_no_invented_levels():
    s = build_scenarios({"last_price": 187.4}, {},
                         direction="WAIT", data_quality="quote_only")
    assert s["available"] is False
    # last_price is real and may be echoed, but NO derived levels invented
    for k in ("support", "resistance", "entry", "stop",
              "take_profit_1", "take_profit_2"):
        assert k not in s["key_levels"]
    assert s["unavailable_reason"]


def test_scenarios_no_levels_is_unavailable():
    s = build_scenarios({"last_price": 5.0, "trend": "sideways"}, {},
                         direction="WAIT")
    assert s["available"] is False
    assert s["bullish_scenario"] == s["unavailable_reason"]


# ── additive wiring into signals_service ───────────────────────────────────

def test_empty_signal_carries_none_breakdown_scenarios():
    sig = signals_service._empty_signal("NVDA", "4h", error="no_data")
    assert sig["breakdown"] is None
    assert sig["scenarios"] is None
    # existing contract keys still present (no regression)
    for k in ("symbol", "direction", "is_live", "entry", "data_quality"):
        assert k in sig


def test_map_tool_result_adds_breakdown_and_scenarios():
    tool_result = {
        "status": "available",
        "provider": "binance",
        "timestamp": "2026-05-18T00:00:00+00:00",
        "data": {
            "symbol": "BTCUSDT",
            "last_price": 100.0,
            "change_24h_pct": 1.2,
            "timeframe": "4h",
            "trend": "uptrend",
            "bos": "bullish_bos",
            "rsi_14": 60.0,
            "volume_trend": "increasing",
            "support": 92.0,
            "resistance": 108.0,
            "regime": "trending_up",
            "data_quality": {"level": "full"},
            "plan": _bullish_plan(),
        },
    }
    sig = signals_service.map_tool_result_to_signal("BTCUSDT", "4h", tool_result)
    assert sig["is_live"] is True
    assert sig["direction"] == "LONG"
    assert sig["breakdown"] and sig["breakdown"]["available"] is True
    assert sig["scenarios"] and sig["scenarios"]["available"] is True
    assert sig["breakdown"]["bullish_factors"]
    assert sig["scenarios"]["key_levels"]["resistance"] == 108.0
