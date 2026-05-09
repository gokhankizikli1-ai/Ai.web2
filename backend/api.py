# coding: utf-8
import sys
import os
import logging

# Make backend/ itself importable (routes/, core/, etc.)
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.insert(0, CURRENT_DIR)

# Make project root importable (db.py, memory.py, usage_limits.py, etc.)
ROOT_DIR = os.path.dirname(CURRENT_DIR)
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

ENVIRONMENT = os.getenv("ENVIRONMENT", "production")

# --- Safe imports with fallbacks ---

try:
    from core.logging import setup_logger
except Exception:
    def setup_logger():
        logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

try:
    from db import init_db
except Exception:
    def init_db():
        pass

try:
    from memory import init_memory_db
except Exception:
    def init_memory_db():
        pass

try:
    from usage_limits import init_usage_db
except Exception:
    def init_usage_db():
        pass

try:
    from routes import health, chat, memory, profile, stats, auth
except Exception as e:
    raise RuntimeError("Route import failed: " + str(e))

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# --- App ---

app = FastAPI(
    title="Velora AI API",
    description="Velora AI Platform - Intelligent assistant backend",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# --- CORS ---

EXPLICIT_ORIGINS = [
    "https://ai-web2-roan.vercel.app",
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:8000",
]

ORIGIN_REGEX = r"https://.*\.(vercel\.app|railway\.app)$"

app.add_middleware(
    CORSMiddleware,
    allow_origins=EXPLICIT_ORIGINS,
    allow_origin_regex=ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allow_headers=["*"],
    expose_headers=["*"],
    max_age=600,
)

# --- Startup ---

@app.on_event("startup")
async def startup():
    try:
        setup_logger()
    except Exception:
        pass
    try:
        init_db()
    except Exception:
        pass
    try:
        init_memory_db()
    except Exception:
        pass
    try:
        init_usage_db()
    except Exception:
        pass
    logging.getLogger("velora").info("Velora AI API started | env=%s", ENVIRONMENT)

# --- Global error handler ---

@app.exception_handler(Exception)
async def global_error_handler(request: Request, exc: Exception):
    logging.getLogger("velora.error").error("Unhandled error: %s", str(exc), exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"error": "internal_error", "message": "Beklenmedik bir hata olustu."},
    )

# --- Routes ---

app.include_router(health.router)
app.include_router(chat.router)
app.include_router(memory.router)
app.include_router(profile.router)
app.include_router(stats.router)
app.include_router(auth.router)
