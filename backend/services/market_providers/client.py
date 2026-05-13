# coding: utf-8
"""
Public client — every caller speaks this module.

The chain (Finnhub → TwelveData → YFinance for stocks; CoinGecko →
Binance for crypto) is the only place that knows which provider to
try first. Callers ask `get_stock_price(symbol)` or
`get_crypto_price(symbol)` and receive a `MarketQuote`. Always a
quote — never None, never a raised exception. When every provider in
the chain fails, the canonical `make_unavailable()` shape is returned.

Cache lookups happen BEFORE the chain runs. Cache writes happen AFTER
a successful provider call. Failed lookups are NOT cached (we want
the next call to try fresh).

Structured logs at every step
  market_quote.cache_hit     | symbol=NVDA | type=stock | ttl=15
  market_quote.provider_ok   | symbol=NVDA | source=finnhub | ms=180
  market_quote.provider_skip | source=twelvedata | reason=no_key
  market_quote.provider_err  | source=finnhub | err=HTTP 429
  market_quote.unavailable   | symbol=NVDA | type=stock | tried=2
"""
from __future__ import annotations

import logging
import time
from typing import Iterable, List

from backend.services.market_providers import cache as _cache
from backend.services.market_providers.providers import (
    BaseMarketProvider,
    BinanceProvider,
    CoinGeckoProvider,
    FinnhubProvider,
    ProviderError,
    TwelveDataProvider,
    YFinanceProvider,
)
from backend.services.market_providers.types import (
    MarketQuote,
    make_unavailable,
)


logger = logging.getLogger(__name__)


# ── Provider chains ─────────────────────────────────────────────────────
# Constructed each request via _stock_chain() / _crypto_chain() so tests
# can monkeypatch env vars and see the change immediately.

def _stock_chain() -> List[BaseMarketProvider]:
    return [FinnhubProvider(), TwelveDataProvider(), YFinanceProvider()]


def _crypto_chain() -> List[BaseMarketProvider]:
    return [CoinGeckoProvider(), BinanceProvider()]


# ── Public API ──────────────────────────────────────────────────────────

def get_stock_price(symbol: str) -> MarketQuote:
    return _get_price(
        symbol,
        asset_type="stock",
        chain=_stock_chain(),
        ttl_seconds=_cache.stock_ttl_seconds(),
    )


def get_crypto_price(symbol: str) -> MarketQuote:
    return _get_price(
        symbol,
        asset_type="crypto",
        chain=_crypto_chain(),
        ttl_seconds=_cache.crypto_ttl_seconds(),
    )


# ── Core chain runner ───────────────────────────────────────────────────

def _get_price(
    symbol: str,
    *,
    asset_type: str,
    chain: Iterable[BaseMarketProvider],
    ttl_seconds: int,
) -> MarketQuote:
    if not isinstance(symbol, str) or not symbol.strip():
        return make_unavailable("", asset_type, error="invalid_symbol")
    sym = symbol.strip().upper()
    if len(sym) > 24:
        return make_unavailable(sym[:24], asset_type, error="invalid_symbol")

    cache_key = f"{asset_type}:{sym}"
    cached = _cache.get(cache_key)
    if isinstance(cached, MarketQuote):
        logger.info(
            "market_quote.cache_hit | symbol=%s | type=%s | ttl=%d",
            sym, asset_type, ttl_seconds,
        )
        return cached

    tried = 0
    last_err = ""
    for provider in chain:
        if not provider.is_available():
            logger.info(
                "market_quote.provider_skip | source=%s | reason=not_available",
                provider.name,
            )
            continue
        tried += 1
        started = time.monotonic()
        try:
            quote = provider.fetch(sym)
        except ProviderError as exc:
            elapsed = int((time.monotonic() - started) * 1000)
            last_err = f"{provider.name}: {exc}"
            logger.info(
                "market_quote.provider_err | source=%s | symbol=%s | ms=%d | err=%s",
                provider.name, sym, elapsed, exc,
            )
            continue
        except Exception as exc:
            elapsed = int((time.monotonic() - started) * 1000)
            last_err = f"{provider.name}: {exc}"
            logger.warning(
                "market_quote.provider_crash | source=%s | symbol=%s | ms=%d | %s: %s",
                provider.name, sym, elapsed, type(exc).__name__, exc,
            )
            continue

        if not isinstance(quote, MarketQuote) or not quote.is_live or quote.price is None:
            logger.info(
                "market_quote.provider_invalid | source=%s | symbol=%s",
                provider.name, sym,
            )
            continue

        elapsed = int((time.monotonic() - started) * 1000)
        logger.info(
            "market_quote.provider_ok | symbol=%s | source=%s | price=%s | ms=%d",
            sym, provider.name, quote.price, elapsed,
        )
        # Only successful (is_live=True) responses go in the cache.
        _cache.set(cache_key, quote, ttl_seconds=ttl_seconds)
        return quote

    logger.info(
        "market_quote.unavailable | symbol=%s | type=%s | tried=%d | last=%s",
        sym, asset_type, tried, last_err or "no provider configured",
    )
    return make_unavailable(sym, asset_type)


__all__ = [
    "get_stock_price",
    "get_crypto_price",
]
