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
from backend.services.tools.base_tool import BaseTool

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

# Multi-timeframe set (parallel fetches when the primary provider is binance/yahoo).
_MTF_TIMEFRAMES = ("1d", "4h", "1h")

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
        raw = await _fetch_json(url, timeout=_TIMEOUT)
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
        primary["plan"]            = _build_plan(primary, mtf or {})

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
        primary["plan"]            = _build_plan(primary, mtf or {})

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
        raw = await _fetch_json(url, timeout=_TIMEOUT)

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
        primary["plan"]            = _build_plan(primary, {})
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
            _fetch_json(ohlc_url, timeout=_TIMEOUT),
            _fetch_json(vol_url,  timeout=_TIMEOUT),
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
        primary["plan"]            = _build_plan(primary, {})
        return self._ok(primary, provider="coingecko")


# ══════════════════════════════════════════════════════════════════════════════
# Helpers — Binance MTF + Futures

async def _fetch_binance_tf(symbol: str, tf: str) -> dict:
    """Fetch one extra timeframe from Binance and return an MTF snapshot."""
    url = f"{_BINANCE_BASE}/klines?symbol={symbol}&interval={tf}&limit=200"
    raw = await _fetch_json(url, timeout=_TIMEOUT)
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
        _safe(_fetch_json(premium_url, timeout=_TIMEOUT)),
        _safe(_fetch_json(oi_url,      timeout=_TIMEOUT)),
        _safe(_fetch_json(oi_hist_url, timeout=_TIMEOUT)),
        _safe(_fetch_json(ls_global,   timeout=_TIMEOUT)),
        _safe(_fetch_json(ls_top_pos,  timeout=_TIMEOUT)),
        _safe(_fetch_json(taker_url,   timeout=_TIMEOUT)),
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

    return out


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
        "candles_analyzed": n,
    }


# ══════════════════════════════════════════════════════════════════════════════
# Auto risk plan + setup grade

def _build_plan(primary: dict, mtf: dict) -> dict:
    """
    Compose an ATR-anchored risk plan (long + short variants) and a 0-10 setup grade.
    Reads only fields from `primary` and `mtf` — pure function, no external state.
    """
    price = primary.get("last_price") or 0
    atr   = primary.get("atr_14") or 0
    sup   = primary.get("support") or 0
    res   = primary.get("resistance") or 0

    if not price or not atr:
        return {
            "side_bias":   "neutral",
            "setup_grade": 0,
            "notes":       "Insufficient data for plan",
        }

    # Stop = 1.5×ATR; TP1 = 3×ATR (R:R 2.0); TP2 = 5×ATR (R:R 3.33)
    long_stop  = round(price - atr * 1.5, 6)
    short_stop = round(price + atr * 1.5, 6)
    long_tp1   = round(price + atr * 3.0, 6)
    long_tp2   = round(price + atr * 5.0, 6)
    short_tp1  = round(price - atr * 3.0, 6)
    short_tp2  = round(price - atr * 5.0, 6)

    # Bias from MTF alignment + trend + BOS + RSI
    align    = (primary.get("mtf_alignment") or {}).get("alignment") if primary.get("mtf_alignment") else None
    mtf_obj  = primary.get("mtf_alignment") or _mtf_alignment(mtf) if mtf else None
    align    = (mtf_obj or {}).get("alignment", "mixed")

    trend    = primary.get("trend")
    bos      = primary.get("bos")
    rsi      = primary.get("rsi_14") or 50.0
    vt       = primary.get("volume_trend")
    regime   = primary.get("regime")

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
    if align in ("bullish",):         bull_pts += 2
    elif align in ("bullish_partial",): bull_pts += 1
    elif align in ("bearish",):       bear_pts += 2
    elif align in ("bearish_partial",): bear_pts += 1

    if bull_pts - bear_pts >= 2:      side_bias = "long"
    elif bear_pts - bull_pts >= 2:    side_bias = "short"
    else:                             side_bias = "neutral"

    # Pick R:R numbers for the proposed side
    if side_bias == "long":
        entry, stop, tp1, tp2 = price, long_stop,  long_tp1,  long_tp2
        risk   = entry - stop
        reward = tp1 - entry
    elif side_bias == "short":
        entry, stop, tp1, tp2 = price, short_stop, short_tp1, short_tp2
        risk   = stop - entry
        reward = entry - tp1
    else:
        entry = stop = tp1 = tp2 = None
        risk = reward = 0

    rr_ratio = round(reward / risk, 2) if risk > 0 else 0.0

    # Setup quality (0-10): bias strength + RR + regime + squeeze bonus
    bias_strength = abs(bull_pts - bear_pts)
    grade = min(10, bias_strength * 2)
    if rr_ratio >= 2.5:     grade = min(10, grade + 2)
    elif rr_ratio >= 2.0:   grade = min(10, grade + 1)
    elif rr_ratio < 1.5 and side_bias != "neutral":
                            grade = max(0, grade - 1)
    if regime in ("squeeze_pre_breakout",): grade = min(10, grade + 1)
    if regime == "choppy":  grade = max(0, grade - 2)

    invalidation = None
    if side_bias == "long" and sup:
        invalidation = f"Daily close below support {sup} kills the long thesis"
    elif side_bias == "short" and res:
        invalidation = f"Daily close above resistance {res} kills the short thesis"

    return {
        "side_bias":   side_bias,
        "entry":       entry,
        "stop":        stop,
        "take_profit_1": tp1,
        "take_profit_2": tp2,
        "risk_reward": rr_ratio,
        "stop_atr_multiple":   1.5,
        "target_atr_multiple": 3.0,
        "setup_grade":         int(grade),
        "bias_strength":       int(bias_strength),
        "bull_points":         int(bull_pts),
        "bear_points":         int(bear_pts),
        "invalidation":        invalidation,
        "notes": (
            "Plan is ATR-anchored (1.5×ATR stop, 3/5×ATR targets → baseline R:R 2.0 / 3.33). "
            "AI must justify, refine, or veto based on structure, MTF alignment, and risk context."
        ),
    }


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
# Async HTTP helper

class _BinanceSymbolError(Exception):
    """Raised on Binance HTTP 400 (invalid symbol)."""


async def _fetch_json(url: str, timeout: int = 10):
    """
    Fetch JSON via aiohttp (in requirements), falling back to urllib.
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
            raise RuntimeError(f"HTTP {exc.code} from {url}") from exc

    return await asyncio.get_event_loop().run_in_executor(None, _sync)
