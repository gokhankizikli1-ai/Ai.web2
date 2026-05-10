# coding: utf-8
# Phase 4A — Market Data Tool
# Phase 4B — Binance public REST provider (implemented, no API key required)
#
# Additional providers (Phase 4B+):
#   "yahoo_finance" → yfinance library (already in requirements, no key needed)
#   "coingecko"     → Free tier; Env: COINGECKO_API_KEY (optional)
#   "tradingview"   → Paid data feed; Env: TRADINGVIEW_TOKEN
#
# To activate Binance:
#   Railway env vars: MARKET_DATA_PROVIDER=binance
#                     ENABLE_TOOLS=true
#                     ENABLE_MARKET_DATA=true
import os
import re
import json
import asyncio
import logging
import urllib.request
import urllib.error
from backend.services.tools.base_tool import BaseTool

logger = logging.getLogger(__name__)

_PROVIDER = os.getenv("MARKET_DATA_PROVIDER", "").strip().lower()
_BINANCE_BASE = "https://api.binance.com/api/v3"
_TIMEOUT = 10  # seconds

# Crypto symbols Binance accepts with USDT pair
_CRYPTO_TICKERS = {
    "BTC", "ETH", "BNB", "SOL", "XRP", "ADA", "DOGE", "MATIC", "DOT",
    "AVAX", "LINK", "UNI", "ATOM", "LTC", "ETC", "XLM", "ALGO", "VET",
    "FIL", "TRX", "NEAR", "SAND", "MANA", "APE", "AAVE", "CRV", "SUSHI",
    "ARB", "OP", "INJ", "SUI", "APT", "PEPE", "SHIB", "FLOKI", "TON",
}


