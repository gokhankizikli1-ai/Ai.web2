# coding: utf-8
# Phase 5 — Advanced Trading Intelligence
# Market Data Tool with multi-timeframe analysis, Binance futures microstructure,
# Bollinger Band regime detection, and an ATR-anchored auto risk plan.
#
# Provider chain (price/indicator data): Binance → Yahoo Finance → AlphaVantage → CoinGecko.
# Crypto microstructure (funding, OI, L/S, liquidations) comes from Binance USDT-M futures
# public REST endpoints (no key needed) — only attempted when the symbol is a USDT-M pair.
#
# Activate:
#   ENABLE_TOOLS=true
#   ENABLE_MARKET_DATA=true
#   MARKET_DATA_PROVIDER=binance        (optional — default chain starts at binance)
#   ENABLE_MTF=true                     (optional — default true; turn off for legacy mode)
#   ENABLE_FUTURES_MICROSTRUCTURE=true  (optional — default true; crypto only)
import os
import re
import json
import asyncio
import logging
import urllib.request
import urllib.error
import urllib.parse
from backend.services.tools.base_tool import BaseTool

try:
    from backend.services.cache import (
        cache_get, cache_set, record_fetch as _record_fetch,
    )
    _CACHE_OK = True
except Exception:
    _CACHE_OK = False
    def cache_get(_):           return None        # noqa: E704
    def cache_set(*_a, **_kw):  return None        # noqa: E704
    def _record_fetch(*_a, **_kw): return None     # noqa: E704

logger = logging.getLogger(__name__)

_PROVIDER          = os.getenv("MARKET_DATA_PROVIDER", "").strip().lower()
_BINANCE_BASE      = "https://api.binance.com/api/v3"
_BINANCE_FAPI      = "https://fapi.binance.com"
_COINGECKO_BASE    = "https://api.coingecko.com/api/v3"
_ALPHAVANTAGE_BASE = "https://www.alphavantage.co"
_ALPHAVANTAGE_KEY  = os.getenv("ALPHAVANTAGE_API_KEY", "").strip()
_TIMEOUT           = 10  # seconds per request

_ENABLE_MTF        = os.getenv("ENABLE_MTF", "true").strip().lower() != "false"
_ENABLE_FUTURES    = os.getenv("ENABLE_FUTURES_MICROSTRUCTURE", "true").strip().lower() != "false"

# Phase 5.2 — caching + backoff knobs (all overridable by env).
_CACHE_TTL_PRIMARY  = float(os.getenv("MARKET_DATA_CACHE_TTL_SEC", "30"))     # 30s for klines
_CACHE_TTL_FUTURES  = float(os.getenv("FUTURES_CACHE_TTL_SEC", "20"))         # 20s for funding/OI
_BACKOFF_BASE_SEC   = float(os.getenv("FETCH_BACKOFF_BASE_SEC", "0.6"))       # exp backoff base
_BACKOFF_MAX_RETRY  = int(os.getenv("FETCH_BACKOFF_MAX_RETRY", "2"))          # extra attempts on 429/5xx

# Multi-timeframe set (parallel fetches when the primary provider is binance/yahoo).
_MTF_TIMEFRAMES = ("1d", "4h", "1h")

# Phase 8m — equity routing through the reliable market_providers chain.
#
# Why: trading_analyst mode runs only market_data (+ macro_data). market_data's
# crypto-only parse_symbol returns None for "NVDA fiyatı kaç", so _try_binance
# silently defaulted to BTCUSDT — the model got Bitcoin data for a stock
# question and answered generically. The Finnhub→TwelveData chain that already
# works from a datacenter IP lived only in stock_market / the /market/quote
# route, never reachable from the trading chat path.
#
# When an equity ticker is detected AND a key-backed provider is configured,
# market_data short-circuits to that chain. Gated by env-key presence only
# (ENABLE_MARKET_DATA is already on), so no ENABLE_STOCK_MARKET dependency and
# no behaviour change when unconfigured.

# Tokens that look like 1–5-letter tickers but never are. Non-ASCII Turkish
# words (FİYAT, KAÇ) can't match [A-Z] so they need no entry here. Keep tight —
# over-listing risks dropping a real ticker (e.g. don't add "T", a valid NYSE
# symbol; don't add "SEE"/"GE"/"SO", real tickers). The uppercase-as-typed
# preference in _parse_equity_symbol is the primary defence; this set only
# has to catch the residual all-lowercase / all-caps prose case.
_EQUITY_STOPWORDS = {
    "THE", "A", "AN", "I", "IS", "ARE", "WAS", "FOR", "AND", "OR", "OF",
    "TO", "IN", "ON", "AT", "BY", "WHAT", "HOW", "WHY", "WHEN", "WHO",
    "PRICE", "STOCK", "SHARE", "SHARES", "BUY", "SELL", "HOLD", "NOW",
    "TODAY", "USD", "EUR", "TRY", "GBP", "JPY", "USDT", "USDC", "BUSD",
    "DAI", "TUSD", "USDD", "FDUSD", "NE", "NEDIR", "KAC", "FIYAT",
    "ANALIZ", "HISSE", "BORSA", "CAN", "DO", "DOES", "ME", "MY", "WE",
    "YOU", "IT", "GET", "TELL", "ABOUT", "VS", "PER", "EPS", "PE",
    "ETF", "ETFS", "CHART", "QUOTE", "VALUE", "WORTH", "MUCH",
    # First-person / filler verbs — common in "I want NVDA price"-style
    # prose, never notable tickers.
    "WANT", "NEED", "LIKE", "SHOW", "THINK", "PLEASE", "PLS", "HEY",
    "OKAY", "WANNA", "GONNA", "GIMME",
}

# Ticker: 1–5 A–Z, optional single-letter class suffix (BRK.B / BRK-B).
_EQUITY_TOKEN_RE = re.compile(r"\b([A-Z]{1,5}(?:[.\-][A-Z])?)\b")


def _mp_stock_key_configured() -> bool:
    """True when a key-backed stock provider (Finnhub / TwelveData) is set.
    Mirrors FinnhubProvider/TwelveDataProvider.is_available()."""
    return bool(
        os.getenv("FINNHUB_API_KEY", "").strip()
        or os.getenv("TWELVE_DATA_API_KEY", "").strip()
        or os.getenv("TWELVEDATA_API_KEY", "").strip()
    )


def _looks_equity(sym: str) -> bool:
    """A bare equity ticker: 1–5 A–Z (optional .X/-X class suffix), not a
    crypto ticker, no exchange/quote suffix. Rejects BTCUSDT / BTC / BTC-USD
    so an explicitly-crypto caller is never hijacked into the stock chain."""
    if not sym or not isinstance(sym, str):
        return False
    s = sym.strip().upper()
    if not re.fullmatch(r"[A-Z]{1,5}(?:[.\-][A-Z])?", s):
        return False
    base = re.split(r"[.\-]", s)[0]
    if base in _CRYPTO_TICKERS or base in _EQUITY_STOPWORDS:
        return False
    return True


def _pick_equity(tokens) -> str | None:
    for tok in tokens:
        base = re.split(r"[.\-]", tok)[0]
        if tok in _EQUITY_STOPWORDS or base in _EQUITY_STOPWORDS:
            continue
        if base in _CRYPTO_TICKERS:
            continue
        return tok
    return None


def _parse_equity_symbol(message: str) -> str | None:
    """Best-effort equity ticker from a natural-language message.

    A ticker is almost always typed UPPERCASE ("NVDA", "AAPL", "BRK.B"),
    so prefer an uppercase-as-typed token first — that way lowercase
    prose ("I want the price") can't be mistaken for a ticker (Bugbot
    Medium 67253298). Only fall back to the upper()'d scan when the user
    typed no uppercase ticker at all (e.g. "nvda fiyatı kaç"), where the
    stopword set carries the load. Crypto is excluded so the existing
    crypto chain still owns BTC/ETH/etc."""
    if not message:
        return None
    # _EQUITY_TOKEN_RE is [A-Z]{1,5}; run against the ORIGINAL message it
    # only matches uppercase-as-typed tokens — the strong ticker signal.
    hit = _pick_equity(_EQUITY_TOKEN_RE.findall(message))
    if hit:
        return hit
    return _pick_equity(_EQUITY_TOKEN_RE.findall(message.upper()))

# ── Symbol sets ────────────────────────────────────────────────────────────────────────────

_CRYPTO_TICKERS = {
    "BTC", "ETH", "BNB", "SOL", "XRP", "ADA", "DOGE", "MATIC", "DOT",
    "AVAX", "LINK", "UNI", "ATOM", "LTC", "ETC", "XLM", "ALGO", "VET",
    "FIL", "TRX", "NEAR", "SAND", "MANA", "APE", "AAVE", "CRV", "SUSHI",
    "ARB", "OP",  "INJ", "SUI", "APT", "PEPE", "SHIB", "FLOKI", "TON",
}

_COINGECKO_IDS = {
    "BTC":  "bitcoin",              "ETH":  "ethereum",
    "BNB":  "binancecoin",          "SOL":  "solana",
    "XRP":  "ripple",               "ADA":  "cardano",
    "DOGE": "dogecoin",             "MATIC":"matic-network",
    "DOT":  "polkadot",             "AVAX": "avalanche-2",
    "LINK": "chainlink",            "UNI":  "uniswap",
    "ATOM": "cosmos",               "LTC":  "litecoin",
    "ETC":  "ethereum-classic",     "XLM":  "stellar",
    "ALGO": "algorand",             "TRX":  "tron",
    "NEAR": "near",                 "SAND": "the-sandbox",
    "MANA": "decentraland",         "APE":  "apecoin",
    "AAVE": "aave",                 "CRV":  "curve-dao-token",
    "ARB":  "arbitrum",             "OP":   "optimism",
    "INJ":  "injective-protocol",   "SUI":  "sui",
    "APT":  "aptos",                "PEPE": "pepe",
    "SHIB": "shiba-inu",            "TON":  "the-open-network",
    "FIL":  "filecoin",             "VET":  "vechain",
    "SUSHI":"sushi",                "FLOKI":"floki",
}

