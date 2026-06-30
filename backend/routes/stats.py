"""Legacy global stats route.

DEPRECATED. Returns coarse, non-PII global message counts. Left readable
(a monitor may poll it) but marked deprecated and covered by the
ENABLE_LEGACY_USER_ROUTES kill-switch for a clean retirement path. The
previously-dead OWNER_ID import was removed (it gated nothing).
"""
import logging
from fastapi import APIRouter, HTTPException

from backend.core.config import settings

router = APIRouter(prefix="/stats", tags=["stats"])
logger = logging.getLogger(__name__)


@router.get("", deprecated=True)
async def get_stats():
    if not settings.ENABLE_LEGACY_USER_ROUTES:
        raise HTTPException(
            status_code=410,
            detail={"error": "gone", "message": "Legacy /stats is retired."},
        )
    try:
        from stats import get_stats as _get_stats
        data = _get_stats()
        return {"ok": True, **data}
    except Exception as e:
        logger.warning("stats fallback: " + str(e))
        return {"ok": True, "messages": 0}
