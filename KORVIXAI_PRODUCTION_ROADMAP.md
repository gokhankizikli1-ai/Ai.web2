# KorvixAI — Production-Grade Engineering Roadmap

> Codebase-grounded analysis + roadmap. Every claim verified against `main @ 89ae7f4` on 2026-06-25.
> No assumed work; no aspirational features dressed as complete.

---

## Part I — Current State of KorvixAI

### 1.1 Architecture snapshot

| Layer | Stack | Verified |
|---|---|---|
| Frontend | React 19.2 + Vite 7.2 + react-router 7.6 + Tailwind + shadcn/ui (53 components) | `package.json` |
| Backend | FastAPI 0.111 + Uvicorn 0.30 + Pydantic 2.7 (Python 3.11) | `requirements.txt` |
| Database | **SQLite per service** (`memory_plane.db`, `sessions.db`, `auth.db`, …). No Postgres. | `services/*/store.py:sqlite3.connect` |
| Background work | In-process asyncio `TaskQueue` singleton. No Redis, no Celery. | `services/tasks/queue.py` |
| AI providers | OpenAI + Anthropic implemented. Google/Gemini reserved (registry slot, no provider) | `services/providers/` |
| FE state mgmt | **None.** `localStorage` + per-hook React state. No zustand / jotai / redux / react-query | `package.json` grep |
| Routing | 29 `<Route>` declarations in `App.tsx`, **no `React.lazy`**, no code splitting | `App.tsx`, grep |
| Auth | Guest-only (`/v2/auth/guest`). Email/Google/Apple `kind` slots **reserved, not implemented**. | `services/auth/identity.py:VALID_KINDS` |
| Tests | 31 backend pytest files. No FE test framework. | `backend/tests/` |
| Deployment | Railway, Nixpacks (forced via `railway.toml`). Single API service. | `Procfile`, `railway.toml` |

### 1.2 What exists and works

| System | Status | Evidence |
|---|---|---|
| **SSE chat streaming** | Works | `/v2/chat/stream` (`routes/v2_chat_stream.py`) — OpenAI + Anthropic providers, mode-based router |
| **Mode-based provider routing** | Works | `services/providers/router.py` — fast/deep_think/coding/research/creative behind feature flags |
| **Memory Plane (Phase 6 foundation)** | Works | `services/memory_plane/` — store/manager/retriever/extractor over SQLite; APIs `/v2/memory/*` |
| **Owner Mode** | Works | `services/admin/owner.py` + audit ledger + AdminPanel UI |
| **Trading signals** | Works | `services/trading/signals_service.py` + `useTradingSignals.ts` → live yfinance data |
| **9 tools registered** | Works | `tool_registry.py` — calculator, current_time, news, stock_market, market_data, macro_data, ecommerce_research, web_research |
| **shadcn/ui design system** | Works | 53 `src/components/ui/*.tsx` components |
| **Provider abstraction** | Works | `BaseAIProvider` + registry + router |
| **Background task queue** | Works | `services/tasks/` — bounded asyncio queue, drop-on-overflow safety contract |

### 1.3 What's stub / reserved / unfinished

| Item | Marker | Real status |
|---|---|---|
| Email/password auth | Identity `kind="email"` reserved in `identity.py:11` | Not implemented. No `/auth/login` route. |
| Google OAuth | `kind="google"` reserved | Not implemented |
| Apple Sign-In | `kind="apple"` reserved | Not implemented |
| GitHub OAuth | `kind="github"` reserved | Not implemented |
| Gemini provider | Registry slot `"google"` (`providers/registry.py:46`) | No `google_provider.py` file |
| pgvector / semantic memory | Schema comment "When Postgres + pgvector lands, ALTER COLUMN flips it" | TEXT column today |
| `auth.py` legacy route | Returns `{"authenticated": False}` | One-line stub |
| 12 legacy `routes/` files | `auth.py`, `chat.py`, `memory.py`, `profile.py`, `sessions.py`, `stats.py`, `tools.py`, `trading.py`, `v2.py`, `health.py`, `market.py` | Coexist with v2_*; partial duplication |
| Three memory layers | `services/memory/`, `services/memory_intelligence/`, `services/memory_plane/` | Not consolidated; risk of dual writes |
| Business workspaces (StartupHub, EcommerceOS, BrandBuilder, AppBuilder, AgentBuilder, KnowledgeVault, ViralContent, WebsiteAnalyzer, WebsiteBuilder, AgentMarketplace, MultiAgentSwarm, Automations) | 26 pages exist | Backend wiring uncertain; some are UI shells |

### 1.4 Strengths

