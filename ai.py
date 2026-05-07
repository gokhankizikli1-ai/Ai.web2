import logging
import openai
import google.generativeai as genai
from config import OPENAI_API_KEY, GEMINI_API_KEY, OPENAI_FAST_MODEL, OPENAI_SMART_MODEL, GEMINI_MODEL
from memory import get_chat_history, get_user_context

logger = logging.getLogger(__name__)

genai.configure(api_key=GEMINI_API_KEY)

# ─── System Prompts ───────────────────────────────────────────────────────────
BASE_SYSTEM = """Sen Türkçe konuşan gelişmiş kişisel bir AI asistanısın.
Finans, trade, dropshipping ve günlük görevlerde uzmansın.
Doğal, anlaşılır ve samimi konuşursun. Robotik değilsin.
Gerektiğinde "knk" tarzı kullanabilirsin ama ciddi konularda profesyonelsin.
Kullanıcıyı tanıyorsun ve geçmişini cevaplarda kullanıyorsun.
Boş ve yüzeysel cevap vermezsin."""

FINANCE_SYSTEM = """Sen gelişmiş bir finansal analiz yapay zekasısın.
Verilen gerçek verilere dayanarak kapsamlı analiz yaparsın.
Uydurma veri üretmezsin — veri eksikse bunu belirtirsin.
Kesin tahmin yapmaz, senaryo bazlı düşünürsün.
Risk puanı mutlaka verirsin.
Türkçe, doğal ve anlaşılır yazarsın."""

ECOMMERCE_SYSTEM = """Sen dropshipping ve dijital pazarlama uzmanısın.
Ürün analizi, hedef kitle tespiti ve reklam stratejisi konusunda uzmansın.
Net, pratik ve uygulanabilir öneriler verirsin.
Türkçe konuşursun."""

# ─── OpenAI ───────────────────────────────────────────────────────────────────
async def ask_openai(
    prompt: str,
    system: str = "",
    history=None,
    model: str = None,
    use_smart: bool = False
) -> str:
    """OpenAI'ya istek at. Hata olursa Gemini'ye fallback yap."""
    if model is None:
        model = OPENAI_SMART_MODEL if use_smart else OPENAI_FAST_MODEL
    try:
        client = openai.AsyncOpenAI(api_key=OPENAI_API_KEY)
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        if history:
            for role, content in history:
                messages.append({"role": role, "content": content})
        messages.append({"role": "user", "content": prompt})
        response = await client.chat.completions.create(
            model=model, messages=messages, max_tokens=2500
        )
        return response.choices[0].message.content
    except Exception as e:
        logger.warning(f"OpenAI hatası ({model}), Gemini'ye geçiliyor: {e}")
        return await ask_gemini(prompt, system)

# ─── Gemini ───────────────────────────────────────────────────────────────────
async def ask_gemini(prompt: str, system: str = "") -> str:
    """Gemini'ye istek at."""
    try:
        model = genai.GenerativeModel(GEMINI_MODEL)
        full = f"{system}\n\n{prompt}" if system else prompt
        response = model.generate_content(full)
        return response.text
    except Exception as e:
        logger.error(f"Gemini hatası: {e}")
        return "AI şu an yanıt veremiyor, lütfen biraz sonra tekrar dene. 🔄"

# ─── Intent Detection ─────────────────────────────────────────────────────────
async def detect_intent_ai(message: str) -> dict:
    """GPT-4o-mini ile intent tespiti"""
    import json
    prompt = f"""Kullanıcı mesajını analiz et. Sadece JSON döndür.

Mesaj: "{message}"

{{
  "intent": "finance|crypto|stock|forex|normal_chat|personal_advice|dropshipping|ads|product_research|news|memory|task|coding|education|general_question",
  "symbol": "sembol varsa (BTC/AAPL/EUR-TRY), yoksa null",
  "asset_type": "crypto|stock|forex|null",
  "task_text": "görev metni, yoksa null",
  "memory_action": "save|forget|list|null",
  "memory_content": "kaydedilecek içerik, yoksa null",
  "is_portfolio_add": true/false,
  "portfolio_symbol": "sembol veya null",
  "portfolio_amount": sayı veya null,
  "portfolio_price": sayı veya null
}}

Örnekler:
"btc ne olur" → intent:crypto, symbol:BTC
"apple hissesi nasıl" → intent:stock, symbol:AAPL
"dolar tl ne olur" → intent:forex, symbol:USD-TRY
"bugün moralim bozuk" → intent:normal_chat
"led ışık dropshipping" → intent:dropshipping
"bunu hatırla: risk almayı sevmiyorum" → intent:memory, memory_action:save
"ne hatırlıyorsun" → intent:memory, memory_action:list
"yarın toplantım var" → intent:task
"BTC 0.5 aldım 42000den" → is_portfolio_add:true, portfolio_symbol:BTC, portfolio_amount:0.5, portfolio_price:42000
"python öğrenmek istiyorum" → intent:coding

Sadece JSON döndür, başka hiçbir şey yazma."""
    try:
        client = openai.AsyncOpenAI(api_key=OPENAI_API_KEY)
        response = await client.chat.completions.create(
            model=OPENAI_FAST_MODEL,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=300,
            response_format={"type": "json_object"}
        )
        return json.loads(response.choices[0].message.content)
    except Exception as e:
        logger.warning(f"Intent detection hatası: {e}")
        return {"intent": "general_question", "symbol": None}

# ─── Normal Chat ──────────────────────────────────────────────────────────────
async def normal_chat(message: str) -> str:
    """Kullanıcıyla doğal sohbet"""
    user_context = get_user_context()
    history = get_chat_history(8)

    system = f"""{BASE_SYSTEM}

{user_context}

Kullanıcıyla sohbet ediyorsun:
- Dert anlatırsa önce anla, sonra çözüm öner
- Fikir isterse artı/eksiyi çıkar
- Kısa ama etkili konuş
- Gerekirse soru sor
- Hedeflerinden bahsederse hafızada tut"""

    return await ask_openai(message, system, history)

# ─── Coding / Education ───────────────────────────────────────────────────────
async def coding_help(message: str) -> str:
    history = get_chat_history(6)
    system = "Sen deneyimli bir yazılımcısın. Türkçe, net ve çalışan kod + açıklama verirsin. Hataları düzeltirsin."
    return await ask_openai(message, system, history)

async def education_help(message: str) -> str:
    history = get_chat_history(6)
    system = "Sen sabırlı ve açıklayıcı bir öğretmensin. Türkçe, anlaşılır ve örneklerle anlat."
    return await ask_openai(message, system, history)
