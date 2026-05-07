# coding: utf-8
import logging

logger = logging.getLogger(__name__)

MODEL_FAST   = "gpt-4o-mini"
MODEL_STRONG = "gpt-4o"

PROVIDER_OPENAI = "openai"

STRONG_INTENTS = {"finance", "crypto", "stock"}
MEDIUM_INTENTS = {"ecommerce", "ads", "product_research", "coding", "personal_advice"}
FAST_INTENTS   = {
    "normal_chat", "task", "memory", "portfolio",
    "education", "news", "general_question",
    "consumer_advice", "emotional_support",
}

STRONG_KEYWORDS = [
    "detayli", "derin", "iyice arastir", "kapsamli",
    "deep", "very detailed", "comprehensive", "full analysis",
    "tam analiz", "profesyonel",
]
FAST_KEYWORDS = [
    "kisa", "ozet", "hizli", "quick", "brief", "sadece sonuc",
]

_EMOTIONAL_KW = [
    "moralim bozuk", "cok kotu", "uzuldum", "agladim", "yalniz",
    "depresyon", "motivasyonum yok", "bunaldim", "kafam durdu",
    "stres", "sikildim", "ne yapacagimi bilmiyorum",
]
_PERSONAL_KW = [
    "ne yapmaliyim", "karar veremiyorum", "tavsiye ver",
    "ne dusunuyorsun", "senin yerinde", "dogru mu",
]
_EDUCATION_KW = [
    "anlat", "ogret", "ogretmen gibi", "nasil calisir", "ne demek",
    "acikla", "anlayamadim", "ogrenemiyorum", "detayli anlat",
]


def _has(text, kw_list):
    t = text.lower()
    return any(k in t for k in kw_list)


def detect_mode(intent, user_text=""):
    if intent == "emotional_support" or _has(user_text, _EMOTIONAL_KW):
        return "emotional_support"
    if intent == "personal_advice" or _has(user_text, _PERSONAL_KW):
        return "personal_advice"
    if intent == "education" or _has(user_text, _EDUCATION_KW):
        return "education"
    if intent == "consumer_advice":
        return "consumer_advice"
    if intent in ("finance", "crypto", "stock"):
        return "finance"
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
        model  = choose_ai_model(intent, depth, user_text)
        mode   = detect_mode(intent, user_text)
        return {
            "model":    model,
            "provider": PROVIDER_OPENAI,
            "use_gpt4": model == MODEL_STRONG,
            "mode":     mode,
        }
    except Exception as e:
        logger.warning("get_model_config error: " + str(e))
        return {"model": MODEL_FAST, "provider": PROVIDER_OPENAI, "use_gpt4": False, "mode": "chat"}
