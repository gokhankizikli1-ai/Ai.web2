# coding: utf-8
import sys
import os
import logging

# Allow importing from parent project (existing intelligence layer)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))

from ai_client import ask_ai, detect_intent
from ai_router import get_model_config
from agent import run_tools, build_context_for_ai, detect_research_depth, DEPTH_CONFIG, RESEARCH_INTENTS
from prompts import (
    CHAT_SYSTEM, CHAT_RULES,
    FINANCE_SYSTEM, FINANCE_TEMPLATE,
    DROP_SYSTEM, DROP_TEMPLATE,
    EDUCATION_SYSTEM, EDUCATION_TEMPLATE,
    ADVICE_SYSTEM, ADVICE_TEMPLATE,
    EMOTIONAL_SYSTEM, PERSONAL_SYSTEM,
)
from finance import run_finance_analysis
from ecommerce import run_ecommerce_analysis

logger = logging.getLogger(__name__)

# Ecommerce guard keywords
_ECOM_KW = [
    "satmak", "dropshipping", "shopify", "ecommerce", "e-ticaret",
    "magaza", "urun sat", "kar marji", "supplier", "tedarik",
    "reklam ver", "facebook ads", "tiktok ads",
]
_BUYER_KW = [
    "almak istiyorum", "alayim mi", "almaliyim", "oner",
    "tavsiye et", "hangisi iyi", "hangisini alayim", "satin al",
]


async def process_chat(
    user_id: str,
    message: str,
    platform: str,
    profile: str,
    history: list,
    mem_summary: str,
    style_prompt: str,
) -> dict:
    """
    Core AI orchestration. Platform-independent.
    Returns dict with reply, intent, model, mode, etc.
    """

    text_lower = message.lower().strip()

    # Depth and intent
    depth       = detect_research_depth(message)
    depth_label = DEPTH_CONFIG[depth]["label"]

    intent   = await detect_intent(message)
    category = intent.get("intent", "normal_chat")
    symbol   = intent.get("symbol")

    # Safety: buyer vs seller guard
    if category in ("ecommerce", "ads", "product_research"):
        has_ecom  = any(k in text_lower for k in _ECOM_KW)
        has_buyer = any(k in text_lower for k in _BUYER_KW)
        if has_buyer and not has_ecom:
            category = "consumer_advice"

    # Category whitelist
    _VALID = {
        "finance", "crypto", "stock", "ecommerce", "ads",
        "product_research", "news", "task", "memory", "portfolio",
        "normal_chat", "personal_advice", "coding", "education",
        "general_question", "consumer_advice", "emotional_support",
    }
    if category not in _VALID:
        category = "normal_chat"

    # Model config
    model_cfg  = get_model_config(category, depth, message)
    use_gpt4   = model_cfg["use_gpt4"]
    ai_model   = model_cfg["model"]
    ai_mode    = model_cfg.get("mode", "chat")
    provider   = model_cfg.get("provider", "openai")

    # Follow-up detection
    _is_followup = (
        len(message.split()) <= 6 and
        any(message.lower().strip().endswith(t)
            for t in ["mi", "mi?", "mu", "mu?", "mı", "mi cevap", "cevap"])
    )
    if _is_followup:
        intent["needs_clarification"] = False
        if category == "normal_chat":
            category = "education"
            ai_mode  = "education"

    # Tool execution
    if category in RESEARCH_INTENTS:
        tool_results = await run_tools(message, intent, depth)
    else:
        tool_results = {
            "tools_used": [], "price": None,
            "news": None, "macro": None, "web": None, "errors": [],
        }

    tool_context = build_context_for_ai(message, tool_results, profile)

    # --- Route to correct handler ---
    result = await _route(
        category, ai_mode, ai_model, use_gpt4,
        message, symbol, depth_label,
        tool_context, tool_results,
        history, mem_summary, style_prompt,
        profile, _is_followup,
    )

    return {
        "reply":   result,
        "intent":  category,
        "model":   ai_model,
        "provider": provider,
        "mode":    ai_mode,
    }


