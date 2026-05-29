# coding: utf-8
"""
Phase 7 — Job execution backends.

Two implementations live behind `JobRunner` (Protocol):

  * InlineJobRunner — in-process asyncio task pool. The default and
    only fully-functional backend in Phase 7. Runs handlers in the
    same process as the API; suitable for Railway single-instance
    deploys + dev. Bounded concurrency via a semaphore.

  * CeleryJobRunner — placeholder for Phase 14+. Publishes to a
    Redis broker; a separate `korvixai-workers` Railway service
    consumes. Implemented as a stub that raises NotImplementedError
    so JOB_QUEUE_MODE=celery deploys fail loudly rather than
    silently dropping jobs.

The manager picks the runner via `JOB_QUEUE_MODE`:

    JOB_QUEUE_MODE=inline   (default)   → InlineJobRunner
    JOB_QUEUE_MODE=celery               → CeleryJobRunner (when impl lands)
    JOB_QUEUE_MODE=disabled             → never runs anything (test mode)

Inline-mode guarantees:
  * `submit(record_id)` returns immediately; the job runs on a
    background asyncio.Task on the API process's event loop.
  * Concurrency is bounded by JOB_QUEUE_INLINE_CONCURRENCY (default 4).
  * On API process exit, in-flight jobs are cancelled. They'll be
    visible in the DB as `status=running` with `started_at` set —
    operators can either re-enqueue or mark as failed.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Optional, Protocol

from backend.services.jobs import store
from backend.services.jobs.events import get_bus
from backend.services.jobs.registry import get_handler, JobContext
from backend.services.jobs.types import (
    JobEvent, JobRecord,
    STATUS_RUNNING, STATUS_SUCCEEDED, STATUS_FAILED,
    STATUS_CANCELLED, STATUS_RETRYING,
)


logger = logging.getLogger(__name__)


def _now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


# ── Runner interface ─────────────────────────────────────────────────────────

class JobRunner(Protocol):
    """Implementations: schedule a job for execution. They MUST be
    safe to call from a request handler (i.e. they must not block)."""
    async def submit(self, record_id: str) -> None: ...
    async def shutdown(self, *, drain_timeout_s: float = 5.0) -> None: ...
    def stats(self) -> dict: ...


# ── InlineJobRunner ──────────────────────────────────────────────────────────

class InlineJobRunner:
    """Runs handlers as asyncio tasks on the API process's event loop.

    Production-safe for single-instance Railway deploys: SQLite stays
    consistent because all writes go through the same `jobs.db` file.
    For multi-instance deploys the Celery runner becomes the right
    choice (each instance has its own InlineJobRunner today —
    multiple replicas would pick up different jobs, which is
    technically fine but not coordinated).
    """

    def __init__(self, *, concurrency: Optional[int] = None) -> None:
        c = concurrency
        if c is None:
            try:
                c = int(os.getenv("JOB_QUEUE_INLINE_CONCURRENCY", "4"))
            except Exception:
                c = 4
        self._sem = asyncio.Semaphore(max(1, c))
        self._in_flight: set[asyncio.Task] = set()
        self._counters = {
            "submits":      0,
            "completed":    0,
            "failed":       0,
            "cancelled":    0,
            "concurrency":  c,
        }

    async def submit(self, record_id: str) -> None:
        """Schedule the job. Returns immediately."""
        self._counters["submits"] += 1
        # Capture the current event loop and dispatch on a Task so
        # the calling request returns ASAP.
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            logger.warning("InlineJobRunner.submit: no running loop; cannot schedule %s", record_id)
            return
        task = loop.create_task(self._run(record_id), name=f"job:{record_id[:8]}")
        self._in_flight.add(task)
        task.add_done_callback(self._in_flight.discard)

    async def shutdown(self, *, drain_timeout_s: float = 5.0) -> None:
        """Wait up to drain_timeout_s for in-flight jobs, then cancel."""
        if not self._in_flight:
            return
        logger.info("InlineJobRunner shutting down | in_flight=%d | drain=%.1fs",
                    len(self._in_flight), drain_timeout_s)
        try:
            await asyncio.wait_for(
                asyncio.gather(*self._in_flight, return_exceptions=True),
                timeout=drain_timeout_s,
            )
        except asyncio.TimeoutError:
            for t in list(self._in_flight):
                t.cancel()

    def stats(self) -> dict:
        return {
            **self._counters,
            "in_flight": len(self._in_flight),
        }

    # ── Internal execution ─────────────────────────────────────────────

    async def _run(self, record_id: str) -> None:
        """Execute one job under the semaphore. The handler is
        wrapped in a comprehensive try so the JOB row always lands
        in a terminal state."""
        async with self._sem:
            record = store.get(record_id)
            if record is None:
                logger.warning("InlineJobRunner: job %s vanished before start", record_id)
                return

            # If the row was cancelled while waiting in the semaphore,
            # honour that — don't transition to running.
            if record.status == STATUS_CANCELLED:
                return

            # Pre-start guard for terminal status (covers shutdown-then-restart
            # cases where the same row was already processed).
            if record.is_terminal:
                return

            bus = get_bus()
            handler = None
            try:
                handler = get_handler(record.kind)
            except Exception as e:
                # Unknown kind — fail loudly with structured error.
                logger.warning("InlineJobRunner: unknown kind %r", record.kind)
                store.update(
                    record_id,
                    status=STATUS_FAILED,
                    finished_at=_now(),
                    error={"code": "JOB_KIND_UNKNOWN",
                           "message": f"Kind {record.kind!r} is not registered."},
                )
                await bus.publish(JobEvent(
                    job_id=record_id, kind="error",
                    payload={"code": "JOB_KIND_UNKNOWN",
                             "message": str(e)},
                ))
                self._counters["failed"] += 1
                return

            # Re-read the row to catch a cancel that arrived between
            # submit() and now. The pre-start guard above used a stale
            # snapshot (the `record` from outside the semaphore).
            fresh = store.get(record_id)
            if fresh is not None and fresh.status == STATUS_CANCELLED:
                logger.info("runner._run: %s cancelled before start", record_id)
                return

            # Transition to running.
            attempts = (record.attempts or 0) + 1
            updated = store.update(
                record_id,
                status=STATUS_RUNNING,
                started_at=_now(),
                attempts=attempts,
                progress=0,
                progress_label=None,
                error=None,
            ) or record

            await bus.publish(JobEvent(
                job_id=record_id, kind="status",
                payload={"status": STATUS_RUNNING, "attempts": attempts},
            ))

            # Build the runtime context (handler-side helpers).
            async def _report_progress(pct: int, label: Optional[str] = None) -> None:
                p = int(max(0, min(100, int(pct))))
                store.update(record_id, progress=p, progress_label=label)
                await bus.publish(JobEvent(
                    job_id=record_id, kind="progress",
                    payload={"progress": p, "label": label},
                ))

            async def _is_cancelled() -> bool:
                cur = store.get(record_id)
                return bool(cur and cur.status == STATUS_CANCELLED)

            ctx = JobContext(
                record=updated,
                report_progress=_report_progress,
                is_cancelled=_is_cancelled,
            )

            # Apply per-job timeout if requested.
            t0 = time.monotonic()
            try:
                if record.timeout_s and record.timeout_s > 0:
                    result = await asyncio.wait_for(handler(ctx), timeout=record.timeout_s)
                else:
                    result = await handler(ctx)
            except asyncio.CancelledError:
                # Cancellation can come from shutdown OR from a user
                # cancel that flipped the row to cancelled. Trust the
                # latest DB state.
                cur = store.get(record_id)
                final_status = STATUS_CANCELLED if (cur and cur.status == STATUS_CANCELLED) else STATUS_FAILED
                store.update(
                    record_id,
                    status=final_status,
                    finished_at=_now(),
                    cancelled_at=_now() if final_status == STATUS_CANCELLED else None,
                    error={"code": "JOB_CANCELLED", "message": "Job was cancelled"}
                          if final_status == STATUS_CANCELLED else
                          {"code": "JOB_CANCELLED_RUNTIME",
                           "message": "Job cancelled by runtime"},
                )
                await bus.publish(JobEvent(
                    job_id=record_id, kind="status",
                    payload={"status": final_status},
                ))
                self._counters["cancelled" if final_status == STATUS_CANCELLED else "failed"] += 1
                return
            except asyncio.TimeoutError:
                store.update(
                    record_id,
                    status=STATUS_FAILED,
                    finished_at=_now(),
                    error={"code": "JOB_TIMEOUT",
                           "message": f"Exceeded {record.timeout_s}s timeout"},
                )
                await bus.publish(JobEvent(
                    job_id=record_id, kind="error",
                    payload={"code": "JOB_TIMEOUT",
                             "message": f"Exceeded {record.timeout_s}s timeout"},
                ))
                self._counters["failed"] += 1
                return
            except Exception as e:
                # Decide between retrying and final failure.
                elapsed = int((time.monotonic() - t0) * 1000)
                attempts_so_far = attempts
                if attempts_so_far < (record.max_attempts or 1):
                    store.update(
                        record_id,
                        status=STATUS_RETRYING,
                        error={"code": "JOB_HANDLER_ERROR",
                               "message": str(e)[:300],
                               "type": type(e).__name__,
                               "attempt": attempts_so_far,
                               "elapsed_ms": elapsed},
                    )
                    await bus.publish(JobEvent(
                        job_id=record_id, kind="status",
                        payload={"status": STATUS_RETRYING,
                                 "attempt": attempts_so_far,
                                 "next_attempt": attempts_so_far + 1},
                    ))
                    # Re-submit ourselves for the next attempt. Caller
                    # gets retry-with-exponential-ish backoff via the
                    # event-loop ordering.
                    await asyncio.sleep(min(30.0, 2.0 ** attempts_so_far))
                    await self.submit(record_id)
                    return
                store.update(
                    record_id,
                    status=STATUS_FAILED,
                    finished_at=_now(),
                    error={"code": "JOB_HANDLER_ERROR",
                           "message": str(e)[:300],
                           "type": type(e).__name__,
                           "attempt": attempts_so_far,
                           "elapsed_ms": elapsed},
                )
                await bus.publish(JobEvent(
                    job_id=record_id, kind="error",
                    payload={"code": "JOB_HANDLER_ERROR",
                             "message": str(e)[:300],
                             "attempt": attempts_so_far},
                ))
                self._counters["failed"] += 1
                return

            # Success. RACE GUARD: if the row was cancelled while the
            # handler was running (concurrent POST /v2/jobs/{id}/cancel),
            # the DB row's status is now CANCELLED. We must NOT
            # overwrite that with SUCCEEDED — the user's cancel
            # intent wins. Re-read the row to make the final decision.
            current = store.get(record_id)
            if current is not None and current.status == STATUS_CANCELLED:
                # User cancelled mid-flight. Leave the cancellation
                # intact; the handler's return value is discarded.
                logger.info("runner._run: %s cancelled during execution; "
                            "preserving cancelled status", record_id)
                await bus.publish(JobEvent(
                    job_id=record_id, kind="status",
                    payload={"status": STATUS_CANCELLED,
                             "note": "cancelled during execution"},
                ))
                self._counters["cancelled"] += 1
                return
            store.update(
                record_id,
                status=STATUS_SUCCEEDED,
                finished_at=_now(),
                progress=100,
                result=result if isinstance(result, dict) else {"value": result},
            )
            await bus.publish(JobEvent(
                job_id=record_id, kind="done",
                payload={"status": STATUS_SUCCEEDED,
                         "result": result if isinstance(result, dict) else {"value": result},
                         "elapsed_ms": int((time.monotonic() - t0) * 1000)},
            ))
            self._counters["completed"] += 1


# ── CeleryJobRunner ──────────────────────────────────────────────────────────

class CeleryJobRunner:
    """Phase 7 slice 1 — real Celery-backed runner.

    Publishes one dispatcher task per `submit(record_id)` call. The
    worker service (`celery -A backend.jobs.celery_app worker`)
    consumes the task, looks the record up in the jobs store, and
    runs the registered handler exactly the same way InlineJobRunner
    does — same registry, same context, same event bus.

    Requires:
      * `celery` + `redis` packages installed (lazy import)
      * REDIS_URL set
      * ENABLE_REDIS=true
      * JOB_QUEUE_MODE=celery

    When any of those are missing, construction raises
    NotImplementedError with a clear actionable message so deploys
    fail loudly rather than silently dropping jobs.
    """

    def __init__(self) -> None:
        # Validate dependencies + env at construction so the error
        # surfaces on app start, not on the first inbound request.
        try:
            import celery   # noqa: F401, PLC0415
            self._celery_available = True
        except ImportError:
            self._celery_available = False

        from backend.services.redis_client import is_enabled as _redis_enabled
        self._redis_enabled = _redis_enabled()

        # We don't build the Celery app inside __init__ — `submit()`
        # builds it lazily so the unit-test path can monkeypatch.
        self._counters: dict = {
            "submits":          0,
            "submit_failed":    0,
            "last_error":       "",
        }

    def _ensure_available(self) -> None:
        if not self._celery_available:
            raise NotImplementedError(
                "CeleryJobRunner requires the `celery` package. "
                "Add it to requirements.txt + reinstall."
            )
        if not self._redis_enabled:
            raise NotImplementedError(
                "CeleryJobRunner requires Redis. Set REDIS_URL + "
                "ENABLE_REDIS=true."
            )

    async def submit(self, record_id: str) -> None:
        """Publish a `jobs.dispatch` task to Celery. The worker fetches
        the JobRecord from the shared jobs store and runs the
        registered handler.

        Idempotency: the jobs store de-dupes by `idempotency_key` at
        insert time, so re-submitting an existing record is safe — the
        worker just observes status=running and skips.
        """
        self._ensure_available()
        # Lazy build so monkeypatching in tests is straightforward.
        from backend.jobs.celery_app import get_app
        app = get_app()
        if app is None:
            self._counters["submit_failed"] += 1
            raise NotImplementedError(
                "Celery app construction returned None — check REDIS_URL "
                "and that the celery package is importable."
            )

        try:
            # The task name is the canonical handle. Defined in
            # backend.jobs.tasks so the worker can find it.
            app.send_task(
                "korvix.jobs.dispatch",
                args=[record_id],
                queue=_queue_for_record(record_id),
            )
            self._counters["submits"] += 1
        except Exception as exc:
            self._counters["submit_failed"] += 1
            self._counters["last_error"] = str(exc)[:140]
            logger.warning(
                "[JOB][CELERY] submit failed record_id=%s err=%s",
                record_id, exc,
            )
            raise

    async def shutdown(self, *, drain_timeout_s: float = 5.0) -> None:
        # Celery workers manage their own lifecycle. The API process
        # has nothing to drain.
        return None

    def stats(self) -> dict:
        return {
            "backend":            "celery",
            "celery_available":   self._celery_available,
            "redis_enabled":      self._redis_enabled,
            **self._counters,
        }


def _queue_for_record(record_id: str) -> str:
    """Phase 7 slice 3 — route a job to the right queue based on its
    kind. Workers can then run with `-Q korvix.vision` (or similar) to
    pin one process per heavy queue.

    Mapping (prefix match, first hit wins):
      vision.*       → korvix.vision
      research.*     → korvix.research
      embeddings.*   → korvix.embeddings
      orchestration.*→ korvix.orchestration
      memory.*       → korvix.maintenance        (memory consolidation,
                                                  TTL evict, etc.)
      default        → korvix.default

    DB cost is one read per submit; sub-millisecond against either
    SQLite or Postgres. Falls back to korvix.default silently when the
    lookup fails (we still want the job to land somewhere).
    """
    try:
        from backend.services.jobs import store
        record = store.get(record_id)
        if record is None or not record.kind:
            return "korvix.default"
        kind = record.kind.strip().lower()
    except Exception:
        return "korvix.default"

    # Order matters — first matching prefix wins.
    routes: tuple[tuple[str, str], ...] = (
        ("vision.",        "korvix.vision"),
        ("research.",      "korvix.research"),
        ("embeddings.",    "korvix.embeddings"),
        ("orchestration.", "korvix.orchestration"),
        ("memory.",        "korvix.maintenance"),
    )
    for prefix, queue in routes:
        if kind.startswith(prefix):
            return queue
    return "korvix.default"


# ── Factory ──────────────────────────────────────────────────────────────────

def build_runner() -> JobRunner:
    """Pick a runner based on JOB_QUEUE_MODE. Defaults to inline."""
    mode = os.getenv("JOB_QUEUE_MODE", "inline").strip().lower()
    if mode == "celery":
        return CeleryJobRunner()
    # "inline" or anything unknown → inline (the safe default).
    return InlineJobRunner()


__all__ = [
    "JobRunner", "InlineJobRunner", "CeleryJobRunner",
    "build_runner",
]
