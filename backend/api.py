# coding: utf-8
import sys
import os
import logging

# Ensure project root and backend/ are on sys.path for Railway
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR    = os.path.dirname(BACKEND_DIR)
for _dir in [ROOT_DIR, BACKEND_DIR]:
    if _dir not in sys.path:
        sys.path.insert(0, _dir)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("korvix")

ENVIRONMENT = os.getenv("ENVIRONMENT", "production")

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.routes.chat import router as chat_router

FALLBACK_RESPONSE = {
    "response":  "Su anda bir sorun olustu. Lutfen tekrar deneyin.",
    "followups": [],
    "mode":      "fallback",
    "provider":  "system",
}

app = FastAPI(
    title="KorvixAI API",
    description="KorvixAI Backend",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

ALLOWED_ORIGINS = [
    "https://korvixai.com",
    "https://www.korvixai.com",
    "https://ai-web2-roan.vercel.app",
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:8000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=r"https://.*\.(vercel\.app|railway\.app)$",
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allow_headers=["*"],
    expose_headers=["*"],
    max_age=600,
)


@app.on_event("startup")
async def startup():
    logger.info("KorvixAI API started | env=%s", ENVIRONMENT)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error("Unhandled exception: %s %s | error: %s", request.method, request.url, str(exc), exc_info=True)
    return JSONResponse(status_code=500, content=FALLBACK_RESPONSE)


@app.get("/health")
async def health():
    return {"status": "ok"}


app.include_router(chat_router)