# yfinance has no 2h/4h/6h/8h/12h intervals — map to 1h with wider period
_YF_INTERVALS = {
    "1m":  ("1m",  "1d"),
    "5m":  ("5m",  "5d"),
    "15m": ("15m", "5d"),
    "30m": ("30m", "5d"),
    "1h":  ("1h",  "7d"),
    "2h":  ("1h",  "7d"),
    "4h":  ("1h",  "30d"),
    "6h":  ("1h",  "30d"),
    "8h":  ("1h",  "30d"),
    "12h": ("1h",  "30d"),
    "1d":  ("1d",  "90d"),
    "3d":  ("1d",  "90d"),
    "1w":  ("1wk", "365d"),
    "1M":  ("1mo", "365d"),
}

# Approximate candles per 24 hours for change_24h / volume_24h windows
_CANDLES_PER_24H = {
    "1m": 1440, "5m": 288, "15m": 96, "30m": 48,
    "1h": 24,   "2h": 12,  "4h":  6,  "6h":  4,
    "8h": 3,    "12h": 2,  "1d":  1,  "1wk": 1, "1mo": 1,
}


# ══════════════════════════════════════════════════════════════════════════════
class MarketDataTool(BaseTool):
    name = "market_data"
    description = (
        "Multi-timeframe market data with institutional indicators: price, RSI-14, "
        "EMA-20/50, ATR-14, Bollinger Bands + squeeze, BOS, support/resistance, "
        "volume regime, volatility regime, MTF alignment, Binance futures "
        "microstructure (funding/OI/L:S/liquidations), and an ATR-anchored risk plan. "
        "Provider fallback: Binance → Yahoo → AlphaVantage → CoinGecko."
    )

    async def run(self, query: str, context: dict = None) -> dict:
        return await self._run_with_fallback(query, context or {})

    # ── Fallback coordinator ────────────────────────────────────────────────

    async def _run_with_fallback(self, query: str, ctx: dict) -> dict:
        # Phase 8m — equity short-circuit. crypto parse_symbol owns
        # BTC/ETH/etc.; this only fires when the message has NO crypto
        # ticker but DOES name a stock, and a key-backed provider is
        # configured. Keeps the crypto chain completely untouched.
        cand = ctx.get("symbol") if isinstance(ctx.get("symbol"), str) else None
        if not self.parse_symbol(query) and (cand is None or _looks_equity(cand)):
            eq_sym = cand or _parse_equity_symbol(query)
            if eq_sym and _looks_equity(eq_sym) and _mp_stock_key_configured():
                try:
                    return await self._try_market_providers_stock(eq_sym)
                except Exception as exc:
                    logger.warning(
                        "market_data | equity fetch failed for %s: %s", eq_sym, exc
                    )
                    # NEVER fall through to the crypto chain for a stock —
                    # defaulting to BTCUSDT and returning Bitcoin data for an
                    # NVDA question is actively misleading. Clean error only.
                    return self._error(
                        f"No live quote for {eq_sym} "
                        f"(Finnhub/TwelveData/yfinance all failed)"
                    )

        providers = [
            ("binance",       self._try_binance),
            ("yahoo_finance", self._try_yahoo),
        ]
        if _ALPHAVANTAGE_KEY:
            providers.append(("alphavantage", self._try_alphavantage))
        providers.append(("coingecko", self._try_coingecko))

        start = 0
        if _PROVIDER in ("yahoo_finance", "yahoo"):
            start = 1
        elif _PROVIDER == "coingecko":
            start = next((i for i, (n, _) in enumerate(providers) if n == "coingecko"), 0)
        elif _PROVIDER in ("alphavantage", "alpha_vantage") and _ALPHAVANTAGE_KEY:
            start = next((i for i, (n, _) in enumerate(providers) if n == "alphavantage"), 0)

        errors: list[str] = []
        for name, fn in providers[start:]:
            try:
                result = await fn(query, ctx)
                data = result.get("data") or {}
                logger.info(
                    "MARKET_DATA_TOOL | provider=%s | symbol=%s | tf=%s | mtf=%s | setup_grade=%s",
                    name, data.get("symbol"), data.get("timeframe"),
                    bool(data.get("multi_timeframe")), (data.get("plan") or {}).get("setup_grade"),
                )
                return result
            except Exception as exc:
                logger.warning(
                    "market_data | provider=%s | failed: %s — trying next provider", name, exc
                )
                errors.append(f"{name}: {exc}")

        msg = "All market data providers failed: " + "; ".join(errors)
        logger.error("market_data | %s", msg)
        return self._error(msg)

    # ── Equity provider: reliable market_providers chain (Phase 8m) ─────────

    async def _try_market_providers_stock(self, symbol: str) -> dict:
        """Fetch an equity quote via Finnhub→TwelveData→yfinance (the chain
        that already works from a datacenter IP), then BEST-EFFORT enrich
        with daily-OHLC indicators (RSI14, SMA20/50, ATR14, support/
        resistance, trend, bias) from TwelveData /time_series.

        Returns the market_data payload shape so the existing context/
        summary renderers work unchanged. Raises on no live quote so the
        caller emits a clean error — NEVER fabricates. Indicators are
        included ONLY when real daily candles were fetched; otherwise the
        payload stays quote-only and the missing keys are listed honestly."""
        from backend.services.market_providers import get_stock_quote  # noqa: PLC0415

        sym = symbol.strip().upper()
        q = await asyncio.wait_for(
            asyncio.to_thread(get_stock_quote, sym), timeout=_TIMEOUT
        )
        if not getattr(q, "is_live", False) or q.price is None:
            raise ValueError(f"no live quote for {sym}")

        extra = q.extra or {}
        payload = {
            "symbol":          q.symbol or sym,
            # "quote" until daily candles are actually fetched — promoted
            # to "1d" only in the indicators branch. A quote-only payload
            # labelled "1d" would make the renderer print
            # "PRICE & STRUCTURE (1d, ? candles)" and mislead the model
            # into thinking it has daily structure (Bugbot Medium f1a647d7).
            "timeframe":       "quote",
            "asset_class":     "equity",
            "last_price":      q.price,
            # Provider's daily move (last vs previous close). Mapped onto the
            # field every consumer already reads; for equities it's the
            # session change, not a rolling 24h crypto window.
            "change_24h_pct":  q.change_percent,
            "previous_close":  extra.get("previous_close"),
            "open":            extra.get("open"),
            "day_high":        q.high,
            "day_low":         q.low,
            "volume_24h":      q.volume,
            "currency":        q.currency or "USD",
            "as_of":           q.timestamp,
        }

        # Best-effort daily indicators. A failure here NEVER fails the
        # quote — the price is the must-have; indicators are a bonus.
        indicators = None
        try:
            indicators = await _equity_daily_indicators(sym, q.price)
        except Exception as exc:   # noqa: BLE001 — never let enrichment break the quote
            logger.info("market_data | equity indicators skipped %s: %s", sym, exc)

        if indicators:
            payload.update(indicators)
            payload["timeframe"] = "1d"   # real daily candles backed it
            payload["data_quality"] = {"level": "ohlc_daily", "missing": [
                # Still no intraday MTF / futures microstructure / risk plan
                # for equities — say so rather than fake it.
                "multi_timeframe", "futures", "plan",
            ]}
        else:
            payload["data_quality"] = {"level": "quote_only", "missing": [
                "rsi_14", "sma20", "sma50", "atr_14",
                "support", "resistance", "multi_timeframe", "plan",
            ]}

        logger.info(
            "market_data | equity via market_providers | symbol=%s | "
            "price=%s | source=%s | quality=%s",
            sym, q.price, q.source or "-", payload["data_quality"]["level"],
        )
        return self._ok(payload, provider=q.source or "market_providers",
                        is_live=True)

    # ── Symbol parsing ─────────────────────────────────────────────────────

    @staticmethod
    def parse_symbol(message: str) -> str | None:
        text = message.upper()
        m = re.search(r'\b([A-Z]{2,6})(?:[/-])?(USDT|USD|BTC|ETH|EUR|BUSD)\b', text)
        if m:
            return m.group(1) + m.group(2)
        m = re.search(
            r'\b(BTC|ETH|BNB|SOL|XRP|ADA|DOGE|MATIC|DOT|AVAX|'
            r'LINK|UNI|ATOM|LTC|ETC|XLM|ALGO|VET|ARB|OP|INJ|'
            r'SUI|APT|PEPE|SHIB|TON|NEAR|SAND|MANA|APE|TRX)\b', text
        )
        if m:
            return m.group(1)
        return None

    # ── Provider 1: Binance (with MTF + futures microstructure) ────────────────

    async def _try_binance(self, query: str, ctx: dict) -> dict:
        symbol   = _normalize_binance_symbol(ctx.get("symbol") or self.parse_symbol(query) or "BTCUSDT")
        interval = ctx.get("timeframe", ctx.get("interval", "1h"))
        if interval not in {"1m","3m","5m","15m","30m","1h","2h","4h","6h","8h","12h","1d","3d","1w","1M"}:
            interval = "1h"
        limit = min(int(ctx.get("limit", 200)), 500)

        # Primary timeframe (full indicator pack) — always fetched.
        url = f"{_BINANCE_BASE}/klines?symbol={symbol}&interval={interval}&limit={limit}"
        raw = await _fetch_json(url, timeout=_TIMEOUT, cache_ttl=_CACHE_TTL_PRIMARY)
        if not raw or len(raw) < 20:
            raise ValueError(f"Insufficient Binance data for {symbol}: {len(raw or [])} candles")
        base = _ohlcv_from_klines(raw)
        primary = _build_result(symbol, interval, *base)

        # Multi-timeframe (lightweight — trend + momentum only) in parallel.
        mtf = {}
        if _ENABLE_MTF:
            other_tfs = [tf for tf in _MTF_TIMEFRAMES if tf != interval]
            try:
                mtf_results = await asyncio.gather(
                    *[_fetch_binance_tf(symbol, tf) for tf in other_tfs],
                    return_exceptions=True,
                )
                mtf[interval] = _mtf_snapshot_from_full(primary)
                for tf, res in zip(other_tfs, mtf_results):
                    if isinstance(res, Exception):
                        continue
                    mtf[tf] = res
            except Exception as exc:
                logger.warning("MTF fetch failed for %s: %s", symbol, exc)

        # Futures microstructure (crypto only).
        futures = {}
        if _ENABLE_FUTURES and _is_binance_futures_pair(symbol):
            try:
                futures = await _fetch_binance_futures(symbol)
            except Exception as exc:
                logger.warning("Futures microstructure failed for %s: %s", symbol, exc)
                futures = {"error": str(exc)}

        primary["multi_timeframe"] = mtf or None
        primary["mtf_alignment"]   = _mtf_alignment(mtf) if mtf else None
        primary["futures"]         = futures or None
        primary["plan"]            = _build_plan(primary, mtf or {}, futures if isinstance(futures, dict) else None)
        primary["data_quality"]    = _classify_data_quality(primary, "binance")

        return self._ok(primary, provider="binance")

    # ── Provider 2: Yahoo Finance ────────────────────────────────────────────────

    async def _try_yahoo(self, query: str, ctx: dict) -> dict:
        raw_sym        = ctx.get("symbol") or self.parse_symbol(query) or "BTC-USD"
        yf_sym         = _normalize_yahoo_symbol(raw_sym)
        tf             = ctx.get("timeframe", "1h").lower()
        yf_int, period = _YF_INTERVALS.get(tf, ("1h", "7d"))

        def _sync(symbol_, yf_interval_, period_):
            import yfinance as yf  # noqa: PLC0415
            hist = yf.Ticker(symbol_).history(period=period_, interval=yf_interval_)
            if hist.empty:
                raise ValueError(f"No Yahoo Finance data for {symbol_}")
            hist = hist.dropna(subset=["Close", "High", "Low", "Open"])
            return (
                list(hist["Open"]),
                list(hist["High"]),
                list(hist["Low"]),
                list(hist["Close"]),
                list(hist["Volume"].fillna(0)),
            )

        opens, highs, lows, closes, volumes = await asyncio.get_event_loop().run_in_executor(
            None, _sync, yf_sym, yf_int, period,
        )
        if len(closes) < 15:
            raise ValueError(f"Insufficient Yahoo Finance data for {yf_sym}: {len(closes)} candles")

        primary = _build_result(yf_sym, yf_int, opens, highs, lows, closes, volumes)

        mtf = {}
        if _ENABLE_MTF:
            other_tfs = [t for t in _MTF_TIMEFRAMES if t != tf]
            try:
                mtf_results = await asyncio.gather(
                    *[_fetch_yahoo_tf(yf_sym, t, _sync) for t in other_tfs],
                    return_exceptions=True,
                )
                mtf[tf] = _mtf_snapshot_from_full(primary)
                for t, res in zip(other_tfs, mtf_results):
                    if isinstance(res, Exception):
                        continue
                    mtf[t] = res
            except Exception as exc:
                logger.warning("Yahoo MTF fetch failed for %s: %s", yf_sym, exc)

        primary["multi_timeframe"] = mtf or None
        primary["mtf_alignment"]   = _mtf_alignment(mtf) if mtf else None
        primary["futures"]         = None
        primary["plan"]            = _build_plan(primary, mtf or {}, None)
        primary["data_quality"]    = _classify_data_quality(primary, "yahoo_finance")

        return self._ok(primary, provider="yahoo_finance")

    # ── Provider 3: AlphaVantage (optional, daily-only crypto) ─────────────────

    async def _try_alphavantage(self, query: str, ctx: dict) -> dict:
        if not _ALPHAVANTAGE_KEY:
            raise ValueError("ALPHAVANTAGE_API_KEY not set")

        base = _extract_base_ticker(ctx.get("symbol") or self.parse_symbol(query) or "BTC")
        url  = (
            f"{_ALPHAVANTAGE_BASE}/query"
            f"?function=DIGITAL_CURRENCY_DAILY"
            f"&symbol={base}&market=USD"
            f"&apikey={_ALPHAVANTAGE_KEY}"
        )
        raw = await _fetch_json(url, timeout=_TIMEOUT, cache_ttl=_CACHE_TTL_PRIMARY)

        if "Note" in raw:
            raise ValueError("AlphaVantage rate limit — 5 req/min on free tier")
        if "Error Message" in raw:
            raise ValueError(f"AlphaVantage: {raw['Error Message']}")

        ts = raw.get("Time Series (Digital Currency Daily)", {})
        if not ts:
            raise ValueError(f"AlphaVantage: no daily series returned for {base}")

        dates   = sorted(ts.keys())[-90:]
        opens   = [float(ts[d]["1a. open (USD)"])  for d in dates]
        highs   = [float(ts[d]["2a. high (USD)"])  for d in dates]
        lows    = [float(ts[d]["3a. low (USD)"])   for d in dates]
        closes  = [float(ts[d]["4a. close (USD)"]) for d in dates]
        volumes = [float(ts[d]["5. volume"])        for d in dates]

        if len(closes) < 15:
            raise ValueError(f"AlphaVantage: insufficient data for {base}: {len(closes)} candles")

        primary = _build_result(f"{base}USD", "1d", opens, highs, lows, closes, volumes)
        primary["multi_timeframe"] = None
        primary["mtf_alignment"]   = None
        primary["futures"]         = None
        primary["plan"]            = _build_plan(primary, {}, None)
        primary["data_quality"]    = _classify_data_quality(primary, "alphavantage")
        return self._ok(primary, provider="alphavantage")

    # ── Provider 4: CoinGecko (crypto-only last resort) ────────────────────────

    async def _try_coingecko(self, query: str, ctx: dict) -> dict:
        base  = _extract_base_ticker(ctx.get("symbol") or self.parse_symbol(query) or "BTC")
        cg_id = _COINGECKO_IDS.get(base)
        if not cg_id:
            raise ValueError(f"No CoinGecko mapping for {base!r} — crypto pairs only")

        ohlc_url = f"{_COINGECKO_BASE}/coins/{cg_id}/ohlc?vs_currency=usd&days=7"
        vol_url  = (
            f"{_COINGECKO_BASE}/coins/{cg_id}/market_chart"
            f"?vs_currency=usd&days=7&interval=hourly"
        )

        ohlc_res, vol_res = await asyncio.gather(
            _fetch_json(ohlc_url, timeout=_TIMEOUT, cache_ttl=_CACHE_TTL_PRIMARY),
            _fetch_json(vol_url,  timeout=_TIMEOUT, cache_ttl=_CACHE_TTL_PRIMARY),
            return_exceptions=True,
        )

        if isinstance(ohlc_res, Exception) or not ohlc_res:
            raise ValueError(f"CoinGecko OHLC failed: {ohlc_res}")

        opens  = [float(c[1]) for c in ohlc_res]
        highs  = [float(c[2]) for c in ohlc_res]
        lows   = [float(c[3]) for c in ohlc_res]
        closes = [float(c[4]) for c in ohlc_res]

        if len(closes) < 15:
            raise ValueError(f"CoinGecko: only {len(closes)} candles for {cg_id}")

        if (
            not isinstance(vol_res, Exception)
            and isinstance(vol_res, dict)
            and "total_volumes" in vol_res
        ):
            raw_vols = [v[1] for v in vol_res["total_volumes"]]
            chunk    = max(1, round(len(raw_vols) / len(closes)))
            volumes  = [sum(raw_vols[i: i + chunk]) for i in range(0, len(raw_vols), chunk)]
            volumes  = (volumes + [0.0] * len(closes))[: len(closes)]
        else:
            volumes = [0.0] * len(closes)

        primary = _build_result(f"{base}USDT", "4h", opens, highs, lows, closes, volumes)
        primary["multi_timeframe"] = None
        primary["mtf_alignment"]   = None
        primary["futures"]         = None
        primary["plan"]            = _build_plan(primary, {}, None)
        primary["data_quality"]    = _classify_data_quality(primary, "coingecko")
        return self._ok(primary, provider="coingecko")


