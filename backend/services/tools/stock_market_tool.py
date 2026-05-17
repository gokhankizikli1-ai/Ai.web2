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

from backend.services.market_providers.providers import stock_provider_keys_configured
from backend.services.tools.base_tool import BaseTool

logger = logging.getLogger(__name__)

_DEFAULT_TIMEOUT_S = 6.0
# Phase 8l — tight ceiling for the key-backed provider chain. Finnhub
# answers in ~200ms; this only bites if Finnhub is configured but slow
# and the chain has to fall through. Kept under the 8s tool-bridge
# ceiling so a slow chain still leaves room for the yfinance fallback.
_PROVIDERS_TIMEOUT_S = 5.0
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

        # Phase 8l — prefer the reliable key-backed provider chain
        # (Finnhub → TwelveData → yfinance) that already powers
        # /market/quote. Scraping Yahoo from a datacenter IP is brittle:
        # Railway gets rate-limited, the call hangs until the timeout,
        # and the agent falls back to a generic answer. Finnhub answers
        # in <1s from a real REST API. This block is skipped entirely
        # when no key is configured, so the legacy behaviour — and the
        # unit tests that monkeypatch _fetch_quote_sync — are unchanged.
        if _stock_providers_configured():
            try:
                pq = await asyncio.wait_for(
                    asyncio.to_thread(_fetch_via_market_providers, symbol),
                    timeout=_PROVIDERS_TIMEOUT_S,
                )
            except asyncio.TimeoutError:
                logger.info("stock_market.providers_timeout | symbol=%s", symbol)
                pq = None
            except Exception as exc:
                logger.warning(
                    "stock_market.providers_exception | symbol=%s | %s", symbol, exc
                )
                pq = None
            if pq:
                quote_dict, src = pq
                logger.info(
                    "stock_market.ok | symbol=%s | price=%s | via=%s",
                    symbol, quote_dict.get("last_price"), src,
                )
                return self._ok(quote_dict, provider=src)
            # The chain (Finnhub → TwelveData → yfinance) already ran and
            # ITS last leg is yfinance — so do NOT fall through to the
            # legacy _fetch_quote_sync, which would hit the same
            # rate-limited Yahoo IP a SECOND time and double the
            # worst-case hang (Bugbot Medium b4c7aa7c). Return unavailable
            # now; never fabricate. Bounded ≤ _PROVIDERS_TIMEOUT_S, which
            # is < the pre-PR 6s single-attempt worst case.
            logger.info("stock_market.providers_exhausted | symbol=%s", symbol)
            return self._unavailable(
                f"No live quote for {symbol} (Finnhub/TwelveData/yfinance all failed)"
            )

        # No key-backed provider configured — the chain was skipped
        # entirely above. Legacy yfinance path runs exactly as pre-PR
        # (single attempt, unchanged behaviour + unit-test contract).
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


def _first_present(*candidates):
    """Return the first non-None value. Unlike `a or b`, this preserves
    `0` / `0.0` — which matters for halted-stock volumes, freshly-IPO'd
    prices that haven't moved, and any market field that can legitimately
    be zero."""
    for v in candidates:
        if v is not None:
            return v
    return None


def _stock_providers_configured() -> bool:
    """True when a key-backed stock provider (Finnhub / TwelveData) is
    configured. yfinance alone does NOT count — that's the legacy path
    the direct _fetch_quote_sync call already covers. Env-only check so
    unit tests (no keys) take the unchanged legacy path deterministically
    and never touch the network."""
    return stock_provider_keys_configured()


