# KorvixAI — AI Operating System Roadmap

**Source of truth:** `main @ 18ba580` — verified line-by-line by four parallel codebase audits
**Date:** 2026-06-28
**Status:** AUDIT + PHASE PLAN — awaiting approval before implementation
**Author:** Engineering — pre-implementation review

---

## Executive summary

Three things you need to know up front:

1. **You already have ~70% of a multi-agent orchestration engine.** It is real code, in `backend/services/agent/`, with a tool-calling loop (`runtime.py`), 10 pre-built role specs (`specs/builtins.py`), a delegate primitive (`delegate.py`) with shared scratchpad + depth caps, a stateless coordinator (`/v2/coordinator/plan` + `classify`), panels as social workspaces, an inter-agent messenger, presence tracking, and an `agent_tasks` lifecycle. **You do not need to build the agent runtime from scratch.**

2. **The gap to "5 agents collaboratively build a Shopify landing page" is mostly the orchestration LAYER on top, not the agent runtime.** Specifically: no DAG executor, no inter-agent dependency wait, no deliverable registry, no project-orchestrator service that fans a single user request out to N specialists and tracks them as a unit. The plumbing exists; the conductor doesn't.

3. **The frontend tells a very different story than the backend.** Of 28 pages in `src/pages/`, only 3 are fully wired (ChatDashboard, AuthPage, ProjectWorkspace partial). Pages named like `MultiAgentSwarm`, `AgentBuilder`, `EcommerceOS`, `WebsiteBuilder`, `StartupHub` are UI demos with hardcoded data. **The reason the product doesn't feel like an OS is the missing FE layer that surfaces the orchestration already happening in the backend** — not the absence of backend capability.

This roadmap is built to exploit (1), close (2), and ship (3) in that order. Six phases over ~14–18 weeks. The first three PRs land the foundation that unblocks every vertical (Shopify, code, games, research) without committing to any single one.

---

## Part I — Current capability audit

### 1.1 Agent runtime + orchestration (BE) — actually present today

| Capability | Status | File |
|---|---|---|
| LLM tool-call loop with parallel dispatch | ✅ Live | `backend/services/agent/runtime.py` |
| `AgentRequest`/`AgentResponse`/`AgentStep` with trace + partial-result handling | ✅ Live | same |
| Streaming events (`agent.started`, `tool.called`, `tool.completed`, `agent.finished`) | ✅ Live, gated on `ENABLE_REALTIME_EVENTS` | `backend/services/events/` |
| 10 pre-built agent specs (supervisor, researcher, coder, trader, marketer, strategist, ux_designer, brand_designer, copywriter, product_strategist) | ✅ Live | `backend/services/agent/specs/builtins.py` |
| Role templates with production-grade system prompts | ✅ Live | `backend/services/agent/specs/role_templates.py` |
| Per-project agent records (override system_prompt, allowed_tools, model) | ✅ Live | `backend/services/projects/store.py` → `project_agents` table |
| `delegate(agent_id, task, context)` — supervisor-only RPC handoff | ✅ Live | `backend/services/agent/delegate.py` |
| Shared scratchpad inherited across delegated sub-agents | ✅ Live | `delegate.py` (`scratch` dict by reference) |
| Depth + parallelism caps (`ORCHESTRATOR_MAX_DEPTH=2`, `ORCHESTRATOR_MAX_PARALLEL=5`, `ORCHESTRATOR_TOTAL_TOKEN_BUDGET=80k`) | ✅ Live | `delegate.py` |
| Multi-provider routing (OpenAI / Anthropic / Gemini fallback chain) | ✅ Live | `backend/services/agent/provider_router.py` |
| Coordinator: `/v2/coordinator/plan` — stateless plan preview (regex classifier, <1ms) | ✅ Live | `backend/services/coordinator/` |
| Coordinator: `/v2/coordinator/classify` — complexity probe | ✅ Live | same |
| Panels — social workspace (active/paused/completed/failed/cancelled lifecycle) | ✅ Live, FE consumed | `backend/services/panels/` |
| Agent messenger — typed messages (request/response/propose/revise/approve/reject/final), append-only log | ✅ Live | `backend/services/agent_messenger/` |
| Agent presence — per-panel state (idle/thinking/researching/coding/analyzing/waiting/blocked/completed/failed) | ✅ Live | `backend/services/agent_presence/` |
| Agent tasks — lightweight task records (queued/running/completed/failed/cancelled) | ✅ Live, no FE consumer | `backend/services/agent_tasks/` |

### 1.2 Jobs, tools, workflows — actually present today

