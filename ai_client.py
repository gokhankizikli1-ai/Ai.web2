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
AI_TIMEOUT     = 30
FALLBACK_MSG   = "Simdi yanit veremiyorum, biraz sonra tekrar dene."

try:
    genai.configure(api_key=GEMINI_API_KEY)
except Exception:
    pass

_SAFETY_RESPONSE = (
    "Bu konuda kesin bir yonlendirme yapamam.\n\n"
    "Bir uzmana danışmanı oneririm:\n"
    "- Saglik: doktor veya psikolog\n"
    "- Hukuk: avukat\n"
    "- Kriz: 182 (Turkiye kriz hatti)\n\n"
    "Baska bir konuda yardimci olabilir miyim?"
)

_SAFETY_KW = [
    "intihar", "kendine zarar", "ilac dozu", "overdose",
    "silah yap", "patlayici", "nasil oldurebilirim",
]


def _is_safety_sensitive(message: str) -> bool:
    t = message.lower()
    return any(k in t for k in _SAFETY_KW)


def _needs_completion_tokens_param(model: str) -> bool:
    """Phase 13C — model-family compatibility. The modern reasoning-family models
    (gpt-5.x and the o-series) reject the legacy Chat Completions `max_tokens`
    parameter and only accept the default temperature; they require
    `max_completion_tokens` instead. This is keyed on the model ID ONLY, so every
    gpt-4o / gpt-4o-mini mode keeps the exact legacy request shape and is unaffected.
    """
    m = (model or "").lower()
    return (
        m.startswith("gpt-5")
        or m.startswith("o1")
        or m.startswith("o3")
        or m.startswith("o4")
    )


async def ask_openai(
    prompt: str,
    system: str = "",
    history: list = None,
    model: str = "gpt-4o-mini",
    temperature: float = 0.80,
    max_tokens: int = 1000,
) -> str:
    try:
        client = openai.AsyncOpenAI(api_key=OPENAI_API_KEY)
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        if history:
            for role, content in history:
                messages.append({"role": role, "content": content})
        messages.append({"role": "user", "content": prompt})
        # Narrow, model-aware request shape. Legacy models keep max_tokens + custom
        # temperature exactly as before; the modern frontend model family uses
        # max_completion_tokens and the default temperature. No extra call, no retry.
        create_kwargs = {"model": model, "messages": messages}
        if _needs_completion_tokens_param(model):
            create_kwargs["max_completion_tokens"] = max_tokens
        else:
            create_kwargs["max_tokens"] = max_tokens
            create_kwargs["temperature"] = temperature
        resp = await asyncio.wait_for(
            client.chat.completions.create(**create_kwargs),
            timeout=AI_TIMEOUT,
        )
        result = resp.choices[0].message.content
        if not result or not result.strip():
            logger.warning("OpenAI empty response, Gemini fallback")
            return await ask_gemini(prompt, system)
        return result
    except asyncio.TimeoutError:
        logger.warning("OpenAI timeout, Gemini fallback")
        return await ask_gemini(prompt, system)
    except Exception as e:
        logger.warning("OpenAI error (" + model + "): " + str(e))
        return await ask_gemini(prompt, system)


async def ask_gemini(prompt: str, system: str = "") -> str:
    try:
        model = genai.GenerativeModel("gemini-2.0-flash-exp")
        full  = (system + "\n\n" + prompt) if system else prompt
        response = await asyncio.wait_for(
            asyncio.get_event_loop().run_in_executor(None, model.generate_content, full),
            timeout=AI_TIMEOUT,
        )
        result = response.text
        return result if result and result.strip() else FALLBACK_MSG
    except asyncio.TimeoutError:
        logger.error("Gemini timeout")
        return FALLBACK_MSG
    except Exception as e:
        logger.error("Gemini error: " + str(e))
        return FALLBACK_MSG


