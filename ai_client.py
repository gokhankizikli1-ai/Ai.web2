# coding: utf-8
import os
import json
import logging
import re
import asyncio
import time
import openai
import google.generativeai as genai
from data_sources import CRYPTO_SYMBOLS, KNOWN_STOCKS

logger = logging.getLogger(__name__)

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

AI_TIMEOUT      = 30  # seconds
FALLBACK_MSG    = "Simdi yanit veremiyorum, biraz sonra tekrar dene."

genai.configure(api_key=GEMINI_API_KEY)


async def ask_openai(prompt, system="", history=None, model="gpt-4o-mini"):
    try:
        client = openai.AsyncOpenAI(api_key=OPENAI_API_KEY)
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        if history:
            for role, content in history:
                messages.append({"role": role, "content": content})
        messages.append({"role": "user", "content": prompt})
        resp = await asyncio.wait_for(
            client.chat.completions.create(
                model=model, messages=messages, max_tokens=2500,
            ),
            timeout=AI_TIMEOUT,
        )
        result = resp.choices[0].message.content
        if not result or not result.strip():
            logger.warning("OpenAI returned empty response, using Gemini")
            return await ask_gemini(prompt, system)
        return result
    except asyncio.TimeoutError:
        logger.warning("OpenAI timeout (" + model + "), using Gemini fallback")
        return await ask_gemini(prompt, system)
    except Exception as e:
        logger.warning("OpenAI error (" + model + "): " + str(e) + " -- Gemini fallback")
        return await ask_gemini(prompt, system)


async def ask_gemini(prompt, system=""):
    try:
        model = genai.GenerativeModel("gemini-2.0-flash-exp")
        full = (system + "\n\n" + prompt) if system else prompt
        response = await asyncio.wait_for(
            asyncio.get_event_loop().run_in_executor(
                None, model.generate_content, full
            ),
            timeout=AI_TIMEOUT,
        )
        result = response.text
        if not result or not result.strip():
            return FALLBACK_MSG
        return result
    except asyncio.TimeoutError:
        logger.error("Gemini timeout")
        return FALLBACK_MSG
    except Exception as e:
        logger.error("Gemini error: " + str(e))
        return FALLBACK_MSG


async def ask_ai(prompt, system="", history=None, use_gpt4=False, model=None):
    if model is None:
        model = "gpt-4o" if use_gpt4 else "gpt-4o-mini"
    t0 = time.monotonic()
    result = await ask_openai(prompt, system, history, model)
    elapsed = round(time.monotonic() - t0, 2)
    logger.info("ask_ai | model=" + model + " | time=" + str(elapsed) + "s | chars=" + str(len(result)))
    return result


# Uncertain intent phrases - if detected, bot should ask clarification
_UNCERTAIN_PHRASES = [
    "ne yapayim", "ne diyorsun", "bir sey sorcam", "sana bakayim",
    "ne dersin", "nasil", "iyi mi", "mantikli mi",
]

def _is_ambiguous(message):
    msg = message.lower().strip()
    # Very short and no clear domain keyword
    if len(msg.split()) < 4:
        domain_hints = [
            "btc", "eth", "bitcoin", "hisse", "borsa", "kripto",
            "tablet", "telefon", "laptop", "araba", "kod", "python",
            "dropshipping", "satmak", "ogret", "anlat", "ogretmen",
            "moralim", "stress", "uzuldÃ¼m", "agladÄ±m",
        ]
        if not any(h in msg for h in domain_hints):
            return True
    return False


