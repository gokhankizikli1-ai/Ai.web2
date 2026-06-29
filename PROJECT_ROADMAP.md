# KorvixAI — Project Roadmap

> Transformation roadmap: **AI chat product → AI Operating System** with coordinated agents, persistent memory, vertical pipelines, and production-grade infrastructure.

**Status:** Phases 1–5 (auth, owner mode, chat workspace, agent registry, safety guardrails) are shipped to production. This document covers **Phases 6–15** — the path from "chatbot with tabs" to "coordinated digital AI team."

> **AI-OS track update (2026-06-29):** the multi-agent orchestration layer is now landing per `AI_OS_ROADMAP.md` Phase A. PR #1 (Workflow DAG Runner, `#181`) shipped. **PR #2 — Project Orchestrator service** is now implemented behind `ENABLE_PROJECT_ORCHESTRATOR` (the conductor: one request → tracked multi-agent run with deliverables + task graph + workflow). See `PHASE_A2_PROJECT_ORCHESTRATOR.md`. Next: PR #3 wires `ProjectWorkspace` to the new `/v2/orchestrator/*` routes.

**Legend**
- **Priority:** `P0` blocker for the next phase · `P1` important · `P2` nice-to-have
- **Complexity:** `Low` (<1 wk) · `Medium` (1–2 wk) · `High` (2–4 wk) · `Very High` (1mo+)
- **Surface:** `BE` backend · `FE` frontend · `INF` infrastructure · `DATA` data layer

---

## Table of Contents