| Capability | Status | File |
|---|---|---|
| `InlineJobRunner` — async asyncio.Task pool, semaphore-bounded (default 4) | ✅ Live, single-instance only | `backend/services/jobs/runner.py` |
| `CeleryJobRunner` — placeholder for multi-instance (raises `NotImplementedError`) | ❌ Stub | same |
| 5 registered job kinds: `echo`, `sleep_progress`, `memory_consolidation_stub`, `vision.analyze`, `research.deep` | ✅ Live, env-gated | `backend/services/jobs/kinds.py:41-48` |
| Full SSE streaming per job (`/v2/jobs/{id}/stream`) | ✅ Live | `backend/routes/v2_jobs.py` |
| Cancel + retry via REST | ✅ Live | same |
| 12 registered tools | See table below | `backend/services/tools/*_tool.py` |
| Tool registry with feature flags per tool | ✅ Live | `backend/services/tools/tool_registry.py` |
| Tool execution logging (`tool_executions` table — status, latency, cost) | ✅ Live, gated on `ENABLE_TOOLS_RUNTIME` | `backend/services/tool_executions/` |
| Agent tool-call bridge (`tool_bridge.dispatch_many` — parallel, timeout-bounded) | ✅ Live | `backend/services/agent/tool_bridge.py` |
| Workflow CRUD + 5 templates (research/ecommerce/website_recreation/startup_validation/trading_research) | ✅ Schema only | `backend/services/workflows/` |
| Workflow execution runtime (DAG, dependencies, automatic step progression) | ❌ **Not built** | — |

**Tool inventory:**

| Tool | Status | What it does |
|---|---|---|
| `web_research` | ✅ Live (Tavily→Exa→Brave cascade) | Search the web, return citations + answer |
| `browser_fetch` | ✅ Live (no JS) | HTTP fetch + readable-text extraction, 5MB cap, 8s timeout |
| `github_repo` | ✅ Live | GitHub API: code search, repo metadata, PR/issue read |
| `market_data` | ✅ Live | Crypto/forex via CoinGecko/AlphaVantage |
| `macro_data` | ✅ Live | Economic indicators (inflation, GDP) |
| `stock_market` | ✅ Live | Equity OHLC + trends |
| `news` | ✅ Live | News aggregation |
| `calculator` | ✅ Live | Math |
| `current_time` | ✅ Live | UTC now |
| `university_rankings` | ✅ Live | Educational rankings |
| `ecommerce_research` | ❌ Placeholder (env gate exists, no provider) | — |

### 1.3 Data layer — actually present today

13 SQLite stores, all user-scoped. Only the memory plane has a Postgres adapter.

| Subsystem | Tables | User-scoped | Postgres parity |
|---|---|---|---|
| auth | `auth_users`, `auth_refresh_tokens`, `auth_password_users` | ✅ | ⚠️ schema portable, no PG code |
| sessions | `workspaces`, `threads`, `messages` | ✅ | ⚠️ schema portable |
| projects | `projects`, `project_agents`, `project_memory`, `project_threads`, `project_files` | ✅ | ⚠️ schema portable |
| memory_plane | `memory_items` | ✅ | ✅ **dual-backend (SQLite + PG via store_pg.py)** |
| jobs | `jobs` | ✅ | ❌ |
| assets | `assets` | ✅ | ❌ |
| vision | `asset_analyses` | ⚠️ by asset_id FK | ❌ |
| workflows | `workflows` | ✅ | ❌ |
| agent_tasks | `agent_tasks` | ✅ | ❌ |
| scratchpad | `scratchpad_entries` | ✅ | ❌ |
| panels | `panels` | ✅ | ❌ |
| agent_messenger | `agent_messages` | ✅ | ❌ |
| tool_executions | `tool_executions` | ✅ | ❌ |

**Projects schema (the most important table for the AI OS):**
- `projects` — owner_user_id, status (active/archived), metadata
- `project_agents` — per-project agent overrides (system_prompt, role, model_hint, color, icon)
- `project_memory` — shared context for system-prompt injection (kind: note/fact/decision/agent_note/file_summary/system; source: user/agent/tool/system)
- `project_threads` — soft FK to `sessions.threads` (no PK enforcement)
- `project_files` — placeholder; actual bytes live in `ASSETS_STORAGE_BACKEND`

**Cross-subsystem cleanup:** ❌ No cascade. Deleting a project leaves orphans in 9 other stores. There is no sweeper/coordinator.

### 1.4 Frontend — actually present today

Pages: **28 total. 3 wired E2E, 4 partial, 21 UI demo.**

**Wired E2E:**
- `ChatDashboard.tsx` — `/chat`, `/v2/jobs`, `/auth/me`, streaming, polling, auth gate
- `AuthPage.tsx` — `/v2/auth/register`, `/v2/auth/login`, JWT, Google OAuth
- `ProjectWorkspace.tsx` — uses `projectStore` (localStorage today; backend-shape ready)

**Partial (UI complete, backend layer missing or local-only):**
- `AgentBuilder.tsx`, `AgentsPage.tsx` — local stores via `standaloneAgentStore`
- `HomeDashboard.tsx` — renders 12 widget stubs, no data
- `ProjectsDashboard.tsx` — CRUD UI complete, no backend sync

**UI demo (hardcoded data, `setTimeout` fake generation):**
- `MultiAgentSwarm.tsx`, `AppBuilder.tsx`, `BrandBuilder.tsx`, `EcommerceOS.tsx`, `StartupHub.tsx`, `WebsiteBuilder.tsx`, `WebsiteAnalyzer.tsx`, `Automations.tsx`, `KnowledgeVault.tsx`, `ExplorePage.tsx`, `ViralContent.tsx`, `ToolsPage.tsx`, `CreditsPage.tsx`, `SettingsPage.tsx`, marketing pages, `ComingSoon.tsx`, etc.