class MarketDataTool(BaseTool):
    name = "market_data"
    description = (
        "Fetches live price, RSI, volume trend, support/resistance, trend direction, "
        "and volatility for crypto analysis. Phase 4B: Binance public REST (no key needed)."
    )

    async def run(self, query: str, context: dict = None) -> dict:
        ctx = context or {}
        if not _PROVIDER:
            return self._unavailable(
                "Market data provider not configured. "
                "Set MARKET_DATA_PROVIDER=binance and ENABLE_MARKET_DATA=true."
            )
        if _PROVIDER == "binance":
            return await self._from_binance(query, ctx)
        elif _PROVIDER in ("yahoo_finance", "yahoo"):
            return await self._from_yahoo(query, ctx)
        elif _PROVIDER == "coingecko":
            return self._unavailable("CoinGecko provider not yet implemented (Phase 4B+).")

        return self._unavailable(f"Unknown provider: '{_PROVIDER}'.")

    # ── Symbol extraction ────────────────────────────────────────────────────

    @staticmethod
    def parse_symbol(message: str) -> str | None:
        """
        Extract a trading symbol from free-form text.
        Handles: BTC, ETH/USDT, BTC-USD, BTCUSDT, btc usdt
        """
        text = message.upper()
        # Explicit pair formats: BTC/USDT, BTC-USD, BTCUSDT
        m = re.search(r'\b([A-Z]{2,6})(?:[/-])?(USDT|USD|BTC|ETH|EUR|BUSD)\b', text)
        if m:
            return m.group(1) + m.group(2)
        # Bare ticker: BTC, ETH, SOL
        m = re.search(r'\b(BTC|ETH|BNB|SOL|XRP|ADA|DOGE|MATIC|DOT|AVAX|'
                      r'LINK|UNI|ATOM|LTC|ETC|XLM|ALGO|VET|ARB|OP|INJ|'
                      r'SUI|APT|PEPE|SHIB|TON|NEAR|SAND|MANA|APE|TRX)\b', text)
        if m:
            return m.group(1)
        return None

    # ── Binance provider ───────────────────────────────────────────────────────

    async def _from_binance(self, query: str, ctx: dict) -> dict:
        raw_symbol = ctx.get("symbol") or self.parse_symbol(query) or "BTCUSDT"
        symbol = _normalize_binance_symbol(raw_symbol)
        interval = ctx.get("timeframe", ctx.get("interval", "1h"))
        limit = min(int(ctx.get("limit", 150)), 500)

        # Validate interval
        valid_intervals = {"1m","3m","5m","15m","30m","1h","2h","4h","6h","8h","12h","1d","3d","1w","1M"}
        if interval not in valid_intervals:
            interval = "1h"

        url = f"{_BINANCE_BASE}/klines?symbol={symbol}&interval={interval}&limit={limit}"
        try:
            raw = await _fetch_json(url, timeout=_TIMEOUT)
        except _BinanceSymbolError as exc:
            return self._unavailable(str(exc))
        except Exception as exc:
            logger.warning("market_data binance fetch error: %s", exc)
            return self._error(f"Binance fetch failed: {exc}")

        if not raw or len(raw) < 20:
            return self._unavailable(f"Insufficient candle data for {symbol} ({len(raw)} candles).")

        # Parse OHLCV
        opens   = [float(c[1]) for c in raw]
        highs   = [float(c[2]) for c in raw]
        lows    = [float(c[3]) for c in raw]
        closes  = [float(c[4]) for c in raw]
        volumes = [float(c[5]) for c in raw]

        last_price   = closes[-1]
        open_24h     = closes[-25] if len(closes) >= 25 else closes[0]
        change_24h   = round((last_price - open_24h) / open_24h * 100, 2)
        volume_24h   = sum(volumes[-24:]) if len(volumes) >= 24 else sum(volumes)

        # Indicators
        rsi          = _calc_rsi(closes)
        ema20        = _calc_ema(closes, 20)
        ema50        = _calc_ema(closes, 50)
        trend        = _trend_direction(closes, ema20, ema50)
        vol_trend    = _volume_trend(volumes)
        support, resistance = _support_resistance(highs, lows, closes)
        atr          = _calc_atr(highs, lows, closes)
        volatility   = round(atr / last_price * 100, 3) if last_price > 0 else 0.0
        bos          = _detect_bos(highs, lows, closes)

        return self._ok({
            "symbol":          symbol,
            "timeframe":       interval,
            "last_price":      round(last_price, 6),
            "change_24h_pct":  change_24h,
            "volume_24h":      round(volume_24h, 4),
            "rsi_14":          rsi,
            "ema20":           round(ema20, 6),
            "ema50":           round(ema50, 6),
            "trend":           trend,
            "volume_trend":    vol_trend,
            "support":         support,
            "resistance":      resistance,
            "atr_14":          round(atr, 6),
            "volatility_pct":  volatility,
            "bos":             bos,
            "candles_analyzed": len(raw),
        }, provider="binance")

    # ── Yahoo Finance provider (Phase 4B+) ────────────────────────────────────

    async def _from_yahoo(self, query: str, ctx: dict) -> dict:
        # yfinance is synchronous — run in executor to avoid blocking the loop
        raw_symbol = ctx.get("symbol") or self.parse_symbol(query) or "BTC-USD"
        symbol = _normalize_yahoo_symbol(raw_symbol)
        period  = ctx.get("period", "5d")
        interval = ctx.get("timeframe", "1h")

        def _sync_fetch():
            import yfinance as yf  # noqa: PLC0415
            ticker = yf.Ticker(symbol)
            hist   = ticker.history(period=period, interval=interval)
            if hist.empty:
                raise ValueError(f"No data returned for {symbol}")
            return hist

        try:
            loop = asyncio.get_event_loop()
            hist = await loop.run_in_executor(None, _sync_fetch)
        except Exception as exc:
            logger.warning("market_data yahoo fetch error: %s", exc)
            return self._error(f"Yahoo Finance fetch failed: {exc}")

        closes  = list(hist["Close"])
        highs   = list(hist["High"])
        lows    = list(hist["Low"])
        volumes = list(hist["Volume"])

        if len(closes) < 10:
            return self._unavailable(f"Insufficient Yahoo Finance data for {symbol}.")

        last_price = closes[-1]
        rsi        = _calc_rsi(closes)
        trend      = _trend_direction(closes, _calc_ema(closes, 20), _calc_ema(closes, min(50, len(closes)-1)))
        vol_trend  = _volume_trend(volumes)
        support, resistance = _support_resistance(highs, lows, closes)

        return self._ok({
            "symbol":         symbol,
            "timeframe":      interval,
            "last_price":     round(last_price, 4),
            "rsi_14":         rsi,
            "trend":          trend,
            "volume_trend":   vol_trend,
            "support":        support,
            "resistance":     resistance,
            "candles_analyzed": len(closes),
        }, provider="yahoo_finance")