async def _route(
    category, ai_mode, ai_model, use_gpt4,
    message, symbol, depth_label,
    tool_context, tool_results,
    history, mem_summary, style_prompt,
    profile, is_followup,
):
    text_lower = message.lower()

    # Finance
    if category in ("finance", "crypto", "stock") and symbol:
        return await run_finance_analysis(
            message, symbol, depth_label, tool_context,
            mem_summary, style_prompt, use_gpt4, model=ai_model,
        )

    # Ecommerce
    if category in ("ecommerce", "ads", "product_research"):
        return await run_ecommerce_analysis(
            message, tool_context, mem_summary, style_prompt, use_gpt4, model=ai_model,
        )

    # News
    if category == "news":
        news_prompt = (
            "Kullanici sorusu: " + message + "\n\n" +
            tool_context + "\n\n" +
            "En onemli 5 haberi ozetle, her birine kisa yorum ekle."
        )
        return await ask_ai(news_prompt, "Haber editorusun. Net, Turkce ozetle.", model=ai_model)

    # Consumer advice
    if category == "consumer_advice":
        has_web = bool(tool_results.get("web"))
        ctx = tool_context if has_web else "[Web verisi alinamadi. Guncel fiyat icin kullaniciya Trendyol/Amazon kontrol etmesini oner.]"
        adv_sys = ADVICE_SYSTEM
        if mem_summary:
            adv_sys += "\n\nKullanici hafizasi:\n" + mem_summary
        if style_prompt:
            adv_sys += "\n\n" + style_prompt
        prompt = ADVICE_TEMPLATE.format(question=message, context=ctx)
        return await ask_ai(prompt, adv_sys, history, model=ai_model)

    # Education / follow-up
    if category == "education" or ai_mode == "education":
        edu_sys = EDUCATION_SYSTEM
        if mem_summary:
            edu_sys += "\n\nKullanici hafizasi:\n" + mem_summary
        if style_prompt:
            edu_sys += "\n\n" + style_prompt
        if is_followup:
            recent = ""
            if history:
                last_pairs = history[-4:]
                recent = "\n".join(
                    ("Asistan: " if r == "assistant" else "Kullanici: ") + c
                    for r, c in last_pairs
                )
            prompt = (
                "Son konusma:\n" + recent + "\n\n"
                "Kullanicinin yeni mesaji: " + message + "\n\n"
                "Eger kullanici bir soruya cevap verdiyse: dogru/yanlis net soyle, kisaca neden acikla.\n"
                "Eger devam yaziyorsa, konusmaya devam et."
            )
        else:
            prompt = EDUCATION_TEMPLATE.format(question=message, context=tool_context)
        return await ask_ai(prompt, edu_sys, history, model=ai_model)

    # Emotional
    if ai_mode == "emotional_support" or category == "emotional_support":
        sys_p = EMOTIONAL_SYSTEM
        if mem_summary:
            sys_p += "\n\nKullanici hafizasi:\n" + mem_summary
        return await ask_ai(message, sys_p, history, model=ai_model)

    # Personal advice
    if ai_mode == "personal_advice" or category == "personal_advice":
        sys_p = PERSONAL_SYSTEM
        if profile and "No user info" not in profile:
            sys_p += "\n\n" + profile
        if mem_summary:
            sys_p += "\n\nKullanici hafizasi:\n" + mem_summary
        return await ask_ai(message, sys_p, history, model=ai_model)

    # General question / coding
    if category in ("general_question", "coding"):
        prompt = (
            "Kullanici sorusu: " + message + "\n\n" +
            tool_context + "\n\n" +
            "Net, anlasilir Turkce cevap ver. Kendi gorusunu de ekle."
        )
        chat_sys = CHAT_SYSTEM
        if mem_summary:
            chat_sys += "\n\nKullanici hafizasi:\n" + mem_summary
        if style_prompt:
            chat_sys += "\n\n" + style_prompt
        return await ask_ai(prompt, chat_sys, history, model=ai_model)

    # Normal chat (default)
    system = CHAT_SYSTEM
    if profile and "No user info" not in profile:
        system += "\n\n" + profile
    if mem_summary:
        system += "\n\nKullanici hafizasi:\n" + mem_summary
    if style_prompt:
        system += "\n\n" + style_prompt
    system += CHAT_RULES
    return await ask_ai(message, system, history, model=ai_model)
