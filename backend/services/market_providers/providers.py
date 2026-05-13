# coding: utf-8
"""
Live market-data providers — Phase 8e.

Five concrete providers, each speaking the same minimal interface:

    class BaseMarketProvider:
        name: str
        asset_type: str          # "stock" | "crypto"
        def is_available(self) -> bool        # cheap key check, no network
        def fetch(symbol: str) -> MarketQuote  # raises ProviderError on failure

The client.py chain calls `is_available()` first (skips unconfigured
providers), then `fetch()` in order; first one to return a quote with
is_live=True wins. If every provider fails, the client returns the
canonical `make_unavailable()` shape — never a fabricated number.

HTTP details — every fetch:
  - Uses urllib (no extra dep; matches macro_data_tool pattern)
  - Has a tight per-request timeout (5s)
  - Logs latency + provider on success / failure
  - Maps known error responses (HTTP 401 / 429 / 5xx) to ProviderError
"""
from __future__ import annotations

import json
import logging
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Optional

from backend.services.market_providers.types import MarketQuote


logger = logging.getLogger(__name__)


_HTTP_TIMEOUT_S = 5.0
_USER_AGENT = "Mozilla/5.0 (compatible; KorvixAI/1.0; +https://korvixai.com)"


class ProviderError(Exception):
    """One provider couldn't serve this request. Caller (client.py)
    moves on to the next provider in the chain."""


# ── Helpers ──────────────────────────────────────────────────────────────

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _http_get_json(url: str, *, headers: Optional[dict] = None) -> dict:
    """Synchronous HTTP GET → JSON. Raises ProviderError on any
    non-200 or network error."""
    req = urllib.request.Request(url, headers=headers or {"User-Agent": _USER_AGENT})
    started = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=_HTTP_TIMEOUT_S) as r:
            body = r.read()
    except urllib.error.HTTPError as exc:
        elapsed_ms = int((time.monotonic() - started) * 1000)
        raise ProviderError(f"HTTP {exc.code} (after {elapsed_ms}ms)") from exc
    except urllib.error.URLError as exc:
        elapsed_ms = int((time.monotonic() - started) * 1000)
        raise ProviderError(f"network: {exc.reason} (after {elapsed_ms}ms)") from exc
    except Exception as exc:
        elapsed_ms = int((time.monotonic() - started) * 1000)
        raise ProviderError(f"unexpected: {exc} (after {elapsed_ms}ms)") from exc

    try:
        return json.loads(body)
    except (ValueError, TypeError) as exc:
        raise ProviderError(f"invalid JSON: {exc}") from exc


def _safe_float(v) -> Optional[float]:
    if v is None:
        return None
    try:
        return float(v)
    except (ValueError, TypeError):
        return None


# ── Base ────────────────────────────────────────────────────────────────

class BaseMarketProvider:
    """Subclasses implement is_available() (cheap key check) and
    fetch(symbol) (HTTP call, raises ProviderError on failure)."""
    name: str = "base"
    asset_type: str = "stock"

    def is_available(self) -> bool:
        return True

    def fetch(self, symbol: str) -> MarketQuote:
        raise NotImplementedError


# ── Stock providers ─────────────────────────────────────────────────────

class FinnhubProvider(BaseMarketProvider):
    """https://finnhub.io free tier: 60 req/min, /quote endpoint."""
    name = "finnhub"
    asset_type = "stock"

    def is_available(self) -> bool:
        return bool(os.getenv("FINNHUB_API_KEY", "").strip())

    def fetch(self, symbol: str) -> MarketQuote:
        key = os.getenv("FINNHUB_API_KEY", "").strip()
        if not key:
            raise ProviderError("FINNHUB_API_KEY not set")
        url = (
            "https://finnhub.io/api/v1/quote?"
            + urllib.parse.urlencode({"symbol": symbol, "token": key})
        )
        data = _http_get_json(url)
        price = _safe_float(data.get("c"))
        if price is None or price <= 0:
            # Finnhub returns {"c":0,"d":null,...} for unknown symbols.
            raise ProviderError(f"finnhub returned no price for {symbol!r}")
        return MarketQuote(
            symbol=symbol.upper(),
            asset_type=self.asset_type,
            price=price,
            change_percent=_safe_float(data.get("dp")),
            currency="USD",
            timestamp=_now_iso(),
            source=self.name,
            is_live=True,
            extra={
                "high":         _safe_float(data.get("h")),
                "low":          _safe_float(data.get("l")),
                "open":         _safe_float(data.get("o")),
                "previous_close": _safe_float(data.get("pc")),
            },
        )