async def detect_intent(message):
    prompt = (
        "Analyze the user message and return only JSON.\n\n"
        "Message: \"" + message + "\"\n\n"
        "INTENT CATEGORIES AND RULES:\n\n"
        "consumer_advice: User wants to BUY something for personal use.\n"
        "  Examples: 'tablet almak istiyorum', 'hangi telefonu almaliyim',\n"
        "  'laptop oner', 'bu araba mantikli mi'. PRIORITY: HIGH.\n\n"
        "ecommerce: User wants to SELL products, run dropshipping, open an online store.\n"
        "  Must include: satmak, dropshipping, shopify, e-ticaret, magaza ac, urun sat.\n\n"
        "ads: About advertising, Facebook/TikTok/Instagram ads, marketing.\n\n"
        "product_research: Market analysis to sell, profit margin, supplier search.\n"
        "  Must be clearly seller perspective.\n\n"
        "finance: Financial analysis, market questions.\n"
        "crypto: Crypto currency analysis (BTC, ETH, etc).\n"
        "stock: Stock/equity analysis (AAPL, NVDA, etc).\n"
        "news: User wants news or current events.\n"
        "task: Set a reminder or task.\n"
        "memory: Save or recall something.\n"
        "portfolio: Investment portfolio questions.\n"
        "normal_chat: Casual conversation.\n"
        "personal_advice: Life advice, decision help.\n"
        "emotional_support: User talks about stress, sadness, bad mood, anxiety, motivation.\n"
        "  Examples: 'moralim bozuk', 'cok stresim var', 'bunaldim', 'motivasyonum yok'.\n"
        "coding: Programming, code, error, deploy, Railway, GitHub, Python.\n"
        "education: User asks to explain, teach, learn, understand something.\n"
        "  Examples: 'bunu anlat', 'ogretmen gibi anlat', 'nasil calisir', 'ogretir misin'.\n"
        "general_question: Factual, general knowledge.\n\n"
        "CRITICAL RULES:\n"
        "- BUY for personal use = consumer_advice ALWAYS\n"
        "- SELL/dropship = ecommerce ALWAYS\n"
        "- Stress/sad/bad mood = emotional_support ALWAYS\n"
        "- Explain/teach = education ALWAYS\n"
        "- If uncertain, use normal_chat\n\n"
        "JSON format:\n"
        "{\n"
        "  \"intent\": \"category\",\n"
        "  \"symbol\": \"symbol or null\",\n"
        "  \"asset_type\": \"crypto or stock or null\",\n"
        "  \"task_text\": \"task text or null\",\n"
        "  \"memory_action\": \"save or forget or list or null\",\n"
        "  \"memory_content\": \"content or null\",\n"
        "  \"forget_keyword\": \"keyword or null\",\n"
        "  \"needs_clarification\": false\n"
        "}\n\n"
        "Return only JSON."
    )
    try:
        client = openai.AsyncOpenAI(api_key=OPENAI_API_KEY)
        resp = await asyncio.wait_for(
            client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": prompt}],
                max_tokens=300,
                response_format={"type": "json_object"},
            ),
            timeout=15,
        )
        result = json.loads(resp.choices[0].message.content)

        # Symbol detection fallback
        if not result.get("symbol"):
            for word in message.upper().split():
                clean = re.sub(r"[^A-Z]", "", word)
                if not clean or len(clean) < 2:
                    continue
                if clean in CRYPTO_SYMBOLS:
                    result["symbol"] = clean
                    result["asset_type"] = "crypto"
                    if result.get("intent") not in ["finance", "crypto", "stock"]:
                        result["intent"] = "crypto"
                    break
                elif clean in KNOWN_STOCKS:
                    result["symbol"] = clean
                    result["asset_type"] = "stock"
                    if result.get("intent") not in ["finance", "crypto", "stock"]:
                        result["intent"] = "stock"
                    break

        # Flag ambiguous messages
        if _is_ambiguous(message):
            result["needs_clarification"] = True

        return result
    except asyncio.TimeoutError:
        logger.warning("detect_intent timeout, defaulting to normal_chat")
        return {"intent": "normal_chat", "symbol": None, "needs_clarification": False}
    except Exception as e:
        logger.error("detect_intent error: " + str(e))
        return {"intent": "normal_chat", "symbol": None, "needs_clarification": False}
