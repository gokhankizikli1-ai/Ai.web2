# KorvixAI — Tools Architecture (Phase A1)

## Overview

The tools layer gives AI modes access to real external data.
All tools are **optional** and **fail-safe**: if a tool is disabled, misconfigured,
or returns an error, the AI response continues normally without it.

---

## Phase Roadmap

| Phase | Scope | Status |
|-------|-------|--------|
| **4A** | Tool architecture foundation | ✅ Done |
| **4B** | Market data provider (Binance + multi-provider fallback) | ✅ Done |
| **5**  | Advanced trading intelligence (MTF + futures + macro + plan + signal) | ✅ Done |
| **5.1** | Operator-grade trading (smart money zones, trapped traders, plan v2, thesis memory) | ✅ Done |
| **5.2** | Stabilization & polish (cache + backoff + safety guard + trading card UI + error UX) | ✅ Done |
| **5.3** | Automated post-deploy healthcheck workflow (Railway SHA verification + commit status) | ✅ Done |
| **M1** | Memory service (typed client, multi-workspace-ready, flag-gated) | ✅ Done |
| **M2** | Server-side sessions (workspaces, threads, messages tables) | ✅ Done |
| **A1** | Agent runtime skeleton (research mode only, flag-gated) | ✅ Done |
| **M3** | Unified schema migration (workspace_id activation across all stores) | 🔜 Next OS phase |
| **R1** | Research provider (Tavily) wired into web_research_tool | 🔜 Planned |
| **6A** | Position Manager AI (live trade monitoring, partial profit logic) | ⏸ Deprioritized (T-series) |
| **6B** | Alert engine (watchlists, breakouts, liquidation spikes) | 🔜 Planned |
| **6C** | Auto trade journal (psychology + performance analytics) | 🔜 Planned |
| **6D** | Extended macro (ETF flows, CPI, FED, earnings, geo risk) | 🔜 Planned |
| **7**  | Business Operator AI (Shopify, Meta/TikTok Ads, niche scanner) | 🔜 Planned |
| **4C** | Ecommerce research provider (Minea / Meta Ad Library) | 🔜 Planned |
| **4D** | Web research provider (Tavily / Serper) + agent workflows | 🔜 Planned |

---

## Directory Structure

```
backend/services/tools/
├── __init__.py              # Registers all tools at startup (safe, guarded)
├── base_tool.py             # Abstract base class — all tools extend this
├── tool_registry.py         # Central registry + feature flag checks
├── market_data_tool.py      # Multi-timeframe price + indicators + futures + auto risk plan (Phase 5)
├── macro_data_tool.py       # BTC.D, total market cap, DXY — global regime (Phase 5)
├── ecommerce_research_tool.py  # Saturation, TikTok, Meta Ads, Amazon (Phase 4C)
├── web_research_tool.py     # Web search, source extraction (Phase 4D)
└── tool_orchestrator.py     # Routes mode requests to relevant tools

backend/routes/tools.py      # GET /tools/health — status endpoint
```

---

## Environment Variables

All flags default to `false`. Production is unaffected until you explicitly enable tools.

### Master switch
| Variable | Default | Description |
|----------|---------|-------------|
| `ENABLE_TOOLS` | `false` | Master switch — must be `true` for any tool to run |

### Per-tool flags
| Variable | Default | Tool |
|----------|---------|------|
| `ENABLE_MARKET_DATA` | `false` | Market data (price, RSI, MTF, futures, plan) |
| `ENABLE_MACRO_DATA`  | `false` | Macro regime (BTC.D, total mcap, DXY) |
| `ENABLE_ECOMMERCE_RESEARCH` | `false` | Product saturation, ad library |
| `ENABLE_WEB_RESEARCH` | `false` | Web search, source extraction |

### Trading-specific tuning (all optional)
| Variable | Default | Effect |
|----------|---------|--------|
| `ENABLE_MTF` | `true` | Pull 1d/4h/1h in parallel and compute MTF alignment |
| `ENABLE_FUTURES_MICROSTRUCTURE` | `true` | Pull Binance USDT-M futures funding/OI/L:S |