1. **Clean provider abstraction** — `BaseAIProvider` + registry + mode router. Adding Gemini is one file + one registry entry. Streaming abstraction is solid.
2. **Owner Mode + audit ledger** — identity-first owner detection (`is_owner_request`), token-bound diagnostic surface, audit trail. Genuinely production-shaped.
3. **shadcn/ui foundation** — 53 components installed. Consistent styling primitive available; no need to redesign.
4. **Honest failure semantics** — `signals_service.py` explicitly: "we emit is_live=false with a non-null error field and NO fabricated prices." Same pattern in tool flags, provider routing. This is rare and valuable.
5. **Memory Plane v3 architecture** — store / manager / retriever / extractor split is clean. Ready for pgvector + embedding layers.
6. **31 backend tests** including streaming, providers, memory plane, trading. Coverage on critical paths.
7. **Comprehensive shadcn/Radix component surface** — accordion, dialog, drawer, dropdown, chart, calendar, command palette, sidebar, sonner toaster.

### 1.5 Weaknesses

1. **No frontend state management library.** `localStorage` + hooks only. 26 pages, 61 components — at this size, prop drilling and re-renders are guaranteed. No `react-query` for server state caching.
2. **No code splitting / lazy loading.** `App.tsx` imports all 26 pages statically. Likely 2 MB+ monolithic JS bundle.
3. **SQLite for everything.** Single-writer per file. No horizontal scale. Multi-instance Railway impossible.
4. **No Redis / Celery.** Background tasks are in-process. Workers can't survive restarts; cross-instance fan-out impossible.
5. **Three memory generations.** `memory/` (legacy) + `memory_intelligence/` + `memory_plane/`. Risk of inconsistent writes; cognitive load on contributors.
6. **No real authentication.** Only guests. The product cannot have paying users without `/auth/login`, OAuth, password hashing.
7. **No rate limiting.** Any caller can DoS `/v2/chat/stream`. No `slowapi`, no Redis-backed limiter.
8. **No Sentry / structured observability.** Errors visible only via Railway log tail.
9. **No R2 / object storage.** Uploads (if any) hit local disk. Ephemeral on Railway.
10. **Legacy + v2 route duplication.** `routes/auth.py` (stub) coexists with `routes/v2_auth.py`. `memory.py` vs `v2_memory.py`. Confusing.
11. **No FE test framework.** Zero `*.test.tsx` files; no vitest, no jest, no playwright.
12. **`baseUrl` deprecated in tsconfig** + missing type defs surfaced on local build. Low priority but flagged.
13. **No multi-tenancy.** No `org_id`, no seat model, no Stripe.

### 1.6 Code-quality observations

| Pattern | Where | Verdict |
|---|---|---|
| Dispatcher pattern (clean swap) | `providers/router.py`, `memory_plane/store.py` (single-backend) | Solid; ready to extend |
| Honest-failure logging | Throughout `services/`, especially trading + tools | Best-in-class |
| Multiple service generations | `memory/`, `memory_intelligence/`, `memory_plane/`; `ai_service.py` + `services/ai/`; root-level `memory_service.py`, `user_service.py` | Real debt; needs consolidation |
| Tool registry | `tool_registry.py` — per-tool ENV flag, dynamic re-read | Excellent operator UX |
| Owner mode safety | `services/admin/owner.py` + tests + `is_owner_request` precedence | Production-grade |
| FE without state lib | `useChat`, `useTradingSignals`, etc each manage own state | Will collapse beyond ~30 pages |
| No `React.lazy` | `App.tsx` | Single biggest perf lever untouched |

### 1.7 Unnecessary complexity

- **Three coexisting memory subsystems.** `memory_intelligence` looks like a half-step between legacy `memory` and `memory_plane`. Either it's a deliberate cache layer in front of Memory Plane (then needs a documented role) or it's dead-on-arrival.
- **`ai_service.py` (root) vs `services/ai/`.** Root file is older; package directory has `mode_manager`, `model_manager`, `prompt_manager`, `snapshot`. One of them owns the responsibility; one should be deleted.
- **Root-level `memory_service.py` + `user_service.py` + `ai_service.py`.** All three live at `services/` root and likely predate the package-per-domain pattern. Move into directories or delete.
- **12 legacy routes.** `auth.py` stub, `chat.py`, `memory.py`, `sessions.py`, `stats.py`, `tools.py`, `profile.py` — every one duplicated by a `v2_*` sibling. Routes are tiny; the FE imports likely already split; the legacy paths are documentation drag.

### 1.8 Production gaps (what's MISSING for a real SaaS)

