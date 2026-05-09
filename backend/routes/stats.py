import os
import logging
from fastapi import APIRouter

router = APIRouter(prefix="/stats", tags=["stats"])
logger = logging.getLogger(__name__)

OWNER_ID = int(os.getenv("OWNER_ID", "0"))

@router.get("")
async def get_stats():
    try:
        from stats import get_stats as _get_stats
        data = _get_stats()
        return {"ok": True, **data}
    except Exception as e:
        logger.warning("stats fallback: " + str(e))
        return {"ok": True, "messages": 0}
