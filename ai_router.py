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

STRONG_KEYWORDS = [
    "detayli", "derin", "iyice arastir", "kapsamli",
    "deep", "very detailed", "comprehensive", "full analysis",
    "tam analiz", "profesyonel",
]
FAST_KEYWORDS = [
    "kisa", "ozet", "hizli", "quick", "brief", "sadece sonuc",
]

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
    "moralim bozuk", "cok kotu", "uzuldum", "agladim", "yalniz",
    "depresyon", "motivasyonum yok", "bunaldim", "kafam durdu",
    "stres", "sikildim", "ne yapacagimi bilmiyorum",
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


def _has(text, kw_list):
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
    if intent == "coding":
        return "coding"
    if intent in ("news", "general_question"):
        return "general"
    return "chat"


def should_use_strong_model(intent, depth=None, user_text=""):
    if depth == "high":
        return True
    if intent in STRONG_INTENTS and depth in ("medium", "high"):
        return True
    if intent in MEDIUM_INTENTS:
        return True
    if _has(user_text, STRONG_KEYWORDS):
        return True
    return False


def choose_ai_model(intent, depth=None, user_text=""):
    try:
        if _has(user_text, FAST_KEYWORDS):
            return MODEL_FAST
        if should_use_strong_model(intent, depth, user_text):
            return MODEL_STRONG
        return MODEL_FAST
    except Exception as e:
        logger.warning("ai_router error: " + str(e))
        return MODEL_FAST


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
        return {"model": MODEL_FAST, "provider": PROVIDER_OPENAI, "use_gpt4": False, "mode": "chat"}
