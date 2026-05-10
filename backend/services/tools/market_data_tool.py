# coding: utf-8
# Phase 4B — Market Data Tool
# Automatic fallback chain: Binance → Yahoo Finance → AlphaVantage → CoinGecko
#
# MARKET_DATA_PROVIDER sets the starting provider (default: binance).
# If it fails for any reason (e.g. HTTP 451), the next provider is tried
# automatically — this never returns "no live data access".
#
# Provider notes:
#   binance       — public REST, no key, 1200 req/min; 451 on some hosting IPs
#   yahoo_finance — yfinance lib (in requirements), no key, reliable
#   alphavantage  — optional; set ALPHAVANTAGE_API_KEY; 5 req/min free tier
#   coingecko     — free tier, crypto only, 30 req/min; last-resort fallback
#
# Activate: ENABLE_TOOLS=true  ENABLE_MARKET_DATA=true  MARKET_DATA_PROVIDER=binance
import os
import re
import json
import asyncio
import logging
import urllib.request
import urllib.error
from backend.services.tools.base_tool import BaseTool

logger = logging.getLogger(__name__)

_PROVIDER          = os.getenv("MARKET_DATA_PROVIDER", "").strip().lower()
_BINANCE_BASE      = "https://api.binance.com/api/v3"
_COINGECKO_BASE    = "https://api.coingecko.com/api/v3"
_ALPHAVANTAGE_BASE = "https://www.alphavantage.co"
_ALPHAVANTAGE_KEY  = os.getenv("ALPHAVANTAGE_API_KEY", "").strip()
_TIMEOUT           = 10  # seconds per request

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

# How many candles span approximately 24 hours for each timeframe
_CANDLES_PER_24H = {
    "1m": 1440, "5m": 288, "15m": 96, "30m": 48,
    "1h": 24,   "2h": 12,  "4h":  6,  "6h":  4,
    "8h": 3,    "12h": 2,  "1d":  1,  "1wk": 1, "1mo": 1,
}


