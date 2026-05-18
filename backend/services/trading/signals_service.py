# coding: utf-8
# Phase T1 — Trading signals service.
#
# Pure mapping layer on top of the existing Phase 5+ market_data_tool.
# Converts the market_data tool's rich payload into the compact "trading
# signal card" shape expected by the frontend Trading tab.
#
# Honest about failure: if market_data_tool returns status != available,
# we emit is_live=false with a non-null `error` field and NO fabricated
# prices, levels, or directions.
#
# Public API:
#   signal_for_symbol(symbol, timeframe) -> dict   # async
#   signals_for_symbols(symbols, timeframe) -> {signals: [...], …}   # async
#   resolve_asset_type(symbol) -> str
#   resolve_display_name(symbol) -> str
import os
import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)


# ── Observability counters (surfaced via /tools/health) ─────────────────────
#
# Public shape (per the T1 spec) at /tools/health.trading:
#   {
#     enabled,             # bool — ENABLE_TRADING_SIGNALS=true
#     endpoint_available,  # bool — route registered + service importable
#     providers,           # dict of provider name → success count
#                          #   Binance / Yahoo / AlphaVantage / CoinGecko
#     last_success,        # ISO timestamp of last request with at least
#                          # one is_live signal (null if never)
#     last_error,          # truncated last error string (string | "")
#     # extra observability fields (not in spec but useful for debugging):
#     requests_total, requests_ok, requests_error,
#     symbols_resolved, symbols_failed, last_run_at,
#   }

import threading
_LOCK   = threading.Lock()

# Canonical provider list — matches the market_data_tool's fallback chain.
_PROVIDER_NAMES = ("Binance", "Yahoo", "AlphaVantage", "CoinGecko")

_COUNTS = {
    "requests_total":    0,
    "requests_ok":       0,
    "requests_error":    0,
    "symbols_resolved":  0,
    "symbols_failed":    0,
    "last_error":        "",
    "last_run_at":       None,
    "last_success":      None,           # ISO timestamp of last is_live=true result
    # Per-provider success counters (incremented when a signal resolves
    # via that provider). Used to populate `providers` in stats().
    "_provider_counts":  {n: 0 for n in _PROVIDER_NAMES},
}


def _normalize_provider_name(raw: str) -> str:
    """Map market_data_tool's lowercase tag (binance, yahoo_finance, ...)
    to the canonical CamelCase name the frontend expects."""
    if not raw:
        return ""
    p = raw.strip().lower()
    if "binance" in p:                       return "Binance"
    if "yahoo" in p:                         return "Yahoo"
    if "alpha" in p or p in ("av", "alpha_vantage", "alphavantage"):
                                             return "AlphaVantage"
    if "coingecko" in p or p == "coin" or "gecko" in p:
                                             return "CoinGecko"
    return ""    # unknown providers don't pollute the counters


def _bump(field_: str, n: int = 1, error: str = "") -> None:
    with _LOCK:
        _COUNTS[field_] = _COUNTS.get(field_, 0) + n
        if error:
            _COUNTS["last_error"] = error[:140]
        _COUNTS["last_run_at"] = datetime.now(timezone.utc).isoformat()


def _record_success(provider_raw: Optional[str]) -> None:
    """Bump the per-provider counter + last_success timestamp."""
    with _LOCK:
        _COUNTS["last_success"] = datetime.now(timezone.utc).isoformat()
        canonical = _normalize_provider_name(provider_raw or "")
        if canonical and canonical in _COUNTS["_provider_counts"]:
            _COUNTS["_provider_counts"][canonical] += 1


def _endpoint_available() -> bool:
    """True if the service module is importable AND the route module loads.
    Surfaced as `endpoint_available` so /tools/health can show whether the
    endpoint is wired even when the flag is off."""
    try:
        from backend.routes import trading  # noqa: F401
        return True
    except Exception:
        return False


