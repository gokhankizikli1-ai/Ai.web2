# coding: utf-8
"""
FastAPI lifecycle hooks for the background task queue.

Called from backend/api.py via the startup/shutdown event handlers.
Idempotent. Safe to call even when the feature flag is off — the
queue's own checks short-circuit.

We don't use FastAPI's `lifespan` context manager here so the existing
on_event("startup")/on_event("shutdown") pattern in api.py keeps
working without a structural change to the bootstrap.
"""
from __future__ import annotations

import logging

from backend.services.tasks.queue import get_queue


logger = logging.getLogger(__name__)


async def on_app_startup() -> None:
    q = get_queue()
    if not q.is_enabled():
        logger.info("background-task queue: disabled (ENABLE_BACKGROUND_TASKS != 'true')")
        return
    await q.start()


async def on_app_shutdown() -> None:
    q = get_queue()
    if not q.is_enabled():
        return
    await q.stop()
    logger.info("background-task queue: stopped")


__all__ = ["on_app_startup", "on_app_shutdown"]
