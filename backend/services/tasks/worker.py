# coding: utf-8
"""
Worker coroutine for the background task queue.

Lives as long as the FastAPI app. Drains the queue one task at a time:
  - sync functions are dispatched via asyncio.to_thread so they don't
    block the event loop
  - async functions are awaited directly
  - exceptions are caught + logged + counted; the worker keeps going
  - the STOP sentinel cleanly terminates the loop on shutdown
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import TYPE_CHECKING

from backend.services.tasks.types import TaskItem


if TYPE_CHECKING:
    from backend.services.tasks.queue import TaskQueue


logger = logging.getLogger(__name__)


async def run_worker(queue: "TaskQueue") -> None:
    """Drain the queue until the STOP sentinel arrives."""
    from backend.services.tasks.queue import _STOP_SENTINEL

    q = await queue._ensure_queue()
    logger.info("background-task worker loop entering")

    while True:
        item = await q.get()
        try:
            if item is _STOP_SENTINEL or item.name == "__stop__":
                logger.info("background-task worker received stop sentinel")
                return
            await _run_one(queue, item)
        finally:
            try:
                q.task_done()
            except ValueError:
                # task_done() called more times than get() — defensive,
                # never expected in normal flow.
                pass


async def _run_one(queue: "TaskQueue", item: TaskItem) -> None:
    """Execute a single TaskItem with full error isolation + timing."""
    started = time.monotonic()
    waited_ms = int((started - item.enqueued_at_monotonic) * 1000)
    try:
        if asyncio.iscoroutinefunction(item.fn):
            await item.fn(*item.args, **item.kwargs)
        else:
            # asyncio.to_thread keeps the event loop free for the next
            # task while a sync DB write runs in the threadpool.
            await asyncio.to_thread(item.fn, *item.args, **item.kwargs)
    except BaseException as exc:    # noqa: BLE001 — we deliberately catch everything
        duration_ms = int((time.monotonic() - started) * 1000)
        queue._record_failure(item, exc, duration_ms)
        logger.warning(
            "task.fail | name=%s | waited_ms=%d | duration_ms=%d | %s: %s",
            item.name, waited_ms, duration_ms, type(exc).__name__, str(exc)[:200],
            extra={
                "task_name":   item.name,
                "task_event":  "fail",
                "waited_ms":   waited_ms,
                "duration_ms": duration_ms,
                "exc_type":    type(exc).__name__,
            },
        )
        return
    duration_ms = int((time.monotonic() - started) * 1000)
    queue._record_success(item, duration_ms)
    logger.info(
        "task.ok | name=%s | waited_ms=%d | duration_ms=%d",
        item.name, waited_ms, duration_ms,
        extra={
            "task_name":   item.name,
            "task_event":  "ok",
            "waited_ms":   waited_ms,
            "duration_ms": duration_ms,
        },
    )


__all__ = ["run_worker"]