def stats() -> dict:
    with _LOCK:
        provider_counts = dict(_COUNTS["_provider_counts"])
        return {
            # Required by spec (in this exact order for readability):
            "enabled":            is_enabled(),
            "endpoint_available": _endpoint_available(),
            "providers":          provider_counts,
            "last_success":       _COUNTS["last_success"],
            "last_error":         _COUNTS["last_error"],
            # Useful extras for debugging:
            "requests_total":     _COUNTS["requests_total"],
            "requests_ok":        _COUNTS["requests_ok"],
            "requests_error":     _COUNTS["requests_error"],
            "symbols_resolved":   _COUNTS["symbols_resolved"],
            "symbols_failed":     _COUNTS["symbols_failed"],
            "last_run_at":        _COUNTS["last_run_at"],
        }


def is_enabled() -> bool:
    return os.getenv("ENABLE_TRADING_SIGNALS", "false").strip().lower() == "true"


# ── Asset-type + name lookups ──────────────────────────────────────────────
# Conservative: curated lists for the obvious cases, fallback heuristics
# for unknown symbols. The display name table only contains symbols we're
# confident in — unknown ones echo the symbol as-is.

_CRYPTO_TICKERS = {
    "BTC", "ETH", "BNB", "SOL", "XRP", "ADA", "DOGE", "MATIC", "DOT", "AVAX",
    "LINK", "UNI", "ATOM", "LTC", "ETC", "XLM", "ALGO", "VET", "FIL", "TRX",
    "NEAR", "SAND", "MANA", "APE", "AAVE", "CRV", "SUSHI", "ARB", "OP", "INJ",
    "SUI", "APT", "PEPE", "SHIB", "FLOKI", "TON", "USDT", "USDC", "DAI",
}

_CRYPTO_QUOTES = ("USDT", "BUSD", "USD", "USDC", "EUR", "BTC", "ETH")

_DISPLAY_NAMES = {
    # Crypto (base ticker — match before normalisation)
    "BTC":  "Bitcoin",        "ETH":  "Ethereum",       "BNB":  "BNB",
    "SOL":  "Solana",         "XRP":  "XRP",            "ADA":  "Cardano",
    "DOGE": "Dogecoin",       "MATIC":"Polygon",        "DOT":  "Polkadot",
    "AVAX": "Avalanche",      "LINK": "Chainlink",      "UNI":  "Uniswap",
    "ATOM": "Cosmos",         "LTC":  "Litecoin",       "ETC":  "Ethereum Classic",
    "XLM":  "Stellar",        "ALGO": "Algorand",       "TRX":  "Tron",
    "NEAR": "Near Protocol",  "ARB":  "Arbitrum",       "OP":   "Optimism",
    "INJ":  "Injective",      "SUI":  "Sui",            "APT":  "Aptos",
    "PEPE": "Pepe",           "SHIB": "Shiba Inu",      "TON":  "Toncoin",
    "FIL":  "Filecoin",       "VET":  "VeChain",        "AAVE": "Aave",
    "CRV":  "Curve DAO",      "MANA": "Decentraland",   "SAND": "The Sandbox",
    "APE":  "ApeCoin",        "FLOKI":"Floki",
    # Major US stocks
    "AAPL": "Apple",          "MSFT": "Microsoft",      "GOOGL":"Alphabet (Class A)",
    "GOOG": "Alphabet (Class C)", "AMZN": "Amazon",     "META": "Meta Platforms",
    "TSLA": "Tesla",          "NVDA": "NVIDIA",         "AMD":  "AMD",
    "INTC": "Intel",          "NFLX": "Netflix",        "DIS":  "Walt Disney",
    "BABA": "Alibaba",        "ORCL": "Oracle",         "CRM":  "Salesforce",
    "ADBE": "Adobe",          "PYPL": "PayPal",         "UBER": "Uber",
    "SHOP": "Shopify",        "SQ":   "Block",          "COIN": "Coinbase",
    "MSTR": "MicroStrategy",  "PLTR": "Palantir",       "SOFI": "SoFi",
    # ETFs / indices
    "SPY":  "S&P 500 ETF",    "QQQ":  "Nasdaq-100 ETF", "DIA":  "Dow Jones ETF",
    "IWM":  "Russell 2000 ETF","VTI": "Total Stock Market ETF",
    "VOO":  "Vanguard S&P 500", "GLD": "Gold ETF",      "SLV":  "Silver ETF",
    "TLT":  "20+ Year Treasury",
}


