# coding: utf-8
"""Phase 7 slice 4 — Dead Letter Queue.

When a Celery task exhausts `max_retries`, the dispatcher routes the
record_id to the DLQ instead of leaving it in `status=failed`. Two
durable surfaces back the DLQ:

  1. The DB row is flipped to STATUS_FAILED_DLQ with the final error.
     Operators query it via /v2/jobs?status=failed_dlq.

  2. A Redis LIST `korvix.dlq.list` mirrors recent DLQ entries (most
     recent first, capped at DLQ_REDIS_CAP). Cheap to LRANGE for a
     fast dashboard.

NOT a generic message broker — failed jobs are NOT re-dispatched.
They sit terminal until an operator either retries (POST /v2/jobs/
{id}/retry, which goes through the existing manager) or hard-deletes.

The DLQ surface is fail-safe: Redis errors are swallowed (we still
flip the DB; that's the source of truth). DB errors propagate (the
caller decides whether to crash the worker or move on).
"""
from __future__ import annotations

import json
import logging
import os
from typing import Optional

from backend.services.jobs import store
from backend.services.jobs.types import STATUS_FAILED_DLQ


logger = logging.getLogger(__name__)


# Redis-side mirror — capped LIST of recent DLQ entries.
DLQ_REDIS_KEY = "korvix.dlq.list"


def _dlq_redis_cap() -> int:
    try:
        return max(50, min(int(os.getenv("DLQ_REDIS_CAP", "500") or 500), 10_000))
    except Exception:
        return 500


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


async def dlq_enqueue(
    record_id: str,
    *,
    kind: str,
    error: str,
    attempts: int,
    user_id: Optional[str] = None,
) -> None:
    """Route an exhausted job to the DLQ. Idempotent at the DB level
    (the row's status flip is the source of truth); the Redis mirror
    may double-write under retry but that's harmless — operator-side
    deduplication happens by `record_id`.
    """
    # 1) DB — authoritative. The store's `error` column is dict-typed
    # (JSON-encoded), so wrap the message + DLQ metadata in a struct
    # rather than passing a raw string.
    try:
        store.update(
            record_id,
            status=STATUS_FAILED_DLQ,
            error={
                "message":   (error or "")[:1000],
                "dlq":       True,
                "attempts":  int(attempts),
            },
            finished_at=_now_iso(),
        )
    except Exception as exc:
        logger.warning(
            "[JOB][DLQ] db flip failed record_id=%s err=%s",
            record_id, exc,
        )
        raise

    # 2) Redis mirror — best-effort.
    payload = {
        "record_id": record_id,
        "kind":      kind,
        "error":     (error or "")[:500],
        "attempts":  int(attempts),
        "user_id":   user_id,
        "ts":        _now_iso(),
    }
    try:
        from backend.services.redis_client import is_enabled, get_async_client
        from backend.services.redis_client.errors import (
            RedisConfigError, RedisUnavailable,
        )
    except Exception:                                       # pragma: no cover
        return

    if not is_enabled():
        return

    try:
        client = await get_async_client()
        # LPUSH + LTRIM keeps the list bounded; most recent first.
        pipe = client.pipeline()
        pipe.lpush(DLQ_REDIS_KEY, json.dumps(payload))
        pipe.ltrim(DLQ_REDIS_KEY, 0, _dlq_redis_cap() - 1)
        await pipe.execute()
        logger.info(
            "[JOB][DLQ] record_id=%s kind=%s attempts=%d (Redis mirror updated)",
            record_id, kind, attempts,
        )
    except (RedisConfigError, RedisUnavailable):
        # Redis unavailable — DB row is still flipped, just no Redis
        # mirror. Operator sees the failure via /v2/jobs?status=failed_dlq.
        pass
    except Exception as exc:                                  # pragma: no cover
        logger.warning(
            "[JOB][DLQ] redis mirror failed record_id=%s err=%s",
            record_id, exc,
        )


async def dlq_list(limit: int = 50) -> list[dict]:
    """Read recent DLQ entries from the Redis mirror. Returns [] when
    Redis is off or the list is empty. Owner-facing — caller enforces
    auth."""
    limit = max(1, min(int(limit), _dlq_redis_cap()))
    try:
        from backend.services.redis_client import is_enabled, get_async_client
        if not is_enabled():
            return []
        client = await get_async_client()
        raw = await client.lrange(DLQ_REDIS_KEY, 0, limit - 1)
    except Exception as exc:                                  # pragma: no cover
        logger.warning("[JOB][DLQ] list read failed: %s", exc)
        return []

    out: list[dict] = []
    for r in raw or []:
        try:
            if isinstance(r, bytes):
                r = r.decode("utf-8")
            out.append(json.loads(r))
        except Exception:                                     # pragma: no cover
            continue
    return out


async def dlq_clear() -> int:
    """Empty the Redis mirror. The DB rows remain — this is just the
    cache. Returns the count removed."""
    try:
        from backend.services.redis_client import is_enabled, get_async_client
        if not is_enabled():
            return 0
        client = await get_async_client()
        before = int(await client.llen(DLQ_REDIS_KEY))
        if before:
            await client.delete(DLQ_REDIS_KEY)
        return before
    except Exception:                                         # pragma: no cover
        return 0


__all__ = ["dlq_enqueue", "dlq_list", "dlq_clear", "DLQ_REDIS_KEY"]
