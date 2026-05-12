# coding: utf-8
"""
Centralized configuration for KorvixAI v3.
All environment variables are read here — nowhere else should call os.getenv directly.
Missing optional vars default gracefully; missing critical vars are reported at AI call time,
NOT at import time, so Railway can boot cleanly even before secrets are injected.
"""
import os
import logging

logger = logging.getLogger(__name__)


class Config:
    # ── Environment ──────────────────────────────────────────────────────
    ENVIRONMENT: str = os.getenv("ENVIRONMENT", "production")
    DEBUG: bool = ENVIRONMENT == "development"

    # ── Server ───────────────────────────────────────────────────────────
    PORT: int = int(os.getenv("PORT", "8000"))
    HOST: str = os.getenv("HOST", "0.0.0.0")

    # ── AI providers — validated lazily at call time, not import time ─────
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")

    # ── Models ───────────────────────────────────────────────────────────
    MODEL_FAST: str = os.getenv("MODEL_FAST", "gpt-4o-mini")
    MODEL_STRONG: str = os.getenv("MODEL_STRONG", "gpt-4o")
    MODEL_GEMINI: str = os.getenv("MODEL_GEMINI", "gemini-2.0-flash-exp")

    # ── AI timeouts (seconds) ─────────────────────────────────────────────
    AI_TIMEOUT: int = int(os.getenv("AI_TIMEOUT", "30"))
    INTENT_TIMEOUT: int = int(os.getenv("INTENT_TIMEOUT", "15"))

    # ── Usage limits ─────────────────────────────────────────────────────
    FREE_DAILY_LIMIT: int = int(os.getenv("FREE_DAILY_LIMIT", "20"))
    OWNER_ID: int = int(os.getenv("OWNER_ID", "0"))

    # ── Database ─────────────────────────────────────────────────────────
    DB_PATH: str = os.getenv("DB_PATH", "memory.db")
    AUTH_DB_PATH: str = os.getenv("AUTH_DB_PATH", "auth.db")

    # ── Phase 3 — JWT auth ───────────────────────────────────────────────
    # JWT_SECRET_KEY: HS256 signing key. In production this MUST be set
    # via Railway env vars (32+ random bytes, hex or base64). The
    # development fallback is intentionally weak and noisy — the auth
    # module refuses to issue tokens when DEBUG is False AND the key is
    # missing.
    JWT_SECRET_KEY: str = os.getenv("JWT_SECRET_KEY", "")
    # Token TTLs — short access tokens, long refresh tokens.
    ACCESS_TOKEN_TTL_MIN:   int = int(os.getenv("ACCESS_TOKEN_TTL_MIN",   "60"))
    REFRESH_TOKEN_TTL_DAYS: int = int(os.getenv("REFRESH_TOKEN_TTL_DAYS", "30"))
    # Token issuer claim — set to your domain in production.
    JWT_ISSUER: str = os.getenv("JWT_ISSUER", "korvixai")

    # ── CORS ─────────────────────────────────────────────────────────────
    ALLOWED_ORIGINS: list = [
        "https://korvixai.com",
        "https://www.korvixai.com",
        "https://ai-web2-roan.vercel.app",
        "http://localhost:3000",
        "http://localhost:5173",
        "http://localhost:8000",
    ]
    CORS_ORIGIN_REGEX: str = r"https://.*\.(vercel\.app|railway\.app)$"

    def validate_openai_key(self) -> bool:
        """Call this before making an OpenAI request, not at startup."""
        if not self.OPENAI_API_KEY:
            logger.error("OPENAI_API_KEY is not set")
            return False
        return True


settings = Config()
