Velora AI Backend

Architecture:
  project/
    backend/
      api.py               FastAPI app entry point
      core/
        config.py          Environment config
        logging.py         Structured logging
        security.py        API key validation
      routes/
        chat.py            POST /chat
        memory.py          GET/POST/DELETE /memory
        profile.py         GET /profile/{user_id}
        stats.py           GET /stats (admin)
        auth.py            POST /auth/premium (admin)
        health.py          GET /health
      services/
        ai_service.py      Core AI orchestration
        memory_service.py  Memory operations
        user_service.py    Profile, premium, usage
      models/
        schemas.py         Pydantic request/response models
    bot.py                 Telegram adapter (optional)
    requirements.txt
    Procfile

Intelligence layer (preserved, unchanged):
  ai_client.py, ai_router.py, agent.py, prompts.py
  finance.py, ecommerce.py, data_sources.py
  memory.py, db.py, usage_limits.py, stats.py

Start API (Railway):
  uvicorn backend.api:app --host 0.0.0.0 --port $PORT

Start Telegram (optional):
  python bot.py

Local dev:
  uvicorn backend.api:app --reload --port 8000

Environment variables:
  OPENAI_API_KEY
  GEMINI_API_KEY
  TELEGRAM_TOKEN      (optional, only if using Telegram)
  OWNER_ID
  VELORA_API_KEY      (optional, set to protect API)
  ALLOWED_ORIGINS     (comma-separated frontend URLs)
  ENVIRONMENT         production or development
  FREE_DAILY_LIMIT    default 20
  DB_PATH             default velora.db

API Endpoints:
  GET  /health
  POST /chat
  GET  /memory/{user_id}
  POST /memory
  DELETE /memory
  GET  /profile/{user_id}
  GET  /stats            (admin only, requires X-User-Id header)
  POST /auth/premium     (admin only)
  GET  /docs             (Swagger UI)
  GET  /redoc