# ══════════════════════════════════════════════════════════════════════════════
# Helpers — Binance MTF + Futures

async def _fetch_binance_tf(symbol: str, tf: str) -> dict:
    """Fetch one extra timeframe from Binance and return an MTF snapshot."""
    url = f"{_BINANCE_BASE}/klines?symbol={symbol}&interval={tf}&limit=200"
    raw = await _fetch_json(url, timeout=_TIMEOUT, cache_ttl=_CACHE_TTL_PRIMARY)
    if not raw or len(raw) < 20:
        raise ValueError(f"insufficient {tf} candles")
    opens, highs, lows, closes, volumes = _ohlcv_from_klines(raw)
    full = _build_result(symbol, tf, opens, highs, lows, closes, volumes)
    return _mtf_snapshot_from_full(full)


async def _fetch_yahoo_tf(symbol: str, tf: str, syncer) -> dict:
    """Fetch one extra timeframe from yfinance and return an MTF snapshot."""
    yf_int, period = _YF_INTERVALS.get(tf, ("1h", "7d"))
    opens, highs, lows, closes, volumes = await asyncio.get_event_loop().run_in_executor(
        None, syncer, symbol, yf_int, period,
    )
    if len(closes) < 15:
        raise ValueError(f"insufficient {tf} candles")
    full = _build_result(symbol, tf, opens, highs, lows, closes, volumes)
    return _mtf_snapshot_from_full(full)


def _ohlcv_from_klines(raw):
    opens   = [float(c[1]) for c in raw]
    highs   = [float(c[2]) for c in raw]
    lows    = [float(c[3]) for c in raw]
    closes  = [float(c[4]) for c in raw]
    volumes = [float(c[5]) for c in raw]
    return opens, highs, lows, closes, volumes


def _is_binance_futures_pair(symbol: str) -> bool:
    """Heuristic: USDT-M perp pairs end with USDT (most Binance futures)."""
    return symbol.upper().endswith("USDT")


