import os
from dotenv import load_dotenv

load_dotenv()

# ─── Telegram & AI Keys ───────────────────────────────────────────────────────
TELEGRAM_TOKEN = os.getenv("TELEGRAM_TOKEN", "")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
OWNER_ID       = int(os.getenv("OWNER_ID", "0"))

# ─── Model Ayarları ───────────────────────────────────────────────────────────
OPENAI_FAST_MODEL  = "gpt-4o-mini"
OPENAI_SMART_MODEL = "gpt-4o"
GEMINI_MODEL       = "gemini-2.0-flash-exp"

# ─── Research Depth Limitleri ─────────────────────────────────────────────────
DEPTH_CONFIG = {
    "low":    {"web": 4,  "news": 4,  "extra": 3,  "label": "📎 Hızlı (3-5 kaynak)"},
    "medium": {"web": 10, "news": 8,  "extra": 5,  "label": "🔍 Standart (8-12 kaynak)"},
    "high":   {"web": 20, "news": 15, "extra": 10, "label": "🔬 Derin Araştırma (15-25 kaynak)"},
}

# ─── Portföy Alarm Eşikleri ───────────────────────────────────────────────────
PORTFOLIO_DROP_ALERT   = -5.0   # % düşünce alarm ver
PORTFOLIO_RISE_ALERT   = 8.0    # % yükselince alarm ver

# ─── Cache TTL (saniye) ───────────────────────────────────────────────────────
CACHE_TTL_PRICE = 300    # 5 dakika
CACHE_TTL_NEWS  = 1800   # 30 dakika

# ─── Bilinen Kripto Listesi ───────────────────────────────────────────────────
CRYPTO_SYMBOLS = {
    "BTC","ETH","BNB","SOL","XRP","ADA","DOGE","DOT","AVAX","MATIC",
    "LINK","LTC","SHIB","TRX","TON","UNI","ATOM","NEAR","OP","ARB",
    "PEPE","WIF","SUI","INJ","SEI","APT","FTM","SAND","MANA","AXS",
}

COIN_ID_MAP = {
    "BTC":"bitcoin","ETH":"ethereum","BNB":"binancecoin","SOL":"solana",
    "XRP":"ripple","ADA":"cardano","DOGE":"dogecoin","DOT":"polkadot",
    "AVAX":"avalanche-2","MATIC":"matic-network","LINK":"chainlink",
    "LTC":"litecoin","SHIB":"shiba-inu","TRX":"tron","TON":"the-open-network",
    "UNI":"uniswap","ATOM":"cosmos","NEAR":"near","OP":"optimism",
    "ARB":"arbitrum","PEPE":"pepe","WIF":"dogwifcoin","SUI":"sui",
    "INJ":"injective-protocol","APT":"aptos",
}