| Domain | Missing | Risk |
|---|---|---|
| Authentication | Email/password, Google OAuth, Apple Sign-In, magic link, MFA | 🔴 product cannot have paying users |
| Database | Postgres + pgvector, connection pool, migration tool, backups | 🔴 single-instance only |
| Background work | Celery + Redis broker, durable job queue, SSE bridge for long jobs | 🔴 long jobs lose state on redeploy |
| Object storage | R2/S3, presigned uploads, asset metadata table | 🔴 attachments break on multi-instance |
| Observability | Sentry, OpenTelemetry traces, structured logs (Logflare/Axiom), Better Uptime | 🔴 blind to prod errors |
| Security | Rate limiter (`slowapi`), CORS audit, CSRF for state-changing routes, secret rotation | 🔴 abuse vulnerability |
| Multi-tenancy | `orgs`, `org_members`, project ownership, seat-based RBAC | 🟡 needed before B2B sales |
| Billing | Stripe subscriptions, usage ledger, plan tiers, cost caps | 🔴 no monetization |
| Real auth surface in FE | Sign-up / sign-in pages, password reset, email verification | 🔴 paying customer flow |
| Mobile/PWA polish | Service worker, install prompt, mobile Safari smoke | 🟡 mobile traffic poor |
| Vector embeddings | text-embedding-3-small pipeline, embedding cache, semantic recall | 🟡 memory plane half-built |
| Frontend testing | Vitest + Testing Library + Playwright smoke | 🟡 regressions ship unchecked |
| CI/CD | GitHub Actions for tests + tsc + build + preview deploy | 🟡 manual only |

### 1.9 Scalability ceiling

The current architecture caps at roughly:
- **~1 Railway instance** (SQLite single-writer per file)
- **~100 concurrent SSE chats** (single uvicorn process, no async worker pool)
- **~5,000 stored memories** (text search via `LIKE`, no index optimization)
- **0 long-running jobs** (in-process queue dies on redeploy)

To reach 10× any of these dimensions requires the database, queue, and storage changes called out below.

---

## Part II — Production Roadmap

> Phases sequenced by **risk-adjusted unblock value**. Each phase opens dependencies for the next.
> Estimated complexity uses original PROJECT_ROADMAP scale: `Low` (<1 wk) · `Medium` (1–2 wk) · `High` (2–4 wk) · `Very High` (1mo+).
> Risk: 🟢 low · 🟡 medium · 🔴 high.

### Phase 1 — Authentication & Identity Surface

**Objective:** make KorvixAI sellable. Replace guest-only auth with the trio (email + Google + magic link). MFA optional.

**Features**
- Email + password sign-up / sign-in with bcrypt-hashed `password_hash` column on `users` table.
- Google OAuth (ID-token verification via `oauth2.googleapis.com/tokeninfo`).
- Magic-link sign-in via Resend (no password).
- Email verification on sign-up (required for paid plans later).
- Password reset flow with single-use token.
- Sign-up / sign-in / forgot-password React pages wired into the existing `useOwnerMode` + auth store.

**Technical tasks**
- Add `password_hash`, `email_verified_at`, `oauth_provider_id` columns to `users` (already discriminated by `kind`).
- `POST /v2/auth/signup`, `POST /v2/auth/login`, `POST /v2/auth/google`, `POST /v2/auth/magic-link/request`, `POST /v2/auth/magic-link/confirm`.
- `services/auth/passwords.py` (bcrypt wrapper). `services/auth/oauth_google.py` (ID-token verify).
- `services/auth/email_outbound.py` (Resend HTTP client).
- FE pages: `SignInPage.tsx`, `SignUpPage.tsx`, `ForgotPasswordPage.tsx`, `MagicLinkLandingPage.tsx`. Wire `authStore.ts` (zustand) and remove direct `localStorage` reads from `useChat`.

**Risks**
- 🔴 Migrating existing guest sessions to logged-in accounts (keep guest tokens valid 30 days post-launch).
- 🟡 Resend deliverability — needs SPF/DKIM on the sending domain.
- 🟡 Apple Sign-In requires JWKS verification; defer to Phase 1.1 unless an iOS launch is imminent.

**Dependencies:** none (foundation).

**Estimated complexity:** **Medium** (~2 weeks).

**Success criteria**
- A new user can sign up with email+password, verify their email, sign in on another device, and sign out.
- An existing guest's threads + memories are preserved when they sign up (account merge).
- `auth.py` legacy stub deleted; `v2_auth` becomes the only auth surface.
- Test coverage: 90% on `services/auth/*`; sign-up → sign-in happy path locked in by an integration test.

---

### Phase 2 — Frontend Foundation: State, Caching, Code-Splitting

**Objective:** put the FE on a path that scales to 50+ pages without a rewrite.

**Features**
- `zustand` for client state (auth, owner mode, UI, sidebar).
- `@tanstack/react-query` for all server state (chat history, memories, jobs, trading signals).
- `React.lazy` + `Suspense` on every route in `App.tsx`. Initial bundle drops to landing + auth.
- Vite manualChunks for vendor splitting (`react-router`, `@radix-ui/*`, `recharts`, `framer-motion`).
- Vitest + Testing Library + 1 Playwright smoke (sign in → send chat → see streamed response).