### Provider selection (Phase 4B+)
| Variable | Example value | Description |
|----------|--------------|-------------|
| `MARKET_DATA_PROVIDER` | `binance` | `binance` / `yahoo_finance` / `coingecko` |
| `ECOMMERCE_RESEARCH_PROVIDER` | `minea` | `minea` / `meta` / `custom` |
| `WEB_RESEARCH_PROVIDER` | `tavily` | `tavily` / `serper` / `brave` / `exa` |

### Provider API keys (only needed when provider is set)
| Variable | Provider | Phase |
|----------|----------|-------|
| `BINANCE_API_KEY` | Binance | 4B |
| `BINANCE_SECRET` | Binance | 4B |
| `COINGECKO_API_KEY` | CoinGecko | 4B |
| `MINEA_API_KEY` | Minea | 4C |
| `META_ACCESS_TOKEN` | Meta Ad Library | 4C |
| `PIPIADS_API_KEY` | Pipiads | 4C |
| `SERPER_API_KEY` | Serper.dev | 4D |
| `TAVILY_API_KEY` | Tavily | 4D |
| `BRAVE_API_KEY` | Brave Search | 4D |
| `EXA_API_KEY` | Exa.ai | 4D |

---

## Tool Response Schema

Every tool returns a normalized dict with this structure:

```json
{
  "tool":      "market_data",
  "status":    "available | unavailable | disabled | error",
  "data":      { ... } ,
  "message":   "human-readable status or error (null when available)",
  "provider":  "binance | null",
  "timestamp": "2025-01-01T12:00:00+00:00"
}
```

`data` is `null` for any status other than `available`.

---

## AI Mode → Tool Mapping

| AI Mode | Tools Used |
|---------|-----------|
| `trading_analyst` | `market_data`, `macro_data` |
| `marketing_dropshipping` | `ecommerce_research`, `web_research` |
| `startup_advisor` | `web_research` |
| `research` | `web_research` |
| `deep_think` | `web_research` |
| `fast`, `study`, `coding`, `website_builder` | *(none — fast local responses)* |

---

## Trading Intelligence Payload (Phase 5.1)

The `market_data` tool returns a rich payload that the trading_analyst prompt
reads field-by-field. All fields are produced by every provider; missing fields
are `null` so the AI knows to skip them.

```
PRICE & STRUCTURE
  symbol, timeframe, last_price, change_24h_pct, volume_24h
  rsi_14, ema20, ema50, trend, volume_trend
  support, resistance, atr_14, volatility_pct, bos
  bb_upper, bb_middle, bb_lower, bb_width_pct, bb_squeeze, bb_position, regime
  candles_analyzed

MULTI-TIMEFRAME SNAPSHOTS
  1d / 4h / 1h compact view (trend, rsi, ema20/50, atr_pct, bos, regime, …)

MTF ALIGNMENT
  alignment: bullish | bearish | mixed | bullish_partial | bearish_partial
  divergences: ["1d strong / 1h weak — short-term pullback in higher uptrend", …]

SMART MONEY ZONES (Phase 5.1)
  fvg_bullish / fvg_bearish:   {low, high, size_atr, distance_pct, age_candles}
  order_block_bull / bear:     {low, high, distance_pct, age_candles}
  equal_highs / equal_lows:    [{level, touches, distance_pct}, …]   stop clusters
  premium_discount:            {zone, swing_low, equilibrium, swing_high, fib_618, fib_382}
                               zone ∈ deep_premium / premium / equilibrium / discount / deep_discount
  liquidity_above / below:     [{level, distance_pct}, …]   nearest stop pools
  absorption_signal:           {type=accumulation|distribution, vol_ratio, range_vs_atr}

FUTURES MICROSTRUCTURE (Binance USDT-M)
  funding_rate, funding_rate_pct, funding_annualized_pct, funding_regime
  mark_price, open_interest, oi_change_24h_pct
  long_short_account_ratio (crowd)
  top_trader_long_short_ratio (smart money)
  taker_buy_sell_ratio
  positioning_signal: aligned | crowd_long_smart_short | crowd_short_smart_long
  trapped_traders:   longs | shorts | null   (Phase 5.1)

AUTO RISK PLAN (Phase 5.1 — ATR-anchored, AI defends/refines/vetoes)
  directional_bias:  LONG | SHORT | WAIT | REVERSAL_WATCH | NO_TRADE
  side_bias:         long | short | neutral
  entry, stop, take_profit_1, take_profit_2, take_profit_3
  risk_reward, stop_atr_multiple (1.5), target_atr_multiple (3.0)
  setup_grade (0-10), bias_strength, bull_points, bear_points
  fakeout_risk (0-10), liquidity_risk (0-10), trapped_traders
  invalidation (text)
  do_now:        [string, string, …]   operator commands
  do_not_do:     [string, string, …]   mistakes to avoid in current conditions
```

