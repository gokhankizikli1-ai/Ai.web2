# coding: utf-8
# Phase 5 — Tool Orchestrator
# Routes AI mode requests to the relevant tools, runs them in parallel, and
# formats the merged context block for injection into the system prompt.
import asyncio
import logging
from typing import Dict, List

logger = logging.getLogger(__name__)

# Mode → tool list. Tools execute concurrently per request.
_MODE_TOOL_MAP: Dict[str, List[str]] = {
    "trading_analyst":        ["market_data", "macro_data"],
    "marketing_dropshipping": ["ecommerce_research", "web_research"],
    # startup_advisor gets the complaint radar first (structured pain
    # clusters + evidence) plus generic web research for anything else.
    "startup_advisor":        ["startup_complaints", "web_research"],
    "research":               ["web_research"],
    "deep_think":             ["web_research"],
    # Phase 6d — safe utility tools, bound to a dedicated mode so the
    # agent can use them without pulling in heavier mode-specific tools.
    "general":                ["calculator", "current_time"],
    # Phase 7b — full market analyst toolkit. Crypto (market_data,
    # macro_data), equities (stock_market), headlines (news), plus the
    # utility tools. Every entry is flag-gated, so an operator can turn
    # on just the subset they want (e.g. stock_market+news only).
    "market":                 [
        "stock_market", "news",
        "market_data", "macro_data",
        "calculator",   "current_time",
    ],
}


async def run_tools_for_mode(
    mode: str,
    query: str,
    context: dict = None,
) -> Dict[str, dict]:
    """Run all tools mapped to a mode in parallel. Returns dict keyed by tool name."""
    try:
        from backend.services.tools.tool_registry import is_enabled, get_tool
    except Exception as exc:
        logger.warning("orchestrator: tool_registry import failed: %s", exc)
        return {}

    tool_names = _MODE_TOOL_MAP.get(mode, [])
    if not tool_names:
        return {}

    async def _call(tool_name: str) -> tuple:
        if not is_enabled(tool_name):
            return tool_name, {
                "tool":    tool_name,
                "status":  "disabled",
                "data":    None,
                "message": (
                    f"{tool_name} is disabled. "
                    f"Set ENABLE_TOOLS=true and ENABLE_{tool_name.upper()}=true to activate."
                ),
                "provider": None,
            }
        tool = get_tool(tool_name)
        if tool is None:
            return tool_name, {
                "tool":    tool_name,
                "status":  "unavailable",
                "data":    None,
                "message": f"{tool_name} is not registered",
                "provider": None,
            }
        result = await tool.safe_run(query, context)
        return tool_name, result

    tasks = [_call(name) for name in tool_names]
    pairs = await asyncio.gather(*tasks, return_exceptions=False)
    return dict(pairs)


# ══════════════════════════════════════════════════════════════════════════════
# Context formatter — produces a human + AI readable block for prompt injection.

def build_tool_context_block(tool_results: Dict[str, dict]) -> str:
    if not tool_results:
        return ""

    sections: list[str] = []
    for tool_name, result in tool_results.items():
        if result.get("status") != "available":
            continue
        data = result.get("data")
        if not data:
            continue
        provider = result.get("provider") or ""
        header   = f"[TOOL: {tool_name.upper()}" + (f" via {provider}" if provider else "") + "]"

        if tool_name == "market_data" and isinstance(data, dict):
            sections.append(header + _format_market_data(data))
        elif tool_name == "macro_data" and isinstance(data, dict):
            sections.append(header + _format_macro_data(data))
        elif tool_name == "startup_complaints" and isinstance(data, dict):
            sections.append(header + _format_startup_complaints(data))
        elif isinstance(data, dict):
            sections.append(header + _format_generic_dict(data))
        else:
            sections.append(f"{header}\n  {data}")

    return ("\n\n".join(sections) + "\n") if sections else ""


