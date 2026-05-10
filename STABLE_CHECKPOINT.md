# KorvixAI — Stable Checkpoint

**Status: PRODUCTION ONLINE**
**Date: 2026-05-10**
**Version: v3.0.0**

---

## Current Working State

| Component | Status | Notes |
|-----------|--------|-------|
| Railway backend | ✅ Online | `worker-production-1345.up.railway.app` |
| `/health` endpoint | ✅ Working | Returns `{"status":"ok","version":"3.0.0"}` |
| `/chat` endpoint | ✅ Working | Frontend receives AI response |
| Frontend (Vercel) | ✅ Online | React + Vite, calls Railway backend |
| OpenAI integration | ✅ Working | gpt-4o-mini (fast) / gpt-4o (strong) |
| Memory (SQLite) | ✅ Working | Per-user facts and style preferences |
| Usage limits | ✅ Working | 20 free messages/day |

---

## Entrypoint Architecture

### Railway start command
```
uvicorn api:app --host 0.0.0.0 --port $PORT
```

Defined in `Procfile`. uvicorn loads `api.py` from the **repository root** — no dotted
package path, no namespace-package ambiguity.

### Entrypoint chain
```
api.py (repo root)
  └── imports app from backend/api.py
        └── Layer 1: full FastAPI app (CORS, all routes, exception handler)
        └── Layer 2: minimal FastAPI app with /health only       [fallback]
        └── Layer 3: bare ASGI callable                          [last resort]

backend/main.py
  └── re-exports app from backend/api.py  (alias, not used by Railway)
```

`app` is **always defined** at module level regardless of import failures.

---

## API Contract

### Chat endpoint
```
POST /chat
Host: worker-production-1345.up.railway.app
Content-Type: application/json
```

**Request payload**
```json
{
  "user_id":    "string",
  "message":    "string",
  "chat_id":    "string (optional)",
  "session_id": "string (optional)",
  "platform":   "web"
}
```

**Response payload**
```json
{
  "reply":              "string",
  "intent":             "string",
  "model":              "string",
  "provider":           "string",
  "mode":               "string",
  "memory_used":        true,
  "remaining_messages": 15,
  "premium":            false,
  "response_time_ms":   430,
  "request_id":         "a1b2c3d4",
  "suggested_followups": null,
  "success":            true,
  "message":            "string",
  "conversation_id":    "string",
  "usage":              {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
  "metadata":           {}
}
```

**Error response**
```json
{
  "success": false,
  "error":   "Safe user-friendly message",
  "code":    "INTERNAL_ERROR"
}
```

### Health endpoint
```
GET /health
→ {"status": "ok", "version": "3.0.0", "environment": "production"}
```

---

## Backend File Structure

```
api.py                          ← Railway ASGI entrypoint (repo root)
Procfile                        ← web: uvicorn api:app ...
backend/
├── __init__.py                 ← required for package resolution
├── api.py                      ← full FastAPI app with 3-layer fallback
├── main.py                     ← re-exports app from backend/api.py
├── core/
│   ├── config.py               ← centralized env config (no import-time crashes)
│   ├── logging.py              ← Railway-friendly logging setup
│   ├── errors.py               ← safe global exception handler
│   ├── responses.py            ← standardized response builders
│   └── middleware.py           ← CORS registration
├── routes/
│   ├── chat.py                 ← POST /chat
│   ├── memory.py               ← GET/POST/DELETE /memory
│   ├── health.py               ← GET /health
│   ├── auth.py                 ← GET /auth/status
│   ├── profile.py              ← GET/POST /profile
│   └── stats.py                ← GET /stats
├── services/
│   ├── ai_service.py           ← intent detection, model routing, AI orchestration
│   ├── memory_service.py       ← bridge to memory.py
│   └── user_service.py         ← bridge to usage_limits.py + db.py
├── schemas/
│   ├── chat.py                 ← ChatRequest / ChatResponse Pydantic models
│   └── common.py               ← ErrorResponse model
└── utils/
    └── safe_json.py            ← defensive JSON parser for AI output

ai_router.py                    ← model selection (gpt-4o-mini vs gpt-4o)
ai_client.py                    ← OpenAI + Gemini API calls with timeout/fallback
agent.py                        ← tool orchestration (price, news, web search)
memory.py                       ← SQLite memory read/write
usage_limits.py                 ← daily message limit enforcement
db.py                           ← chat history + user table
prompts.py                      ← all system prompts (Velora AI identity)
finance.py                      ← finance/crypto analysis
ecommerce.py                    ← dropshipping/ads analysis
```

---

## Frontend API Call

```
File: src/hooks/useChat.ts
const API_URL = 'https://worker-production-1345.up.railway.app/chat';
```

---

## DO NOT BREAK — Rules

### Deployment
- **Do NOT change the Railway start command.** It must remain:
  `uvicorn api:app --host 0.0.0.0 --port $PORT`
- **Do NOT rename or delete `api.py` at the repo root.**
- **Do NOT remove `backend/__init__.py`.** Python needs it to resolve the `backend` package.
- **Do NOT add a `backend/api/` directory.** It will shadow `backend/api.py` and break imports.

### API contract
- **Do NOT rename the `/chat` endpoint.** Frontend calls `POST /chat` directly.
- **Do NOT remove or rename existing response fields** (`reply`, `intent`, `model`,
  `provider`, `mode`, `memory_used`, `remaining_messages`, `premium`,
  `response_time_ms`, `request_id`). Frontend reads these fields.
- **Do NOT change the request payload fields** (`user_id`, `message`, `chat_id`,
  `session_id`, `platform`).

### AI quality
- **Do NOT simplify or shorten system prompts** in `prompts.py`.
- **Do NOT downgrade the default model** without updating `ai_router.py` intentionally.
- **Do NOT remove Gemini fallback** in `ai_client.py`.
- **Do NOT remove the intent detection step** in `ai_service.py`.

### Stability
- **Do NOT introduce import-time side effects** that can crash Railway startup.
- **Do NOT add eager imports** to `backend/routes/__init__.py`.
- **Do NOT expose raw Python tracebacks** to the frontend.

---

## Environment Variables Required on Railway

| Variable | Purpose |
|----------|---------|
| `OPENAI_API_KEY` | OpenAI API calls |
| `GEMINI_API_KEY` | Gemini fallback |
| `ENVIRONMENT` | `production` or `development` |
| `OWNER_ID` | Owner user ID (unlimited usage) |
| `PORT` | Set automatically by Railway |

Optional overrides: `MODEL_FAST`, `MODEL_STRONG`, `FREE_DAILY_LIMIT`, `DB_PATH`
