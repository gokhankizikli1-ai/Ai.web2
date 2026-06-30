# coding: utf-8
"""
Centralized configuration for KorvixAI v3.
All environment variables are read here — nowhere else should call os.getenv directly.
Missing optional vars default gracefully; missing critical vars are reported at AI call time,
NOT at import time, so Railway can boot cleanly even before secrets are injected.
"""
import os
import logging

from backend.core.paths import resolve_db_path, persistence_summary

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
    # Paths resolve via backend.core.paths.resolve_db_path: an explicit
    # env var still wins (legacy + test behaviour unchanged), otherwise the
    # file lands under KORVIX_DATA_DIR / the Railway volume when configured,
    # else the bare relative filename. This is what lets a single env var
    # move every DB onto durable storage. See backend/core/paths.py.
    DB_PATH: str = resolve_db_path("memory.db", "DB_PATH")
    AUTH_DB_PATH: str = resolve_db_path("auth.db", "AUTH_DB_PATH")
    # Phase 6 — Memory Plane SQLite file. Kept separate from memory.db /
    # sessions.db / auth.db so each phase has a clean rollback path
    # (rm memory_plane.db forgets the whole subsystem; nothing else
    # moves).
    MEMORY_PLANE_DB_PATH: str = resolve_db_path("memory_plane.db", "MEMORY_PLANE_DB_PATH")

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
    JOBS_DB_PATH: str = resolve_db_path("jobs.db", "JOBS_DB_PATH")
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
    ASSETS_DB_PATH:        str = resolve_db_path("assets.db",       "ASSETS_DB_PATH")
    VISION_DB_PATH:        str = resolve_db_path("vision.db",       "VISION_DB_PATH")
    WORKFLOWS_DB_PATH:     str = resolve_db_path("workflows.db",    "WORKFLOWS_DB_PATH")
    AGENT_TASKS_DB_PATH:   str = resolve_db_path("agent_tasks.db",  "AGENT_TASKS_DB_PATH")
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

    # ── Legacy per-user routes (/memory, /profile, /stats) ───────────────
    # These pre-auth routes are superseded by the auth-bound /v2/* surface
    # and are NOT called by the current frontend. They are now ownership-
    # enforced (a caller can only touch their own user_id; owners may touch
    # any). This flag is the deprecation off-switch: set false to retire the
    # whole legacy surface (routes return 410 Gone, pointing at /v2/*).
    # Default true so nothing breaks until an operator opts out.
    ENABLE_LEGACY_USER_ROUTES: bool = os.getenv("ENABLE_LEGACY_USER_ROUTES", "true").strip().lower() == "true"

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

    # ── Startup self-check ────────────────────────────────────────────────
    def validate_runtime(self) -> list[tuple[str, str]]:
        """Return a list of (severity, message) configuration issues.

        Severity is one of: "critical" | "warning" | "info".

        Design contract — FAIL SAFE, NEVER FAIL HARD at import/boot:
        this only *reports*. Railway must always be able to boot (so the
        /health probe passes even before secrets are injected), so we never
        raise here. The startup hook in backend/api.py logs these loudly.
        The goal is to make insecure / data-volatile configuration LOUD and
        visible instead of silently accepted.

        Checks are gated on whether the relevant subsystem is actually
        enabled, so an operator only sees warnings about things that can
        actually bite them in the current configuration.
        """
        issues: list[tuple[str, str]] = []
        is_prod = self.ENVIRONMENT.strip().lower() not in ("development", "dev", "test", "testing")

        # 1. Persistence durability — the #1 production risk. If any
        #    stateful subsystem is on (or we're in prod at all) but no
        #    durable data dir is configured, surface it.
        persist = persistence_summary()
        stateful_on = any([
            self.ENABLE_MEMORY_PLANE, self.ENABLE_JOB_QUEUE,
            self.ENABLE_ASSET_SYSTEM, self.ENABLE_AGENT_ORCHESTRATION,
            self.ENABLE_WORKFLOWS,
        ])
        if not persist["durable"]:
            if is_prod:
                lvl = "critical" if stateful_on else "warning"
                issues.append((
                    lvl,
                    "Persistence is EPHEMERAL: no KORVIX_DATA_DIR / Railway "
                    "volume configured, so all SQLite databases live under the "
                    "container working directory and are WIPED on every "
                    "redeploy (user accounts, memory, jobs, projects). Mount a "
                    "persistent volume and set KORVIX_DATA_DIR to its path.",
                ))
            else:
                issues.append((
                    "info",
                    "Persistence is ephemeral (no data dir configured) — fine "
                    "for local/dev.",
                ))

        # 2. JWT secret — only matters once real auth verification is on.
        auth_on = (
            os.getenv("ENABLE_AUTH_V2", "false").strip().lower() == "true"
            or os.getenv("ENABLE_AUTH_MIDDLEWARE", "false").strip().lower() == "true"
        )
        key = self.JWT_SECRET_KEY.strip()
        if auth_on:
            if not key:
                issues.append((
                    "critical",
                    "ENABLE_AUTH_V2/ENABLE_AUTH_MIDDLEWARE is on but "
                    "JWT_SECRET_KEY is empty — token issue/verify will fail "
                    "closed. Set a 32+ byte JWT_SECRET_KEY.",
                ))
            elif len(key.encode("utf-8")) < 32:
                issues.append((
                    "critical",
                    f"JWT_SECRET_KEY is too short ({len(key.encode('utf-8'))} "
                    "bytes); HS256 needs >= 32 bytes. Tokens will be rejected.",
                ))
        elif is_prod and not key:
            issues.append((
                "info",
                "JWT_SECRET_KEY is unset (auth verification is off, so this "
                "is currently harmless — set it before enabling ENABLE_AUTH_V2).",
            ))

        # 3. Owner mode hardening — if admin mode is on, an unauthenticated
        #    token unlock without a strong token is a foot-gun.
        if self.ENABLE_ADMIN_MODE:
            tok = self.OWNER_TOKEN.strip()
            emails = bool(self.OWNER_EMAIL or self.OWNER_EMAILS)
            if not emails and (not tok or len(tok) < 16):
                issues.append((
                    "warning",
                    "ENABLE_ADMIN_MODE is on but neither OWNER_EMAIL(S) nor a "
                    "strong OWNER_TOKEN (>=16 chars) is set — owner mode is "
                    "either unreachable or weakly protected.",
                ))

        # 4. Orchestration write surface needs verified identity. If the
        #    orchestrator is enabled but auth verification is off, identity
        #    falls back to the guest header / body — acceptable for guests
        #    but operators should know real auth isn't being enforced.
        if os.getenv("ENABLE_ORCHESTRATOR", "false").strip().lower() == "true" and not auth_on:
            issues.append((
                "warning",
                "ENABLE_ORCHESTRATOR is on but ENABLE_AUTH_V2 is off — "
                "authenticated identity is derived inline from the Bearer "
                "token, but enabling AuthMiddleware (ENABLE_AUTH_V2) is "
                "recommended before exposing orchestration in multi-tenant prod.",
            ))

        return issues


settings = Config()
