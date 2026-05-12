# coding: utf-8
"""
TaskQueue — bounded asyncio queue for background work.

Process-global singleton. The worker (in worker.py) consumes from it.
Submitters call `enqueue(fn, *args)` and get immediate return — the
function runs LATER in the worker coroutine, decoupled from the
request response cycle.

Safety contract:
  - Submitting NEVER raises by default. When the queue is full, the
    overflow policy decides: "drop" (default — log warning, discard
    the task and return False) or "raise" (the caller catches and
    falls back to sync execution).
  - The worker NEVER lets a single failed task kill the queue. Each
    task is wrapped in try/except; failures bump `failed_total` and
    update `last_error` but the next task still runs.
  - When the queue is disabled (ENABLE_BACKGROUND_TASKS=false), every
    submit returns False immediately. Callers should handle that path —
    typically by either skipping the work or running it inline.

The queue is intentionally process-local. Multi-process deployments
(e.g. uvicorn with multiple workers) each get their own queue; that's
fine for the current task list (DB writes are idempotent or
user-scoped). A Redis-backed cross-process queue is a future swap-in
behind the same `enqueue()` API.
"""
from __future__ import annotations

import asyncio
import logging
import os
import threading
import time
from typing import Optional

from backend.services.tasks.types import QueueStats, TaskFn, TaskItem


logger = logging.getLogger(__name__)


