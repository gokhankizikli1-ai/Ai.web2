# coding: utf-8
"""Phase 7 slice 2 — Redis pub/sub fanout for job events.

Bridges the per-process in-memory `JobEventBus` to a cross-process
Redis channel so worker-published progress events reach API-process
SSE subscribers.

Architecture:

    +-----------+   pub korvix.jobs.<id>   +-----------+
    |  worker   | -----------------------> |   Redis   |
    +-----------+                          +-----------+
                                                |
                                  PSUBSCRIBE korvix.jobs.*
                                                v
                                       +------------------+
                                       |   API replica    |
                                       | RedisFanout      |
                                       | re-publish to    |
                                       | local JobEventBus|
                                       +------------------+
                                                |
                                                v
                                       +------------------+
                                       |  SSE consumers   |
                                       |  /v2/jobs/{}/stream
                                       +------------------+

Why this shape:
  * Workers don't know which API replica holds the SSE client. They
    just publish; Redis fans out.
  * Each API replica runs ONE fanout background task. Every SSE client
    on that replica gets the event via the existing in-process bus —
    no per-client Redis connection (would blow the connection budget
    on Upstash).
  * When ENABLE_REDIS=false the fanout no-ops and the in-process bus
    is the only path — same as before slice 2.

Failure rules:
  * Subscriber crash → background task respawns with backoff.
  * Redis disconnect → reconnect with exponential backoff.
  * Malformed message → log + skip; never crash the fanout loop.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Optional

from backend.services.jobs.events import get_bus
from backend.services.jobs.types import JobEvent
from backend.services.redis_client import (
    is_enabled as _redis_enabled,
    get_async_client,
    metrics as _redis_metrics,
)
from backend.services.redis_client.errors import (
    RedisConfigError, RedisUnavailable,
)


logger = logging.getLogger(__name__)


# Channel pattern — matches anything under the korvix.jobs namespace so
# we get a single PSUBSCRIBE instead of one SUBSCRIBE per job_id (which
# wouldn't scale).
CHANNEL_PREFIX  = "korvix.jobs."
CHANNEL_PATTERN = CHANNEL_PREFIX + "*"


def channel_for(job_id: str) -> str:
    """Per-job channel name. Workers publish here; the fanout sub-
    scribes to the wildcard and demultiplexes by job_id."""
    return CHANNEL_PREFIX + (job_id or "unknown")


def _serialise(event: JobEvent) -> str:
    """Compact JSON line — keeps each PUBLISH small for Upstash."""
    return json.dumps({
        "job_id":    event.job_id,
        "kind":      event.kind,
        "payload":   event.payload or {},
        "timestamp": event.timestamp,
    })


def _deserialise(raw: bytes | str) -> Optional[JobEvent]:
    """Best-effort parse. Returns None on malformed input so the
    fanout loop never crashes on a bad message."""
    try:
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8")
        data = json.loads(raw)
        if not isinstance(data, dict):
            return None
        return JobEvent(
            job_id=    str(data.get("job_id") or ""),
            kind=      str(data.get("kind") or "log"),
            payload=   data.get("payload") or {},
            timestamp= data.get("timestamp") or "",
        )
    except Exception as exc:
        logger.warning("[JOB][REDIS] deserialise failed: %s", exc)
        return None


# ── Publish path (called by workers + by JobEventBus.publish) ─────────────

async def publish_to_redis(event: JobEvent) -> bool:
    """Publish a JobEvent to Redis. Returns True on success, False on
    any failure (including Redis being disabled). Caller continues with
    the local bus regardless — the Redis path is additive.
    """
    if not _redis_enabled():
        return False
    try:
        client = await get_async_client()
        await client.publish(channel_for(event.job_id), _serialise(event))
        _redis_metrics.publish_recorded()
        return True
    except (RedisConfigError, RedisUnavailable):
        return False
    except Exception as exc:                                  # pragma: no cover
        logger.warning("[JOB][REDIS] publish failed job=%s err=%s",
                       event.job_id, exc)
        _redis_metrics.command_recorded(ok=False, error=str(exc))
        return False


# ── Subscribe path (background task on each API replica) ──────────────────

class RedisFanout:
    """Singleton fanout subscriber. Runs as one asyncio.Task that
    PSUBSCRIBEs to the wildcard channel, deserialises each message,
    and republishes onto the in-process JobEventBus.

    Lifecycle:
      start() — idempotent; no-op when already running or Redis off
      stop()  — clean shutdown on app teardown
    """

    def __init__(self) -> None:
        self._task:    Optional[asyncio.Task] = None
        self._stopping: bool = False
        self._reconnect_min  = 1.0
        self._reconnect_max  = 30.0

        self._stats: dict = {
            "started":     False,
            "messages":    0,
            "republishes": 0,
            "errors":      0,
            "last_error":  "",
        }

    async def start(self) -> None:
        if self._task is not None and not self._task.done():
            return
        if not _redis_enabled():
            logger.info("[JOB][REDIS] fanout not started (Redis disabled)")
            return
        self._stopping = False
        self._task = asyncio.create_task(self._run(), name="korvix.jobs.fanout")
        self._stats["started"] = True
        logger.info("[JOB][REDIS] fanout task started pattern=%s", CHANNEL_PATTERN)

    async def stop(self) -> None:
        self._stopping = True
        task = self._task
        self._task = None
        if task is not None:
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):       # pragma: no cover
                pass
        self._stats["started"] = False

    def stats(self) -> dict:
        return dict(self._stats)

    # ── internals ─────────────────────────────────────────────────

    async def _run(self) -> None:
        backoff = self._reconnect_min
        while not self._stopping:
            try:
                await self._consume_loop()
                backoff = self._reconnect_min            # success → reset backoff
            except (RedisConfigError, RedisUnavailable) as exc:
                self._stats["errors"] += 1
                self._stats["last_error"] = str(exc)[:140]
                logger.warning("[JOB][REDIS] fanout disconnect: %s — backoff %.1fs",
                               exc, backoff)
            except asyncio.CancelledError:
                logger.info("[JOB][REDIS] fanout cancelled")
                return
            except Exception as exc:                          # pragma: no cover
                self._stats["errors"] += 1
                self._stats["last_error"] = str(exc)[:140]
                logger.warning("[JOB][REDIS] fanout error: %s — backoff %.1fs",
                               exc, backoff)
            if self._stopping:
                return
            try:
                await asyncio.sleep(backoff)
            except asyncio.CancelledError:
                return
            backoff = min(backoff * 2, self._reconnect_max)

    async def _consume_loop(self) -> None:
        client = await get_async_client()
        pubsub = client.pubsub()
        await pubsub.psubscribe(CHANNEL_PATTERN)
        _redis_metrics.subscribe_recorded()
        logger.info("[JOB][REDIS] fanout PSUBSCRIBE %s", CHANNEL_PATTERN)

        try:
            async for message in pubsub.listen():
                if self._stopping:
                    break
                if not isinstance(message, dict):
                    continue
                mtype = message.get("type")
                # Initial 'psubscribe' confirmation has type='psubscribe';
                # actual messages are type='pmessage'.
                if mtype != "pmessage":
                    continue
                self._stats["messages"] += 1
                data = message.get("data")
                event = _deserialise(data)
                if event is None:
                    continue
                # Re-publish to the local in-process bus via the
                # LOCAL-ONLY path. Using JobEventBus.publish() here
                # would re-publish to Redis on every API replica,
                # creating an infinite event storm.
                try:
                    await get_bus()._publish_local(event)
                    self._stats["republishes"] += 1
                except Exception as exc:                       # pragma: no cover
                    self._stats["errors"] += 1
                    self._stats["last_error"] = str(exc)[:140]
        finally:
            try:
                await pubsub.aclose()
            except Exception:                                  # pragma: no cover
                pass


# Singleton instance — one per API replica.
_fanout: Optional[RedisFanout] = None


def get_fanout() -> RedisFanout:
    global _fanout
    if _fanout is None:
        _fanout = RedisFanout()
    return _fanout


__all__ = [
    "channel_for", "publish_to_redis",
    "RedisFanout", "get_fanout",
    "CHANNEL_PREFIX", "CHANNEL_PATTERN",
]