def _base_ticker(raw: str) -> str:
    """BTCUSDT → BTC, ETH/USD → ETH, AAPL → AAPL."""
    s = (raw or "").upper().replace("/", "").replace("-", "")
    for q in _CRYPTO_QUOTES:
        if s.endswith(q) and len(s) > len(q):
            return s[: -len(q)]
    return s


_FX_CODES = {"USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD", "TRY"}


def resolve_asset_type(symbol: str) -> str:
    """Return 'crypto' | 'stock' | 'forex' | 'unknown'.

    Order matters: forex (XXXYYY where both halves are FX codes) is checked
    BEFORE the crypto-suffix heuristic, because pairs like EURUSD/GBPUSD
    end in 'USD' and would otherwise be misclassified as crypto. Direct
    crypto tickers (BTC, ETH, …) are checked first since they're ambiguous
    with no quote.
    """
    if not symbol:
        return "unknown"
    s = symbol.upper().replace("/", "").replace("-", "")

    # 1) Direct crypto ticker (no quote suffix)
    if s in _CRYPTO_TICKERS:
        return "crypto"

    # 2) Forex pair: 6 chars, both halves are 3-letter FX codes.
    if len(s) == 6 and s[:3] in _FX_CODES and s[3:] in _FX_CODES:
        return "forex"

    # 3) Crypto with quote suffix
    for q in _CRYPTO_QUOTES:
        if s.endswith(q) and len(s) > len(q):
            base = s[: -len(q)]
            if base in _CRYPTO_TICKERS:
                return "crypto"
            # Heuristic: short non-FX bases that look crypto-y
            if len(base) <= 6 and base not in _FX_CODES:
                return "crypto"

    # 4) Else assume stock / ETF
    return "stock"


def resolve_display_name(symbol: str) -> str:
    """Human-friendly name. Falls back to symbol if unknown."""
    if not symbol:
        return ""
    s = symbol.upper().replace("/", "").replace("-", "")
    # Exact match (stocks / ETFs are usually a single token)
    if s in _DISPLAY_NAMES:
        return _DISPLAY_NAMES[s]
    # Crypto: strip quote suffix and look up the base
    base = _base_ticker(s)
    if base in _DISPLAY_NAMES:
        return _DISPLAY_NAMES[base]
    return symbol.upper()


# ── Confidence derivation ──────────────────────────────────────────────────
# Combine setup_grade (0-10) with fakeout_risk + liquidity_risk (each 0-10).
# We expose two views:
#   - confidence: "low" | "medium" | "high"  (label the frontend renders)
#   - confidence_pct: 0-100                  (numeric for progress bars)

def _confidence_from_plan(plan: dict) -> tuple[str, int]:
    grade   = float(plan.get("setup_grade") or 0)
    fakeout = float(plan.get("fakeout_risk") or 0)
    liq     = float(plan.get("liquidity_risk") or 0)
    raw = grade - 0.4 * max(0.0, fakeout - 4) - 0.4 * max(0.0, liq - 4)
    raw = max(0.0, min(10.0, raw))
    pct = int(round(raw * 10))
    if raw >= 7.0: return "high", pct
    if raw >= 4.0: return "medium", pct
    return "low", pct


# ── Directional bias mapping ───────────────────────────────────────────────
# Public response uses the user's requested taxonomy: LONG / SHORT / WAIT /
# NO_TRADE. The market_data_tool can also emit REVERSAL_WATCH; we surface
# that as WAIT in the public field (no trade today) but preserve the raw
# value alongside for callers that want it.

_PUBLIC_DIRECTIONS = {"LONG", "SHORT", "WAIT", "NO_TRADE"}


def _public_direction(raw: Optional[str]) -> str:
    if not raw: return "WAIT"
    r = raw.strip().upper()
    if r in _PUBLIC_DIRECTIONS: return r
    if r == "REVERSAL_WATCH":   return "WAIT"
    return "WAIT"


# ── Core mapper ────────────────────────────────────────────────────────────

