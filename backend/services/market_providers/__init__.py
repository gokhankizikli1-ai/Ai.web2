# coding: utf-8
"""
Live market-data providers (Phase 8e).

Public API
  from backend.services.market_providers import (
      get_stock_price, get_crypto_price, MarketQuote,
  )

  q = get_stock_price("NVDA")
  if q.is_live:
      print(q.price, q.source, q.timestamp)
  else:
      print(q.error)   # "market_data_unavailable"

Chains
  Stocks → Finnhub → TwelveData → yfinance (fallback, already in
           requirements.txt; works without a key but slower / more
           brittle to Yahoo's anti-scraping).
  Crypto → CoinGecko (public, no key) → Binance (public, no key).

Each provider skips itself when its required env var is missing. If
EVERY provider in the chain fails or is unavailable, the client
returns a `MarketQuote` with `is_live=False` and
`error="market_data_unavailable"` — never a fabricated number.

Env vars
  FINNHUB_API_KEY              optional — enables Finnhub.
  TWELVE_DATA_API_KEY          optional — enables TwelveData (canonical
                                  per the Phase 8h brief / Railway env).
  TWELVEDATA_API_KEY           legacy alias accepted for back-compat.
  COINGECKO_API_KEY            optional — lifts CoinGecko rate limits.
  MARKET_QUOTE_STOCK_CACHE_TTL  default 15 s (clamp 0-120).
  MARKET_QUOTE_CRYPTO_CACHE_TTL default 8  s (clamp 0-60).

Setting any TTL to 0 disables caching for that asset type.
"""
from backend.services.market_providers.client import (
    get_stock_price,
    get_crypto_price,
    get_stock_quote,
    get_crypto_quote,
)
from backend.services.market_providers.types import (
    MarketQuote,
    ERR_UNAVAILABLE,
    make_unavailable,
)

__all__ = [
    "get_stock_price",
    "get_crypto_price",
    # Phase 8f spec-canonical aliases — prefer these in new code.
    "get_stock_quote",
    "get_crypto_quote",
    "MarketQuote",
    "ERR_UNAVAILABLE",
    "make_unavailable",
]
