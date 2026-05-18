# coding: utf-8
"""
Trading Intelligence Engine — Phase 1, step 1.

Explainable Signal Breakdown (#2) + Scenario Engine (#3).

These are PURE functions. They consume the technical indicators that
`market_data_tool` already computed (the `data` dict) plus the ATR-anchored
risk `plan` and the public signal direction/grade — and turn the existing
points-based bias into structured, human-readable reasoning and scenarios.

Hard rules:
  * Never fabricate. Every factor / level is read defensively from the
    inputs; absent inputs are simply not asserted.
  * If the inputs lack OHLC-derived indicators (quote-only data), return an
    honest `available: False` block with a reason — no invented factors,
    no invented levels.
  * No order execution, no buy/sell automation. Analysis only.

Nothing here calls the network or mutates state.
"""
from __future__ import annotations

from typing import Any, Optional


def _f(v: Any) -> Optional[float]:
    """Best-effort float; None when absent or non-numeric (never 0-coerced)."""
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f else None  # drop NaN


def _factor(name: str, detail: str, weight: int) -> dict:
    return {"factor": name, "detail": detail, "weight": weight}


def _fmt(n: Optional[float]) -> str:
    if n is None:
        return "—"
    return f"{n:,.6f}".rstrip("0").rstrip(".") if abs(n) < 10 else f"{n:,.2f}"


# ── Explainable Signal Breakdown (#2) ──────────────────────────────────────