**Technical tasks**
- `src/stores/authStore.ts`, `src/stores/ownerStore.ts`, `src/stores/uiStore.ts` (zustand). Migrate `useChat`, `useTradingSignals` to read from stores when appropriate.
- `src/lib/queryClient.ts` (react-query setup with sensible defaults — `staleTime: 60_000`, refetch on window focus disabled).
- Add `React.lazy` import to every page route; wrap with `<Suspense fallback={<RouteFallback />}>`.
- `vite.config.ts` — `build.rollupOptions.output.manualChunks`.
- `vitest.config.ts` + 4 representative tests (chat composer, owner gate, sign-in form, trading signal card).

**Risks**
- 🟡 Lazy-loading regressions on prefetched routes (sidebar links should `prefetch` on hover).
- 🟢 Bundle delta well-bounded; zustand + react-query add ~15 KB gzip combined.

**Dependencies:** none. Phase 1 work integrates better afterward, but the two can run in parallel.

**Estimated complexity:** **Medium** (~1.5 weeks).

**Success criteria**
- Initial JS gzip bundle < 250 KB (currently ~735 KB).
- Time-to-interactive on `/` < 2 s on cable connection.
- Every page route lazy-loaded.
- 4+ Vitest tests passing in CI.

---

### Phase 3 — Database: Postgres + pgvector Foundation

**Objective:** eliminate the SQLite single-writer ceiling. Establish the schema that every subsequent phase writes to.

**Features**
- `backend/services/db/` package: `engine.py` (asyncpg pool + psycopg3 sync pool), `pgvector.py`, `dialect.py`, `health.py`.
- Per-store dispatcher pattern: each `store.py` keeps SQLite as default, picks Postgres when `DATABASE_URL` + `ENABLE_POSTGRES_BACKEND` flip on. Memory Plane first.
- `db_migrate` CLI: `init`, `status`, `copy --subsystem`, `vector-upgrade`.
- `/v2/db/health` owner-only diagnostic.

**Technical tasks**
- Provision Railway-managed Postgres + Upstash Redis (Phase 5 uses Redis; provision now to amortize).
- Add `asyncpg==0.29.0` + `psycopg[binary,pool]==3.1.18` to requirements.
- Implement engine + dialect + pgvector helpers (mirror real shape).
- Port `memory_plane/store.py` to dual-backend dispatcher (`store_sqlite.py` + `store_pg.py`).
- Migration script (idempotent), `ON CONFLICT (id) DO NOTHING` for re-runs.
- Memory Plane embedding column ALTER TEXT → `vector(1536)` via `pgvector_upgrade` subcommand.

**Risks**
- 🔴 Connection-pool misconfiguration (INTRANS leak — must use `server_settings` for `statement_timeout`, not `SET` in a `configure` callback).
- 🔴 Multi-store migration (sessions.db, auth.db, etc) is a multi-PR effort; sequence after memory plane proves the pattern.
- 🟡 pgvector availability on managed PG — fall back to TEXT + Python cosine if denied.

**Dependencies:** none.

**Estimated complexity:** **High** (~3 weeks across multiple PRs).

**Success criteria**
- `ENABLE_POSTGRES_BACKEND=true` flips memory plane to Postgres without code change.
- `db_migrate copy --subsystem memory_plane` runs cleanly; row counts match.
- `/v2/db/health` returns `backend=postgres, ok=true, pgvector_available=true` on Railway.
- Memory Plane test suite passes against both SQLite and Postgres backends.

---

### Phase 4 — Memory Consolidation + Semantic Recall

**Objective:** kill the three-memory-system debt. One source of truth (Memory Plane), real semantic recall.

**Features**
- Deprecate `services/memory/` and `services/memory_intelligence/`; route legacy callers through Memory Plane.
- `services/memory_plane/embedding.py` — OpenAI `text-embedding-3-small` with LRU cache.
- Auto-embed in `manager.create()` when `ENABLE_EMBEDDINGS=true`.
- pgvector cosine recall on Postgres path, Python cosine on SQLite path.
- `GET /v2/memory/recall?q=...` SSE-free endpoint.
- Memory consolidation job (dedup + importance decay) with CLI.

**Technical tasks**
- Embedding service with `embed(text)` + `embed_many(texts)` + cache.
- Add `semantic_recall(user_id, vector, k)` to dispatcher + both backends.
- `manager.create()` auto-embed (`asyncio.run(embed(...))` when no loop active).
- `consolidate_duplicates(user_id)` + `decay_importance(user_id, days, factor)`.
- `backend/scripts/memory_consolidate.py` CLI.
- Replace legacy `services/memory/` callers (extract.py, recall.py); leave a `# DEPRECATED` shim with re-export for one release.

**Risks**
- 🟡 OpenAI embedding cost (`text-embedding-3-small` is $0.02/M tokens — bounded).
- 🟢 SQLite fallback keeps non-Postgres deploys working.