async def _fetch_binance_futures(symbol: str) -> dict:
    """
    Pull funding, mark price, open interest, and long/short ratios from Binance USDT-M
    futures public endpoints. Each sub-call is wrapped — partial data is fine.
    """
    sym = symbol.upper()

    async def _safe(coro):
        try:
            return await coro
        except Exception as exc:
            return {"_error": str(exc)}

    premium_url = f"{_BINANCE_FAPI}/fapi/v1/premiumIndex?symbol={sym}"
    oi_url      = f"{_BINANCE_FAPI}/fapi/v1/openInterest?symbol={sym}"
    oi_hist_url = f"{_BINANCE_FAPI}/futures/data/openInterestHist?symbol={sym}&period=1h&limit=24"
    ls_global   = f"{_BINANCE_FAPI}/futures/data/globalLongShortAccountRatio?symbol={sym}&period=1h&limit=2"
    ls_top_pos  = f"{_BINANCE_FAPI}/futures/data/topLongShortPositionRatio?symbol={sym}&period=1h&limit=2"
    taker_url   = f"{_BINANCE_FAPI}/futures/data/takerlongshortRatio?symbol={sym}&period=1h&limit=2"

    premium, oi_now, oi_hist, ls_acc, ls_pos, taker = await asyncio.gather(
        _safe(_fetch_json(premium_url, timeout=_TIMEOUT, cache_ttl=_CACHE_TTL_FUTURES)),
        _safe(_fetch_json(oi_url,      timeout=_TIMEOUT, cache_ttl=_CACHE_TTL_FUTURES)),
        _safe(_fetch_json(oi_hist_url, timeout=_TIMEOUT, cache_ttl=_CACHE_TTL_FUTURES)),
        _safe(_fetch_json(ls_global,   timeout=_TIMEOUT, cache_ttl=_CACHE_TTL_FUTURES)),
        _safe(_fetch_json(ls_top_pos,  timeout=_TIMEOUT, cache_ttl=_CACHE_TTL_FUTURES)),
        _safe(_fetch_json(taker_url,   timeout=_TIMEOUT, cache_ttl=_CACHE_TTL_FUTURES)),
    )

    out: dict = {"symbol": sym}

    if isinstance(premium, dict) and "lastFundingRate" in premium:
        funding = float(premium["lastFundingRate"])
        out["funding_rate"]            = round(funding, 6)
        out["funding_rate_pct"]        = round(funding * 100, 4)
        out["funding_annualized_pct"]  = round(funding * 100 * 3 * 365, 2)  # 3 funding windows / day
        if "nextFundingTime" in premium:
            out["next_funding_time_ms"] = int(premium["nextFundingTime"])
        if "markPrice" in premium:
            out["mark_price"] = round(float(premium["markPrice"]), 6)
        out["funding_regime"] = _funding_regime(funding)

    if isinstance(oi_now, dict) and "openInterest" in oi_now:
        try:
            out["open_interest"] = round(float(oi_now["openInterest"]), 4)
        except (TypeError, ValueError):
            pass

    if isinstance(oi_hist, list) and len(oi_hist) >= 2:
        try:
            first = float(oi_hist[0]["sumOpenInterest"])
            last  = float(oi_hist[-1]["sumOpenInterest"])
            out["oi_change_24h_pct"] = round((last - first) / first * 100, 2) if first else 0.0
        except (KeyError, TypeError, ValueError):
            pass

    if isinstance(ls_acc, list) and ls_acc:
        try:
            out["long_short_account_ratio"] = round(float(ls_acc[-1]["longShortRatio"]), 4)
        except (KeyError, TypeError, ValueError):
            pass

    if isinstance(ls_pos, list) and ls_pos:
        try:
            out["top_trader_long_short_ratio"] = round(float(ls_pos[-1]["longShortRatio"]), 4)
        except (KeyError, TypeError, ValueError):
            pass

    if isinstance(taker, list) and taker:
        try:
            out["taker_buy_sell_ratio"] = round(float(taker[-1]["buySellRatio"]), 4)
        except (KeyError, TypeError, ValueError):
            pass

    # Crowd vs smart money divergence flag
    crowd = out.get("long_short_account_ratio")
    smart = out.get("top_trader_long_short_ratio")
    if crowd is not None and smart is not None:
        if crowd > 1.5 and smart < 1.0:
            out["positioning_signal"] = "crowd_long_smart_short"  # contrarian short bias
        elif crowd < 0.7 and smart > 1.2:
            out["positioning_signal"] = "crowd_short_smart_long"  # contrarian long bias
        else:
            out["positioning_signal"] = "aligned"

    # Phase 5.1 — trapped trader detection.
    # We can't compute 24h price Δ here (no candles), but the AI also has
    # change_24h_pct from the primary timeframe. We approximate with OI Δ +
    # funding regime + crowd positioning.
    funding_pct = out.get("funding_rate_pct")
    oi_delta    = out.get("oi_change_24h_pct")
    if funding_pct is not None and oi_delta is not None and crowd is not None:
        # Trapped longs: extreme long funding + OI rising + crowd long-heavy
        if funding_pct > 0.015 and oi_delta > 5 and crowd > 1.3:
            out["trapped_traders"] = "longs"
        # Trapped shorts: deeply negative funding + OI rising + crowd short-heavy
        elif funding_pct < -0.015 and oi_delta > 5 and crowd < 0.75:
            out["trapped_traders"] = "shorts"
        else:
            out["trapped_traders"] = None
    else:
        out["trapped_traders"] = None

    return out


def _classify_data_quality(primary: dict, provider: str) -> dict:
    """
    Quality breakdown for the response. Frontend can warn 'degraded data' when
    `level` != 'full'.
       full     — primary + MTF + (futures if applicable)
       degraded — primary only, optional blocks missing
       fallback — coingecko/alphavantage path (no MTF, no futures)
    """
    has_mtf     = bool(primary.get("multi_timeframe"))
    has_futures = bool(primary.get("futures"))
    is_crypto   = (primary.get("symbol") or "").upper().endswith("USDT")

    missing: list[str] = []
    if not has_mtf:
        missing.append("multi_timeframe")
    if is_crypto and not has_futures:
        missing.append("futures")
    if provider in ("alphavantage", "coingecko"):
        missing.append("provider_fallback")

    if not missing:
        level = "full"
    elif provider in ("alphavantage", "coingecko"):
        level = "fallback"
    else:
        level = "degraded"

    return {
        "level":           level,
        "provider":        provider,
        "has_mtf":         has_mtf,
        "has_futures":     has_futures,
        "missing":         missing,
        "candles_analyzed": primary.get("candles_analyzed"),
    }


def _funding_regime(funding: float) -> str:
    """Classify funding rate into a regime label."""
    if funding >= 0.0005:  return "extreme_long"     # ≥0.05% per 8h → overheated longs
    if funding >= 0.0002:  return "elevated_long"
    if funding >  0.00005: return "long_biased"
    if funding < -0.0005:  return "extreme_short"
    if funding < -0.0002:  return "elevated_short"
    if funding < -0.00005: return "short_biased"
    return "neutral"


# ══════════════════════════════════════════════════════════════════════════════
# MTF aggregation

def _mtf_snapshot_from_full(full: dict) -> dict:
    """Compact view of one timeframe for the MTF block."""
    return {
        "trend":          full.get("trend"),
        "rsi":            full.get("rsi_14"),
        "ema20":          full.get("ema20"),
        "ema50":          full.get("ema50"),
        "atr_pct":        full.get("volatility_pct"),
        "bos":            full.get("bos"),
        "bb_squeeze":     full.get("bb_squeeze"),
        "regime":         full.get("regime"),
        "last_price":     full.get("last_price"),
        "support":        full.get("support"),
        "resistance":     full.get("resistance"),
        "volume_trend":   full.get("volume_trend"),
    }


def _mtf_alignment(mtf: dict) -> dict:
    """
    Aggregate trend agreement across timeframes.
    Returns: aligned ("bullish"/"bearish"/"mixed"), score (0-3), divergences list.
    """
    trends = [v.get("trend") for v in mtf.values() if v]
    ups    = sum(1 for t in trends if t == "uptrend")
    downs  = sum(1 for t in trends if t == "downtrend")
    sides  = sum(1 for t in trends if t == "sideways")

    if ups == len(trends) and ups > 0:
        alignment = "bullish"
    elif downs == len(trends) and downs > 0:
        alignment = "bearish"
    elif ups > downs and downs == 0:
        alignment = "bullish_partial"
    elif downs > ups and ups == 0:
        alignment = "bearish_partial"
    else:
        alignment = "mixed"

    divergences: list[str] = []
    rsis = {tf: v.get("rsi") for tf, v in mtf.items() if v and v.get("rsi") is not None}
    if "1d" in rsis and "1h" in rsis:
        if rsis["1d"] > 60 and rsis["1h"] < 40:
            divergences.append("1d strong / 1h weak — short-term pullback in higher uptrend")
        if rsis["1d"] < 40 and rsis["1h"] > 60:
            divergences.append("1d weak / 1h strong — possible relief in higher downtrend")

    return {
        "alignment":   alignment,
        "up_count":    ups,
        "down_count":  downs,
        "side_count":  sides,
        "divergences": divergences,
    }


# ══════════════════════════════════════════════════════════════════════════════
# Result builder