# ── Module-level calculation helpers ────────────────────────────────────────────────

def _normalize_binance_symbol(raw: str) -> str:
    """Normalize user input to a valid Binance symbol (e.g. 'BTC/USDT' → 'BTCUSDT')."""
    s = raw.upper().replace("/", "").replace("-", "").replace(" ", "")
    # If it already ends with a quote currency, return as-is
    for quote in ("USDT", "BUSD", "BTC", "ETH", "EUR"):
        if s.endswith(quote) and s != quote:
            return s
    # Bare ticker — append USDT
    if s in _CRYPTO_TICKERS:
        return s + "USDT"
    # Unknown — try appending USDT and let Binance reject it if wrong
    return s + "USDT"


def _normalize_yahoo_symbol(raw: str) -> str:
    """Normalize to Yahoo Finance format (e.g. 'BTCUSDT' → 'BTC-USD')."""
    s = raw.upper().replace("/", "").replace("-", "")
    for quote in ("USDT", "BUSD", "USD"):
        if s.endswith(quote):
            base = s[:-len(quote)]
            return f"{base}-USD"
    return raw.upper()


def _calc_rsi(closes: list, period: int = 14) -> float:
    """Wilder's RSI. Returns 50.0 when there isn't enough data."""
    if len(closes) < period + 1:
        return 50.0
    deltas = [closes[i] - closes[i - 1] for i in range(1, len(closes))]
    gains  = [d if d > 0 else 0.0 for d in deltas]
    losses = [-d if d < 0 else 0.0 for d in deltas]
    # Seed with simple average over first period
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period
    # Wilder's smoothing for the rest
    for i in range(period, len(deltas)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return round(100.0 - (100.0 / (1.0 + rs)), 2)


def _calc_ema(closes: list, period: int) -> float:
    """Exponential moving average."""
    if len(closes) < period:
        return closes[-1] if closes else 0.0
    k   = 2.0 / (period + 1)
    ema = sum(closes[:period]) / period
    for price in closes[period:]:
        ema = price * k + ema * (1.0 - k)
    return ema


def _calc_atr(highs: list, lows: list, closes: list, period: int = 14) -> float:
    """Average True Range (Wilder's smoothing)."""
    if len(closes) < 2:
        return 0.0
    trs = []
    for i in range(1, len(closes)):
        tr = max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i - 1]),
            abs(lows[i]  - closes[i - 1]),
        )
        trs.append(tr)
    if len(trs) < period:
        return sum(trs) / len(trs)
    atr = sum(trs[:period]) / period
    for tr in trs[period:]:
        atr = (atr * (period - 1) + tr) / period
    return atr


def _trend_direction(closes: list, ema20: float, ema50: float) -> str:
    """
    Returns 'uptrend', 'downtrend', or 'sideways'.
    Uses EMA20/EMA50 crossover with a 0.3% buffer to filter noise.
    """
    if len(closes) < 50:
        return "insufficient_data"
    threshold = 0.003  # 0.3%
    if ema20 > ema50 * (1 + threshold):
        return "uptrend"
    if ema20 < ema50 * (1 - threshold):
        return "downtrend"
    return "sideways"


