# coding: utf-8
import sys
import os
import logging

# Make existing intelligence layer importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.core.config import ALLOWED_ORIGINS, ENVIRONMENT
from backend.core.logging import setup_logger
from backend.routes import health, chat, memory, profile, stats, auth
from db import init_db
from memory import init_memory_db
from usage_limits import init_usage_db

# ─── App ──────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Velora AI API",
    description="Velora AI Platform - Intelligent assistant backend",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# ─── CORS ─────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Startup ──────────────────────────────────────────────────────────────────
@app.on_event("startup")
async def startup():
    setup_logger()
    init_db()
    init_memory_db()
    init_usage_db()
    logging.getLogger("velora").info(
        "Velora AI API started | env=%s | origins=%s",
        ENVIRONMENT, ALLOWED_ORIGINS,
    )

# ─── Global error handler ─────────────────────────────────────────────────────
@app.exception_handler(Exception)
async def global_error_handler(request: Request, exc: Exception):
    logging.getLogger("velora.error").error("Unhandled error: %s", str(exc), exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"error": "internal_error", "message": "Beklenmedik bir hata olustu."},
    )

# ─── Routes ───────────────────────────────────────────────────────────────────
app.include_router(health.router)
app.include_router(chat.router)
app.include_router(memory.router)
app.include_router(profile.router)
app.include_router(stats.router)
app.include_router(auth.router)