def _build_result(
    symbol: str,
    timeframe: str,
    opens: list,
    highs: list,
    lows: list,
    closes: list,
    volumes: list,
) -> dict:
    n          = len(closes)
    last_price = closes[-1]

    lb24       = min(_CANDLES_PER_24H.get(timeframe, 24), n - 1)
    open_24h   = closes[-(lb24 + 1)] if lb24 < n else closes[0]
    change_24h = round((last_price - open_24h) / open_24h * 100, 2) if open_24h else 0.0
    volume_24h = round(sum(volumes[-lb24:]), 4) if volumes else 0.0

    ema20    = _calc_ema(closes, min(20, n - 1))
    ema50    = _calc_ema(closes, min(50, n - 1))
    atr      = _calc_atr(highs, lows, closes)
    sup, res = _support_resistance(highs, lows, closes)
    rsi      = _calc_rsi(closes)

    # Bollinger Bands (20, 2σ) + squeeze
    bb       = _bollinger_bands(closes, period=20, k=2.0)
    bb_width = bb["width_pct"]
    squeeze  = _bb_squeeze(closes, lookback=120)

    vol_pct  = round(atr / last_price * 100, 3) if last_price > 0 else 0.0
    regime   = _classify_regime(rsi, ema20, ema50, vol_pct, bb_width, squeeze, len(closes))

    # Phase 5.1 — smart money zones (FVG, order blocks, equal H/L, premium/discount, liquidity pools, absorption)
    zones = _smart_money_zones(opens, highs, lows, closes, volumes, atr, last_price)

    return {
        "symbol":           symbol,
        "timeframe":        timeframe,
        "last_price":       round(last_price, 6),
        "change_24h_pct":   change_24h,
        "volume_24h":       volume_24h,
        "rsi_14":           rsi,
        "ema20":            round(ema20, 6),
        "ema50":            round(ema50, 6),
        "trend":            _trend_direction(closes, ema20, ema50),
        "volume_trend":     _volume_trend(volumes),
        "support":          sup,
        "resistance":       res,
        "atr_14":           round(atr, 6),
        "volatility_pct":   vol_pct,
        "bos":              _detect_bos(highs, lows, closes),
        "bb_upper":         round(bb["upper"], 6),
        "bb_middle":        round(bb["middle"], 6),
        "bb_lower":         round(bb["lower"], 6),
        "bb_width_pct":     bb_width,
        "bb_squeeze":       squeeze,
        "bb_position":      _bb_position(last_price, bb),
        "regime":           regime,
        "smart_money":      zones,
        "candles_analyzed": n,
    }


# ══════════════════════════════════════════════════════════════════════════════
# Auto risk plan + setup grade

def _build_plan(primary: dict, mtf: dict, futures: dict | None = None) -> dict:
    """
    Compose an ATR-anchored risk plan (long + short variants) and a 0-10 setup grade.
    Phase 5.1: adds TP3, fakeout_risk, liquidity_risk, directional_bias,
    do_now / do_not_do action arrays.
    Reads only fields from `primary`, `mtf`, `futures` — pure function.
    """
    price = primary.get("last_price") or 0
    atr   = primary.get("atr_14") or 0
    sup   = primary.get("support") or 0
    res   = primary.get("resistance") or 0
    zones = primary.get("smart_money") or {}

    if not price or not atr:
        return {
            "side_bias":         "neutral",
            "directional_bias":  "NO_TRADE",
            "setup_grade":       0,
            "fakeout_risk":      0,
            "liquidity_risk":    0,
            "notes":             "Insufficient data for plan",
            "do_now":            ["Wait for more data before taking any action."],
            "do_not_do":         [],
        }

    # Stop = 1.5×ATR; TP1 = 3×ATR (R:R 2.0); TP2 = 5×ATR (3.33); TP3 = 8×ATR (5.33)
    long_stop  = round(price - atr * 1.5, 6)
    short_stop = round(price + atr * 1.5, 6)
    long_tp1   = round(price + atr * 3.0, 6)
    long_tp2   = round(price + atr * 5.0, 6)
    long_tp3   = round(price + atr * 8.0, 6)
    short_tp1  = round(price - atr * 3.0, 6)
    short_tp2  = round(price - atr * 5.0, 6)
    short_tp3  = round(price - atr * 8.0, 6)

    # Bias from MTF alignment + trend + BOS + RSI + volume + premium/discount
    mtf_obj  = primary.get("mtf_alignment") or (_mtf_alignment(mtf) if mtf else None)
    align    = (mtf_obj or {}).get("alignment", "mixed")

    trend    = primary.get("trend")
    bos      = primary.get("bos")
    rsi      = primary.get("rsi_14") or 50.0
    vt       = primary.get("volume_trend")
    regime   = primary.get("regime")
    pd_zone  = (zones.get("premium_discount") or {}).get("zone")

    bull_pts = 0
    bear_pts = 0
    if trend == "uptrend":            bull_pts += 2
    elif trend == "downtrend":        bear_pts += 2
    if bos == "bullish_bos":          bull_pts += 1
    elif bos == "bearish_bos":        bear_pts += 1
    if rsi >= 55:                     bull_pts += 1
    elif rsi <= 45:                   bear_pts += 1
    if vt == "increasing":            bull_pts += 1
    elif vt == "decreasing":          bear_pts += 1
    if align == "bullish":            bull_pts += 2
    elif align == "bullish_partial":  bull_pts += 1
    elif align == "bearish":          bear_pts += 2
    elif align == "bearish_partial":  bear_pts += 1

    # Premium/discount: longs at discount, shorts at premium = +1; counter = -1
    if pd_zone in ("deep_discount", "discount"):
        bull_pts += 1
        bear_pts = max(0, bear_pts - 1)
    elif pd_zone in ("deep_premium", "premium"):
        bear_pts += 1
        bull_pts = max(0, bull_pts - 1)

    # Trapped traders (from futures block) — strong contrarian fuel
    trapped = (futures or {}).get("trapped_traders")
    if trapped == "longs":
        bear_pts += 2
    elif trapped == "shorts":
        bull_pts += 2

    if bull_pts - bear_pts >= 2:      side_bias = "long"
    elif bear_pts - bull_pts >= 2:    side_bias = "short"
    else:                             side_bias = "neutral"

    if side_bias == "long":
        entry, stop, tp1, tp2, tp3 = price, long_stop, long_tp1, long_tp2, long_tp3
        risk   = entry - stop
        reward = tp1 - entry
    elif side_bias == "short":
        entry, stop, tp1, tp2, tp3 = price, short_stop, short_tp1, short_tp2, short_tp3
        risk   = stop - entry
        reward = entry - tp1
    else:
        entry = stop = tp1 = tp2 = tp3 = None
        risk = reward = 0

    rr_ratio = round(reward / risk, 2) if risk > 0 else 0.0

    # Setup quality (0-10)
    bias_strength = abs(bull_pts - bear_pts)
    grade = min(10, bias_strength * 2)
    if rr_ratio >= 2.5:     grade = min(10, grade + 2)
    elif rr_ratio >= 2.0:   grade = min(10, grade + 1)
    elif rr_ratio < 1.5 and side_bias != "neutral":
                            grade = max(0, grade - 1)
    if regime == "squeeze_pre_breakout": grade = min(10, grade + 1)
    if regime == "choppy":               grade = max(0, grade - 2)
    if trapped in ("longs", "shorts"):   grade = min(10, grade + 1)

    fakeout_risk   = _fakeout_risk_score(primary, zones, futures)
    liquidity_risk = _liquidity_risk_score(primary, zones)

    # Penalize grade if risks are high
    if fakeout_risk >= 7:   grade = max(0, grade - 2)
    elif fakeout_risk >= 5: grade = max(0, grade - 1)
    if liquidity_risk >= 7: grade = max(0, grade - 2)
    elif liquidity_risk >= 5: grade = max(0, grade - 1)

    # Directional bias (operator label).
    # Trapped traders is an explicit override — when present, the dominant side is
    # about to be flushed/squeezed → REVERSAL_WATCH regardless of underlying bias.
    if trapped in ("longs", "shorts"):
        directional_bias = "REVERSAL_WATCH"
    elif side_bias == "neutral" or grade < 4:
        directional_bias = "WAIT" if grade < 4 else "NO_TRADE"
    else:
        directional_bias = "LONG" if side_bias == "long" else "SHORT"

    # Hard floor — if everything aligns against trade, force NO_TRADE.
    # Skip when REVERSAL_WATCH so trapped_traders doesn't get washed out.
    if directional_bias != "REVERSAL_WATCH" and grade <= 2 and rr_ratio < 1.5:
        directional_bias = "NO_TRADE"
        side_bias = "neutral"

    invalidation = None
    if side_bias == "long" and sup:
        invalidation = f"Daily close below support {sup} kills the long thesis"
    elif side_bias == "short" and res:
        invalidation = f"Daily close above resistance {res} kills the short thesis"

    do_now, do_not_do = _action_lists(
        directional_bias, side_bias, fakeout_risk, liquidity_risk,
        grade, rr_ratio, trapped, regime, pd_zone, zones,
    )

    return {
        "side_bias":           side_bias,
        "directional_bias":    directional_bias,
        "entry":               entry,
        "stop":                stop,
        "take_profit_1":       tp1,
        "take_profit_2":       tp2,
        "take_profit_3":       tp3,
        "risk_reward":         rr_ratio,
        "stop_atr_multiple":   1.5,
        "target_atr_multiple": 3.0,
        "setup_grade":         int(grade),
        "bias_strength":       int(bias_strength),
        "bull_points":         int(bull_pts),
        "bear_points":         int(bear_pts),
        "fakeout_risk":        int(fakeout_risk),
        "liquidity_risk":      int(liquidity_risk),
        "trapped_traders":     trapped,
        "invalidation":        invalidation,
        "do_now":              do_now,
        "do_not_do":           do_not_do,
        "notes": (
            "Plan is ATR-anchored (1.5×ATR stop, 3/5/8×ATR targets → baseline R:R 2.0 / 3.33 / 5.33). "
            "AI must justify, refine, or veto based on structure, MTF alignment, and risk context."
        ),
    }


