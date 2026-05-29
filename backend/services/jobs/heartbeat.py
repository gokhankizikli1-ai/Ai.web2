# coding: utf-8
"""Phase 7 slice 4 — worker liveness heartbeats.

Each worker process writes a TTL'd Redis key on a regular cadence so
the API can answer "is any worker alive right now?" without polling
Celery's management API.

Key shape:
    korvix.worker.<hostname>   →  ISO-8601 timestamp string
    TTL: HEARTBEAT_TTL_SEC (default 60s — read each call)

The dispatch task in `backend/jobs/tasks.py` writes a heartbeat at
the start and end of every task. A worker that's IDLE for longer
than HEARTBEAT_TTL_SEC will appear inactive — which is the right
signal for our orphan reaper anyway. If we ever need true idle
liveness we add a Celery beat schedule; for now the on-task tick is
enough.

Listing:
    list_active_workers() → [{worker_id, last_seen_iso, ttl_sec}]
"""
from __future__ import annotations

import logging
import os
import socket
from datetime import datetime, timezone
from typing import Optional


logger = logging.getLogger(__name__)


HEARTBEAT_KEY_PREFIX = "korvix.worker."


def _heartbeat_ttl() -> int:
    try:
        return max(15, min(int(os.getenv("WORKER_HEARTBEAT_TTL_SEC", "60") or 60), 3600))
    except Exception:
        return 60


def worker_id() -> str:
    """Stable per-process worker id. Includes hostname + PID so two
    workers on the same host don't shadow each other in the heartbeat
    table."""
    try:
        host = socket.gethostname() or "unknown"
    except Exception:
        host = "unknown"
    return f"{host}-{os.getpid()}"


def _key_for(wid: str) -> str:
    return HEARTBEAT_KEY_PREFIX + wid


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def write_heartbeat(wid: Optional[str] = None) -> bool:
    """Record this worker as alive. Returns True on success, False on
    any failure (Redis off, network blip). Never raises."""
    try:
        from backend.services.redis_client import is_enabled, get_async_client
        if not is_enabled():
            return False
        client = await get_async_client()
        await client.set(
            _key_for(wid or worker_id()),
            _now_iso(),
            ex=_heartbeat_ttl(),
        )
        return True
    except Exception as exc:                                  # pragma: no cover
        logger.debug("[HEARTBEAT] write failed: %s", exc)
        return False


async def list_active_workers() -> list[dict]:
    """SCAN `korvix.worker.*` + MGET the values. Returns
    `[{worker_id, last_seen, ttl_sec}]`. Never raises."""
    out: list[dict] = []
    try:
        from backend.services.redis_client import is_enabled, get_async_client
        if not is_enabled():
            return out
        client = await get_async_client()
    except Exception:                                         # pragma: no cover
        return out

    keys: list[bytes] = []
    try:
        # SCAN avoids the KEYS-blocks-the-server problem.
        cursor = 0
        while True:
            cursor, batch = await client.scan(
                cursor=cursor, match=HEARTBEAT_KEY_PREFIX + "*", count=200,
            )
            keys.extend(batch)
            if cursor == 0:
                break
    except Exception as exc:                                  # pragma: no cover
        logger.debug("[HEARTBEAT] scan failed: %s", exc)
        return out

    if not keys:
        return out

    try:
        # Pull values + TTLs in one round-trip each.
        pipe = client.pipeline()
        for k in keys:
            pipe.get(k)
            pipe.ttl(k)
        results = await pipe.execute()
    except Exception:                                         # pragma: no cover
        return out

    # Results come as alternating (value, ttl) pairs.
    for i, k in enumerate(keys):
        val = results[2 * i]
        ttl = results[2 * i + 1]
        if isinstance(k, bytes):
            k = k.decode("utf-8")
        if isinstance(val, bytes):
            val = val.decode("utf-8")
        out.append({
            "worker_id":   k[len(HEARTBEAT_KEY_PREFIX):],
            "last_seen":   val,
            "ttl_sec":     int(ttl) if isinstance(ttl, (int, float)) else None,
        })
    return out


__all__ = [
    "worker_id", "write_heartbeat", "list_active_workers",
    "HEARTBEAT_KEY_PREFIX",
]