def _empty_signal(
    symbol: str, timeframe: str, *, error: str, source: Optional[str] = None,
) -> dict:
    """Honest empty payload for failures — never fabricates prices or levels."""
    return {
        "symbol":            symbol.upper(),
        "name":              resolve_display_name(symbol),
        "asset_type":        resolve_asset_type(symbol),
        "price":             None,
        "change_24h_pct":    None,
        "timeframe":         timeframe,
        "source":            source,
        "provider":          source,
        "timestamp":         datetime.now(timezone.utc).isoformat(),
        "direction":         "NO_TRADE",
        "raw_direction":     None,
        "confidence":        "low",
        "confidence_pct":    0,
        "setup_grade":       None,
        "entry":             None,
        "stop_loss":         None,
        "take_profit_1":     None,
        "take_profit_2":     None,
        "risk_reward":       None,
        "volatility_regime": None,
        "invalidation":      None,
        "data_quality":      "fallback",
        "breakdown":         None,
        "scenarios":         None,
        "intel":             None,
        "analytics":         None,
        "is_live":           False,
        "error":             error,
    }


def map_tool_result_to_signal(
    symbol: str, timeframe: str, tool_result: dict,
) -> dict:
    """
    Convert a single market_data_tool result dict (the value the tool returns
    via BaseTool._ok / _unavailable / _error) into the trading-signal shape.

    Inputs:
      tool_result.status in {available, unavailable, disabled, error}
      tool_result.data   when status == available: the rich Phase 5+ payload

    Output:
      Always a fully-shaped signal dict. is_live=true only when the tool
      returned `status: available` AND the data has a usable last_price.
    """
    if not isinstance(tool_result, dict):
        return _empty_signal(symbol, timeframe, error="invalid_tool_result")

    status   = tool_result.get("status")
    data     = tool_result.get("data") or {}
    provider = tool_result.get("provider")

    if status != "available" or not data or data.get("last_price") in (None, 0):
        return _empty_signal(
            symbol, timeframe,
            error=tool_result.get("message") or status or "no_data",
            source=provider,
        )

    plan         = data.get("plan") or {}
    raw_dir      = plan.get("directional_bias")
    confidence, confidence_pct = _confidence_from_plan(plan)
    dq           = data.get("data_quality") or {}
    dq_level     = dq.get("level") if isinstance(dq, dict) else None
    pub_dir      = _public_direction(raw_dir)

    # Trading Intelligence Engine — additive explainability + scenarios.
    # Pure, defensive, never fabricates; failures here must never break a
    # signal, so degrade to None rather than raise.
    try:
        from backend.services.trading.intelligence import (
            build_breakdown, build_scenarios, build_decision, build_analytics,
        )
        breakdown = build_breakdown(
            data, plan,
            direction=pub_dir,
            setup_grade=plan.get("setup_grade"),
            data_quality=dq_level,
        )
        scenarios = build_scenarios(
            data, plan, direction=pub_dir, data_quality=dq_level,
        )
        intel = build_decision(data, plan, data_quality=dq_level)
        analytics = build_analytics(data, data_quality=dq_level)
    except Exception as _bex:  # pragma: no cover - safety net
        logger.debug("intelligence build failed for %s: %s", symbol, _bex)
        breakdown, scenarios, intel, analytics = None, None, None, None

    return {
        "symbol":            (data.get("symbol") or symbol).upper(),
        "name":              resolve_display_name(symbol),
        "asset_type":        resolve_asset_type(symbol),
        "price":             data.get("last_price"),
        "change_24h_pct":    data.get("change_24h_pct"),
        "timeframe":         data.get("timeframe") or timeframe,
        "source":            provider,
        "provider":          provider,
        "timestamp":         tool_result.get("timestamp") or datetime.now(timezone.utc).isoformat(),

        "direction":         pub_dir,
        "raw_direction":     raw_dir,            # exposes REVERSAL_WATCH for clients that care
        "confidence":        confidence,
        "confidence_pct":    confidence_pct,
        "setup_grade":       plan.get("setup_grade"),

        "entry":             plan.get("entry"),
        "stop_loss":         plan.get("stop"),
        "take_profit_1":     plan.get("take_profit_1"),
        "take_profit_2":     plan.get("take_profit_2"),
        "risk_reward":       plan.get("risk_reward"),

        "volatility_regime": data.get("regime"),
        "invalidation":      plan.get("invalidation"),
        "data_quality":      dq_level or "full",

        # Trading Intelligence Engine (additive; clients ignore if unknown).
        "breakdown":         breakdown,
        "scenarios":         scenarios,
        "intel":             intel,
        "analytics":         analytics,

        "is_live":           True,
        "error":             None,
    }


