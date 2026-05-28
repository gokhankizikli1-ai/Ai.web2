# coding: utf-8
"""Phase 7 slice 1 — Redis client foundation.

Lazy-loaded sync + async clients with pool, health probe, and
counter-level metrics. Mirrors the shape of `backend.services.db` so
operators / future code use one consistent style.

  from backend.services.redis_client import (
      get_client, get_async_client, health_check, metrics,
  )

Env contract:
    REDIS_URL=redis://default:pass@host:6379/0   (Upstash format works)
    ENABLE_REDIS=true                            master kill-switch
    REDIS_TIMEOUT_SEC=5                          connect + command timeout
    REDIS_POOL_MAX_CONNECTIONS=20

Failure semantic:
    Functions never raise on a missing dep — they return None and the
    caller checks. When ENABLE_REDIS=false (default) the package is a
    no-op so the API process boots even without redis installed.
"""
from backend.services.redis_client.client import (
    get_client, get_async_client, close_clients,
    is_enabled, current_url_safe,
)
from backend.services.redis_client.health import health_check
from backend.services.redis_client import metrics
from backend.services.redis_client.errors import (
    RedisUnavailable, RedisConfigError,
)

__all__ = [
    "get_client", "get_async_client", "close_clients",
    "is_enabled", "current_url_safe",
    "health_check", "metrics",
    "RedisUnavailable", "RedisConfigError",
]
