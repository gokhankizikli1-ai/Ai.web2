# coding: utf-8
import asyncio
import logging
from data_sources import (
    get_stock_data, get_crypto_data, get_news, search_web,
    format_price_data, format_news, format_web,
    CRYPTO_SYMBOLS, KNOWN_STOCKS,
)

logger = logging.getLogger(__name__)

DEPTH_CONFIG = {
    "low":    {"web": 4,  "news": 3,  "label": "Quick"},
    "medium": {"web": 12, "news": 6,  "label": "Standard"},
    "high":   {"web": 20, "news": 10, "label": "Deep"},
}

RESEARCH_INTENTS = {
    "finance", "crypto", "stock", "ecommerce", "ads",
    "product_research", "news", "general_question", "coding", "education",
    "consumer_advice",
}

HIGH_TRIGGERS = [
    "very detailed", "deep analysis", "full analysis", "comprehensive",
    "in depth", "research thoroughly", "complete analysis",
    "derin analiz", "cok detayli", "kapsamli", "tam analiz",
]

MEDIUM_TRIGGERS = [
    "analyze", "research", "look into", "what do you think",
    "should i buy", "worth it", "how does it look",
    "analiz et", "incele", "ne olur", "alinir mi",
]


def detect_research_depth(message):
    msg = message.lower()
    for t in HIGH_TRIGGERS:
        if t in msg:
            return "high"
    for t in MEDIUM_TRIGGERS:
        if t in msg:
            return "medium"
    return "low"


def decide_tools(user_text, intent):
    category = intent.get("intent", "normal_chat")
    symbol = intent.get("symbol")
    tools = []
    if category in ("finance", "crypto", "stock"):
        if symbol:
            tools += ["price", "news", "macro"]
    elif category == "consumer_advice":
        tools += ["web"]  # search product recommendations
    elif category in ("ecommerce", "ads", "product_research"):
        tools += ["web", "news"]
    elif category == "news":
        tools += ["news", "macro"]
    elif category in ("general_question", "coding", "education"):
        tools += ["web"]
    return tools


async def run_tools(user_text, intent, depth="medium"):
    tools = decide_tools(user_text, intent)
    symbol = intent.get("symbol", "")
    cfg = DEPTH_CONFIG.get(depth, DEPTH_CONFIG["medium"])
    results = {
        "tools_used": tools,
        "depth": cfg["label"],
        "price": None,
        "news": None,
        "macro": None,
        "web": None,
        "errors": [],
    }
    if not tools:
        return results

    async def fetch_price():
        if not symbol:
            results["price"] = {"error": "No symbol"}
            return
        try:
            if symbol in CRYPTO_SYMBOLS or intent.get("asset_type") == "crypto":
                results["price"] = get_crypto_data(symbol)
            else:
                results["price"] = get_stock_data(symbol)
        except Exception as e:
            results["price"] = {"error": str(e)}
            results["errors"].append("price: " + str(e))

    async def fetch_news():
        try:
            query = symbol + " news latest" if symbol else user_text + " latest news"
            results["news"] = get_news(query, cfg["news"])
        except Exception as e:
            results["news"] = []
            results["errors"].append("news: " + str(e))

    async def fetch_macro():
        try:
            results["macro"] = get_news(
                "global markets bitcoin nasdaq fed rates latest",
                min(cfg["news"], 5),
            )
        except Exception as e:
            results["macro"] = []
            results["errors"].append("macro: " + str(e))

    async def fetch_web():
        try:
            query = user_text if len(user_text) > 5 else symbol + " analysis"
            results["web"] = search_web(query, cfg["web"])
        except Exception as e:
            results["web"] = []
            results["errors"].append("web: " + str(e))

    task_map = {
        "price": fetch_price,
        "news":  fetch_news,
        "macro": fetch_macro,
        "web":   fetch_web,
    }
    tasks = [task_map[t]() for t in tools if t in task_map]
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)

    logger.info("Tools: " + str(tools) + " | Depth: " + cfg["label"] + " | Errors: " + str(results["errors"]))
    return results


def build_context_for_ai(user_text, tool_results, user_profile=""):
    parts = []
    depth = tool_results.get("depth", "")
    tools = tool_results.get("tools_used", [])
    if tools:
        parts.append("[RESEARCH: " + depth + " | Tools: " + ", ".join(tools) + "]")
    if tool_results.get("price"):
        parts.append(format_price_data(tool_results["price"]))
    if tool_results.get("news"):
        parts.append(format_news(tool_results["news"], "LATEST NEWS"))
    if tool_results.get("macro"):
        parts.append(format_news(tool_results["macro"], "MACRO MARKET"))
    if tool_results.get("web"):
        parts.append(format_web(tool_results["web"], "WEB RESEARCH"))
    errors = tool_results.get("errors", [])
    if errors:
        parts.append("[WARNING: Data unavailable for: " + ", ".join(errors) + ". Do not invent data.]")
    if user_profile and "No user info" not in user_profile:
        parts.append("[USER PROFILE]\n" + user_profile)
    if not parts:
        return "[NO DATA: Answer from general knowledge. Do not invent data.]"
    return "\n\n".join(parts)
