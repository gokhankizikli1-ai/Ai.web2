# coding: utf-8
import os
from dotenv import load_dotenv

load_dotenv()

# --- AI Keys ---
OPENAI_API_KEY  = os.getenv("OPENAI_API_KEY", "")
GEMINI_API_KEY  = os.getenv("GEMINI_API_KEY", "")
TELEGRAM_TOKEN  = os.getenv("TELEGRAM_TOKEN", "")

# --- Platform ---
OWNER_ID        = int(os.getenv("OWNER_ID", "0"))
VELORA_API_KEY  = os.getenv("VELORA_API_KEY", "")   # optional internal API key
ENVIRONMENT     = os.getenv("ENVIRONMENT", "production")

# --- Limits ---
FREE_DAILY_LIMIT = int(os.getenv("FREE_DAILY_LIMIT", "20"))

# --- Database ---
DB_PATH = os.getenv("DB_PATH", "velora.db")

# --- CORS ---
ALLOWED_ORIGINS = os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:3000,http://localhost:5173,https://velora.ai"
).split(",")