def _fetch_via_market_providers(symbol: str):
    """Try the reliable key-backed chain (Finnhub → TwelveData →
    yfinance) that already powers /market/quote. Returns
    (quote_dict, source) on a verified-live quote, else None so the
    caller falls back to the legacy yfinance path. A non-live
    MarketQuote → None: NEVER fabricate a price."""
    from backend.services.market_providers import get_stock_quote  # noqa: PLC0415

    q = get_stock_quote(symbol)
    if not getattr(q, "is_live", False) or q.price is None:
        return None

    extra = q.extra or {}
    prev = _safe_get(extra, "previous_close")
    change = _delta(q.price, prev)
    change_pct = q.change_percent
    if change_pct is None:
        change_pct = _delta_pct(q.price, prev)

    quote_dict = {
        "symbol":               q.symbol or symbol,
        "name":                 _first_present(_safe_get(extra, "name"), q.symbol, symbol),
        "currency":             q.currency or "USD",
        "exchange":             _first_present(_safe_get(extra, "exchange"), ""),
        # Honest unknowns — Finnhub/TwelveData /quote don't report these.
        # None ("not provided"), never a fabricated value.
        "market_state":         "UNKNOWN",
        "last_price":           _round(q.price, 6),
        "previous_close":       _round(prev, 6),
        "open":                 _round(_safe_get(extra, "open"), 6),
        "day_high":             _round(q.high, 6),
        "day_low":              _round(q.low, 6),
        "volume":               _to_int(q.volume),
        "change":               _round(change, 6),
        "change_pct":           _round(change_pct, 4),
        "fifty_two_week_high":  None,
        "fifty_two_week_low":   None,
        "as_of":                q.timestamp or datetime.now(timezone.utc).isoformat(),
    }
    return quote_dict, (q.source or "market_providers")


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
        last = _first_present(_safe_get(info, "last_price"), _safe_get(info, "lastPrice"))
        if last is None:
            slow_info = getattr(ticker, "info", None) or {}
            last = _first_present(slow_info.get("regularMarketPrice"), slow_info.get("currentPrice"))
            if last is None:
                raise _Unavailable("yfinance returned no price")
            return _pack_from_slow_info(symbol, slow_info)

        prev_close = _first_present(_safe_get(info, "previous_close"), _safe_get(info, "previousClose"))
        day_high   = _first_present(_safe_get(info, "day_high"),        _safe_get(info, "dayHigh"))
        day_low    = _first_present(_safe_get(info, "day_low"),         _safe_get(info, "dayLow"))
        open_      = _safe_get(info, "open")
        volume     = _first_present(_safe_get(info, "last_volume"),     _safe_get(info, "lastVolume"))
        currency   = _first_present(_safe_get(info, "currency"), "USD")
        exchange   = _first_present(_safe_get(info, "exchange"), "")
        market_st  = _first_present(_safe_get(info, "market_state"), _safe_get(info, "marketState"), "UNKNOWN")
        yr_high    = _first_present(_safe_get(info, "year_high"), _safe_get(info, "fiftyTwoWeekHigh"))
        yr_low     = _first_present(_safe_get(info, "year_low"),  _safe_get(info, "fiftyTwoWeekLow"))

        change      = _delta(last, prev_close)
        change_pct  = _delta_pct(last, prev_close)

        return {
            "symbol":               symbol,
            "name":                 _first_present(_safe_get(info, "shortName"), symbol),
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
    last  = _first_present(info.get("regularMarketPrice"), info.get("currentPrice"))
    prev  = _first_present(info.get("regularMarketPreviousClose"), info.get("previousClose"))
    return {
        "symbol":               symbol,
        "name":                 _first_present(info.get("shortName"), info.get("longName"), symbol),
        "currency":             _first_present(info.get("currency"), "USD"),
        "exchange":             _first_present(info.get("exchange"), ""),
        "market_state":         _first_present(info.get("marketState"), "UNKNOWN"),
        "last_price":           _round(last, 6),
        "previous_close":       _round(prev, 6),
        "open":                 _round(_first_present(info.get("regularMarketOpen"),    info.get("open")),   6),
        "day_high":             _round(_first_present(info.get("regularMarketDayHigh"), info.get("dayHigh")), 6),
        "day_low":              _round(_first_present(info.get("regularMarketDayLow"),  info.get("dayLow")),  6),
        "volume":               _to_int(_first_present(info.get("regularMarketVolume"), info.get("volume"))),
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