def _volume_trend(volumes: list, window: int = 7) -> str:
    """
    Compares average volume of last <window> candles vs the prior <window>.
    Returns 'increasing', 'decreasing', or 'neutral'.
    """
    if len(volumes) < window * 2:
        return "neutral"
    recent = sum(volumes[-window:]) / window
    prior  = sum(volumes[-window * 2:-window]) / window
    if prior == 0:
        return "neutral"
    ratio = recent / prior
    if ratio > 1.20:
        return "increasing"
    if ratio < 0.80:
        return "decreasing"
    return "neutral"


def _support_resistance(
    highs: list, lows: list, closes: list, swing_window: int = 5
) -> tuple:
    """
    Finds nearest support (swing low below price) and resistance (swing high above price).
    Falls back to recent 20-candle min/max when no swing pivots are found.
    """
    if len(closes) < swing_window * 2 + 1:
        return round(min(lows), 6), round(max(highs), 6)

    last_price = closes[-1]
    swing_highs, swing_lows = [], []
    n = len(highs)

    for i in range(swing_window, n - swing_window):
        window_h = highs[i - swing_window: i + swing_window + 1]
        window_l = lows[i - swing_window:  i + swing_window + 1]
        if highs[i] == max(window_h):
            swing_highs.append(highs[i])
        if lows[i] == min(window_l):
            swing_lows.append(lows[i])

    # Nearest support below price
    supports    = sorted([s for s in swing_lows  if s < last_price], reverse=True)
    resistances = sorted([r for r in swing_highs if r > last_price])

    support    = round(supports[0],    6) if supports    else round(min(lows[-20:]),  6)
    resistance = round(resistances[0], 6) if resistances else round(max(highs[-20:]), 6)
    return support, resistance


def _detect_bos(highs: list, lows: list, closes: list, lookback: int = 30) -> str:
    """
    Break of Structure detection.
    Bullish BOS: last close breaks above the highest swing high of the lookback window.
    Bearish BOS: last close breaks below the lowest swing low of the lookback window.
    """
    if len(closes) < lookback + 5:
        return "unknown"
    # Use candles [-(lookback+5) : -5] to define the prior structure
    prior_highs = highs[-(lookback + 5): -5]
    prior_lows  = lows[-(lookback + 5): -5]
    last_close  = closes[-1]

    prev_high = max(prior_highs)
    prev_low  = min(prior_lows)

    if last_close > prev_high:
        return "bullish_bos"
    if last_close < prev_low:
        return "bearish_bos"
    return "range"


# ── Async HTTP helper ───────────────────────────────────────────────────────────

class _BinanceSymbolError(Exception):
    """Raised when Binance returns 400 for an invalid symbol."""


async def _fetch_json(url: str, timeout: int = 10) -> list | dict:
    """
    Fetch JSON from a URL. Uses aiohttp if available, otherwise falls back
    to urllib in a thread executor (zero additional dependencies).
    """
    try:
        import aiohttp  # noqa: PLC0415
        async with aiohttp.ClientSession() as session:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=timeout)) as resp:
                if resp.status == 400:
                    body = await resp.json(content_type=None)
                    msg  = body.get("msg", "Invalid symbol") if isinstance(body, dict) else "Invalid symbol"
                    raise _BinanceSymbolError(f"Binance: {msg} — check symbol name")
                if resp.status != 200:
                    raise RuntimeError(f"HTTP {resp.status} from {url}")
                return await resp.json(content_type=None)
    except ImportError:
        pass  # fall through to urllib

    # urllib fallback — run synchronously in thread executor
    def _sync():
        try:
            with urllib.request.urlopen(url, timeout=timeout) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as exc:
            if exc.code == 400:
                body = json.loads(exc.read())
                msg  = body.get("msg", "Invalid symbol") if isinstance(body, dict) else "Invalid symbol"
                raise _BinanceSymbolError(f"Binance: {msg} — check symbol name") from exc
            raise

    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _sync)
