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
    "startup_advisor":        ["web_research"],
    "research":               ["web_research"],
    "deep_think":             ["web_research"],
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
        elif isinstance(data, dict):
            sections.append(header + _format_generic_dict(data))
        else:
            sections.append(f"{header}\n  {data}")

    return ("\n\n".join(sections) + "\n") if sections else ""


def _format_market_data(d: dict) -> str:
    """Render the rich market_data payload (price block, MTF, futures, plan)."""
    lines: list[str] = []

    # — Price + indicators (primary timeframe) —
    lines.append("")
    lines.append("PRICE & STRUCTURE ({}, {} candles)".format(
        d.get("timeframe", "?"), d.get("candles_analyzed", "?")
    ))
    for key in (
        "symbol", "last_price", "change_24h_pct", "volume_24h",
        "rsi_14", "ema20", "ema50", "trend", "volume_trend",
        "support", "resistance", "atr_14", "volatility_pct",
        "bos", "bb_upper", "bb_middle", "bb_lower", "bb_width_pct",
        "bb_squeeze", "bb_position", "regime",
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

    # — Futures microstructure —
    fut = d.get("futures")
    if isinstance(fut, dict) and fut and "_error" not in fut and "error" not in fut:
        lines.append("")
        lines.append("FUTURES MICROSTRUCTURE (Binance USDT-M)")
        for key in (
            "funding_rate_pct", "funding_annualized_pct", "funding_regime",
            "mark_price", "open_interest", "oi_change_24h_pct",
            "long_short_account_ratio", "top_trader_long_short_ratio",
            "taker_buy_sell_ratio", "positioning_signal",
        ):
            v = fut.get(key)
            if v is not None:
                lines.append(f"  {key}: {v}")

    # — Auto risk plan —
    plan = d.get("plan")
    if isinstance(plan, dict):
        lines.append("")
        lines.append("AUTO RISK PLAN (ATR-anchored proposal — AI must justify or veto)")
        for key in (
            "side_bias", "entry", "stop", "take_profit_1", "take_profit_2",
            "risk_reward", "stop_atr_multiple", "target_atr_multiple",
            "setup_grade", "bias_strength", "bull_points", "bear_points",
            "invalidation",
        ):
            v = plan.get(key)
            if v is not None:
                lines.append(f"  {key}: {v}")

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