def _action_lists(
    directional_bias: str,
    side_bias: str,
    fakeout_risk: int,
    liquidity_risk: int,
    grade: int,
    rr: float,
    trapped: str | None,
    regime: str | None,
    pd_zone: str | None,
    zones: dict,
) -> tuple[list[str], list[str]]:
    """Generate 'DO THIS NOW' and 'DO NOT DO THIS' bullets in operator tone."""
    do_now: list[str]    = []
    do_not_do: list[str] = []

    if directional_bias == "NO_TRADE":
        do_now.append("NO TRADE. Setup quality below threshold. Wait for cleaner edge.")
        do_not_do.append("Do not force a position. Capital preservation > FOMO.")
    elif directional_bias == "WAIT":
        do_now.append("WAIT. Conditions mixed — no clean trigger yet.")
        if regime == "squeeze_pre_breakout":
            do_now.append("Watch for volatility expansion. Trade only on confirmed breakout with volume.")
        if zones.get("equal_highs"):
            do_now.append(f"Watch equal highs near {zones['equal_highs'][0]['level']} — potential liquidity sweep target.")
        if zones.get("equal_lows"):
            do_now.append(f"Watch equal lows near {zones['equal_lows'][0]['level']} — potential liquidity sweep target.")
        do_not_do.append("Do not anticipate the breakout direction — wait for confirmation.")
    elif directional_bias == "REVERSAL_WATCH":
        do_now.append(f"REVERSAL WATCH. Trapped {trapped} likely → contrarian setup brewing.")
        do_now.append("Wait for confirmation candle / structure flip before sizing in.")
        do_not_do.append("Do not chase the move that is trapping the crowd — wait for the reversal trigger.")
    else:  # LONG or SHORT
        do_now.append(f"{directional_bias} bias. Plan is valid IF the trigger condition fires — not before.")
        do_now.append(f"Risk = 1×stop distance. Size position so total risk ≤ 1% of portfolio (halve if leveraged).")
        if rr >= 2.0:
            do_now.append("Take partial at TP1 (≈33%), trail rest to TP2/TP3.")
        if pd_zone == "deep_premium" and directional_bias == "LONG":
            do_now.append("Long bias is in deep premium — wait for retrace into discount before entering full size.")
        if pd_zone == "deep_discount" and directional_bias == "SHORT":
            do_now.append("Short bias is in deep discount — wait for retrace into premium before entering full size.")
        do_not_do.append("Do not enter without the trigger. Do not move stop wider to absorb pain.")

    if fakeout_risk >= 6:
        do_not_do.append(f"Do not chase a breakout — fakeout risk {fakeout_risk}/10. Demand retest confirmation.")
    if liquidity_risk >= 6:
        do_not_do.append(f"Do not place stops at obvious swing H/L — liquidity sweep risk {liquidity_risk}/10. Hide stops beyond pools.")
    if regime == "choppy":
        do_not_do.append("Do not assume directional follow-through in choppy regime — scalp tactics only.")
    if grade < 6 and directional_bias in ("LONG", "SHORT"):
        do_not_do.append(f"Setup grade {grade}/10 — consider half size or skip entirely.")

    return do_now, do_not_do


# ══════════════════════════════════════════════════════════════════════════════
# Regime classification

def _classify_regime(
    rsi: float,
    ema20: float,
    ema50: float,
    vol_pct: float,
    bb_width: float,
    squeeze: bool,
    n: int,
) -> str:
    if n < 30:
        return "insufficient_data"
    if squeeze:
        return "squeeze_pre_breakout"
    if vol_pct >= 6.0:
        return "high_volatility"
    if vol_pct < 1.0:
        return "low_volatility"
    if rsi >= 70:
        return "overbought"
    if rsi <= 30:
        return "oversold"
    if ema50 and ema20 > ema50 * 1.01:
        return "trending_up"
    if ema50 and ema20 < ema50 * 0.99:
        return "trending_down"
    if abs(ema20 - ema50) / max(ema50, 1e-9) < 0.005:
        return "choppy"
    return "neutral"


# ══════════════════════════════════════════════════════════════════════════════
# Phase 5.1 — Smart money zones: FVG, order blocks, equal H/L, premium/discount,
# liquidity pools, absorption signal. All zone detection is heuristic and runs
# on the primary timeframe only — the AI uses them as context, not commands.

def _smart_money_zones(
    opens: list,
    highs: list,
    lows: list,
    closes: list,
    volumes: list,
    atr: float,
    last_price: float,
) -> dict:
    n = len(closes)
    if n < 30 or atr <= 0 or last_price <= 0:
        return {
            "fvg_bullish":         None,
            "fvg_bearish":         None,
            "order_block_bull":    None,
            "order_block_bear":    None,
            "equal_highs":         [],
            "equal_lows":          [],
            "premium_discount":    None,
            "liquidity_above":     [],
            "liquidity_below":     [],
            "absorption_signal":   None,
        }

    return {
        "fvg_bullish":      _last_unfilled_fvg(highs, lows, closes, atr, side="bull"),
        "fvg_bearish":      _last_unfilled_fvg(highs, lows, closes, atr, side="bear"),
        "order_block_bull": _last_order_block(opens, highs, lows, closes, atr, side="bull"),
        "order_block_bear": _last_order_block(opens, highs, lows, closes, atr, side="bear"),
        "equal_highs":      _equal_levels(highs, last_price, tolerance_pct=0.1, side="above"),
        "equal_lows":       _equal_levels(lows,  last_price, tolerance_pct=0.1, side="below"),
        "premium_discount": _premium_discount(highs, lows, last_price),
        "liquidity_above":  _liquidity_pools(highs, last_price, side="above"),
        "liquidity_below":  _liquidity_pools(lows,  last_price, side="below"),
        "absorption_signal": _absorption_signal(highs, lows, closes, volumes, atr),
    }


def _last_unfilled_fvg(
    highs: list,
    lows: list,
    closes: list,
    atr: float,
    side: str,
    lookback: int = 80,
    min_size_atr: float = 0.3,
) -> dict | None:
    """
    Three-candle Fair Value Gap. Returns the most recent unfilled gap with size ≥ min_size_atr * ATR.
    Bullish FVG: highs[i-1] < lows[i+1] → gap between them.
    Bearish FVG: lows[i-1] > highs[i+1].
    "Unfilled" = no later candle has traded back into the gap.
    """
    n = len(highs)
    start = max(2, n - lookback)
    last_close = closes[-1]
    for i in range(n - 2, start, -1):
        if i - 1 < 0 or i + 1 >= n:
            continue
        if side == "bull":
            gap_low  = highs[i - 1]
            gap_high = lows[i + 1]
            if gap_high <= gap_low:
                continue
            if gap_high - gap_low < atr * min_size_atr:
                continue
            # filled if any later candle's low traded below gap_high
            filled = any(lows[j] <= gap_low for j in range(i + 2, n))
            if filled:
                continue
            return {
                "low":   round(gap_low,  6),
                "high":  round(gap_high, 6),
                "size_atr": round((gap_high - gap_low) / atr, 2),
                "distance_pct": round((min(abs(last_close - gap_low), abs(last_close - gap_high)) / last_close) * 100, 2),
                "age_candles": n - 1 - i,
            }
        else:  # bear
            gap_high = lows[i - 1]
            gap_low  = highs[i + 1]
            if gap_high <= gap_low:
                continue
            if gap_high - gap_low < atr * min_size_atr:
                continue
            filled = any(highs[j] >= gap_high for j in range(i + 2, n))
            if filled:
                continue
            return {
                "low":   round(gap_low,  6),
                "high":  round(gap_high, 6),
                "size_atr": round((gap_high - gap_low) / atr, 2),
                "distance_pct": round((min(abs(last_close - gap_low), abs(last_close - gap_high)) / last_close) * 100, 2),
                "age_candles": n - 1 - i,
            }
    return None


def _last_order_block(
    opens: list,
    highs: list,
    lows: list,
    closes: list,
    atr: float,
    side: str,
    lookback: int = 60,
    impulse_atr: float = 1.5,
) -> dict | None:
    """
    Bullish OB: last bearish candle (close < open) followed by a strong up impulse
                (close moves > impulse_atr * ATR within 3 candles).
    Bearish OB: mirror — last bullish candle followed by strong down impulse.
    """
    n = len(closes)
    start = max(0, n - lookback)
    last_close = closes[-1]
    for i in range(n - 4, start, -1):
        c_open, c_close = opens[i], closes[i]
        if side == "bull":
            if c_close >= c_open:
                continue
            impulse = max(closes[i + 1: i + 4]) - c_close
            if impulse > atr * impulse_atr:
                return {
                    "low":  round(lows[i],  6),
                    "high": round(highs[i], 6),
                    "age_candles": n - 1 - i,
                    "distance_pct": round((last_close - highs[i]) / last_close * 100, 2),
                }
        else:  # bear
            if c_close <= c_open:
                continue
            impulse = c_close - min(closes[i + 1: i + 4])
            if impulse > atr * impulse_atr:
                return {
                    "low":  round(lows[i],  6),
                    "high": round(highs[i], 6),
                    "age_candles": n - 1 - i,
                    "distance_pct": round((lows[i] - last_close) / last_close * 100, 2),
                }
    return None


def _equal_levels(
    series: list,
    last_price: float,
    tolerance_pct: float,
    side: str,
    lookback: int = 60,
    min_cluster: int = 2,
) -> list:
    """
    Find clusters of swing pivots within ±tolerance_pct of each other on the
    requested side of price. These are obvious stop-hunting targets.
    """
    if len(series) < lookback:
        return []
    window = series[-lookback:]
    candidates: list[float] = []
    if side == "above":
        candidates = [v for v in window if v > last_price]
    else:
        candidates = [v for v in window if v < last_price]
    if not candidates:
        return []
    tol = last_price * (tolerance_pct / 100.0)
    clusters: list[dict] = []
    for v in sorted(candidates, reverse=(side == "above")):
        matched = False
        for c in clusters:
            if abs(c["level"] - v) <= tol:
                c["touches"] += 1
                c["level"] = (c["level"] * (c["touches"] - 1) + v) / c["touches"]
                matched = True
                break
        if not matched:
            clusters.append({"level": v, "touches": 1})
    out = [
        {
            "level":         round(c["level"], 6),
            "touches":       c["touches"],
            "distance_pct":  round(abs(c["level"] - last_price) / last_price * 100, 2),
        }
        for c in clusters if c["touches"] >= min_cluster
    ]
    return out[:3]


def _premium_discount(highs: list, lows: list, last_price: float, lookback: int = 100) -> dict | None:
    """50% equilibrium of the dominant swing range over `lookback` candles."""
    if len(highs) < lookback or last_price <= 0:
        return None
    window_h = max(highs[-lookback:])
    window_l = min(lows[-lookback:])
    if window_h <= window_l:
        return None
    eq        = (window_h + window_l) / 2.0
    fib_618   = window_l + (window_h - window_l) * 0.618
    fib_382   = window_l + (window_h - window_l) * 0.382
    if last_price >= fib_618:
        zone = "deep_premium"
    elif last_price > eq:
        zone = "premium"
    elif last_price <= fib_382:
        zone = "deep_discount"
    elif last_price < eq:
        zone = "discount"
    else:
        zone = "equilibrium"
    return {
        "zone":            zone,
        "swing_high":      round(window_h, 6),
        "swing_low":       round(window_l, 6),
        "equilibrium":     round(eq, 6),
        "fib_618":         round(fib_618, 6),
        "fib_382":         round(fib_382, 6),
        "lookback_candles": lookback,
    }


