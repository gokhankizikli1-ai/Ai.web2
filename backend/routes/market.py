# coding: utf-8
"""
/market/quote/{symbol} — Phase 8e live market quote endpoint.

Flag-gated by ENABLE_MARKET_QUOTE (default off → 503 with code
MARKET_QUOTE_DISABLED). When on, returns the canonical MarketQuote
shape:

  Real data available:
    HTTP 200
    {
      "symbol":         "NVDA",
      "asset_type":     "stock",
      "price":          900.12,
      "change_percent": 1.19,
      "currency":       "USD",
      "timestamp":      "2026-05-13T...Z",
      "source":         "finnhub",
      "is_live":        true,
      "error":          null,
      "extra":          { ... }
    }

  All providers down (or unconfigured):
    HTTP 200
    {
      "symbol":         "NVDA",
      "asset_type":     "stock",
      "price":          null,
      "change_percent": null,
      "is_live":        false,
      "error":          "market_data_unavailable",
      ...
    }

The route always returns 200 with the canonical shape — the frontend
gates on `is_live === true`, not the HTTP status. This matches the
Phase 8d safety contract.

Stock vs crypto detection
  Default: heuristic — symbol in a known crypto-symbol set → crypto,
  else stock. Caller can override with ?type=stock|crypto.
"""
from __future__ import annotations

import logging
import os
from typing import Optional

from fastapi import APIRouter, HTTPException, Path, Query

from backend.services.market_providers import (
    MarketQuote,
    get_crypto_quote,
    get_stock_quote,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/market", tags=["market"])


def _flag(name: str) -> bool:
    return os.getenv(name, "false").strip().lower() == "true"


# Heuristic crypto symbols. Anything else is treated as a stock unless
# the caller overrides via ?type=. Keep small; we don't need every
# token here — when in doubt, the caller can be explicit.
_KNOWN_CRYPTO_SYMBOLS = {
    "BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "MATIC",
    "AVAX", "DOT", "LINK", "LTC", "TRX", "SHIB", "TON",
    # USDT/USD pairs (common in crypto APIs)
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT",
}


def _detect_asset_type(symbol: str, explicit_type: Optional[str]) -> str:
    if explicit_type:
        t = explicit_type.strip().lower()
        if t in ("stock", "crypto"):
            return t
    s = symbol.strip().upper()
    return "crypto" if s in _KNOWN_CRYPTO_SYMBOLS else "stock"


@router.get("/quote/{symbol}")
async def market_quote(
    symbol: str = Path(..., min_length=1, max_length=24, pattern=r"^[A-Za-z0-9._\-]+$"),
    type: Optional[str] = Query(default=None, pattern=r"^(stock|crypto)$"),
) -> dict:
    """Return a verified-live market quote for a symbol.

    The flag MUST be on, otherwise 503. When on, the route dispatches
    to the appropriate provider chain and returns the canonical
    MarketQuote shape. NEVER fabricates a price.
    """
    if not _flag("ENABLE_MARKET_QUOTE"):
        raise HTTPException(
            status_code=503,
            detail={
                "code":    "MARKET_QUOTE_DISABLED",
                "message": "Set ENABLE_MARKET_QUOTE=true on the server to enable.",
            },
        )

    asset_type = _detect_asset_type(symbol, type)
    if asset_type == "crypto":
        quote: MarketQuote = get_crypto_quote(symbol)
    else:
        quote = get_stock_quote(symbol)

    logger.info(
        "market_quote.route | symbol=%s | type=%s | is_live=%s | source=%s",
        quote.symbol, quote.asset_type, quote.is_live, quote.source or "-",
    )
    return quote.to_dict()


# Phase 8f — explicit crypto endpoint per the spec. Same provider chain
# as /market/quote/{symbol} when the heuristic picks crypto, but the
# explicit path saves callers from having to know the heuristic rules.
# Both routes are gated by the same ENABLE_MARKET_QUOTE flag.
@router.get("/crypto/{symbol}")
async def crypto_quote(
    symbol: str = Path(..., min_length=1, max_length=24, pattern=r"^[A-Za-z0-9._\-]+$"),
) -> dict:
    """Return a verified-live crypto quote for the given symbol.

    Always dispatches to the crypto provider chain (CoinGecko →
    Binance) regardless of the symbol. Useful for ambiguous tickers
    that the auto-detection on /market/quote might guess wrong, and
    for frontend code that wants an explicit semantic path."""
    if not _flag("ENABLE_MARKET_QUOTE"):
        raise HTTPException(
            status_code=503,
            detail={
                "code":    "MARKET_QUOTE_DISABLED",
                "message": "Set ENABLE_MARKET_QUOTE=true on the server to enable.",
            },
        )
    quote = get_crypto_quote(symbol)
    logger.info(
        "market_quote.crypto_route | symbol=%s | is_live=%s | source=%s",
        quote.symbol, quote.is_live, quote.source or "-",
    )
    return quote.to_dict()


__all__ = ["router"]
