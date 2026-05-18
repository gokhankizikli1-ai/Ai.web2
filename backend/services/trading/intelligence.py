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

    macd = data.get("macd")
    if isinstance(macd, dict):
        st = str(macd.get("state") or "").lower()
        if st == "bullish_cross":
            bull.append(_factor("MACD", "Bullish MACD crossover.", 3))
        elif st == "bullish":
            bull.append(_factor("MACD", "MACD above signal — bullish.", 2))
        elif st == "bearish_cross":
            bear.append(_factor("MACD", "Bearish MACD crossover.", 3))
        elif st == "bearish":
            bear.append(_factor("MACD", "MACD below signal — bearish.", 2))

    mom = data.get("momentum")
    if isinstance(mom, dict):
        st = str(mom.get("state") or "").lower()
        roc = _f(mom.get("roc_pct"))
        tag = f" ({roc:+.2f}%)" if roc is not None else ""
        if st == "accelerating_up":
            bull.append(_factor("Momentum", f"Momentum accelerating up{tag}.", 2))
        elif st == "up":
            bull.append(_factor("Momentum", f"Positive momentum{tag}.", 1))
        elif st == "accelerating_down":
            bear.append(_factor("Momentum", f"Momentum accelerating down{tag}.", 2))
        elif st == "down":
            bear.append(_factor("Momentum", f"Negative momentum{tag}.", 1))

    ts = data.get("trend_strength")
    if isinstance(ts, dict):
        lbl = str(ts.get("label") or "").lower()
        adx = _f(ts.get("adx"))
        adx_tag = f" (ADX {adx:.0f})" if adx is not None else ""
        if lbl in ("strong", "very_strong"):
            neutral.append(_factor("Trend strength", f"Strong directional trend{adx_tag} — moves are reliable.", 1))
        elif lbl in ("weak", "no_trend"):
            neutral.append(_factor("Trend strength", f"Weak/no trend{adx_tag} — chop & fakeout risk.", 1))

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


# ── Multi-factor decision engine (#1 — smarter LONG/SHORT/WAIT) ─────────────
# Transparent weighted scoring across trend, MACD, momentum, RSI, structure,
# volume, MAs, multi-timeframe, positioning and equity bias. A trend-strength
# (ADX) gate raises the bar in weak/no-trend regimes so the engine prefers
# WAIT over forcing a low-quality trade. ADDITIVE: surfaced as `intel`; the
# legacy direction/confidence/setup_grade fields are left untouched.