def _liquidity_pools(series: list, last_price: float, side: str, lookback: int = 100, swing_window: int = 5) -> list:
    """
    Identify swing pivots above (highs) or below (lows) price — likely stop clusters.
    Returns up to 3 strongest pools sorted by proximity.
    """
    if len(series) < swing_window * 2 + 1 or last_price <= 0:
        return []
    series = series[-lookback:]
    pivots: list[float] = []
    for i in range(swing_window, len(series) - swing_window):
        window = series[i - swing_window: i + swing_window + 1]
        if side == "above" and series[i] == max(window):
            pivots.append(series[i])
        elif side == "below" and series[i] == min(window):
            pivots.append(series[i])
    pivots = [p for p in pivots if (p > last_price if side == "above" else p < last_price)]
    pivots = sorted(set(round(p, 6) for p in pivots), reverse=(side == "above"))
    pivots = sorted(pivots, key=lambda p: abs(p - last_price))[:3]
    return [
        {
            "level":         round(p, 6),
            "distance_pct":  round(abs(p - last_price) / last_price * 100, 2),
        }
        for p in pivots
    ]


def _absorption_signal(highs: list, lows: list, closes: list, volumes: list, atr: float) -> dict | None:
    """
    High volume with small price movement = absorption (smart money accumulating
    or distributing). Last 5 candles vs prior 20-candle average.
    """
    if len(closes) < 30 or atr <= 0 or not volumes or all(v == 0 for v in volumes[-30:]):
        return None
    recent_vol = sum(volumes[-5:]) / 5.0
    prior_vol  = sum(volumes[-25:-5]) / 20.0
    if prior_vol == 0:
        return None
    vol_ratio  = recent_vol / prior_vol
    recent_range_avg = sum(highs[i] - lows[i] for i in range(len(closes) - 5, len(closes))) / 5.0
    if recent_range_avg >= atr * 0.6:
        return None
    if vol_ratio < 1.4:
        return None
    direction = "accumulation" if closes[-1] >= closes[-5] else "distribution"
    return {
        "type":          direction,
        "vol_ratio":     round(vol_ratio, 2),
        "range_vs_atr":  round(recent_range_avg / atr, 2),
        "note":          "High volume + tight range → likely smart money positioning",
    }


def _fakeout_risk_score(primary: dict, zones: dict, futures: dict | None = None) -> int:
    """0-10 score for breakout fakeout risk."""
    score = 0
    bos        = primary.get("bos")
    vt         = primary.get("volume_trend")
    squeeze    = primary.get("bb_squeeze")
    bb_pos     = primary.get("bb_position")
    rsi        = primary.get("rsi_14") or 50.0
    regime     = primary.get("regime")
    funding    = (futures or {}).get("funding_regime")
    crowd      = (futures or {}).get("long_short_account_ratio")
    smart      = (futures or {}).get("top_trader_long_short_ratio")

    # 1) Recent BOS without confirming volume
    if bos in ("bullish_bos", "bearish_bos") and vt != "increasing":
        score += 3
    # 2) Price beyond BB but RSI not extreme → mean reversion likely
    if bb_pos in ("above_upper", "below_lower") and 40 < rsi < 60:
        score += 2
    # 3) Squeeze pre-breakout — direction unknown, fakeout common
    if squeeze:
        score += 1
    # 4) Crowd long-heavy at top / short-heavy at bottom
    if bos == "bullish_bos" and funding in ("elevated_long", "extreme_long") and crowd and crowd > 1.5:
        score += 2
    if bos == "bearish_bos" and funding in ("elevated_short", "extreme_short") and crowd and crowd < 0.7:
        score += 2
    # 5) Crowd long while smart short (or mirror) → tape vs positioning mismatch
    if crowd and smart:
        if crowd > 1.4 and smart < 1.0:
            score += 1
        if crowd < 0.7 and smart > 1.2:
            score += 1
    # 6) Choppy regime — directional bets often fail
    if regime == "choppy":
        score += 1
    return min(10, score)


def _liquidity_risk_score(primary: dict, zones: dict) -> int:
    """
    0-10 risk that price will sweep nearby liquidity before continuing.
    High score when obvious stop clusters sit within 1×ATR of current price.
    """
    atr   = primary.get("atr_14") or 0
    price = primary.get("last_price") or 0
    if atr <= 0 or price <= 0:
        return 0

    score = 0
    for pool in (zones.get("liquidity_above") or [])[:2]:
        dist = pool.get("distance_pct", 100) / 100.0 * price
        if dist <= atr * 0.6:
            score += 3
        elif dist <= atr * 1.2:
            score += 1
    for pool in (zones.get("liquidity_below") or [])[:2]:
        dist = pool.get("distance_pct", 100) / 100.0 * price
        if dist <= atr * 0.6:
            score += 3
        elif dist <= atr * 1.2:
            score += 1
    # Obvious equal H/L tops nearby
    if zones.get("equal_highs"):
        nearest = zones["equal_highs"][0].get("distance_pct", 100) / 100.0 * price
        if nearest <= atr * 0.8:
            score += 2
    if zones.get("equal_lows"):
        nearest = zones["equal_lows"][0].get("distance_pct", 100) / 100.0 * price
        if nearest <= atr * 0.8:
            score += 2
    return min(10, score)


# ══════════════════════════════════════════════════════════════════════════════
# Bollinger Bands & squeeze

def _bollinger_bands(closes: list, period: int = 20, k: float = 2.0) -> dict:
    if len(closes) < period:
        last = closes[-1] if closes else 0.0
        return {"upper": last, "middle": last, "lower": last, "width_pct": 0.0}
    window = closes[-period:]
    mid    = sum(window) / period
    var    = sum((x - mid) ** 2 for x in window) / period
    std    = var ** 0.5
    upper  = mid + k * std
    lower  = mid - k * std
    width_pct = round((upper - lower) / mid * 100, 3) if mid else 0.0
    return {"upper": upper, "middle": mid, "lower": lower, "width_pct": width_pct}


