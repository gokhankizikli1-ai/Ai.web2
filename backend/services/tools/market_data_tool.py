# coding: utf-8
# Phase 4A — Market Data Tool (interface + placeholder)
#
# Phase 4B will connect a real provider:
#   Provider options:
#     "binance"      → REST API, no key for public endpoints (spot candles)
#                      Env: BINANCE_API_KEY, BINANCE_SECRET (for private endpoints)
#     "yahoo_finance"→ yfinance library, no key required for basic data
#     "tradingview"  → Unofficial scraper or paid TV data feed
#                      Env: TRADINGVIEW_TOKEN
#     "coingecko"    → Free tier available; Env: COINGECKO_API_KEY (optional)
#
#   Set MARKET_DATA_PROVIDER=binance (or yahoo_finance / coingecko) in Railway env.
#
# Data types this tool will serve (Phase 4B):
#   - OHLCV candles (1m, 5m, 15m, 1h, 4h, 1d)
#   - RSI (14-period default)
#   - Volume profile
#   - Support / resistance levels (pivot-based)
#   - Trend direction (EMA cross)
#   - Funding rate + open interest (Phase 4D, derivatives only)
import os
import re
import logging
from backend.services.tools.base_tool import BaseTool

logger = logging.getLogger(__name__)

# Phase 4B: set MARKET_DATA_PROVIDER env var to activate a real provider.
_PROVIDER = os.getenv("MARKET_DATA_PROVIDER", "").strip().lower()


class MarketDataTool(BaseTool):
    name = "market_data"
    description = (
        "Fetches price, RSI, volume, support/resistance, and trend data "
        "for trading analysis. Phase 4B: connects to Binance / Yahoo Finance / CoinGecko."
    )

    async def run(self, query: str, context: dict = None) -> dict:
        # Phase 4B: route to provider here.
        # context keys: symbol, timeframe, indicators (list), limit
        if not _PROVIDER:
            return self._unavailable(
                "Market data provider not configured. "
                "Set MARKET_DATA_PROVIDER=binance (or yahoo_finance) and "
                "ENABLE_MARKET_DATA=true."
            )

        # Phase 4B: uncomment and implement provider branches.
        # if _PROVIDER == "binance":
        #     return await self._from_binance(query, context or {})
        # elif _PROVIDER in ("yahoo_finance", "yahoo"):
        #     return await self._from_yahoo(query, context or {})
        # elif _PROVIDER == "coingecko":
        #     return await self._from_coingecko(query, context or {})

        return self._unavailable(
            f"Provider '{_PROVIDER}' recognised but not yet implemented (Phase 4B)."
        )

    # ── Symbol extraction helper (used by orchestrator) ──────────────────

    @staticmethod
    def parse_symbol(message: str) -> str | None:
        """
        Extract a trading symbol from free-form user text.
        Phase 4B: replace with NLP-based extraction.
        Examples matched: BTC, ETH/USDT, AAPL, BTC-USD
        """
        match = re.search(
            r'\b([A-Z]{2,6}(?:[/-](?:USDT|USD|BTC|ETH|EUR))?)\b',
            message.upper(),
        )
        return match.group(1) if match else None

    # ── Phase 4B provider stubs (implement when provider is connected) ────

    # async def _from_binance(self, query: str, ctx: dict) -> dict:
    #     import aiohttp
    #     symbol   = ctx.get("symbol", self.parse_symbol(query) or "BTCUSDT")
    #     interval = ctx.get("timeframe", "1h")
    #     limit    = ctx.get("limit", 100)
    #     url = f"https://api.binance.com/api/v3/klines?symbol={symbol}&interval={interval}&limit={limit}"
    #     async with aiohttp.ClientSession() as session:
    #         async with session.get(url) as resp:
    #             candles = await resp.json()
    #     rsi = _calc_rsi([float(c[4]) for c in candles])
    #     return self._ok({
    #         "symbol": symbol, "timeframe": interval,
    #         "last_price": float(candles[-1][4]),
    #         "rsi_14": rsi,
    #         "volume_24h": sum(float(c[5]) for c in candles[-24:]),
    #         "candles": candles[-10:],   # last 10 for context
    #     }, provider="binance")

    # async def _from_yahoo(self, query: str, ctx: dict) -> dict:
    #     import yfinance as yf
    #     symbol = ctx.get("symbol", self.parse_symbol(query) or "BTC-USD")
    #     ticker = yf.Ticker(symbol)
    #     hist   = ticker.history(period="1d", interval="1h")
    #     return self._ok({
    #         "symbol": symbol,
    #         "last_price": float(hist["Close"].iloc[-1]),
    #         "volume":     float(hist["Volume"].iloc[-1]),
    #     }, provider="yahoo_finance")

    # async def _from_coingecko(self, query: str, ctx: dict) -> dict: ...
