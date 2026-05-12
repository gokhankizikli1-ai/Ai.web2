# coding: utf-8
"""
Type definitions for the background-task queue.

Plain @dataclass — no Pydantic, no SQLAlchemy. The TaskItem carries
everything the worker needs to execute the work AND log it usefully
(structured per-task log lines so operators can grep one task at a time).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Dict, Tuple, Union


# A task function may be sync or async. The worker dispatches accordingly.
TaskFn = Union[Callable[..., Any], Callable[..., Awaitable[Any]]]


@dataclass
class TaskItem:
    """One enqueued unit of work."""
    name:    str                    # short identifier for logs (e.g. "record_usage")
    fn:      TaskFn                 # callable to run
    args:    Tuple[Any, ...] = ()   # positional args
    kwargs:  Dict[str, Any] = field(default_factory=dict)
    # Auto-populated on enqueue:
    enqueued_at_monotonic: float = 0.0


@dataclass
class QueueStats:
    """Snapshot for /v2/health.metadata.background_tasks.

    All values are best-effort — read under the queue's lock but may
    be stale by the time the response is serialised. That's fine for
    a health probe; precise accounting would need a slower mechanism.
    """
    enabled:          bool = False
    worker_alive:     bool = False
    queue_size:       int = 0
    max_queue_size:   int = 0
    submitted_total:  int = 0
    processed_total:  int = 0
    failed_total:     int = 0
    overflow_dropped: int = 0
    last_error:       str = ""
    # Per-task counters for the most common tasks. Kept compact so the
    # /v2/health response stays small even after a million chat turns.
    last_task_name:   str = ""
    last_task_ms:     int = 0


__all__ = ["TaskItem", "QueueStats", "TaskFn"]
