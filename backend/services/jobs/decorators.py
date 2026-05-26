# coding: utf-8
"""
Phase 7 — Task decorators.

`@korvix_task` is the recommended way to define a job handler. It
wraps `@register_job` and adds:

  * Automatic idempotency-key normalisation (caller can pass any
    hashable, we turn it into a stable string).
  * Structured logging per task — start/end with elapsed time and
    job id.

Authors use it like:

    @korvix_task("memory.consolidate")
    async def consolidate_memories(ctx: JobContext) -> dict:
        ...
        return {"consolidated": 17}
"""
from __future__ import annotations

import logging
import time
from typing import Awaitable, Callable

from backend.services.jobs.registry import register_job, JobContext


logger = logging.getLogger(__name__)


def korvix_task(kind: str):
    """Register a handler under `kind` with extra logging.

    The wrapped function still receives a JobContext. The wrapper
    handles:
      * Pre-call log: "task.start | kind=… | job=…"
      * Post-call log: "task.done  | kind=… | job=… | ms=…"
      * Exception passthrough — the runner catches & records errors.
    """
    def _wrap(fn: Callable[[JobContext], Awaitable[dict]]):
        async def _runner(ctx: JobContext) -> dict:
            t0 = time.monotonic()
            jid = (ctx.record.id or "")[:8] if ctx.record else "??"
            logger.info("task.start | kind=%s | job=%s | user=%s",
                        kind, jid, getattr(ctx.record, "user_id", "?"))
            try:
                result = await fn(ctx)
            except Exception as e:
                logger.warning("task.error | kind=%s | job=%s | %s: %s",
                               kind, jid, type(e).__name__, e)
                raise
            elapsed = int((time.monotonic() - t0) * 1000)
            logger.info("task.done  | kind=%s | job=%s | ms=%d", kind, jid, elapsed)
            return result
        _runner.__name__ = getattr(fn, "__name__", _runner.__name__)
        _runner.__qualname__ = getattr(fn, "__qualname__", _runner.__qualname__)
        register_job(kind)(_runner)
        return _runner
    return _wrap


__all__ = ["korvix_task"]