def build_decision(
    data: Optional[dict],
    plan: Optional[dict],
    *,
    data_quality: Optional[str] = None,
) -> dict:
    data = data or {}
    plan = plan or {}

    def _unavailable(reason: str) -> dict:
        return {
            "available": False,
            "unavailable_reason": reason,
            "direction": "WAIT",
            "confidence_pct": 0,
            "grade": "D",
            "score": 0,
            "bull_weight": 0,
            "bear_weight": 0,
            "factors": [],
            "invalidation": None,
            "rationale": reason,
        }

    if data_quality == "quote_only":
        return _unavailable(
            "Quote-only data — multi-factor scoring requires OHLC history."
        )

    factors: list[dict] = []

    def add(name: str, side: str, weight: int) -> None:
        factors.append({"factor": name, "side": side, "weight": weight})

    trend = str(data.get("trend") or "").lower()
    if trend == "uptrend":
        add("Trend", "bull", 3)
    elif trend == "downtrend":
        add("Trend", "bear", 3)

    macd = data.get("macd")
    if isinstance(macd, dict):
        st = str(macd.get("state") or "").lower()
        if st == "bullish_cross":
            add("MACD", "bull", 3)
        elif st == "bullish":
            add("MACD", "bull", 2)
        elif st == "bearish_cross":
            add("MACD", "bear", 3)
        elif st == "bearish":
            add("MACD", "bear", 2)

    mom = data.get("momentum")
    if isinstance(mom, dict):
        st = str(mom.get("state") or "").lower()
        if st == "accelerating_up":
            add("Momentum", "bull", 2)
        elif st == "up":
            add("Momentum", "bull", 1)
        elif st == "accelerating_down":
            add("Momentum", "bear", 2)
        elif st == "down":
            add("Momentum", "bear", 1)

    rsi = _f(data.get("rsi_14"))
    if rsi is not None:
        if rsi >= 70:
            add("RSI", "bear", 1)        # overbought — pullback risk
        elif rsi <= 30:
            add("RSI", "bull", 1)        # oversold — bounce potential
        elif rsi >= 55:
            add("RSI", "bull", 1)
        elif rsi <= 45:
            add("RSI", "bear", 1)

    bos = str(data.get("bos") or "").lower()
    if bos == "bullish_bos":
        add("Market structure", "bull", 2)
    elif bos == "bearish_bos":
        add("Market structure", "bear", 2)

    vol = str(data.get("volume_trend") or "").lower()
    if vol == "increasing":
        add("Volume", "bull", 1)
    elif vol == "decreasing":
        add("Volume", "bear", 1)

    ema20 = _f(data.get("ema20")) if data.get("ema20") is not None else _f(data.get("sma20"))
    ema50 = _f(data.get("ema50")) if data.get("ema50") is not None else _f(data.get("sma50"))
    if ema20 is not None and ema50 is not None and ema50 != 0:
        if ema20 > ema50 * 1.001:
            add("Moving averages", "bull", 1)
        elif ema20 < ema50 * 0.999:
            add("Moving averages", "bear", 1)

    mtf = data.get("mtf_alignment")
    if isinstance(mtf, dict):
        align = str(mtf.get("alignment") or "").lower()
        if align == "bullish":
            add("Multi-timeframe", "bull", 2)
        elif align == "bullish_partial":
            add("Multi-timeframe", "bull", 1)
        elif align == "bearish":
            add("Multi-timeframe", "bear", 2)
        elif align == "bearish_partial":
            add("Multi-timeframe", "bear", 1)

    sm = data.get("smart_money")
    if isinstance(sm, dict) and isinstance(sm.get("premium_discount"), dict):
        zone = str(sm["premium_discount"].get("zone") or "").lower()
        if zone in ("discount", "deep_discount"):
            add("Premium/Discount", "bull", 1)
        elif zone in ("premium", "deep_premium"):
            add("Premium/Discount", "bear", 1)

    fut = data.get("futures")
    if isinstance(fut, dict):
        trapped = str(fut.get("trapped_traders") or "").lower()
        if trapped == "longs":
            add("Positioning", "bear", 3)
        elif trapped == "shorts":
            add("Positioning", "bull", 3)

    bias = str(data.get("bias") or "").lower()
    if bias == "bullish":
        add("Daily bias", "bull", 2)
    elif bias == "bearish":
        add("Daily bias", "bear", 2)

    bull_w = sum(f["weight"] for f in factors if f["side"] == "bull")
    bear_w = sum(f["weight"] for f in factors if f["side"] == "bear")
    total = bull_w + bear_w
    net = bull_w - bear_w

    if total == 0:
        return {
            "available": True,
            "unavailable_reason": None,
            "direction": "WAIT",
            "confidence_pct": 20,
            "grade": "D",
            "score": 0,
            "bull_weight": 0,
            "bear_weight": 0,
            "factors": [],
            "invalidation": plan.get("invalidation"),
            "rationale": "WAIT — no directional factors available from current data.",
        }

    ts = data.get("trend_strength")
    ts_label = str(ts.get("label")).lower() if isinstance(ts, dict) else ""
    weak_trend = ts_label in ("weak", "no_trend")
    threshold = 6 if weak_trend else 4
    agreement = max(bull_w, bear_w) / total

    if net >= threshold:
        direction = "LONG"
    elif net <= -threshold:
        direction = "SHORT"
    else:
        direction = "WAIT"

    if direction == "WAIT":
        confidence = min(45, 25 + total)
    else:
        confidence = round(45 + abs(net) * 4 + (agreement - 0.5) * 70)
        if ts_label in ("strong", "very_strong"):
            confidence += 6
        elif weak_trend:
            confidence -= 8
        confidence = max(5, min(95, confidence))

    grade = (
        "A" if confidence >= 80 else
        "B" if confidence >= 65 else
        "C" if confidence >= 50 else
        "D"
    )

    support = _f(data.get("support"))
    resistance = _f(data.get("resistance"))
    invalidation = plan.get("invalidation")
    if not invalidation:
        if direction == "LONG" and support is not None:
            invalidation = f"Close below support {_fmt(support)}."
        elif direction == "SHORT" and resistance is not None:
            invalidation = f"Close above resistance {_fmt(resistance)}."

    dominant = "bull" if bull_w >= bear_w else "bear"
    own_side = (
        "bull" if direction == "LONG"
        else "bear" if direction == "SHORT"
        else dominant
    )
    top = sorted(
        [f for f in factors if f["side"] == own_side],
        key=lambda f: f["weight"], reverse=True,
    )[:3]
    if direction == "WAIT":
        gate = (
            "weak/no-trend gate blocked a marginal edge"
            if weak_trend and abs(net) >= 4
            else "no decisive directional edge"
        )
        rationale = f"WAIT — {gate} (bull {bull_w} vs bear {bear_w})."
    else:
        names = ", ".join(t["factor"] for t in top) or "mixed factors"
        rationale = (
            f"{direction} — net {net:+d} from {names}; "
            f"{int(agreement * 100)}% factor agreement, "
            f"trend strength '{ts_label or 'n/a'}'."
        )

    return {
        "available": True,
        "unavailable_reason": None,
        "direction": direction,
        "confidence_pct": int(confidence),
        "grade": grade,
        "score": net,
        "bull_weight": bull_w,
        "bear_weight": bear_w,
        "factors": factors,
        "invalidation": invalidation,
        "rationale": rationale,
    }


