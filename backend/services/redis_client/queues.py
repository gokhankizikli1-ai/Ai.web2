# coding: utf-8
"""Phase 7 slice 4 — per-queue depth observability.

Celery stores queued task bodies in Redis LISTs whose names match the
queue names (`korvix.default`, `korvix.research`, ...). Reading LLEN
on each gives operators backlog depth without grepping logs or
scraping the Celery management dashboard.

Surface:
    get_queue_depths()  → {queue_name: int}

Read by /v2/db/health (owner-only) so backlog spikes are visible in
the same probe as DB + pool + Redis health.
"""
from __future__ import annotations

import logging
from typing import Iterable, Optional


logger = logging.getLogger(__name__)


# The set of queues Celery registers — mirrors `backend/jobs/celery_app.py`.
# Kept here as a tuple so the health probe doesn't need to import Celery.
_KORVIX_QUEUES: tuple[str, ...] = (
    "korvix.default",
    "korvix.research",
    "korvix.vision",
    "korvix.embeddings",
    "korvix.orchestration",
    "korvix.maintenance",
)


async def get_queue_depths(
    queues: Optional[Iterable[str]] = None,
) -> list[dict]:
    """Return `[{name, depth}]` for each Celery queue. When `queues`
    is None, probes the full korvix.* set. Never raises — returns []
    when Redis is off or the probe fails.

    Note: Celery's queue LIST naming on Redis is just the queue name
    (no prefix). If a queue has never received a task its key won't
    exist; LLEN on a missing key returns 0, which is the correct
    answer."""
    names = tuple(queues) if queues is not None else _KORVIX_QUEUES
    out: list[dict] = []

    try:
        from backend.services.redis_client import is_enabled, get_async_client
        if not is_enabled():
            # Redis off — surface zeros so the FE still renders the
            # table. Operator sees redis.enabled=false alongside.
            return [{"name": n, "depth": 0} for n in names]
        client = await get_async_client()
    except Exception as exc:                                  # pragma: no cover
        logger.debug("[REDIS][QUEUES] get_async_client failed: %s", exc)
        return [{"name": n, "depth": 0} for n in names]

    pipe = client.pipeline()
    for name in names:
        pipe.llen(name)
    try:
        results = await pipe.execute()
    except Exception as exc:
        logger.debug("[REDIS][QUEUES] LLEN pipeline failed: %s", exc)
        return [{"name": n, "depth": 0} for n in names]

    for name, depth in zip(names, results):
        try:
            d = int(depth or 0)
        except Exception:                                     # pragma: no cover
            d = 0
        out.append({"name": name, "depth": d})
    return out


__all__ = ["get_queue_depths"]
