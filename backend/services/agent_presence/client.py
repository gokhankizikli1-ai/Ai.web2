# coding: utf-8
"""Phase 9 — AgentPresenceClient.

In-memory presence registry, keyed by (panel_id, agent_id). The whole
thing fits in a dict because:

  - the snapshot is small (10s of agents × 10s of active panels, in
    the worst case).
  - the persistence target is NOT this dict — it's the event stream
    we publish to events/bus on every update. Subscribers (SSE
    consumers, future Redis backend, observability) reconstruct
    history from the bus.
  - presence is ephemeral: an agent that hasn't reported in 60s is
    GC'd, and the next page load reads the live snapshot fresh.

Concurrency:
  - threading.Lock around the inner dict. Updates are O(1) and the
    bus publish call doesn't await, so contention is negligible.
  - The lock guards against multi-threaded route handlers writing the
    same key (uvicorn workers default to single-thread but uvloop +
    asyncio.run_in_executor can still race).
"""
from __future__ import annotations

import logging
import os
import threading
import time
from typing import Optional

from backend.services.agent_presence.types import (
    PresenceState, normalize_state, TERMINAL_STATES,
    STATE_IDLE,
)


logger = logging.getLogger(__name__)


def is_enabled() -> bool:
    """ENABLE_AGENT_PRESENCE — gates writes and the /v2/agents/presence
    route. Reads short-circuit to empty when off; in-process callers
    don't need to check the flag themselves."""
    return os.getenv("ENABLE_AGENT_PRESENCE", "false").strip().lower() == "true"


# Stale rows older than this are GC'd from the snapshot on read. The
# bus subscriber that fed them is responsible for sending heartbeats —
# 90s is generous enough for a long-running tool call to keep its
# state visible.
_STALE_TTL_SEC = 90


def _now_ms() -> int:
    return int(time.time() * 1000)


class AgentPresenceClient:
    def __init__(self) -> None:
        # Keyed by (panel_id, agent_id) → PresenceState. The double key
        # makes "list everyone on this panel" an O(N) scan over a small
        # dict (acceptable). A panel index could speed it up later;
        # the current cost is negligible.
        self._snapshot: dict[tuple[str, str], PresenceState] = {}
        self._lock = threading.Lock()

    def is_enabled(self) -> bool:
        return is_enabled()

    # ── Writes ─────────────────────────────────────────────────────────────

    def update(
        self,
        *,
        panel_id:     str,
        agent_id:     str,
        state:        str,
        current_task: Optional[str] = None,
        progress:     Optional[int] = None,
        detail:       Optional[str] = None,
        metadata:     Optional[dict] = None,
        project_id:   Optional[str] = None,
    ) -> Optional[PresenceState]:
        """Set / replace presence for one agent in one panel.

        Emits a `presence.changed` event on the bus so SSE subscribers
        get a push update. The event scope is `panel:<id>` so a
        consumer can subscribe to one panel and not be flooded by
        other panels' presence churn.
        """
        if not is_enabled():
            return None
        if not (panel_id and agent_id):
            return None

        norm_state = normalize_state(state)
        now = _now_ms()
        key = (panel_id, agent_id)

        with self._lock:
            prev = self._snapshot.get(key)
            # Only reset started_at when the STATE actually changes —
            # otherwise a heartbeat in the same state would reset the
            # "active for 12s" display.
            started = prev.started_at_ms if (prev and prev.state == norm_state) else now
            row = PresenceState(
                panel_id=        panel_id,
                agent_id=        agent_id,
                state=           norm_state,
                current_task=    current_task,
                progress=        progress if progress is None else max(0, min(100, int(progress))),
                detail=          detail,
                metadata=        dict(metadata or {}),
                started_at_ms=   started,
                last_seen_at_ms= now,
            )
            self._snapshot[key] = row

        # Publish on the bus — keep this outside the lock so a slow
        # subscriber can't block other writers.
        try:
            from backend.services.events import bus as _bus
            from backend.services.events.types import ActivityEvent
            scope = f"panel:{panel_id}"
            evt = ActivityEvent(
                kind="presence.changed",
                scope=scope,
                agent_id=agent_id,
                payload={
                    "panel_id":     panel_id,
                    "agent_id":     agent_id,
                    "state":        norm_state,
                    "current_task": current_task,
                    "progress":     row.progress,
                    "detail":       detail,
                    "project_id":   project_id,
                },
            )
            _bus.publish(evt)
        except Exception as e:
            # Bus failure must not block presence writes — observability
            # is best-effort by design.
            logger.debug("presence.update bus publish failed: %s", e)

        return row

    def clear(self, *, panel_id: str, agent_id: str) -> None:
        """Remove an agent from the panel snapshot. Idempotent."""
        if not is_enabled():
            return
        with self._lock:
            self._snapshot.pop((panel_id, agent_id), None)

    def clear_panel(self, panel_id: str) -> None:
        """Remove every agent from a panel — used when the panel
        reaches a terminal status."""
        if not is_enabled():
            return
        with self._lock:
            for key in [k for k in self._snapshot.keys() if k[0] == panel_id]:
                self._snapshot.pop(key, None)

    # ── Reads ──────────────────────────────────────────────────────────────

    def snapshot(self, *, panel_id: str) -> list[PresenceState]:
        """Return every active agent for a panel, fresh-only. Stale
        rows (> _STALE_TTL_SEC since last_seen) are dropped from the
        result AND evicted from the in-memory dict so the next call
        is fast."""
        if not is_enabled():
            return []
        now = _now_ms()
        threshold = now - (_STALE_TTL_SEC * 1000)
        live: list[PresenceState] = []
        with self._lock:
            stale_keys = []
            for key, row in self._snapshot.items():
                if key[0] != panel_id:
                    continue
                if row.last_seen_at_ms < threshold and row.state not in TERMINAL_STATES:
                    # Terminal states are kept until explicitly cleared
                    # so the UI can show "completed at 12:04" until the
                    # panel itself closes.
                    stale_keys.append(key)
                    continue
                live.append(row)
            for k in stale_keys:
                self._snapshot.pop(k, None)
        # Sort by started_at so the FE renders the longest-running
        # agent first (matches typical "supervisor → specialists" order).
        live.sort(key=lambda r: r.started_at_ms)
        return live

    def stats(self) -> dict:
        """Snapshot diagnostics for /v2/health-style probes."""
        if not is_enabled():
            return {"enabled": False, "total": 0}
        with self._lock:
            total = len(self._snapshot)
            states: dict[str, int] = {}
            for row in self._snapshot.values():
                states[row.state] = states.get(row.state, 0) + 1
        return {"enabled": True, "total": total, "by_state": states}


# Module-level singleton — process-local state.
client = AgentPresenceClient()


__all__ = ["AgentPresenceClient", "client", "is_enabled"]