**Hooks that need a backend layer to make pages real:**
- `useAssets` (uploads — stubbed)
- `useCoordinatorPlan` (already has BE — `/v2/coordinator/plan`, but no FE page consumes it except chat)
- `useOrchestrationFeed` (already has BE — panels messages, but only chat consumes)
- `useScratchpad` (already has BE — `/v2/scratchpad/*`, no FE consumer)
- `useTools` / `useToolExecution` (BE live, no FE consumer)
- `useProjectActivity` (reads `projectStore` localStorage — ready for backend swap)

**Routing reality:** Sidebar.tsx focuses on chat sessions only. There is no central project/agent hub navigation. Users must know `/projects`, `/agents`, `/home` by URL or button CTA. The "command center" `HomeDashboard` is the closest thing to a hub but its widgets don't link out.

---

## Part II — Missing architecture (what blocks the vision)

The vision needs five capabilities the codebase doesn't yet have. Each maps to a concrete missing component:

### 2.1 Project Orchestrator — the conductor that doesn't exist

**Today:** A user types "build me a Shopify landing page". The coordinator can classify it as `should_spawn_panel=true`. A panel can be created. Agents can be invoked one at a time via `/v2/agent/execute` or `/v2/orchestrate`. The supervisor can `delegate` to sub-agents. **But there is no single service that takes the user request → resolves it into a multi-agent project plan → assigns agents → tracks them as one work unit.** Each piece is wired in isolation.

**Needed:** `backend/services/orchestrator/` — new service. Owns the lifecycle of *a project run*: takes the user request, decides which specialist agents to spawn, generates a task graph with dependencies, instantiates panel + agent_tasks rows, hands off to `run_agent` for each task, monitors via presence + messages, marks the project as completed when all leaf tasks are done.

### 2.2 Workflow DAG runner — schema without engine

**Today:** `workflows.db` has `WorkflowRecord` with `steps`, `current_step`, `progress`, `status`. `client.py` exposes `advance_step()` / `mark_status()` / `cancel()`. **There is no runner that reads dependencies and executes the next eligible step automatically.** Step progression is a manual FE-driven `POST`.

**Needed:** `backend/services/workflows/runner.py` — DAG executor. Walks the step graph, resolves dependencies, dispatches each step to either a job (`/v2/jobs`) or an agent task (`/v2/agents/{id}/tasks`), reacts to completion events, advances the next eligible step. Re-entrant: a crashed runner can resume from `current_step`.

### 2.3 Shared project context store — agents work blind to each other today

**Today:** Each `delegate()` snapshots project context once. The shared `scratch` dict lets sibling agents write to a shared in-memory dict, **but it's per-run and disappears**. `project_memory` exists in the projects schema but is a passive injection list — no agent can append a structured "I discovered the brand colors are #C42B2A" entry that the next agent reads.

**Needed:** Promote `project_memory` from passive injection to read-write workbench: append from agents (via a new `project.note` tool), version, source-attribute (which agent created it), schema-tag (decision/finding/asset/constraint). Inject relevant entries on every subsequent agent run.

### 2.4 Deliverable registry — no concept of "agent A is responsible for X"

**Today:** Agents produce text replies and (optionally) a `scratch` blob. There is no structured "agent X is responsible for producing deliverable Y by step Z; here is the output schema; here is the artifact". So the user can't see "Copywriting Agent: 3 of 4 deliverables done".

**Needed:** New `deliverables` table (project_id, agent_id, kind, schema, status, content, version). Each project run creates the deliverable scaffold up front (driven by the project template). Agents update them as they progress. FE renders them as a checklist.

### 2.5 The AI-OS frontend surface — backends exist, no shell renders them

**Today:** `useOrchestrationFeed`, `useAgentPresence`, `useScratchpad`, `useTools` all exist with real backends. **Only the chat surface consumes them.** ProjectWorkspace has the skeleton (agent message rendering, typewriter streaming) but uses localStorage.

**Needed:** Make `ProjectWorkspace` the central hub. Wire `useAgentPresence` to show online agents. Wire `useOrchestrationFeed` to show the live message timeline. Add a deliverables checklist. Add a task graph view. Make this the page a user lands on when they create a project — not the chat.

---

## Part III — Phase roadmap

Six phases. Each phase ships independently to production, gated by a feature flag, with a one-PR rollback path. Phases A–C are the critical path to the "5 agents build a Shopify landing page" demo. D–F are deepening + verticals.

