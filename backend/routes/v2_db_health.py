# coding: utf-8
"""/v2/db/health — Phase 6 DB foundation diagnostic.

Owner-only because the response includes the server version string,
which leaks the Postgres major.minor in error responses we'd rather
not surface publicly. Non-owners get a 404 via the require_owner dep
to avoid signalling that the endpoint exists.

This route never raises — it always returns a 200 envelope with the
probe result. The FE owner panel uses it to render the DB section of
the system status card.
"""
from __future__ import annotations

import logging
from typing import Any, Dict

from fastapi import APIRouter, Depends

from backend.core.deps import require_owner
from backend.core.responses import ok as envelope_ok, err as envelope_err
from backend.services.auth.identity import User
from backend.services.db.health import health_check


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v2", tags=["db-v2"])


@router.get("/db/health")
async def get_db_health(
    user: User = Depends(require_owner),
) -> Dict[str, Any]:
    result = await health_check()
    if result["ok"]:
        return envelope_ok(data=result)
    return envelope_err(
        message=result.get("error") or "db not ok",
        backend=result["backend"],
        latency_ms=result["latency_ms"],
    )


__all__ = ["router"]