def _flag(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() == "true"


# Read once per process — flipping the flag requires a redeploy /
# process restart. That matches the disciplined-rollback pattern of
# every other phase.
_ENABLED = _flag("ENABLE_BACKGROUND_TASKS", default=False)
_MAX_QUEUE_SIZE = int(os.getenv("BACKGROUND_TASKS_MAX_QUEUE", "1000"))


# Sentinel pushed by stop() to wake the worker out of its blocking get().
_STOP_SENTINEL: TaskItem = TaskItem(name="__stop__", fn=lambda: None)


class TaskQueue:
    """Process-global background task queue.

    Use the module-level `get_queue()` accessor; don't construct
    instances directly. The accessor lazily builds one when the flag
    is set, returns a disabled stub otherwise so call sites stay
    branch-free.
    """

    def __init__(self, max_size: int = _MAX_QUEUE_SIZE, enabled: bool = _ENABLED) -> None:
        self._enabled = enabled
        self._max_size = max(1, max_size)
        # asyncio.Queue is event-loop-bound; we create it lazily on
        # first submit/start so import-time doesn't bind us to a loop.
        self._queue: Optional[asyncio.Queue[TaskItem]] = None
        self._worker_task: Optional[asyncio.Task[None]] = None
        self._stats_lock = threading.Lock()
        self._stats = QueueStats(enabled=enabled, max_queue_size=self._max_size)

    # ── State accessors ────────────────────────────────────────────────

    def is_enabled(self) -> bool:
        return self._enabled

    def stats(self) -> QueueStats:
        with self._stats_lock:
            # Copy so a /v2/health probe doesn't race with a worker
            # update mid-serialisation.
            s = self._stats
            return QueueStats(
                enabled=          s.enabled,
                worker_alive=     bool(self._worker_task and not self._worker_task.done()),
                queue_size=       self._queue.qsize() if self._queue is not None else 0,
                max_queue_size=   s.max_queue_size,
                submitted_total=  s.submitted_total,
                processed_total=  s.processed_total,
                failed_total=     s.failed_total,
                overflow_dropped= s.overflow_dropped,
                last_error=       s.last_error,
                last_task_name=   s.last_task_name,
                last_task_ms=     s.last_task_ms,
            )

    # ── Submission ─────────────────────────────────────────────────────

    def submit(
        self,
        fn: TaskFn,
        *args,
        name: str = "",
        on_overflow: str = "drop",
        **kwargs,
    ) -> bool:
        """Enqueue a task. Returns True iff accepted into the queue.

        Args:
          fn:           sync or async callable
          *args:        positional args forwarded to fn
          name:         short identifier for log lines. Defaults to
                        fn.__name__ if not provided.
          on_overflow:  "drop" (log warning + return False) or
                        "raise" (raise asyncio.QueueFull so the caller
                        can fall back to sync execution).
          **kwargs:     keyword args forwarded to fn

        When the queue is disabled, returns False without queuing.
        """
        if not self._enabled:
            return False
        if self._queue is None:
            # Worker not started yet — defer queue creation to the
            # active event loop. submit() is allowed before start() so
            # routes can call enqueue() during the early request path
            # without ordering hazards; we just hold the task until
            # the worker is available. To keep this safe, we still
            # require an event loop to exist at submit time.
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                # No running loop — can't queue. Drop quietly.
                logger.warning(
                    "task.submit %s ignored: no running event loop",
                    name or getattr(fn, "__name__", "fn"),
                )
                with self._stats_lock:
                    self._stats.overflow_dropped += 1
                return False
            self._queue = asyncio.Queue(maxsize=self._max_size)
            _ = loop   # explicitly bind so the queue uses this loop

        task_name = name or getattr(fn, "__name__", "fn")
        item = TaskItem(
            name=    task_name,
            fn=      fn,
            args=    tuple(args),
            kwargs=  dict(kwargs),
            enqueued_at_monotonic=time.monotonic(),
        )
        try:
            self._queue.put_nowait(item)
        except asyncio.QueueFull:
            with self._stats_lock:
                self._stats.overflow_dropped += 1
            if on_overflow == "raise":
                raise
            logger.warning(
                "task.submit %s dropped: queue full (size=%d, max=%d)",
                task_name, self._queue.qsize(), self._max_size,
            )
            return False
        with self._stats_lock:
            self._stats.submitted_total += 1
        return True

    # ── Lifecycle (called by lifecycle.py from FastAPI startup/shutdown)

    def _record_success(self, item: TaskItem, duration_ms: int) -> None:
        with self._stats_lock:
            self._stats.processed_total += 1
            self._stats.last_task_name = item.name
            self._stats.last_task_ms = duration_ms

    def _record_failure(self, item: TaskItem, exc: BaseException, duration_ms: int) -> None:
        with self._stats_lock:
            self._stats.failed_total += 1
            self._stats.last_task_name = item.name
            self._stats.last_task_ms = duration_ms
            # Cap the message so a giant traceback doesn't bloat
            # /v2/health responses.
            self._stats.last_error = f"{item.name}: {type(exc).__name__}: {str(exc)[:200]}"

    async def _ensure_queue(self) -> asyncio.Queue:
        if self._queue is None:
            self._queue = asyncio.Queue(maxsize=self._max_size)
        return self._queue

    async def start(self) -> None:
        """Start the worker coroutine. Idempotent."""
        if not self._enabled:
            return
        if self._worker_task and not self._worker_task.done():
            return
        from backend.services.tasks.worker import run_worker
        await self._ensure_queue()
        loop = asyncio.get_running_loop()
        self._worker_task = loop.create_task(run_worker(self), name="background-task-worker")
        logger.info(
            "background-task worker started | max_queue=%d",
            self._max_size,
        )

    async def stop(self, *, drain_timeout_s: float = 5.0) -> None:
        """Signal the worker to stop and try to drain pending work.

        Submits a STOP sentinel and then awaits the worker task. If the
        drain takes longer than `drain_timeout_s`, we cancel and log
        how many tasks were left in the queue (visible as data loss in
        the next health probe via processed_total / submitted_total).
        """
        if self._worker_task is None:
            return
        if self._queue is None:
            return
        try:
            self._queue.put_nowait(_STOP_SENTINEL)
        except asyncio.QueueFull:
            # Couldn't even submit the sentinel — fall back to cancel.
            self._worker_task.cancel()
        try:
            await asyncio.wait_for(self._worker_task, timeout=drain_timeout_s)
        except asyncio.TimeoutError:
            self._worker_task.cancel()
            try:
                await self._worker_task
            except (asyncio.CancelledError, BaseException):
                pass
            logger.warning(
                "background-task worker drain timed out | remaining=%d",
                self._queue.qsize(),
            )
        finally:
            self._worker_task = None


# ── Module-level singleton ────────────────────────────────────────────────

_QUEUE: Optional[TaskQueue] = None
_QUEUE_LOCK = threading.Lock()


def get_queue() -> TaskQueue:
    """Return the process-global TaskQueue. Lazy + thread-safe."""
    global _QUEUE
    if _QUEUE is None:
        with _QUEUE_LOCK:
            if _QUEUE is None:
                _QUEUE = TaskQueue()
    return _QUEUE


def reset_for_tests() -> None:
    """Internal — clear the singleton so tests can build fresh queues
    with custom configurations."""
    global _QUEUE
    with _QUEUE_LOCK:
        _QUEUE = None


__all__ = [
    "TaskQueue", "get_queue", "reset_for_tests",
    "_STOP_SENTINEL",
]
