# KorvixAI — AI Operating System Roadmap

**Status:** strategic plan. No code change is bundled with this document.
Implementation begins only after explicit approval, phase by phase.

**Vision.** Move KorvixAI from a vertical trading chatbot into a *general AI
operating system* for operators: founders, traders, e-commerce builders,
researchers. The system should feel alive, context-aware, proactive, and
capable of doing real work across multi-step tasks — not just answering one
prompt.

**Constraints inherited from prior phases.**
- Do not break production. `/chat` endpoint name, request shape, and the
  required response fields stay fixed.
- Railway start command stays `uvicorn api:app --host 0.0.0.0 --port $PORT`.
- All new behavior is gated behind feature flags. Production unchanged
  until each flag is flipped on.
- Trading layer (Phase 4 → 5.3) is preserved as a domain module under the
  new agent shell — it does not get rewritten.

---

## 1. Current-State Architecture Analysis

### 1.1 What we have

| Layer | Files | Lines | State |
|---|---|---|---|
| HTTP entry | `api.py` (repo root), `backend/api.py` | ~325 | Solid 3-layer fallback; never crashes on startup |
| Routes | `backend/routes/{chat,health,memory,auth,profile,stats,tools}.py` | ~8 files | Flat; healthy enough but needs domain grouping |
| Mode system | `backend/services/ai/{mode_manager,prompt_manager,model_manager}.py` | ~900 | 9 canonical modes, alias map, model + temperature config |
| Tool system (new) | `backend/services/tools/*` | ~2 500 | BaseTool + registry + orchestrator + market_data/macro_data tools, feature-flagged |
| Tool system (legacy) | `agent.py` (root), `data_sources.py`, `finance.py`, `ecommerce.py` | ~530 | Single-shot fan-out fetcher (price/news/web) still called by `ai_service.py` for non-trading intents |
| Memory (root) | `memory.py` | 244 | SQLite (`memory.db`): `user_memory`, `user_style` tables |
| Memory (legacy DB) | `db.py` | 284 | Separate SQLite file with `memory`, `tasks`, `chat_history`, `portfolio`, `users` tables |
| Memory bridge | `backend/services/memory_service.py` | 103 | Thin wrapper over `memory.py` |
| Trading memory | `backend/services/trading/thesis_memory.py` | 122 | In-process LRU, per (user, symbol) |
| Cache (new) | `backend/services/cache/__init__.py` | 104 | TTL LRU + per-provider counters |
| Safety (new) | `backend/services/safety/guard.py` | 167 | Length cap + injection blocklist + per-min throttle |
| Frontend chat | `src/pages/ChatDashboard.tsx`, `src/components/*`, `src/hooks/useChat.ts` | ~2 000 | Polished surface; localStorage-only sessions |
| Frontend UI kit | `src/components/ui/*` (60+ shadcn components) | ~4 500 | Workspace UX is feasible without much new UI work |

### 1.2 Architectural debts to retire before scale-out

These will compound if we keep adding features around them.

1. **Two parallel tool systems.** `agent.py` (root) and `backend/services/tools/*` both serve research/data fetch. `ai_service.py` calls both. We must consolidate around `BaseTool` and retire `agent.py` as a tool host — leaving only research-mode helpers behind for legacy intents during the transition.
2. **Three places to store user memory.** `memory.db` (root memory.py), the legacy DB in `db.py`, and the in-process thesis cache. Different tables, different schemas, no migration path. We need a single durable memory service.
3. **No server-side chat sessions.** `placeholderChats` lives in localStorage. A user who clears their browser loses everything; a second device sees a different state. Mandatory before "feels alive across devices".
4. **No agent loop.** `agent.py:run_tools` is a single-shot fan-out — no plan, no reflect, no tool-chaining. Multi-step reasoning is not possible today.
5. **No background workers.** Everything is request-scoped. "Proactive" notifications, scheduled briefings, watchlist alerts all require a worker.
6. **Frontend mode mismatch.** Until last week, frontend sent `deep-think` and backend expected `deep_think`. Patched, but it shows mode IDs aren't formalized. The mode contract must live in one shared schema, not be re-invented per side.
7. **`/chat` does too much.** Memory shortcuts, style detection, intent routing, mode routing, fallback routing, tool execution, AI call, signal extraction, response shaping — all in one route handler. Split into pipeline stages.

### 1.3 What's already good (preserve)

- 3-layer ASGI fallback in `backend/api.py` — startup is unbreakable.
- Mode registry pattern (`AIMode` dataclass + alias map) — reuse for any new domain mode.
- `BaseTool` + `tool_registry` — already the right shape, just under-utilized.
- Safety guard module — easy to extend with output filters in later phases.
- TTL cache + per-provider counters — already the right primitive for the agent's tool-call cache.
- Phase 5.3 deploy-verification workflow — gives us a programmable signal for "production is live with build X".
- shadcn UI kit is comprehensive — workspace shell can be assembled from existing primitives.