| Phase | Theme | Goal | Est. weeks | Blocks |
|---|---|---|---|---|
| **A** | Orchestrator + DAG | The conductor that doesn't exist today. Workflow DAG runner + Project Orchestrator service + Deliverable registry. | 3 | B, C |
| **B** | Project hub UX | Wire `ProjectWorkspace` end-to-end. Make agents visible. The product starts feeling like an OS. | 3 | C |
| **C** | First vertical: Landing-page generator | Project template + 4 specialist agents (research, copy, design, frontend). Ship one end-to-end demo. | 3 | — |
| **D** | Persistence + Knowledge | Knowledge Vault backend (file upload + RAG). Postgres parity for top-3 stores. Cross-session search. | 3 | — |
| **E** | Multi-tenancy + governance | Org/team schema. Audit log. Approval gates for tool execution. | 2 | F |
| **F** | Verticals (parallel sub-tracks) | Coding workspace · Ecommerce store sync · Games · Deploy integrations. Each is its own sub-PR. | open | — |

### Phase A — Orchestrator + DAG (foundation)

| | |
|---|---|
| **Objective** | A single API call to `POST /v2/orchestrator/run` with `{user_request, project_id}` spawns the right specialist agents, executes them in dependency order, and writes a structured deliverable set the FE can render. |
| **User-facing features** | None directly — this is plumbing. Visible to the user via Phase B's UI. |
| **Backend tasks** | (A.1) Workflow DAG runner — `backend/services/workflows/runner.py`. Reads `WorkflowRecord.steps` (extend schema with `dependencies: list[step_id]`), resolves eligible steps, dispatches to a job or an agent task, reacts to completion events. Re-entrant + crash-safe. (A.2) Project Orchestrator service — `backend/services/orchestrator/`. Takes user request → coordinator classify → matches a project template → instantiates panel + agent_tasks + workflows + deliverables → kicks off the runner. (A.3) Deliverable registry — new SQLite store (then dual-backend). Schema: `id, project_id, run_id, agent_id, kind, content_schema_json, status, content_json, version, created_at, updated_at`. (A.4) Add `/v2/orchestrator/run`, `/v2/orchestrator/runs/{id}`, `/v2/orchestrator/runs/{id}/stream` (SSE). |
| **Frontend tasks** | None in Phase A. Routes exist for Phase B to consume. |
| **Data models** | New: `deliverables`. Extend `workflows` with `dependencies` per step. Extend `agent_tasks` with `deliverable_id`. No breaking changes — additive columns. |
| **Agent architecture** | Each project template (next phase) names the specialist roles. The orchestrator uses the existing 10 specs in `specs/builtins.py` as the base. New specs only added as needed per vertical (Phase C+). |
| **Job/task orchestration** | Steps dispatch to either: (a) `/v2/jobs` for non-LLM work (web research, file processing), or (b) `agent_tasks` + `run_agent()` for LLM work. The runner subscribes to job completion + task completion events to advance. |
| **Risks** | Cascade complexity — a long-running DAG run with 8 steps and 4 parallel agents could orphan resources on crash. **Mitigation:** every run gets a `run_id` propagated to every spawned resource; a sweeper marks orphans on the next runner startup. |
| **Dependencies** | None — uses existing agent runtime, jobs, panels, agent_tasks, workflows. |
| **Success criteria** | `POST /v2/orchestrator/run` with a hardcoded test template runs 3 agents in serial, then 2 in parallel, writes deliverables, completes. Cancel works. Crash + restart resumes. SSE stream emits one event per agent state change. Backend tests: 12+ covering happy path, dependency resolution, crash recovery, cancel. |
| **Complexity** | Medium-high (3 weeks, 1 dev). The hardest part is making the runner re-entrant. |

### Phase B — Project hub UX (visibility)

| | |
|---|---|
| **Objective** | `ProjectWorkspace.tsx` becomes the central product surface. A user lands on a project page and sees: live agent presence dots, real-time message feed, deliverable checklist, task graph, progress %. |
| **User-facing features** | Project workspace shows live agent activity. Sidebar shows projects as first-class nav (not just chat sessions). Real-time updates via SSE. |
| **Backend tasks** | (B.1) Wire `ProjectWorkspace` to `/v2/projects` (replace `projectStore` localStorage reads with real fetch). (B.2) Add `/v2/projects/{id}/deliverables` (list of deliverables for a project, scoped by run_id). (B.3) Ensure all Phase A SSE streams are CORS-cleared + JWT-gated. |
| **Frontend tasks** | (B.4) `ProjectWorkspace.tsx` — read from backend, subscribe to `/v2/orchestrator/runs/{id}/stream`. (B.5) New components: `AgentPresenceDots`, `DeliverableChecklist`, `TaskGraphView`, `RunProgressBar`. (B.6) Update sidebar: add Projects section above chats. (B.7) Update `useAgentPresence`, `useOrchestrationFeed` to point at active project's panel. |
| **Data models** | None new. Phase A's models drive all reads. |
| **Agent architecture** | Unchanged. |
| **Job/task orchestration** | Unchanged. |
| **Risks** | Real-time UI complexity — re-rendering on every SSE event can thrash. **Mitigation:** debounce + batch updates in a reducer-style hook. |
| **Dependencies** | Phase A (the routes + SSE streams). |
| **Success criteria** | A user creates a project via the FE, watches agents come online, sees messages stream into the timeline, sees a deliverable progress from `pending` → `in_progress` → `completed` without page refresh. The "AI OS feel" is achieved. |
| **Complexity** | Medium (3 weeks, 1 dev FE + 0.5 dev BE). |