def build_breakdown(
    data: Optional[dict],
    plan: Optional[dict],
    *,
    direction: str,
    setup_grade: Optional[int],
    data_quality: Optional[str] = None,
) -> dict:
    """
    Categorise the SAME factors the bias engine scored (trend, BOS, RSI,
    volume, MTF, premium/discount, trapped traders, regime, equity bias)
    into bullish / bearish / neutral buckets with weights, then derive the
    strongest reason, weakest point, invalidation and confirmation needed.

    Returns a fully-shaped dict; `available` is False (with a reason and
    empty factor lists) when there is no usable indicator data.
    """
    data = data or {}
    plan = plan or {}

    def _unavailable(reason: str) -> dict:
        return {
            "available": False,
            "unavailable_reason": reason,
            "bullish_factors": [],
            "bearish_factors": [],
            "neutral_factors": [],
            "strongest_reason": None,
            "weakest_point": None,
            "invalidation": None,
            "confirmation_needed": None,
        }

    if data_quality == "quote_only":
        return _unavailable(
            "Quote-only data — technical indicators require OHLC history, "
            "which is not available for this symbol."
        )

    bull: list[dict] = []
    bear: list[dict] = []
    neutral: list[dict] = []

    trend = str(data.get("trend") or "").lower()
    if trend == "uptrend":
        bull.append(_factor("Trend", "Primary trend is up.", 2))
    elif trend == "downtrend":
        bear.append(_factor("Trend", "Primary trend is down.", 2))
    elif trend == "sideways":
        neutral.append(_factor("Trend", "Trend is sideways — no directional edge.", 1))

    bos = str(data.get("bos") or "").lower()
    if bos == "bullish_bos":
        bull.append(_factor("Market structure", "Bullish break of structure.", 1))
    elif bos == "bearish_bos":
        bear.append(_factor("Market structure", "Bearish break of structure.", 1))
    elif bos == "range":
        neutral.append(_factor("Market structure", "Price ranging — structure unbroken.", 1))

    rsi = _f(data.get("rsi_14"))
    if rsi is not None:
        if rsi >= 70:
            neutral.append(_factor("RSI", f"RSI {rsi:.0f} overbought — pullback risk.", 1))
        elif rsi <= 30:
            neutral.append(_factor("RSI", f"RSI {rsi:.0f} oversold — bounce risk.", 1))
        elif rsi >= 55:
            bull.append(_factor("RSI", f"RSI {rsi:.0f} — bullish momentum.", 1))
        elif rsi <= 45:
            bear.append(_factor("RSI", f"RSI {rsi:.0f} — bearish momentum.", 1))
        else:
            neutral.append(_factor("RSI", f"RSI {rsi:.0f} — neutral momentum.", 1))

    vol = str(data.get("volume_trend") or "").lower()
    if vol == "increasing":
        bull.append(_factor("Volume", "Volume rising — participation supports the move.", 1))
    elif vol == "decreasing":
        bear.append(_factor("Volume", "Volume falling — weak participation.", 1))

    ema20 = _f(data.get("ema20")) if data.get("ema20") is not None else _f(data.get("sma20"))
    ema50 = _f(data.get("ema50")) if data.get("ema50") is not None else _f(data.get("sma50"))
    if ema20 is not None and ema50 is not None and ema50 != 0:
        if ema20 > ema50 * 1.001:
            bull.append(_factor("Moving averages", "Fast MA above slow MA.", 1))
        elif ema20 < ema50 * 0.999:
            bear.append(_factor("Moving averages", "Fast MA below slow MA.", 1))
        else:
            neutral.append(_factor("Moving averages", "Fast/slow MA entangled — no MA edge.", 1))

    mtf = data.get("mtf_alignment")
    if isinstance(mtf, dict):
        align = str(mtf.get("alignment") or "").lower()
        if align == "bullish":
            bull.append(_factor("Multi-timeframe", "Timeframes aligned bullish.", 2))
        elif align == "bullish_partial":
            bull.append(_factor("Multi-timeframe", "Timeframes partially bullish.", 1))
        elif align == "bearish":
            bear.append(_factor("Multi-timeframe", "Timeframes aligned bearish.", 2))
        elif align == "bearish_partial":
            bear.append(_factor("Multi-timeframe", "Timeframes partially bearish.", 1))
        elif align == "mixed":
            neutral.append(_factor("Multi-timeframe", "Timeframes disagree — mixed picture.", 1))
        if mtf.get("divergences"):
            neutral.append(_factor(
                "Divergence", "Momentum divergence across timeframes — caution.", 1))

    sm = data.get("smart_money")
    if isinstance(sm, dict) and isinstance(sm.get("premium_discount"), dict):
        zone = str(sm["premium_discount"].get("zone") or "").lower()
        if zone in ("discount", "deep_discount"):
            bull.append(_factor("Premium/Discount", "Price in a discount zone — favourable for longs.", 1))
        elif zone in ("premium", "deep_premium"):
            bear.append(_factor("Premium/Discount", "Price in a premium zone — favourable for shorts.", 1))

    fut = data.get("futures")
    if isinstance(fut, dict):
        trapped = str(fut.get("trapped_traders") or "").lower()
        if trapped == "longs":
            bear.append(_factor("Positioning", "Trapped longs — reversal/squeeze-down risk.", 2))
        elif trapped == "shorts":
            bull.append(_factor("Positioning", "Trapped shorts — squeeze-up potential.", 2))

    regime = str(data.get("regime") or "").lower()
    if regime == "squeeze_pre_breakout":
        neutral.append(_factor("Regime", "Volatility squeeze — breakout pending, direction unconfirmed.", 1))
    elif regime == "choppy":
        neutral.append(_factor("Regime", "Choppy regime — lower signal quality.", 1))
    elif regime == "high_volatility":
        neutral.append(_factor("Regime", "High volatility — wider stops required.", 1))

    # Equity daily-bias headline (equity path exposes bias/bias_reason).
    bias = str(data.get("bias") or "").lower()
    if bias in ("bullish", "bearish"):
        reason = str(data.get("bias_reason") or "").strip()
        tail = f": {reason}" if reason else "."
        (bull if bias == "bullish" else bear).append(
            _factor("Daily bias", f"Daily bias {bias}{tail}", 2))

    if not (bull or bear or neutral):
        return _unavailable(
            "Insufficient indicator data to build an explainable breakdown."
        )

    d = (direction or "").upper()
    own, opp = (bull, bear) if d == "LONG" else (bear, bull) if d == "SHORT" else (
        (bull, bear) if sum(f["weight"] for f in bull) >= sum(f["weight"] for f in bear)
        else (bear, bull)
    )

    strongest = max(own, key=lambda f: f["weight"], default=None)
    strongest_reason = (
        f'{strongest["factor"]}: {strongest["detail"]}' if strongest else None
    )

    top_opp = max(opp, key=lambda f: f["weight"], default=None)
    if top_opp:
        weakest_point = f'{top_opp["factor"]}: {top_opp["detail"]}'
    elif isinstance(setup_grade, (int, float)) and setup_grade <= 4:
        weakest_point = f"Modest conviction — setup grade {int(setup_grade)}/10."
    elif neutral:
        weakest_point = f'{neutral[0]["factor"]}: {neutral[0]["detail"]}'
    else:
        weakest_point = "No major opposing factor — watch for a regime change."

    support = _f(data.get("support"))
    resistance = _f(data.get("resistance"))
    invalidation = plan.get("invalidation")
    if not invalidation:
        if d == "LONG" and support is not None:
            invalidation = f"Sustained move below support {_fmt(support)}."
        elif d == "SHORT" and resistance is not None:
            invalidation = f"Sustained move above resistance {_fmt(resistance)}."

    if d == "LONG":
        confirmation = (
            f"Close above resistance {_fmt(resistance)} on rising volume."
            if resistance is not None
            else "A continuation candle with volume on the trade timeframe."
        )
    elif d == "SHORT":
        confirmation = (
            f"Breakdown below support {_fmt(support)} with volume."
            if support is not None
            else "A continuation candle to the downside with volume."
        )
    else:
        confirmation = "A decisive break of the range with volume before committing."

    return {
        "available": True,
        "unavailable_reason": None,
        "bullish_factors": bull,
        "bearish_factors": bear,
        "neutral_factors": neutral,
        "strongest_reason": strongest_reason,
        "weakest_point": weakest_point,
        "invalidation": invalidation,
        "confirmation_needed": confirmation,
    }


