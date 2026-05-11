# coding: utf-8
# Phase 5 — Macro Data Tool
# Pulls global market regime context for trading_analyst:
#   - BTC dominance (BTC.D)
#   - Total crypto market cap & ETH-excluded variant
#   - DXY (US Dollar Index) snapshot via Yahoo Finance
#
# All fetches are independent and tolerant to partial failure — any subset of
# fields may be present in the result. Crypto-side calls use CoinGecko public
# /global endpoint (no API key required, 30 req/min free tier).
#
# Activate: ENABLE_TOOLS=true ENABLE_MACRO_DATA=true
import os
import json
import asyncio
import logging
import urllib.request
import urllib.error
from backend.services.tools.base_tool import BaseTool

logger = logging.getLogger(__name__)

_COINGECKO_BASE = "https://api.coingecko.com/api/v3"
_TIMEOUT        = 8


class MacroDataTool(BaseTool):
    name = "macro_data"
    description = (
        "Global market regime: BTC dominance, total crypto market cap, "
        "ETH-excluded market cap, and DXY snapshot. Used by trading_analyst to "
        "ground analysis in macro context."
    )

    async def run(self, query: str, context: dict = None) -> dict:
        global_res, dxy_res = await asyncio.gather(
            _safe(_fetch_global()),
            _safe(_fetch_dxy()),
        )

        data: dict = {}

        if isinstance(global_res, dict) and "_error" not in global_res:
            data.update(global_res)

        if isinstance(dxy_res, dict) and "_error" not in dxy_res:
            data.update(dxy_res)

        if not data:
            return self._unavailable("Macro providers unreachable")

        data["regime"] = _macro_regime(data)
        return self._ok(data, provider="coingecko+yahoo")


# ══════════════════════════════════════════════════════════════════════════════

async def _safe(coro):
    try:
        return await coro
    except Exception as exc:
        return {"_error": str(exc)}


async def _fetch_global() -> dict:
    """CoinGecko /global → BTC dominance, total market cap, 24h cap change."""
    raw = await _fetch_json(f"{_COINGECKO_BASE}/global", timeout=_TIMEOUT)
    data = raw.get("data") if isinstance(raw, dict) else None
    if not isinstance(data, dict):
        raise ValueError("CoinGecko /global returned no data")

    mcap_usd          = float(data.get("total_market_cap", {}).get("usd", 0) or 0)
    mcap_change_24h   = float(data.get("market_cap_change_percentage_24h_usd", 0) or 0)
    btc_dom           = float(data.get("market_cap_percentage", {}).get("btc", 0) or 0)
    eth_dom           = float(data.get("market_cap_percentage", {}).get("eth", 0) or 0)
    active_coins      = int(data.get("active_cryptocurrencies", 0) or 0)

    others_dom = max(0.0, 100.0 - btc_dom - eth_dom)
    total_excl_btc_eth = mcap_usd * (others_dom / 100.0) if mcap_usd else 0.0

    return {
        "total_market_cap_usd":      round(mcap_usd, 0),
        "total_market_cap_change_24h_pct": round(mcap_change_24h, 2),
        "btc_dominance_pct":         round(btc_dom, 2),
        "eth_dominance_pct":         round(eth_dom, 2),
        "others_dominance_pct":      round(others_dom, 2),
        "total_excl_btc_eth_usd":    round(total_excl_btc_eth, 0),
        "active_cryptocurrencies":   active_coins,
    }


async def _fetch_dxy() -> dict:
    """Pull DXY (US Dollar Index) via yfinance — runs in thread."""
    def _sync():
        try:
            import yfinance as yf  # noqa: PLC0415
        except ImportError:
            return None
        # DX=F (futures) is the most reliable global symbol; fall back to DX-Y.NYB
        for sym in ("DX=F", "DX-Y.NYB"):
            try:
                hist = yf.Ticker(sym).history(period="7d", interval="1d")
                if hist.empty:
                    continue
                hist = hist.dropna(subset=["Close"])
                closes = list(hist["Close"])
                if len(closes) < 2:
                    continue
                last = closes[-1]
                prev = closes[-2]
                change_pct = (last - prev) / prev * 100 if prev else 0.0
                return {
                    "dxy":                round(float(last), 3),
                    "dxy_change_1d_pct":  round(float(change_pct), 2),
                    "dxy_source":         sym,
                }
            except Exception:
                continue
        return None

    res = await asyncio.get_event_loop().run_in_executor(None, _sync)
    if not res:
        raise ValueError("DXY unavailable from yfinance")
    return res


def _macro_regime(data: dict) -> str:
    """Classify macro regime in one phrase from the snapshot."""
    btc_dom    = data.get("btc_dominance_pct", 0)
    mcap_delta = data.get("total_market_cap_change_24h_pct", 0)
    dxy_delta  = data.get("dxy_change_1d_pct", 0)

    risk_on  = mcap_delta > 1.5 and dxy_delta < 0
    risk_off = mcap_delta < -1.5 and dxy_delta > 0

    if risk_on:
        return "risk_on"
    if risk_off:
        return "risk_off"
    if btc_dom >= 55:
        return "btc_dominance_high"  # alts under pressure
    if btc_dom <= 45:
        return "alt_season_setup"
    return "neutral"


# ══════════════════════════════════════════════════════════════════════════════

async def _fetch_json(url: str, timeout: int = 10):
    try:
        import aiohttp  # noqa: PLC0415
        async with aiohttp.ClientSession() as session:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=timeout)) as resp:
                if resp.status != 200:
                    raise RuntimeError(f"HTTP {resp.status} from {url}")
                return await resp.json(content_type=None)
    except ImportError:
        pass

    def _sync():
        try:
            with urllib.request.urlopen(url, timeout=timeout) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as exc:
            raise RuntimeError(f"HTTP {exc.code} from {url}") from exc

    return await asyncio.get_event_loop().run_in_executor(None, _sync)
