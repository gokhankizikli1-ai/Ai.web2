# coding: utf-8
import sys
import os
import logging

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))

from ai_client import ask_ai, detect_intent
from ai_router import get_model_config, detect_mode
from agent import run_tools, build_context_for_ai, detect_research_depth, DEPTH_CONFIG, RESEARCH_INTENTS
from prompts import (
    CHAT_SYSTEM, CHAT_RULES,
    FINANCE_SYSTEM, FINANCE_TEMPLATE,
    DROP_SYSTEM, DROP_TEMPLATE,
    EDUCATION_SYSTEM, EDUCATION_TEMPLATE,
    ADVICE_SYSTEM, ADVICE_TEMPLATE,
    EMOTIONAL_SYSTEM, PERSONAL_SYSTEM,
    EXECUTION_SYSTEM, PRODUCTIVITY_SYSTEM,
    CREATIVE_SYSTEM, STARTUP_SYSTEM,
)
from finance import run_finance_analysis
from ecommerce import run_ecommerce_analysis

try:
    from backend.tools.registry import select_tools_for_intent, run_tool
    _TOOLS_AVAILABLE = True
except Exception:
    _TOOLS_AVAILABLE = False

logger = logging.getLogger(__name__)

_ECOM_KW = [
    "satmak", "dropshipping", "shopify", "ecommerce", "e-ticaret",
    "magaza", "urun sat", "kar marji", "supplier", "tedarik",
    "reklam ver", "facebook ads", "tiktok ads",
]
_BUYER_KW = [
    "almak istiyorum", "alayim mi", "almaliyim", "oner",
    "tavsiye et", "hangisi iyi", "hangisini alayim", "satin al",
]
_EXECUTION_KW = [
    "ne yapayim", "nereden baslayayim", "plan yap", "takildim",
    "devam edemiyorum", "para kazanmak", "nasil baslayabilirim",
]
_PRODUCTIVITY_KW = [
    "dagiliyorum", "odaklanamiyorum", "zamanimi yonetemiyorum",
    "hedefim var ama yapamiyorum", "erteliyorum", "konsantre olamiyorum",
]
_CREATIVE_KW = [
    "fikir ver", "isim bul", "hikaye yaz", "reklam metni",
    "hook yaz", "yaratici olsun", "marka ismi", "icerik fikri",
    "slogan", "kopya yaz", "tagline",
]

_SAFETY_RESPONSE = (
    "Bu konuda kesin bir yonlendirme yapamam.\n\n"
    "Bir uzmana danışmanı oneririm:\n"
    "- Saglik: doktor veya psikolog\n"
    "- Hukuk: avukat\n"
    "- Kriz: 182 (Turkiye kriz hatti)\n\n"
    "Baska bir konuda yardimci olabilir miyim?"
)

# Suggested follow-up questions per mode
_FOLLOWUPS = {
    "finance": [
        "Risk seviyesini birlikte hesaplayalim mi?",
        "Bunu scalp mi swing mi dusunuyorsun?",
        "Portfoyun ne kadar bu pozisyona girecek?",
    ],
    "ecommerce": [
        "Bunu 7 gunluk test planina cevireyim mi?",
        "Bu fikrin reklam acisini cikarayim mi?",
        "Rakip analizi yapalim mi?",
    ],
    "startup": [
        "Bu fikri ilk haftada nasil test edersin konuşalim mi?",
        "Hedef musterini birlikte tanimlayalim mi?",
        "Rakiplerden farklilasma stratejisine bakalim mi?",
    ],
    "execution": [
        "Bugun yapacagin tek seyi birlikte belirleyelim mi?",
        "Seni en cok hangi adim bloklıyor?",
    ],
    "productivity": [
        "Bugun icin 3 adimlik plan yapayim mi?",
        "Asil sorun zaman mi, netlik mi?",
    ],
    "education": [
        "Bunu pratik bir egzersizle pekistirelim mi?",
        "Bir sonraki konuya gecmemi ister misin?",
    ],
    "consumer_advice": [
        "Butceni soyersen daha net oneri yapabilirim.",
        "En cok ne icin kullanacaksin?",
    ],
}


def _has(text: str, kw_list: list) -> bool:
    t = text.lower()
    return any(k in t for k in kw_list)


def _build_system(base: str, mem_summary: str = "", style_prompt: str = "", profile: str = "") -> str:
    sys_p = base
    if profile and "No user info" not in profile and profile.strip():
        sys_p += "\n\nKullanici profili:\n" + profile
    if mem_summary and mem_summary.strip():
        sys_p += "\n\nKullanici hafizasi (dogal kullan, bahsetme):\n" + mem_summary
    if style_prompt and style_prompt.strip():
        sys_p += "\n\n" + style_prompt
    return sys_p