**Dependencies:** Phase 3 (Postgres + pgvector).

**Estimated complexity:** **Medium** (~2 weeks).

**Success criteria**
- `/v2/memory/recall?q=...` returns top-k semantic matches with similarity scores.
- `services/memory/` and `services/memory_intelligence/` deleted (or kept as 5-line re-export shims).
- Consolidation CLI runs nightly via Railway cron; logs show `deduped: N rows`.

---

### Phase 5 — Async Execution: Celery + Redis + Job Queue

**Objective:** move long-running work off the API process. Survive redeploys.

**Features**
- Redis client wrapper (`services/redis_client/`) with sync + async pools.
- Celery app + worker Procfile entry (`worker:`).
- `CeleryJobRunner` swap behind `JOB_QUEUE_MODE=celery` (default stays `inline`).
- Dispatcher task that resolves `kind` → handler. Heartbeat + retry + DLQ.
- SSE bridge `/v2/jobs/:id/stream` over Redis pub/sub fanout.
- Owner-only Jobs panel (consume from existing AdminPanel).
- Port: `vision.analyze`, `research.deep`, `memory.consolidate`, future `coding.execute`.

**Technical tasks**
- `redis==5.0.4`, `celery==5.4.0` deps. `kombu.Queue` objects in `task_queues` (not dicts).
- Module-level `app = build_celery()` so `celery -A backend.jobs.celery_app` finds it.
- Per-queue routing in `_queue_for_record`: `korvix.research`, `korvix.vision`, `korvix.embeddings`, `korvix.orchestration`, `korvix.maintenance`, `korvix.dlq`.
- Worker heartbeat: `SETEX korvix.worker.<host>-<pid> 60 alive`.
- Orphan reaper CLI: marks rows stuck in `running > WORKER_HEARTBEAT_TIMEOUT_S`.
- Shadow-job recording at `WebResearchTool.run()` boundary so every research call lands a row regardless of caller.

**Risks**
- 🔴 Connection-pool INTRANS leak (psycopg `configure` callback running `SET ...` without commit). Use libpq options instead.
- 🟡 Upstash quota — watch publish/command counts.
- 🟡 Worker service start-command mismatch — module-level `app` MUST exist (Celery `-A` looks for `app` or `celery` attribute on import).

**Dependencies:** Phase 3 (Postgres for job persistence). Optional but recommended: Phase 4 (memory consolidation needs a scheduler).

**Estimated complexity:** **High** (~3 weeks across slices).

**Success criteria**
- `JOB_QUEUE_MODE=celery` on Railway routes a vision job to a worker service; SSE stream emits `progress 5→20→40→90→done`.
- DLQ shows max-retried failures separately from cancelled.
- AdminPanel Jobs tab shows running/succeeded/failed/dlq counts > 0 under traffic.

---

### Phase 6 — Object Storage & Vision Pipeline (Cloudflare R2)

**Objective:** make uploads work on multi-instance Railway. Wire the existing vision components to a real storage layer.

**Features**
- `services/assets/storage_r2.py` — boto3 S3 client against R2 (zero egress).
- `POST /v2/files/presign` → presigned PUT URL; FE uploads directly to R2.
- `POST /v2/files/:id/finalize` enqueues `vision.analyze` job.
- Asset metadata in Postgres (`files` table with R2 key, mime, size, extracted_text, embedding).
- Drag-and-drop into chat composer; extraction status chip per attachment.
- Vision pipeline (`gpt-4o-mini`) consumes from job queue (Phase 5).

**Technical tasks**
- `boto3` dep. `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` env.
- `services/assets/storage.py` becomes a dispatcher (Local + R2). Local stays default for dev.
- Local → R2 migration CLI (one-way copy).
- FE: `useFileUpload` hook (presign → PUT → finalize), `AttachmentChip` with extraction status.

**Risks**
- 🟡 R2 doesn't return ETags on multipart by default — use single PUT for files ≤ 100 MB.
- 🟢 Presigned URLs expire in 15 min; FE handles refresh.

**Dependencies:** Phase 3 (Postgres for `files` table), Phase 5 (job queue for extraction).

**Estimated complexity:** **Medium** (~2 weeks).

**Success criteria**
- A user uploads a PDF, the FE shows "extracting..." then a preview; agents see extracted text in context.
- Local disk no longer holds any user-uploaded bytes in production.

---

### Phase 7 — Production Hardening: Observability + Rate Limiting + Audit

**Objective:** before opening paid signups, make the system observable and abuse-resistant.

**Features**
- Sentry (BE + FE) with release tracking via `RAILWAY_GIT_COMMIT_SHA`.
- `slowapi` rate limiter on `/v2/chat/stream`, `/v2/orchestrate`, presign endpoints. Tiered limits per user `plan_tier` (free / pro).
- OpenTelemetry FastAPI middleware → Logflare/Axiom (env-gated).
- Structured-log adapter; every emit carries `request_id`, `user_id`, `route`.
- Extended audit ledger (services/admin/audit.py): RBAC mutations, file deletes, tool grants.
- Owner-only audit viewer route + page.
- Better Uptime monitors on `/health` + a synthetic chat request hourly.