class TwelveDataProvider(BaseMarketProvider):
    """https://twelvedata.com free tier: 8 req/min."""
    name = "twelvedata"
    asset_type = "stock"

    def is_available(self) -> bool:
        return bool(os.getenv("TWELVEDATA_API_KEY", "").strip())

    def fetch(self, symbol: str) -> MarketQuote:
        key = os.getenv("TWELVEDATA_API_KEY", "").strip()
        if not key:
            raise ProviderError("TWELVEDATA_API_KEY not set")
        url = (
            "https://api.twelvedata.com/quote?"
            + urllib.parse.urlencode({"symbol": symbol, "apikey": key})
        )
        data = _http_get_json(url)
        if data.get("status") == "error":
            raise ProviderError(f"twelvedata error: {data.get('message') or 'unknown'}")
        price = _safe_float(data.get("price") or data.get("close"))
        if price is None or price <= 0:
            raise ProviderError(f"twelvedata returned no price for {symbol!r}")
        return MarketQuote(
            symbol=symbol.upper(),
            asset_type=self.asset_type,
            price=price,
            change_percent=_safe_float(data.get("percent_change")),
            currency=str(data.get("currency") or "USD").upper(),
            timestamp=_now_iso(),
            source=self.name,
            is_live=True,
            extra={
                "exchange":       data.get("exchange") or "",
                "previous_close": _safe_float(data.get("previous_close")),
            },
        )


class YFinanceProvider(BaseMarketProvider):
    """yfinance fallback — already in requirements.txt. Slower than the
    key-backed providers, more brittle to Yahoo's anti-scraping, but
    works without a key."""
    name = "yfinance"
    asset_type = "stock"

    def is_available(self) -> bool:
        try:
            import yfinance as _yf  # noqa: F401, PLC0415
        except ImportError:
            return False
        return True

    def fetch(self, symbol: str) -> MarketQuote:
        try:
            import yfinance as yf   # noqa: PLC0415
        except ImportError as exc:
            raise ProviderError(f"yfinance not installed: {exc}") from exc
        try:
            ticker = yf.Ticker(symbol)
            info = getattr(ticker, "fast_info", None) or {}
            price = _safe_get(info, "last_price") or _safe_get(info, "lastPrice")
            prev  = _safe_get(info, "previous_close") or _safe_get(info, "previousClose")
            if price is None:
                slow = getattr(ticker, "info", None) or {}
                price = slow.get("regularMarketPrice") or slow.get("currentPrice")
                prev  = slow.get("regularMarketPreviousClose") or slow.get("previousClose")
        except Exception as exc:
            raise ProviderError(f"yfinance error: {exc}") from exc
        price = _safe_float(price)
        if price is None or price <= 0:
            raise ProviderError(f"yfinance returned no price for {symbol!r}")
        prev_f = _safe_float(prev)
        change_pct = None
        if prev_f and prev_f > 0:
            change_pct = round((price - prev_f) / prev_f * 100.0, 4)
        return MarketQuote(
            symbol=symbol.upper(),
            asset_type=self.asset_type,
            price=price,
            change_percent=change_pct,
            currency="USD",
            timestamp=_now_iso(),
            source=self.name,
            is_live=True,
            extra={"previous_close": prev_f},
        )


