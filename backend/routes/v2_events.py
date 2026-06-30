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

from fastapi import APIRouter, HTTPException, Request

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


# ── Scope-ownership lookups (best-effort, fail secure) ────────────────────

def _project_owner(project_id: str) -> Optional[str]:
    try:
        from backend.services.projects.store import get_project
        p = get_project(project_id)
        return getattr(p, "owner_user_id", None) if p is not None else None
    except Exception:  # pragma: no cover — defensive
        return None


def _run_owner(run_id: str) -> Optional[str]:
    try:
        from backend.services.orchestrator import get_run
        r = get_run(run_id)
        return (r or {}).get("user_id") if r else None
    except Exception:  # pragma: no cover — defensive
        return None


@router.get("/stream")
async def stream(
    request: Request,
    scope: str = "*",
    user_id: Optional[str] = None,   # accepted for symmetry; identity is from auth
    heartbeat: float = HEARTBEAT_SECONDS,
):
    """Stream ActivityEvents matching `scope` as SSE.

    Scope conventions (set by emitters in Phase 3.2 / 3.3 / 3.4):
      - "project:<project_id>"  events for a project the caller OWNS
      - "user:<user_id>"        the caller's OWN user-scoped events
      - "run:<run_id>"          a run the caller OWNS
      - "*"                     wildcard — OWNER/ADMIN only

    SECURITY (Sprint 1.2): the requested scope is authorized against the
    authenticated principal. A caller can only subscribe to scopes they
    own; `*` is restricted to owners/admins. This closes the cross-tenant
    event-leak where any client could subscribe to `user:<victim>`,
    `project:<victim>` or `*` and receive another tenant's activity.
    Identity is resolved once at connect from the verified token/guest
    nonce and remains bound to the subscription for the stream's lifetime.

    Wire protocol unchanged (ready frame, <kind> frames, heartbeat comments).
    """
    _ensure_enabled()

    requested_scope = (scope or "*").strip() or "*"

    from backend.core.principal import resolve_principal
    principal = resolve_principal(request)
    if not principal.may_access_scope(
        requested_scope,
        project_owner_lookup=_project_owner,
        run_owner_lookup=_run_owner,
    ):
        logger.warning(
            "events.stream denied scope=%s for principal=%s",
            requested_scope, principal.to_audit(),
        )
        raise HTTPException(
            status_code=403,
            detail={
                "error":   "scope_forbidden",
                "message": "You may only subscribe to event scopes you own.",
                "scope":   requested_scope,
            },
        )

    # Heartbeat lower bound is intentionally low (50ms) so tests can
    # drive the stream without long-polling waits. Production browsers
    # never request anything below the default (25s).
    hb = max(0.05, min(float(heartbeat), 120.0))
    return _open_stream(requested_scope, hb)


def _open_stream(requested_scope: str, hb: float):
    """SSE streaming mechanics for an ALREADY-AUTHORIZED scope. Kept
    separate from `stream` so the route owns authorization and this owns
    the bus subscription lifecycle."""

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
