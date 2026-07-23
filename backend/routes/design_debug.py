# coding: utf-8
"""
GET /debug/design-trace/{build_id} — developer-only Design Decision Trace inspection.

Read-only. Returns the sanitized design-decision trace recorded by the observability
layer for a build. DISABLED BY DEFAULT: gated by ``ENABLE_DESIGN_DEBUG`` and owner-only
(non-owners get a 404 via ``require_owner``, so the endpoint's existence isn't signalled).
When the flag is off it returns 404 as if it did not exist. It never touches generation,
never returns raw prompts / personal data / API keys / internal scoring, and never raises
a 500 (missing trace → 404).
"""
from __future__ import annotations

import logging
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException

from backend.core.deps import require_owner
from backend.services.auth.identity import User
from backend.services import design_debug

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/debug", tags=["design-debug"])


@router.get("/design-trace/{build_id}")
async def get_design_trace(
    build_id: str,
    user: User = Depends(require_owner),
) -> Dict[str, Any]:
    """Return the sanitized design-decision trace for ``build_id``.

    404 when the debug surface is disabled, the caller is not the owner, or no trace was
    recorded for that build. Never 500s."""
    if not design_debug.is_enabled():
        raise HTTPException(status_code=404, detail="not found")
    try:
        data = design_debug.get_design_trace((build_id or "").strip()[:200])
    except Exception:  # noqa: BLE001 — a debug read must never 500
        raise HTTPException(status_code=404, detail="not found")
    if not data:
        raise HTTPException(status_code=404, detail="no trace for build")
    return data


__all__ = ["router"]