# ── Raw analytics pass-through (institutional drawer) ──────────────────────
# Surfaces the numbers market_data_tool ALREADY computed so the UI can show
# real values (MTF, momentum, volatility, MACD, ADX, regime) instead of
# prose. Pure pass-through — nothing is computed or fabricated here; absent
# inputs stay absent.

def build_analytics(
    data: Optional[dict],
    *,
    data_quality: Optional[str] = None,
) -> dict:
    data = data or {}

    base = {
        "available": False,
        "unavailable_reason": None,
        "regime": None,
        "trend": None,
        "rsi_14": None,
        "ema20": None,
        "ema50": None,
        "bos": None,
        "volume_trend": None,
        "atr_14": None,
        "volatility_pct": None,
        "macd": None,
        "momentum": None,
        "trend_strength": None,
        "mtf": None,
        "timeframes": None,
    }

    if data_quality == "quote_only":
        base["unavailable_reason"] = (
            "Quote-only data — technical analytics require OHLC history."
        )
        return base

    rsi = _f(data.get("rsi_14"))
    trend = data.get("trend")
    regime = data.get("regime")
    if rsi is None and not trend and not regime:
        base["unavailable_reason"] = "No OHLC-derived analytics available."
        return base

    out = dict(base)
    out["available"] = True
    out["regime"] = str(regime) if regime else None
    out["trend"] = str(trend) if trend else None
    out["rsi_14"] = rsi
    out["ema20"] = _f(data.get("ema20")) if data.get("ema20") is not None else _f(data.get("sma20"))
    out["ema50"] = _f(data.get("ema50")) if data.get("ema50") is not None else _f(data.get("sma50"))
    out["bos"] = str(data.get("bos")) if data.get("bos") else None
    out["volume_trend"] = str(data.get("volume_trend")) if data.get("volume_trend") else None
    out["atr_14"] = _f(data.get("atr_14"))
    out["volatility_pct"] = _f(data.get("volatility_pct"))

    macd = data.get("macd")
    if isinstance(macd, dict):
        out["macd"] = {
            "macd": _f(macd.get("macd")),
            "signal": _f(macd.get("signal")),
            "hist": _f(macd.get("hist")),
            "state": str(macd.get("state") or "insufficient_data"),
        }

    mom = data.get("momentum")
    if isinstance(mom, dict):
        out["momentum"] = {
            "roc_pct": _f(mom.get("roc_pct")),
            "state": str(mom.get("state") or "insufficient_data"),
        }

    ts = data.get("trend_strength")
    if isinstance(ts, dict):
        out["trend_strength"] = {
            "adx": _f(ts.get("adx")),
            "label": str(ts.get("label") or "insufficient_data"),
        }

    mtf = data.get("mtf_alignment")
    if isinstance(mtf, dict):
        divs = mtf.get("divergences")
        out["mtf"] = {
            "alignment": str(mtf.get("alignment") or "unknown"),
            "up": int(mtf.get("up_count") or 0),
            "down": int(mtf.get("down_count") or 0),
            "side": int(mtf.get("side_count") or 0),
            "divergences": [str(d) for d in divs] if isinstance(divs, list) else [],
        }

    mt = data.get("multi_timeframe")
    if isinstance(mt, dict):
        rows = []
        for tf, blk in mt.items():
            if isinstance(blk, dict):
                rows.append({
                    "tf": str(tf),
                    "trend": str(blk.get("trend") or "—"),
                    "rsi": _f(blk.get("rsi")),
                })
        out["timeframes"] = rows or None

    return out