async def ask_ai(
    prompt: str,
    system: str = "",
    history: list = None,
    use_gpt4: bool = False,
    model: str = None,
    temperature: float = 0.80,
    max_tokens: int = 1000,
) -> str:
    # Safety check before any AI call
    if _is_safety_sensitive(prompt):
        return _SAFETY_RESPONSE

    # Phase 2 — project context injection. When /chat received a
    # project_id, the request handler pushed a Project Context block
    # into a ContextVar (no signature change anywhere in the chain).
    # We prepend it here so the LLM sees project memory before any
    # mode-specific system text. Silently no-op when ENABLE_PROJECTS
    # is off or no block was set — chat must never break because of
    # a missing/broken projects table.
    try:
        from backend.services.projects.context import get_current_project_context
        _project_block = get_current_project_context()
    except Exception:
        _project_block = ""
    if _project_block:
        system = (
            _project_block + "\n\n" + system if (system or "").strip()
            else _project_block
        )

    if model is None:
        model = "gpt-4o" if use_gpt4 else "gpt-4o-mini"
    t0 = time.monotonic()
    result = await ask_openai(prompt, system, history, model, temperature, max_tokens)
    elapsed = round(time.monotonic() - t0, 2)
    logger.info("ask_ai | model=%s | time=%ss | chars=%s", model, elapsed, len(result))
    return result


async def detect_intent(message: str) -> dict:
    if _is_safety_sensitive(message):
        return {"intent": "safety_sensitive", "symbol": None, "needs_clarification": False}

    prompt = (
        "Analyze the user message and return only JSON.\n\n"
        "Message: \"" + message + "\"\n\n"
        "INTENT CATEGORIES:\n"
        "consumer_advice: User wants to BUY something for personal use.\n"
        "  Examples: 'tablet almak istiyorum', 'hangi telefon', 'laptop oner'\n\n"
        "ecommerce: User wants to SELL/dropship. Keywords: satmak, dropshipping, shopify.\n\n"
        "ads: Advertising, Facebook/TikTok/Instagram ads, marketing.\n\n"
        "product_research: Seller perspective market research, profit margin, supplier.\n\n"
        "finance: Financial analysis.\n"
        "crypto: Crypto currency.\n"
        "stock: Stocks.\n"
        "news: News/events.\n"
        "task: Reminder or task.\n"
        "memory: Save or recall something.\n"
        "portfolio: Investment portfolio.\n"
        "normal_chat: Casual.\n"
        "personal_advice: Life/decision advice.\n"
        "emotional_support: Stress, sadness, motivation, anxiety.\n"
        "coding: Programming, code, error, deploy.\n"
        "education: Explain/teach/learn/understand.\n"
        "general_question: Factual/general.\n"
        "safety_sensitive: Self-harm, dangerous instructions.\n\n"
        "RULES:\n"
        "- Personal buying = consumer_advice ALWAYS\n"
        "- Selling/dropship = ecommerce ALWAYS\n"
        "- Stress/sad = emotional_support ALWAYS\n"
        "- Explain/teach = education ALWAYS\n"
        "- Uncertain = normal_chat\n\n"
        "JSON:\n"
        "{\n"
        "  \"intent\": \"category\",\n"
        "  \"symbol\": \"symbol or null\",\n"
        "  \"asset_type\": \"crypto or stock or null\",\n"
        "  \"task_text\": \"task text or null\",\n"
        "  \"memory_action\": \"save or forget or list or null\",\n"
        "  \"memory_content\": \"content or null\",\n"
        "  \"forget_keyword\": \"keyword or null\",\n"
        "  \"needs_clarification\": false\n"
        "}\n\nReturn only JSON."
    )
    try:
        client = openai.AsyncOpenAI(api_key=OPENAI_API_KEY)
        resp = await asyncio.wait_for(
            client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": prompt}],
                max_tokens=300,
                temperature=0.1,
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
        return result
    except asyncio.TimeoutError:
        logger.warning("detect_intent timeout")
        return {"intent": "normal_chat", "symbol": None, "needs_clarification": False}
    except Exception as e:
        logger.error("detect_intent error: " + str(e))
        return {"intent": "normal_chat", "symbol": None, "needs_clarification": False}
