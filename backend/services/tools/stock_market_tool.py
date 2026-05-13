# coding: utf-8
"""
Stock-market tool (Phase 7b).

Pulls a current quote + recent OHLC snapshot for any equity / ETF symbol
via the `yfinance` library that's already in requirements.txt (used by
macro_data_tool.py for DXY).

Returns:
  {
    "symbol":          "NVDA",
    "name":            "NVIDIA Corporation",
    "currency":        "USD",
    "exchange":        "NMS",
    "market_state":    "REGULAR" | "PRE" | "POST" | "CLOSED",
    "last_price":      900.12,
    "previous_close":  889.50,
    "open":            895.40,
    "day_high":        912.30,
    "day_low":         893.10,
    "volume":          120_345_678,
    "change":          10.62,
    "change_pct":      1.19,
    "fifty_two_week_high": 974.00,
    "fifty_two_week_low":  450.10,
    "as_of":           "2026-05-13T05:55:00Z",
  }

Activate: ENABLE_TOOLS=true ENABLE_STOCK_MARKET=true

No real-world action. Read-only quote fetch. Falls back to _unavailable
when yfinance can't reach Yahoo (rate-limit, network, delisted symbol)
so the agent can route the question to another tool.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

from backend.services.tools.base_tool import BaseTool

logger = logging.getLogger(__name__)

_DEFAULT_TIMEOUT_S = 6.0
_MAX_SYMBOL_LEN    = 12      # yfinance accepts e.g. "BRK-B" (5), longest sane


class StockMarketTool(BaseTool):
    name = "stock_market"
    description = (
        "Get a current quote for a stock or ETF symbol — last price, "
        "previous close, day high/low, 52-week range, volume, and market "
        "state. Accepts standard tickers (e.g. NVDA, SPY, AAPL, BRK-B). "
        "Returns 'unavailable' when Yahoo is rate-limiting or the symbol "
        "is unknown; the agent should retry or route elsewhere."
    )
    # Tool-bridge honours this when set (Phase 7b — replaces the static
    # 12s ceiling for tools that should fail faster).
    timeout_seconds = 8.0

    openai_parameters = {
        "type": "object",
        "properties": {
            "symbol": {
                "type": "string",
                "description": "Stock or ETF ticker symbol (e.g. NVDA, SPY, AAPL).",
            },
        },
        "required": ["symbol"],
        "additionalProperties": True,
    }

    async def run(self, query: str = "", context: dict = None) -> dict:
        ctx = context or {}
        symbol = (ctx.get("symbol") or query or "").strip().upper()
        if not symbol:
            return self._error("missing 'symbol'")
        if len(symbol) > _MAX_SYMBOL_LEN:
            return self._error(f"symbol too long (max {_MAX_SYMBOL_LEN} chars)")
        if not _looks_like_symbol(symbol):
            return self._error(f"invalid symbol: {symbol!r}")

        try:
            quote = await asyncio.wait_for(
                asyncio.to_thread(_fetch_quote_sync, symbol),
                timeout=_DEFAULT_TIMEOUT_S,
            )
        except asyncio.TimeoutError:
            logger.info("stock_market.timeout | symbol=%s", symbol)
            return self._unavailable(f"Yahoo Finance timed out for {symbol}")
        except _Unavailable as exc:
            logger.info("stock_market.unavailable | symbol=%s | %s", symbol, exc)
            return self._unavailable(str(exc))
        except Exception as exc:
            logger.warning("stock_market.exception | symbol=%s | %s", symbol, exc)
            return self._unavailable(f"Unexpected: {exc}")

        if not quote:
            return self._unavailable(f"No data returned for {symbol}")

        logger.info(
            "stock_market.ok | symbol=%s | price=%s | change_pct=%s | state=%s",
            symbol, quote.get("last_price"), quote.get("change_pct"),
            quote.get("market_state"),
        )
        return self._ok(quote, provider="yahoo_finance")


# ── Validators / fetchers ────────────────────────────────────────────────

# Allow alphanumerics, dash (e.g. BRK-B), dot (e.g. RDS.A), caret (^GSPC).
_VALID_CHARS = set("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-.^")


def _looks_like_symbol(s: str) -> bool:
    return bool(s) and all(c in _VALID_CHARS for c in s)


class _Unavailable(Exception):
    """Provider couldn't serve this symbol — agent should try another tool."""