The `macro_data` tool returns:
```
regime: risk_on | risk_off | btc_dominance_high | alt_season_setup | neutral
btc_dominance_pct, eth_dominance_pct, others_dominance_pct
total_market_cap_usd, total_market_cap_change_24h_pct, total_excl_btc_eth_usd
active_cryptocurrencies
dxy, dxy_change_1d_pct, dxy_source
```

---

## Structured Trading Signal (Phase 5.1)

For every `trading_analyst` reply, the model emits a fenced JSON block. The
backend extracts it, strips it from the displayed reply, and returns it in
`ChatResponse.metadata.trading_signal`:

```json
{
  "symbol":           "BTCUSDT",
  "timeframe":        "4h",
  "directional_bias": "LONG",
  "side":             "long",
  "action":           "wait",
  "trigger":          "4H close above 67400 with volume confirmation",
  "entry":            67250.0,
  "stop":             65800.0,
  "take_profit_1":    69200.0,
  "take_profit_2":    71500.0,
  "take_profit_3":    74800.0,
  "risk_reward":      2.4,
  "setup_grade":      7,
  "probability_pct":  58,
  "confidence":       "medium",
  "fakeout_risk":     4,
  "liquidity_risk":   3,
  "volatility_regime":"trending_up",
  "invalidation":     "Daily close below 65800 kills the long",
  "thesis":           "1d/4h aligned bullish, smart money long while crowd flat",
  "mtf_alignment":    "bullish",
  "regime":           "trending_up",
  "macro_regime":     "risk_on",
  "trapped_traders":  null,
  "do_now":           ["Wait for 4H close > 67400", "Risk ≤ 1% of portfolio"],
  "do_not_do":        ["Do not chase before confirmation", "Do not anchor stop at equal highs"]
}
```

`ChatResponse.metadata.tool_summary` carries a compact snapshot of the
`market_data` + `macro_data` results for frontend cards (with
`directional_bias`, `setup_grade`, `fakeout_risk`, `liquidity_risk`,
`trapped_traders`, `positioning_signal`).

## Post-Deploy Healthcheck (Phase 5.3)

After every push to `main` (i.e. immediately after a PR merge), GitHub Actions
runs `.github/workflows/post-deploy-healthcheck.yml`. This workflow:

1. Sets a `railway/production-deploy` commit status to **pending** on the merge commit.
2. Polls `GET /health` until it returns `200` (5-minute budget, 5s interval).
3. Polls `GET /health` until `build.commit_sha` matches `github.sha` (8-min budget, 6s interval).
4. Verifies `GET /tools/health` returns the expected shape (`cache`, `safety`, `memory`, `phase` containing `5.x`/`M1+`, etc.).
5. Writes a final **success / failure** commit status back to GitHub, and a
   compact Markdown summary visible in the Actions UI with the full `/health`
   and `/tools/health` payloads as observed in production.

### Configuration

| Where | Variable | Default | Purpose |
|---|---|---|---|
| GitHub repo **Variables → Actions** | `RAILWAY_PROD_URL` | `https://worker-production-1345.up.railway.app` | Override if the Railway URL changes |
| Railway env (auto-injected, no action needed) | `RAILWAY_GIT_COMMIT_SHA` | — | Used by `/health` to expose the deployed commit |
| Railway env (auto-injected, no action needed) | `RAILWAY_GIT_BRANCH` | — | Exposed by `/health` for observability |
| Railway env (auto-injected, no action needed) | `RAILWAY_DEPLOYMENT_ID` | — | Exposed by `/health` for observability |
| Railway env (auto-injected, no action needed) | `RAILWAY_ENVIRONMENT` | — | Exposed by `/health` (falls back to `ENVIRONMENT`) |

