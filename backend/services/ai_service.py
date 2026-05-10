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
    from tools.registry import select_tools_for_intent, run_tool
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
    "devam edemiyorum", "para kazanmak istiyorum", "nereye gitsem",
    "nasil baslayabilirim",
]
_PRODUCTIVITY_KW = [
    "dagiliyorum", "odaklanamiyorum", "zamanimi yonetemiyorum",
    "hedefim var ama yapamiyorum", "erteliyorum", "procrastination",
    "konsantre olamiyorum",
]
_CREATIVE_KW = [
    "fikir ver", "isim bul", "hikaye yaz", "reklam metni",
    "hook yaz", "yaratici olsun", "marka ismi", "icerik fikri",
    "slogan", "kopya yaz", "tagline",
]


def _has(text, kw_list):
    t = text.lower()
    return any(k in t for k in kw_list)


def _build_system(base, mem_summary="", style_prompt="", profile=""):
    sys_p = base
    if profile and "No user info" not in profile and profile.strip():
        sys_p += "\n\nKullanici profili:\n" + profile
    if mem_summary and mem_summary.strip():
        sys_p += "\n\nKullanici hafizasi:\n" + mem_summary
    if style_prompt and style_prompt.strip():
        sys_p += "\n\n" + style_prompt
    return sys_p