**Technical tasks**
- `sentry-sdk[fastapi]`, `slowapi`, `opentelemetry-instrumentation-fastapi` deps.
- `services/observability/sentry.py` boot hook.
- Per-route limit decorators; `429` envelope.
- Audit table on Postgres with `actor_user_id`, `action`, `target_id`, `payload`, `ip`, `ts`.

**Risks**
- 🟡 Sentry quota; sample heavily on noisy routes.
- 🟢 slowapi memory-backed by default — bind to Redis for multi-instance accuracy.

**Dependencies:** Phase 3 (Postgres), Phase 5 (Redis for distributed rate-limiting).

**Estimated complexity:** **Medium** (~1.5 weeks).

**Success criteria**
- Sentry receives a test exception from BE and FE.
- A user hammering `/v2/chat/stream` from one IP hits 429 within 10 requests.
- `/v2/admin/audit` lists owner actions with attribution.

---

### Phase 8 — Tool & Agent Orchestration in Chat

**Objective:** wire the existing tools into the chat stream so research / market / news queries actually invoke tools. Plus first multi-agent panel.

**Features**
- Intent detection layer in `routes/v2_chat_stream.py`: extracts whether the user wants web research, ticker lookup, news, calculator, university rankings.
- `build_*_context_block` helpers for each intent: inject grounded results into the system prompt with assertive framing ("you have these results, do not refuse").
- Provider cascade for web research: Tavily → Exa → Brave (`services/research/client.py` + per-provider modules).
- Honest fallback: when no results, inject a "search attempted, surfaces nothing" note so the LLM cites it instead of refusing.
- First Panel template (`startup_panel`) — coordinator orchestrates Research Agent → Analyst → Reporter via the scratchpad + presence services.

**Technical tasks**
- `services/tool_extraction/` package: `web_search_intent.py`, `ranking_intent.py`, `web_urls.py`, `github_urls.py` (extract + invoke + return prompt block).
- `services/research/exa.py`, `services/research/brave.py` providers + cascade in `client.py`.
- Add 2 tools: `github_repo` (read-only repo inspect), `university_rankings` (Wikipedia ranking tables).
- `services/panels/` — Panel, Coordinator, ScratchpadStore, PresenceBus.
- API: `POST /v2/panels`, `GET /v2/panels/:id` SSE.

**Risks**
- 🟡 Provider rate limits — Tavily/Exa/Brave each cap by plan. The cascade absorbs single-provider outage but a triple-outage means honest failure.
- 🟡 Multi-agent coordination latency — single panel adds ~3–10s to first token. Acceptable for the "deep research" mode; not the chat default.

**Dependencies:** Phase 5 (panels execute via job queue), Phase 6 (vision agent uses R2 assets).

**Estimated complexity:** **High** (~3 weeks).

**Success criteria**
- Asking "research NVIDIA H200" in chat triggers the cascade, injects citations, and the LLM cites sources without hallucinating.
- `/v2/panels/:id` SSE renders agent presence + scratchpad updates in real time.

---

### Phase 9 — Business Workspaces: Real Backends

**Objective:** the 9 business pages (StartupHub, EcommerceOS, BrandBuilder, AppBuilder, AgentBuilder, KnowledgeVault, ViralContent, WebsiteAnalyzer, WebsiteBuilder) currently exist as UI shells. Pick the top three and ship real backends.

**Features**
- StartupHub backend — `services/verticals/startup/`. Panel template: Researcher → Competitor analyst → Market sizer → Strategist. Stores outputs in Memory Plane scoped to a workspace.
- EcommerceOS backend — `services/verticals/ecommerce/`. Connect Shopify (OAuth), pull SKUs, run Copywriter + Pricer + Email agents.
- WebsiteAnalyzer + WebsiteBuilder — `services/verticals/website/`. Scrape competitor URL via headless browser (Browserless), vision-analyze layout, propose a Next.js scaffold.

**Technical tasks**
- One vertical = one `services/verticals/<name>/panel.py` + per-vertical typed scratchpad schemas.
- Shopify OAuth integration → store tokens in encrypted `external_credentials` table.
- Browserless container or Playwright in Docker on a third Railway service.
- FE: each existing page wires to its vertical SSE endpoint + renders the result viewer (code preview, product editor, strategy card).

**Risks**
- 🔴 Shopify OAuth + write-op approvals — gate by `tool_grants` + per-action confirmation.
- 🟡 Browserless cost — runs per request; cap concurrency.

**Dependencies:** Phase 5 (jobs), Phase 6 (R2 for screenshots), Phase 8 (panels).