# ── Scenario Engine (#3) ───────────────────────────────────────────────────

def build_scenarios(
    data: Optional[dict],
    plan: Optional[dict],
    *,
    direction: str,
    data_quality: Optional[str] = None,
) -> dict:
    """
    Bullish / bearish / sideways playbooks built ONLY from real levels
    (support, resistance, plan entry/stop/targets, Bollinger bands). When
    no levels are available, returns honest unavailable text — no invented
    price levels.
    """
    data = data or {}
    plan = plan or {}

    support = _f(data.get("support"))
    resistance = _f(data.get("resistance"))
    entry = _f(plan.get("entry"))
    stop = _f(plan.get("stop"))
    tp1 = _f(plan.get("take_profit_1"))
    tp2 = _f(plan.get("take_profit_2"))
    bb_u = _f(data.get("bb_upper"))
    bb_l = _f(data.get("bb_lower"))
    last = _f(data.get("last_price"))

    key_levels: dict[str, float] = {}
    for k, v in (
        ("support", support), ("resistance", resistance),
        ("entry", entry), ("stop", stop),
        ("take_profit_1", tp1), ("take_profit_2", tp2),
        ("bb_upper", bb_u), ("bb_lower", bb_l), ("last_price", last),
    ):
        if v is not None:
            key_levels[k] = v

    has_levels = any(v is not None for v in (support, resistance, entry, stop, tp1))
    if data_quality == "quote_only" or not has_levels:
        reason = (
            "Quote-only data — scenario levels require OHLC history."
            if data_quality == "quote_only"
            else "Defined levels are not available from the current data feed."
        )
        return {
            "available": False,
            "unavailable_reason": reason,
            "bullish_scenario": reason,
            "bearish_scenario": reason,
            "sideways_scenario": reason,
            "key_levels": key_levels,
            "do_not_trade_if": "Do not trade without confirmed levels and live data.",
        }

    up_target = _fmt(tp1 if tp1 is not None else resistance)
    dn_target = _fmt(stop if stop is not None else support)
    res_s, sup_s = _fmt(resistance), _fmt(support)

    bullish = (
        f"Acceptance above {res_s if resistance is not None else _fmt(entry)} "
        f"opens continuation toward {up_target}"
        + (f"; second target {_fmt(tp2)}." if tp2 is not None else ".")
    )
    bearish = (
        f"Rejection at {res_s if resistance is not None else _fmt(entry)} or loss of "
        f"{sup_s if support is not None else _fmt(stop)} opens downside toward {dn_target}."
    )
    if support is not None and resistance is not None:
        sideways = (
            f"Chop between support {sup_s} and resistance {res_s} — fade the "
            f"extremes, stand aside in the middle, no trend trade."
        )
    else:
        sideways = "Range-bound drift with no clean level reaction — stand aside."

    dnt_bits = ["live data is stale/unavailable"]
    regime = str(data.get("regime") or "").lower()
    if regime in ("choppy", "squeeze_pre_breakout"):
        dnt_bits.append(f"regime is '{regime}' and the breakout is unconfirmed")
    dnd = plan.get("do_not_do")
    if isinstance(dnd, list) and dnd:
        dnt_bits.append(str(dnd[0]).rstrip("."))
    do_not_trade_if = "Do not trade if " + "; ".join(dnt_bits) + "."

    return {
        "available": True,
        "unavailable_reason": None,
        "bullish_scenario": bullish,
        "bearish_scenario": bearish,
        "sideways_scenario": sideways,
        "key_levels": key_levels,
        "do_not_trade_if": do_not_trade_if,
    }
