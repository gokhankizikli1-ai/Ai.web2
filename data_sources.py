# coding: utf-8
import logging
import requests
from duckduckgo_search import DDGS

logger = logging.getLogger(__name__)

CRYPTO_SYMBOLS = {
    "BTC", "ETH", "BNB", "SOL", "XRP", "ADA", "DOGE", "DOT", "AVAX", "MATIC",
    "LINK", "LTC", "SHIB", "TRX", "TON", "UNI", "ATOM", "NEAR", "OP", "ARB",
    "PEPE", "WIF", "SUI", "INJ", "APT", "FTM", "SAND", "MANA", "AXS",
}

COIN_ID_MAP = {
    "BTC": "bitcoin", "ETH": "ethereum", "BNB": "binancecoin", "SOL": "solana",
    "XRP": "ripple", "ADA": "cardano", "DOGE": "dogecoin", "DOT": "polkadot",
    "AVAX": "avalanche-2", "MATIC": "matic-network", "LINK": "chainlink",
    "LTC": "litecoin", "SHIB": "shiba-inu", "TRX": "tron", "TON": "the-open-network",
    "UNI": "uniswap", "ATOM": "cosmos", "NEAR": "near", "OP": "optimism",
    "ARB": "arbitrum", "PEPE": "pepe", "WIF": "dogwifcoin", "SUI": "sui",
    "INJ": "injective-protocol", "APT": "aptos",
}

KNOWN_STOCKS = {
    "AAPL", "NVDA", "MSFT", "AMZN", "GOOGL", "META", "TSLA", "AMD", "INTC",
    "NFLX", "DIS", "PYPL", "UBER", "LYFT", "SNAP", "BABA", "JNJ", "WMT",
    "V", "MA", "JPM", "BAC", "GS", "MS", "C", "WFC", "XOM", "CVX",
    "THYAO", "GARAN", "AKBNK", "EREGL", "KCHOL", "BIMAS", "ASELS", "SISE",
}


def get_crypto_data(symbol):
    symbol = symbol.upper()
    coin_id = COIN_ID_MAP.get(symbol, symbol.lower())
    try:
        url = (
            "https://api.coingecko.com/api/v3/coins/" + coin_id +
            "?localization=false&tickers=false&market_data=true"
            "&community_data=false&developer_data=false"
        )
        resp = requests.get(url, timeout=10)
        data = resp.json()
        md = data.get("market_data", {})
        return {
            "symbol": symbol,
            "current": md.get("current_price", {}).get("usd"),
            "change_1d": md.get("price_change_percentage_24h"),
            "change_7d": md.get("price_change_percentage_7d"),
            "change_30d": md.get("price_change_percentage_30d"),
            "market_cap": md.get("market_cap", {}).get("usd"),
            "volume_24h": md.get("total_volume", {}).get("usd"),
            "high_24h": md.get("high_24h", {}).get("usd"),
            "low_24h": md.get("low_24h", {}).get("usd"),
        }
    except Exception as e:
        logger.error("get_crypto_data error (" + symbol + "): " + str(e))
        return {"symbol": symbol, "error": str(e)}


def get_stock_data(symbol):
    symbol = symbol.upper()
    try:
        import yfinance as yf
        tk = yf.Ticker(symbol)
        info = tk.info
        hist = tk.history(period="3mo")
        current = info.get("currentPrice") or info.get("regularMarketPrice")
        prev = info.get("previousClose")
        change_1d = None
        if current and prev:
            change_1d = round((current - prev) / prev * 100, 2)
        return {
            "symbol": symbol,
            "current": current,
            "change_1d": change_1d,
            "market_cap": info.get("marketCap"),
            "volume": info.get("volume"),
            "pe_ratio": info.get("trailingPE"),
            "closes": hist["Close"] if not hist.empty else None,
        }
    except Exception as e:
        logger.error("get_stock_data error (" + symbol + "): " + str(e))
        return {"symbol": symbol, "error": str(e)}


def get_news(query, max_results=8):
    try:
        results = []
        with DDGS() as ddgs:
            for r in ddgs.news(query, max_results=max_results):
                results.append({
                    "title": r.get("title", ""),
                    "body": r.get("body", ""),
                    "url": r.get("url", ""),
                    "date": r.get("date", ""),
                })
        return results
    except Exception as e:
        logger.error("get_news error: " + str(e))
        return []


def search_web(query, max_results=8):
    try:
        results = []
        with DDGS() as ddgs:
            for r in ddgs.text(query, max_results=max_results):
                results.append({
                    "title": r.get("title", ""),
                    "body": r.get("body", ""),
                    "url": r.get("href", ""),
                })
        return results
    except Exception as e:
        logger.error("search_web error: " + str(e))
        return []


def format_price_data(data):
    if not data or data.get("error"):
        return "[Price data unavailable]"
    lines = ["PRICE DATA: " + str(data.get("symbol", ""))]
    if data.get("current"):
        lines.append("Current: $" + str(data["current"]))
    if data.get("change_1d") is not None:
        lines.append("24h change: " + str(data["change_1d"]) + "%")
    if data.get("change_7d") is not None:
        lines.append("7d change: " + str(data["change_7d"]) + "%")
    if data.get("market_cap"):
        lines.append("Market cap: $" + str(data["market_cap"]))
    if data.get("volume_24h"):
        lines.append("Volume 24h: $" + str(data["volume_24h"]))
    return "\n".join(lines)


def format_news(news_list, label="NEWS"):
    if not news_list:
        return "[No news found]"
    lines = [label + ":"]
    for i, item in enumerate(news_list[:8], 1):
        lines.append(str(i) + ". " + item.get("title", ""))
        body = item.get("body", "")
        if body:
            lines.append("   " + body[:200])
    return "\n".join(lines)


def format_web(results, label="WEB RESEARCH"):
    if not results:
        return "[No web results found]"
    lines = [label + ":"]
    for i, item in enumerate(results[:6], 1):
        lines.append(str(i) + ". " + item.get("title", ""))
        body = item.get("body", "")
        if body:
            lines.append("   " + body[:200])
    return "\n".join(lines)
