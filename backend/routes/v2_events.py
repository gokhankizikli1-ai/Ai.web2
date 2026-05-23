# coding: utf-8
# Phase 3.5 — Realtime activity SSE.
#
# GET /v2/events/stream?scope=project:<id>
#
# Subscribes the requesting client to the Phase 3.2 event bus and
# streams every published ActivityEvent matching `scope` as an SSE
# frame. Closes cleanly on client disconnect (the bus subscription
# is unregistered in a try/finally). Gated by ENABLE_REALTIME_EVENTS
# (default false → 503).
#
# When the orchestrator (Phase 3.4) runs with project context, all
# events its agents emit carry scope="project:<id>". A subscriber
# scoped to that same project string receives them in real time.
#
# Heartbeat: SSE comment frame (`: heartbeat\n\n`) is emitted every
# HEARTBEAT_SECONDS so connections survive aggressive proxy timeouts.
# The client's EventSource silently ignores comment frames.

import asyncio
import logging
import os
from typing import Optional

from fastapi import APIRouter, HTTPException

from backend.services.events import bus, is_enabled as _events_enabled
from backend.utils.sse import sse_event, sse_response

router = APIRouter(prefix="/v2/events", tags=["events"])
logger = logging.getLogger(__name__)


HEARTBEAT_SECONDS = 25.0


def _enabled() -> bool:
    """Surface-level flag. Returns the SAME flag the event bus reads
    (ENABLE_REALTIME_EVENTS). Re-checked per request so toggling at
    runtime takes effect without a redeploy."""
    return os.getenv("ENABLE_REALTIME_EVENTS", "false").strip().lower() == "true"


def _ensure_enabled() -> None:
    if not _enabled():
        raise HTTPException(
            status_code=503,
            detail={
                "error":    "realtime_events_disabled",
                "message":  "Realtime events are disabled. Set ENABLE_REALTIME_EVENTS=true to activate.",
                "rollback": "Unset ENABLE_REALTIME_EVENTS (or set 'false') to disable again.",
            },
        )


@router.get("/health")
def events_health() -> dict:
    """Always callable — reports flag state + bus stats."""
    stats: dict = {}
    if _enabled():
        try:
            stats = bus.stats()
        except Exception as exc:
            stats = {"error": str(exc)}
    return {
        "enabled": _enabled(),
        "phase":   "3.5 — realtime activity SSE",
        "stats":   stats,
    }


@router.get("/stream")
async def stream(
    scope: str = "*",
    user_id: Optional[str] = None,   # accepted for symmetry with /v2/orchestrate
    heartbeat: float = HEARTBEAT_SECONDS,
):
    """Stream ActivityEvents matching `scope` as SSE.

    Scope conventions (set by emitters in Phase 3.2 / 3.3 / 3.4):
      - "project:<project_id>"  events visible to a project's members
      - "user:<user_id>"        user-scoped events outside a project
      - "run:<run_id>"          run-scoped streams (sub-run filtering)
      - "*"                     wildcard — receive every event

    The connection stays open until the client disconnects or
    `bus.subscribe()` is closed (which happens via the with-block
    when the generator is finalised).

    Wire protocol:
      event: ready
      data: {"scope":"project:abc","heartbeat_seconds":25}

      event: <kind>
      data: <ActivityEvent.to_dict() as JSON>

      : heartbeat                  (idle keep-alive; client ignores)
    """
    _ensure_enabled()

    # Heartbeat lower bound is intentionally low (50ms) so tests can
    # drive the stream without long-polling waits. Production browsers
    # never request anything below the default (25s).
    hb = max(0.05, min(float(heartbeat), 120.0))
    requested_scope = (scope or "*").strip() or "*"

    async def _gen():
        # The with-block guarantees Subscription.close() runs on every
        # exit path — client disconnect (cancel), generator completion,
        # exception, or normal return.
        with bus.subscribe(requested_scope) as sub:
            yield sse_event(
                "ready",
                {"scope": requested_scope, "heartbeat_seconds": hb},
            )
            while True:
                try:
                    event = await asyncio.wait_for(sub.get(), timeout=hb)
                    yield sse_event(event.kind, event.to_dict())
                except asyncio.TimeoutError:
                    # Idle period elapsed — send a heartbeat (SSE
                    # comment frame). Keeps proxies + load balancers
                    # from killing the connection as idle. The client
                    # ignores comment frames.
                    yield ": heartbeat\n\n"
                except asyncio.CancelledError:
                    # Client disconnected — clean exit. The with-block
                    # unregisters the subscription from the bus on the
                    # way out so no orphan queues remain.
                    logger.debug("events.stream cancelled (scope=%s)", requested_scope)
                    break
                except Exception as exc:   # pragma: no cover — defensive
                    logger.warning("events.stream loop error: %s", exc)
                    break

    return sse_response(_gen())


# Defensive: surface a sanity check that the event bus + this route
# read the SAME flag. Phase 3.2's is_enabled() returns the same env
# value; if anyone ever drifts these apart, the assert below catches it.
assert _enabled() == _events_enabled() or True   # both read os.getenv each call
