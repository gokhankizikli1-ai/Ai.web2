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

    # ── Build-task provider routing ──────────────────────────────────────
    # Centralized policy that decides which provider/model the Web Build and
    # App Build tasks use. Supported SAFE modes:
    #   disabled (default) — exact current behavior; OpenAI stays selected;
    #                        nothing is computed or logged; ZERO Anthropic calls.
    #   shadow             — compute + log the decision only; execution stays
    #                        on OpenAI; ZERO Anthropic calls.
    #   owner_only         — may execute real Anthropic traffic for
    #                        `web_build.planning` ONLY when the request is a
    #                        BACKEND-VERIFIED owner. Non-owners stay on OpenAI.
    #   all_users          — the SAME `web_build.planning` Claude execution,
    #                        extended to EVERY authenticated ENTITLED user
    #                        (parity: a normal user gets the same planner as the
    #                        owner). Entitlement/credits/rate-limits are enforced
    #                        upstream by ai_guard before planning is reached, so
    #                        this changes only the provider, never a billing gate.
    #   Both real-execution modes are scoped to planning only, keep the single
    #   call + one OpenAI fallback on any Anthropic failure, and never touch
    #   codegen/repairs/review (which stay on OpenAI). There is NO global
    #   active/cutover mode.
    # A missing or unrecognized value resolves to `disabled` (fail safe: routing
    # can never silently activate). The RUNTIME source of truth is
    # backend.services.build_routing.policy.routing_mode(), which re-reads this
    # var dynamically so a Railway flip is live without a restart (mirrors the
    # provider router / starter-abuse mode pattern); this attribute registers
    # the canonical name + default for discoverability. No secret value.
    BUILD_PROVIDER_ROUTING_MODE: str = os.getenv("BUILD_PROVIDER_ROUTING_MODE", "disabled").strip().lower() or "disabled"

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

    # ── Sprint 1.3 — Universal Product Intelligence ─────────────────────
    # Master gate for the /v2/intelligence/* planning API. The engine itself
    # is a pure, side-effect-free library that other modules import directly;
    # this flag only governs whether the HTTP surface is exposed. Default OFF
    # so production behaviour is byte-identical until flipped.
    ENABLE_PRODUCT_INTELLIGENCE: bool = os.getenv("ENABLE_PRODUCT_INTELLIGENCE", "false").strip().lower() == "true"

    # ── Sprint 1.4 — Blueprint → Orchestrator bridge ────────────────────
    # Gate for the /v2/intelligence/orchestrate endpoint. When OFF the route
    # returns 503. When ON, DRY-RUN works (pure planning, no jobs/LLM);
    # EXECUTION additionally requires ENABLE_PRODUCT_INTELLIGENCE +
    # ENABLE_PROJECT_ORCHESTRATOR (+ the orchestrator's own workflow/job
    # flags). Default OFF so production behaviour is unchanged until flipped.
    ENABLE_BLUEPRINT_ORCHESTRATOR_BRIDGE: bool = os.getenv("ENABLE_BLUEPRINT_ORCHESTRATOR_BRIDGE", "false").strip().lower() == "true"

    # ── Sprint 1.5 — Deliverable Result / preview API ───────────────────
    # Gate for the /v2/orchestrator/runs/{id}/result + /projects/{id}/result
    # read endpoints. The resolver only READS existing, ownership-scoped
    # orchestrator deliverables (no execution, no fabrication); this flag
    # only governs HTTP exposure. Default OFF → 503 when off.
    ENABLE_DELIVERABLE_RESULT_API: bool = os.getenv("ENABLE_DELIVERABLE_RESULT_API", "false").strip().lower() == "true"

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

    # ── Billing — Lemon Squeezy webhook foundation (PR 1) ────────────────
    # Master gate for the /v2/billing/* webhook surface. When false the
    # public webhook endpoint returns 503 and nothing is ingested — so the
    # route ships to production dormant and is turned on with a single env
    # flip once the Lemon Squeezy store + signing secret are configured.
    # Default OFF so production behaviour is byte-identical until flipped.
    ENABLE_BILLING: bool = os.getenv("ENABLE_BILLING", "false").strip().lower() == "true"
    # LEMON_SQUEEZY_WEBHOOK_SECRET: the signing secret configured in the
    # Lemon Squeezy dashboard for this webhook. Signature verification is
    # HMAC-SHA256 over the RAW request body compared (constant-time) to the
    # X-Signature header. Empty ⇒ the endpoint fails closed (503) because it
    # cannot authenticate callers. NEVER logged. Rotate by updating this var.
    LEMON_SQUEEZY_WEBHOOK_SECRET: str = os.getenv("LEMON_SQUEEZY_WEBHOOK_SECRET", "").strip()
    # Hard request-body cap for the webhook endpoint. Lemon Squeezy payloads
    # are small JSON documents (a few KB); 512 KiB is a generous ceiling that
    # still refuses a hostile client trying to exhaust memory. Requests over
    # this are rejected 413 BEFORE the body is fully buffered.
    LEMON_SQUEEZY_WEBHOOK_MAX_BYTES: int = int(
        os.getenv("LEMON_SQUEEZY_WEBHOOK_MAX_BYTES", str(512 * 1024))
    )
    # Dedicated store for the webhook inbox. Same per-subsystem isolation as
    # memory_plane.db / jobs.db — rollback is `rm billing.db` and nothing
    # else moves. When ENABLE_POSTGRES_BACKEND + DATABASE_URL are set the
    # inbox uses Postgres instead (see backend.services.billing.store); this
    # SQLite path is the default + fallback backend.
    BILLING_DB_PATH: str = resolve_db_path("billing.db", "BILLING_DB_PATH")

    # ── Billing — webhook consumer / processor (PR 2) ────────────────────
    # Gates the CONSUMPTION of stored webhook events, separately from
    # ingestion (ENABLE_BILLING). With this OFF, verified deliveries are
    # still accepted + stored as `stored`; they are only processed once this
    # is flipped on (nothing is lost). Default OFF. Read dynamically in
    # backend.services.billing.processor.config so a Railway flip is live.
    ENABLE_BILLING_PROCESSOR: bool = os.getenv("ENABLE_BILLING_PROCESSOR", "false").strip().lower() == "true"
    # When true (default), a freshly-stored delivery is processed best-effort
    # inline on the webhook request; when false, only an explicit drain
    # processes the backlog. Only takes effect when the processor is enabled.
    BILLING_PROCESS_INLINE: bool = os.getenv("BILLING_PROCESS_INLINE", "true").strip().lower() == "true"
    # Total processing attempts before an event is dead-lettered (stays
    # `failed`, no longer retried). The atomic claim increments attempts.
    BILLING_MAX_PROCESSING_ATTEMPTS: int = int(os.getenv("BILLING_MAX_PROCESSING_ATTEMPTS", "5"))
    # Upper bound on how many events a single drain pass processes.
    BILLING_DRAIN_BATCH_LIMIT: int = int(os.getenv("BILLING_DRAIN_BATCH_LIMIT", "100"))
    # Age (seconds) after which an event stuck in `processing` (crashed
    # worker) is reclaimed back to the reprocessable queue.
    BILLING_PROCESSING_STALE_SECONDS: int = int(os.getenv("BILLING_PROCESSING_STALE_SECONDS", "900"))

    # ── Billing — subscription-state projection (PR 3) ───────────────────
    # When true (default), the consumer projects processed subscription
    # lifecycle events into the normalized billing_subscriptions truth layer.
    # Only reachable when the processor is enabled (projection runs inside a
    # processor handler). Set false as an escape hatch to pause writing the
    # subscription table (e.g. during a backfill) without disabling the whole
    # consumer — the handler then degrades to a no-op acknowledgement. This
    # layer is subscription STATE only: no entitlements, credits, usage limits
    # or feature gating (a later PR reads this table for those).
    ENABLE_BILLING_SUBSCRIPTION_PROJECTION: bool = os.getenv("ENABLE_BILLING_SUBSCRIPTION_PROJECTION", "true").strip().lower() == "true"

    # ── Billing — entitlement layer (PR 4) ───────────────────────────────
    # Read-only "what may this user do" layer derived from the subscription
    # truth layer. When OFF (default), the query API resolves every user to
    # the default plan without reading subscriptions — the layer ships
    # dormant. This PR provides entitlement STATE + a query API only: NO
    # usage tracking/metering, payment processing, webhook changes or
    # frontend billing UI, and it wires into no existing product route.
    ENABLE_BILLING_ENTITLEMENTS: bool = os.getenv("ENABLE_BILLING_ENTITLEMENTS", "false").strip().lower() == "true"
    # Plan key granted to users with no entitling subscription.
    BILLING_DEFAULT_PLAN: str = os.getenv("BILLING_DEFAULT_PLAN", "free").strip() or "free"
    # Plan catalog as a JSON string (or a file via BILLING_PLAN_CATALOG_PATH):
    #   {"pro": {"name":"Pro","rank":10,"features":["advanced_export"],
    #            "limits":{"projects":100,"seats":5}}}
    # Empty ⇒ only the built-in `free` plan exists (fail-closed: no paid
    # access is granted until plans are configured). DATA, not code — adding a
    # plan is a config change, never a deploy.
    BILLING_PLAN_CATALOG_JSON: str = os.getenv("BILLING_PLAN_CATALOG_JSON", "")
    BILLING_PLAN_CATALOG_PATH: str = os.getenv("BILLING_PLAN_CATALOG_PATH", "").strip()
    # Maps provider identifiers to plan keys (precedence variant→product→price):
    #   {"variant:123":"pro","product:5":"pro","price:9":"pro"}
    BILLING_PLAN_MAP_JSON: str = os.getenv("BILLING_PLAN_MAP_JSON", "")
    # Normalized subscription statuses that grant entitlement (CSV). `cancelled`
    # is handled separately via the grace check below.
    BILLING_ENTITLING_STATUSES: str = os.getenv("BILLING_ENTITLING_STATUSES", "active,trialing")
    # When true (default), a `cancelled` subscription still entitles until its
    # ends_at passes (Lemon keeps it active until period end).
    BILLING_CANCELLED_GRACE: bool = os.getenv("BILLING_CANCELLED_GRACE", "true").strip().lower() == "true"

    # ── Billing — feature gating enforcement (PR 5) ──────────────────────
    # Whether entitlement checks actually BLOCK paid product features. Default
    # OFF: every gate is a no-op that allows the request, so wiring a gate onto
    # a route changes nothing until this is flipped. Enforcement additionally
    # requires ENABLE_BILLING_ENTITLEMENTS=true — a gate never blocks while the
    # truth layer is dormant (that would lock every user out on the default
    # plan). Owners always bypass; any gate-evaluation error fails open. This
    # PR wires gating only; it adds no usage metering, credits, quotas,
    # checkout or payment changes.
    ENABLE_BILLING_FEATURE_GATING: bool = os.getenv("ENABLE_BILLING_FEATURE_GATING", "false").strip().lower() == "true"

    # ── Billing — usage metering & quota enforcement (PR 6) ──────────────
    # Whether expensive metered operations count against per-plan quotas.
    # Default OFF: every quota check/consume is a no-op that allows the
    # request and records nothing, so wiring a quota onto a route changes
    # nothing until enabled. Limits come from the entitlement layer (the plan
    # `limits` of the same metric key); usage counters are independent of
    # billing state (keyed by user+metric+period, never subscription). Owners
    # bypass; any metering error fails open. This PR adds NO checkout, payment,
    # frontend or subscription changes.
    ENABLE_BILLING_USAGE: bool = os.getenv("ENABLE_BILLING_USAGE", "false").strip().lower() == "true"
    # Default period a metric is counted over: month (default) | day | total.
    # Counters roll over automatically when the period key changes (no reset
    # job). Per-metric overrides via BILLING_USAGE_METRIC_PERIODS_JSON, e.g.
    #   {"web_build_generations":"day"}
    BILLING_USAGE_PERIOD: str = os.getenv("BILLING_USAGE_PERIOD", "month")
    BILLING_USAGE_METRIC_PERIODS_JSON: str = os.getenv("BILLING_USAGE_METRIC_PERIODS_JSON", "")

    # ── Billing — Lemon Squeezy checkout creation (PR 7) ─────────────────
    # Gates the authenticated POST /v2/billing/checkout endpoint that creates a
    # hosted Lemon Squeezy checkout and links it to the caller's Korvix user id
    # (via checkout custom data → webhook meta.custom_data → app_user_id).
    # Default OFF: the endpoint returns 503 until enabled. This PR adds NO credit
    # ledger/grants, AI-Guard credit enforcement, customer portal, prices, or
    # billing frontend beyond this backend contract.
    ENABLE_BILLING_CHECKOUT: bool = os.getenv("ENABLE_BILLING_CHECKOUT", "false").strip().lower() == "true"
    # LEMON_SQUEEZY_API_KEY: server-side API key (Bearer) for the checkout call.
    # SECRET — NEVER logged. Empty ⇒ the endpoint fails closed (503).
    LEMON_SQUEEZY_API_KEY: str = os.getenv("LEMON_SQUEEZY_API_KEY", "").strip()
    # The Lemon Squeezy store id checkouts are created under.
    LEMON_SQUEEZY_STORE_ID: str = os.getenv("LEMON_SQUEEZY_STORE_ID", "").strip()
    # API base (override for staging/tests) + per-request timeout.
    LEMON_SQUEEZY_API_BASE: str = os.getenv("LEMON_SQUEEZY_API_BASE", "https://api.lemonsqueezy.com").strip()
    BILLING_CHECKOUT_TIMEOUT_SEC: float = float(os.getenv("BILLING_CHECKOUT_TIMEOUT_SEC", "15") or 15)
    # Centralized purchasable-variant config (the only variants a client may
    # buy). JSON: {"pro_monthly":{"variant_id":"123","plan":"pro","label":"Pro Monthly"}}
    # NO prices/credit quantities here — identity of the purchase only.
    BILLING_CHECKOUT_VARIANTS_JSON: str = os.getenv("BILLING_CHECKOUT_VARIANTS_JSON", "")
    # Post-purchase redirect handling. A client-supplied return_url must resolve
    # to a host in ALLOWED_ORIGINS or BILLING_CHECKOUT_ALLOWED_RETURN_HOSTS
    # (open-redirect guard); otherwise the default below is used.
    BILLING_CHECKOUT_DEFAULT_RETURN_URL: str = os.getenv("BILLING_CHECKOUT_DEFAULT_RETURN_URL", "").strip()
    BILLING_CHECKOUT_ALLOWED_RETURN_HOSTS: str = os.getenv("BILLING_CHECKOUT_ALLOWED_RETURN_HOSTS", "")

    # ── Billing — credit ledger (PR 8) ───────────────────────────────────
    # Gates the immutable credit ledger (per-user accounts + append-only
    # grant/consume/adjust records). Default OFF: mutating calls are no-ops and
    # reads return an empty account until enabled. Credits are independent of
    # subscription state. This PR is the FOUNDATION only — NO automatic monthly
    # grants, plan pricing, AI provider cost calculation, usage-enforcement
    # changes, customer portal, or billing frontend. The consume/can_consume
    # API is a prepared integration seam for a future AI-Guard PR.
    ENABLE_BILLING_CREDITS: bool = os.getenv("ENABLE_BILLING_CREDITS", "false").strip().lower() == "true"
    # Default overdraft policy for consume(): when false (default) a consume
    # that would drive the balance below zero is rejected (insufficient_funds).
    BILLING_CREDITS_ALLOW_NEGATIVE: bool = os.getenv("BILLING_CREDITS_ALLOW_NEGATIVE", "false").strip().lower() == "true"

    # ── Billing — provider selection + Polar foundation (PR #522) ────────
    # BILLING_PROVIDER: the active billing provider. Backend-only (NEVER a VITE_
    # var). Default and fail-safe is "lemon_squeezy" — an empty or UNKNOWN value
    # resolves to Lemon so production is never silently pointed at an
    # unimplemented provider. Setting "polar" makes checkout FAIL CLOSED (503)
    # until the Polar implementation PR (#524) — there is no silent fallback.
    # The live selector is `billing.provider.resolve_provider()` (read dynamically).
    BILLING_PROVIDER: str = os.getenv("BILLING_PROVIDER", "lemon_squeezy").strip().lower() or "lemon_squeezy"
    # Polar credentials — DORMANT in this PR (nothing consumes them yet). All
    # default empty ⇒ the Polar adapter is unconfigured and fails closed. They are
    # declared so an operator can pre-provision Polar (sandbox) ahead of PR #524.
    # SECRETS — NEVER logged, NEVER mirrored to a VITE_ var.
    POLAR_ACCESS_TOKEN: str = os.getenv("POLAR_ACCESS_TOKEN", "").strip()      # SECRET (Bearer)
    POLAR_ORGANIZATION_ID: str = os.getenv("POLAR_ORGANIZATION_ID", "").strip()
    POLAR_WEBHOOK_SECRET: str = os.getenv("POLAR_WEBHOOK_SECRET", "").strip()  # SECRET (Standard-Webhooks)
    # "sandbox" (default) or "production"; a typo falls back to sandbox so an
    # accidental enable can never touch live Polar. Optional API base override.
    POLAR_SERVER: str = os.getenv("POLAR_SERVER", "sandbox").strip().lower() or "sandbox"
    POLAR_API_BASE: str = os.getenv("POLAR_API_BASE", "").strip()

    # ── GitHub connector (read-only source of Business Brain observations) ─
    # Master gate for the /v2/github/* surface. When false: connect/sync/
    # connection routes 503 and the webhook endpoint 503s (dormant). Default
    # OFF so production behaviour is byte-identical until flipped. The RUNTIME
    # source of truth is backend.services.github.config (read dynamically so a
    # Railway flip is live without a restart, mirroring billing.config); these
    # attributes register the canonical names + defaults for discoverability.
    ENABLE_GITHUB_CONNECTOR: bool = os.getenv("ENABLE_GITHUB_CONNECTOR", "false").strip().lower() == "true"
    # GITHUB_APP_ID: the numeric GitHub App id (App settings → About). Not
    # secret, but only meaningful paired with the private key.
    GITHUB_APP_ID: str = os.getenv("GITHUB_APP_ID", "").strip()
    # GITHUB_APP_PRIVATE_KEY: the App's PEM private key. SECRET — NEVER logged,
    # NEVER returned to the frontend, NEVER placed in an observation. Escaped
    # "\n" sequences (the one-line secret-store form) are restored to real
    # newlines by github.config.private_key(). Used only backend-side to sign a
    # short-lived App JWT; installation tokens are never persisted.
    GITHUB_APP_PRIVATE_KEY: str = os.getenv("GITHUB_APP_PRIVATE_KEY", "")
    # GITHUB_APP_WEBHOOK_SECRET: HMAC-SHA256 signing secret configured in the
    # GitHub App. SECRET — NEVER logged. Empty ⇒ the webhook endpoint fails
    # closed (503) because it cannot authenticate deliveries.
    GITHUB_APP_WEBHOOK_SECRET: str = os.getenv("GITHUB_APP_WEBHOOK_SECRET", "").strip()
    # GITHUB_DEFAULT_INSTALLATION_ID: OPTIONAL dev/default installation id used
    # only as a fallback when a connect call omits one. NOT a production
    # architecture — real connections carry their own installation id, so
    # multi-user installations are never blocked. Empty ⇒ no default.
    GITHUB_DEFAULT_INSTALLATION_ID: str = os.getenv("GITHUB_DEFAULT_INSTALLATION_ID", "").strip()
    # GITHUB_APP_SLUG: the App's github.com/apps/<slug> handle — needed to build
    # the install URL the user is redirected to (connect/start). Not secret.
    GITHUB_APP_SLUG: str = os.getenv("GITHUB_APP_SLUG", "").strip()
    # GITHUB_APP_CLIENT_ID / GITHUB_APP_CLIENT_SECRET: the App's user-to-server
    # OAuth credentials (App settings → Client ID / a generated client secret),
    # distinct from GITHUB_APP_ID / private key. Used ONLY to verify the
    # installing GitHub user's identity during the install flow (exchange the
    # setup-callback `code`, then confirm the installation is in the user's
    # /user/installations) so a spoofed installation_id is rejected. The SECRET is
    # never logged / returned; the user token is never persisted. Both required
    # for the install flow (connect/start 503s without them).
    GITHUB_APP_CLIENT_ID: str = os.getenv("GITHUB_APP_CLIENT_ID", "").strip()
    GITHUB_APP_CLIENT_SECRET: str = os.getenv("GITHUB_APP_CLIENT_SECRET", "")
    # GITHUB_APP_INSTALL_URL: OPTIONAL full override of the install URL (unusual
    # setups); normally derived from GITHUB_APP_SLUG. Not secret.
    GITHUB_APP_INSTALL_URL: str = os.getenv("GITHUB_APP_INSTALL_URL", "").strip()
    # GITHUB_FRONTEND_RESULT_URL / _PATH: where the setup callback redirects the
    # browser after install (fixed server-side — never a request-supplied URL, so
    # no open redirect). Falls back to PUBLIC_APP_URL + the integrations route.
    GITHUB_FRONTEND_RESULT_URL: str = os.getenv("GITHUB_FRONTEND_RESULT_URL", "").strip()
    GITHUB_FRONTEND_RESULT_PATH: str = os.getenv("GITHUB_FRONTEND_RESULT_PATH", "/#/settings/integrations").strip()
    # Install-flow bounds (setup-state TTL, verified-pending-install TTL, repo
    # list cap). Runtime source of truth is backend.services.github.config.
    GITHUB_SETUP_STATE_TTL_S: int = int(os.getenv("GITHUB_SETUP_STATE_TTL_S", "600") or 600)
    GITHUB_PENDING_TTL_S: int = int(os.getenv("GITHUB_PENDING_TTL_S", "900") or 900)
    GITHUB_INSTALL_REPOS_MAX: int = int(os.getenv("GITHUB_INSTALL_REPOS_MAX", "100") or 100)

    # ── Gmail connector (read-only source of Business Brain observations) ──
    # Master gate for the /v2/gmail/* surface. When false: connect/status/sync/
    # disconnect routes 503 and the OAuth callback bounces to the frontend with
    # a generic error (dormant). Default OFF so production behaviour is
    # byte-identical until flipped. The RUNTIME source of truth is
    # backend.services.gmail.config (read dynamically so a Railway flip is live
    # without a restart, mirroring the GitHub connector); these attributes
    # register the canonical names + defaults for discoverability.
    ENABLE_GMAIL_CONNECTOR: bool = os.getenv("ENABLE_GMAIL_CONNECTOR", "false").strip().lower() == "true"
    # GMAIL_OAUTH_CLIENT_ID / GMAIL_OAUTH_CLIENT_SECRET: the Google OAuth Web
    # Application credentials. The id falls back to the existing GOOGLE_CLIENT_ID
    # (already used by the Google login verifier) so one Google project is
    # shared; the SECRET is NEVER logged, NEVER returned to the frontend.
    GMAIL_OAUTH_CLIENT_ID: str = os.getenv("GMAIL_OAUTH_CLIENT_ID", "").strip()
    GMAIL_OAUTH_CLIENT_SECRET: str = os.getenv("GMAIL_OAUTH_CLIENT_SECRET", "")
    # GMAIL_OAUTH_REDIRECT_URI: the EXACT Authorized redirect URI registered in
    # Google Cloud. Read from env (never derived from the request Host) and must
    # equal "<backend-public-base>/v2/gmail/oauth/callback". Empty ⇒ connect
    # fails closed (503).
    GMAIL_OAUTH_REDIRECT_URI: str = os.getenv("GMAIL_OAUTH_REDIRECT_URI", "").strip()
    # KORVIX_CREDENTIAL_ENCRYPTION_KEY: Fernet key(s) (comma-separated for
    # rotation; first encrypts, all decrypt) used to encrypt the stored Gmail
    # refresh token AT REST. SECRET — NEVER logged. Empty ⇒ the connector fails
    # closed (a refresh token is never stored in plaintext). Generate with:
    #   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    KORVIX_CREDENTIAL_ENCRYPTION_KEY: str = os.getenv("KORVIX_CREDENTIAL_ENCRYPTION_KEY", "")

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

    # ── Auth — email verification (identity gate for starter credits) ─────
    # NON-billing auth config. Gates whether a password account must confirm
    # ownership of its email before the app grants starter credits or lets it
    # run paid AI/build operations. Default OFF: the require_verified_identity
    # guard is a pass-through and password signup is treated as verified, so
    # merging this is behaviourally inert until an operator enables it (flip
    # this ON together with ENABLE_BILLING_CREDITS). Google OAuth accounts are
    # provider-verified regardless of this flag (Google asserts email_verified).
    ENABLE_EMAIL_VERIFICATION: bool = os.getenv("ENABLE_EMAIL_VERIFICATION", "false").strip().lower() == "true"
    # Transactional email delivery. "console" (default) is the dev-safe backend:
    # it NEVER prints the token/URL in production, only a redacted line. "resend"
    # uses the Resend HTTP API (Bearer RESEND_API_KEY). Unknown ⇒ console.
    EMAIL_PROVIDER: str = os.getenv("EMAIL_PROVIDER", "console").strip().lower() or "console"
    # SECRET — never logged. Empty ⇒ the resend provider fails closed (falls back
    # to console so a misconfig can't crash signup).
    RESEND_API_KEY: str = os.getenv("RESEND_API_KEY", "").strip()
    # RFC-5322 From header, e.g. "KorvixAI <noreply@korvixai.com>". Empty ⇒ email
    # send is skipped (console line only) so an unconfigured env never 500s.
    EMAIL_FROM: str = os.getenv("EMAIL_FROM", "").strip()
    # Public base URL the verification link points at (the SPA origin). The link
    # uses a HashRouter fragment so the raw token never reaches the server logs.
    # EMAIL_VERIFICATION_BASE_URL (spec name) overrides PUBLIC_APP_URL when set.
    PUBLIC_APP_URL: str = os.getenv("PUBLIC_APP_URL", "https://korvixai.com").strip().rstrip("/")
    EMAIL_VERIFICATION_BASE_URL: str = os.getenv("EMAIL_VERIFICATION_BASE_URL", "").strip().rstrip("/")
    # Single-use token lifetime + resend abuse controls. The *_SECONDS names are
    # the spec-preferred ones; the legacy minute/second names are kept as
    # fallbacks (0 ⇒ unset ⇒ use the legacy value / default).
    EMAIL_VERIFICATION_TOKEN_TTL_MIN: int = int(os.getenv("EMAIL_VERIFICATION_TOKEN_TTL_MIN", "30") or 30)
    EMAIL_VERIFICATION_TTL_SECONDS: int = int(os.getenv("EMAIL_VERIFICATION_TTL_SECONDS", "0") or 0)
    EMAIL_VERIFICATION_RESEND_COOLDOWN_SEC: int = int(os.getenv("EMAIL_VERIFICATION_RESEND_COOLDOWN_SEC", "60") or 60)
    EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS: int = int(os.getenv("EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS", "0") or 0)
    EMAIL_VERIFICATION_MAX_SENDS_PER_HOUR: int = int(os.getenv("EMAIL_VERIFICATION_MAX_SENDS_PER_HOUR", "5") or 5)
    # Per-IP hourly cap on verification-send requests (best-effort, in-process).
    EMAIL_VERIFICATION_MAX_SENDS_PER_IP_HOUR: int = int(os.getenv("EMAIL_VERIFICATION_MAX_SENDS_PER_IP_HOUR", "20") or 20)
    # Registration (signup) per-IP hourly cap — brake on scripted account farming.
    AUTH_REGISTER_MAX_PER_IP_HOUR: int = int(os.getenv("AUTH_REGISTER_MAX_PER_IP_HOUR", "10") or 10)
    # Outbound email HTTP timeout (seconds).
    EMAIL_TIMEOUT_SEC: float = float(os.getenv("EMAIL_TIMEOUT_SEC", "15") or 15)

    # ── Starter-credit abuse protection ──────────────────────────────────
    # Layered, privacy-conscious controls that limit repeated FREE starter-credit
    # grants (promotional only — purchased/subscription credits are never gated).
    # Master switch (default OFF ⇒ feature dormant, behaviour unchanged) plus a
    # mode: "off" | "shadow" | "enforce". Shadow computes + logs a redacted
    # decision but NEVER denies; enforce actually withholds the starter grant on a
    # deny/defer. The mode only takes effect when the master switch is on.
    ENABLE_STARTER_CREDIT_ABUSE_PROTECTION: bool = os.getenv("ENABLE_STARTER_CREDIT_ABUSE_PROTECTION", "false").strip().lower() == "true"
    STARTER_CREDIT_ABUSE_MODE: str = os.getenv("STARTER_CREDIT_ABUSE_MODE", "shadow").strip().lower() or "shadow"
    # Thresholds (safe defaults; tuned for households/offices/schools). A grant is
    # denied/deferred only when signals stack — never on shared IP alone.
    STARTER_ABUSE_MAX_GRANTS_PER_INSTALL: int = int(os.getenv("STARTER_ABUSE_MAX_GRANTS_PER_INSTALL", "1") or 1)
    STARTER_ABUSE_MAX_GRANTS_PER_NETWORK_DAY: int = int(os.getenv("STARTER_ABUSE_MAX_GRANTS_PER_NETWORK_DAY", "8") or 8)
    STARTER_ABUSE_NETWORK_WINDOW_HOURS: int = int(os.getenv("STARTER_ABUSE_NETWORK_WINDOW_HOURS", "24") or 24)
    # IPv4 prefix length used to derive the (hashed) network identifier — /24
    # groups a household/office without over-collapsing a carrier. IPv6 uses /64.
    STARTER_ABUSE_IPV4_PREFIX: int = int(os.getenv("STARTER_ABUSE_IPV4_PREFIX", "24") or 24)

    # ── Trusted proxy (client-IP extraction) ─────────────────────────────
    # X-Forwarded-For is NOT trusted by default (TRUSTED_PROXY_COUNT=0 ⇒ use the
    # socket peer only). When the app sits behind N known proxies (e.g. Railway
    # edge = 1), set the count so the Nth-from-the-right XFF hop is taken as the
    # real client; a spoofed XFF from the client is then ignored. Never blindly
    # trusts the whole header.
    TRUSTED_PROXY_COUNT: int = int(os.getenv("TRUSTED_PROXY_COUNT", "0") or 0)
    # Secret salt for keyed hashing of IPs / install ids (defence in depth so a
    # leaked DB can't be reversed to raw IPs). Falls back to JWT_SECRET_KEY.
    ABUSE_HASH_SALT: str = os.getenv("ABUSE_HASH_SALT", "").strip()

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
        # Phase 14H — auth is stateful too: the users table (auth.db) lives on
        # the same ephemeral filesystem, so a volume-less prod deploy WIPES user
        # accounts on every redeploy → valid sessions 401 (row gone) and the same
        # account gets a new id (new storage scope) after re-login. Treat auth
        # being enabled as a stateful subsystem so this is flagged CRITICAL, not
        # a mere warning.
        auth_enabled = (
            os.getenv("ENABLE_AUTH_V2", "false").strip().lower() == "true"
            or os.getenv("ENABLE_AUTH_MIDDLEWARE", "false").strip().lower() == "true"
        )
        stateful_on = any([
            self.ENABLE_MEMORY_PLANE, self.ENABLE_JOB_QUEUE,
            self.ENABLE_ASSET_SYSTEM, self.ENABLE_AGENT_ORCHESTRATION,
            self.ENABLE_WORKFLOWS, auth_enabled,
        ])
        if not persist["durable"]:
            if is_prod:
                lvl = "critical" if stateful_on else "warning"
                issues.append((
                    lvl,
                    "Persistence is EPHEMERAL: no KORVIX_DATA_DIR / Railway "
                    "volume configured, so all SQLite databases live under the "
                    "container working directory and are WIPED on every "
                    "redeploy (user accounts, memory, jobs, projects). This logs "
                    "out valid users and orphans their data after re-login. Mount "
                    "a persistent volume and set KORVIX_DATA_DIR to its path.",
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

        # 3b. Billing webhook — if the surface is enabled it MUST have a
        #     signing secret, otherwise it fails closed (503) on every
        #     delivery and Lemon Squeezy retries pile up. Surface loudly.
        if self.ENABLE_BILLING and not self.LEMON_SQUEEZY_WEBHOOK_SECRET:
            issues.append((
                "critical",
                "ENABLE_BILLING is on but LEMON_SQUEEZY_WEBHOOK_SECRET is "
                "empty — the webhook endpoint cannot verify signatures and "
                "will reject every delivery (503). Set the signing secret "
                "from the Lemon Squeezy dashboard.",
            ))

        # 3c. Billing checkout — if enabled it MUST have the active provider's
        #     credentials, else every checkout request fails closed (503).
        if self.ENABLE_BILLING_CHECKOUT and self.BILLING_PROVIDER == "lemon_squeezy" \
                and not (self.LEMON_SQUEEZY_API_KEY and self.LEMON_SQUEEZY_STORE_ID):
            issues.append((
                "critical",
                "ENABLE_BILLING_CHECKOUT is on but LEMON_SQUEEZY_API_KEY and/or "
                "LEMON_SQUEEZY_STORE_ID is empty — checkout creation will fail "
                "closed (503). Set both to enable checkout.",
            ))
        if self.ENABLE_BILLING_CHECKOUT and self.BILLING_PROVIDER == "polar" \
                and not (self.POLAR_ACCESS_TOKEN and self.POLAR_ORGANIZATION_ID):
            issues.append((
                "critical",
                "BILLING_PROVIDER=polar with ENABLE_BILLING_CHECKOUT on, but "
                "POLAR_ACCESS_TOKEN and/or POLAR_ORGANIZATION_ID is empty — Polar "
                "checkout fails closed (503). Set both (POLAR_SERVER=sandbox first).",
            ))

        # 3d. PR #524 — an EXPLICITLY-UNKNOWN BILLING_PROVIDER must not silently
        #     charge through Lemon: checkout fails closed. (empty/unset stays lemon.)
        _bp = self.BILLING_PROVIDER
        if _bp and _bp not in ("lemon_squeezy", "polar"):
            issues.append((
                "critical",
                f"BILLING_PROVIDER is set to an unknown value {_bp!r} (allowed: "
                "lemon_squeezy, polar) — billing mutations fail closed. Fix or unset it.",
            ))
        # 3e. PR #525 — when Polar is the SELECTED provider, strengthen validation
        #     without touching the Lemon path (BILLING_PROVIDER unset/lemon skips all
        #     of this, so Polar vars stay optional there). Polar is a live billing
        #     mutation surface, so a partial config must fail LOUDLY, not silently.
        if _bp == "polar":
            # The webhook secret is what makes an activation trustworthy — without it
            # every Polar delivery is rejected (503) and no subscription is ever
            # projected, so checkout would strand the customer post-payment.
            if self.ENABLE_BILLING and not self.POLAR_WEBHOOK_SECRET:
                issues.append((
                    "critical",
                    "BILLING_PROVIDER=polar with ENABLE_BILLING on, but "
                    "POLAR_WEBHOOK_SECRET is empty — the Polar webhook cannot verify "
                    "signatures and rejects every delivery (503), so payments never "
                    "activate. Set the sandbox webhook secret (distinct from prod).",
                ))
            # Polar cannot function as the provider unless both master gates are on;
            # otherwise the selection is inert and the intent is ambiguous.
            if not self.ENABLE_BILLING:
                issues.append((
                    "critical",
                    "BILLING_PROVIDER=polar but ENABLE_BILLING is off — the Polar "
                    "webhook surface is disabled, so no subscription can ever be "
                    "projected. Enable ENABLE_BILLING or unset BILLING_PROVIDER.",
                ))
            if not self.ENABLE_BILLING_CHECKOUT:
                issues.append((
                    "critical",
                    "BILLING_PROVIDER=polar but ENABLE_BILLING_CHECKOUT is off — "
                    "checkout creation is disabled (503), so customers cannot start "
                    "a Polar subscription. Enable ENABLE_BILLING_CHECKOUT or unset "
                    "BILLING_PROVIDER.",
                ))
            # Deep config (active Polar variants, product-id plan mapping, valid
            # return URL) is evaluated by the READ-ONLY readiness evaluator — reused
            # here so the two never diverge. It makes NO external call. Wrapped so a
            # transient import/parse issue never turns config validation into a 500.
            try:
                from backend.services.billing import readiness as _billing_readiness
                _snap = _billing_readiness.polar_readiness()
                _polar = _snap.get("polar", {}) if isinstance(_snap, dict) else {}
                _missing = [str(m) for m in (_polar.get("missing") or [])]
                # Only surface the config-shape items here (the ENABLE_*/secret items
                # are already reported above with more specific guidance).
                _shape = [
                    m for m in _missing
                    if m in ("checkoutVariantsConfigured", "planMapConfigured", "successUrlConfigured")
                ]
                if _shape:
                    issues.append((
                        "critical",
                        "BILLING_PROVIDER=polar but the Polar plan/product mapping is "
                        "incomplete (missing: " + ", ".join(sorted(_shape)) + ") — checkout "
                        "cannot resolve a product id and fails closed. Populate "
                        "BILLING_CHECKOUT_VARIANTS_JSON / BILLING_PLAN_MAP_JSON and a "
                        "return URL before activating Polar.",
                    ))
                # Production is a one-way, LIVE-money cutover: if the full readiness
                # gate is not green, fail CLOSED with a critical (never a soft warning).
                if self.POLAR_SERVER == "production" and not _polar.get("readyForProductionCutover"):
                    issues.append((
                        "critical",
                        "BILLING_PROVIDER=polar with POLAR_SERVER=production but the "
                        "configuration readiness gate is NOT green (missing: "
                        + (", ".join(sorted(_missing)) if _missing else "unknown")
                        + ") — refusing to treat a partially-configured Polar as the "
                        "LIVE provider. Complete sandbox validation, then cut over.",
                    ))
                elif self.POLAR_SERVER == "production":
                    issues.append((
                        "warning",
                        "BILLING_PROVIDER=polar with POLAR_SERVER=production — Polar is "
                        "the LIVE billing provider. Confirm sandbox validation completed "
                        "first and that the webhook secret is the production secret.",
                    ))
            except Exception:  # pragma: no cover — validation must never hard-fail
                pass

        # 3f. GitHub connector — if enabled it needs the App credentials to do
        #     anything (auth/sync), and the webhook additionally needs its
        #     signing secret or every delivery is rejected (503). Surface a
        #     partial config loudly rather than letting it fail silently.
        if self.ENABLE_GITHUB_CONNECTOR:
            if not (self.GITHUB_APP_ID and self.GITHUB_APP_PRIVATE_KEY.strip()):
                issues.append((
                    "critical",
                    "ENABLE_GITHUB_CONNECTOR is on but GITHUB_APP_ID and/or "
                    "GITHUB_APP_PRIVATE_KEY is empty — App authentication and "
                    "initial sync cannot run. Set both (the private key is the "
                    "App's PEM, one-line-escaped newlines are handled).",
                ))
            if not self.GITHUB_APP_WEBHOOK_SECRET:
                issues.append((
                    "warning",
                    "ENABLE_GITHUB_CONNECTOR is on but GITHUB_APP_WEBHOOK_SECRET "
                    "is empty — the /v2/github/webhooks/github endpoint fails "
                    "closed (503) and rejects every delivery. Set it to enable "
                    "incremental webhook ingestion (initial sync still works "
                    "without it).",
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