The workflow requires no secrets beyond the default `GITHUB_TOKEN`. It writes
a commit status (not a check run) so it shows on the commit page and on any PR
that introduced the merge.

### Reading the deploy status programmatically

```
GET /repos/gokhankizikli1-ai/Ai.web2/commits/<sha>/statuses
→ look for context: "railway/production-deploy"
```

This is what subsequent automated sessions will use to verify a deploy
landed without needing direct Railway access.

### `/health` payload shape (Phase 5.3)

```json
{
  "status":  "ok",
  "version": "3.0.0",
  "build": {
    "commit_sha":       "bf73e14...",
    "commit_sha_short": "bf73e14",
    "branch":           "main",
    "deployment_id":    "...",
    "environment":      "production"
  },
  "uptime_seconds": 47.3
}
```

Backward compatible: `status` and `version` keys preserved exactly.

---

## Agent Runtime (Phase A1)

Third foundation phase of the AI Operating System roadmap. Introduces a
**multi-step LLM loop with OpenAI function calling** as the planning
substrate. Strictly bounded by step / wall-clock / parallelism budgets
and gated to **`research` mode only** in this first PR.

### Why
Today's `/chat` path is single-shot: detect intent → run tools once →
build prompt → call model → return. There's no way for the model to
inspect a tool result and decide it needs more. A1 lays down the loop
so the model can drive multi-step reasoning, with hard budgets and a
clean fallback.

### Package
```
backend/services/agent/
├── __init__.py     # exports run_agent, AgentRequest, AgentResponse, stats, is_enabled
├── types.py        # dataclasses + STEP_KINDS taxonomy
├── budget.py       # Budget tracker (steps + wall-clock + parallelism)
├── tool_bridge.py  # BaseTool registry ↔ OpenAI function-calling
└── runtime.py      # run_agent — the LLM-pass + tool-call loop
```

### Loop (collapsed planner+executor+reflector)
```
[system + history + user]
   ↓
LLM completion (tools=[…], tool_choice=auto)
   ↓
no tool_calls? → reply, done
tool_calls?    → dispatch_many(in parallel, capped)
                 append tool messages → loop
   ↓
budget exhausted → one final "summarize" LLM pass with partial=true
```

OpenAI's tool-calling does the planning natively — there is **no bespoke
planner/reflector**. The LLM emits the next tool call or the final reply
as part of its normal completion.

### Hard budgets (all env-overridable)
| Variable | Default | Effect |
|---|---|---|
| `AGENT_MAX_STEPS` | `6` | Total LLM passes + tool calls allowed per run |
| `AGENT_MAX_WALL_SECONDS` | `25` | Wall-clock budget per run |
| `AGENT_MAX_PARALLEL_TOOLS` | `3` | Max concurrent tool calls per step |

Budget exhaustion **never raises** — the runtime issues one final
"summarize what you found" LLM pass and returns `partial=true`.

### Feature flag
| Variable | Default | Effect |
|---|---|---|
| `ENABLE_AGENT` | `false` | When `true`, `ai_service.process_chat` routes `mode=research` requests through `run_agent`. When unset/false, the legacy single-shot path runs unchanged. |

If the agent runtime fails for any reason (import error, OpenAI error,
budget exhaustion with no reply, etc.) the response is marked
`fallback=true` and the caller (`ai_service`) automatically falls
through to the legacy path. **Zero observable change to non-research
modes ever.**

### Scope discipline (A1 is intentionally small)
- **Only `research` mode** routes through the agent. `trading_analyst`,
  `marketing_dropshipping`, etc. continue on the legacy path. A3 will
  migrate `trading_analyst` once A1 has run cleanly in production.
