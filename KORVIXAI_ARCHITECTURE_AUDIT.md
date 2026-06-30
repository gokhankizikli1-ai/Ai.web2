# KorvixAI — Phase 0: Full Repository Architecture Audit & Technical Debt Analysis

**Author:** Architecture audit (Senior Staff / Platform / AI Systems review)
**Date:** 2026-06-30
**Scope:** Entire repository — backend (legacy root + `backend/` v3 package), frontend (`src/`), services, routes, stores, runtime, workflows, agents, verticals, memory, auth, jobs, events, config, tests, docs.
**Method:** Read-before-change. Source inspected directly + fanned-out parallel deep reads of every backend service package and route module, corroborated against the repo's own (unusually candid) design docs. No production behaviour was changed except one isolated, low-risk bug fix (see §10).

> **One-line verdict:** KorvixAI is a **genuinely large, well-engineered codebase** whose **advanced subsystems are real but almost entirely dormant behind default-OFF feature flags**. What actually runs in production today is a **single-provider (OpenAI) chat endpoint + flag-gated trading signals + SQLite memory**. The gap between the *built* surface area and the *live* surface area is the single most important fact about this repository.

---

## Table of Contents
1. [Complete Architecture Map](#1-complete-architecture-map)
2. [Backend Analysis](#2-backend-analysis)
3. [Frontend Analysis](#3-frontend-analysis)
4. [Mock / Fake Systems Report](#4-mock--fake-systems-report)
5. [Technical Debt Report](#5-technical-debt-report)
6. [Security Report](#6-security-report)
7. [Performance Report](#7-performance-report)
8. [Testing Report](#8-testing-report)
9. [Roadmap Alignment Report](#9-roadmap-alignment-report)
10. [Immediate Fixes Applied](#10-immediate-fixes-applied)
11. [Recommended Refactor Order](#11-recommended-refactor-order)
12. [Recommended Next Sprint](#12-recommended-next-sprint)

---

## 1. Complete Architecture Map

### 1.1 Deployment topology
- **Frontend:** React 19 + Vite 7 + TailwindCSS + Framer Motion + Zustand + react-router 7. Hosted on **Vercel**. Domain `korvixai.com`. shadcn/ui primitives (`src/components/ui/*`).
- **Backend:** **FastAPI** on **Railway**, single host `worker-production-1345.up.railway.app`. Entry chain: `api.py` (repo root) → `backend/api.py` `_build_full_app()` with a **3-layer ASGI fallback** (full app → `/health`-only → bare ASGI). `backend/main.py` re-exports the same app.
- **Worker:** Celery worker process defined in `Procfile` (`backend/jobs/celery_app.py`) — **only runs if Redis is provisioned**; default deploy runs API only.
- **LLM:** OpenAI primary (`gpt-4o-mini` fast / `gpt-4o` strong). Anthropic + Gemini providers are fully implemented but **dormant** (no API key / not on default route).
- **Data:** **SQLite files in the container working directory** by default (`memory.db`, `auth.db`, `jobs.db`, `projects.db`, `workflows.db`, `panels.db`, `assets.db`, `vision.db`, `agent_tasks.db`, `agent_messages.db`, `memory_plane.db`). Postgres/pgvector and Redis exist as code paths but are **opt-in**.

### 1.2 The two-layer backend (critical structural fact)
There are **two coexisting backends** in one repo:

| Layer | Files | Role | Status |
|---|---|---|---|
| **Legacy root** | `agent.py`, `ai_client.py`, `ai_router.py`, `ecommerce.py`, `finance.py`, `data_sources.py`, `memory.py`, `prompts.py`, `usage_limits.py`, `db.py`, `config.py` | The **actual live chat brain** | In active use — `backend/services/ai_service.py` imports `agent`, `ai_router`, `ecommerce`, `finance`; root `memory.py` is the default memory path |
| **Modern `backend/` v3** | `backend/services/**`, `backend/routes/**`, `backend/core/**`, `backend/jobs/**` | The AI-OS platform (orchestrator, workflows, jobs, memory plane, agents, verticals) | Mostly **flag-gated OFF**; wraps and re-exposes the legacy brain |
| **Dead** | `ai.py` (no importers), `bot.py` (Velora-branded Telegram adapter, no importers) | — | Dead / optional |

### 1.3 Frontend route map (`src/App.tsx`)
- **Public/marketing:** `/`, `/features`, `/use-cases`, `/pricing`, `/about` (+ `/blog`, `/careers`, `/privacy`, `/terms` → `ComingSoon`).
- **Core app (guest-allowed):** `/chat` (real), `/home`, `/projects`, `/projects/:id` (real), `/agents`, `/agents/:id`, `/agents/builder`.
- **Tools (all guest-allowed, mostly static):** `/tools/{startup,ecommerce,website-analyzer,website-builder,app-builder,brand-builder,viral-content,knowledge-vault,automations,swarm}`.
- **Auth/settings/credits:** `/login`, `/signup`, `/settings`, `/credits`.
- Note: several legacy routes (`/startup`, `/ecommerce`, `/trading`) **redirect into `/chat?tab=…`** — the verticals are conceptually chat tabs, not standalone apps.

### 1.4 Backend module map with maturity

**Execution / Orchestration core** (`backend/services/`)
| Module | Status | Live? (default) |
|---|---|---|
| `agent/` (runtime, delegate, tool_bridge, specs, budget, model_routing) | Functional→Mostly Complete | Behind `ENABLE_AGENT`/orchestrator flags |
| `orchestrator/` (service, runs/tasks/deliverables stores, templates, agent_run_kind) | **Production Ready** (Phase A.2) | `ENABLE_PROJECT_ORCHESTRATOR=false` |
| `workflows/` (DAG runner, steps, store) | **Production Ready** | `ENABLE_WORKFLOWS`/`ENABLE_WORKFLOW_RUNNER=false` |
| `jobs/` (manager, inline runner, store, registry, events, dlq, reaper, heartbeat) | Production Ready (inline) / Celery=stub | `ENABLE_JOB_QUEUE=false`; `JOB_QUEUE_MODE=inline` |
| `tasks/` (in-process async queue) | Production Ready | `ENABLE_BACKGROUND_TASKS=false` (in-memory; lost on restart) |
| `events/` (in-process pub/sub bus) | Production Ready | `ENABLE_REALTIME_EVENTS=false` (in-memory) |
| `coordinator/` (rule-based planner, **no LLM**) | Mostly Complete (preview-only) | `ENABLE_COORDINATOR=false` |
| `panels/`, `agent_tasks/`, `agent_messenger/`, `agent_presence/`, `scratchpad/` | Functional/Mostly Complete | Phase-9 coordination flags, all OFF |

**AI / Memory / Generation**
| Module | Status | Live? |
|---|---|---|
| `providers/` (openai, anthropic, gemini, registry, streaming) | Production Ready (registry/base); providers make **real SDK calls** | OpenAI live; Anthropic/Gemini dormant |
| `ai/` (mode_manager, model_manager, prompt_manager, snapshot) | Mostly Complete (OpenAI-centric config) | **Live** (drives chat) |
| `ai_service.py` + legacy `agent.py`/`ai_router.py` | Functional (legacy) | **Live** (the real chat pipeline) |
| `memory_plane/` (sqlite/pg stores, retriever, extractor, **real embeddings**, manager) | Mostly Complete→Production Ready | `ENABLE_MEMORY_PLANE=false` (dual-written when on) |
| `memory/` + root `memory.py` | Functional (legacy SQLite) | **Live default memory** |
| `memory_intelligence/` | Prototype (in-memory dict) | **Dead/unused** |
| `generation/` (engine, renderers, spec, intent, quality) | Functional (hybrid LLM + deterministic templates) | Live only via orchestrator path |
| `research/` (tavily/exa/brave + cascade) | Production Ready, **real HTTP** | Live via `web_research` tool (`ENABLE_TOOLS`) |
| `project_brain/`, `personality/` | Mostly Complete but **dormant** (never wired into chat prompt) | OFF |
| `vision/`, `website_recreation/` | Partial / Prototype — **no real vision-model call**; heuristic + metadata only | OFF |

**Domain verticals**
| Module | Status | Real data? |
|---|---|---|
| `trading/` (signals_service, intelligence, assets, thesis_memory) | Functional | **Real** — maps live `market_data_tool`, honest failure, **never fabricates prices** |
| `market_providers/` (Binance→Yahoo→AlphaVantage→CoinGecko, plus Finnhub/CoinGecko) | Production Ready | **Real** urllib calls; `make_unavailable()` instead of fake numbers |
| `tools/` (market_data_tool 2048 LOC, web_research, macro_data, calculator, news, registry) | Functional | Real |
| `ecommerce.py` / `finance.py` (root) | Functional (legacy prompt helpers) | Prompt scaffolding, not a real store integration |

**Platform**
| Module | Status |
|---|---|
| `auth/` (Argon2id, stdlib HS256 JWT, refresh rotation w/ theft detection) | Production Ready (crypto), roadmap gaps (rate limiting, email refresh) |
| `sessions/` (v2 auth-bound) vs legacy `/sessions` | v2 Production Ready; legacy unsecured |
| `core/` (config, deps, middleware, errors, responses) | Production Ready |
| `admin/` (owner mode, owner_agent, audit, safety) | Production Ready, `ENABLE_ADMIN_MODE=false` |
| `safety/guard.py` | Functional (per-user rate windows, in-memory) |

---

## 2. Backend Analysis

### 2.1 What actually runs in production today
Resolved from `backend/core/config.py` defaults + route gating:
- `POST /chat` — the legacy synchronous chat pipeline (`routes/chat.py` → `ai_service.py` → root `agent.py`/`ai_router.py` → OpenAI). Identity hardened (`_resolve_authoritative_uid`).
- `GET /health`, `/tools/health`, `/v2/health`, `/status` — diagnostics.
- `/trading/signals`, `/trading/health` — **only** when `ENABLE_TRADING_SIGNALS=true` + `ENABLE_TOOLS=true` + `ENABLE_MARKET_DATA=true`.
- `/market/quote` — only when `ENABLE_MARKET_QUOTE=true`.
- Legacy `/memory`, `/profile`, `/projects`, `/sessions`, `/stats` — mounted, mostly unauthenticated (see §6).
- `POST /v2/chat/stream` — SSE chat (opt-in via frontend `VITE_CHAT_STREAMING`).

**Everything else** (`/v2/orchestrate`, `/v2/orchestrator`, `/v2/jobs`, `/v2/workflows`, `/v2/memory`, `/v2/assets`, `/v2/panels`, `/v2/coordinator`, `/v2/agent`, `/v2/recreate`, `/v2/events`, `/v2/scratchpad`, `/v2/agents/*tasks*`) returns **503 / disabled** until its env flag is flipped on Railway.

### 2.2 Feature flag map (defaults from `backend/core/config.py`)
All default to **`false`** / OFF unless noted:
`ENABLE_MEMORY_PLANE`, `ENABLE_JOB_QUEUE` (mode `inline`), `ENABLE_ASSET_SYSTEM`, `ENABLE_VISION_PIPELINE`, `ENABLE_PROJECT_BRAIN`, `ENABLE_AGENT_ORCHESTRATION`, `ENABLE_WORKFLOWS`, `ENABLE_WORKFLOW_RUNNER`, `ENABLE_WEBSITE_RECREATION`, `ENABLE_ADMIN_MODE`, `ENABLE_REALTIME_EVENTS`, `ENABLE_BACKGROUND_TASKS`, `ENABLE_COORDINATOR`, `ENABLE_REAL_COORDINATION`, `ENABLE_AGENT_PRESENCE`, `ENABLE_SCRATCHPAD`, `ENABLE_PROJECTS`, `ENABLE_SESSIONS`, `ENABLE_PROJECT_ORCHESTRATOR`, `ENABLE_ORCHESTRATOR`, `ENABLE_LANDING_PAGE_TEMPLATE`, `ENABLE_EMBEDDINGS`, `ENABLE_POSTGRES_BACKEND`, `ENABLE_NEW_MEMORY`, `ENABLE_AUTH_V2`, `ENABLE_AUTH_MIDDLEWARE`, `ENABLE_REDIS`, `ENABLE_TRADING_SIGNALS`, `ENABLE_MARKET_DATA`, `ENABLE_MARKET_QUOTE`, `ENABLE_TOOLS`.
Models default: `MODEL_FAST=gpt-4o-mini`, `MODEL_STRONG=gpt-4o`, `MODEL_ANTHROPIC=claude-sonnet-4-6`, `MODEL_GEMINI=gemini-2.0-flash-exp`.

> **Implication:** The platform ships in a **safe-by-default, zero-blast-radius** posture. This is genuinely good engineering discipline — but it also means the "AI Operating System" is, in production, a chatbot. The orchestration spine is built and tested; it has simply never been turned on.

### 2.3 Persistence map (the #1 infrastructure risk)
- **Primary store = SQLite files written to the container working directory.** Default paths are relative (`memory.db`, `auth.db`, `jobs.db`, `projects.db`, …). On Railway's ephemeral filesystem, **these are wiped on every redeploy unless a persistent volume is mounted at the working dir.** No volume mount is declared in `railway.toml`/`nixpacks.toml`.
  - **Consequence:** user accounts (`auth.db`), chat memory (`memory.db`), jobs, projects, deliverables can vanish on deploy. This is acceptable for a demo, **unacceptable for the "production-online" claim** in `STABLE_CHECKPOINT.md`.
- **In-memory "stores" that vanish on restart** (process-local, not durable):
  - `services/tasks/queue.py` — background task queue (`asyncio.Queue`).
  - `services/events/bus.py` — realtime event bus.
  - `services/agent_presence/client.py` — presence registry (`_snapshot` dict; by design, durable record is the event stream).
  - `services/memory_intelligence/store.py` — `_STORE: Dict` (dead code anyway).
  - `services/memory/short_term.py` — rolling message window.
  - `services/market_providers/cache.py`, `services/trading/thesis_memory.py` — caches (fine).
  - `services/safety/guard.py` — `_USER_WINDOWS` rate-limit windows (resets on restart → rate limit is per-replica, per-deploy).
- **Module-level registries** (`_REGISTRY`/`_ROUTES` in providers, specs, jobs, templates) — fine; they're code registries, repopulated at import.

### 2.4 Subsystem deep-dive highlights
- **Orchestrator (Phase A.2):** Genuinely production-grade. `start_project_run()` scaffolds deliverables + task graph + a workflow DAG, then kicks the workflow runner, which dispatches `agent.run` job steps that call the **real** agent runtime (`run_agent`, pinned to `gpt-4o-mini`). Output is classified into typed artifacts (`artifacts.py`) and persisted to `deliverables_store`. **Not** templated/faked — but tool-calling is disabled on this path and task-graph dependencies are captured but **not enforced** (no parallel/dependency execution yet; `execution_graph.py` is read-only).
- **Workflows / Jobs:** Re-entrant, crash-safe (orphan sweep on startup), idempotent (SHA idempotency keys), SSE-observable. Job queue defaults to an **inline asyncio runner**; the **Celery backend is a stub that raises `NotImplementedError`** if `JOB_QUEUE_MODE=celery`.
- **Memory:** **Three overlapping subsystems.** Live default is legacy root `memory.py` (SQLite). `memory_plane/` (richer, real OpenAI embeddings behind `ENABLE_EMBEDDINGS`, SQLite or pgvector) is dual-written when `ENABLE_MEMORY_PLANE=true`. `memory_intelligence/` is **dead in-memory code** and should be deleted. Retriever ranking is **lexical token-overlap**, not semantic, despite framing.
- **Generation (website/app builder output):** **Hybrid.** The agent runtime produces HTML via a real LLM prompt (`generation.build_prompt`), then `finalize_artifact()` runs an internal quality check; **if the LLM output isn't "premium", it falls back to a deterministic, hand-coded HTML renderer** (`render_premium_page` → `renderers/{landing,dashboard,ecommerce,booking,editor,portfolio}.py`). So a meaningful fraction of "generated premium previews" are **deterministic templates**, not model output. Honest internally, but worth understanding: this is "demo-grade preview generation", not a robust code-gen pipeline.
- **Vision / Website Recreation:** **No real vision-model call anywhere.** Vision does real PDF/text extraction (`pypdf`) + image dimensions, but image *design/color/typography/layout* fields are never populated (honest placeholder). Website recreation therefore emits mostly **hardcoded defaults** (`_DEFAULT_SECTIONS`, `_DEFAULT_STACK`) plus a prompt string — it does **not** recreate websites.
- **Trading / Market data:** The most honest vertical. Real provider chain over urllib; on failure returns `is_live=false` + non-null `error`, **never fabricated numbers**. Binance may be geo-blocked from Railway → CoinGecko price-only fallback.
- **Research:** Production-grade, real HTTP to Tavily (primary)/Exa/Brave with a cascade + caching; the only "fake-ML" is the deterministic trust-score heuristic in `citations.py` (honestly labeled).
- **Coordinator / Personality / Project Brain:** Built and tested but **dormant** — none is wired into the live chat prompt. Coordinator is rule-based (no LLM), preview-only.

---

## 3. Frontend Analysis

The frontend is **visually far ahead of the backend** (the docs admit this). Quality of the React code is high; the gap is *wiring to real data*.

### 3.1 API wiring
- Single base URL resolution: `VITE_API_URL` → falls back to bundled `https://worker-production-1345.up.railway.app` (`src/hooks/useChat.ts`, mirrored in `src/stores/projectStore.ts`). Optional streaming via `VITE_CHAT_STREAMING`.
- **Only 6 pages call the backend:** `ChatDashboard`, `ProjectWorkspace`, `ProjectsDashboard`, `AgentsPage`, `AgentBuilder`, `AuthPage`.
- **15 pages are static / demo (no backend call):** `AboutPage`, `AgentMarketplace`, `AppBuilder`, `BrandBuilder`, `ComingSoon`, `CreditsPage`, `ExplorePage`, `FeaturesPage`, `HomeDashboard`, `LandingPage`, `MultiAgentSwarm`, `UseCasesPage`, `ViralContent`, `WebsiteAnalyzer`, `WebsiteBuilder`.

### 3.2 Page maturity
| Page | Status | Notes |
|---|---|---|
| `ChatDashboard` + `useChat` (1147 LOC) | **Real / Production** | Calls `/chat`; robust friendly-error mapper, 60s abort ceiling. Sessions are **local-only** (in-memory per tab). |
| `ProjectWorkspace` (1294 LOC) | Real but gated | Wires to `/v2/orchestrator/*` via `useProjectOrchestrator` + `ProjectRunPanel`; shows honest disabled state when flag off. **Refactor candidate** (oversized). |
| `ProjectsDashboard` | Real (+ `mockProjects` fallback) | Uses `projectStore` API; imports `src/data/mockProjects.ts` (420 LOC) as seed/empty-state. |
| `AuthPage` (1043 LOC) | Real (now wired) | Previously a `setTimeout` UI stub (per `AUTH_AUDIT_PHASE_1.md`); now calls auth backend. **Oversized → refactor.** |
| `AgentsPage` / `AgentBuilder` / `AgentChatPage` | Real/Prototype | Hit agent endpoints; `standaloneAgentStore`. |
| `WebsiteBuilder` / `AppBuilder` / `BrandBuilder` / `ViralContent` / `WebsiteAnalyzer` | **Prototype / Mock** | "Builder" UIs **not wired** to the generation backend — demo surfaces. |
| `CreditsPage` (994 LOC) | **Mock** | No real payment/credits backend. Static pricing/credit UI. |
| `StartupHub` / `EcommerceOS` | Functional bridges | Tool forms bundle a labelled prompt → navigate `/chat` with router state (no dedicated backend). |
| `MultiAgentSwarm`, `KnowledgeVault`, `Automations`, `ExplorePage`, `HomeDashboard`, marketing pages | Prototype/Static | Presentation only. |

### 3.3 Stores & hooks
- `authStore.ts` (626 LOC) — real: persisted session, `checkAuth()` validates JWT against `/auth/me`. Owner mode wiring.
- `projectStore.ts` — real API client.
- `standaloneAgentStore.ts`, `languageStore.ts` — local state.
- Hooks split cleanly: real-backend (`useChat`, `useProjectOrchestrator`, `useJob`/`useJobs`, `useOrchestrationFeed`, `useTradingSignals`, `useAssets`, `useToolExecution`, `useCoordinatorPlan`, `useAgentPresence`) vs UI-only (`useOnboarding`, `useCommandPalette`, `useStreamingText`). Most "live" hooks degrade gracefully to disabled states when their backend flag is off.

### 3.4 Oversized files (>500 LOC) — refactor candidates
`ProjectWorkspace.tsx` (1294), `useChat.ts` (1147), `TradingPanel.tsx` (1089), `AuthPage.tsx` (1043), `CreditsPage.tsx` (994), `EcommerceCommandCenter.tsx` (957), `AdminPanel.tsx` (942), `SettingsModal.tsx` (650), `authStore.ts` (626), `ChatDashboard.tsx` (522), `BusinessPanel.tsx` (519), `AgentBuilder.tsx` (548).

---

## 4. Mock / Fake Systems Report

> "Fake" here = pretends to do real work but doesn't. Note: the codebase is **unusually honest** — most placeholders are explicitly labeled and return honest "disabled"/metadata states rather than fabricating data.

| System | File(s) | Verdict | Evidence |
|---|---|---|---|
| **Vision analysis** | `services/vision/analyzer.py` | **Fake capability (honest placeholder)** | No vision-model call; `_call_vision_model` is documented-but-unimplemented. Image design/color/typography never populated. |
| **Website Recreation** | `services/website_recreation/client.py` | **Mostly hardcoded defaults** | `_DEFAULT_SECTIONS`/`_DEFAULT_STACK`; "does not recreate" — emits a plan + prompt string. |
| **Celery job backend** | `services/jobs/runner.py` `CeleryJobRunner` | **Stub** | Raises `NotImplementedError`; only inline runner is real. |
| **`memory_intelligence/`** | `store.py` (`_STORE = {}`), `extractor.py` | **Dead in-memory mock** | Process-local dict; no route imports it; superseded by `memory_plane`. |
| **Memory consolidation job** | `services/jobs/kinds.py` `memory_consolidation_stub` | **Stub** | Phase-8 placeholder, no-op. |
| **CreditsPage / payments** | `src/pages/CreditsPage.tsx` | **Mock UI** | No payment backend; static credit/pricing. |
| **Builder pages** | `WebsiteBuilder`, `AppBuilder`, `BrandBuilder`, `ViralContent`, `WebsiteAnalyzer` | **Prototype UIs** | Not wired to generation backend. |
| **`mockProjects.ts`** (420 LOC) | `src/data/mockProjects.ts` | **Sample data** | Seed/empty-state in `ProjectsDashboard`. |
| **`tradingAssets.ts`** (270 LOC), `placeholderChats.ts`, `promptLibrary.ts` | `src/data/*` | **Static reference/seed data** | `tradingAssets` = symbol catalog (legit); `placeholderChats` = demo. |
| **`profile.py` POST** | `routes/profile.py` | **No-op stub** | Ignores body, always returns `{"ok": True}`. |
| **`stats.py`** | `routes/stats.py` | **Hardcoded fallback** | Returns `{"messages": 0}` when import fails; dead `OWNER_ID`. |
| **Personality / Project Brain / Coordinator** | `personality/*`, `project_brain/*`, `coordinator/*` | **Built but dormant** | Never injected into live chat prompt; coordinator has no LLM (rule-based preview). |
| **Generation "premium" output** | `generation/engine.py` → `render_premium_page` | **Partly deterministic templates** | LLM output falls back to hand-coded renderers when "not premium". |
| **`FloatingParticles`, gauges** | `src/components/FloatingParticles.tsx` (7× `Math.random`) | **Cosmetic** (legit) | Decorative only — not fake data. |

Frontend `Math.random` audit: concentrated in `FloatingParticles` (cosmetic). Stray uses in `AuthPage`, `TradingPanel`, `ProjectsDashboard`, `AgentChatPage` are id/jitter/sparkline-fallback — **not** fabricated business metrics.

---

## 5. Technical Debt Report

### CRITICAL
1. **Ephemeral SQLite persistence on Railway.** Relative-path `.db` files in the container working dir with no declared volume → data loss on redeploy. Contradicts the "production online / users + memory" framing. *(Infra/data)*
2. **No persistent volume / Postgres for the live path.** The roadmap's Postgres+pgvector target is unbuilt for the primary store; only `memory_plane` has an opt-in PG adapter that needs a manual `ALTER` to activate pgvector.
3. **Unauthenticated legacy IDOR cluster** — `routes/memory.py`, `profile.py`, `projects.py`, `sessions.py`, `stats.py` accept `user_id`/resource ids from path/query/body with **no auth and no ownership check** (see §6). `memory.py` allows reading/writing/deleting **any** user's memory.
4. **`/v2/orchestrate` identity from request body** + unauthenticated `GET /runs*` read routes → user impersonation + cross-user run/task enumeration **if `ENABLE_ORCHESTRATOR=true`**.

### HIGH
5. **Triplicated memory subsystem** (legacy `memory.py` + `memory_plane` + dead `memory_intelligence`) with 3 regex extractors, 3 secret-redaction lists, 4 client facades, 2+ record types. High duplication; unclear single source of truth.
6. **Three confusingly-named orchestrator route modules** (`v2_orchestrate`, `v2_orchestrator`, `v2_orchestration`) — distinct concerns, easy to mis-import. Naming hazard.
7. **OpenAI-centric coupling in the AI manager layer** — `ai/mode_manager.py` hardcodes `gpt-4o`/`gpt-4o-mini`/`openai`; the multi-provider registry (Anthropic/Gemini) is invisible to mode/model selection. Orchestrator agent path is hard-pinned to `gpt-4o-mini`.
8. **In-memory critical infra** — background task queue and event bus lose data on restart; safety rate-limiter is per-replica. Fine for best-effort, risky if used for anything that "must complete".
9. **Lexical-only memory retrieval** presented as semantic; embeddings exist but are off by default and unused by the ranker.
10. **Generation depends on a non-existent vision capability** — website recreation can never be design-aware until a real vision model is wired.

### MEDIUM
11. **No request-ownership table / RBAC** — most v2 routes enforce isolation only via `user_id` namespace (safe-ish: cross-user reads return empty/404), but there is no real project-ownership verification beyond `ENABLE_PROJECTS`.
12. **`current_user` never raises** (`core/deps.py` returns a fallback guest) — so `Depends(current_user)` is *identity resolution*, not an auth gate. Correct by design but a subtle footgun.
13. **Unverified JWT `sub` trusted** in `v2_chat_stream.py` when `AuthMiddleware` is off — forgeable identity into a memory namespace.
14. **`v2_events` SSE has no scope ownership check** — `*` wildcard subscription receives all events (cross-tenant leak if enabled).
15. **No automatic job GC / archival** — `jobs.db`, tasks, deliverables grow unbounded.
16. **Gemini model default drift** — provider falls back to `gemini-2.5-pro` while config advertises `gemini-2.0-flash-exp`.
17. **Oversized files** (12 frontend files >500 LOC; `market_data_tool.py` 2048 LOC, `v2_chat_stream.py` 1603 LOC).
18. **Doc/numbering fragmentation** — at least 3 parallel "phase" numbering schemes; a prior auth audit was documented as **fabricated** (`AUTH_AUDIT_PHASE_1.md`), so all "✅ Done" labels need source verification.

### LOW
19. Dead code: root `ai.py`, `bot.py` (Velora Telegram), `workflows/events.py` (unused `CompletionEvent`), unused imports (`store_pg.py`, `store_sqlite.py` double `import os`).
20. Brave provider `lstrip("www.")` prefix bug (**fixed**, §10).
21. Branding drift — some prompts still reference "Velora AI" identity.
22. `README.md` is the stock Vite template; `info.md` is generator scaffold — neither documents KorvixAI.

---

## 6. Security Report

**Strengths (genuinely good):**
- **Auth crypto is mature.** stdlib **HS256** JWT pinned to `HS256` (rejects `alg=none`/algorithm-confusion), refuses empty/short (`<32 byte`) `JWT_SECRET_KEY` in production, **Argon2id** password hashing, refresh-token **rotation with theft detection** (reuse kills the family), login timing-equalization to resist user enumeration.
- **Owner mode** is env-driven: `OWNER_EMAIL`/`OWNER_EMAILS` (identity-first) + optional `OWNER_TOKEN` shared secret (constant-time compare, min length enforced, never echoed). No hardcoded owner secret in code.
- **Admin routes hidden** (404, not 401) when `ENABLE_ADMIN_MODE=false` — not discoverable.
- **No hardcoded API keys / secrets** found in committed code — all read from env.
- Trading/market endpoints **never fabricate** financial data.

**Findings (ranked):**
1. **[High] Legacy unauthenticated IDOR cluster** — `routes/memory.py` (full read/write/delete of any `user_id`, **ungated**), `profile.py`, `projects.py`, `sessions.py`, `stats.py`. `memory.py` is the worst (no flag, no auth). Secured parallels exist (`/v2/memory`, `/v2/sessions`) but the legacy routes remain mounted.
2. **[High, conditional] `/v2/orchestrate`** takes `user_id` from the **body**; `GET /runs*`/`/projects/{id}/tasks` are unauthenticated — impersonation + enumeration when `ENABLE_ORCHESTRATOR=true`.
3. **[Med] `v2_chat_stream` unverified JWT `sub`** trusted when `AuthMiddleware` (`ENABLE_AUTH_V2`) is off → write/read another user's memory namespace under a forged id.
4. **[Med] `v2_events` SSE scope authz missing** — subscribe to `project:<any>`/`user:<any>`/`*` with no ownership check (cross-tenant event leak if `ENABLE_REALTIME_EVENTS=true`).
5. **[Med] Unauthenticated asset blob route** (`/v2/assets/blob/{key:path}`) — relies on opaque sha256 keys + `_SAFE_KEY_RE`; the regex permits `.`/`/`, so traversal safety rests entirely on the storage backend's `read()`. Confirm backend rejects `..`/absolute paths.
6. **[Med] No rate limiting** on `/v2/auth` login/register/guest (explicitly deferred) → brute-force exposure. The in-memory `safety/guard.py` limiter is per-replica/per-deploy.
7. **[Low] Google OAuth `aud` check skipped** when `GOOGLE_CLIENT_ID` unset (`routes/auth.py`) — any Google-issued token accepted if the env var is missing. Set it in prod.
8. **[Low] Info disclosure** — `/v2/health`, `/v2/admin/build-info`, `/tools/health` expose feature-flag states, commit SHA, branch, deploy metadata to unauthenticated callers (intentional, low risk).
9. **[Low] `/logout` is cosmetic** — stateless JWT not invalidated server-side; leaked access token valid until expiry (default 60 min).
10. **[Low] CORS** uses `allow_credentials=true` with a permissive `https://.*\.(vercel\.app|railway\.app)$` regex — acceptable but broad (any Vercel/Railway subdomain).

> Net: the **modern v2 surface is well-secured** (JWT identity + `user_id`-scoped reads + 404 existence-hiding). The risk concentrates in the **legacy pre-auth routes** that were never retrofitted. Hardening = retire/secure those, and ensure `ENABLE_AUTH_V2=true` before flipping on any v2 write surface.

---

## 7. Performance Report

- **Synchronous chat / orchestrate** — `POST /chat` and `/v2/orchestrate` block the request for the full model call (supervisor delegation can be 15–30s). No backpressure; ASGI workers queue under load. SSE streaming (`/v2/chat/stream`) mitigates only the chat path.
- **SQLite write serialization** — every store (jobs, runs, tasks, deliverables, panels, memory) is one SQLite file with a global/file lock + WAL. Fine for 10s of concurrent ops; expect `SQLITE_BUSY` at 50+ concurrent orchestrator runs. Shared `projects.db` across 3 stores compounds this.
- **Polling everywhere** — workflow runner polls store every ~1s/step; orchestrator SSE re-reads full snapshot every 1s; FE presence polls every 4–8s. O(N) DB reads in active runs/streams; won't scale to thousands of concurrent streams without an event bus.
- **Semantic recall = O(n) Python cosine** over a candidate pool (≤200–500 rows) when embeddings are on — dev-fine, poor at scale; no FTS (uses `LIKE`).
- **Per-call HTTP sessions** in research/market providers (new `aiohttp`/urllib session per request) — no pooling; wasteful at volume (cache mitigates).
- **Large files / bundle** — `market_data_tool.py` (2048 LOC), `v2_chat_stream.py` (1603 LOC) backend; 12 frontend files >500 LOC. Frontend has many heavy animated components (`framer-motion`, particles) — watch first-paint/bundle size.
- **Unbounded counters/tables** — in-process stat counters never reset; jobs/tasks/deliverables tables have no GC.
- **No caching layer** for hot reads (project list, agent registry, owner status) — every call hits SQLite.

---

## 8. Testing Report

- **Backend: 93 test files** in `backend/tests/`, `pytest.ini` + `conftest.py` fixtures. **Real, substantial coverage** of the platform spine: auth (`test_auth*`, `test_auth_password`, `test_auth_google`), jobs (`test_jobs_*`), workflows (`test_workflow_runner`), orchestrator (`test_phaseA2_project_orchestrator`, `test_phase51_execution_engine`), memory plane (8+ files), providers/routing (`test_phase43_multi_provider_routing`, `test_anthropic_provider`, `test_streaming`), trading/market (`test_market_providers`, `test_trading_*`, `test_signal_intelligence`), generation (`test_generation*`), sessions, tools, personality. Tests **monkeypatch external LLM/agent calls** (e.g. `run_agent`) for determinism.
- **Frontend: 0 tests.** No vitest/jest config, no `*.test.tsx`. The most user-facing, most-changed surface is entirely **unverified**. `DEMO_STATUS.md` admits "no automated tests for new pages or the trading mapper."
- **Critical missing regression coverage:**
  - Frontend: `useChat` error/timeout mapper, trading snake→camel mapper, auth store/session flow, route guards.
  - Backend: the **legacy IDOR routes** (no tests asserting authz), credits/payments (none exist), persistence durability across "restart", the unverified-JWT-`sub` path in `v2_chat_stream`, `v2_events` scope authz.
- **Test-suite claims to verify:** `PHASE_A2` doc claims "1578 passed" — independently confirm; the prior fabricated-audit precedent means **trust no "Done" label without running the suite**.

---

## 9. Roadmap Alignment Report

Vision (per `PROJECT_ROADMAP.md` / `AI_OS_ROADMAP`): chat product → **AI Operating System** (coordinated agents, persistent memory, vertical pipelines, prod-grade infra). Verticals (Website Recreation, Ecommerce, Trading) are framed as "the product users buy."

| Vision pillar | Built? | Live? | Reality |
|---|---|---|---|
| **AI Chat** | ✅ | ✅ | The one fully-live vertical. Single-provider (OpenAI), local-only sessions, no streaming by default. |
| **Multi-Agent Runtime** | ✅ (real runtime) | ❌ flag-off | `agent/runtime` + delegate + specs exist and run; orchestrator pins `gpt-4o-mini`, tool-calls disabled on that path. |
| **Agent Orchestrator** | ✅ Production-grade (Phase A.2) | ❌ `ENABLE_PROJECT_ORCHESTRATOR=false` | Conductor + DAG runner + deliverables fully built & tested. **Dormant.** |
| **Workflow Engine** | ✅ | ❌ flag-off | Re-entrant DAG runner, crash-safe. |
| **Project Workspace** | ✅ FE + BE | ⚠️ gated | `ProjectWorkspace` ↔ `/v2/orchestrator/*` wired; honest disabled state. |
| **Universal Website/App Builder** | ⚠️ partial | ❌ | Generation = hybrid LLM + deterministic templates; builder **pages not wired**; vision-driven recreation **non-functional**. |
| **Startup Intelligence Hub** | ⚠️ prompt-bridge | ⚠️ | `StartupHub` tools bundle prompts → `/chat`. No dedicated engine. |
| **Ecommerce OS** | ⚠️ prototype | ❌ | `EcommerceOS`/`EcommerceCommandCenter` are presentation; root `ecommerce.py` is prompt scaffolding. |
| **Trading Intelligence** | ✅ data layer | ⚠️ flag-gated | Real market data + signals; **no execution** (by design). The most honest vertical. |
| **Knowledge / RAG** | ⚠️ | ❌ | `memory_plane` + real embeddings exist but off; retrieval is lexical; `KnowledgeVault` page static. |
| **Deploy & Export Pipeline** | ⚠️ | ❌ | Artifacts are previewable/downloadable single-file HTML; no Vercel/R2 deploy pipeline. |

**Alignment summary:**
- **Implemented & strong:** chat, orchestrator/workflow/jobs spine, trading/market data, research, auth crypto.
- **Partially implemented:** project workspace, generation, memory plane, verticals (as chat tabs).
- **Not started / mismatch:** real builder code-gen + deploy, vision understanding, ecommerce/startup engines, RBAC/orgs, observability, Postgres/Redis/R2 infra.
- **Architecture mismatch to flag:** the platform is engineered as an OS but operated as a chatbot; the verticals are UI tabs over one shared chat/agent path, not the independent verticals the vision describes. The biggest divergence from "production online" is the **ephemeral SQLite** persistence.

---

## 10. Immediate Fixes Applied

Per the sprint's allowance for low-risk, isolated, production-safe fixes only:

1. **`backend/services/research/brave.py`** — fixed a domain-filter bug: `d.lower().lstrip("www.")` → `d.lower().removeprefix("www.")`. `str.lstrip` strips a *character set*, so `"wired.com".lstrip("www.")` returned `"ired.com"`, silently mangling any excluded domain starting with `w`/`.`. The fix strips only the literal `www.` prefix. Isolated, in a default-OFF provider, covered behaviour unchanged for normal domains.

> Deliberately **not** changed during this audit (documented instead, to respect "understand before changing" and deploy-sensitivity): dead-file deletion (`ai.py`, `bot.py`, `memory_intelligence/`, `workflows/events.py`), the IDOR routes, persistence/volume config, the triplicated memory consolidation, and any feature-flag defaults. These are scoped as the refactor work below.

---

## 11. Recommended Refactor Order

Ordered by risk-reduction per unit effort, to be done **before** new feature work:

1. **Persistence durability (CRITICAL, Low effort).** Mount a Railway persistent volume and point all `*_DB_PATH` at it (e.g. `/data/*.db`), or begin the Postgres migration for `auth.db` + `memory.db` first. Without this, every other improvement sits on disappearing data.
2. **Retire/secure the legacy IDOR routes (CRITICAL, Low–Med).** Delete or auth-gate `routes/memory.py`, `profile.py`, `projects.py`, `sessions.py`, `stats.py`; route the frontend to the secured `/v2/*` equivalents. Add regression tests asserting cross-user 404.
3. **Gate-readiness pass before any v2 flip (High, Low).** Make `ENABLE_AUTH_V2=true` a precondition; fix `/v2/orchestrate` body-`user_id` + unauth read routes; add scope-ownership to `/v2/events`. These are the landmines that turn "flip a flag" into a breach.
4. **Collapse the memory trinity (High, Med).** Delete dead `memory_intelligence/`; pick `memory_plane` as the single forward path; make legacy `memory.py` a thin adapter behind it; converge the 3 extractors / secret lists into one.
5. **Decouple model selection from OpenAI (High, Med).** Teach `ai/mode_manager`+`model_manager` about the provider registry; remove the orchestrator's hard `gpt-4o-mini` pin or make it config-driven; fix the Gemini default drift.
6. **Delete dead code & disambiguate names (Med, Low).** Remove `ai.py`, `bot.py`, `workflows/events.py`; rename the three orchestrator route modules to unambiguous names.
7. **Split oversized files (Med, Med).** `useChat.ts`, `ProjectWorkspace.tsx`, `AuthPage.tsx`, `CreditsPage.tsx`, `market_data_tool.py`, `v2_chat_stream.py`.
8. **Frontend test harness (Med, Med).** Add vitest; cover the chat error mapper, trading mapper, auth/session flow, route guards.
9. **Job/data GC + caching (Low–Med).** Archival sweeps for jobs/tasks/deliverables; a small cache for hot reads.

---

## 12. Recommended Next Sprint

**Theme: "Make the live path trustworthy, then light up one vertical end-to-end."**

The platform's strength is a built, tested orchestration spine. The fastest credibility win is **not** building new features — it's making persistence durable, closing the legacy auth holes, and turning **one** vertical fully on with confidence.

**Sprint 1 (P0 — foundation hardening, ~1 sprint):**
1. Persistent storage for the live path (volume mount or Postgres for `auth`+`memory`). *(P0, Low)*
2. Retire/secure the legacy IDOR routes + add cross-user regression tests. *(P0, Med)*
3. Pre-flight the v2 surface: `ENABLE_AUTH_V2` required, fix `/v2/orchestrate` identity + `/v2/events` scope authz. *(P0, Med)*
4. Stand up a minimal frontend test harness (chat + trading mappers, auth flow). *(P1, Low)*

**Sprint 2 (P1 — first real vertical, candidate after foundation):**
- Turn on the **Project Orchestrator + Workflow Runner + Job Queue** in staging behind a load test; wire `ProjectWorkspace` fully; enable the `landing_page` template; verify deliverables persist and preview. This exercises the whole spine on durable storage with one believable output. Defer ecommerce/trading-execution/vision until the generation + vision gaps are real.

**Explicitly out of scope (per constraints & findings):** building the Website Builder, redesigning UI, implementing Startup Hub / Trading execution / Ecommerce engines, or adding new AI features. The vision is sound; the work is to **operationalize what already exists**, durably and securely, before extending it.

---

### Appendix A — "Don't rewrite these" (extend, don't replace)
- `backend/services/auth/*` — mature crypto; extend with rate-limiting + OAuth providers, don't rebuild.
- `backend/services/orchestrator/*`, `workflows/*`, `jobs/*` — production-grade spine; turn on and harden, don't re-architect (until Postgres/Redis scale phase).
- `backend/services/providers/*` — clean multi-provider abstraction; just wire it into model selection.
- `backend/services/market_providers/*` + `trading/*` — honest, real; extend coverage.
- `backend/services/research/*` — real cascade; extend providers.
- `src/hooks/useChat.ts` (behaviour), trading mapper — battle-tested invariants per `DEMO_STATUS.md`; refactor structure but preserve contracts.

### Appendix B — Source of truth notes
- The repo's own docs (`DEMO_STATUS.md`, `PROJECT_ROADMAP.md`, `AUTH_AUDIT_PHASE_1.md`) are candid and largely accurate, **except** "production online" overstates durability and a prior auth audit was self-documented as fabricated. **Verify "Done" labels by running the suite**, not by trusting docs.