# ══════════════════════════════════════════════════════════════════════════════
class MarketDataTool(BaseTool):
    name = "market_data"
    description = (
        "Fetches live price, RSI-14, EMA-20/50, ATR-14, BOS, support/resistance, "
        "volume trend, and volatility. Multi-provider fallback: "
        "Binance → Yahoo Finance → AlphaVantage → CoinGecko."
    )

    async def run(self, query: str, context: dict = None) -> dict:
        return await self._run_with_fallback(query, context or {})

    # ── Fallback coordinator ────────────────────────────────────────────────

    async def _run_with_fallback(self, query: str, ctx: dict) -> dict:
        """Try providers in priority order; log which one succeeds."""
        providers = [
            ("binance",       self._try_binance),
            ("yahoo_finance", self._try_yahoo),
        ]
        if _ALPHAVANTAGE_KEY:
            providers.append(("alphavantage", self._try_alphavantage))
        providers.append(("coingecko", self._try_coingecko))

        # Determine start index from MARKET_DATA_PROVIDER
        start = 0
        if _PROVIDER in ("yahoo_finance", "yahoo"):
            start = 1
        elif _PROVIDER == "coingecko":
            start = next((i for i, (n, _) in enumerate(providers) if n == "coingecko"), 0)
        elif _PROVIDER in ("alphavantage", "alpha_vantage") and _ALPHAVANTAGE_KEY:
            start = next((i for i, (n, _) in enumerate(providers) if n == "alphavantage"), 0)
        # "binance", "", or unknown → start = 0 (full chain from Binance)

        errors: list[str] = []
        for name, fn in providers[start:]:
            try:
                result = await fn(query, ctx)
                data = result.get("data") or {}
                logger.info(
                    "MARKET_DATA_TOOL | provider=%s | symbol=%s | timeframe=%s | candles=%s",
                    name, data.get("symbol"), data.get("timeframe"), data.get("candles_analyzed"),
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

    # ── Symbol parsing ─────────────────────────────────────────────────────

    @staticmethod
    def parse_symbol(message: str) -> str | None:
        """Extract a trading symbol from free-form text."""
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

    # ── Provider 1: Binance ───────────────────────────────────────────────────────

    async def _try_binance(self, query: str, ctx: dict) -> dict:
        symbol   = _normalize_binance_symbol(ctx.get("symbol") or self.parse_symbol(query) or "BTCUSDT")
        interval = ctx.get("timeframe", ctx.get("interval", "1h"))
        if interval not in {"1m","3m","5m","15m","30m","1h","2h","4h","6h","8h","12h","1d","3d","1w","1M"}:
            interval = "1h"
        limit = min(int(ctx.get("limit", 150)), 500)

        url = f"{_BINANCE_BASE}/klines?symbol={symbol}&interval={interval}&limit={limit}"
        raw = await _fetch_json(url, timeout=_TIMEOUT)  # raises on any HTTP error

        if not raw or len(raw) < 20:
            raise ValueError(f"Insufficient Binance data for {symbol}: {len(raw or [])} candles")

        opens   = [float(c[1]) for c in raw]
        highs   = [float(c[2]) for c in raw]
        lows    = [float(c[3]) for c in raw]
        closes  = [float(c[4]) for c in raw]
        volumes = [float(c[5]) for c in raw]

        return self._ok(
            _build_result(symbol, interval, opens, highs, lows, closes, volumes),
            provider="binance",
        )

    # ── Provider 2: Yahoo Finance ────────────────────────────────────────────────

    async def _try_yahoo(self, query: str, ctx: dict) -> dict:
        raw_sym        = ctx.get("symbol") or self.parse_symbol(query) or "BTC-USD"
        yf_sym         = _normalize_yahoo_symbol(raw_sym)
        tf             = ctx.get("timeframe", "1h").lower()
        yf_int, period = _YF_INTERVALS.get(tf, ("1h", "7d"))

        def _sync():
            import yfinance as yf  # noqa: PLC0415
            hist = yf.Ticker(yf_sym).history(period=period, interval=yf_int)
            if hist.empty:
                raise ValueError(f"No Yahoo Finance data for {yf_sym}")
            return hist.dropna(subset=["Close", "High", "Low", "Open"])

        hist = await asyncio.get_event_loop().run_in_executor(None, _sync)

        closes  = list(hist["Close"])
        highs   = list(hist["High"])
        lows    = list(hist["Low"])
        opens   = list(hist["Open"])
        volumes = list(hist["Volume"].fillna(0))

        if len(closes) < 15:
            raise ValueError(f"Insufficient Yahoo Finance data for {yf_sym}: {len(closes)} candles")

        return self._ok(
            _build_result(yf_sym, yf_int, opens, highs, lows, closes, volumes),
            provider="yahoo_finance",
        )

    # ── Provider 3: AlphaVantage (optional) ──────────────────────────────────────────

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
        raw = await _fetch_json(url, timeout=_TIMEOUT)

        if "Note" in raw:
            raise ValueError("AlphaVantage rate limit — 5 req/min on free tier")
        if "Error Message" in raw:
            raise ValueError(f"AlphaVantage: {raw['Error Message']}")

        ts = raw.get("Time Series (Digital Currency Daily)", {})
        if not ts:
            raise ValueError(f"AlphaVantage: no daily series returned for {base}")

        dates   = sorted(ts.keys())[-90:]           # oldest → newest, last 90 days
        opens   = [float(ts[d]["1a. open (USD)"])  for d in dates]
        highs   = [float(ts[d]["2a. high (USD)"])  for d in dates]
        lows    = [float(ts[d]["3a. low (USD)"])   for d in dates]
        closes  = [float(ts[d]["4a. close (USD)"]) for d in dates]
        volumes = [float(ts[d]["5. volume"])        for d in dates]

        if len(closes) < 15:
            raise ValueError(f"AlphaVantage: insufficient data for {base}: {len(closes)} candles")

        return self._ok(
            _build_result(f"{base}USD", "1d", opens, highs, lows, closes, volumes),
            provider="alphavantage",
        )

    # ── Provider 4: CoinGecko (crypto-only last resort) ───────────────────────────

    async def _try_coingecko(self, query: str, ctx: dict) -> dict:
        base  = _extract_base_ticker(ctx.get("symbol") or self.parse_symbol(query) or "BTC")
        cg_id = _COINGECKO_IDS.get(base)
        if not cg_id:
            raise ValueError(f"No CoinGecko mapping for {base!r} — crypto pairs only")

        # 7 days → 4h candles from CoinGecko OHLC endpoint
        ohlc_url = f"{_COINGECKO_BASE}/coins/{cg_id}/ohlc?vs_currency=usd&days=7"
        vol_url  = (
            f"{_COINGECKO_BASE}/coins/{cg_id}/market_chart"
            f"?vs_currency=usd&days=7&interval=hourly"
        )

        ohlc_res, vol_res = await asyncio.gather(
            _fetch_json(ohlc_url, timeout=_TIMEOUT),
            _fetch_json(vol_url,  timeout=_TIMEOUT),
            return_exceptions=True,
        )

        if isinstance(ohlc_res, Exception) or not ohlc_res:
            raise ValueError(f"CoinGecko OHLC failed: {ohlc_res}")

        # ohlc_res: [[timestamp_ms, open, high, low, close], ...]
        opens  = [float(c[1]) for c in ohlc_res]
        highs  = [float(c[2]) for c in ohlc_res]
        lows   = [float(c[3]) for c in ohlc_res]
        closes = [float(c[4]) for c in ohlc_res]

        if len(closes) < 15:
            raise ValueError(f"CoinGecko: only {len(closes)} candles for {cg_id}")

        # Hourly volume → resample to 4h bucket sums to match OHLC count
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

        return self._ok(
            _build_result(f"{base}USDT", "4h", opens, highs, lows, closes, volumes),
            provider="coingecko",
        )


# ══════════════════════════════════════════════════════════════════════════════
# Shared result builder — called by every provider after obtaining OHLCV lists

def _build_result(
    symbol: str,
    timeframe: str,
    opens: list,
    highs: list,
    lows: list,
    closes: list,
    volumes: list,
) -> dict:
    """Compute all indicators from OHLCV and return the standardized data dict."""
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

    return {
        "symbol":           symbol,
        "timeframe":        timeframe,
        "last_price":       round(last_price, 6),
        "change_24h_pct":   change_24h,
        "volume_24h":       volume_24h,
        "rsi_14":           _calc_rsi(closes),
        "ema20":            round(ema20, 6),
        "ema50":            round(ema50, 6),
        "trend":            _trend_direction(closes, ema20, ema50),
        "volume_trend":     _volume_trend(volumes),
        "support":          sup,
        "resistance":       res,
        "atr_14":           round(atr, 6),
        "volatility_pct":   round(atr / last_price * 100, 3) if last_price > 0 else 0.0,
        "bos":              _detect_bos(highs, lows, closes),
        "candles_analyzed": n,
    }


# ══════════════════════════════════════════════════════════════════════════════
# Symbol normalization

def _extract_base_ticker(raw: str) -> str:
    """BTCUSDT → BTC, ETH/USD → ETH, BTC → BTC."""
    s = raw.upper().replace("/", "").replace("-", "")
    for quote in ("USDT", "BUSD", "USD", "BTC", "ETH", "EUR", "USDC"):
        if s.endswith(quote) and len(s) > len(quote):
            return s[: -len(quote)]
    return s


def _normalize_binance_symbol(raw: str) -> str:
    """BTC → BTCUSDT, ETH/USDT → ETHUSDT, BTC-USD → BTCUSDT."""
    s = raw.upper().replace("/", "").replace("-", "").replace(" ", "")
    for quote in ("USDT", "BUSD", "BTC", "ETH", "EUR"):
        if s.endswith(quote) and s != quote:
            return s
    return (s + "USDT") if s in _CRYPTO_TICKERS else s + "USDT"


def _normalize_yahoo_symbol(raw: str) -> str:
    """BTCUSDT → BTC-USD, ETH/USD → ETH-USD."""
    s = raw.upper().replace("/", "").replace("-", "")
    for quote in ("USDT", "BUSD", "USD"):
        if s.endswith(quote) and len(s) > len(quote):
            return s[: -len(quote)] + "-USD"
    return raw.upper()


# ══════════════════════════════════════════════════════════════════════════════
# Technical indicators (pure Python, zero extra dependencies)

def _calc_rsi(closes: list, period: int = 14) -> float:
    """Wilder's RSI. Returns 50.0 when data is insufficient."""
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
    """Exponential moving average."""
    if len(closes) < period or period < 1:
        return closes[-1] if closes else 0.0
    k   = 2.0 / (period + 1)
    ema = sum(closes[:period]) / period
    for p in closes[period:]:
        ema = p * k + ema * (1.0 - k)
    return ema


def _calc_atr(highs: list, lows: list, closes: list, period: int = 14) -> float:
    """Average True Range (Wilder's smoothing)."""
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
    """EMA20/50 crossover with 0.3% noise buffer."""
    if len(closes) < 50:
        return "insufficient_data"
    if ema20 > ema50 * 1.003:
        return "uptrend"
    if ema20 < ema50 * 0.997:
        return "downtrend"
    return "sideways"


def _volume_trend(volumes: list, window: int = 7) -> str:
    """Compares recent vs prior window average. Skips all-zero volume."""
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
    """Nearest swing-pivot support below price and resistance above."""
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
    """Break of Structure: last close vs prior swing structure."""
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
# Async HTTP helper

class _BinanceSymbolError(Exception):
    """Raised on Binance HTTP 400 (invalid symbol)."""


async def _fetch_json(url: str, timeout: int = 10):
    """
    Fetch JSON via aiohttp (available in requirements), falling back to urllib.
    Raises RuntimeError for non-200 so the fallback chain catches it.
    """
    try:
        import aiohttp  # noqa: PLC0415
        async with aiohttp.ClientSession() as session:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=timeout)) as resp:
                if resp.status == 400:
                    body = await resp.json(content_type=None)
                    msg  = body.get("msg", "Invalid symbol") if isinstance(body, dict) else "Bad request"
                    raise _BinanceSymbolError(f"Binance: {msg}")
                if resp.status != 200:
                    raise RuntimeError(f"HTTP {resp.status} from {url}")
                return await resp.json(content_type=None)
    except ImportError:
        pass  # fall through to urllib

    def _sync():
        try:
            with urllib.request.urlopen(url, timeout=timeout) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as exc:
            if exc.code == 400:
                body = json.loads(exc.read())
                msg  = body.get("msg", "Invalid symbol") if isinstance(body, dict) else "Bad request"
                raise _BinanceSymbolError(f"Binance: {msg}") from exc
            raise RuntimeError(f"HTTP {exc.code} from {url}") from exc

    return await asyncio.get_event_loop().run_in_executor(None, _sync)