- **No new tools** — the tool bridge surfaces existing registered
  `BaseTool` instances filtered by `_MODE_TOOL_MAP`. `research`'s
  only tool (`web_research`) remains a stub until R1 wires Tavily.
  Until R1 lands, the agent will mostly answer from world-knowledge
  with zero tool calls — that's fine and still validates the loop.
- **No frontend, schema, memory, or `/chat` contract change.**
- One-line rollback: `ENABLE_AGENT=false`.

### Observability
`GET /tools/health` now returns an `agent` sub-object:
```json
"agent": {
  "enabled": false,
  "runs_total": 0,
  "runs_partial": 0,
  "runs_fallback": 0,
  "runs_errored": 0,
  "tool_calls": 0,
  "llm_passes": 0,
  "max_steps": 6,
  "max_wall_seconds": 25,
  "max_parallel_tools": 3,
  "last_error": "",
  "last_run_mode": ""
}
```

`ChatResponse.metadata.agent` (when the agent ran) carries:
- `steps`: total steps used
- `tool_calls`: how many tool calls fired
- `elapsed_ms`: wall-clock for the run
- `partial`: true if budget was exhausted
- `trace`: list of `AgentStep` dicts (kind, name, duration_ms, output keys, ok, error)

W3 (inspector pane) will render this trace in the frontend later.

### Rollback playbook
1. Set `ENABLE_AGENT=false` (or remove the var) on Railway and restart.
   `ai_service` immediately stops routing anything through the agent.
2. Optionally revert the PR — but step 1 is sufficient and zero-downtime.

---

## Sessions Service (Phase M2)

Second foundation phase of the AI Operating System roadmap. Introduces
server-side conversation state (workspaces → threads → messages) so
chats can persist across devices and the agent runtime (A1) has durable
state to read from. **No `/chat` integration yet** — wiring is W1's
responsibility once the data layer is stable.

### Why
Frontend sessions currently live in localStorage only. Cleared cache →
lost conversations. Cross-device → impossible. M2 adds the durable
storage; W1 will migrate `useChat` to it.

### Package
```
backend/services/sessions/
├── __init__.py     # exports `client`, Workspace, Thread, Message
├── types.py        # dataclasses + allowed-value taxonomies
├── store.py        # SQLite adapter (new `sessions.db` file)
└── client.py       # SessionsClient — stable public surface
```

### Schema (new SQLite file `sessions.db`)
```sql
workspaces  (id, user_id, name, slug, kind, created_at, updated_at,
             archived_at, metadata_json)
            UNIQUE (user_id, slug) WHERE archived_at IS NULL

threads     (id, workspace_id REFERENCES workspaces ON DELETE CASCADE,
             title, mode, status, summary, created_at, updated_at,
             archived_at, metadata_json)

messages    (id, thread_id REFERENCES threads ON DELETE CASCADE,
             role, content, created_at, tokens, model, metadata_json)
```

All ids are UUID4 hex strings, all timestamps ISO-8601 UTC — portable
to Postgres in M3+ with no type re-mapping.

Workspace kinds: `personal` (default), `trading`, `ecommerce`, `startup`,
`research`, `writing`, `coding`, `custom`.

### Public API
```python
from backend.services.sessions import client

# Workspaces
client.create_workspace(user_id, *, name, kind="personal", slug=None, metadata=None)
client.get_workspace(workspace_id)
client.list_workspaces(user_id, *, include_archived=False)
client.update_workspace(workspace_id, *, name=None, kind=None)
client.archive_workspace(workspace_id)
client.ensure_default_workspace(user_id)        # idempotent "personal" workspace

# Threads
client.create_thread(*, workspace_id, title="New thread", mode=None, metadata=None)
client.get_thread(thread_id)
client.list_threads(workspace_id, *, include_archived=False, limit=50)
client.update_thread(thread_id, *, title=None, mode=None, status=None, summary=None)
client.archive_thread(thread_id)

# Messages
client.append_message(*, thread_id, role, content, model=None, tokens=None, metadata=None)
client.get_message(message_id)
client.list_messages(thread_id, *, limit=100, after_id=None)
client.delete_message(message_id)

# Observability
client.stats()
```

### Routes (gated by `ENABLE_SESSIONS=true`; otherwise 503)