def _format_market_data(d: dict) -> str:
    """Render the rich market_data payload (price, MTF, smart money, futures, plan)."""
    lines: list[str] = []

    # — Price + indicators (primary timeframe) —
    lines.append("")
    lines.append("PRICE & STRUCTURE ({}, {} candles)".format(
        d.get("timeframe", "?"), d.get("candles_analyzed", "?")
    ))
    for key in (
        "symbol", "last_price", "change_24h_pct", "volume_24h",
        "rsi_14", "ema20", "ema50", "sma20", "sma50",
        "trend", "volume_trend",
        "support", "resistance", "atr_14", "volatility_pct",
        "bos", "bb_upper", "bb_middle", "bb_lower", "bb_width_pct",
        "bb_squeeze", "bb_position", "regime",
        "bias", "bias_reason",
    ):
        v = d.get(key)
        if v is not None:
            lines.append(f"  {key}: {v}")

    # — Multi-timeframe block —
    mtf = d.get("multi_timeframe")
    if isinstance(mtf, dict) and mtf:
        lines.append("")
        lines.append("MULTI-TIMEFRAME SNAPSHOTS")
        for tf, snap in mtf.items():
            if not isinstance(snap, dict):
                continue
            lines.append(f"  [{tf}]")
            for k, v in snap.items():
                if v is None:
                    continue
                lines.append(f"    {k}: {v}")

    align = d.get("mtf_alignment")
    if isinstance(align, dict):
        lines.append("")
        lines.append("MTF ALIGNMENT")
        lines.append(f"  alignment: {align.get('alignment')}")
        lines.append(
            f"  up: {align.get('up_count')} | down: {align.get('down_count')} | side: {align.get('side_count')}"
        )
        divs = align.get("divergences") or []
        if divs:
            lines.append("  divergences:")
            for div in divs:
                lines.append(f"    - {div}")

    # — Smart money zones (Phase 5.1) —
    zones = d.get("smart_money")
    if isinstance(zones, dict) and zones:
        zones_str = _format_smart_money(zones)
        if zones_str:
            lines.append("")
            lines.append("SMART MONEY ZONES")
            lines.append(zones_str)

    # — Futures microstructure —
    fut = d.get("futures")
    if isinstance(fut, dict) and fut and "_error" not in fut and "error" not in fut:
        lines.append("")
        lines.append("FUTURES MICROSTRUCTURE (Binance USDT-M)")
        for key in (
            "funding_rate_pct", "funding_annualized_pct", "funding_regime",
            "mark_price", "open_interest", "oi_change_24h_pct",
            "long_short_account_ratio", "top_trader_long_short_ratio",
            "taker_buy_sell_ratio", "positioning_signal", "trapped_traders",
        ):
            v = fut.get(key)
            if v is not None:
                lines.append(f"  {key}: {v}")

    # — Auto risk plan (Phase 5.1: + directional_bias / TP3 / risks / actions) —
    plan = d.get("plan")
    if isinstance(plan, dict):
        lines.append("")
        lines.append("AUTO RISK PLAN (ATR-anchored proposal — AI must defend, refine, or veto)")
        for key in (
            "directional_bias", "side_bias", "entry", "stop",
            "take_profit_1", "take_profit_2", "take_profit_3",
            "risk_reward", "stop_atr_multiple", "target_atr_multiple",
            "setup_grade", "bias_strength", "bull_points", "bear_points",
            "fakeout_risk", "liquidity_risk", "trapped_traders",
            "invalidation",
        ):
            v = plan.get(key)
            if v is not None:
                lines.append(f"  {key}: {v}")
        do_now = plan.get("do_now") or []
        if do_now:
            lines.append("  do_now:")
            for item in do_now:
                lines.append(f"    - {item}")
        do_not = plan.get("do_not_do") or []
        if do_not:
            lines.append("  do_not_do:")
            for item in do_not:
                lines.append(f"    - {item}")

    return "\n".join(lines)