# ── Per-symbol fetch (async; depends on market_data_tool) ──────────────────

async def signal_for_symbol(symbol: str, timeframe: str = "4h") -> dict:
    """Fetch one signal. Always returns a shaped dict; never raises."""
    if not symbol or not symbol.strip():
        _bump("symbols_failed", error="empty_symbol")
        return _empty_signal("", timeframe, error="empty_symbol")

    try:
        from backend.services.tools.tool_registry import get_tool, is_enabled as _tool_enabled
    except Exception as exc:
        logger.warning("trading.signals: registry import failed: %s", exc)
        _bump("symbols_failed", error=f"registry_import:{exc}")
        return _empty_signal(symbol, timeframe, error=f"registry_import:{exc}")

    if not _tool_enabled("market_data"):
        _bump("symbols_failed", error="market_data_disabled")
        return _empty_signal(
            symbol, timeframe,
            error="market_data tool disabled — set ENABLE_TOOLS=true + ENABLE_MARKET_DATA=true",
        )

    tool = get_tool("market_data")
    if tool is None:
        _bump("symbols_failed", error="market_data_not_registered")
        return _empty_signal(symbol, timeframe, error="market_data_not_registered")

    try:
        # Run with a hard ceiling so a slow provider can't stall the response.
        ctx    = {"symbol": symbol, "timeframe": timeframe}
        result = await asyncio.wait_for(tool.safe_run(symbol, ctx), timeout=15.0)
    except asyncio.TimeoutError:
        _bump("symbols_failed", error="market_data_timeout")
        return _empty_signal(symbol, timeframe, error="market_data_timeout_15s")
    except Exception as exc:
        logger.warning("trading.signals: market_data exception for %s: %s", symbol, exc)
        _bump("symbols_failed", error=f"market_data_exception:{exc}")
        return _empty_signal(symbol, timeframe, error=f"market_data_exception: {exc}")

    signal = map_tool_result_to_signal(symbol, timeframe, result)
    if signal["is_live"]:
        _bump("symbols_resolved")
        _record_success(signal.get("provider"))
    else:
        _bump("symbols_failed", error=signal.get("error") or "")
    return signal


async def signals_for_symbols(
    symbols: list[str], timeframe: str = "4h", *, max_concurrent: int = 6,
) -> dict:
    """
    Fetch many signals in parallel (concurrency capped by `max_concurrent`).
    Always returns a shaped dict; never raises.
    """
    _bump("requests_total")
    cleaned = [s.strip().upper() for s in (symbols or []) if s and s.strip()]
    cleaned = list(dict.fromkeys(cleaned))[:20]    # dedupe + cap at 20
    if not cleaned:
        _bump("requests_error", error="empty_symbols")
        return {
            "signals":   [],
            "timeframe": timeframe,
            "is_live":   False,
            "error":     "empty_symbols",
            "count":     0,
            "live_count": 0,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }

    sem = asyncio.Semaphore(max(1, min(max_concurrent, len(cleaned))))

    async def _one(sym: str) -> dict:
        async with sem:
            return await signal_for_symbol(sym, timeframe)

    try:
        signals = await asyncio.gather(*[_one(s) for s in cleaned], return_exceptions=False)
    except Exception as exc:
        logger.warning("trading.signals: gather failed: %s", exc)
        _bump("requests_error", error=str(exc))
        return {
            "signals":   [],
            "timeframe": timeframe,
            "is_live":   False,
            "error":     str(exc),
            "count":     0,
            "live_count": 0,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }

    live_count = sum(1 for s in signals if s.get("is_live"))
    _bump("requests_ok")
    return {
        "signals":      list(signals),
        "timeframe":    timeframe,
        "is_live":      live_count > 0,
        "count":        len(signals),
        "live_count":   live_count,
        "error":        None,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


__all__ = [
    "is_enabled", "stats",
    "resolve_asset_type", "resolve_display_name",
    "map_tool_result_to_signal",
    "signal_for_symbol", "signals_for_symbols",
]