| Method | Path | Purpose |
|---|---|---|
| `GET`    | `/sessions/health` | Status (always callable; reports `enabled` flag) |
| `GET`    | `/sessions/workspaces?user_id=X` | List user's workspaces |
| `POST`   | `/sessions/workspaces` | Create workspace |
| `POST`   | `/sessions/workspaces/ensure_default?user_id=X` | Idempotent default workspace |
| `GET`    | `/sessions/workspaces/{id}` | Get workspace |
| `PATCH`  | `/sessions/workspaces/{id}` | Update name/kind |
| `DELETE` | `/sessions/workspaces/{id}` | Archive |
| `GET`    | `/sessions/workspaces/{id}/threads` | List threads in workspace |
| `POST`   | `/sessions/workspaces/{id}/threads` | Create thread |
| `GET`    | `/sessions/threads/{id}` | Get thread |
| `PATCH`  | `/sessions/threads/{id}` | Update thread |
| `DELETE` | `/sessions/threads/{id}` | Archive thread |
| `GET`    | `/sessions/threads/{id}/messages?after_id=X&limit=N` | List messages |
| `POST`   | `/sessions/threads/{id}/messages` | Append message |
| `DELETE` | `/sessions/messages/{id}` | Delete one message |

### Feature flag

| Variable | Default | Effect |
|----------|---------|--------|
| `ENABLE_SESSIONS` | `false` | When `true`, `/sessions/*` routes are live. When unset/false, every endpoint except `/sessions/health` returns **503** with `error: sessions_disabled`. Rollback = unset the var. |
| `SESSIONS_DB_PATH` | `sessions.db` | Override the SQLite file location |

### Observability
`GET /tools/health` now returns a `sessions` sub-object:
```json
"sessions": {
  "enabled": false,
  "flag_enable_sessions": false,
  "store":  { "workspaces_created": 0, "threads_created": 0,
              "messages_appended": 0, "errors": 0, "last_error": "" },
  "counts": { "workspaces": 0, "threads": 0, "messages": 0 },
  "db_path": "sessions.db"
}
```

### Rollback playbook
1. Set `ENABLE_SESSIONS=false` (or remove the var) on Railway. All endpoints
   except `/sessions/health` immediately return 503; nothing else in the
   system reads from `sessions.db`.
2. If desired, also delete `sessions.db` from the Railway volume.
3. Optionally revert the M2 PR — but step 1 is sufficient and zero-downtime.

### What's deliberately NOT in M2
- `/chat` does not write to these tables (that's a follow-up W1 PR plus
  a small backend wire-up).
- Memory service still ignores `workspace_id` (that's M3's activation).
- No frontend changes.
- No migration of existing memory tables.

---

## Memory Service (Phase M1)

The first foundation phase of the AI Operating System roadmap
(see `KORVIX_OS_ROADMAP.md` for the full plan).

### Why
Three previously-fragmented memory paths (`memory.py` root SQLite, `db.py`
legacy tables, in-process thesis cache) get one stable public surface to
migrate behind. No data is moved in M1 — the legacy SQLite tables remain
the source of truth. M2 will land the multi-workspace schema migration.

### Package
```
backend/services/memory/
├── __init__.py     # exports `client`, MemoryItem, StyleDef, WindowMessage
├── types.py        # dataclasses + MEMORY_KINDS taxonomy
├── store.py        # SQLite adapter (wraps legacy memory.py)
├── short_term.py   # in-process conversation window (per-thread)
└── client.py       # MemoryClient — stable public surface
```

### Public API
```python
from backend.services.memory import client

client.remember(user_id, content, kind="fact", workspace_id=None)
client.recall(user_id, kind=None, workspace_id=None, limit=15)
client.forget(user_id, keyword, workspace_id=None)
client.summarize(user_id, workspace_id=None)
client.list_for_user(user_id, workspace_id=None, limit=20)
client.maybe_auto_learn(user_id, message, workspace_id=None)

client.detect_style(message)                # stateless
client.apply_style(user_id, message)
client.get_style(user_id)
client.style_prompt(user_id)

client.window_append(thread_id, role, content, metadata=None)
client.window_recent(thread_id, max_messages=10)
client.window_clear(thread_id)

client.stats()
```

