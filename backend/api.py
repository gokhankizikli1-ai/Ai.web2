# coding: utf-8
import sys
import os
import logging

# Add project root to path (db.py, memory.py, usage_limits.py, etc.)
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

# Add backend/ dir to path (routes/, core/, services/)
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

ENVIRONMENT = os.getenv("ENVIRONMENT", "production")

# Safe logger setup
try:
    from core.logging import setup_logger
except Exception:
    def setup_logger():
        logging.basicConfig(
            level=logging.INFO,
            format="%(asctime)s [%(levelname)s] %(message)s",
        )

# Safe DB inits
try:
    from db import init_db
except Exception:
    def init_db(): pass

try:
    from memory import init_memory_db
except Exception:
    def init_memory_db(): pass

try:
    from usage_limits import init_usage_db
except Exception:
    def init_usage_db(): pass

# Routes - must succeed or raise clearly
from backend.routes import health, chat, memory, profile, stats, auth

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

app = FastAPI(
    title="Velora AI API",
    description="Velora AI Platform",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

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


@app.exception_handler(Exception)
async def global_error_handler(request: Request, exc: Exception):
    logging.getLogger("velora.error").error("Unhandled: %s", str(exc), exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"error": "internal_error", "message": "Beklenmedik bir hata olustu."},
    )


app.include_router(health.router)
app.include_router(chat.router)
app.include_router(memory.router)
app.include_router(profile.router)
app.include_router(stats.router)
app.include_router(auth.router)