### Phase C — First vertical: Landing-page generator

| | |
|---|---|
| **Objective** | Ship ONE end-to-end demo of the vision: "Build me a Shopify landing page for this product" → 4 agents collaborate → user receives a real HTML page + brand assets + copy. |
| **User-facing features** | New `/projects/new` flow with a "Landing Page" template card. Choosing it asks: product name + URL + audience. Submitting kicks off the orchestrator. The user watches it in Project Hub (Phase B). Final deliverables: brand brief (Brand Designer), 3 copy variants (Copywriter), 1 wireframe (UX Designer), 1 React/HTML page (Coder). Downloadable. |
| **Backend tasks** | (C.1) New project template: `LandingPageTemplate` defining the 4-agent DAG (research → brand+copy parallel → design → code → assemble). (C.2) Bundle the template into the orchestrator's catalog. (C.3) Extend `web_research` if needed to handle product-URL crawling. (C.4) Add `assemble_landing_page` job: combines deliverables into a final downloadable HTML/zip. |
| **Frontend tasks** | (C.5) Template picker page (one of several to come). (C.6) Deliverable preview: brand brief renders as cards, copy variants as A/B view, design as image, page as iframe preview + download. (C.7) "Iterate" button on each deliverable — re-runs that specific agent. |
| **Data models** | Extend `deliverables` with `download_url` (asset_id). Extend `project_templates` (new table) — `id, name, description, dag_json, default_agents_json`. |
| **Agent architecture** | Uses existing specs: `researcher`, `brand_designer`, `copywriter`, `ux_designer`, `coder`. No new specs needed for v1. Optional `qa_agent` later. |
| **Job/task orchestration** | DAG: research → [brand_designer ∥ copywriter] → ux_designer (consumes brand) → coder (consumes copy + wireframe) → assemble_job. |
| **Risks** | Quality. The first end-to-end demo defines user expectations. If the generated page is bad, the moat narrative breaks. **Mitigation:** ship as "Preview" / beta-flagged. Iterate on agent prompts based on real runs. |
| **Dependencies** | Phases A + B. |
| **Success criteria** | A new user can sign up, click "Build a Landing Page", input a product, and receive a working HTML page in under 5 minutes. ≥ 70% of generated pages rated 3/5 or better in informal review. |
| **Complexity** | Medium (3 weeks, 1 dev). Heavier on prompt engineering than code. |

### Phase D — Persistence + Knowledge

| | |
|---|---|
| **Objective** | Files, uploads, RAG, cross-session search. The knowledge layer that makes the OS durable across sessions. |
| **User-facing features** | Knowledge Vault: upload PDFs/docs/images. Search across all projects/chats. Reference uploaded files from any agent. |
| **Backend tasks** | (D.1) Wire `useAssets` → `/v2/assets` (already exists; just need FE integration). (D.2) Build RAG indexer for uploaded files (extract text → chunk → embed → store in memory_plane). (D.3) Add `/v2/search` — global search across chats, projects, memory, files. (D.4) Postgres parity for top-3 stores: `jobs`, `assets`, `agent_tasks` (the ones that block scaling). |
| **Frontend tasks** | (D.5) Wire Knowledge Vault page. (D.6) Add Cmd+K global search modal. (D.7) Add "Reference files" picker to chat composer. |
| **Data models** | Extend `assets` with `indexed_at`, `text_extracted`, `chunk_count`. New `search_index` view. |
| **Agent architecture** | New tool: `query_knowledge_base` (searches memory_plane + indexed files). Agents can cite uploaded files. |
| **Risks** | Embedding cost. Indexing every upload via OpenAI embeddings adds spend. **Mitigation:** rate-limit + use smaller embedding model for indexing. |
| **Dependencies** | None — independent track. Can run in parallel with C. |
| **Success criteria** | Upload a 10-page PDF, ask an agent "what does it say about pricing", agent cites correct page. Global search returns relevant chat snippets + project deliverables. |
| **Complexity** | Medium (3 weeks). |

### Phase E — Multi-tenancy + governance

| | |
|---|---|
| **Objective** | Org/team schema, audit log, tool approval gates. Required before any enterprise pitch. |
| **User-facing features** | Create teams. Invite users. Shared projects. Admin sees audit log. |
| **Backend tasks** | (E.1) Schema additions: `orgs`, `org_members`, `org_invitations`. Extend `workspaces`, `projects`, `memory_items` with `org_id` + `access_level`. (E.2) New `audit_log` table — append-only cross-subsystem event log. (E.3) Tool approval gates — tools tagged `requires_approval` queue an approval request; admin approves via dashboard. (E.4) Cross-subsystem cascade-on-delete coordinator (project delete → fans out cleanup to all 9 stores). |
| **Frontend tasks** | (E.5) Settings → Team Management page. (E.6) Admin dashboard. (E.7) Approval inbox for owners. |
| **Data models** | 6 new tables. ~12 columns added across existing tables. Backward-compatible (default `org_id = null` = personal). |
| **Agent architecture** | Tools become permission-aware. Approval flow blocks tool execution until approved. |
| **Risks** | Schema migration on production data. **Mitigation:** all additions are `ADD COLUMN ... DEFAULT NULL`. No backfill required. |
| **Dependencies** | None — can run in parallel with C/D. |
| **Success criteria** | A user creates an org, invites 2 teammates, all 3 collaborate on the same project, admin sees the audit log of who did what. |
| **Complexity** | Medium-high (2 weeks for schema + audit; 1 more for approval flow if scope creeps). |