`workspace_id` is accepted by every method that touches per-user data so
M2's multi-workspace migration does not change any call signature.

### Feature flag
| Variable | Default | Effect |
|----------|---------|--------|
| `ENABLE_NEW_MEMORY` | `false` | When `true`, `backend/services/memory_service.py` delegates to `MemoryClient`. When unset/false, the legacy `memory.py` direct calls run unchanged. One-line rollback. |

Both paths produce identical observable behaviour. Compatibility is verified
by the M1 smoke tests.

### Observability
`GET /tools/health` now returns a `memory` sub-object:
```json
"memory": {
  "backend": "new_client" | "legacy",
  "flag_enable_new_memory": true,
  "store": { "remembers": 0, "recalls": 0, "forgets": 0, "summarizes": 0,
             "style_writes": 0, "style_reads": 0, "auto_learns": 0,
             "errors": 0, "last_error": "" },
  "short_term": { "appends": 0, "recalls": 0, "clears": 0, "evictions": 0,
                  "threads": 0, "max_threads": 2000 },
  "default_workspace": "personal"
}
```

### Rollback playbook
1. Set `ENABLE_NEW_MEMORY=false` (or delete the env var) on Railway and
   restart. The legacy direct-call path resumes immediately.
2. Optionally revert the M1 PR — but step 1 is sufficient and zero-downtime.

---

## Stabilization Layer (Phase 5.2)

### Response cache + provider counters
`backend/services/cache/__init__.py` — in-process TTL LRU (cap 1024 entries).

| Variable | Default | Effect |
|----------|---------|--------|
| `MARKET_DATA_CACHE_TTL_SEC` | `30` | Klines cache TTL for primary + MTF candles |
| `FUTURES_CACHE_TTL_SEC` | `20` | Funding, OI, L/S cache TTL |
| `MACRO_DATA_CACHE_TTL_SEC` | `300` | BTC.D / TOTAL / DXY cache TTL |
| `FETCH_BACKOFF_BASE_SEC` | `0.6` | Exponential backoff base for 429/5xx |
| `FETCH_BACKOFF_MAX_RETRY` | `2` | Extra retries after the initial attempt |

Every external fetch is tagged by provider (`binance`, `binance_futures`,
`coingecko`, `alphavantage`, `yahoo_dxy`). Success and failure counts plus the
last failure reason surface at `GET /tools/health` under the `cache.providers`
key — use this to spot rate-limited providers in production.

### Data quality field
`market_data.data_quality` and `macro_data.data_quality` report:
- `level`: `full` | `degraded` | `fallback`
- `missing`: list of absent sub-blocks (`multi_timeframe`, `futures`, `provider_fallback`)
- `provider`: actual provider that returned the data

The frontend trading card and the `metadata.tool_summary.market_data.data_quality`
field let the UI badge a "degraded data" pill when applicable.

### Safety guard
`backend/services/safety/guard.py` — runtime enforcement before AI calls.

| Layer | Trigger | Default |
|-------|---------|---------|
| Length cap | message > N chars | `SAFETY_MAX_INPUT_CHARS=4000` |
| Prompt-injection patterns | jailbreak / instruction override regex | always on (conservative) |
| Per-minute throttle | sliding-window per user | `SAFETY_PER_MIN_LIMIT=30` |