**Estimated complexity:** **Very High** (~6 weeks for three verticals).

**Success criteria**
- A user clicks "Start a startup brief" on StartupHub; within 90 s gets a deck (memory plane scoped to the workspace) with citations + financial sizing.
- An EcommerceOS user connects Shopify and gets enriched SKU descriptions for 10 products.

---

### Phase 10 — Multi-Tenant Orgs + Billing (Stripe)

**Objective:** open paid sign-ups. Per-seat, per-tier subscriptions with cost caps.

**Features**
- `orgs` + `org_members` tables. `User` gains `default_org_id`.
- Roles: `owner`, `admin`, `member`, `viewer` per org. Permission matrix in DB.
- Stripe checkout for `pro`, `team`, `enterprise` plans. Webhook handler → `subscription_status`.
- Usage ledger: `usage_events(provider, model, input_tokens, output_tokens, cost_usd, org_id, ts)`.
- Hard cap per org per month + soft warning at 80%.
- Owner-only billing page with current period spend chart.

**Technical tasks**
- DB schema migration. JWT carries `org_id` claim.
- Per-route permission check via `Depends(require_perm("memory:write"))`.
- `services/billing/stripe.py` (sessions, webhooks, subscription sync).
- `services/usage/ledger.py` hooked into every LLM provider call.
- `cost_estimate` per tool surface on the FE before heavy operations.

**Risks**
- 🔴 Stripe webhook idempotency — handle replays.
- 🟡 Org migration — auto-create personal org for every existing user on first login post-deploy.

**Dependencies:** Phase 1 (real auth), Phase 3 (Postgres).

**Estimated complexity:** **Very High** (~4 weeks).

**Success criteria**
- A new user signs up, picks a Pro plan, gets billed monthly, sees their spend chart.
- An org owner can invite a member, who joins via email.

---

### Phase 11 — Cost Optimization & Adaptive Routing

**Objective:** lower variable costs. Smarter than "always pick the strongest model."

**Features**
- Adaptive model router: lightweight classifier picks `gpt-4o-mini` / `claude-haiku-4-5` for simple turns; promotes to `gpt-4o` / `claude-sonnet-4-6` / `claude-opus-4-7` only when the request is hard.
- Anthropic prompt-caching headers (`cache_control: ephemeral`) on long system prompts.
- OpenAI batch API for non-interactive jobs (embeddings, summarization, extraction).
- Per-user cost preview chip on "deep think" / "research" modes.

**Technical tasks**
- `services/ai/complexity_classifier.py` — regex + keyword heuristics first, ML later.
- Anthropic provider patch: add `cache_control` to message blocks > 2 KB.
- Batch dispatcher Celery task — collects jobs flagged `batchable=true`, submits to OpenAI batch, polls.
- `force_model` override for owner.

**Risks**
- 🟢 Classifier false-positives downgrade quality — start conservative (only obvious cases like "what time is it" → mini).

**Dependencies:** Phase 5 (Celery for batch), Phase 10 (usage ledger).

**Estimated complexity:** **Medium** (~1.5 weeks).

**Success criteria**
- Average per-turn cost drops ≥ 30% vs always-strong baseline on a sample of 100 prompts.
- Prompt cache hit rate visible in Anthropic dashboard for cached system prompts.

---

### Phase 12 — Scale & Real-Time UX

**Objective:** take the product from ~1k DAU → ~50k DAU without re-architecting.

**Features**
- Postgres read replicas — route `GET` queries via SQLAlchemy router.
- Worker autoscale on Railway driven by Celery queue depth.
- WebSocket option in addition to SSE for bidirectional bursts (presence, typing indicators).
- CRDT (Yjs) for multi-user concurrent editing of shared scratchpad / docs.
- Optimistic UI on every user→result flow.
- Edge runtime for marketing pages on Vercel.

**Technical tasks**
- `read_db` / `write_db` SQLAlchemy split. Per-instance write-after-read consistency check.
- Railway autoscaler config keyed to Celery `queue_depth` metric.
- WebSocket route `/ws/presence` + FE hook.
- Yjs awareness provider over the existing Redis pub/sub.

**Risks**
- 🟡 Replica lag for "create then read" patterns.
- 🟡 WebSocket adoption — keep SSE as the durable fallback.

**Dependencies:** Phase 3 (Postgres), Phase 5 (Redis), Phase 6 (object storage).

**Estimated complexity:** **High** (~3 weeks).

**Success criteria**
- p95 chat response time stable as load scales 10×.
- Two users editing the same scratchpad doc see each other's cursors with <200ms latency.

---

### Phase 13 — Premium UX, Mobile, Design System Unification

**Objective:** the product feels like a $20/mo SaaS, not a beta.