def _fetch_quote_sync(symbol: str) -> Optional[dict]:
    """Synchronous yfinance call. Wrapped by run() in asyncio.to_thread."""
    try:
        import yfinance as yf   # noqa: PLC0415
    except ImportError as exc:
        raise _Unavailable(f"yfinance not installed: {exc}")

    try:
        ticker = yf.Ticker(symbol)
        info   = getattr(ticker, "fast_info", None) or {}
        # `fast_info` is dict-like in newer yfinance versions; older
        # versions expose `info` (slower, hits a different endpoint).
        # Fall back if we don't get a price quickly.
        last = _safe_get(info, "last_price") or _safe_get(info, "lastPrice")
        if last is None:
            slow_info = getattr(ticker, "info", None) or {}
            last = slow_info.get("regularMarketPrice") or slow_info.get("currentPrice")
            if last is None:
                raise _Unavailable("yfinance returned no price")
            return _pack_from_slow_info(symbol, slow_info)

        prev_close = _safe_get(info, "previous_close") or _safe_get(info, "previousClose")
        day_high   = _safe_get(info, "day_high")        or _safe_get(info, "dayHigh")
        day_low    = _safe_get(info, "day_low")         or _safe_get(info, "dayLow")
        open_      = _safe_get(info, "open")
        volume     = _safe_get(info, "last_volume")     or _safe_get(info, "lastVolume")
        currency   = _safe_get(info, "currency") or "USD"
        exchange   = _safe_get(info, "exchange") or ""
        market_st  = _safe_get(info, "market_state") or _safe_get(info, "marketState") or "UNKNOWN"
        yr_high    = _safe_get(info, "year_high") or _safe_get(info, "fiftyTwoWeekHigh")
        yr_low     = _safe_get(info, "year_low")  or _safe_get(info, "fiftyTwoWeekLow")

        change      = _delta(last, prev_close)
        change_pct  = _delta_pct(last, prev_close)

        return {
            "symbol":               symbol,
            "name":                 _safe_get(info, "shortName") or symbol,
            "currency":             currency,
            "exchange":             exchange,
            "market_state":         market_st,
            "last_price":           _round(last,  6),
            "previous_close":       _round(prev_close, 6),
            "open":                 _round(open_, 6),
            "day_high":             _round(day_high, 6),
            "day_low":              _round(day_low, 6),
            "volume":               _to_int(volume),
            "change":               _round(change, 6),
            "change_pct":           _round(change_pct, 4),
            "fifty_two_week_high":  _round(yr_high, 6),
            "fifty_two_week_low":   _round(yr_low,  6),
            "as_of":                datetime.now(timezone.utc).isoformat(),
        }
    except _Unavailable:
        raise
    except Exception as exc:
        raise _Unavailable(f"yfinance error for {symbol}: {exc}") from exc


def _pack_from_slow_info(symbol: str, info: dict) -> dict:
    last  = info.get("regularMarketPrice") or info.get("currentPrice")
    prev  = info.get("regularMarketPreviousClose") or info.get("previousClose")
    return {
        "symbol":               symbol,
        "name":                 info.get("shortName") or info.get("longName") or symbol,
        "currency":             info.get("currency") or "USD",
        "exchange":             info.get("exchange") or "",
        "market_state":         info.get("marketState") or "UNKNOWN",
        "last_price":           _round(last, 6),
        "previous_close":       _round(prev, 6),
        "open":                 _round(info.get("regularMarketOpen") or info.get("open"), 6),
        "day_high":             _round(info.get("regularMarketDayHigh") or info.get("dayHigh"), 6),
        "day_low":              _round(info.get("regularMarketDayLow")  or info.get("dayLow"),  6),
        "volume":               _to_int(info.get("regularMarketVolume") or info.get("volume")),
        "change":               _round(_delta(last, prev), 6),
        "change_pct":           _round(_delta_pct(last, prev), 4),
        "fifty_two_week_high":  _round(info.get("fiftyTwoWeekHigh"), 6),
        "fifty_two_week_low":   _round(info.get("fiftyTwoWeekLow"),  6),
        "as_of":                datetime.now(timezone.utc).isoformat(),
    }


def _safe_get(obj, key):
    """fast_info supports both attribute and dict access depending on version."""
    if obj is None:
        return None
    try:
        return obj[key] if hasattr(obj, "__getitem__") else getattr(obj, key, None)
    except (KeyError, TypeError, AttributeError):
        return getattr(obj, key, None)


def _delta(last, prev):
    if last is None or prev is None:
        return None
    try:
        return float(last) - float(prev)
    except (ValueError, TypeError):
        return None


def _delta_pct(last, prev):
    d = _delta(last, prev)
    if d is None or not prev:
        return None
    try:
        return d / float(prev) * 100.0
    except (ValueError, TypeError, ZeroDivisionError):
        return None


def _round(v, digits):
    if v is None:
        return None
    try:
        return round(float(v), digits)
    except (ValueError, TypeError):
        return None


def _to_int(v):
    if v is None:
        return None
    try:
        return int(v)
    except (ValueError, TypeError):
        return None


__all__ = ["StockMarketTool"]