# ── Multi-timeframe alignment engine (Phase 2 #1) ──────────────────────────
# Consumes the multi_timeframe block market_data_tool ALREADY computed.
# Never fabricates a timeframe bias: a TF the feed didn't return is marked
# "unavailable" (not guessed). The canonical desk set is 15m/1h/4h/1d; the
# crypto feed currently provides 1h/4h/1d, so 15m honestly shows
# "unavailable" rather than an invented value.

_CANON_TF = ["15m", "1h", "4h", "1d"]
_LOWER_TF = {"15m", "1h"}
_HIGHER_TF = {"4h", "1d"}


def build_mtf(data: Optional[dict], *, data_quality: Optional[str] = None) -> dict:
    data = data or {}

    base = {
        "available": False,
        "unavailable_reason": None,
        "timeframes": [{"tf": tf, "bias": "unavailable", "rsi": None} for tf in _CANON_TF],
        "alignment": None,
        "agreement_pct": None,
        "score": 0,
        "conflict": False,
        "summary": None,
    }

    if data_quality == "quote_only":
        base["unavailable_reason"] = (
            "Quote-only data — multi-timeframe analysis requires OHLC history."
        )
        return base

    mt = data.get("multi_timeframe")
    if not isinstance(mt, dict) or not mt:
        base["unavailable_reason"] = (
            "Multi-timeframe data unavailable for this symbol/feed."
        )
        return base

    rows: list[dict] = []
    present: list[tuple] = []   # (tf, bias) for TFs the feed actually returned
    for tf in _CANON_TF:
        blk = mt.get(tf)
        if isinstance(blk, dict) and blk.get("trend"):
            tr = str(blk.get("trend")).lower()
            bias = (
                "bullish" if tr == "uptrend"
                else "bearish" if tr == "downtrend"
                else "neutral"
            )
            rows.append({"tf": tf, "bias": bias, "rsi": _f(blk.get("rsi"))})
            present.append((tf, bias))
        else:
            rows.append({"tf": tf, "bias": "unavailable", "rsi": None})

    if not present:
        base["timeframes"] = rows
        base["unavailable_reason"] = (
            "Multi-timeframe data unavailable for this symbol/feed."
        )
        return base

    n = len(present)
    bulls = sum(1 for _, b in present if b == "bullish")
    bears = sum(1 for _, b in present if b == "bearish")
    neu = n - bulls - bears
    if bulls > bears and bulls >= neu:
        alignment = "bullish"
    elif bears > bulls and bears >= neu:
        alignment = "bearish"
    else:
        alignment = "mixed"
    agreement_pct = round(max(bulls, bears) / n * 100)
    score = round((bulls - bears) / n, 3)

    hi = [b for tf, b in present if tf in _HIGHER_TF and b in ("bullish", "bearish")]
    lo = [b for tf, b in present if tf in _LOWER_TF and b in ("bullish", "bearish")]
    conflict = False
    summary = None
    if hi and lo:
        hi_bias = "bullish" if hi.count("bullish") >= hi.count("bearish") else "bearish"
        lo_bias = "bullish" if lo.count("bullish") >= lo.count("bearish") else "bearish"
        if hi_bias != lo_bias:
            conflict = True
            summary = (
                "Counter-trend long risk elevated — lower timeframes bullish "
                "while higher timeframes bearish."
                if lo_bias == "bullish"
                else
                "Counter-trend short risk elevated — lower timeframes bearish "
                "while higher timeframes bullish."
            )
    if summary is None:
        if alignment == "bullish":
            summary = f"Timeframes aligned bullish ({agreement_pct}% agreement) — trend continuation favoured."
        elif alignment == "bearish":
            summary = f"Timeframes aligned bearish ({agreement_pct}% agreement) — trend continuation favoured."
        else:
            summary = "Mixed timeframe structure — chop/range, no aligned trend."

    return {
        "available": True,
        "unavailable_reason": None,
        "timeframes": rows,
        "alignment": alignment,
        "agreement_pct": agreement_pct,
        "score": score,
        "conflict": conflict,
        "summary": summary,
    }


