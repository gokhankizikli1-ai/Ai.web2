# coding: utf-8
"""/v2/agents/presence — Phase 9 part 2.

Read surface only. Presence WRITES come from inside the agent runtime
(when a tool is invoked, a delegation starts, etc.) — the FE never
posts presence updates because that would let a client spoof another
user's agent activity.

SSE wiring will be a follow-up PR through the existing events/bus.
For now the FE polls this endpoint every 4-8 seconds — the snapshot
is in-memory and the read is O(N) over a small dict, so polling at
this rate is cheap.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from backend.core.deps import current_user
from backend.core.responses import ok as envelope_ok
from backend.services.agent_presence import client as presence_client
from backend.services.auth.identity import User
from backend.services.panels import client as panel_client


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v2", tags=["agent-presence-v2"])


def _ensure_enabled() -> None:
    if not presence_client.is_enabled():
        raise HTTPException(
            status_code=503,
            detail={
                "code":     "AGENT_PRESENCE_DISABLED",
                "message":  "Agent presence is disabled. Set ENABLE_AGENT_PRESENCE=true.",
                "rollback": "Unset ENABLE_AGENT_PRESENCE to disable.",
            },
        )


@router.get("/agents/presence")
def list_panel_presence(
    panel_id: str = Query(..., max_length=128),
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    """Snapshot of every agent currently active on a panel.

    Ownership: confirms the caller owns the panel before exposing
    presence — otherwise a stranger with a guessed panel_id could
    enumerate which agents are running on it.
    """
    _ensure_enabled()
    # Panel ownership gate. If ENABLE_REAL_COORDINATION is off the
    # panel client is dark and `.get` returns None; we still allow the
    # presence read when the caller's process is the writer (in-process
    # callers don't go through this route).
    if panel_client.is_enabled():
        panel = panel_client.get(panel_id, user_id=user.id)
        if panel is None:
            raise HTTPException(
                status_code=404,
                detail={"code": "PANEL_NOT_FOUND", "id": panel_id},
            )
    rows = presence_client.snapshot(panel_id=panel_id)
    return envelope_ok(
        data={"presence": [r.to_dict() for r in rows]},
        endpoint="/v2/agents/presence",
        user_id=user.id,
        count=len(rows),
    )


@router.get("/agents/presence/stats", include_in_schema=False)
def presence_stats(
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    """Diagnostic — total live presence rows by state. Owner-friendly
    for ops dashboards; not part of the documented API."""
    _ensure_enabled()
    return envelope_ok(
        data=presence_client.stats(),
        endpoint="/v2/agents/presence/stats",
        user_id=user.id,
    )


__all__ = ["router"]