async def process_chat(
    user_id: str,
    message: str,
    platform: str,
    profile: str,
    history: list,
    mem_summary: str,
    style_prompt: str,
    mode: str = None,           # optional: explicit mode from frontend (e.g. "trading_analyst")
) -> dict:
    text_lower = message.lower().strip()

    depth       = detect_research_depth(message)
    depth_label = DEPTH_CONFIG[depth]["label"]

    # ── New mode system: if caller supplied an explicit mode, use it directly ──
    # This bypasses intent-based routing so behaviour is fully predictable.
    # Falls back to legacy routing below if mode is None or unrecognised.
    if mode:
        try:
            from backend.services.ai.mode_manager  import resolve_mode_name
            from backend.services.ai.prompt_manager import build_system_prompt
            from backend.services.ai.model_manager  import get_config as mode_get_config

            canonical = resolve_mode_name(mode)
            if canonical:
                cfg   = mode_get_config(canonical, depth_label, message)
                sys_p = build_system_prompt(canonical, mem_summary, style_prompt, profile)

                # Run tools for this mode and inject live data into system prompt
                try:
                    from backend.services.tools.tool_orchestrator import (
                        run_tools_for_mode, build_tool_context_block,
                    )
                    _tf_ctx = {}
                    for _tf in ["4h","2h","1h","30m","15m","5m","1d","4H","2H","1H","30M","15M","1D"]:
                        if _tf in message:
                            _tf_ctx["timeframe"] = _tf.lower()
                            break
                    _mode_tool_res = await run_tools_for_mode(canonical, message, _tf_ctx)
                    _tool_block    = build_tool_context_block(_mode_tool_res)
                    if _tool_block:
                        sys_p += "\n\n" + _tool_block
                        _md = _mode_tool_res.get("market_data", {})
                        logger.info(
                            "MARKET_DATA_TOOL called | symbol=%s | timeframe=%s | provider=%s",
                            (_md.get("data") or {}).get("symbol"),
                            (_md.get("data") or {}).get("timeframe"),
                            _md.get("provider"),
                        )
                    else:
                        for _tn, _tr in _mode_tool_res.items():
                            logger.info(
                                "TOOL %s | status=%s | msg=%s",
                                _tn, _tr.get("status"), _tr.get("message"),
                            )
                except Exception as _terr:
                    logger.warning("process_chat | mode tool error: %s — continuing without tools", _terr)

                reply = await ask_ai(
                    message, sys_p, history,
                    model=cfg["model"],
                    temperature=cfg["temperature"],
                    max_tokens=cfg["max_tokens"],
                )
                logger.info(
                    "process_chat | mode_system | mode=%s | model=%s", canonical, cfg["model"]
                )
                return {
                    "reply":    reply,
                    "intent":   canonical,
                    "model":    cfg["model"],
                    "provider": cfg["provider"],
                    "mode":     canonical,
                }
        except Exception as _mode_err:
            # Mode system failed — log and fall through to existing routing.
            logger.warning("process_chat | mode_system error (%s) — falling back", _mode_err)
    # ── End new mode system ──────────────────────────────────────────

    intent   = await detect_intent(message)
    category = intent.get("intent", "normal_chat")
    symbol   = intent.get("symbol")

    # Buyer vs seller guard
    if category in ("ecommerce", "ads", "product_research"):
        has_ecom  = _has(text_lower, _ECOM_KW)
        has_buyer = _has(text_lower, _BUYER_KW)
        if has_buyer and not has_ecom:
            category = "consumer_advice"

    # Whitelist guard
    _VALID = {
        "finance", "crypto", "stock", "ecommerce", "ads",
        "product_research", "news", "task", "memory", "portfolio",
        "normal_chat", "personal_advice", "coding", "education",
        "general_question", "consumer_advice", "emotional_support",
        "safety_sensitive",
    }
    if category not in _VALID:
        category = "normal_chat"

    model_cfg = get_model_config(category, depth, message)
    use_gpt4  = model_cfg["use_gpt4"]
    ai_model  = model_cfg["model"]
    ai_mode   = model_cfg.get("mode", "chat")
    provider  = model_cfg.get("provider", "openai")

    # ── Auto-route: finance/crypto/stock → trading_analyst + market_data_tool ──
    # Intercepts before legacy run_finance_analysis / data_sources path fires.
    if category in ("finance", "crypto", "stock"):
        try:
            from backend.services.ai.mode_manager   import resolve_mode_name
            from backend.services.ai.prompt_manager import build_system_prompt
            from backend.services.ai.model_manager  import get_config as mode_get_config
            from backend.services.tools.tool_orchestrator import (
                run_tools_for_mode, build_tool_context_block,
            )

            _ta_cfg   = mode_get_config("trading_analyst", depth_label, message)
            _ta_sys_p = build_system_prompt("trading_analyst", mem_summary, style_prompt, profile)

            # Symbol from intent, timeframe from message text
            _ta_ctx = {}
            if symbol and symbol.lower() not in ("null", "none", ""):
                _ta_ctx["symbol"] = symbol
            for _tf in ["4h","2h","1h","30m","15m","5m","1d","4H","2H","1H","30M","15M","1D"]:
                if _tf in message:
                    _ta_ctx["timeframe"] = _tf.lower()
                    break

            _ta_tool_res = await run_tools_for_mode("trading_analyst", message, _ta_ctx)
            _ta_block    = build_tool_context_block(_ta_tool_res)
            if _ta_block:
                _ta_sys_p += "\n\n" + _ta_block
                _md = _ta_tool_res.get("market_data", {})
                logger.info(
                    "MARKET_DATA_TOOL called | symbol=%s | timeframe=%s | provider=%s",
                    (_md.get("data") or {}).get("symbol"),
                    (_md.get("data") or {}).get("timeframe"),
                    _md.get("provider"),
                )
            else:
                for _tn, _tr in _ta_tool_res.items():
                    logger.info(
                        "TOOL %s | status=%s | msg=%s",
                        _tn, _tr.get("status"), _tr.get("message"),
                    )

            _ta_reply = await ask_ai(
                message, _ta_sys_p, history,
                model=_ta_cfg["model"],
                temperature=_ta_cfg["temperature"],
                max_tokens=_ta_cfg["max_tokens"],
            )
            logger.info(
                "process_chat | route=trading_analyst | symbol=%s | model=%s",
                symbol, _ta_cfg["model"],
            )
            return {
                "reply":    _ta_reply,
                "intent":   "trading_analyst",
                "model":    _ta_cfg["model"],
                "provider": _ta_cfg["provider"],
                "mode":     "trading_analyst",
            }
        except Exception as _ta_err:
            logger.warning(
                "process_chat | trading_analyst route failed (%s) — legacy fallback", _ta_err
            )
    # ── End auto-route ──────────────────────────────────────────────

    # Follow-up detection
    _is_followup = (
        len(message.split()) <= 6 and
        any(message.lower().strip().endswith(t)
            for t in ["mi", "mi?", "mu", "mu?", "mi cevap", "cevap", "dogru mu"])
    )
    if _is_followup and category == "normal_chat":
        category = "education"
        ai_mode  = "education"

    # Tool execution
    if category in RESEARCH_INTENTS or category == "consumer_advice":
        tool_results = await run_tools(message, intent, depth)
    else:
        tool_results = {"tools_used": [], "price": None, "news": None, "macro": None, "web": None, "errors": []}

    tool_context = build_context_for_ai(message, tool_results, profile)

    result = await _route(
        category, ai_mode, ai_model, use_gpt4,
        message, symbol, depth_label,
        tool_context, tool_results,
        history, mem_summary, style_prompt,
        profile, _is_followup, text_lower,
    )

    followups = []
    return {
        "reply":    result,
        "intent":   category,
        "model":    ai_model,
        "provider": provider,
        "mode":     ai_mode,
    }


