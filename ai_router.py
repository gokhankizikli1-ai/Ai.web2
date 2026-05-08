# coding: utf-8
import logging

logger = logging.getLogger(__name__)

MODEL_FAST   = "gpt-4o-mini"
MODEL_STRONG = "gpt-4o"
PROVIDER_OPENAI = "openai"

STRONG_INTENTS = {"finance", "crypto", "stock"}
MEDIUM_INTENTS = {"ecommerce", "ads", "product_research", "coding", "personal_advice", "startup"}
FAST_INTENTS   = {
    "normal_chat", "task", "memory", "portfolio",
    "education", "news", "general_question",
    "consumer_advice", "emotional_support",
    "execution", "productivity", "creative",
}

_STRONG_KW = [
    "detayli", "derin", "kapsamli", "tam analiz", "profesyonel",
    "deep", "very detailed", "comprehensive",
]
_FAST_KW = ["kisa", "ozet", "hizli", "quick", "brief", "sadece sonuc"]

_EXECUTION_KW = [
    "ne yapayim", "nereden baslayayim", "plan yap", "takildim",
    "devam edemiyorum", "para kazanmak istiyorum", "nereye gitsem",
    "yol haritasi", "nasil baslayabilirim",
]
_TRADING_KW = [
    "girmeli miyim", "al sat", "long", "short", "pump", "rsi",
    "destek direnc", "breakout", "volume", "hacim", "trade", "trading",
    "coin", "kripto analiz", "hisse analiz",
]
_STARTUP_KW = [
    "startup", "girisim", "fikir validate", "idea", "business model",
    "mvp", "co-founder", "yatirimci", "pitch", "pazar arastirma",
]
_EMOTIONAL_KW = [
    "moralim bozuk", "cok kotu", "uzuldum", "yalniz", "depresyon",
    "motivasyonum yok", "bunaldim", "stres", "sikildim",
]
_PRODUCTIVITY_KW = [
    "dagiliyorum", "odaklanamiyorum", "zamanimi yonetemiyorum",
    "hedefim var ama yapamiyorum", "erteliyorum", "konsantre olamiyorum",
]
_PRODUCTIVITY_KW = [
    "dagiliyorum", "odaklanamiyorum", "motivasyonum yok",
    "zamanimi yonetemiyorum", "hedefim var ama yapamiyorum",
    "procrastination", "erteliyorum", "konsantre olamiyorum",
]
_PERSONAL_KW = [
    "ne yapmaliyim", "karar veremiyorum", "tavsiye ver",
    "ne dusunuyorsun", "senin yerinde", "dogru mu",
]
_EDUCATION_KW = [
    "anlat", "ogret", "ogretmen gibi", "nasil calisir", "ne demek",
    "acikla", "anlayamadim", "ogrenemiyorum", "detayli anlat",
    "neden", "nasil", "coz", "hesapla",
]
_CREATIVE_KW = [
    "fikir ver", "isim bul", "hikaye yaz", "reklam metni",
    "hook yaz", "yaratici olsun", "marka ismi", "icerik fikri",
    "slogan", "kopya yaz", "tagline",
]


def _has(text: str, kw_list: list) -> bool:
    t = text.lower()
    return any(k in t for k in kw_list)


def detect_mode(intent, user_text=""):
    # Execution first - high priority
    if intent == "execution" or _has(user_text, _EXECUTION_KW):
        return "execution"
    # Trading keywords override generic finance sometimes
    if _has(user_text, _TRADING_KW) and intent in ("finance", "crypto", "stock", "normal_chat"):
        return "finance"
    # Startup
    if intent == "startup" or _has(user_text, _STARTUP_KW):
        return "startup"
    # Productivity
    if intent == "productivity" or _has(user_text, _PRODUCTIVITY_KW):
        return "productivity"
    # Creative
    if intent == "creative" or _has(user_text, _CREATIVE_KW):
        return "creative"
    # Emotional
    if intent == "emotional_support" or _has(user_text, _EMOTIONAL_KW):
        return "emotional_support"
    # Personal advice
    if intent == "personal_advice" or _has(user_text, _PERSONAL_KW):
        return "personal_advice"
    # Education
    if intent == "education" or _has(user_text, _EDUCATION_KW):
        return "education"
    # Consumer advice
    if intent == "consumer_advice":
        return "consumer_advice"
    # Finance modes
    if intent in ("finance", "crypto", "stock"):
        return "finance"
    # Ecommerce
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

def get_model_config(intent, depth=None, user_text=""):
    try:
        model = choose_ai_model(intent, depth, user_text)
        mode  = detect_mode(intent, user_text)
        return {
            "model":    model,
            "provider": PROVIDER_OPENAI,
            "use_gpt4": model == MODEL_STRONG,
            "mode":     mode,
        }
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
