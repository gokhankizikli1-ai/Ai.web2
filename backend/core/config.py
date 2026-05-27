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
    # Phase 6a — Anthropic provider. Registered into the provider
    # registry only when this key is set; absence means the provider
    # appears in /v2/health as registered=false (Phase B placeholder
    # shape) and never receives traffic.
    ANTHROPIC_API_KEY: str = os.getenv("ANTHROPIC_API_KEY", "")

    # ── Models ───────────────────────────────────────────────────────────
    MODEL_FAST: str = os.getenv("MODEL_FAST", "gpt-4o-mini")
    MODEL_STRONG: str = os.getenv("MODEL_STRONG", "gpt-4o")
    MODEL_GEMINI: str = os.getenv("MODEL_GEMINI", "gemini-2.0-flash-exp")
    # Phase 6a — Anthropic default. Operator can override via env var
    # without code changes (e.g. swap to claude-haiku-4-5 for cost).
    MODEL_ANTHROPIC: str = os.getenv("MODEL_ANTHROPIC", "claude-sonnet-4-6")

    # ── AI timeouts (seconds) ─────────────────────────────────────────────
    AI_TIMEOUT: int = int(os.getenv("AI_TIMEOUT", "30"))
    INTENT_TIMEOUT: int = int(os.getenv("INTENT_TIMEOUT", "15"))

    # ── Usage limits ─────────────────────────────────────────────────────
    FREE_DAILY_LIMIT: int = int(os.getenv("FREE_DAILY_LIMIT", "20"))

    # ── Owner / Admin Mode ───────────────────────────────────────────────
    # OWNER_EMAIL: historical single-owner var. Comma-separated values are
    # also accepted (kept so existing deployments keep working without
    # touching env config). Empty string ⇒ no email-based owner detection
    # via this var.
    OWNER_EMAIL: str = os.getenv("OWNER_EMAIL", "").strip().lower()
    # OWNER_EMAILS: preferred multi-owner whitelist. CSV, trimmed and
    # lower-cased per entry. Unioned with OWNER_EMAIL at check time
    # (services/admin/owner.py::_owner_emails) so an account that
    # matches EITHER var is treated as owner. Set this in production
    # for multi-owner setups; OWNER_EMAIL becomes optional.
    OWNER_EMAILS: str = os.getenv("OWNER_EMAILS", "").strip().lower()
    # OWNER_ID: legacy / numeric or string user id allow-list. Matches
    # against User.id (uuid hex) OR User.external_id. Comma-separated to
    # support emergency rotation. "0" or "" ⇒ disabled. Kept alongside
    # OWNER_EMAIL so an ops team can rotate without redeploying.
    OWNER_ID: str = os.getenv("OWNER_ID", "0")
    # ENABLE_ADMIN_MODE: master kill-switch. When false, /v2/admin/*
    # returns 404 from the route layer (the import still succeeds so the
    # rest of the app boots normally). Default false so production
    # behaviour is byte-identical until flipped.
    ENABLE_ADMIN_MODE: bool = os.getenv("ENABLE_ADMIN_MODE", "false").strip().lower() == "true"
    # OWNER_TOKEN: optional shared secret unlock for the owner. Lets a
    # browser that doesn't run the /v2/auth/* flow still surface as the
    # project owner. The frontend stores the token in localStorage and
    # sends it as X-Korvix-Owner-Token; the backend constant-time
    # compares it against this env var. Minimum 16 chars; shorter ⇒
    # token unlock disabled (defence vs. brute-force loops on /status).
    # Generate with: python -c "import secrets; print(secrets.token_urlsafe(32))"
    OWNER_TOKEN: str = os.getenv("OWNER_TOKEN", "").strip()
    # ENABLE_ADMIN_DEBUG: when true, /v2/admin/status surfaces the
    # detection_debug() payload even to non-owners. Useful for
    # troubleshooting an Owner-not-recognised report on production
    # without granting actual admin access. Default off.
    ENABLE_ADMIN_DEBUG: bool = os.getenv("ENABLE_ADMIN_DEBUG", "false").strip().lower() == "true"

    # ── Database ─────────────────────────────────────────────────────────
    DB_PATH: str = os.getenv("DB_PATH", "memory.db")
    AUTH_DB_PATH: str = os.getenv("AUTH_DB_PATH", "auth.db")
    # Phase 6 — Memory Plane SQLite file. Kept separate from memory.db /
    # sessions.db / auth.db so each phase has a clean rollback path
    # (rm memory_plane.db forgets the whole subsystem; nothing else
    # moves).
    MEMORY_PLANE_DB_PATH: str = os.getenv("MEMORY_PLANE_DB_PATH", "memory_plane.db")

    # ── Phase 6 — Memory Plane ───────────────────────────────────────────
    # Master kill-switch for the Memory Plane (PROJECT_ROADMAP.md Phase 6).
    # When false: every public client method is a no-op and /v2/memory/*
    # returns a 503 envelope. Default false so production behaviour stays
    # byte-identical until flipped. Storage schema is still created at
    # import time so flipping the flag is instant.
    ENABLE_MEMORY_PLANE: bool = os.getenv("ENABLE_MEMORY_PLANE", "false").strip().lower() == "true"

    # ── Phase 7 — Job Queue & Async Execution ────────────────────────────
    # Master kill-switch for the Job Queue (PROJECT_ROADMAP.md Phase 7).
    # When false: /v2/jobs/* returns 503 envelopes; the client either
    # no-ops (reads) or raises JobQueueDisabled (writes). Schema is
    # still created at import time so flag flips are instant.
    ENABLE_JOB_QUEUE: bool = os.getenv("ENABLE_JOB_QUEUE", "false").strip().lower() == "true"
    # Execution backend:
    #   inline    (default)  — in-process asyncio task pool (single-instance
    #                          Railway-friendly; no Redis required)
    #   celery               — reserved for Phase 14+; requires REDIS_URL +
    #                          a separate `korvixai-workers` Railway service
    #   disabled             — defensive double-gate; never executes
    JOB_QUEUE_MODE: str = os.getenv("JOB_QUEUE_MODE", "inline").strip().lower()
    # Concurrency cap for the inline runner — max number of jobs
    # running in parallel on one API process.
    JOB_QUEUE_INLINE_CONCURRENCY: int = int(os.getenv("JOB_QUEUE_INLINE_CONCURRENCY", "4"))
    # Dedicated SQLite file for the jobs table — same isolation pattern
    # as memory_plane.db / sessions.db. Override only for tests.
    JOBS_DB_PATH: str = os.getenv("JOBS_DB_PATH", "jobs.db")
    # Redis broker URL — Phase 14 dependency. Unused when
    # JOB_QUEUE_MODE=inline; documented here for parity with the
    # Railway deploy template.
    REDIS_URL: str = os.getenv("REDIS_URL", "")

    # ── Phase 8 — Unified AI OS Foundation ──────────────────────────────
    # Six independent flags so each subsystem can be enabled/disabled
    # separately on Railway. All default OFF so production behaviour
    # is byte-identical until each one is explicitly flipped.
    ENABLE_ASSET_SYSTEM:        bool = os.getenv("ENABLE_ASSET_SYSTEM",        "false").strip().lower() == "true"
    ENABLE_VISION_PIPELINE:     bool = os.getenv("ENABLE_VISION_PIPELINE",     "false").strip().lower() == "true"
    ENABLE_PROJECT_BRAIN:       bool = os.getenv("ENABLE_PROJECT_BRAIN",       "false").strip().lower() == "true"
    ENABLE_AGENT_ORCHESTRATION: bool = os.getenv("ENABLE_AGENT_ORCHESTRATION", "false").strip().lower() == "true"
    ENABLE_WORKFLOWS:           bool = os.getenv("ENABLE_WORKFLOWS",           "false").strip().lower() == "true"
    ENABLE_WEBSITE_RECREATION:  bool = os.getenv("ENABLE_WEBSITE_RECREATION",  "false").strip().lower() == "true"
    # Per-subsystem SQLite paths. Same isolation pattern as Phase 6/7:
    # one file per subsystem so each rollback is `rm <file>` and
    # nothing else moves.
    ASSETS_DB_PATH:        str = os.getenv("ASSETS_DB_PATH",        "assets.db")
    VISION_DB_PATH:        str = os.getenv("VISION_DB_PATH",        "vision.db")
    WORKFLOWS_DB_PATH:     str = os.getenv("WORKFLOWS_DB_PATH",     "workflows.db")
    AGENT_TASKS_DB_PATH:   str = os.getenv("AGENT_TASKS_DB_PATH",   "agent_tasks.db")
    # Asset file storage. Local filesystem by default (Railway-compatible
    # at the working dir; mount a persistent volume in production).
    # When ASSETS_STORAGE_BACKEND=r2 / s3 / supabase is set with the
    # matching credentials, AssetStorage swaps in the appropriate
    # adapter — interface is single-class so the swap is one file.
    ASSETS_STORAGE_BACKEND:    str = os.getenv("ASSETS_STORAGE_BACKEND", "local").strip().lower()
    ASSETS_STORAGE_LOCAL_ROOT: str = os.getenv("ASSETS_STORAGE_LOCAL_ROOT", "uploads")
    # Per-asset upload cap. 10 MB matches reasonable image/PDF sizes;
    # video uploads are accepted but flagged processing_not_supported.
    ASSETS_MAX_BYTES:          int = int(os.getenv("ASSETS_MAX_BYTES", str(10 * 1024 * 1024)))

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