def _format_smart_money(z: dict) -> str:
    """Compact renderer for FVG / OB / equal H/L / premium-discount / liquidity / absorption."""
    out: list[str] = []

    pd = z.get("premium_discount")
    if isinstance(pd, dict):
        out.append(
            f"  premium_discount: zone={pd.get('zone')} | "
            f"swing_low={pd.get('swing_low')} | "
            f"eq={pd.get('equilibrium')} | "
            f"swing_high={pd.get('swing_high')}"
        )

    for label, key in (("fvg_bullish", "fvg_bullish"), ("fvg_bearish", "fvg_bearish")):
        fvg = z.get(key)
        if isinstance(fvg, dict):
            out.append(
                f"  {label}: {fvg.get('low')}-{fvg.get('high')} | "
                f"size_atr={fvg.get('size_atr')} | "
                f"distance_pct={fvg.get('distance_pct')} | "
                f"age={fvg.get('age_candles')} candles"
            )

    for label, key in (("order_block_bull", "order_block_bull"), ("order_block_bear", "order_block_bear")):
        ob = z.get(key)
        if isinstance(ob, dict):
            out.append(
                f"  {label}: {ob.get('low')}-{ob.get('high')} | "
                f"distance_pct={ob.get('distance_pct')} | "
                f"age={ob.get('age_candles')} candles"
            )

    eh = z.get("equal_highs") or []
    if eh:
        out.append("  equal_highs (likely buy-stop clusters):")
        for c in eh:
            out.append(f"    - {c['level']} | touches={c['touches']} | distance_pct={c['distance_pct']}")
    el = z.get("equal_lows") or []
    if el:
        out.append("  equal_lows (likely sell-stop clusters):")
        for c in el:
            out.append(f"    - {c['level']} | touches={c['touches']} | distance_pct={c['distance_pct']}")

    la = z.get("liquidity_above") or []
    if la:
        out.append("  liquidity_above (nearby stop pools):")
        for p in la:
            out.append(f"    - {p['level']} | distance_pct={p['distance_pct']}")
    lb = z.get("liquidity_below") or []
    if lb:
        out.append("  liquidity_below (nearby stop pools):")
        for p in lb:
            out.append(f"    - {p['level']} | distance_pct={p['distance_pct']}")

    ab = z.get("absorption_signal")
    if isinstance(ab, dict):
        out.append(
            f"  absorption_signal: {ab.get('type')} | "
            f"vol_ratio={ab.get('vol_ratio')} | "
            f"range_vs_atr={ab.get('range_vs_atr')}"
        )

    return "\n".join(out)


def _format_startup_complaints(d: dict) -> str:
    """Compact [TOOL: STARTUP_COMPLAINTS] block. Only observed data goes
    in — the advisor prompt forbids inventing anything beyond it."""
    lines = [""]
    lines.append(f"Query: {d.get('query', '')}")
    lines.append(f"Generated at: {d.get('generated_at', '')} "
                 f"(timeframe: last {d.get('timeframe_days', '?')} days"
                 + (", cached" if d.get("cached") else "") + ")")
    freshness = d.get("data_freshness") or {}
    if freshness:
        lines.append("Sources: " + ", ".join(
            f"{name}={status}" for name, status in freshness.items()
        ))
    lines.append(f"Confidence: {d.get('confidence', 'low')} | "
                 f"opportunity_score: {d.get('opportunity_score', 0)}/100 | "
                 f"items_analyzed: {d.get('total_items_analyzed', 0)}")

    clusters = d.get("clusters") or []
    if clusters:
        lines.append("Top complaint clusters:")
        for i, c in enumerate(clusters, 1):
            lines.append(
                f"{i}. {c.get('label', '?')} — pain {c.get('pain_score', 0)}/100, "
                f"{c.get('frequency', 0)} signals, "
                f"WTP {c.get('willingness_to_pay_signal', 0)}/100"
            )
            quote = c.get("sample_quote") or ""
            if quote:
                lines.append(f"   quote: \"{quote[:160]}\"")
        lines.append("Evidence:")
        for c in clusters:
            url = c.get("evidence_url") or ""
            if url:
                lines.append(f"- {url}")

    signals = d.get("market_signals") or {}
    signal_lines = []
    for key in ("competitors_mentioned", "trending_keywords",
                "underserved_segments", "common_workarounds"):
        values = signals.get(key) or []
        if values:
            signal_lines.append(f"- {key}: {', '.join(str(v) for v in values[:6])}")
    if signal_lines:
        lines.append("Market signals:")
        lines.extend(signal_lines)

    limitations = d.get("limitations") or ""
    unavailable = [name for name, status in freshness.items() if status != "available"]
    lines.append("Data limitations:")
    if limitations:
        lines.append(f"- {limitations}")
    if unavailable:
        lines.append(f"- sources without data this run: {', '.join(unavailable)}")
    if not limitations and not unavailable:
        lines.append("- none observed; evidence is directional, not exhaustive")
    return "\n".join(lines)


def _format_macro_data(d: dict) -> str:
    lines = [""]
    for key in (
        "regime",
        "btc_dominance_pct", "eth_dominance_pct", "others_dominance_pct",
        "total_market_cap_usd", "total_market_cap_change_24h_pct",
        "total_excl_btc_eth_usd", "active_cryptocurrencies",
        "dxy", "dxy_change_1d_pct", "dxy_source",
    ):
        v = d.get(key)
        if v is not None:
            lines.append(f"  {key}: {v}")
    return "\n".join(lines)


def _format_generic_dict(d: dict) -> str:
    lines = [""]
    for k, v in d.items():
        lines.append(f"  {k}: {v}")
    return "\n".join(lines)