def _safe_get(obj, key):
    if obj is None:
        return None
    try:
        return obj[key] if hasattr(obj, "__getitem__") else getattr(obj, key, None)
    except (KeyError, TypeError, AttributeError):
        return getattr(obj, key, None)


# ── Crypto providers ────────────────────────────────────────────────────

# Common-symbol → CoinGecko ID map. Expand as needed; unknown symbols
# fall through to "no provider can serve this" → make_unavailable.
_COINGECKO_IDS = {
    "BTC":  "bitcoin",
    "ETH":  "ethereum",
    "SOL":  "solana",
    "BNB":  "binancecoin",
    "XRP":  "ripple",
    "ADA":  "cardano",
    "DOGE": "dogecoin",
    "MATIC": "polygon",
    "AVAX": "avalanche-2",
    "DOT":  "polkadot",
    "LINK": "chainlink",
    "LTC":  "litecoin",
    "TRX":  "tron",
    "SHIB": "shiba-inu",
    "TON":  "the-open-network",
}


class CoinGeckoProvider(BaseMarketProvider):
    """https://www.coingecko.com — free public endpoint, no key required.
    Optional COINGECKO_API_KEY for the demo / pro plans."""
    name = "coingecko"
    asset_type = "crypto"

    def is_available(self) -> bool:
        return True   # public endpoint; the optional key just lifts rate limits

    def fetch(self, symbol: str) -> MarketQuote:
        s = symbol.upper().replace("USDT", "").replace("USD", "")
        coin_id = _COINGECKO_IDS.get(s)
        if not coin_id:
            raise ProviderError(f"coingecko: unknown symbol {symbol!r}")
        headers = {"User-Agent": _USER_AGENT}
        key = os.getenv("COINGECKO_API_KEY", "").strip()
        if key:
            headers["x-cg-demo-api-key"] = key
        url = (
            "https://api.coingecko.com/api/v3/simple/price?"
            + urllib.parse.urlencode({
                "ids": coin_id,
                "vs_currencies": "usd",
                "include_24hr_change": "true",
            })
        )
        data = _http_get_json(url, headers=headers)
        entry = (data or {}).get(coin_id)
        if not entry:
            raise ProviderError(f"coingecko: no entry for {coin_id}")
        price = _safe_float(entry.get("usd"))
        if price is None or price <= 0:
            raise ProviderError(f"coingecko: no price for {coin_id}")
        return MarketQuote(
            symbol=s,
            asset_type=self.asset_type,
            price=price,
            change_percent=_safe_float(entry.get("usd_24h_change")),
            currency="USD",
            timestamp=_now_iso(),
            source=self.name,
            is_live=True,
            extra={"coingecko_id": coin_id},
        )


class BinanceProvider(BaseMarketProvider):
    """Public Binance ticker — no key required."""
    name = "binance"
    asset_type = "crypto"

    def is_available(self) -> bool:
        return True

    def fetch(self, symbol: str) -> MarketQuote:
        s = symbol.upper()
        if not s.endswith("USDT") and not s.endswith("BUSD"):
            s = s + "USDT"
        url = (
            "https://api.binance.com/api/v3/ticker/24hr?"
            + urllib.parse.urlencode({"symbol": s})
        )
        data = _http_get_json(url)
        price = _safe_float(data.get("lastPrice"))
        if price is None or price <= 0:
            raise ProviderError(f"binance: no price for {s}")
        return MarketQuote(
            symbol=s.replace("USDT", "").replace("BUSD", ""),
            asset_type=self.asset_type,
            price=price,
            change_percent=_safe_float(data.get("priceChangePercent")),
            currency="USD",
            timestamp=_now_iso(),
            source=self.name,
            is_live=True,
            extra={"binance_symbol": s},
        )


__all__ = [
    "ProviderError",
    "BaseMarketProvider",
    "FinnhubProvider",
    "TwelveDataProvider",
    "YFinanceProvider",
    "CoinGeckoProvider",
    "BinanceProvider",
]