async def _route(
    category, ai_mode, ai_model, use_gpt4,
    message, symbol, depth_label,
    tool_context, tool_results,
    history, mem_summary, style_prompt,
    profile, is_followup, text_lower,
):
    # --- Execution mode ---
    if ai_mode == "execution" or _has(text_lower, _EXECUTION_KW):
        sys_p = _build_system(EXECUTION_SYSTEM, mem_summary, style_prompt, profile)
        return await ask_ai(message, sys_p, history, model=ai_model)

    # --- Productivity mode ---
    if ai_mode == "productivity" or _has(text_lower, _PRODUCTIVITY_KW):
        sys_p = _build_system(PRODUCTIVITY_SYSTEM, mem_summary, style_prompt, profile)
        return await ask_ai(message, sys_p, history, model=ai_model)

    # --- Creative mode ---
    if ai_mode == "creative" or _has(text_lower, _CREATIVE_KW):
        sys_p = _build_system(CREATIVE_SYSTEM, mem_summary, style_prompt)
        return await ask_ai(message, sys_p, history, model=ai_model)

    # --- Finance / Trading ---
    if category in ("finance", "crypto", "stock"):
        # Fix: never write "null ANALIZI"
        effective_symbol = symbol if (symbol and symbol.lower() != "null") else None
        if not effective_symbol:
            # Ask clarification or do general analysis
            sys_p = _build_system(FINANCE_SYSTEM, mem_summary, style_prompt)
            prompt = (
                "Kullanici sorusu: \"" + message + "\"\n\n"
                + tool_context + "\n\n"
                "Sembol belirtilmemis. Genel bir piyasa/trading yorumu yap "
                "ya da hangi varlik icin analiz yapilmasini istedigini sor."
            )
            return await ask_ai(prompt, sys_p, history, model=ai_model)
        return await run_finance_analysis(
            message, effective_symbol, depth_label, tool_context,
            mem_summary, style_prompt, use_gpt4, model=ai_model,
        )

    # --- Ecommerce / Dropshipping ---
    if category in ("ecommerce", "ads", "product_research"):
        try:
            return await run_ecommerce_analysis(
                message, tool_context, mem_summary, style_prompt, use_gpt4, model=ai_model,
            )
        except Exception as e:
            logger.error("run_ecommerce_analysis error: %s", e)
            sys_p = _build_system(DROP_SYSTEM, mem_summary, style_prompt)
            return await ask_ai(message, sys_p, history, model=ai_model)

    # --- Startup mode ---
    if ai_mode == "startup":
        sys_p = _build_system(STARTUP_SYSTEM, mem_summary, style_prompt, profile)
        return await ask_ai(message, sys_p, history, model=ai_model)

    # --- News ---
    if category == "news":
        news_prompt = (
            "Kullanici sorusu: " + message + "\n\n" +
            tool_context + "\n\n" +
            "En onemli haberleri ozetle, kisa yorum ekle."
        )
        return await ask_ai(news_prompt, "Haber editorusun. Net, Turkce.", history, model=ai_model)

    # --- Consumer advice ---
    if category == "consumer_advice":
        has_web = bool(tool_results.get("web"))
        ctx = tool_context if has_web else "[Web verisi alinamadi. Guncel fiyat icin kullaniciya Trendyol/Amazon kontrol etmesini oner.]"
        sys_p = _build_system(ADVICE_SYSTEM, mem_summary, style_prompt)
        prompt = ADVICE_TEMPLATE.format(question=message, context=ctx)
        return await ask_ai(prompt, sys_p, history, model=ai_model)

    # --- Education / follow-up ---
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
        return await ask_ai(prompt, sys_p, history, model=ai_model)

    # --- Emotional support ---
    if ai_mode == "emotional_support" or category == "emotional_support":
        sys_p = _build_system(EMOTIONAL_SYSTEM, mem_summary)
        return await ask_ai(message, sys_p, history, model=ai_model)

    # --- Personal advice ---
    if ai_mode == "personal_advice" or category == "personal_advice":
        sys_p = _build_system(PERSONAL_SYSTEM, mem_summary, style_prompt, profile)
        return await ask_ai(message, sys_p, history, model=ai_model)

    # --- General / Coding ---
    if category in ("general_question", "coding"):
        prompt = (
            "Kullanici sorusu: " + message + "\n\n" +
            tool_context + "\n\n" +
            "Net, anlasilir Turkce cevap ver."
        )
        sys_p = _build_system(CHAT_SYSTEM, mem_summary, style_prompt)
        return await ask_ai(prompt, sys_p, history, model=ai_model)

    # --- Default chat ---
    sys_p = _build_system(CHAT_SYSTEM, mem_summary, style_prompt, profile)
    sys_p += CHAT_RULES
    return await ask_ai(message, sys_p, history, model=ai_model)
