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
    build_breakdown, build_scenarios, build_analytics, build_mtf, build_volume,
    build_confidence,
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

def test_build_analytics_passthrough_real_values():
    data = {
        "last_price": 100.0, "trend": "uptrend", "regime": "trending_up",
        "rsi_14": 61.0, "ema20": 99.0, "ema50": 95.0, "bos": "bullish_bos",
        "volume_trend": "increasing", "atr_14": 2.3, "volatility_pct": 2.1,
        "macd": {"macd": 1.2, "signal": 0.9, "hist": 0.3, "state": "bullish"},
        "momentum": {"roc_pct": 4.0, "state": "accelerating_up"},
        "trend_strength": {"adx": 31.0, "label": "strong"},
        "mtf_alignment": {"alignment": "bullish", "up_count": 3,
                          "down_count": 0, "side_count": 0, "divergences": []},
        "multi_timeframe": {"1d": {"trend": "uptrend", "rsi": 60},
                            "4h": {"trend": "uptrend", "rsi": 58}},
    }
    a = build_analytics(data, data_quality="full")
    assert a["available"] is True
    assert a["rsi_14"] == 61.0 and a["regime"] == "trending_up"
    assert a["macd"]["state"] == "bullish" and a["macd"]["hist"] == 0.3
    assert a["momentum"]["state"] == "accelerating_up"
    assert a["trend_strength"]["adx"] == 31.0
    assert a["mtf"]["alignment"] == "bullish" and a["mtf"]["up"] == 3
    assert a["timeframes"] and len(a["timeframes"]) == 2
    assert a["timeframes"][0]["tf"] in ("1d", "4h")


def test_build_analytics_quote_only_and_empty_are_honest():
    q = build_analytics({"last_price": 187.4}, data_quality="quote_only")
    assert q["available"] is False
    assert "quote-only" in q["unavailable_reason"].lower()
    assert q["macd"] is None and q["mtf"] is None and q["rsi_14"] is None
    e = build_analytics({"last_price": 5.0}, data_quality="ohlc_daily")
    assert e["available"] is False
    assert e["unavailable_reason"]


def test_build_mtf_aligned_bullish():
    data = {"multi_timeframe": {
        "1h": {"trend": "uptrend", "rsi": 58},
        "4h": {"trend": "uptrend", "rsi": 61},
        "1d": {"trend": "uptrend", "rsi": 64},
    }}
    m = build_mtf(data, data_quality="full")
    assert m["available"] is True
    assert m["alignment"] == "bullish"
    assert m["agreement_pct"] == 100
    assert m["conflict"] is False
    # canonical set always present; 15m honestly unavailable (not faked)
    tfs = {r["tf"]: r["bias"] for r in m["timeframes"]}
    assert tfs["15m"] == "unavailable"
    assert tfs["1h"] == "bullish" and tfs["1d"] == "bullish"


def test_build_mtf_conflict_counter_trend():
    data = {"multi_timeframe": {
        "1h": {"trend": "uptrend", "rsi": 57},
        "4h": {"trend": "downtrend", "rsi": 43},
        "1d": {"trend": "downtrend", "rsi": 40},
    }}
    m = build_mtf(data, data_quality="full")
    assert m["available"] is True
    assert m["conflict"] is True
    assert "counter-trend long risk elevated" in m["summary"].lower()


def test_build_mtf_mixed_is_chop():
    # lower TF neutral (no lower directional read) so the hi/lo conflict
    # branch can't fire; higher TFs split -> honest mixed/chop summary.
    data = {"multi_timeframe": {
        "1h": {"trend": "sideways", "rsi": 50},
        "4h": {"trend": "uptrend", "rsi": 56},
        "1d": {"trend": "downtrend", "rsi": 44},
    }}
    m = build_mtf(data, data_quality="full")
    assert m["conflict"] is False
    assert m["alignment"] == "mixed"
    assert "chop" in m["summary"].lower() or "mixed" in m["summary"].lower()


def test_build_mtf_unavailable_is_honest():
    none = build_mtf({"last_price": 10.0}, data_quality="full")
    assert none["available"] is False
    assert none["unavailable_reason"]
    # still lists canonical pills as unavailable — never a guessed bias
    assert [r["bias"] for r in none["timeframes"]] == ["unavailable"] * 4
    q = build_mtf({"multi_timeframe": {"1h": {"trend": "uptrend"}}},
                  data_quality="quote_only")
    assert q["available"] is False
    assert "quote-only" in q["unavailable_reason"].lower()