# ── Volume & liquidity intelligence (Phase 2 #2) ───────────────────────────
# Pure derivation from values market_data_tool ALREADY computed
# (volume_trend, bos, regime, bb_squeeze, volatility, smart_money
# absorption + liquidity pools). No raw OHLC needed; nothing fabricated —
# absent inputs → honest unavailable / "unknown".

def build_volume(data: Optional[dict], *, data_quality: Optional[str] = None) -> dict:
    data = data or {}

    base = {
        "available": False,
        "unavailable_reason": None,
        "volume_trend": None,
        "participation": "unknown",
        "participation_note": "",
        "anomalies": [],
        "breakout_quality": None,
        "breakout_note": "",
        "liquidity_sweep_risk": "unknown",
        "liquidity_note": "",
        "volume_confidence": 0,
        "summary": None,
    }

    if data_quality == "quote_only":
        base["unavailable_reason"] = (
            "Quote-only data — volume/liquidity analysis requires OHLC + volume history."
        )
        return base

    vt = data.get("volume_trend")
    sm = data.get("smart_money") if isinstance(data.get("smart_money"), dict) else {}
    absorption = sm.get("absorption_signal") if isinstance(sm, dict) else None
    regime = str(data.get("regime") or "").lower()
    bos = str(data.get("bos") or "").lower()

    if not vt and not isinstance(absorption, dict) and not regime:
        base["unavailable_reason"] = "Volume feed unavailable for this symbol."
        return base

    out = dict(base)
    out["available"] = True
    out["volume_trend"] = str(vt) if vt else None

    # Participation quality
    if vt == "increasing":
        out["participation"] = "expanding"
        out["participation_note"] = "Participation expanding — moves are being supported."
    elif vt == "decreasing":
        out["participation"] = "contracting"
        out["participation_note"] = "Participation contracting — moves poorly supported."
    elif vt == "neutral":
        out["participation"] = "flat"
        out["participation_note"] = "Flat participation — no conviction either way."
    else:
        out["participation"] = "unknown"
        out["participation_note"] = "Volume trend unavailable."

    # Breakout quality (structure break × participation)
    if bos in ("bullish_bos", "bearish_bos"):
        if vt == "increasing":
            out["breakout_quality"] = "confirmed"
            out["breakout_note"] = "Momentum confirmed by expanding participation."
        elif vt in ("decreasing", "neutral"):
            out["breakout_quality"] = "weak"
            out["breakout_note"] = "Breakout unsupported by volume — fakeout risk."
        else:
            out["breakout_quality"] = "unconfirmed"
            out["breakout_note"] = "Structure break with no volume read — unconfirmed."
    elif regime == "squeeze_pre_breakout" or data.get("bb_squeeze") is True:
        out["breakout_quality"] = "pending"
        out["breakout_note"] = "Coiled / squeeze — breakout pending, needs volume to confirm."
    elif bos == "range":
        out["breakout_quality"] = "none"
        out["breakout_note"] = "No structure break — ranging."
    else:
        out["breakout_quality"] = "unknown"
        out["breakout_note"] = "Breakout context unavailable."

    # Anomalies (only when the underlying signal is actually present)
    anomalies: list[str] = []
    vol_ratio = _f(absorption.get("vol_ratio")) if isinstance(absorption, dict) else None
    range_vs_atr = _f(absorption.get("range_vs_atr")) if isinstance(absorption, dict) else None
    if vol_ratio is not None and vol_ratio >= 2.0:
        anomalies.append(f"Abnormal volume spike (×{vol_ratio:.1f}).")
    if (vt == "decreasing" and regime in ("low_volatility", "choppy", "neutral")
            and data.get("bb_squeeze") is not True):
        anomalies.append("Dead volume environment.")
    if regime == "high_volatility":
        anomalies.append("Volatility expansion underway.")
    if (isinstance(absorption, dict) and absorption.get("type")
            and range_vs_atr is not None and range_vs_atr <= 0.6
            and vol_ratio is not None and vol_ratio >= 1.5):
        anomalies.append(f"Exhaustion/absorption volume ({absorption.get('type')}).")

    # Liquidity sweep risk from nearest pre-computed liquidity pool
    def _nearest(pools) -> Optional[float]:
        if not isinstance(pools, list):
            return None
        ds = [_f(p.get("distance_pct")) for p in pools if isinstance(p, dict)]
        ds = [abs(d) for d in ds if d is not None]
        return min(ds) if ds else None

    near_above = _nearest(sm.get("liquidity_above")) if isinstance(sm, dict) else None
    near_below = _nearest(sm.get("liquidity_below")) if isinstance(sm, dict) else None
    nearest = min([d for d in (near_above, near_below) if d is not None], default=None)
    if nearest is None:
        out["liquidity_sweep_risk"] = "unknown"
        out["liquidity_note"] = "No mapped liquidity pools for this symbol."
    elif nearest <= 0.5:
        out["liquidity_sweep_risk"] = "elevated"
        out["liquidity_note"] = f"Liquidity pool ~{nearest:.2f}% away — sweep/stop-hunt risk elevated."
        anomalies.append("Liquidity sweep risk elevated.")
    elif nearest <= 1.5:
        out["liquidity_sweep_risk"] = "moderate"
        out["liquidity_note"] = f"Liquidity pool ~{nearest:.2f}% away — moderate sweep risk."
    else:
        out["liquidity_sweep_risk"] = "low"
        out["liquidity_note"] = f"Nearest liquidity pool ~{nearest:.2f}% away — low sweep risk."

    out["anomalies"] = anomalies

    # Volume confidence (0-100), bounded
    score = 50
    if out["participation"] == "expanding":
        score += 20
    elif out["participation"] == "contracting":
        score -= 15
    if out["breakout_quality"] == "confirmed":
        score += 20
    elif out["breakout_quality"] == "weak":
        score -= 20
    elif out["breakout_quality"] == "pending":
        score -= 5
    if vol_ratio is not None and vol_ratio >= 2.0:
        score += 8 if out["breakout_quality"] == "confirmed" else -8
    if "Dead volume environment." in anomalies:
        score -= 20
    if any(a.startswith("Exhaustion") for a in anomalies):
        score -= 10
    if out["liquidity_sweep_risk"] == "elevated":
        score -= 8
    out["volume_confidence"] = max(0, min(100, score))

    primary = (
        out["breakout_note"] if out["breakout_quality"] in ("confirmed", "weak")
        else out["participation_note"]
    )
    extra = f" {anomalies[0]}" if anomalies else ""
    out["summary"] = f"{primary}{extra}".strip()

    return out


