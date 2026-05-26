# coding: utf-8
"""
Phase 7 — Job event bus.

Process-local async pub/sub used by:
  * The runner — emits status / progress / done / error events as a
    job executes.
  * The SSE stream route — subscribes to a job's events and forwards
    them to the connected client.

Design notes:
  * Per-job channels (keyed by job_id). When a subscriber registers,
    we create the channel on demand; when the last subscriber goes
    away the channel is removed. This keeps memory bounded under
    bursts of one-off subscribers.
  * `publish()` is fire-and-forget — if no subscribers exist for the
    job, the event is dropped. The DB row IS the durable record;
    the bus is the live-update fast path.
  * Subscribers receive an `asyncio.Queue` they can `.get()` on. The
    SSE route awaits this with a heartbeat timeout so dead clients
    are cleaned up.
  * For Phase 7 we use asyncio.Queue per subscriber. The same shape
    maps onto Redis pub/sub when the celery mode lands — the
    publisher emits to a Redis channel, each API replica subscribes
    and demultiplexes to its local subscribers.
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import asdict
from datetime import datetime, timezone
from typing import AsyncIterator, Optional

from backend.services.jobs.types import JobEvent


logger = logging.getLogger(__name__)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class JobEventBus:
    """Process-local pub/sub. One per JobsClient instance.

    Subscribers are per-job; publishers don't need to know who is
    listening. The bus is async-safe inside a single event loop.
    """

    def __init__(self) -> None:
        # job_id -> set of queues. Using sets so unsubscribe is O(1).
        self._subscribers: dict[str, set[asyncio.Queue]] = {}
        self._lock = asyncio.Lock()
        self._stats = {
            "publishes":   0,
            "subscribes":  0,
            "unsubscribes": 0,
            "drops":       0,    # events with no subscribers
        }

    async def publish(self, event: JobEvent) -> None:
        """Fan out to every subscriber of this job. Errors per-subscriber
        never block the others or the publisher."""
        if not event.timestamp:
            event.timestamp = _now()
        async with self._lock:
            subs = list(self._subscribers.get(event.job_id, ()))
        if not subs:
            self._stats["drops"] += 1
            return
        self._stats["publishes"] += 1
        for q in subs:
            try:
                # put_nowait so a slow consumer can't stall the publisher
                # (and other consumers). When the queue is full we drop —
                # the SSE route reads the DB row on connect for the
                # initial snapshot, so transient drops only miss
                # intermediate progress ticks.
                q.put_nowait(event)
            except asyncio.QueueFull:
                logger.warning("jobs.events queue full for job=%s — dropping event", event.job_id)

    async def subscribe(self, job_id: str, *, maxsize: int = 64) -> asyncio.Queue:
        """Register a queue and return it. Caller must `unsubscribe`
        when done — usually in a finally block."""
        q: asyncio.Queue = asyncio.Queue(maxsize=maxsize)
        async with self._lock:
            self._subscribers.setdefault(job_id, set()).add(q)
        self._stats["subscribes"] += 1
        return q

    async def unsubscribe(self, job_id: str, queue: asyncio.Queue) -> None:
        async with self._lock:
            subs = self._subscribers.get(job_id)
            if subs is None:
                return
            subs.discard(queue)
            if not subs:
                self._subscribers.pop(job_id, None)
        self._stats["unsubscribes"] += 1

    async def consume(
        self, job_id: str, *, heartbeat_s: float = 15.0,
    ) -> AsyncIterator[JobEvent]:
        """Convenience generator that handles subscribe/unsubscribe and
        emits a synthetic heartbeat when no event arrives within
        `heartbeat_s` seconds. The SSE route uses this so connections
        get periodic keep-alive even on idle jobs."""
        q = await self.subscribe(job_id)
        try:
            while True:
                try:
                    event = await asyncio.wait_for(q.get(), timeout=heartbeat_s)
                except asyncio.TimeoutError:
                    yield JobEvent(job_id=job_id, kind="heartbeat",
                                   payload={}, timestamp=_now())
                    continue
                yield event
        finally:
            await self.unsubscribe(job_id, q)

    def stats(self) -> dict:
        s = dict(self._stats)
        s["active_channels"] = len(self._subscribers)
        s["active_subscribers"] = sum(len(v) for v in self._subscribers.values())
        return s


# ── Singleton ────────────────────────────────────────────────────────────────

_bus: Optional[JobEventBus] = None


def get_bus() -> JobEventBus:
    global _bus
    if _bus is None:
        _bus = JobEventBus()
    return _bus


def _reset_for_tests() -> None:
    global _bus
    _bus = None


__all__ = [
    "JobEventBus", "get_bus", "_reset_for_tests",
]