On rejection the chat route returns a normal `ChatResponse` with `intent`
prefixed `safety_*` (so old frontends don't crash) and a branded
`message_for_user`. The new frontend renders these as an amber error chip
with a retry button. Rejection counters surface at `/tools/health.safety`.

### Frontend trading card
`src/components/TradingSignalCard.tsx` renders the `metadata.trading_signal`
payload as a structured terminal card: directional bias badge, trigger,
entry/stop/TP1-2-3 grid, setup grade bar, R:R, fakeout risk meter, liquidity
risk meter, invalidation row, `do_now` and `do_not_do` bullets. Renders
nothing when the signal is empty/absent — safe to mount on every assistant
bubble.

### Error UX
`useChat` now produces a typed `ChatError` ({ code, message }) mapped from
HTTP status / network errors. Codes: `rate_limit`, `timeout`, `network`,
`server`, `safety`, `unknown`. `ChatDashboard` styles amber for soft errors
(safety / rate_limit) and red for hard errors.

### Skeleton loader
`ChatDashboard` now shows three pulsing skeleton bars beneath the typing
indicator so the user sees visual structure during AI generation instead
of a single dots-only state.

---

## Thesis Memory (Phase 5.1)

When the user re-analyzes the same symbol, the backend automatically injects a
`[PREVIOUS THESIS]` block before the live data block. The AI compares today's
read against the prior call, reports whether the trigger fired or the
invalidation hit, and updates the bias honestly.

- Implementation: `backend/services/trading/thesis_memory.py`
- Storage: in-process LRU (`OrderedDict`, cap 2000 entries).
- Persistence: per-process only — when we scale to multiple Railway replicas
  or want long-term journaling, swap the implementation for a SQLite/Postgres
  backend behind the same public API (`save_thesis`, `get_thesis`,
  `build_previous_thesis_block`).
- `ChatResponse.metadata.prior_thesis_used: true` flags when a prior thesis
  was found and injected.

---

## How AI Modes Use Tool Data

When a tool returns `status: "available"`, the orchestrator formats the data
into a `[TOOL: NAME]` block and injects it into the AI system prompt:

```
[TOOL: MARKET_DATA via binance]
  symbol: BTC/USDT
  last_price: 67420.5
  rsi_14: 58.3
  volume_24h: 142000
```

The AI prompt instructs the model to use this data in its structured analysis.
If no tool data is available, the block is empty and the AI responds from
the user's message alone — no regression in output quality.

---

## Safety Rules

1. **No import-time crashes** — all tool imports are wrapped in `try/except`.
2. **No startup failures** — tool registration errors are logged as warnings, not exceptions.
3. **No API key crashes** — missing env vars return `_unavailable()`, never `KeyError`.
4. **No AI response blocking** — `safe_run()` catches all tool exceptions.
5. **No secrets in responses** — `/tools/health` never returns API keys.
6. **Default-off** — `ENABLE_TOOLS=false` by default; production unchanged until opt-in.
7. **Parallel execution** — multiple tools for one mode run concurrently via `asyncio.gather`.

---

## Health Endpoint

```
GET /tools/health
```

Response example (Phase 5):

```json
{
  "tools_enabled": false,
  "market_data_enabled": false,
  "macro_data_enabled": false,
  "ecommerce_research_enabled": false,
  "web_research_enabled": false,
  "registered_tools": ["market_data", "macro_data", "ecommerce_research", "web_research"],
  "phase": "5 — advanced trading intelligence (MTF, futures, macro, plan)"
}
```

---

## Adding a New Tool (Developer Guide)

1. Create `backend/services/tools/my_tool.py` extending `BaseTool`.
2. Set `name = "my_tool"` and `description = "..."`.
3. Implement `async def run(self, query, context) -> dict` — return `_ok()` or `_unavailable()`.
4. Add `ENABLE_MY_TOOL` to `_TOOL_FLAGS` in `tool_registry.py`.
5. Add `register(MyTool())` in `tools/__init__.py`.
6. Add `"my_tool"` to the relevant mode list in `tool_orchestrator.py`.
7. Document env vars in this file.

---

## Phase 4B — What to Build Next

To connect real market data for `trading_analyst` mode:

1. Choose a provider: **Binance** (crypto, free public API) or **Yahoo Finance** (`yfinance` library, no key).
2. Add `MARKET_DATA_PROVIDER=binance` to Railway env vars.
3. Set `ENABLE_TOOLS=true` and `ENABLE_MARKET_DATA=true`.
4. Implement `_from_binance()` in `market_data_tool.py` (stub already present).
5. The trading prompt will automatically receive a `[TOOL: MARKET_DATA]` block.
6. Verify at `/tools/health` that `market_data_enabled: true`.

**Recommended first provider**: Binance public REST (`/api/v3/klines`) — no API key
needed for spot candle data. Zero cost, rate limit 1200 req/min.