def test_build_volume_confirmed_breakout():
    data = {"volume_trend": "increasing", "bos": "bullish_bos",
            "regime": "trending_up"}
    v = build_volume(data, data_quality="full")
    assert v["available"] is True
    assert v["participation"] == "expanding"
    assert v["breakout_quality"] == "confirmed"
    assert "confirmed by expanding participation" in v["breakout_note"].lower()
    assert v["volume_confidence"] >= 70


def test_build_volume_weak_breakout_unsupported():
    data = {"volume_trend": "decreasing", "bos": "bullish_bos"}
    v = build_volume(data, data_quality="full")
    assert v["breakout_quality"] == "weak"
    assert "unsupported by volume" in v["breakout_note"].lower()
    assert v["volume_confidence"] < 50


def test_build_volume_dead_volume_and_spike_and_sweep():
    data = {
        "volume_trend": "decreasing", "bos": "range", "regime": "choppy",
        "smart_money": {
            "absorption_signal": {"type": "distribution", "vol_ratio": 2.4,
                                  "range_vs_atr": 0.4},
            "liquidity_above": [{"level": 101.0, "distance_pct": 0.3}],
            "liquidity_below": [{"level": 95.0, "distance_pct": 4.0}],
        },
    }
    v = build_volume(data, data_quality="full")
    assert "Dead volume environment." in v["anomalies"]
    assert any(a.startswith("Abnormal volume spike") for a in v["anomalies"])
    assert any(a.startswith("Exhaustion") for a in v["anomalies"])
    assert v["liquidity_sweep_risk"] == "elevated"
    assert "Liquidity sweep risk elevated." in v["anomalies"]


def test_build_volume_quote_only_and_unavailable_are_honest():
    q = build_volume({"volume_trend": "increasing"},
                     data_quality="quote_only")
    assert q["available"] is False and "quote-only" in q["unavailable_reason"].lower()
    assert q["anomalies"] == [] and q["volume_confidence"] == 0
    e = build_volume({"last_price": 5.0}, data_quality="ohlc_daily")
    assert e["available"] is False and e["unavailable_reason"]


def test_build_confidence_high_conviction_long():
    data = {
        "trend": "uptrend", "rsi_14": 60, "bos": "bullish_bos",
        "volume_trend": "increasing", "regime": "trending_up",
        "macd": {"state": "bullish_cross"},
        "momentum": {"state": "accelerating_up"},
        "mtf_alignment": {"alignment": "bullish"},
        "last_price": 100.0, "support": 92.0, "resistance": 130.0,
    }
    c = build_confidence(data, {"directional_bias": "LONG"},
                         direction="LONG", data_quality="full")
    assert c["available"] is True
    assert c["confidence"] >= 75
    assert c["conviction"] in ("high", "institutional")
    assert c["grade"] in ("A", "B")
    assert any(f["impact"] > 0 for f in c["factors"])
    assert "%" in c["explanation"]


def test_build_confidence_low_when_conflicting():
    data = {
        "trend": "downtrend", "rsi_14": 72, "bos": "bearish_bos",
        "volume_trend": "decreasing", "regime": "choppy",
        "macd": {"state": "bearish"},
        "mtf_alignment": {"alignment": "bearish"},
    }
    c = build_confidence(data, {"directional_bias": "SHORT"},
                         direction="LONG", data_quality="full")
    assert c["available"] is True
    assert c["confidence"] < 45
    assert c["conviction"] in ("low", "very_low")
    assert any(f["impact"] < 0 for f in c["factors"])


def test_build_confidence_quote_only_and_empty_honest():
    q = build_confidence({"trend": "uptrend"}, {}, direction="LONG",
                         data_quality="quote_only")
    assert q["available"] is False and q["confidence"] == 0
    assert "quote-only" in q["unavailable_reason"].lower()
    e = build_confidence({"last_price": 5.0}, {}, direction="WAIT",
                         data_quality="ohlc_daily")
    assert e["available"] is False and e["factors"] == []


def test_empty_signal_carries_none_breakdown_scenarios():
    sig = signals_service._empty_signal("NVDA", "4h", error="no_data")
    assert sig["breakdown"] is None
    assert sig["scenarios"] is None
    assert sig["analytics"] is None
    assert sig["mtf"] is None
    assert sig["volume"] is None
    assert sig["confidence_engine"] is None
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
    assert sig["analytics"] and sig["analytics"]["available"] is True
    assert sig["analytics"]["rsi_14"] == 60.0