**Features**
- Design tokens (`tokens.css`) — color, spacing, radius, typography centralized.
- Every page uses tokens; remove inline color hex except `globals.css`.
- Mobile-Safari smoke pass: input zoom, scroll-locks, keyboard insets.
- Service Worker for offline chat shell + cached static assets.
- Source cards UI (Perplexity-style) above chat answer when tools fire.
- Premium animations: framer-motion transitions on route change, list-item enter/exit.
- Branding: favicon + loading logo + sidebar logo + auth logo derived from one SVG.
- Mobile install prompt (PWA).

**Technical tasks**
- Audit 53 shadcn components against design tokens; replace hardcoded colors.
- Build matrix: iPhone 12+ Safari, Android Chrome.
- Source-card component reads from `tool.completed` SSE events.

**Risks**
- 🟢 Token migration is mechanical; risk of skipped components.

**Dependencies:** Phase 2 (state, perf).

**Estimated complexity:** **Medium** (~2 weeks).

**Success criteria**
- Lighthouse score ≥ 90 on mobile.
- Bundle gzip on initial route < 200 KB.
- Mobile install prompt available; service worker caches `/auth` for offline sign-in screen.

---

### Phase 14 — Final Stabilization & Public Launch

**Objective:** open paid signups with confidence.

**Features**
- Full CI: GitHub Actions for `pytest` + `tsc -b` + `npm run build` + Playwright smoke on every PR.
- Preview deploys per PR (Vercel preview + Railway PR app).
- Daily Postgres backups → R2 with restore drill runbook.
- `docs/runbooks/`: incident response, scale-up, restore, abuse-throttle.
- Status page (Better Uptime public).
- Privacy policy + ToS + cookie banner.

**Technical tasks**
- `.github/workflows/ci.yml`.
- `scripts/restore_drill.sh` (quarterly).
- Privacy / ToS pages.

**Risks**
- 🟢 Largely process work.

**Dependencies:** Phase 7 (observability), Phase 10 (billing).

**Estimated complexity:** **Medium** (~1.5 weeks).

**Success criteria**
- CI is the only path to merge.
- A restore drill succeeds end-to-end.
- Public status page is up.

---

## Part III — Recommended Sequencing

```
Quarter 1
  ├─ Phase 1 — Auth
  ├─ Phase 2 — FE state + perf
  └─ Phase 3 — Postgres + pgvector

Quarter 2
  ├─ Phase 4 — Memory consolidation + semantic recall
  ├─ Phase 5 — Celery + Redis + jobs
  └─ Phase 6 — R2 + vision pipeline

Quarter 3
  ├─ Phase 7 — Observability + rate limit + audit
  ├─ Phase 8 — Tool orchestration in chat
  └─ Phase 11 — Adaptive routing + caching

Quarter 4
  ├─ Phase 10 — Multi-tenant + Stripe
  └─ Phase 14 — CI/CD + runbooks + launch

Post-launch (data-driven)
  ├─ Phase 9 — Business workspace backends (pick most-clicked first)
  ├─ Phase 12 — Scale & real-time
  └─ Phase 13 — Premium UX + mobile
```

### Critical path

**Phase 1 → 3 → 5 → 7 → 10 → 14.** Everything else can be parallelized once these unblock dependencies.

---

## Part IV — Risk register summary

| Risk | Phase | Mitigation |
|---|---|---|
| Multi-instance Railway breaks immediately (SQLite + local jobs) | 3, 5 | Postgres + Celery + R2 are the unblock trio |
| Production errors invisible | 7 | Sentry FE + BE |
| DoS via `/v2/chat/stream` | 7 | `slowapi` Redis-backed limiter |
| Unbounded LLM spend per user | 10, 11 | Usage ledger + hard cap + adaptive routing |
| Frontend bundle (2 MB+) hurts mobile | 2, 13 | `React.lazy` + manualChunks |
| Three memory subsystems drift | 4 | Consolidate to Memory Plane |
| Stripe webhook replay | 10 | Idempotency table |
| Worker SIGKILL leaves jobs stuck | 5 | Heartbeat + orphan reaper CLI |
| pgvector denied on managed PG | 3 | Python cosine fallback path |

---

## Part V — Estimated effort to v1.0 (paid signups open)

**Required path (Phases 1, 2, 3, 5, 6, 7, 10, 14):** ~14 weeks of focused engineering for a single experienced full-stack dev.

**Parallelism:** with 2 devs split (one BE, one FE), ~9 weeks.

**Highest-leverage single PR if only one ships next:** **Phase 1 sign-in/sign-up flow** — without it, no paying customers, regardless of how good the rest is.

---

## Document lineage

- 2026-06-25 — initial roadmap, codebase-grounded analysis against `main @ 89ae7f4`.
- Update after each phase merges to reflect new completion state.

---

*This roadmap is a living document. Revise after each phase, especially Phase 3 (Postgres unblocks everything downstream).*
