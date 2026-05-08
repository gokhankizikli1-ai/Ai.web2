# coding: utf-8
import logging

logger = logging.getLogger(__name__)

MODEL_FAST   = "gpt-4o-mini"
MODEL_STRONG = "gpt-4o"
PROVIDER_OPENAI = "openai"

# Intent -> (model, temperature, max_tokens, style)
_ROUTE_TABLE = {
    "casual_chat":        (MODEL_FAST,   0.85, 600,  "casual"),
    "normal_chat":        (MODEL_FAST,   0.80, 800,  "casual"),
    "emotional_support":  (MODEL_FAST,   0.90, 700,  "warm"),
    "consumer_advice":    (MODEL_FAST,   0.75, 900,  "helpful"),
    "education":          (MODEL_FAST,   0.70, 1200, "teacher"),
    "teacher":            (MODEL_FAST,   0.70, 1200, "teacher"),
    "productivity":       (MODEL_FAST,   0.75, 700,  "action"),
    "execution":          (MODEL_FAST,   0.75, 800,  "action"),
    "news":               (MODEL_FAST,   0.60, 600,  "factual"),
    "general_question":   (MODEL_FAST,   0.70, 900,  "helpful"),
    "creative":           (MODEL_FAST,   0.95, 1000, "creative"),
    "branding":           (MODEL_FAST,   0.95, 800,  "creative"),
    "coding":             (MODEL_STRONG, 0.30, 2000, "technical"),
    "finance":            (MODEL_STRONG, 0.40, 1500, "analyst"),
    "crypto":             (MODEL_STRONG, 0.40, 1500, "analyst"),
    "stock":              (MODEL_STRONG, 0.40, 1500, "analyst"),
    "trading":            (MODEL_STRONG, 0.40, 1500, "analyst"),
    "entrepreneurship":   (MODEL_STRONG, 0.65, 1500, "strategic"),
    "startup":            (MODEL_STRONG, 0.65, 1500, "strategic"),
    "dropshipping":       (MODEL_STRONG, 0.60, 1200, "strategic"),
    "ecommerce":          (MODEL_STRONG, 0.60, 1200, "strategic"),
    "ads":                (MODEL_STRONG, 0.65, 1200, "strategic"),
    "product_research":   (MODEL_STRONG, 0.60, 1200, "strategic"),
    "personal_advice":    (MODEL_STRONG, 0.70, 1000, "mentor"),
    "deep_analysis":      (MODEL_STRONG, 0.35, 2000, "analytical"),
    "safety_sensitive":   (MODEL_FAST,   0.20, 500,  "safe"),
}

_STRONG_KW = [
    "detayli", "derin", "kapsamli", "tam analiz", "profesyonel",
    "deep", "very detailed", "comprehensive",
]
_FAST_KW = ["kisa", "ozet", "hizli", "quick", "brief", "sadece sonuc"]

_EXECUTION_KW = [
    "ne yapayim", "nereden baslayayim", "plan yap", "takildim",
    "devam edemiyorum", "para kazanmak", "nasil baslayabilirim",
]
_TRADING_KW = [
    "girmeli miyim", "al sat", "long", "short", "pump", "rsi",
    "destek direnc", "breakout", "volume", "hacim", "trade",
    "coin", "kripto analiz", "hisse analiz",
]
_STARTUP_KW = [
    "startup", "girisim", "fikir validate", "mvp", "co-founder",
    "yatirimci", "pitch", "pazar arastirma",
]
_EMOTIONAL_KW = [
    "moralim bozuk", "cok kotu", "uzuldum", "yalniz", "depresyon",
    "motivasyonum yok", "bunaldim", "stres", "sikildim",
]
_PRODUCTIVITY_KW = [
    "dagiliyorum", "odaklanamiyorum", "zamanimi yonetemiyorum",
    "hedefim var ama yapamiyorum", "erteliyorum", "konsantre olamiyorum",
]
_CREATIVE_KW = [
    "fikir ver", "isim bul", "hook yaz", "reklam metni",
    "yaratici olsun", "marka ismi", "icerik fikri", "slogan",
]
_EDUCATION_KW = [
    "anlat", "ogret", "nasil calisir", "ne demek", "acikla",
    "anlayamadim", "neden", "nasil", "coz", "hesapla",
]
_SAFETY_KW = [
    "intihar", "kendine zarar", "ilac dozu", "overdose",
    "silah", "patlayici", "hack", "saldiri",
]


def _has(text: str, kw_list: list) -> bool:
    t = text.lower()
    return any(k in t for k in kw_list)


def detect_mode(intent: str, user_text: str = "") -> str:
    if _has(user_text, _SAFETY_KW):
        return "safety_sensitive"
    if _has(user_text, _EMOTIONAL_KW) or intent == "emotional_support":
        return "emotional_support"
    if _has(user_text, _EXECUTION_KW) or intent == "execution":
        return "execution"
    if _has(user_text, _PRODUCTIVITY_KW) or intent == "productivity":
        return "productivity"
    if _has(user_text, _CREATIVE_KW) or intent == "creative":
        return "creative"
    if _has(user_text, _STARTUP_KW) or intent == "startup":
        return "startup"
    if _has(user_text, _TRADING_KW) and intent in ("finance", "crypto", "stock", "normal_chat"):
        return "finance"
    if _has(user_text, _EDUCATION_KW) or intent == "education":
        return "education"
    if intent == "consumer_advice":
        return "consumer_advice"
    if intent in ("finance", "crypto", "stock"):
        return "finance"
    if intent in ("ecommerce", "ads", "product_research"):
        return "ecommerce"
    if intent == "personal_advice":
        return "personal_advice"
    if intent == "coding":
        return "coding"
    if intent in ("news", "general_question"):
        return "general"
    return "chat"


def get_model_config(intent: str, depth: str = None, user_text: str = "") -> dict:
    try:
        mode = detect_mode(intent, user_text)

        # Override: force fast model for simple messages
        if _has(user_text, _FAST_KW):
            model, temp, tokens, style = _ROUTE_TABLE.get("normal_chat", (MODEL_FAST, 0.80, 800, "casual"))
            return _make_config(model, PROVIDER_OPENAI, mode, temp, tokens, style)

        # Override: force strong for deep requests
        if depth == "high" or _has(user_text, _STRONG_KW):
            return _make_config(MODEL_STRONG, PROVIDER_OPENAI, mode, 0.40, 2000, "analytical")

        route_key = mode if mode in _ROUTE_TABLE else intent
        model, temp, tokens, style = _ROUTE_TABLE.get(route_key, (MODEL_FAST, 0.80, 800, "casual"))

        logger.info("ROUTE | intent=%s | mode=%s | model=%s | style=%s", intent, mode, model, style)
        return _make_config(model, PROVIDER_OPENAI, mode, temp, tokens, style)

    except Exception as e:
        logger.warning("get_model_config error: " + str(e))
        return _make_config(MODEL_FAST, PROVIDER_OPENAI, "chat", 0.80, 800, "casual")


def _make_config(model, provider, mode, temperature, max_tokens, style) -> dict:
    return {
        "model":       model,
        "provider":    provider,
        "use_gpt4":    model == MODEL_STRONG,
        "mode":        mode,
        "temperature": temperature,
        "max_tokens":  max_tokens,
        "style":       style,
    }
