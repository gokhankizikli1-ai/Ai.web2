# coding: utf-8
import sys
import os
import logging

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

import os
ENVIRONMENT = os.getenv("ENVIRONMENT", "production")
from core.logging import setup_logger
from routes import health, chat, memory, profile, stats, auth
from db import init_db
from memory import init_memory_db
from usage_limits import init_usage_db

app = FastAPI(
    title="Velora AI API",
    description="Velora AI Platform - Intelligent assistant backend",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# Explicit origins + regex for wildcard subdomains
EXPLICIT_ORIGINS = [
    "https://ai-web2-roan.vercel.app",
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:8000",
]

# allow_origin_regex handles *.vercel.app and *.railway.app
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
    setup_logger()
    init_db()
    init_memory_db()
    init_usage_db()
    logging.getLogger("velora").info(
        "Velora AI API started | env=%s", ENVIRONMENT,
    )


@app.exception_handler(Exception)
async def global_error_handler(request: Request, exc: Exception):
    logging.getLogger("velora.error").error("Unhandled error: %s", str(exc), exc_info=True)
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
