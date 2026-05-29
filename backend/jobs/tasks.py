# coding: utf-8
"""Phase 7 slice 1 — Worker-side Celery task module.

Imported by the worker process via:

    celery -A backend.jobs.celery_app worker --include=backend.jobs.tasks

Importing this module:
  1. Loads `backend.services.jobs.kinds` to register every shipped
     handler with the local handler registry (same registry the API
     uses for InlineJobRunner).
  2. Defines the single `korvix.jobs.dispatch` Celery task that the
     API publishes per submit. The task is a thin shim: fetch
     JobRecord → run the handler via the existing registry → write
     status + result back to the store.

Why ONE dispatcher task instead of one Celery task per kind:
  * Keeps the registry contract identical between inline and celery
    runners. Adding a new job kind is one decorator at the handler
    site; no Celery boilerplate.
  * Avoids the impedance mismatch of Celery-native task params vs the
    typed JobRecord shape every existing handler expects.
  * Routing per kind happens via the QUEUE (e.g. `korvix.research`,
    `korvix.vision`) — see `_queue_for_record` in services/jobs/runner.
"""
from __future__ import annotations

import asyncio
import logging
import time

from backend.services.jobs import kinds   # noqa: F401 — side-effect registration


logger = logging.getLogger(__name__)


def _build_dispatch_task():
    """Build + register the `korvix.jobs.dispatch` task on the Celery
    app. Returns the task function for tests; the app uses it via
    `send_task('korvix.jobs.dispatch', ...)`.

    Defined as a factory so import order doesn't force celery to load
    when the API just wants the kind side effects.
    """
    from backend.jobs.celery_app import get_app
    app = get_app()
    if app is None:
        logger.warning(
            "[JOB][WORKER] celery app unavailable — dispatch task NOT registered"
        )
        return None

    @app.task(
        name="korvix.jobs.dispatch",
        bind=True,
        acks_late=True,
        max_retries=3,
        default_retry_delay=10,
    )
    def dispatch(self, record_id: str) -> dict:
        """The single worker entry point. Looks up the JobRecord from
        the shared jobs store, runs the registered handler for its
        kind, writes the result + status. Idempotent w.r.t. record
        state — if the row is already terminal, we no-op."""
        t0 = time.monotonic()
        log = logging.getLogger("korvix.jobs.dispatch")
        log.info("[JOB][WORKER] dispatch start record_id=%s", record_id)

        try:
            from backend.services.jobs import store
            from backend.services.jobs.registry import get_handler, JobContext
            from backend.services.jobs.types import (
                STATUS_RUNNING, STATUS_SUCCEEDED, STATUS_FAILED,
            )

            record = store.get(record_id)
            if record is None:
                log.warning("[JOB][WORKER] record missing: %s", record_id)
                return {"ok": False, "reason": "record_not_found"}

            # If the row is already terminal, don't re-run — protects
            # against double-dispatch from a Celery redelivery.
            if record.status in (STATUS_SUCCEEDED, STATUS_FAILED, "cancelled"):
                log.info(
                    "[JOB][WORKER] record_id=%s already terminal status=%s — skip",
                    record_id, record.status,
                )
                return {"ok": True, "skipped": True, "status": record.status}

            handler = get_handler(record.kind)
            if handler is None:
                store.update(
                    record_id,
                    status=STATUS_FAILED,
                    error=f"no handler for kind={record.kind}",
                )
                return {"ok": False, "reason": "no_handler"}

            store.update(record_id, status=STATUS_RUNNING)

            # Phase 7 slice 4 — heartbeat tick at task start. Cheap
            # SETEX so /v2/db/health.redis.workers shows this worker
            # as alive even before the handler emits any progress.
            try:
                from backend.services.jobs.heartbeat import write_heartbeat
                asyncio.run(write_heartbeat())
            except Exception:                                  # pragma: no cover
                pass

            # Phase 7 slice 3 — REAL progress + cancellation hooks.
            #
            # report_progress: writes the % + label to the DB row AND
            # publishes a JobEvent. JobEventBus.publish() schedules a
            # Redis publish (slice 2), which the API replicas pick up
            # via PSUBSCRIBE and re-emit to their local SSE consumers.
            # End-to-end: worker handler → DB + Redis → API → SSE → FE.
            #
            # is_cancelled: re-reads the record from the store on each
            # call. Costs one cheap query — handlers SHOULD call this
            # between phases (not on a tight inner loop). When the FE
            # POSTs /v2/jobs/{id}/cancel, the row flips to "cancelled"
            # and the worker observes it on the next poll.
            from backend.services.jobs.events import get_bus
            from backend.services.jobs.types import (
                JobEvent, STATUS_CANCELLED,
            )

            async def _report_progress(pct: int, label: str | None = None) -> None:
                # Clamp inside the dispatcher — defensive against
                # handler bugs that emit out-of-range values.
                p = max(0, min(100, int(pct)))
                try:
                    store.update(record_id, progress=p, progress_label=label)
                except Exception as upd_exc:                       # pragma: no cover
                    log.warning("[JOB][WORKER] progress update failed: %s", upd_exc)
                # Publish to the event bus → Redis → SSE consumers.
                try:
                    await get_bus().publish(JobEvent(
                        job_id=record_id, kind="progress",
                        payload={"progress": p, "label": label},
                        timestamp="",
                    ))
                except Exception as pub_exc:                       # pragma: no cover
                    log.warning("[JOB][WORKER] progress publish failed: %s", pub_exc)

            async def _is_cancelled() -> bool:
                # Lightweight re-read. Returns True when the row is
                # `cancelled` (typically set by the /v2/jobs/{id}/cancel
                # route).
                try:
                    cur = store.get(record_id)
                    return cur is not None and cur.status == STATUS_CANCELLED
                except Exception:
                    # Don't false-positive cancellation on a transient
                    # DB blip — let the handler keep running.
                    return False

            ctx = JobContext(
                record=record,
                report_progress=_report_progress,
                is_cancelled=_is_cancelled,
            )

            # Handlers are async. Run on a fresh event loop in the
            # worker process — Celery workers default to sync.
            result = asyncio.run(handler(ctx))

            # If the handler bailed out due to cancellation it should
            # have set the cancelled flag in the result. Honour both
            # the explicit return AND the row state — whichever indicates
            # cancellation wins.
            cur = store.get(record_id)
            final_status = STATUS_SUCCEEDED
            if cur is not None and cur.status == STATUS_CANCELLED:
                final_status = STATUS_CANCELLED
            elif isinstance(result, dict) and result.get("cancelled_mid_flight"):
                final_status = STATUS_CANCELLED

            store.update(
                record_id,
                status=final_status,
                result=result,
            )
            elapsed_ms = int((time.monotonic() - t0) * 1000)
            log.info(
                "[JOB][WORKER] dispatch ok record_id=%s elapsed_ms=%d",
                record_id, elapsed_ms,
            )
            return {"ok": True, "elapsed_ms": elapsed_ms}

        except Exception as exc:
            log.warning(
                "[JOB][WORKER] dispatch failed record_id=%s err=%s",
                record_id, exc,
            )

            # Phase 7 slice 4 — DLQ routing on final retry.
            # When the task has already retried max_retries times,
            # Celery's self.retry would raise MaxRetriesExceededError
            # and bubble. Instead we proactively check: if the next
            # retry WOULD exceed the cap, route the record to the DLQ
            # and return cleanly (no further requeue).
            current_attempt = int(getattr(self.request, "retries", 0) or 0)
            max_retries     = int(getattr(self, "max_retries", 3) or 3)

            if current_attempt >= max_retries:
                # Exhausted — flip to STATUS_FAILED_DLQ + push to the
                # Redis mirror. NEVER re-raise self.retry here, that
                # would loop.
                try:
                    from backend.services.jobs.dlq import dlq_enqueue
                    asyncio.run(dlq_enqueue(
                        record_id,
                        kind=record.kind if record is not None else "unknown",
                        error=str(exc),
                        attempts=current_attempt + 1,
                        user_id=(record.user_id if record is not None else None),
                    ))
                except Exception as dlq_exc:                  # pragma: no cover
                    log.warning(
                        "[JOB][WORKER] DLQ enqueue failed record_id=%s err=%s",
                        record_id, dlq_exc,
                    )
                    # Fall back to plain STATUS_FAILED.
                    try:
                        from backend.services.jobs import store
                        from backend.services.jobs.types import STATUS_FAILED
                        store.update(record_id,
                                     status=STATUS_FAILED,
                                     error={"message": str(exc),
                                            "dlq_fallback": True})
                    except Exception:                          # pragma: no cover
                        pass
                # Return the dispatch result so Celery considers the
                # task SUCCEEDED-from-its-perspective — the row state
                # is the actual record of failure.
                return {"ok": False, "dlq": True, "attempts": current_attempt + 1}

            # Not yet exhausted — record the transient failure on the
            # row and let Celery retry.
            try:
                from backend.services.jobs import store
                from backend.services.jobs.types import STATUS_FAILED
                store.update(
                    record_id, status=STATUS_FAILED,
                    error={"message": str(exc), "attempt": current_attempt},
                )
            except Exception:                                     # pragma: no cover
                pass
            raise self.retry(exc=exc)

    return dispatch


# Eager registration when imported in worker process. In the API
# process, get_app() returns None unless ENABLE_REDIS=true AND
# JOB_QUEUE_MODE=celery — so this no-ops in the inline path.
_DISPATCH_TASK = _build_dispatch_task()


__all__ = ["_build_dispatch_task"]