---

## 2. North-Star Architecture (target topology)

```
                         ┌─────────────────────────────────────────────┐
                         │              Frontend (Vercel)              │
                         │  React + Vite — Workspace shell             │
                         │  Chat · Threads · Files · Tasks · Workflows │
                         │  Citations · Signal cards · Live status     │
                         └────────────────┬────────────────────────────┘
                                          │  REST + (later) SSE/WS
                                          ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                       Backend (Railway, FastAPI)                             │
│                                                                              │
│  Routes (domain-grouped)                                                     │
│   ├── /chat        (delegates to Agent Runtime)                              │
│   ├── /sessions    (server-side chat session CRUD)                           │
│   ├── /workspaces  (workspace + thread + file CRUD)                          │
│   ├── /memory      (long-term memory CRUD)                                   │
│   ├── /tools       (health, registry, capability discovery)                  │
│   └── /workflows   (saved multi-step workflows, runs, schedules)             │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐    │
│  │  Agent Runtime  (the new orchestrator)                               │    │
│  │  ├─ Planner       : turns the user message + context into a plan     │    │
│  │  ├─ Executor      : runs steps (tool calls, sub-tasks, LLM passes)   │    │
│  │  ├─ Reflector     : checks output, decides next step, can loop       │    │
│  │  ├─ Toolbelt      : capability-typed tool discovery (BaseTool reg.)  │    │
│  │  ├─ Context Builder: pulls memory + session + workspace + tool data  │    │
│  │  └─ Response Composer: structured payload + trace                    │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐    │
│  │  Memory Service  (unified — replaces 3 fragmented stores)            │    │
│  │  ├─ short-term : conversation window (in-mem; per-session)           │    │
│  │  ├─ episodic   : per-user facts, summaries, prior theses (SQLite/PG) │    │
│  │  ├─ semantic   : embeddings index for retrieval (Phase M3+)          │    │
│  │  └─ workspace  : per-project notes, files, pinned artifacts          │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌─────────────────────────┐  ┌──────────────────────────────────────────┐   │
│  │  Tools (BaseTool reg.)  │  │  Domain Modules                          │   │
│  │  ├─ market_data         │  │  ├─ trading/   (Phases 4–5.3)            │   │
│  │  ├─ macro_data          │  │  ├─ ecommerce/ (Phase B-series)          │   │
│  │  ├─ web_research        │  │  ├─ startup/   (Phase B-series)          │   │
│  │  ├─ news / citations    │  │  ├─ writing/   (Phase B-series)          │   │
│  │  ├─ file / docs         │  │  └─ research/  (Phase R-series)          │   │
│  │  ├─ code execution      │  └──────────────────────────────────────────┘   │
│  │  └─ memory ops          │                                                 │
│  └─────────────────────────┘                                                 │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐    │
│  │  Cross-cutting                                                       │    │
│  │  ├─ cache (TTL LRU, swap for Redis later)                            │    │
│  │  ├─ safety guard (input + output filters + audit)                    │    │
│  │  ├─ telemetry (request id, trace, metrics → /tools/health)           │    │
│  │  └─ background worker (APScheduler now, queue later)                 │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Three invariants we will keep across every phase:**
1. **`/chat` contract stays stable.** All new features add fields to
   `metadata`; nothing removed, nothing renamed.
2. **Every new module ships behind a feature flag.** Default-off until proven
   stable in staging-style smoke tests against production.
3. **Reversibility.** Each phase has a one-flag rollback. No phase requires a
   migration that can't be backed out.

---

## 3. Master Roadmap (phases 6 → 12)

Trading expansion (Phases 6A-6D from the prior roadmap) is **deprioritized
but not deleted**. They re-enter the queue after the OS foundation is stable.

| # | Phase | Theme | Outcome | Risk | Reversibility |
|---|---|---|---|---|---|
| 6 | **M-series** Memory unification | Single memory service, server-side sessions | Cross-device continuity; "alive" feel | M | High (legacy stores read-only during cut-over) |
| 7 | **A-series** Agent runtime | Plan → Execute → Reflect loop, function calling | Multi-step reasoning, real work | M | High (legacy single-shot path stays for non-agent intents) |
| 8 | **R-series** Research mode | Web research provider, citation engine, deep-research workflow | Premium research experience | L | High (provider-flag) |
| 9 | **W-series** Workspace UX | Workspaces, threads, files, pinned artifacts, command palette upgrades | "Operator-grade" surface | M | High (workspace = additive route + frontend section) |
| 10 | **B-series** Business operator tools | E-commerce + startup + writing modules wired through the agent | Real operator work | M | High |
| 11 | **P-series** Premium polish | Streaming, presence, proactive briefings, design pass | "Alive + premium" feel | L | High |
| 12 | **T-series** Resume trading expansion | Position manager, alerts, journal, ETF/CPI/FED feeds | Best-in-class trading desk | M | High |

Each phase has 2–5 numbered milestones (e.g. `M1`, `M2`, …) that each map to a
single PR with one merge-able diff. No milestone touches more than 3 modules
unless it's a documented refactor.

### 3.1 Why this order

- **Memory first (M)** because every later phase depends on it. The agent
  cannot maintain task state without persistent sessions. Research can't
  surface "what we found yesterday" without episodic memory. Workspaces can't
  exist without server-side persistence.
- **Agent runtime second (A)** because every domain module gets simpler once
  there's a real orchestrator. Trading, research, business modules all become
  tool-and-prompt registrations behind the agent, not bespoke routing in
  `ai_service.py`.
- **Research third (R)** because it's the first capability that exercises the
  agent loop in a low-risk way (citations are read-only, no economic risk
  like a trade) and validates the multi-step pattern before bigger phases.
- **Workspace fourth (W)** because by now the data model (sessions, memory,
  agent traces) is rich enough to be worth a workspace shell.
- **Business modules fifth (B)** because they need agent + research + memory
  to feel real. Building them earlier would mean re-doing them.
- **Premium polish sixth (P)** because polish over a stable architecture is
  10× cheaper than polish over a moving target.
- **Trading resumes last (T)** because the new agent + memory makes Position
  Manager and Alerts almost trivial — they become two new tools and a worker
  job, not a new subsystem.

---

## 4. Modular Phase System

### 4.1 Anatomy of a phase

Every phase ships as **2–5 milestones**, each:
- A single PR with a focused diff (target: < 600 lines net change).
- A single feature flag (`ENABLE_<FEATURE>` env var) defaulting to **off**.
- A single smoke test bundle (AST + unit + integration where possible).
- A `data_quality`/`status` style "missing" field where applicable, so the
  AI and frontend always know when a component is in degraded mode.
- A documented one-line rollback (revert PR or flip flag).

### 4.2 Composition rules

- Phases compose **left-to-right** in the table above. A later phase may read
  from an earlier phase's module but never the reverse.
- A new domain module (e.g. `ecommerce_operator`) is *just* a directory under
  `backend/services/domains/<name>/` registering tools + an AIMode entry. It
  never reaches into the agent runtime internals.
- Cross-cutting modules (cache, safety, telemetry) expose tiny, stable APIs.
  Domain code uses them as black boxes.

### 4.3 Definition of done for a milestone

A milestone is done only when **all** of the following hold:
1. AST/typecheck clean for every touched file.
2. Smoke test bundle passes locally.
3. Feature flag tested in both states (on + off) — production is unchanged
   in the off state.
4. `metadata.<feature>` shape documented in TOOLS_ARCHITECTURE.md.
5. PR merged to `main`; `railway/production-deploy` commit status reaches
   `success` (Phase 5.3 workflow).
6. One follow-up issue opened for any deferred polish noted during review.

---

## 5. Backend Structure Proposal

### 5.1 Target directory layout (incremental, not all at once)

```
backend/
├── api.py                          (unchanged — 3-layer ASGI)
├── core/                           (config, errors, logging, middleware, responses)
├── routes/
│   ├── chat.py                     (thin → delegates to agent runtime)
│   ├── sessions.py                 (NEW M2 — server-side chat sessions CRUD)
│   ├── workspaces.py               (NEW W1 — workspaces + threads CRUD)
│   ├── memory.py                   (existing; broadened to all memory types)
│   ├── workflows.py                (NEW A4 — saved workflows + runs)
│   ├── tools.py                    (existing; add /tools/capabilities)
│   ├── auth.py / profile.py / stats.py / health.py (existing)
├── schemas/                        (Pydantic — chat, session, workspace, agent step, …)
├── services/
│   ├── ai/                         (mode_manager, prompt_manager, model_manager)
│   ├── agent/                      (NEW A-series — planner / executor / reflector / context)
│   ├── memory/                     (NEW M-series — unified memory service)
│   │   ├── store.py                (SQLAlchemy or raw SQLite repo)
│   │   ├── short_term.py           (conversation window cache)
│   │   ├── episodic.py             (facts / preferences / summaries)
│   │   ├── semantic.py             (embeddings; Phase M3)
│   │   └── workspace.py            (notes/files/artifacts)
│   ├── tools/                      (existing — extend with web_research, news, file, code)
│   ├── safety/                     (existing — extend with output filters)
│   ├── cache/                      (existing)
│   ├── trading/                    (Phase 4–5.3 — preserved)
│   ├── research/                   (NEW R-series — provider abstraction + citation engine)
│   ├── domains/
│   │   ├── ecommerce/              (NEW B1)
│   │   ├── startup/                (NEW B2)
│   │   ├── writing/                (NEW B3)
│   │   └── coding/                 (existing logic relocated here)
│   ├── workers/                    (NEW P-series — APScheduler jobs: briefings, alerts)
│   └── telemetry/                  (NEW — trace id, metric counters, /tools/health bridge)
└── utils/                          (existing)
```

### 5.2 Module contracts

- **Agent runtime** exposes one entry point: `await run_agent(request, ctx) -> AgentResponse`.
  Everything else inside (planner/executor/reflector) is private.
- **Memory service** exposes `MemoryClient`: `remember`, `recall`, `forget`,
  `summarize`, `search_semantic`. Internal stores are hidden.
- **Tool registry** is the single source of capability discovery. Adding a
  capability never requires touching the agent runtime — only registering a
  new `BaseTool`.
- **Domain modules** declare:
  1. An `AIMode` (or a contribution to an existing mode's tool list).
  2. Zero or more `BaseTool` registrations.
  3. Zero or more `Workflow` definitions.
  4. Optional prompt fragments (composed by `prompt_manager`).

### 5.3 What we delete (eventually)

After memory cut-over (Phase M2) and agent cut-over (Phase A3) the following
become dead code and can be removed in a documented cleanup PR:

- `memory.py` at the repo root (replaced by `services/memory/`).
- The `memory` table in `db.py` (migrated into the unified store).
- `agent.py` at the repo root (replaced by `services/agent/`).
- The dual-routing in `ai_service.py:process_chat` (replaced by the agent
  pipeline; `ai_service.py` becomes a thin compatibility shim until callers
  migrate).

Deletion happens **only after** the new module has run in production for at
least 7 days with no escalations.

---

## 6. Frontend Evolution Plan

### 6.1 From "chat page" to "workspace"

Today: one big `ChatDashboard.tsx` with a sidebar of sessions stored in
localStorage.

Target: a *workspace shell* with three panes — left rail of workspaces +
threads, central thread view, right inspector for context (memory, tools
used, citations, trace). The chat is the central pane, not the whole app.

### 6.2 Milestones (W-series)

| # | Milestone | Surface |
|---|---|---|
| W1 | **Server-side sessions client** — `useChat` reads/writes `/sessions/*`; localStorage becomes a cache, not the source of truth. Optimistic UI preserved. | Existing `ChatDashboard` |
| W2 | **Workspace shell** — left rail re-organised: Workspace → Threads. Same look, new data model. | New `WorkspaceLayout.tsx`, reuses sidebar primitives |
| W3 | **Inspector pane** — collapsible right rail showing: memory facts used, tools called (with timing + status), citations, agent trace (if expanded). | New `InspectorPane.tsx`, fed by `metadata.trace` |
| W4 | **Files & artifacts** — drop a file or paste a link → it appears as an artifact pinned to the thread; agent can reference it. | New `Artifacts/*` components |
| W5 | **Command palette upgrades** — slash-commands wired to workflows, mode switching, memory recall, "ask in another mode". | Extend existing `CommandPalette.tsx` |
| W6 | **Streaming + presence** — SSE/WS so partial tokens stream in; "thinking…" turns into the inspector showing live tool calls. | Backend P-series; frontend wiring |
| W7 | **Design pass** — typography scale, motion polish, dark-light parity, mobile workspace mode. | Pure CSS/Tailwind |

### 6.3 What stays untouched

- The existing `MessageBubble`, `TradingSignalCard`, `MarkdownMessage`,
  `AIModeSelector`, `Onboarding`, `CommandPalette`, `PinnedMessages`,
  `ExportChat` components are reused as-is — they fit cleanly into the new
  shell. None of the chat-side UX work is wasted.
- The `useChat` hook keeps the same public surface; only its internals
  switch from localStorage-first to server-first.

### 6.4 Premium signals (the "feel alive" details)

These are tiny but cumulative; we sprinkle them across phases, not in one big
visual-redesign milestone.

- Subtle typing pulse linked to actual streaming tokens (not a fake animation).
- Inspector shows tool calls *as they happen* with elapsed time per call.
- "Recent threads" rail reorders by recency-of-meaningful-activity, not
  recency-of-bot-reply.
- The trading card and (future) research card share a visual language
  (status pill + level grid + meters + action lists) — one design system.
- Empty states recommend something specific based on user history, not
  generic prompts.
- Error chips remain typed and styled per cause (Phase 5.2 pattern extends to
  all error surfaces).

---

## 7. Memory System Design (M-series)

### 7.1 Goals

1. **Single source of truth** for per-user facts and conversation state.
2. **Cross-device continuity** — a user on phone sees the same threads as on
   desktop.
3. **Cross-thread recall** — the agent can reference yesterday's discussion
   in a new thread (with user consent, scoped to workspace).
4. **Per-symbol thesis memory** (Phase 5.1 `thesis_memory.py`) becomes a
   typed sub-store, not a separate module.
5. **Privacy** — explicit forget, exportable, scopable to a workspace.

### 7.2 Memory tiers

| Tier | TTL | Storage | Purpose | API surface |
|---|---|---|---|---|
| **Short-term** | session lifetime | in-memory dict | conversation window, agent scratch | `client.short_term.append/get/clear` |
| **Episodic** | indefinite (until forget) | SQLite (Railway disk) → Postgres later | facts, prefs, summaries, theses, thread metadata | `remember(kind, value, scope)`, `recall(query, kind, scope, limit)` |
| **Semantic** | indefinite | embeddings file or Postgres+pgvector (Phase M3) | similarity search across long conversations | `search_semantic(query, k, scope)` |
| **Workspace** | indefinite | episodic store | notes, files, artifacts, pinned messages | `workspace.put/get/list/pin` |

### 7.3 Data model (target SQL)

```
users (id, external_id, created_at, premium, settings_json)

workspaces (id, user_id, name, slug, created_at, kind)
            kind ∈ {personal, trading, ecommerce, startup, research, …}

threads (id, workspace_id, title, mode, created_at, updated_at,
         summary, status)

messages (id, thread_id, role, content, metadata_json, created_at,
          tokens, model)

memory_items (id, user_id, workspace_id NULLABLE, kind, content,
              source_thread_id NULLABLE, created_at, updated_at,
              expires_at NULLABLE)
              kind ∈ {fact, preference, style, summary, thesis,
                      artifact_ref, behavior_pattern}

embeddings (id, memory_item_id, vector BLOB, dim, model)  -- Phase M3
```

The Phase 5.1 thesis store becomes `memory_items` rows with `kind='thesis'`
and `source_thread_id` pointing at the conversation that produced it. The
in-process LRU stays as a hot-path cache in front of the durable store.

### 7.4 Milestones

- **M1: Memory service skeleton.** New `services/memory/` package with the
  public `MemoryClient` API and `episodic.py` backed by the existing
  `memory.db` schema (no migration yet). Routes/handlers re-pointed at the
  new client behind a flag.
- **M2: Server-side sessions.** `threads`, `messages`, basic CRUD in
  `routes/sessions.py`. Frontend `useChat` switches to server-first
  (localStorage becomes a cache). `/chat` writes the user + assistant
  messages here.
- **M3: Unified schema + migration.** Single SQLite file with the target
  schema; one-shot migration of `user_memory`, `user_style`, and legacy `db.py`
  `memory` rows. Read-old + write-new during cut-over week.
- **M4: Recall + summarization.** `recall()` plus an LLM-summarizer that
  rolls thread tails into thread `summary` rows for cheap context priming.
- **M5: Embeddings (optional).** `embeddings` table + `search_semantic`; only
  if cost/benefit justifies. Until then, structured `recall()` is enough.
- **M6: Privacy & export.** `/memory/export`, `/memory/forget?kind=…&scope=…`,
  workspace-scoped clear.

### 7.5 Failure modes & guardrails

- **Memory leak into the wrong workspace.** Every `memory_items` row is
  scoped by `(user_id, workspace_id)`. `recall()` defaults to current scope;
  cross-workspace recall requires an explicit flag.
- **Stale style baked into prompts.** Style preferences live in `memory_items`
  with `kind='style'` and are refreshed once per session, not per message.
- **Sensitive content.** Output filter (Phase 11) redacts before persisting
  to memory.

---

## 8. Agent Orchestration Design (A-series)

### 8.1 Why we need a real loop

Today's path is: detect intent → run tools once → build prompt → call model →
return. There's no:
- Tool result inspection (the model can't say "I need more").
- Sub-task decomposition (the model can't break a request into steps).
- Self-correction (the model can't realize a tool returned bad data and try
  another tool).

For "do real work", we need a loop the model can drive.

### 8.2 Architecture

```
   ┌─────────────────────────────────────────────────────────────────┐
   │  AgentRequest (user message, thread context, mode, capabilities) │
   └─────────────────────────────────────────────────────────────────┘
                 │
                 ▼
           ┌─────────────┐      No tools needed
           │   Planner   │────────────────────────► direct LLM reply path
           └─────┬───────┘
                 │ plan : list[Step]
                 ▼
   ┌───────────────────────────────────────┐
   │  Executor (per step, budget-bounded)  │
   │    Step kinds:                        │
   │      - tool_call(name, args)          │
   │      - llm_pass(prompt, schema?)      │
   │      - memory_op(remember | recall)   │
   │      - workflow_step(name, args)      │
   │    Each step has:                     │
   │      timeout, retry, fallback         │
   └─────────────────┬─────────────────────┘
                     │ partial result
                     ▼
              ┌────────────┐
              │ Reflector  │───── continue ──┐
              └──────┬─────┘                 │
                     │ done                  │
                     ▼                       │
           ┌──────────────────┐              │
           │ Response composer │◄─────────────┘
           │ (text + signal +  │
           │  trace + memory   │
           │  updates)         │
           └──────────────────┘
```

### 8.3 Function calling vs. structured prompt

We use OpenAI tool calling (already in the SDK) as the function-calling
substrate, not bespoke regex parsing of the model's reply. The tool list is
generated from the `BaseTool` registry filtered by the mode's capabilities.

For the structured `trading_signal` payload we already produce (Phase 5),
that pattern generalizes: each domain module can declare a *result schema*
(Pydantic), and the response composer enforces it.

### 8.4 Budget discipline

- Each agent run has a **step budget** (default 6 steps) and a **wall-clock
  budget** (default 25 s). Exceeded → return best-effort answer with a
  `partial=true` flag.
- Per-step **token budget** caps how much context can be pushed back into
  the LLM. Memory recall is summarised, not concatenated raw.
- **Tool concurrency cap** — at most 3 tool calls in parallel per step.

### 8.5 Milestones

- **A1: Agent runtime skeleton.** `services/agent/` with planner / executor /
  reflector / response composer. New `/chat` path routes to it behind
  `ENABLE_AGENT=true`. Existing path remains the default until A3.
- **A2: Function-calling integration.** Tool list generated from registry;
  OpenAI tool-calling wired; first non-trading mode (`research`) migrated.
- **A3: Trading mode migrated.** `trading_analyst` becomes a mode whose
  tools are `market_data`, `macro_data`, `news` (Phase R). The Phase 5
  prompt is preserved word-for-word but executed through the agent loop;
  output is unchanged from the user's perspective.
- **A4: Workflows.** Saved multi-step workflows (e.g. "morning briefing":
  pull markets + news + portfolio status + summarize). Triggerable from
  command palette or scheduled.
- **A5: Multi-turn tool memory.** Tool result caching within a thread so
  the agent doesn't re-fetch the same data on the next user turn.

### 8.6 Failure modes & guardrails

- **Infinite loop.** Reflector hard-caps at 6 steps; the executor refuses to
  schedule step 7. Test fixture: a model that always says "more tools needed".
- **Tool flakiness.** Per-tool retry inherits the Phase 5.2 backoff. After
  retries are exhausted the executor records the failure in the trace and
  proceeds; the model sees a structured "tool unavailable" result.
- **Token blowup.** Each tool result is truncated to its declared
  `max_chars`; the agent summarises if needed before recursion.

---

## 9. Business Operator Roadmap (B-series)

The agent runtime is the substrate; each business module is a small surface
on top.

### 9.1 Modules

| Module | Purpose | Tools needed | Mode prompt |
|---|---|---|---|
| `ecommerce` | Product research, ad creative, saturation read, niche scoring | Meta Ad Library, TikTok trends, Amazon BSR, Shopify (later) | Existing `marketing_dropshipping` (refined) |
| `startup` | Market gap analysis, competitor landscape, ICP synthesis, GTM advice | `web_research` (Tavily), Crunchbase (later), Product Hunt | Existing `startup_advisor` (refined) |
| `writing` | Long-form drafting, editing, tone/voice memory | `file` tool, memory style preferences | New `writer` AIMode |
| `coding` | Already exists; relocate logic into `domains/coding/` for consistency | (none new) | Existing `coding` |

### 9.2 Milestones

- **B1: E-commerce module.** Wire Meta Ad Library provider (free) into
  `ecommerce_research_tool`. Add a saturation-score heuristic that uses
  active-ads count + days-running + spend signal. Surface as a new
  *Ecommerce signal card* in the frontend (mirror the trading card design).
- **B2: Startup module.** Wire Tavily (or Serper) into `web_research_tool`
  with citations. Add `market_gap`, `competitor_landscape`, `icp_synthesis`
  workflows runnable from the command palette.
- **B3: Writing module.** New `writer` AIMode; persistent style memory;
  artifact-based drafting (output is an artifact in the thread inspector,
  not just a chat reply).
- **B4: Shopify / ad-platform integrations (Phase 12+).** Read-only at
  first: read store metrics, ad spend, campaign status. Surface in agent
  context as a structured "your store today" block.

### 9.3 Guardrails

- **No fake ROAS.** All ad / monetisation outputs must cite the source row
  in `metadata.tool_summary` and warn on degraded data quality.
- **Saturation scores explain themselves.** Each score includes the inputs
  it used and the missing inputs (data_quality pattern).
- **Read-only first.** Shopify/Meta writes (e.g. publishing an ad) are
  beyond this roadmap; require a separate authorisation phase.

---

## 10. Research System Roadmap (R-series)

### 10.1 What "research mode" should feel like

A user asks a question that needs current information. The system:
1. Decomposes the question into sub-queries.
2. Runs web/news/citation tools in parallel.
3. Extracts claims, deduplicates, scores sources.
4. Produces a structured brief with citations, a TL;DR, and follow-up
   questions.

The user sees this stream — sub-queries spinning, citations populating,
brief assembling — not a 30-second blank screen.

### 10.2 Components

- `services/research/` — provider-agnostic abstraction. One provider
  (Tavily) implemented first; Serper/Brave/Exa pluggable later.
- `web_research_tool` — already a stub in the registry; gets a real
  implementation via the research service.
- `news_tool` — separate concern from web_research because news has
  different ranking, freshness, and source-quality assumptions.
- `citations` engine — normalises sources into `{title, url, snippet,
  date, source_type, trust_score}`. Trust score is a heuristic
  (well-known publishers + recency + diversity).
- `research_signal` payload — analogue of `trading_signal`: a structured
  result the frontend can render as a *research card* (TL;DR, key claims,
  citations, "follow up" chips).

### 10.3 Milestones

- **R1: Tavily provider wired.** `web_research_tool` returns real results
  with citations. Behind `ENABLE_WEB_RESEARCH=true`.
- **R2: News provider.** Either NewsAPI or a curated feed parser. Same
  citation schema.
- **R3: Deep-research workflow.** Multi-step agent flow: plan → parallel
  fetch → extract → dedupe → compose. Triggered by `mode=research` or
  `/deep` slash-command.
- **R4: Research card UI.** Mirrors TradingSignalCard's design language.
- **R5: Persistent research artefacts.** Saved briefs become workspace
  artefacts; re-runnable to refresh ("update this brief").

### 10.4 Guardrails

- **No URL fabrication.** Every claim in the brief must reference a
  citation index from the tool result. The composer rejects briefs that
  reference indices not present.
- **Trust signal.** Low-trust sources are surfaced as such, not hidden.
- **Cost.** Tavily / Serper charge per query. Cache aggressively (Phase 5.2
  cache); each thread has a research budget visible in the inspector.

---

## 11. Premium AI Experience (P-series)

Polish concentrated in a phase but each item small and isolated.

| # | Milestone | Effect |
|---|---|---|
| P1 | **Streaming via SSE.** Tokens stream from `/chat`; backend already runs async. | "Instant" feel; reduces perceived wait by ~60% |
| P2 | **Live tool inspector.** Inspector pane shows tool calls as they happen with status + timing. | Demystifies the wait; "alive" feel |
| P3 | **Proactive briefings.** APScheduler worker generates a morning brief workflow result, lands as a notification artifact. | Proactivity without spam (opt-in) |
| P4 | **Voice/length adaptation.** Output filter that adjusts verbosity to user style (already partially captured in memory). | Personal feel without bespoke prompts |
| P5 | **Empty-state intelligence.** "What you were working on" panel on new-thread page, populated from memory + recent threads. | Removes "blank cursor" friction |
| P6 | **Design polish pass.** Typography scale, motion easing, focus rings, mobile parity, dark/light contrast audit. | Premium *look*; no functional change |
| P7 | **Deploy-status watcher workflow.** Companion to the Phase 5.3 `post-deploy-healthcheck` workflow. If `railway/production-deploy` does not reach `success` within budget on a merge commit to `main`, the watcher opens (or updates) a single GitHub Issue with the failing run's logs and merge commit metadata. Tiny scope: one workflow file; no backend or frontend change. | Closes the verification-readability gap surfaced during M1/M2 deploys — future automated sessions can read deploy outcomes via the Issues MCP without depending on the unauthenticated commit-status API (per-IP rate-limited from shared sandboxes). |

---

## 12. Safe Implementation Order (the first 6 PRs)

This is the only section that should drive immediate work after the roadmap
is approved. Each row is a single PR sized for one focused session.

| PR | Branch suffix | Phase | What | Why now |
|----|---|---|---|---|
| **1** | `m1-memory-service` | M1 | New `services/memory/` skeleton + `MemoryClient` API. **Wraps the existing `memory.py` SQLite tables — no schema change.** Routes re-pointed at it behind `ENABLE_NEW_MEMORY=true`. | Zero-risk introduction of the new memory surface |
| **2** | `m2-sessions` | M2 | `routes/sessions.py` + `threads` + `messages` tables. `/chat` writes to them. Frontend `useChat` still reads local cache; server-side becomes the persistence layer | First step toward cross-device continuity |
| **3** | `a1-agent-skeleton` | A1 | `services/agent/` skeleton with planner/executor/reflector. New `/chat` path behind `ENABLE_AGENT=true`. Function-calling wired, but only **one** non-trading mode (`research`) routed through it | Validates the loop pattern on the lowest-risk surface |
| **4** | `r1-tavily-provider` | R1 | Implement Tavily backend for `web_research_tool`. Behind existing `ENABLE_WEB_RESEARCH=true` | First "real work" surface for the agent |
| **5** | `w1-server-sessions-frontend` | W1 | `useChat` switches to server-first sessions; localStorage becomes a cache | Cross-device feel |
| **6** | `r4-research-card` | R4 | Research card UI; `research` mode now emits a `metadata.research_signal` and renders a card | Premium visible win |

After PR 6 we re-evaluate. Probable next batch:
- A2 (function calling deepening) + A3 (trading migration through agent).
- M3 (unified memory schema + migration).
- B1 (e-commerce module first cut).
- W3 (inspector pane).

Estimated calendar: assuming one PR per working day with breathing room for
testing and review, the first 6 PRs land in ~2 weeks. The trading layer is
untouched in this window — it keeps working via the legacy path.

---

## 13. Risks, Guardrails, Rollback

### 13.1 Top risks

1. **Memory cut-over** could lose user history if migration is wrong.
   *Mitigation:* read-old + write-new during cut-over; keep the old
   `memory.db` table read-only for 30 days; have a one-flag rollback to the
   legacy path.
2. **Agent loops** could blow up token cost or wall-clock.
   *Mitigation:* hard step + token + concurrency budgets; reject step 7;
   feature flag per mode.
3. **Server-side sessions** mean an outage now affects chat history.
   *Mitigation:* localStorage stays as a write-through cache; if `/sessions`
   is 5xx, the frontend falls back to local-only mode and shows a degraded
   pill.
4. **Workflow scheduler** has classic cron pitfalls (overlap, drift,
   missed runs). *Mitigation:* APScheduler with `coalesce=True`,
   `max_instances=1`; every job idempotent and logs its run id.
5. **Cost explosion from research/agent.** *Mitigation:* cache (Phase 5.2)
   extended to research providers; per-thread budgets visible in the
   inspector; daily quota stays in place.

### 13.2 Rollback playbook

For every milestone:
- **Flag off.** All milestones default off. The first remediation step is
  always "flip the flag".
- **Revert PR.** Each milestone is a single PR; `git revert` is clean.
- **Backwards-compatible data.** No milestone deletes data in the legacy
  store until 30 days after the replacement is stable.
- **Status banner.** When a degraded path is active, the frontend shows a
  small pill ("memory degraded", "research offline"), not a generic error.

### 13.3 Invariants we will not break

- `/chat` request shape, required response fields, endpoint name.
- Railway start command, Procfile, Python runtime.
- Existing trading-mode output for users not opted into the agent path.
- `ChatResponse.metadata` is additive only.

---

## 14. Open questions for you

These are decisions I'd rather make with you than guess.

1. **Workspace granularity.** One workspace per user (default) vs. multiple
   workspaces per user (e.g. "personal", "TradingDesk", "MyShopifyStore").
   Multi-workspace is more powerful but doubles the surface area of every
   future feature. Recommendation: **start single-workspace per user**;
   add multi-workspace in W2 once we know we need it.
2. **DB upgrade.** Stay on SQLite indefinitely or move to Postgres at M3?
   Postgres unlocks pgvector, multi-replica, and proper concurrent writes.
   Recommendation: **SQLite through M2**, evaluate Postgres at M3 boundary.
3. **Streaming.** SSE (simpler, one-way, fits FastAPI) vs. WebSocket (richer,
   bidirectional). Recommendation: **SSE first**, upgrade to WS only if a
   future feature (collaborative editing) needs it.
4. **Voice / image / file uploads.** In scope for W4 or out of scope?
   Recommendation: **text + file uploads in W4**; voice/image as a later
   dedicated phase.
5. **Premium tiering.** Should agent runtime / research / workspaces gate
   behind premium, or all free with rate-limited free tier? Recommendation:
   **all free with daily quota** for now; premium gating is a business
   decision we can flip later without code restructure.

---

*Last updated: 2026-05-11 · branch `claude/os-roadmap` · this document is the
contract for what we ship next. Concrete work starts only after approval.*