def _get_followups(mode: str, n: int = 2) -> list[str]:
    candidates = _FOLLOWUPS.get(mode, [])
    return candidates[:n] if candidates else []


async def process_chat(
    user_id: str,
    message: str,
    platform: str,
    profile: str,
    history: list,
    mem_summary: str,
    style_prompt: str,
) -> dict:
    text_lower = message.lower().strip()

    # Safety check
    safety_kw = ["intihar", "kendine zarar", "ilac dozu", "overdose", "nasil oldurebilirim"]
    if any(k in text_lower for k in safety_kw):
        return {
            "reply":    _SAFETY_RESPONSE,
            "intent":   "safety_sensitive",
            "model":    "none",
            "provider": "none",
            "mode":     "safety",
            "followups": [],
        }

    depth       = detect_research_depth(message)
    depth_label = DEPTH_CONFIG[depth]["label"]

    intent   = await detect_intent(message)
    category = intent.get("intent", "normal_chat")
    symbol   = intent.get("symbol")

    # Buyer vs seller guard
    if category in ("ecommerce", "ads", "product_research"):
        has_ecom  = _has(text_lower, _ECOM_KW)
        has_buyer = _has(text_lower, _BUYER_KW)
        if has_buyer and not has_ecom:
            category = "consumer_advice"

    # Whitelist
    _VALID = {
        "finance", "crypto", "stock", "ecommerce", "ads",
        "product_research", "news", "task", "memory", "portfolio",
        "normal_chat", "personal_advice", "coding", "education",
        "general_question", "consumer_advice", "emotional_support",
        "safety_sensitive",
    }
    if category not in _VALID:
        category = "normal_chat"

    model_cfg   = get_model_config(category, depth, message)
    use_gpt4    = model_cfg["use_gpt4"]
    ai_model    = model_cfg["model"]
    ai_mode     = model_cfg.get("mode", "chat")
    provider    = model_cfg.get("provider", "openai")
    temperature = model_cfg.get("temperature", 0.80)
    max_tokens  = model_cfg.get("max_tokens", 1000)

    # Follow-up detection
    _is_followup = (
        len(message.split()) <= 6 and
        any(message.lower().strip().endswith(t)
            for t in ["mi", "mi?", "mu", "mu?", "mi cevap", "cevap", "dogru mu"])
    )
    if _is_followup and category == "normal_chat":
        category = "education"
        ai_mode  = "education"

    # Tool selection (foundation - currently all disabled)
    tool_names = []
    if _TOOLS_AVAILABLE:
        try:
            tool_names = select_tools_for_intent(category, ai_mode)
        except Exception:
            tool_names = []

    # Tool execution (web search / price data)
    if category in RESEARCH_INTENTS or category == "consumer_advice":
        try:
            tool_results = await run_tools(message, intent, depth)
        except Exception:
            tool_results = {"tools_used": [], "price": None, "news": None, "macro": None, "web": None, "errors": []}
    else:
        tool_results = {"tools_used": [], "price": None, "news": None, "macro": None, "web": None, "errors": []}

    tool_context = build_context_for_ai(message, tool_results, profile)

    # AI kwargs
    ai_kwargs = {"temperature": temperature, "max_tokens": max_tokens}

    result = await _route(
        category, ai_mode, ai_model, use_gpt4,
        message, symbol, depth_label,
        tool_context, tool_results,
        history, mem_summary, style_prompt,
        profile, _is_followup, text_lower,
        ai_kwargs,
    )

    followups = _get_followups(ai_mode)

    return {
        "reply":     result,
        "intent":    category,
        "model":     ai_model,
        "provider":  provider,
        "mode":      ai_mode,
        "followups": followups,
        "tools_used": tool_names,
    }