def _bb_squeeze(closes: list, period: int = 20, lookback: int = 120) -> bool:
    """True when current BB width is in the lowest quartile of the last `lookback` candles."""
    if len(closes) < lookback + period:
        return False
    widths = []
    for i in range(len(closes) - lookback, len(closes)):
        window = closes[i - period + 1: i + 1]
        if len(window) < period:
            continue
        mid = sum(window) / period
        var = sum((x - mid) ** 2 for x in window) / period
        std = var ** 0.5
        if mid:
            widths.append(2 * 2.0 * std / mid)
    if not widths:
        return False
    current = widths[-1]
    threshold = sorted(widths)[len(widths) // 4]  # 25th percentile
    return current <= threshold


def _bb_position(price: float, bb: dict) -> str:
    upper, lower, mid = bb["upper"], bb["lower"], bb["middle"]
    if price >= upper:           return "above_upper"
    if price <= lower:           return "below_lower"
    if price > mid:              return "upper_half"
    if price < mid:              return "lower_half"
    return "at_middle"


# ══════════════════════════════════════════════════════════════════════════════
# Symbol normalization

def _extract_base_ticker(raw: str) -> str:
    s = raw.upper().replace("/", "").replace("-", "")
    for quote in ("USDT", "BUSD", "USD", "BTC", "ETH", "EUR", "USDC"):
        if s.endswith(quote) and len(s) > len(quote):
            return s[: -len(quote)]
    return s


def _normalize_binance_symbol(raw: str) -> str:
    s = raw.upper().replace("/", "").replace("-", "").replace(" ", "")
    for quote in ("USDT", "BUSD", "BTC", "ETH", "EUR"):
        if s.endswith(quote) and s != quote:
            return s
    return (s + "USDT") if s in _CRYPTO_TICKERS else s + "USDT"


def _normalize_yahoo_symbol(raw: str) -> str:
    s = raw.upper().replace("/", "").replace("-", "")
    for quote in ("USDT", "BUSD", "USD"):
        if s.endswith(quote) and len(s) > len(quote):
            return s[: -len(quote)] + "-USD"
    return raw.upper()


# ══════════════════════════════════════════════════════════════════════════════
# Technical indicators (pure Python)

def _calc_rsi(closes: list, period: int = 14) -> float:
    if len(closes) < period + 1:
        return 50.0
    deltas = [closes[i] - closes[i - 1] for i in range(1, len(closes))]
    gains  = [d if d > 0 else 0.0 for d in deltas]
    losses = [-d if d < 0 else 0.0 for d in deltas]
    avg_g  = sum(gains[:period]) / period
    avg_l  = sum(losses[:period]) / period
    for i in range(period, len(deltas)):
        avg_g = (avg_g * (period - 1) + gains[i]) / period
        avg_l = (avg_l * (period - 1) + losses[i]) / period
    if avg_l == 0:
        return 100.0
    return round(100.0 - 100.0 / (1.0 + avg_g / avg_l), 2)


def _calc_ema(closes: list, period: int) -> float:
    if len(closes) < period or period < 1:
        return closes[-1] if closes else 0.0
    k   = 2.0 / (period + 1)
    ema = sum(closes[:period]) / period
    for p in closes[period:]:
        ema = p * k + ema * (1.0 - k)
    return ema


def _calc_atr(highs: list, lows: list, closes: list, period: int = 14) -> float:
    if len(closes) < 2:
        return 0.0
    trs = [
        max(highs[i] - lows[i], abs(highs[i] - closes[i - 1]), abs(lows[i] - closes[i - 1]))
        for i in range(1, len(closes))
    ]
    if len(trs) < period:
        return sum(trs) / len(trs) if trs else 0.0
    atr = sum(trs[:period]) / period
    for tr in trs[period:]:
        atr = (atr * (period - 1) + tr) / period
    return atr


def _trend_direction(closes: list, ema20: float, ema50: float) -> str:
    if len(closes) < 50:
        return "insufficient_data"
    if ema20 > ema50 * 1.003:
        return "uptrend"
    if ema20 < ema50 * 0.997:
        return "downtrend"
    return "sideways"


def _volume_trend(volumes: list, window: int = 7) -> str:
    if len(volumes) < window * 2 or all(v == 0 for v in volumes):
        return "neutral"
    recent = sum(volumes[-window:]) / window
    prior  = sum(volumes[-window * 2: -window]) / window
    if prior == 0:
        return "neutral"
    ratio = recent / prior
    if ratio > 1.20:
        return "increasing"
    if ratio < 0.80:
        return "decreasing"
    return "neutral"


def _support_resistance(highs: list, lows: list, closes: list, swing_window: int = 5) -> tuple:
    if len(closes) < swing_window * 2 + 1:
        return round(min(lows), 6), round(max(highs), 6)
    last = closes[-1]
    swing_h, swing_l = [], []
    n = len(highs)
    for i in range(swing_window, n - swing_window):
        wh = highs[i - swing_window: i + swing_window + 1]
        wl = lows[i - swing_window:  i + swing_window + 1]
        if highs[i] == max(wh):
            swing_h.append(highs[i])
        if lows[i] == min(wl):
            swing_l.append(lows[i])
    supports    = sorted([s for s in swing_l if s < last], reverse=True)
    resistances = sorted([r for r in swing_h if r > last])
    sup = round(supports[0],    6) if supports    else round(min(lows[-20:]),  6)
    res = round(resistances[0], 6) if resistances else round(max(highs[-20:]), 6)
    return sup, res


def _detect_bos(highs: list, lows: list, closes: list, lookback: int = 30) -> str:
    if len(closes) < lookback + 5:
        return "unknown"
    prior_h = highs[-(lookback + 5): -5]
    prior_l = lows[-(lookback + 5):  -5]
    last    = closes[-1]
    if last > max(prior_h):
        return "bullish_bos"
    if last < min(prior_l):
        return "bearish_bos"
    return "range"


# ══════════════════════════════════════════════════════════════════════════════
# Equity daily-OHLC indicators (Phase 8n)
#
# Finnhub/TwelveData /quote give a price but no history, so a stock answer
# had no RSI/SMA/support-resistance. TwelveData /time_series (free tier:
# 8 req/min) supplies daily candles; we compute the indicators honestly or
# return None — NEVER fabricated. last_price stays the live quote (more
# current than the latest daily close).

_TWELVEDATA_TS = "https://api.twelvedata.com/time_series"


def _twelvedata_key() -> str:
    """Same precedence as market_providers.TwelveDataProvider."""
    return (
        os.getenv("TWELVE_DATA_API_KEY", "").strip()
        or os.getenv("TWELVEDATA_API_KEY", "").strip()
    )


def _sma(closes: list, period: int):
    if not closes or len(closes) < period or period < 1:
        return None
    return round(sum(closes[-period:]) / period, 6)


def _equity_bias(price, sma20, sma50, rsi):
    """Compact, honest bull/bear read from whatever indicators exist.
    Returns (bias, reason). Only references components that are present."""
    parts, score = [], 0
    if sma20 is not None and price is not None:
        if price > sma20 * 1.001:
            score += 1; parts.append("price>SMA20")
        elif price < sma20 * 0.999:
            score -= 1; parts.append("price<SMA20")
        else:
            parts.append("price≈SMA20")
    if sma20 is not None and sma50 is not None:
        if sma20 > sma50 * 1.001:
            score += 1; parts.append("SMA20>SMA50")
        elif sma20 < sma50 * 0.999:
            score -= 1; parts.append("SMA20<SMA50")
        else:
            parts.append("SMA20≈SMA50")
    if rsi is not None:
        parts.append(f"RSI {rsi:g}")
        if rsi >= 70:
            score -= 1; parts.append("overbought")
        elif rsi <= 30:
            score += 1; parts.append("oversold")
    if not parts:
        return None, None
    bias = "bullish" if score >= 2 else "bearish" if score <= -2 else "neutral"
    return bias, ", ".join(parts)


async def _equity_daily_indicators(symbol: str, last_price):
    """Best-effort daily indicators for an equity. Returns a dict of
    indicator fields, or None when no TwelveData key / no usable candles.
    Raising is fine — the caller treats any failure as 'no indicators'."""
    key = _twelvedata_key()
    if not key:
        return None
    url = (
        f"{_TWELVEDATA_TS}?"
        + urllib.parse.urlencode({
            "symbol": symbol, "interval": "1day",
            "outputsize": 80, "apikey": key, "order": "ASC",
        })
    )
    data = await _fetch_json(url, timeout=_TIMEOUT, cache_ttl=_CACHE_TTL_PRIMARY)
    if not isinstance(data, dict) or data.get("status") == "error":
        logger.info(
            "market_data | twelvedata time_series no data %s: %s",
            symbol, (data or {}).get("message") if isinstance(data, dict) else data,
        )
        return None
    values = data.get("values")
    if not isinstance(values, list) or len(values) < 30:
        return None

    # order=ASC → oldest first already; be defensive and sort by datetime.
    try:
        values = sorted(values, key=lambda v: v.get("datetime", ""))
    except Exception:        # noqa: BLE001
        pass

    highs, lows, closes, vols = [], [], [], []
    for v in values:
        # Parse ALL four before appending — appending high-then-low in one
        # try meant a mid-row parse failure left `highs` one longer than
        # the rest, permanently misaligning OHLCV so every downstream
        # indicator paired wrong values (Bugbot Medium 82a66e1b).
        try:
            h = float(v["high"])
            lo = float(v["low"])
            c = float(v["close"])
            vol = float(v.get("volume") or 0)
        except (KeyError, TypeError, ValueError):
            continue
        highs.append(h)
        lows.append(lo)
        closes.append(c)
        vols.append(vol)
    if len(closes) < 30:
        return None

    rsi   = _calc_rsi(closes) if len(closes) >= 15 else None
    sma20 = _sma(closes, 20)
    sma50 = _sma(closes, 50)
    atr   = _calc_atr(highs, lows, closes)
    atr14 = round(atr, 6) if atr and atr > 0 else None
    support, resistance = _support_resistance(highs, lows, closes)
    vol_trend = _volume_trend(vols)
    bos       = _detect_bos(highs, lows, closes)
    if sma20 is not None and sma50 is not None:
        trend = ("uptrend" if sma20 > sma50 * 1.003
                 else "downtrend" if sma20 < sma50 * 0.997
                 else "sideways")
    else:
        trend = None
    bias, bias_reason = _equity_bias(last_price, sma20, sma50, rsi)

    out = {
        "rsi_14":       rsi,
        "sma20":        sma20,
        "sma50":        sma50,
        "atr_14":       atr14,
        "support":      support,
        "resistance":   resistance,
        "trend":        trend,
        "volume_trend": vol_trend,
        "bos":          bos,
        "bias":         bias,
        "bias_reason":  bias_reason,
        "candles_analyzed": len(closes),
    }
    # Drop None so the renderer (which skips None) and the honest
    # "missing" list stay consistent.
    return {k: v for k, v in out.items() if v is not None}


# ══════════════════════════════════════════════════════════════════════════════
# Async HTTP helper

class _BinanceSymbolError(Exception):
    """Raised on Binance HTTP 400 (invalid symbol)."""


def _provider_from_url(url: str) -> str:
    """Tag provider for /tools/health counters."""
    if "fapi.binance.com" in url:       return "binance_futures"
    if "api.binance.com" in url:        return "binance"
    if "coingecko.com" in url:          return "coingecko"
    if "alphavantage.co" in url:        return "alphavantage"
    return "external"


async def _fetch_json(url: str, timeout: int = 10, cache_ttl: float = 0):
    """
    Fetch JSON via aiohttp (in requirements), falling back to urllib.
    Phase 5.2: in-memory TTL cache + exponential backoff on 429/5xx.
    Raises RuntimeError for non-200 (after retries) so callers can fall through.
    """
    if cache_ttl > 0:
        cached = cache_get(f"GET:{url}")
        if cached is not None:
            return cached

    provider = _provider_from_url(url)
    last_exc: Exception | None = None

    for attempt in range(_BACKOFF_MAX_RETRY + 1):
        try:
            data = await _http_get_json(url, timeout)
            if cache_ttl > 0:
                cache_set(f"GET:{url}", data, cache_ttl)
            _record_fetch(provider, ok=True)
            return data
        except _BinanceSymbolError as exc:
            _record_fetch(provider, ok=False, reason=str(exc))
            raise
        except _RetryableHTTPError as exc:
            last_exc = exc
            if attempt >= _BACKOFF_MAX_RETRY:
                break
            sleep_for = _BACKOFF_BASE_SEC * (2 ** attempt)
            logger.info("retryable %s on %s — sleeping %.2fs (attempt %d)", exc, provider, sleep_for, attempt + 1)
            await asyncio.sleep(sleep_for)
        except Exception as exc:
            last_exc = exc
            break

    _record_fetch(provider, ok=False, reason=str(last_exc) if last_exc else "unknown")
    raise last_exc if last_exc else RuntimeError(f"fetch failed: {url}")


class _RetryableHTTPError(Exception):
    """Retry-eligible (429 / 5xx)."""


async def _http_get_json(url: str, timeout: int):
    try:
        import aiohttp  # noqa: PLC0415
        async with aiohttp.ClientSession() as session:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=timeout)) as resp:
                if resp.status == 400:
                    body = await resp.json(content_type=None)
                    msg  = body.get("msg", "Invalid symbol") if isinstance(body, dict) else "Bad request"
                    raise _BinanceSymbolError(f"Binance: {msg}")
                if resp.status == 429 or 500 <= resp.status < 600:
                    raise _RetryableHTTPError(f"HTTP {resp.status} from {url}")
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
            if exc.code == 400:
                body = json.loads(exc.read())
                msg  = body.get("msg", "Invalid symbol") if isinstance(body, dict) else "Bad request"
                raise _BinanceSymbolError(f"Binance: {msg}") from exc
            if exc.code == 429 or 500 <= exc.code < 600:
                raise _RetryableHTTPError(f"HTTP {exc.code} from {url}") from exc
            raise RuntimeError(f"HTTP {exc.code} from {url}") from exc

    return await asyncio.get_event_loop().run_in_executor(None, _sync)
