# coding: utf-8
"""Phase 7 slice 1 — Redis sync + async client factories.

We expose BOTH a sync `Redis` and an async `Redis` from the same
configuration so the legacy sync code paths (Celery broker probe,
diagnostic scripts) and the async chat-stream / SSE bridge land on the
same Redis instance.

The clients are CONSTRUCTED lazily and CACHED — repeated calls re-use
the connection pool. SSL is auto-enabled when the URL starts with
`rediss://` (which Upstash always uses for cloud connections).

Failure-handling rules:
  * No raise on import — redis package is loaded lazily inside
    get_*_client().
  * RedisConfigError on missing env / missing dep (operator action).
  * RedisUnavailable on connection / auth failure (transient).
  * Health probe always returns a dict; never raises.
"""
from __future__ import annotations

import logging
import os
import threading
from typing import Any, Optional
from urllib.parse import urlparse

from backend.services.redis_client.errors import (
    RedisConfigError, RedisUnavailable,
)


logger = logging.getLogger(__name__)


# ── Module state ────────────────────────────────────────────────────────────

_SYNC_CLIENT: Any = None
_ASYNC_CLIENT: Any = None
_LOCK = threading.Lock()


# ── Env ─────────────────────────────────────────────────────────────────────

def _flag(key: str) -> bool:
    return os.getenv(key, "false").strip().lower() == "true"


def _redis_url() -> str:
    return (os.getenv("REDIS_URL") or "").strip()


def _timeout_sec() -> float:
    try:
        return max(1.0, min(float(os.getenv("REDIS_TIMEOUT_SEC", "5") or 5.0), 60.0))
    except Exception:
        return 5.0


def _max_connections() -> int:
    try:
        return max(2, min(int(os.getenv("REDIS_POOL_MAX_CONNECTIONS", "20") or 20), 200))
    except Exception:
        return 20


def is_enabled() -> bool:
    """True when Redis is BOTH configured AND switched on. Read
    dynamically so a Railway env flip is live on the next call."""
    return _flag("ENABLE_REDIS") and bool(_redis_url())


def current_url_safe() -> str:
    """Return REDIS_URL with credentials stripped — safe for logs and
    the diagnostic endpoint."""
    raw = _redis_url()
    if not raw:
        return ""
    try:
        parsed = urlparse(raw)
        host = parsed.hostname or ""
        port = parsed.port or 6379
        scheme = parsed.scheme or "redis"
        # Don't include user/pass — keep host:port + scheme + db only.
        path = parsed.path or ""
        return f"{scheme}://{host}:{port}{path}"
    except Exception:
        return "[parse failed]"


# ── Sync client ─────────────────────────────────────────────────────────────

def get_client():
    """Return a cached sync `redis.Redis` with pool. Raises
    RedisConfigError when the env isn't set up; RedisUnavailable on
    immediate connect failure (the pool itself is lazy, but we run a
    PING to validate)."""
    global _SYNC_CLIENT
    if _SYNC_CLIENT is not None:
        return _SYNC_CLIENT

    if not is_enabled():
        raise RedisConfigError(
            "Redis disabled. Set REDIS_URL and ENABLE_REDIS=true."
        )

    try:
        import redis as _redis  # noqa: PLC0415
    except ImportError as exc:
        raise RedisConfigError(
            "redis package not installed. Add `redis` to "
            "requirements.txt."
        ) from exc

    with _LOCK:
        if _SYNC_CLIENT is not None:
            return _SYNC_CLIENT

        url = _redis_url()
        try:
            pool = _redis.ConnectionPool.from_url(
                url,
                max_connections=_max_connections(),
                socket_connect_timeout=_timeout_sec(),
                socket_timeout=_timeout_sec(),
                health_check_interval=30,
            )
            client = _redis.Redis(connection_pool=pool)
            # Validate the connection eagerly so we surface
            # RedisUnavailable HERE, not in random callsites.
            client.ping()
        except Exception as exc:
            logger.warning("redis sync client init failed: %s", exc)
            raise RedisUnavailable(f"sync init: {exc}") from exc

        logger.info(
            "[REDIS] sync client ready url=%s max_conn=%d",
            current_url_safe(), _max_connections(),
        )
        _SYNC_CLIENT = client
        return _SYNC_CLIENT


def close_clients() -> None:
    """Close cached clients — graceful shutdown + test cleanup."""
    global _SYNC_CLIENT, _ASYNC_CLIENT
    if _SYNC_CLIENT is not None:
        try:
            _SYNC_CLIENT.close()
        except Exception:                                       # pragma: no cover
            pass
        _SYNC_CLIENT = None
    if _ASYNC_CLIENT is not None:
        try:
            import asyncio
            loop = asyncio.get_event_loop()
            if loop.is_running():
                # Don't block the loop — schedule close.
                loop.create_task(_ASYNC_CLIENT.aclose())
            else:
                loop.run_until_complete(_ASYNC_CLIENT.aclose())
        except Exception:                                       # pragma: no cover
            pass
        _ASYNC_CLIENT = None


# ── Async client ────────────────────────────────────────────────────────────

async def get_async_client():
    """Return a cached `redis.asyncio.Redis` with pool. Same semantic
    as get_client() but async — used by SSE bridges + future async
    workers."""
    global _ASYNC_CLIENT
    if _ASYNC_CLIENT is not None:
        return _ASYNC_CLIENT

    if not is_enabled():
        raise RedisConfigError(
            "Redis disabled. Set REDIS_URL and ENABLE_REDIS=true."
        )

    try:
        from redis import asyncio as _aioredis  # noqa: PLC0415
    except ImportError as exc:
        raise RedisConfigError(
            "redis package not installed. Add `redis` to "
            "requirements.txt."
        ) from exc

    with _LOCK:
        if _ASYNC_CLIENT is not None:
            return _ASYNC_CLIENT

        url = _redis_url()
        try:
            pool = _aioredis.ConnectionPool.from_url(
                url,
                max_connections=_max_connections(),
                socket_connect_timeout=_timeout_sec(),
                socket_timeout=_timeout_sec(),
                health_check_interval=30,
            )
            client = _aioredis.Redis(connection_pool=pool)
            await client.ping()
        except Exception as exc:
            logger.warning("redis async client init failed: %s", exc)
            raise RedisUnavailable(f"async init: {exc}") from exc

        logger.info("[REDIS] async client ready url=%s", current_url_safe())
        _ASYNC_CLIENT = client
        return _ASYNC_CLIENT


__all__ = [
    "get_client", "get_async_client", "close_clients",
    "is_enabled", "current_url_safe",
]
