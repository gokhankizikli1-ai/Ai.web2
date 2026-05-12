# coding: utf-8
"""
Phase 4b — background task queue.

Public API (use from route handlers):

  from backend.services.tasks import enqueue, queue_stats

  enqueue(record_usage, user_id, name="record_usage")
  enqueue(write_message, "user", msg, name="save_message_user")

When ENABLE_BACKGROUND_TASKS=false (default), enqueue() returns False
without doing anything. Callers should branch on the return value if
the task MUST run (e.g. run sync as fallback). Most current callers
treat background work as best-effort.

Internal architecture lives in:
  queue.py      TaskQueue + module-level singleton
  worker.py     async drain loop
  lifecycle.py  start/stop helpers wired from backend/api.py startup
  types.py      TaskItem + QueueStats dataclasses
"""
from backend.services.tasks.queue import (
    TaskQueue,
    get_queue,
    reset_for_tests,
)
from backend.services.tasks.types import QueueStats, TaskItem


def enqueue(fn, *args, name: str = "", on_overflow: str = "drop", **kwargs) -> bool:
    """Submit a task to the process-global queue.

    Returns True iff the task was accepted. Returns False when:
      - ENABLE_BACKGROUND_TASKS=false (queue disabled)
      - queue is full with on_overflow="drop"
      - no asyncio event loop is running (e.g. called from a sync
        context outside FastAPI's request lifecycle)
    """
    return get_queue().submit(fn, *args, name=name, on_overflow=on_overflow, **kwargs)


def queue_stats() -> QueueStats:
    """Public-safe snapshot for /v2/health.metadata.background_tasks."""
    return get_queue().stats()


__all__ = [
    "enqueue", "queue_stats",
    "TaskQueue", "TaskItem", "QueueStats",
    "get_queue", "reset_for_tests",
]
