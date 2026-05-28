# coding: utf-8
"""Phase 7 — Redis health probe.

Returns a never-raise dict for /v2/db/health. Even a totally broken
Redis returns {ok: false, error: "..."}.
"""
from __future__ import annotations

import logging
import time
from typing import Any

from backend.services.redis_client.client import (
    is_enabled, current_url_safe, get_async_client,
)
from backend.services.redis_client.errors import (
    RedisConfigError, RedisUnavailable,
)
from backend.services.redis_client import metrics


logger = logging.getLogger(__name__)


async def health_check() -> dict[str, Any]:
    out: dict[str, Any] = {
        "enabled":     is_enabled(),
        "url":         current_url_safe(),
        "ok":          False,
        "latency_ms":  0,
        "server_version": None,
        "error":       None,
        "metrics":     metrics.snapshot(),
    }

    if not is_enabled():
        # Redis intentionally off — surface as healthy for the parent
        # /v2/db/health composite. Matches the SQLite behaviour.
        out["ok"] = True
        return out

    t0 = time.monotonic()
    try:
        client = await get_async_client()
        await client.ping()
        # INFO is owner-safe — surface only the server version.
        info = await client.info("server")
        out["server_version"] = info.get("redis_version") if isinstance(info, dict) else None
        out["ok"] = True
        metrics.ping_recorded(ok=True)
    except RedisConfigError as exc:
        out["error"] = f"config: {exc}"
        metrics.ping_recorded(ok=False)
    except RedisUnavailable as exc:
        out["error"] = f"unavailable: {exc}"
        metrics.ping_recorded(ok=False)
    except Exception as exc:                                  # pragma: no cover
        logger.warning("redis health probe failed: %s", exc)
        out["error"] = f"probe: {exc}"
        metrics.ping_recorded(ok=False)
    finally:
        out["latency_ms"] = int((time.monotonic() - t0) * 1000)

    return out


__all__ = ["health_check"]