# ── Advanced confidence engine (Phase 2 #3) ────────────────────────────────
# A transparent, weighted confidence model with a per-factor explanation.
# ADDITIVE: surfaced as `confidence`; the existing `intel`/legacy
# confidence fields are left UNCHANGED so nothing downstream regresses.
# Pure; honest available:false on quote-only / no usable factors.

def build_confidence(
    data: Optional[dict],
    plan: Optional[dict],
    *,
    direction: str,
    data_quality: Optional[str] = None,
) -> dict:
    data = data or {}
    plan = plan or {}
    d = (direction or "").upper()

    def _unavailable(reason: str) -> dict:
        return {
            "available": False,
            "unavailable_reason": reason,
            "confidence": 0,
            "conviction": "very_low",
            "grade": "D",
            "factors": [],
            "explanation": reason,
        }

    if data_quality == "quote_only":
        return _unavailable(
            "Quote-only data — confidence scoring requires OHLC indicators."
        )

    factors: list[dict] = []

    def add(name: str, impact: int, state: str, note: str) -> None:
        factors.append({"name": name, "impact": impact, "state": state, "note": note})

    want_long = d == "LONG"
    want_short = d == "SHORT"

    def aligned(bullish: bool) -> int:
        # +1 if the factor agrees with the trade direction, -1 if against,
        # 0 if direction is WAIT/unknown (factor still recorded, no push).
        if want_long:
            return 1 if bullish else -1
        if want_short:
            return -1 if bullish else 1
        return 0

    trend = str(data.get("trend") or "").lower()
    if trend in ("uptrend", "downtrend"):
        s = aligned(trend == "uptrend")
        add("Trend alignment", 12 * s, trend,
            "Primary trend agrees." if s > 0 else "Primary trend opposes." if s < 0 else "Primary trend noted.")

    mtf = data.get("mtf_alignment")
    if isinstance(mtf, dict):
        al = str(mtf.get("alignment") or "").lower()
        if al.startswith("bullish") or al.startswith("bearish"):
            s = aligned(al.startswith("bullish"))
            w = 10 if al in ("bullish", "bearish") else 6
            add("Multi-timeframe", w * s, al,
                "Timeframes agree." if s > 0 else "Timeframes conflict." if s < 0 else "Timeframes noted.")
        elif al == "mixed":
            add("Multi-timeframe", -5, "mixed", "Mixed timeframe structure.")

    rsi = _f(data.get("rsi_14"))
    if rsi is not None:
        if rsi >= 70:
            add("RSI state", -4, f"overbought {rsi:.0f}", "Overbought — pullback risk.")
        elif rsi <= 30:
            add("RSI state", -4, f"oversold {rsi:.0f}", "Oversold — bounce risk.")
        elif rsi >= 55:
            add("RSI state", 6 * (aligned(True) or 1) if d in ("LONG", "SHORT") else 3,
                f"{rsi:.0f}", "Momentum tilts bullish.")
        elif rsi <= 45:
            add("RSI state", 6 * (aligned(False) or 1) if d in ("LONG", "SHORT") else 3,
                f"{rsi:.0f}", "Momentum tilts bearish.")

    macd = data.get("macd")
    if isinstance(macd, dict):
        st = str(macd.get("state") or "").lower()
        if st in ("bullish", "bullish_cross"):
            s = aligned(True)
            add("MACD agreement", 10 * s, st, "MACD supports." if s >= 0 else "MACD opposes.")
        elif st in ("bearish", "bearish_cross"):
            s = aligned(False)
            add("MACD agreement", 10 * s, st, "MACD supports." if s >= 0 else "MACD opposes.")

    regime = str(data.get("regime") or "").lower()
    if regime:
        rmap = {
            "trending_up": 6, "trending_down": 6, "squeeze_pre_breakout": -3,
            "high_volatility": -6, "low_volatility": -2, "choppy": -10,
        }
        if regime in rmap:
            add("Market regime", rmap[regime], regime, f"Regime: {regime.replace('_', ' ')}.")

    vol_pct = _f(data.get("volatility_pct"))
    if vol_pct is not None:
        if vol_pct >= 6.0:
            add("ATR / volatility", -4, f"{vol_pct:.1f}% expanding", "Volatility expansion — wider risk.")
        elif vol_pct < 1.0:
            add("ATR / volatility", -2, f"{vol_pct:.1f}% compressed", "Volatility compressed — muted moves.")

    vt = str(data.get("volume_trend") or "").lower()
    if vt == "increasing":
        add("Volume confirmation", 8, "increasing", "Participation expanding.")
    elif vt == "decreasing":
        add("Volume confirmation", -8, "decreasing", "Participation contracting.")

    bos = str(data.get("bos") or "").lower()
    if bos in ("bullish_bos", "bearish_bos"):
        s = aligned(bos == "bullish_bos")
        add("Structure quality", 8 * s, bos, "Structure break agrees." if s > 0 else "Structure break opposes." if s < 0 else "Structure break noted.")
        if vt == "increasing":
            add("Breakout quality", 8 * (s or 1), "confirmed", "Break confirmed by volume.")
        elif vt == "decreasing":
            add("Breakout quality", -8, "weak", "Break unsupported by volume.")
    elif bos == "range":
        add("Structure quality", -2, "range", "Ranging — no structure break.")

    last = _f(data.get("last_price"))
    sup = _f(data.get("support"))
    res = _f(data.get("resistance"))
    if last and last > 0:
        if res is not None and abs(res - last) / last <= 0.005:
            add("S/R proximity", -6 if want_long else 4 if want_short else -2,
                "at resistance", "Price into resistance.")
        elif sup is not None and abs(last - sup) / last <= 0.005:
            add("S/R proximity", 4 if want_long else -6 if want_short else -2,
                "at support", "Price at support.")

    raw_bias = str(plan.get("directional_bias") or "").upper()
    if raw_bias in ("LONG", "SHORT") and d in ("LONG", "SHORT"):
        add("Directional agreement", 6 if raw_bias == d else -6, raw_bias,
            "Risk plan agrees." if raw_bias == d else "Risk plan disagrees.")

    mom = data.get("momentum")
    if isinstance(mom, dict):
        st = str(mom.get("state") or "").lower()
        if st in ("accelerating_up", "up"):
            s = aligned(True)
            add("Momentum acceleration", (8 if st == "accelerating_up" else 4) * (s or 1), st,
                "Momentum accelerating." if "accel" in st else "Momentum positive.")
        elif st in ("accelerating_down", "down"):
            s = aligned(False)
            add("Momentum acceleration", (8 if st == "accelerating_down" else 4) * (s or 1), st,
                "Momentum accelerating down." if "accel" in st else "Momentum negative.")

    if not factors:
        return _unavailable("Insufficient indicators to score confidence.")

    confidence = max(0, min(100, 50 + sum(f["impact"] for f in factors)))
    conviction = (
        "institutional" if confidence >= 85 else
        "high" if confidence >= 70 else
        "moderate" if confidence >= 55 else
        "low" if confidence >= 40 else
        "very_low"
    )
    grade = (
        "A" if confidence >= 80 else
        "B" if confidence >= 65 else
        "C" if confidence >= 50 else
        "D"
    )

    pos = sorted([f for f in factors if f["impact"] > 0], key=lambda f: -f["impact"])[:3]
    neg = sorted([f for f in factors if f["impact"] < 0], key=lambda f: f["impact"])[:2]
    headline = {
        "institutional": "Institutional-quality setup",
        "high": "High-conviction setup",
        "moderate": "Moderate-conviction setup",
        "low": "Low-conviction environment",
        "very_low": "Very low conviction",
    }[conviction]
    drivers = ", ".join(f["name"].lower() for f in pos) or "no strong supporting factors"
    risks = ", ".join(f["name"].lower() for f in neg)
    explanation = (
        f"{confidence}% — {headline}. Driven by {drivers}"
        + (f"; main risk: {risks}." if risks else ".")
    )

    return {
        "available": True,
        "unavailable_reason": None,
        "confidence": confidence,
        "conviction": conviction,
        "grade": grade,
        "factors": factors,
        "explanation": explanation,
    }