| # | Phase | Priority | Complexity |
|---|---|---|---|
| [6](#phase-6--memory-plane) | Memory Plane | P0 | High |
| [7](#phase-7--job-queue) | Job Queue & Async Execution | P0 | High |
| [8](#phase-8--filevision-pipeline) | File / Vision Pipeline | P1 | High |
| [9](#phase-9--multi-agent-coordination) | Multi-Agent Coordination | P0 | Very High |
| [10](#phase-10--tool-expansion) | Tool Expansion | P1 | High |
| [11](#phase-11--cost-optimization) | Cost Optimization | P1 | Medium |
| [12](#phase-12--vertical-pipelines) | Vertical Pipelines | P1 | Very High |
| [13](#phase-13--production-hardening) | Production Hardening | P0 | High |
| [14](#phase-14--scale--real-time-ux) | Scale & Real-time UX | P2 | High |
| [15](#phase-15--deployment-architecture) | Deployment Architecture | P1 | Medium |

---

## Phase 6 — Memory Plane

**Priority:** P0 · **Complexity:** High · **Depends on:** none (foundation)

Persistent, queryable memory across sessions, projects, and agents. Today: chat history is per-conversation only — agents have no recall of prior projects, decisions, or user preferences.

### Architecture
- **Storage:** Postgres (managed — Neon or Supabase) + `pgvector` extension for embeddings
- **Service:** `backend/services/memory/` — `MemoryStore`, `MemoryRetriever`, `MemoryConsolidator`
- **Embedding model:** `text-embedding-3-small` (OpenAI) — 1536 dims, cheap, multilingual
- **Schema:** `memories(id, user_id, project_id, agent_id, kind, content, embedding, importance, ttl, created_at)`
- **Kinds:** `fact` · `preference` · `decision` · `task_outcome` · `relationship`

### Backend
- [ ] Provision Postgres + enable `pgvector`
- [ ] `MemoryStore` — write, semantic search (`<=>` operator), filter by kind/project/agent
- [ ] Auto-write hook in `RunContext` — extract memories from each agent turn via a lightweight classifier
- [ ] Retrieval hook — top-K relevant memories injected into agent system prompt
- [ ] Consolidation job (nightly Celery task) — merges duplicates, decays unimportant memories
- [ ] API: `POST /v2/memory`, `GET /v2/memory/search`, `DELETE /v2/memory/:id`

### Frontend
- [ ] Memory inspector in Admin Panel (owner-only) — list, search, edit, delete memories per project
- [ ] User-facing "Memory" tab in Settings — "what does KorvixAI remember about me" + delete-all button (GDPR)

### Dependencies (this phase enables)
- Phase 9 (agents need shared memory to coordinate)
- Phase 12 (vertical pipelines need project-scoped recall)

---

## Phase 7 — Job Queue & Async Execution

**Priority:** P0 · **Complexity:** High · **Depends on:** none

Today every agent turn is synchronous. Long jobs (web scraping, vision OCR, multi-agent pipelines) block the HTTP request and hit timeouts. Need durable, restartable, observable async execution.

### Architecture
- **Broker:** Redis (Upstash managed)
- **Worker:** Celery — separate Railway service `korvixai-workers`
- **Job model:** Postgres table `jobs(id, kind, user_id, project_id, status, payload, result, error, idempotency_key, created_at, started_at, finished_at)`
- **Idempotency:** `idempotency_key` = SHA256(user_id + kind + payload-hash) — duplicate submits return existing job

### Backend
- [ ] Redis provisioning + Celery wiring (`backend/jobs/celery_app.py`)
- [ ] `Job` model + repository
- [ ] Task decorators: `@korvix_task` wraps Celery `@app.task` with idempotency + status writes
- [ ] Generic endpoints: `POST /v2/jobs` (enqueue) · `GET /v2/jobs/:id` (status) · `GET /v2/jobs?project=…` (list)
- [ ] SSE bridge: `/v2/jobs/:id/stream` so the FE can subscribe to status transitions
- [ ] Convert long-running calls (vision, browse, multi-agent runs) from inline → job-backed

### Frontend
- [ ] `useJob(jobId)` hook — subscribes to SSE, returns `{status, progress, result}`
- [ ] `<JobProgress>` chip in chat — replaces frozen "thinking…" spinner with real progress
- [ ] Jobs drawer (owner) — see all running/queued/failed jobs across the system

### Dependencies (this phase enables)
- Phase 8 (vision/OCR is async-only)
- Phase 9 (agent panels are job-orchestrated)
- Phase 10 (browse_url, exec_python must be async)

---

## Phase 8 — File / Vision Pipeline

**Priority:** P1 · **Complexity:** High · **Depends on:** Phase 7 (Job Queue)

Upload PDFs, images, spreadsheets, screenshots → agents can read them. Today the FE has a paperclip but nothing happens server-side.

### Architecture
- **Object store:** Cloudflare R2 (S3-compatible, zero egress)
- **Direct upload:** presigned PUT URLs — FE uploads to R2 without proxying through API
- **Extraction:** vision via `gpt-4o-mini` (cheap, accurate enough); PDF via `pypdf` for text + page-render to image for vision; spreadsheets via `pandas` → markdown
- **Storage:** `files(id, user_id, project_id, r2_key, mime, size, extracted_text, extracted_meta, embedding, created_at)`
- **Linking:** `message_attachments(message_id, file_id)` so agents see attachments in context

### Backend
- [ ] R2 bucket + IAM credentials
- [ ] `POST /v2/files/presign` → returns `{upload_url, file_id, r2_key}`
- [ ] `POST /v2/files/:id/finalize` → triggers extraction job
- [ ] Extraction Celery tasks: `extract_pdf`, `extract_image`, `extract_spreadsheet`
- [ ] Embedding of extracted text → reuses Phase 6 memory store
- [ ] File-aware agent middleware: when a message has attachments, prepend extracted content + vision-capable model routing

### Frontend
- [ ] Real attachment flow in `useChat` — presign → upload to R2 → finalize → message-attach
- [ ] Attachment chips with extraction status (`extracting…` / `ready`)
- [ ] Inline preview for images, PDF thumbnails, spreadsheet first-rows
- [ ] Drag-drop into chat composer

### Dependencies (this phase enables)
- Phase 12 (Website Recreation needs to ingest competitor screenshots)
- Phase 12 (Ecommerce Automation needs to read product CSV/Excel)

---

## Phase 9 — Multi-Agent Coordination

**Priority:** P0 · **Complexity:** Very High · **Depends on:** Phase 6 (Memory) + Phase 7 (Jobs)

This is the **defining capability** that turns KorvixAI from a chat product into an AI OS. Multiple agents collaborate on a single goal with a shared workspace.

### Architecture
- **Presence channel:** Redis pub/sub channel per project — agents announce activity (`agent_id`, `status`, `current_task`)
- **Shared scratchpad:** Postgres `scratchpad_entries(id, project_id, agent_id, kind, content, references, created_at)` — append-only log every agent reads/writes
- **Panel orchestration:** `Panel` = a goal + a set of `AgentSpec`s + a coordinator. Coordinator decomposes goal → assigns subtasks → merges results
- **Agent-to-agent messaging:** typed messages (`request`, `response`, `propose`, `decline`, `final`) over Redis — agents can hand off without going through the user
- **Conflict resolution:** scratchpad entries have `supersedes` field; coordinator picks winner via voting or owner override

### Backend
- [ ] `backend/services/agent/coordination/` — `Panel`, `Coordinator`, `ScratchpadStore`, `PresenceBus`
- [ ] Extend `RunContext` with `panel_id`, `peer_agents`, `scratchpad_ref`
- [ ] `delegate.py` — allow child agents to spawn sibling agents (capped depth)
- [ ] Panel templates: `software_panel` (PM + Eng + QA), `startup_panel` (CEO + CMO + CTO), `ecommerce_panel` (Buyer + Merchandiser + Ops)
- [ ] API: `POST /v2/panels` (create), `GET /v2/panels/:id` (state), SSE stream of scratchpad entries

### Frontend
- [ ] **Panel view** — split-pane UI showing all active agents in a project, each with their current task + last message
- [ ] Scratchpad timeline — chronological log of all agent activity
- [ ] Agent-to-agent message visualization (arrows between panels)
- [ ] User can interject any agent mid-flow

### Dependencies (this phase enables)
- Phase 12 (verticals are implemented as panel templates)

---

## Phase 10 — Tool Expansion

**Priority:** P1 · **Complexity:** High · **Depends on:** Phase 7 (Jobs)

Today agents have ~5 tools. To be useful as an OS, they need a real toolbelt. Each tool is owner-gated for risky operations, sandboxed where possible, and audit-logged.

### Tools to add

| Tool | Purpose | Sandbox | Owner-gated |
|---|---|---|---|
| `browse_url` | Headless Chromium fetch + readability extraction | Browserless / Playwright in Docker | No |
| `exec_python` | Run Python in isolated container | Modal or E2B sandbox (30s, no net) | No |
| `web_search` | SerpAPI or Brave Search wrapper | n/a | No |
| `shopify` | Read/write Shopify admin API | per-user token | Yes (write ops) |
| `db_query` | Read user's connected Postgres/MySQL | read-only credential | Yes |
| `send_email` | Send via Resend/Postmark on user's behalf | rate-limited | Yes |
| `schedule_task` | Schedule a future job (cron or one-shot) | Celery beat | No |

### Backend
- [ ] `backend/services/tools/` — one module per tool, all implement `BaseTool` (`name`, `schema`, `run`, `audit`)
- [ ] Tool registry + per-user enablement matrix (`tool_grants(user_id, tool_name, scope, granted_at)`)
- [ ] Sandbox integrations: Modal or E2B for `exec_python`; Browserless container for `browse_url`
- [ ] OAuth flows for Shopify, Gmail, Slack — store tokens in `external_credentials` (encrypted)
- [ ] Audit every tool call (extends existing `audit.py` ledger)

### Frontend
- [ ] Tool inspector in Admin Panel — see every tool call with input/output
- [ ] User-facing "Connections" page — connect Shopify, Gmail, GitHub etc.
- [ ] Per-tool confirmation modal for write operations (`send_email`, `shopify` writes)

### Dependencies (this phase enables)
- Phase 12 verticals all depend on specific tools

---

## Phase 11 — Cost Optimization

**Priority:** P1 · **Complexity:** Medium · **Depends on:** Phase 7 (Jobs — for batch API)

Token spend will be the largest variable cost. Today: every request hits the most-capable model. Need adaptive routing, caching, batching, and per-user budgets.

### Architecture
- **Per-request cost ledger:** `usage_events(id, user_id, project_id, agent_id, provider, model, input_tokens, output_tokens, cost_usd, request_id, created_at)`
- **Adaptive model selection:** classifier picks model by task complexity — `gpt-4o-mini`/`claude-haiku-4-5` for simple, `gpt-4o`/`claude-sonnet-4-6` for medium, `claude-opus-4-7` for hard
- **Prompt caching:** Anthropic prompt-caching headers on long system prompts (4× cost reduction for cached prefix)
- **Batch API:** non-interactive jobs (extraction, embeddings, summarization) go through OpenAI/Anthropic batch endpoints (50% cheaper, 24h SLA)
- **Budget:** per-user `monthly_token_budget_usd` — soft warn at 80%, hard block at 100%

### Backend
- [ ] `UsageLogger` middleware around every LLM call
- [ ] `ModelRouter` — classifier + routing rules + override (`force_model` for owner)
- [ ] Anthropic prompt-cache integration (`cache_control: ephemeral` on system blocks)
- [ ] Batch dispatcher Celery task — collects jobs marked `batchable=true`, submits to provider batch API, polls for completion
- [ ] Budget enforcement in `RunContext` — pre-call check

### Frontend
- [ ] Usage dashboard in Settings — daily/monthly spend breakdown by agent + tool
- [ ] Budget setting UI
- [ ] Cost preview chip on heavy operations (e.g. "this will use ~$0.12 of credits")

### Dependencies
- Standalone — can ship independently once ledger schema is decided

---

## Phase 12 — Vertical Pipelines

**Priority:** P1 · **Complexity:** Very High · **Depends on:** Phase 8 (Files) + Phase 9 (Coordination) + Phase 10 (Tools)

Each vertical is a `Panel` template (Phase 9) + a curated toolbelt (Phase 10) + a UI tab. The verticals are **the product** users buy.

### 12a. Website Recreation Pipeline
**Inputs:** competitor URL or screenshot
**Output:** working Next.js scaffold deployed to a preview URL

**Agents:** `Scraper` (browse_url) → `VisionAnalyzer` (extracts layout/colors/typography) → `Architect` (proposes component tree) → `Coder` (generates Next.js code) → `Deployer` (pushes to Vercel preview)

### 12b. Ecommerce Automation
**Inputs:** Shopify store connection + product CSV or seed list
**Output:** SKU enrichment, listing copy, image alt-text, pricing recommendations, abandoned-cart email drafts

**Agents:** `Catalog` (db_query Shopify) → `Researcher` (web_search competitors) → `Copywriter` → `Pricer` (db_query historical) → `EmailMarketer` (send_email drafts)

### 12c. Trading Architecture (read-only first; execution is owner-gated and rate-limited)
**Inputs:** watchlist + risk preferences
**Output:** daily briefing, signal alerts, scenario backtests

**Agents:** `MarketScanner` (existing market_providers) → `Analyst` (vision on charts) → `RiskOfficer` → `Reporter`
**Execution:** behind a separate `ExecutionAgent` that requires explicit owner approval per trade until manually unlocked

### Backend
- [ ] One module per vertical: `backend/verticals/{website,ecommerce,trading}/panel.py`
- [ ] Vertical-specific scratchpad schemas (e.g. `LayoutSpec`, `ProductRecord`, `TradeSignal`)
- [ ] Vertical-specific result viewers (e.g. live preview of generated Next.js code)

### Frontend
- [ ] Each vertical gets a dedicated tab in `/chat?tab=…` with bespoke UI (already scaffolded in `pages/WebsiteBuilder`, `pages/EcommerceOS`, etc.)
- [ ] Vertical-specific input forms (URL picker, store connector, watchlist editor)
- [ ] Output viewers (code preview, product editor, signal feed)

---

## Phase 13 — Production Hardening

**Priority:** P0 (must ship before scaling user base) · **Complexity:** High · **Depends on:** all prior phases

Today: single-tenant safe, but multi-tenant gaps exist. Hardening covers observability, auth providers, RBAC, rate limiting, audit, DR.

### Observability
- [ ] Sentry for FE + BE error tracking
- [ ] Logflare or Axiom for structured logs
- [ ] OpenTelemetry traces for agent runs — every span from HTTP → coordinator → LLM call visible
- [ ] Health endpoints + Better Uptime monitors

### Auth Providers
- [ ] Add Apple Sign-In (parity with Google)
- [ ] Add GitHub OAuth (developer audience)
- [ ] Magic link via Resend (no-password fallback)
- [ ] MFA (TOTP) opt-in for owner + paying users

### RBAC
- [ ] Roles: `owner`, `admin`, `member`, `viewer` per project
- [ ] Permission matrix in DB — every API endpoint declares required permission
- [ ] Team/org model — `orgs`, `org_members`, projects belong to org

### Rate Limiting
- [ ] `slowapi` or custom Redis-based limiter on `/v2/orchestrate`, `/v2/jobs`, `/v2/files/presign`
- [ ] Tiered limits: free / pro / enterprise

### Audit
- [ ] Extend existing `audit.py` ledger to cover RBAC mutations, file deletes, tool grants
- [ ] Owner-only audit log viewer with filters

### DR (Disaster Recovery)
- [ ] Daily Postgres backups → R2
- [ ] Restore drill quarterly
- [ ] Documented runbook in `docs/runbooks/`

---

## Phase 14 — Scale & Real-time UX

**Priority:** P2 · **Complexity:** High · **Depends on:** Phase 13

Optimizations to take the product from ~1k DAU → ~50k DAU without re-architecting.

### Backend
- [ ] Redis cache layer for hot reads (project list, agent registry, owner status)
- [ ] CDN for static API responses (config, public agent catalog)
- [ ] Postgres read replicas — route `GET` queries via SQLAlchemy router
- [ ] Worker autoscale — Railway autoscaler driven by Celery queue depth
- [ ] WebSocket option (in addition to SSE) for bidirectional bursts (presence, typing indicators)

### Frontend
- [ ] CRDT (Yjs) for multi-user concurrent editing of scratchpad / shared docs
- [ ] Optimistic UI everywhere (no spinners on user input → result)
- [ ] Edge runtime for marketing pages (Vercel Edge Functions)
- [ ] Service Worker — offline-first for the chat shell

### Dependencies
- Phase 13 (observability is required to measure scale issues)

---

## Phase 15 — Deployment Architecture

**Priority:** P1 · **Complexity:** Medium · **Depends on:** Phase 13

The final, named topology. This is what the production diagram should look like.

```
                      ┌──────────────────────┐
                      │  Cloudflare (CDN +   │
                      │  WAF + DNS + R2)     │
                      └──────────┬───────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
        ┌─────▼─────┐     ┌──────▼──────┐    ┌──────▼──────┐
        │  Vercel   │     │  Railway    │    │  Modal /    │
        │  (FE +    │     │  (API +     │    │  E2B        │
        │  Edge fns)│     │   Workers)  │    │  (Sandboxes)│
        └─────┬─────┘     └──────┬──────┘    └─────────────┘
              │                  │
              │           ┌──────┴──────────┐
              │           │                 │
              │      ┌────▼────┐      ┌─────▼─────┐
              │      │Postgres │      │  Redis    │
              │      │(Neon)   │      │(Upstash)  │
              │      │+pgvector│      │           │
              │      └─────────┘      └───────────┘
              │
              └────► Sentry · Logflare · Better Uptime
```

### Components

| Layer | Provider | Notes |
|---|---|---|
| Edge / DNS / WAF | Cloudflare | also hosts R2 object storage |
| Static FE | Vercel | Next.js or current Vite SPA |
| API (FastAPI) | Railway | `korvixai-api` service |
| Workers (Celery) | Railway | `korvixai-workers` service, separate scaling |
| Postgres | Neon (or Supabase) | `pgvector` enabled |
| Redis | Upstash | broker + cache + pub/sub |
| Sandboxes | Modal (preferred) or E2B | `exec_python`, untrusted code |
| Headless browser | Browserless or self-host Playwright | `browse_url` |
| Object storage | Cloudflare R2 | uploads, model artifacts, backups |
| Errors | Sentry | FE + BE |
| Logs | Logflare or Axiom | structured |
| Uptime | Better Uptime | public status page |

### Backend
- [ ] Terraform or Pulumi for repeatable infra
- [ ] Separate `staging` + `production` projects on every provider
- [ ] Environment promotion pipeline (staging → prod manual gate)

### Frontend
- [ ] `__BUILD_COMMIT__` + region label in `BuildInfoOverlay` (commit visibility already shipped)
- [ ] Vercel preview deployments wired to PR comments (already in place via GitHub Actions)

---

## Cross-Phase Dependency Graph

```
P6 Memory ──────────┐
                    ├──► P9 Coordination ──► P12 Verticals ──► P13 Hardening ──► P14 Scale
P7 Jobs ────────────┤                                              │
                    ├──► P8 Files ─────────────┘                   │
P10 Tools ──────────┘                                              │
                                                                   │
P11 Cost Optimization ─────────────────────────────────────────────┤
                                                                   │
P15 Deployment ────────────────────────────────────────────────────┘
```

### Critical path
**P6 → P7 → P9 → P12 → P13.** Everything else can be parallelized or deferred.

### Recommended sequencing
1. **Quarter 1:** P6 (Memory) + P7 (Jobs) in parallel — these are foundational and have no dependencies
2. **Quarter 2:** P8 (Files) + P10 (Tools) + P11 (Cost) — independent, parallelizable
3. **Quarter 3:** P9 (Coordination) — the defining capability
4. **Quarter 4:** P12 (Verticals) — ship one vertical (Website Recreation) end-to-end first, then replicate
5. **Quarter 5:** P13 (Hardening) before public launch
6. **Post-launch:** P14 + P15 driven by real usage data

---

## Open Questions

- **Pricing model:** per-seat? per-token-passthrough+margin? per-vertical?
- **Self-hosting story:** do enterprise customers get a single-tenant deploy?
- **Owner Agent surface:** keep hidden-by-default or promote to a "Founder Mode" power feature?
- **Native mobile:** React Native shell wrapping the existing PWA, or fully native?

---

*Last updated: 2026-05-26 · Owner: Gökhan Bey · Living document — revise per sprint review.*
