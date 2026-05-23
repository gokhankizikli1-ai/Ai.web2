# coding: utf-8
# Phase 3.2 — In-process Event Bus.
#
# Single-process pub/sub with bounded per-subscriber queues. Designed
# to be:
#
#   - PUBLISH-CHEAP. publish() is called from inside the agent hot
#     loop. It MUST NOT block, await, or allocate beyond a queue
#     enqueue. Failures are dropped silently — the bus is observability;
#     it must never compromise the runtime.
#
#   - SUBSCRIBE-SAFE. Subscribers register a scope filter, get an
#     asyncio.Queue, and own the lifecycle. Forgetting to .close() is
#     a leak, not a crash — but the Subscription is a context manager
#     to make the right thing easy.
#
#   - FLAG-GATED. ENABLE_REALTIME_EVENTS=false (default) → publish is
#     a no-op and subscribe returns an immediately-empty subscription.
#     The runtime can emit events unconditionally; the cost is zero
#     when the flag is off.
#
# Multi-replica deployment will swap this implementation for a Redis
# Pub/Sub backed one behind the same publish/subscribe API.

import asyncio
import logging
import os
import threading
from typing import Dict, List, Optional

from backend.services.events.types import ActivityEvent

logger = logging.getLogger(__name__)


def is_enabled() -> bool:
    """Check the realtime-events flag. Read each call so flag flips
    during a test session take effect (monkeypatch-friendly)."""
    return os.getenv("ENABLE_REALTIME_EVENTS", "false").strip().lower() == "true"


# Default backpressure: drop oldest events when a subscriber falls
# behind by more than 256 unconsumed events. Tuned so a slow SSE
# client can't push the runtime into memory pressure.
_DEFAULT_MAXSIZE = 256


class Subscription:
    """Handle for a single subscriber.

    Usage (recommended — guarantees cleanup):

        with bus.subscribe("project:abc") as sub:
            event = await sub.get()
            ...

    Manual lifecycle is also supported via .close().
    """
    __slots__ = ("_bus", "_scope", "queue", "_closed")

    def __init__(self, bus: "InProcessEventBus", scope: str, queue: asyncio.Queue):
        self._bus = bus
        self._scope = scope
        self.queue = queue
        self._closed = False

    async def get(self) -> ActivityEvent:
        """Block until the next event arrives. Raises asyncio.CancelledError
        if the subscription closes or the task is cancelled."""
        return await self.queue.get()

    def empty(self) -> bool:
        return self.queue.empty()

    def qsize(self) -> int:
        return self.queue.qsize()

    def __enter__(self) -> "Subscription":
        return self

    def __exit__(self, *exc_info) -> None:
        self.close()

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        try:
            self._bus._unregister(self._scope, self.queue)
        except Exception:
            pass


class InProcessEventBus:
    """Single-process pub/sub keyed on event.scope.

    Concurrent-safe via a threading.Lock around the subscriber map.
    publish() runs synchronously and never awaits — safe to call from
    sync or async code paths.
    """

    def __init__(self) -> None:
        self._subs:     Dict[str, List[asyncio.Queue]] = {}
        self._all_subs: List[asyncio.Queue]            = []
        self._lock = threading.Lock()
        # Counters surfaced via stats() — observability for the bus
        # itself (useful when debugging "events not arriving").
        self._published   = 0
        self._delivered   = 0
        self._dropped     = 0
        self._subscribers = 0

    # ── publish ────────────────────────────────────────────────────────

    def publish(self, event: ActivityEvent) -> int:
        """Synchronous, fan-out. Returns the count of subscribers it was
        successfully enqueued to. Always safe to call — never raises."""
        if not is_enabled():
            return 0
        with self._lock:
            scoped = list(self._subs.get(event.scope, ()))
            wildcard = list(self._all_subs)
            self._published += 1
        delivered = 0
        for q in scoped + wildcard:
            try:
                q.put_nowait(event)
                delivered += 1
            except asyncio.QueueFull:
                with self._lock:
                    self._dropped += 1
                logger.debug("event_bus.dropped | scope=%s | kind=%s", event.scope, event.kind)
            except Exception as exc:   # pragma: no cover — defensive
                logger.debug("event_bus.publish error: %s", exc)
        with self._lock:
            self._delivered += delivered
        return delivered

    # ── subscribe ─────────────────────────────────────────────────────

    def subscribe(self, scope: str = "*", *, maxsize: int = _DEFAULT_MAXSIZE) -> Subscription:
        """Register a subscriber for `scope`. Pass "*" for all events.

        When ENABLE_REALTIME_EVENTS=false, returns a subscription whose
        queue is never populated — caller can still await events but
        none will arrive. This lets the SSE route (Phase 3.5) be wired
        unconditionally and simply produce an empty stream when off.
        """
        q: asyncio.Queue = asyncio.Queue(maxsize=maxsize)
        if not is_enabled():
            # Subscription is inert — never registered, never cleaned up.
            return Subscription(self, scope, q)
        with self._lock:
            if scope == "*":
                self._all_subs.append(q)
            else:
                self._subs.setdefault(scope, []).append(q)
            self._subscribers += 1
        return Subscription(self, scope, q)

    def _unregister(self, scope: str, q: asyncio.Queue) -> None:
        """Remove `q` from the subscriber map. Used by Subscription.close()."""
        with self._lock:
            if scope == "*":
                if q in self._all_subs:
                    self._all_subs.remove(q)
                    self._subscribers = max(0, self._subscribers - 1)
            else:
                lst = self._subs.get(scope)
                if lst and q in lst:
                    lst.remove(q)
                    self._subscribers = max(0, self._subscribers - 1)
                    if not lst:
                        del self._subs[scope]

    # ── observability ────────────────────────────────────────────────

    def stats(self) -> dict:
        with self._lock:
            return {
                "enabled":     is_enabled(),
                "subscribers": self._subscribers,
                "published":   self._published,
                "delivered":   self._delivered,
                "dropped":     self._dropped,
                "scopes":      list(self._subs.keys()),
                "wildcard_subs": len(self._all_subs),
            }


# Module-level singleton — the only intended entry point for runtime
# code. Tests can construct their own InProcessEventBus instances and
# either use it directly or monkeypatch this name.
bus = InProcessEventBus()


# ── Convenience emit helpers ─────────────────────────────────────────────
# Centralized so call sites (run_context.py, runtime.py) don't repeat
# the boilerplate of building scope strings and try/except wrapping.

def emit(
    kind: str,
    *,
    run_id: Optional[str] = None,
    agent_id: Optional[str] = None,
    project_id: Optional[str] = None,
    user_id: Optional[str] = None,
    payload: Optional[dict] = None,
) -> None:
    """Build and publish an ActivityEvent. Never raises.

    Scope selection precedence (highest first):
      1. project:<id>  when project_id is set (UI subscribes here)
      2. user:<id>     fallback for user-scoped streams
      3. run:<run_id>  fallback for pure run-scoped streams
      4. "*"           guaranteed-deliverable wildcard
    """
    try:
        if project_id:
            scope = f"project:{project_id}"
        elif user_id:
            scope = f"user:{user_id}"
        elif run_id:
            scope = f"run:{run_id}"
        else:
            scope = "*"
        bus.publish(ActivityEvent(
            kind=kind, scope=scope, run_id=run_id, agent_id=agent_id,
            payload=payload or {},
        ))
    except Exception as exc:  # pragma: no cover — defensive
        logger.debug("emit error: %s", exc)


__all__ = [
    "InProcessEventBus",
    "Subscription",
    "is_enabled",
    "bus",
    "emit",
]