### Phase F — Verticals (parallel sub-tracks)

Each sub-track is its own 2–3 week sprint. Pick based on user demand. Same orchestrator + same FE shell from A/B; only the project template + new tools differ.

| Sub-track | New specs + tools | Notes |
|---|---|---|
| **Coding workspace** | `architect_agent`, `test_agent`. New tools: `code_executor` (sandboxed Deno/Node), `code_review_tool`, `unit_test_runner`. FE: Monaco editor, file tree, run panel. | Hardest sub-track. Sandbox safety is the blocker. Replit/Modal/Daytona as candidates for execution backend. |
| **Ecommerce / Shopify** | `merchant_research_agent`, `pricing_agent`, `listing_agent`. Implement `ecommerce_research_tool` (Minea or Meta Ad Library). New `shopify_sync_tool` (Shopify GraphQL). | Backend integration heavy. Requires Shopify partner app. |
| **Game creation** | `game_designer_agent`, `script_writer_agent`, `asset_planner_agent`, `monetization_agent`. New tools: `roblox_lua_validator`, `unity_csharp_validator`. | Pure-text MVP first (concept doc + scripts). No engine integration. |
| **Deploy integrations** | New tools: `vercel_deploy`, `railway_deploy`, `cloudflare_pages_deploy`. Optional `deploy_agent` spec that owns the publish flow. | Smallest sub-track. Tool-heavy, no FE shell needed beyond a deploy button. |
| **Web research deep mode** | Already have web_research. Add JS-rendering: swap urllib for Playwright behind a flag. New `competitor_intel_agent` spec. | Operational cost — Playwright workers are expensive. |

---

## Part IV — First 3 implementation PRs (detailed)

Designed to land in 3 weeks, in order. Each one ships to production behind a feature flag.

### PR #1 — Workflow DAG runner

| | |
|---|---|
| **Objective** | Turn `workflows.db` from a CRUD shell into an executable graph. Foundation for Phase A. |
| **Files to modify** | `backend/services/workflows/types.py` (extend `Step` with `dependencies`, `kind: "job" \| "agent_task"`, `payload`). `backend/services/workflows/store.py` (additive migration). NEW `backend/services/workflows/runner.py` (the executor). NEW `backend/services/workflows/events.py` (completion subscription). |
| **Architecture changes** | The runner is a long-lived async task per workflow run. It subscribes to job-completion events (existing `jobs/events.py`) AND agent-task-completion events. On each event, recomputes eligible steps (dependencies satisfied + not yet started), dispatches them, sleeps until the next event. Re-entrant: restart reads `current_step` + dispatched-step-set from DB. |
| **Database changes** | `workflows` table: add `dependencies_json TEXT NOT NULL DEFAULT '[]'` per step (within existing `steps` JSON; no schema column needed). Add `run_id TEXT` to `jobs` and `agent_tasks` so events can be traced back to a workflow run. |
| **API changes** | New `POST /v2/workflows/{id}/run` → returns `run_id`. `GET /v2/workflows/runs/{run_id}` → status snapshot. `GET /v2/workflows/runs/{run_id}/stream` → SSE. |
| **Frontend changes** | None — this is plumbing for PR #2 to consume. |
| **Security considerations** | Workflow runs inherit the requesting user's identity (JWT). All spawned jobs/tasks carry the same `user_id`. No new attack surface. |
| **Testing requirements** | Backend tests covering: linear DAG (3 steps), parallel fan-out (1→3 parallel→1 join), missing dependency = wait, crash + restart, cancel propagates to in-flight steps. Min 10 tests. |
| **Potential risks** | (a) Event-loop deadlock if completion event triggers another step in the same async task. **Mitigation:** dispatch via `asyncio.create_task` instead of awaiting. (b) Orphan runs if API crashes mid-dispatch. **Mitigation:** sweeper task runs at startup, finds dispatched-but-no-event steps, marks as `failed` so the user sees the truth instead of "stuck running". |
| **Dependencies** | Phase A.1 ONLY. Does not require A.2/A.3/A.4 — those build on top. |
| **Effort** | ~5 dev-days. |

### PR #2 — Project Orchestrator service

