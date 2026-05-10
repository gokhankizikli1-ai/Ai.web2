# KorvixAI — Tools Architecture (Phase 4)

## Overview

The tools layer gives AI modes access to real external data.
All tools are **optional** and **fail-safe**: if a tool is disabled, misconfigured,
or returns an error, the AI response continues normally without it.

---

## Phase Roadmap

| Phase | Scope | Status |
|-------|-------|--------|
| **4A** | Tool architecture foundation (this document) | ✅ Done |
| **4B** | Market data provider (Binance / Yahoo Finance) | 🔜 Next |
| **4C** | Ecommerce research provider (Minea / Meta Ad Library) | 🔜 Planned |
| **4D** | Web research provider (Tavily / Serper) + agent workflows | 🔜 Planned |

---

## Directory Structure

```
backend/services/tools/
├── __init__.py              # Registers all tools at startup (safe, guarded)
├── base_tool.py             # Abstract base class — all tools extend this
├── tool_registry.py         # Central registry + feature flag checks
├── market_data_tool.py      # Price, RSI, volume, support/resistance (Phase 4B)
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
| `ENABLE_MARKET_DATA` | `false` | Market data (price, RSI, volume) |
| `ENABLE_ECOMMERCE_RESEARCH` | `false` | Product saturation, ad library |
| `ENABLE_WEB_RESEARCH` | `false` | Web search, source extraction |

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
| `trading_analyst` | `market_data` |
| `marketing_dropshipping` | `ecommerce_research`, `web_research` |
| `startup_advisor` | `web_research` |
| `research` | `web_research` |
| `deep_think` | `web_research` |
| `fast`, `study`, `coding`, `website_builder` | *(none — fast local responses)* |

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

Response example (Phase 4A — all disabled):

```json
{
  "tools_enabled": false,
  "market_data_enabled": false,
  "ecommerce_research_enabled": false,
  "web_research_enabled": false,
  "registered_tools": ["market_data", "ecommerce_research", "web_research"],
  "phase": "4A — architecture foundation (providers not yet connected)"
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
