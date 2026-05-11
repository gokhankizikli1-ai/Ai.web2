# KorvixAI — Tools Architecture (Phase 5)

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

## Trading Intelligence Payload (Phase 5)

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

FUTURES MICROSTRUCTURE (Binance USDT-M, when ENABLE_FUTURES_MICROSTRUCTURE=true)
  funding_rate, funding_rate_pct, funding_annualized_pct, funding_regime
  mark_price, open_interest, oi_change_24h_pct
  long_short_account_ratio (crowd)
  top_trader_long_short_ratio (smart money)
  taker_buy_sell_ratio
  positioning_signal: aligned | crowd_long_smart_short | crowd_short_smart_long

AUTO RISK PLAN (ATR-anchored proposal — AI defends or vetoes)
  side_bias (long | short | neutral)
  entry, stop, take_profit_1, take_profit_2
  risk_reward, stop_atr_multiple, target_atr_multiple
  setup_grade (0-10), bias_strength, bull_points, bear_points
  invalidation (text)
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

## Structured Trading Signal (Phase 5)

For every `trading_analyst` reply, the model emits a fenced JSON block. The
backend extracts it, strips it from the displayed reply, and returns it in
`ChatResponse.metadata.trading_signal`:

```json
{
  "symbol":        "BTCUSDT",
  "timeframe":     "4h",
  "side":          "long",
  "action":        "wait",
  "entry":         67250.0,
  "stop":          65800.0,
  "take_profit_1": 69200.0,
  "take_profit_2": 71500.0,
  "risk_reward":   2.4,
  "setup_grade":   7,
  "confidence":    "medium",
  "invalidation":  "Daily close below 65800 kills the long",
  "thesis":        "1d/4h aligned bullish, smart money long while crowd flat",
  "mtf_alignment": "bullish",
  "regime":        "trending_up",
  "macro_regime":  "risk_on"
}
```

`ChatResponse.metadata.tool_summary` carries a compact snapshot of the
`market_data` + `macro_data` results for frontend cards.

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