| | |
|---|---|
| **Objective** | The conductor. Takes a user request, decides agents + DAG, kicks off the runner from PR #1. |
| **Files to modify** | NEW `backend/services/orchestrator/` package. NEW `backend/services/orchestrator/templates/` (project templates). NEW `backend/routes/v2_orchestrator.py`. Use existing `backend/services/coordinator/coordinator.py` for the classification. |
| **Architecture changes** | New service. Reads coordinator's plan output, picks a template (or generates an ad-hoc one from the plan's agent list), instantiates: 1 panel + N agent_tasks + 1 workflow with the agents' execution as steps → calls workflow runner from PR #1. |
| **Database changes** | NEW table `deliverables` (id, project_id, run_id, agent_id, kind, status, content_json, version, created_at, updated_at). NEW table `project_templates` (id, name, description, dag_template_json). Seed table with 2–3 starter templates (the Phase C landing-page template ships in PR #3). |
| **API changes** | `POST /v2/orchestrator/run` body `{user_request: str, project_id?: str, template_id?: str}` → returns `{run_id, panel_id, agent_tasks: [...]}`. `GET /v2/orchestrator/runs/{run_id}` snapshot. `GET /v2/orchestrator/runs/{run_id}/stream` SSE. |
| **Frontend changes** | None in PR #2 — PR #3 consumes. |
| **Security considerations** | User-scoped: `project_id` must belong to caller. Templates are read-only initially (no user-defined templates in PR #2). |
| **Testing requirements** | Tests covering: template-driven run, ad-hoc plan-driven run, deliverable progression, panel + tasks created with correct user_id, cancel cascades. Min 8 tests. |
| **Potential risks** | (a) Template proliferation — too many templates = maintenance burden. **Mitigation:** PR #2 ships 2 (generic-research, generic-creation); PR #3 ships landing-page. Hard cap of 5 until usage data justifies more. (b) Deliverable schema lock-in — first version's schema is hard to migrate later. **Mitigation:** keep `content_json` as opaque JSON. Only `status` and `kind` are typed. |
| **Dependencies** | PR #1. |
| **Effort** | ~5 dev-days. |

### PR #3 — `ProjectWorkspace` wired to the orchestrator + Landing-Page template

| | |
|---|---|
| **Objective** | First user-visible AI-OS moment. A user submits "build me a landing page for X" and watches 4 agents collaborate in real time on the Project Workspace page. |
| **Files to modify** | `src/pages/ProjectWorkspace.tsx` (replace localStorage reads with `/v2/projects` + subscribe to orchestrator SSE). `src/hooks/useAgentPresence.ts` (already exists — scope to project panel). `src/hooks/useOrchestrationFeed.ts` (already exists). NEW `src/components/DeliverableChecklist.tsx`. NEW `src/components/AgentPresenceDots.tsx`. NEW `backend/services/orchestrator/templates/landing_page.py`. |
| **Architecture changes** | FE subscribes to SSE on mount, applies events to local reducer state. Each deliverable renders by `kind` (brand_brief → card, copy_variants → A/B view, wireframe → image, landing_page_html → iframe). |
| **Database changes** | None new. PR #2's `deliverables` + `project_templates` tables. |
| **API changes** | None new. Uses PR #2's routes. |
| **Frontend changes** | (a) Project Workspace becomes a real-time view. (b) New project flow: pick template, fill 3 inputs, submit. (c) Per-deliverable "Iterate" button that re-runs that agent. |
| **Security considerations** | None new — JWT-gated routes from PR #2. |
| **Testing requirements** | FE: no test infra yet (defer to Phase E vitest setup). Manual verification per the standard 5-check protocol + a new "happy path landing page" scenario. BE: 3 tests for the landing-page template's DAG resolution. |
| **Potential risks** | (a) First impression — bad output ruins the moat narrative. **Mitigation:** Ship behind `ENABLE_LANDING_PAGE_TEMPLATE=true`, dogfood internally first. (b) FE complexity creep — temptation to build the full hub in one PR. **Mitigation:** PR #3 ships ONLY the landing-page template view; sidebar Projects nav + multi-template picker = follow-up PR. |
| **Dependencies** | PR #1 + PR #2. |
| **Effort** | ~7 dev-days. |

### Aggregate

| | |
|---|---|
| Single-developer end-to-end (3 PRs) | 17 dev-days |
| Elapsed (1 dev, parallelisable QA) | 3–4 weeks |

---

## Part V — Risks, sequencing, dependencies

### 5.1 Cross-phase critical path

```
PR #1 (DAG runner) ─┐
                    ├─→ PR #2 (Orchestrator) ──→ PR #3 (Landing page demo) ──→ Phase C done
                    └─→ Phase B (hub UX)                                       
                                                                              
Phase D (knowledge) ─── independent ─── can run any time
Phase E (multi-tenant) ── independent ── can run any time (needed before any enterprise sales motion)
Phase F (verticals) ─── after Phase B at minimum
```

### 5.2 Production-safety rules (carried from auth work)

Each PR ships behind an env flag (default `false`) so a bad release is reverted by flipping a flag, not by code rollback. The flags:

| Flag | Default | Controls |
|---|---|---|
| `ENABLE_WORKFLOW_RUNNER` | `false` | PR #1 — runner activates |
| `ENABLE_PROJECT_ORCHESTRATOR` | `false` | PR #2 — orchestrator routes |
| `ENABLE_LANDING_PAGE_TEMPLATE` | `false` | PR #3 — template visible in UI |

### 5.3 Risks ranked by likely impact

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| First end-to-end demo (Phase C) generates poor-quality output | High | High — narrative collapse | Internal dogfood ≥1 week before public; per-deliverable "Iterate" affordance shipped in PR #3 |
| Workflow runner re-entrancy bug causes stuck "running" rows | Medium | Medium — confusing UX | Sweeper task on startup; visible "Stuck? Cancel" button in UI |
| SSE connection limits on Railway under load | Medium | Medium | Connection-count metric; throttle if exceeded; long-poll fallback |
| Agent prompts drift quality as new templates are added | Medium-high (in Phase F) | Medium | Per-template eval harness; canary template gets dogfood-week before shipping |
| Postgres migration risk for stores currently on SQLite (Phase D) | Low (additive) | Low | Memory plane already proves the dual-backend pattern works |
| Multi-tenancy schema migration on prod data (Phase E) | Low (all additive) | Low | Default `org_id = null` = personal; no backfill |
| Scope creep into Phase F before Phase C ships | High | High — delays demo moat | Hard rule: NO Phase F work until Phase C in production for ≥2 weeks |

### 5.4 What this roadmap explicitly does NOT do

- ❌ **Does not refactor the agent runtime.** It works. Don't touch it.
- ❌ **Does not unify the two-table auth identity** (still tracked in `AUTH_AUDIT_PHASE_1.md` for PR #4 Guest Merge — independent).
- ❌ **Does not migrate all 12 SQLite stores to Postgres in one go.** Top-3 only in Phase D (jobs, assets, agent_tasks). The rest stay on SQLite until a second growth signal.
- ❌ **Does not commit to a deployment integration** (Vercel, Railway). Phase F sub-track. Optional.
- ❌ **Does not promise multi-region / horizontal scaling.** Single Railway instance assumption holds until traffic forces otherwise.
- ❌ **Does not pivot the FE framework.** React + Vite + Tailwind stays.

---

## Appendix A — Open questions for sign-off

Six. Same shape as the auth audit's open questions.

1. **Phase ordering — confirm.** A → B → C is the critical path to the "5 agents build a landing page" demo. Do you agree the demo is the highest-priority outcome (vs e.g. Phase D / Knowledge Vault first)?

2. **First vertical — landing-page generator.** I picked landing pages over ecommerce/code/games because (a) lowest infra dependency, (b) clearest deliverable, (c) testable in 5 min. Override? (Alternatives: Shopify store gen requires partner-app setup; coding workspace requires sandbox decision; games is text-only MVP only.)

3. **Sub-tracks in Phase F — priority.** When Phase C ships, what's next? Coding workspace, Ecommerce, Games, or Deploy? My lean: **Coding workspace** — highest engineering moat + many users want it. Override?

4. **Postgres migration scope (Phase D).** Top-3 stores get PG parity (jobs, assets, agent_tasks). Rest stay SQLite. Comfortable with that scope, or push for all 12 in one shot?

5. **Multi-tenancy timing (Phase E).** Independent track — can ship anytime. My lean: **after Phase C** so the orchestrator first works for single-user, then we add team semantics. Override only if you have a near-term enterprise pilot.

6. **Feature-flag rollout strategy.** Each PR ships gated `false`. Once verified, we flip to `true` for everyone (no per-user beta). Alternative: per-user / per-org canary. Beta canary is more complex but safer. Vote?

---

## Appendix B — Files that already implement large chunks of the work

Avoid re-implementing these. Reuse:

- `backend/services/agent/runtime.py` — agent tool-call loop (don't touch)
- `backend/services/agent/delegate.py` — delegate primitive (don't touch)
- `backend/services/agent/specs/builtins.py` — 10 specs (extend, don't replace)
- `backend/services/agent/provider_router.py` — multi-provider routing (use as-is)
- `backend/services/coordinator/coordinator.py` — plan + classify (use as-is)
- `backend/services/panels/store.py` — panel lifecycle (use as-is)
- `backend/services/agent_messenger/store.py` — typed inter-agent messaging (use as-is)
- `backend/services/agent_presence/client.py` — presence (use as-is)
- `backend/services/agent_tasks/store.py` — task lifecycle (use as-is)
- `backend/services/jobs/runner.py` — InlineJobRunner (use as-is for Phase A; Celery later)
- `backend/services/workflows/store.py` — workflow CRUD (extend with `dependencies` field)
- `backend/services/memory_plane/store.py` — dual-backend pattern (model for future PG migrations)
- `backend/services/tools/tool_registry.py` — tool registry (extend, don't replace)
- `src/pages/ProjectWorkspace.tsx` — 75% scaffolded already
- `src/hooks/useAgentPresence.ts`, `useOrchestrationFeed.ts`, `useScratchpad.ts` — existing hooks ready to wire

---

**End of roadmap. Awaiting sign-off before PR #1.**
