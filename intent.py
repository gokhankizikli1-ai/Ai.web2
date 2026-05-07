import logging
from ai import detect_intent_ai
from config import DEPTH_CONFIG

logger = logging.getLogger(__name__)

# ─── Araştırma Derinliği ──────────────────────────────────────────────────────
HIGH_DEPTH_KEYWORDS = [
    "detaylı araştır", "derin analiz", "iyice bak", "kapsamlı analiz",
    "ayrıntılı", "tam analiz", "her şeyi araştır", "derinlemesine",
    "detaylı bak", "çok araştır", "eksiksiz analiz", "profesyonel analiz",
    "deep dive", "full analiz", "uzun analiz", "çok detaylı",
]

MEDIUM_DEPTH_KEYWORDS = [
    "analiz et", "incele", "araştır", "ne olur", "nasıl görünüyor",
    "hakkında bilgi", "değerlendir", "yorumla", "alınır mı", "satılır mı",
]

def detect_research_depth(message: str) -> str:
    """Kullanıcı mesajından araştırma derinliğini tespit et"""
    msg_lower = message.lower()
    for kw in HIGH_DEPTH_KEYWORDS:
        if kw in msg_lower:
            return "high"
    for kw in MEDIUM_DEPTH_KEYWORDS:
        if kw in msg_lower:
            return "medium"
    return "low"

def get_depth_label(depth: str) -> str:
    return DEPTH_CONFIG.get(depth, DEPTH_CONFIG["medium"])["label"]

# ─── Kural Tabanlı Hızlı Intent ───────────────────────────────────────────────
CRYPTO_KEYWORDS = ["btc","eth","sol","bnb","xrp","ada","doge","avax","matic","ton","pepe","kripto","coin","token","bitcoin","ethereum","solana"]
STOCK_KEYWORDS  = ["hisse","borsa","bist","nasdaq","sp500","dow","aapl","nvda","tsla","msft","amzn","googl","meta","thyao","garan","akbnk"]
FOREX_KEYWORDS  = ["dolar","euro","döviz","tl","usd","eur","gbp","jpy","parity","parite","forex"]
DROP_KEYWORDS   = ["dropshipping","dropship","ürün sat","aliexpress","shopify","e-ticaret","eticaret","winning product"]
ADS_KEYWORDS    = ["reklam","facebook ads","instagram ads","tiktok ads","meta ads","hook","kampanya","hedef kitle"]
NEWS_KEYWORDS   = ["haberler","haber","ne var","gündem","son dakika","bugün ne oldu","piyasada ne var"]
MEMORY_KEYWORDS = ["hatırla","hatırlıyor musun","ne biliyorsun benim hakkımda","ne hatırlıyorsun","unut","sil hafızandan","profil","beni tanı"]
TASK_KEYWORDS   = ["hatırlat","görev ekle","not al","yapılacak","todo","yarın","bugün yapacak","ajanda"]
PORTFOLIO_KEYWORDS = ["portföy","portföyüm","kazandım mı","kar etmiş miyim","ne kadar kazandım","yatırımlarım"]
CODING_KEYWORDS = ["python","javascript","kod yaz","bug","hata düzelt","script","program","yazılım","geliştir"]
EDU_KEYWORDS    = ["öğren","nasıl çalışır","ne demek","anlat","açıkla","ders","ödev","konu","tanımı ne"]
PERSONAL_KEYWORDS = ["kafam karışık","ne yapmalıyım","moralim bozuk","sıkıldım","ne önerirsin","fikrin nedir","plan yap"]

def quick_intent(message: str) -> dict | None:
    """Hızlı kural tabanlı intent tespiti — AI çağrısından önce dene"""
    msg = message.lower()

    # Portföy ekleme tespiti
    import re
    portfolio_match = re.search(
        r'(\b[A-Za-z]{2,6}\b)\s+(\d+[\.,]?\d*)\s+(aldım|satın aldım|buy|aldı|aldık)',
        message, re.IGNORECASE
    )
    price_match = re.search(r'(\d+[\.,]?\d+)\s*(den|dan|usd|\$|dolar)', message, re.IGNORECASE)
    if portfolio_match and price_match:
        sym    = portfolio_match.group(1).upper()
        amount = float(portfolio_match.group(2).replace(",", "."))
        price  = float(price_match.group(1).replace(",", "."))
        return {
            "intent": "crypto",
            "is_portfolio_add": True,
            "portfolio_symbol": sym,
            "portfolio_amount": amount,
            "portfolio_price": price,
        }

    # Portföy görüntüleme
    if any(kw in msg for kw in PORTFOLIO_KEYWORDS):
        return {"intent": "portfolio"}

    # Hafıza
    if any(kw in msg for kw in MEMORY_KEYWORDS):
        if "unut" in msg or "sil" in msg:
            return {"intent": "memory", "memory_action": "forget"}
        if "hatırlıyor musun" in msg or "ne hatırlıyorsun" in msg or "ne biliyorsun" in msg:
            return {"intent": "memory", "memory_action": "list"}
        if "hatırla" in msg:
            return {"intent": "memory", "memory_action": "save", "memory_content": message}
        return {"intent": "memory", "memory_action": "list"}

    # Haberler
    if any(kw in msg for kw in NEWS_KEYWORDS):
        return {"intent": "news"}

    # Görev
    if any(kw in msg for kw in TASK_KEYWORDS):
        return {"intent": "task", "task_text": message}

    # Kişisel tavsiye
    if any(kw in msg for kw in PERSONAL_KEYWORDS):
        return {"intent": "personal_advice"}

    # Reklam
    if any(kw in msg for kw in ADS_KEYWORDS):
        return {"intent": "ads"}

    # Dropshipping
    if any(kw in msg for kw in DROP_KEYWORDS):
        return {"intent": "dropshipping"}

    # Coding
    if any(kw in msg for kw in CODING_KEYWORDS):
        return {"intent": "coding"}

    # Eğitim
    if any(kw in msg for kw in EDU_KEYWORDS):
        return {"intent": "education"}

    # Kripto
    for kw in CRYPTO_KEYWORDS:
        if kw in msg:
            # Sembol bul
            words = message.upper().split()
            for w in words:
                clean = w.strip("?!.,")
                if len(clean) >= 2 and clean.isalpha():
                    return {"intent": "crypto", "symbol": clean, "asset_type": "crypto"}
            return {"intent": "crypto", "symbol": kw.upper(), "asset_type": "crypto"}

    # Hisse
    for kw in STOCK_KEYWORDS:
        if kw in msg:
            words = message.upper().split()
            for w in words:
                clean = w.strip("?!.,")
                if len(clean) >= 2 and clean.isalpha():
                    return {"intent": "stock", "symbol": clean, "asset_type": "stock"}
            return {"intent": "stock", "symbol": kw.upper(), "asset_type": "stock"}

    # Forex
    for kw in FOREX_KEYWORDS:
        if kw in msg:
            return {"intent": "forex", "symbol": "USD-TRY", "asset_type": "forex"}

    return None  # Hızlı tespit yapılamadı, AI'ye gönder

# ─── Ana Intent Fonksiyonu ────────────────────────────────────────────────────
async def detect_intent(message: str) -> dict:
    """Önce kural tabanlı dene, olmadı AI'ye sor"""
    quick = quick_intent(message)
    if quick:
        return quick
    return await detect_intent_ai(message)