async def _route(
    category, ai_mode, ai_model, use_gpt4,
    message, symbol, depth_label,
    tool_context, tool_results,
    history, mem_summary, style_prompt,
    profile, is_followup, text_lower,
    ai_kwargs,
):
    kw = ai_kwargs

    # Safety
    if category == "safety_sensitive" or ai_mode == "safety_sensitive":
        return _SAFETY_RESPONSE

    # Execution
    if ai_mode == "execution" or _has(text_lower, _EXECUTION_KW):
        sys_p = _build_system(EXECUTION_SYSTEM, mem_summary, style_prompt, profile)
        return await ask_ai(message, sys_p, history, model=ai_model, **kw)

    # Productivity
    if ai_mode == "productivity" or _has(text_lower, _PRODUCTIVITY_KW):
        sys_p = _build_system(PRODUCTIVITY_SYSTEM, mem_summary, style_prompt, profile)
        return await ask_ai(message, sys_p, history, model=ai_model, **kw)

    # Creative
    if ai_mode == "creative" or _has(text_lower, _CREATIVE_KW):
        sys_p = _build_system(CREATIVE_SYSTEM, mem_summary, style_prompt)
        return await ask_ai(message, sys_p, history, model=ai_model, **kw)

    # Finance / Trading
    if category in ("finance", "crypto", "stock"):
        effective_symbol = symbol if (symbol and symbol.lower() != "null") else None
        if not effective_symbol:
            sys_p = _build_system(FINANCE_SYSTEM, mem_summary, style_prompt)
            prompt = (
                "Kullanici sorusu: \"" + message + "\"\n\n" +
                tool_context + "\n\n"
                "Sembol belirtilmemis. Genel trading/piyasa yorumu yap "
                "ya da hangi varlik icin analiz yapilmasini istedigini sor."
            )
            return await ask_ai(prompt, sys_p, history, model=ai_model, **kw)
        try:
            return await run_finance_analysis(
                message, effective_symbol, depth_label, tool_context,
                mem_summary, style_prompt, use_gpt4, model=ai_model,
            )
        except Exception as e:
            logger.error("run_finance_analysis error: " + str(e))
            sys_p = _build_system(FINANCE_SYSTEM, mem_summary, style_prompt)
            return await ask_ai(message, sys_p, history, model=ai_model, **kw)

    # Ecommerce
    if category in ("ecommerce", "ads", "product_research"):
        try:
            return await run_ecommerce_analysis(
                message, tool_context, mem_summary, style_prompt, use_gpt4, model=ai_model,
            )
        except Exception as e:
            logger.error("run_ecommerce_analysis error: " + str(e))
            sys_p = _build_system(DROP_SYSTEM, mem_summary, style_prompt)
            return await ask_ai(message, sys_p, history, model=ai_model, **kw)

    # Startup
    if ai_mode == "startup":
        sys_p = _build_system(STARTUP_SYSTEM, mem_summary, style_prompt, profile)
        return await ask_ai(message, sys_p, history, model=ai_model, **kw)

    # News
    if category == "news":
        news_prompt = (
            "Kullanici sorusu: " + message + "\n\n" +
            tool_context + "\n\n" +
            "En onemli haberleri ozetle, kisa yorum ekle."
        )
        return await ask_ai(news_prompt, "Haber editorusun. Net, Turkce.", model=ai_model, **kw)

    # Consumer advice
    if category == "consumer_advice":
        has_web = bool(tool_results.get("web"))
        ctx = tool_context if has_web else "[Web verisi alinamadi.]"
        sys_p = _build_system(ADVICE_SYSTEM, mem_summary, style_prompt)
        prompt = ADVICE_TEMPLATE.format(question=message, context=ctx)
        return await ask_ai(prompt, sys_p, history, model=ai_model, **kw)

    # Education / follow-up
    if category == "education" or ai_mode == "education":
        sys_p = _build_system(EDUCATION_SYSTEM, mem_summary, style_prompt)
        if is_followup:
            recent = ""
            if history:
                recent = "\n".join(
                    ("Asistan: " if r == "assistant" else "Kullanici: ") + c
                    for r, c in history[-4:]
                )
            prompt = (
                "Son konusma:\n" + recent + "\n\n"
                "Kullanicinin yeni mesaji: " + message + "\n\n"
                "Cevap verdiyse: dogru/yanlis net soyle, kisaca neden.\n"
                "Devam yaziyorsa: konusmaya devam et."
            )
        else:
            prompt = EDUCATION_TEMPLATE.format(question=message, context=tool_context)
        return await ask_ai(prompt, sys_p, history, model=ai_model, **kw)

    # Emotional
    if ai_mode == "emotional_support" or category == "emotional_support":
        sys_p = _build_system(EMOTIONAL_SYSTEM, mem_summary)
        return await ask_ai(message, sys_p, history, model=ai_model, **kw)

    # Personal advice
    if ai_mode == "personal_advice" or category == "personal_advice":
        sys_p = _build_system(PERSONAL_SYSTEM, mem_summary, style_prompt, profile)
        return await ask_ai(message, sys_p, history, model=ai_model, **kw)

    # General / Coding
    if category in ("general_question", "coding"):
        prompt = (
            "Kullanici sorusu: " + message + "\n\n" +
            tool_context + "\n\n" +
            "Net, anlasilir Turkce cevap ver."
        )
        sys_p = _build_system(CHAT_SYSTEM, mem_summary, style_prompt)
        return await ask_ai(prompt, sys_p, history, model=ai_model, **kw)

    # Default
    sys_p = _build_system(CHAT_SYSTEM, mem_summary, style_prompt, profile)
    sys_p += CHAT_RULES
    return await ask_ai(message, sys_p, history, model=ai_model, **kw)
