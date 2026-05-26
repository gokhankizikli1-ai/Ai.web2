# coding: utf-8
"""
Phase 7 — JobManager.

The orchestration layer that sits between the API/agent layer and the
store/runner. Responsibilities:

  * create / enqueue a job (with idempotency dedup)
  * read / list with ownership enforcement
  * cancel — flips status; the runner observes via `is_cancelled()`
  * retry — re-enqueues a failed/cancelled job (resets attempts? no —
    we keep cumulative attempts; max_attempts can be bumped per-call)
  * audit hooks (cancel/retry) — feeds the existing admin audit log
    when available (best-effort; not required).

Everything beyond the store + runner lives here. Routes/agents/CLI
all talk through MANAGER (or through the Client wrapper) — never the
store directly.
"""
from __future__ import annotations

import logging
from typing import Optional

from backend.services.jobs import store
from backend.services.jobs.errors import (
    JobInvalidTransition, JobKindUnknown, JobNotFound, JobValidationError,
)
from backend.services.jobs.events import get_bus
from backend.services.jobs.registry import is_registered
from backend.services.jobs.runner import JobRunner, build_runner
from backend.services.jobs.types import (
    JobEvent, JobRecord, MAX_PAYLOAD_BYTES,
    STATUS_QUEUED, STATUS_RUNNING, STATUS_SUCCEEDED, STATUS_FAILED,
    STATUS_CANCELLED, STATUS_RETRYING, TERMINAL_STATUSES,
    DEFAULT_MAX_ATTEMPTS, DEFAULT_TIMEOUT_S,
    encode_json,
)


logger = logging.getLogger(__name__)


def _now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


def _audit(action: str, *, user_id: str, job_id: str, details: dict | None = None) -> None:
    """Best-effort audit log write. Imports lazily so a deployment
    without the admin module still has working jobs."""
    try:
        from backend.services.admin import audit as _audit_log
        _audit_log.record(
            action=f"job.{action}",
            user_id=str(user_id),
            target=job_id,
            details=details or {},
        )
    except Exception:
        # Audit log is optional infrastructure — never let it block.
        pass


class JobManager:
    """Stateful — holds the runner singleton. Construct once per
    process; `manager` below is the canonical instance."""

    def __init__(self, runner: Optional[JobRunner] = None) -> None:
        self._runner: Optional[JobRunner] = runner
        # We DON'T instantiate the runner at construction time because
        # importing the package shouldn't bind us to an event loop.
        # Lazy + idempotent below.

    def _get_runner(self) -> JobRunner:
        if self._runner is None:
            self._runner = build_runner()
        return self._runner

    # ── Create / enqueue ───────────────────────────────────────────────────

    async def create(
        self,
        *,
        user_id: str,
        kind: str,
        payload: Optional[dict] = None,
        project_id: Optional[str] = None,
        agent_id: Optional[str] = None,
        idempotency_key: Optional[str] = None,
        max_attempts: int = DEFAULT_MAX_ATTEMPTS,
        timeout_s: Optional[int] = DEFAULT_TIMEOUT_S,
        metadata: Optional[dict] = None,
    ) -> JobRecord:
        """Create + enqueue a job. Returns the persisted record (the
        runner will pick it up async).

        Validates kind, payload size, idempotency dedup. On dedup hit,
        returns the EXISTING record without scheduling a new run.

        Raises:
            JobKindUnknown       — kind not registered
            JobValidationError   — payload too big, etc.
        """
        if not user_id:
            raise JobValidationError("user_id is required",
                                     code="USER_ID_REQUIRED")
        if not is_registered(kind):
            raise JobKindUnknown(
                f"Unknown job kind: {kind!r}",
                details={"kind": kind},
            )

        # Payload size cap — protects the API against megabyte-payload abuse.
        payload = payload or {}
        try:
            encoded = encode_json(payload) or "{}"
            if len(encoded.encode("utf-8")) > MAX_PAYLOAD_BYTES:
                raise JobValidationError(
                    f"payload exceeds {MAX_PAYLOAD_BYTES} bytes",
                    code="PAYLOAD_TOO_LARGE",
                )
        except JobValidationError:
            raise
        except Exception:
            raise JobValidationError("payload is not JSON-serialisable",
                                     code="PAYLOAD_NOT_JSON")

        # Idempotency check BEFORE insert — saves a write on the common
        # case of a frontend refresh-spam loop.
        if idempotency_key:
            existing = store.get_by_idempotency_key(
                user_id=str(user_id), kind=kind, idempotency_key=idempotency_key,
            )
            if existing is not None:
                return existing

        # Build + insert. If the unique index races us (concurrent
        # creates with same idempotency_key), we catch the IntegrityError
        # and return the existing row.
        record = JobRecord(
            kind=kind,
            user_id=str(user_id),
            project_id=project_id,
            agent_id=agent_id,
            status=STATUS_QUEUED,
            payload=payload,
            idempotency_key=idempotency_key,
            max_attempts=int(max(1, min(10, max_attempts))),
            timeout_s=int(timeout_s) if timeout_s else None,
            metadata=metadata or {},
        )
        import sqlite3
        try:
            saved = store.insert(record)
        except sqlite3.IntegrityError:
            if idempotency_key:
                existing = store.get_by_idempotency_key(
                    user_id=str(user_id), kind=kind, idempotency_key=idempotency_key,
                )
                if existing is not None:
                    return existing
            raise

        # Submit to the runner — fire-and-forget, returns immediately.
        try:
            await self._get_runner().submit(saved.id or "")
        except Exception as e:
            # Runner refused — mark the job as failed so the row isn't
            # stuck in queued forever. Surface the error.
            store.update(
                saved.id or "",
                status=STATUS_FAILED,
                finished_at=_now(),
                error={"code": "RUNNER_SUBMIT_FAILED", "message": str(e)[:300]},
            )
            saved = store.get(saved.id or "") or saved

        # Initial snapshot event for any SSE subscriber that's already
        # connected (unlikely on create, but harmless if so).
        await get_bus().publish(JobEvent(
            job_id=saved.id or "", kind="snapshot",
            payload={"status": saved.status},
        ))
        return saved

    # ── Read ───────────────────────────────────────────────────────────────

    def get(self, job_id: str, *, user_id: Optional[str] = None) -> Optional[JobRecord]:
        """Fetch a job. When `user_id` is passed, enforces ownership —
        returns None if the row exists but belongs to a different user.
        Routes use the latter to surface 404 without leaking existence."""
        rec = store.get(job_id)
        if rec is None:
            return None
        if user_id is not None and rec.user_id != str(user_id):
            return None
        return rec

    def list_user(
        self,
        user_id: str,
        *,
        project_id: Optional[str] = None,
        agent_id: Optional[str] = None,
        kind: Optional[str] = None,
        status: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[JobRecord]:
        return store.list_for_user(
            user_id, project_id=project_id, agent_id=agent_id,
            kind=kind, status=status, limit=limit, offset=offset,
        )

    def list_all(
        self,
        *,
        status: Optional[str] = None,
        kind: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[JobRecord]:
        """Owner-only — routes must gate with require_owner."""
        return store.list_all(status=status, kind=kind, limit=limit, offset=offset)

    # ── Cancel ─────────────────────────────────────────────────────────────

    async def cancel(self, job_id: str, *, user_id: Optional[str] = None,
                     by_owner: bool = False) -> JobRecord:
        """Mark a job cancelled. The running handler observes the
        status change on its next `is_cancelled()` check.

        Raises JobNotFound or JobInvalidTransition.
        Logs an audit entry whether by user or by owner.
        """
        rec = self.get(job_id, user_id=user_id if not by_owner else None)
        if rec is None:
            # Hide existence from non-owners — surface as JobNotFound.
            raise JobNotFound(f"job {job_id!r} not found",
                              details={"job_id": job_id})
        if rec.status in TERMINAL_STATUSES:
            raise JobInvalidTransition(
                f"cannot cancel a {rec.status} job",
                details={"current_status": rec.status},
            )
        store.update(job_id, status=STATUS_CANCELLED, cancelled_at=_now(),
                     finished_at=_now())
        await get_bus().publish(JobEvent(
            job_id=job_id, kind="status",
            payload={"status": STATUS_CANCELLED},
        ))
        _audit("cancel", user_id=str(user_id) if user_id else rec.user_id,
               job_id=job_id, details={"by_owner": by_owner,
                                       "prev_status": rec.status})
        out = store.get(job_id) or rec
        return out

    # ── Retry ──────────────────────────────────────────────────────────────

    async def retry(
        self, job_id: str, *, user_id: Optional[str] = None,
        by_owner: bool = False,
        extra_max_attempts: int = 1,
    ) -> JobRecord:
        """Re-enqueue a terminal failed/cancelled job. Bumps
        `max_attempts` by `extra_max_attempts` so the runner is
        allowed one more pass. `attempts` (the cumulative counter)
        is preserved — failures across retries are visible to the
        audit log.

        Raises JobNotFound or JobInvalidTransition.
        """
        rec = self.get(job_id, user_id=user_id if not by_owner else None)
        if rec is None:
            raise JobNotFound(f"job {job_id!r} not found",
                              details={"job_id": job_id})
        if rec.status not in {STATUS_FAILED, STATUS_CANCELLED}:
            raise JobInvalidTransition(
                f"cannot retry a {rec.status} job — only failed/cancelled are retryable",
                details={"current_status": rec.status},
            )
        new_max = (rec.max_attempts or DEFAULT_MAX_ATTEMPTS) + max(1, int(extra_max_attempts))
        store.update(
            job_id,
            status=STATUS_QUEUED,
            error=None,
            cancelled_at=None,
            finished_at=None,
            started_at=None,
            progress=0,
            progress_label=None,
        )
        # store.update doesn't support max_attempts directly (whitelist
        # excludes it intentionally — the cap is creation-time policy);
        # use a small private write.
        import sqlite3
        from backend.services.jobs.store import _conn
        try:
            with _conn() as c:
                c.execute("UPDATE jobs SET max_attempts=?, updated_at=? WHERE id=?",
                          (int(new_max), _now(), job_id))
        except Exception:
            pass

        await get_bus().publish(JobEvent(
            job_id=job_id, kind="status",
            payload={"status": STATUS_QUEUED, "retry_of": rec.attempts},
        ))
        _audit("retry", user_id=str(user_id) if user_id else rec.user_id,
               job_id=job_id, details={"by_owner": by_owner,
                                       "extra_max_attempts": extra_max_attempts,
                                       "new_max_attempts": new_max})

        await self._get_runner().submit(job_id)
        return store.get(job_id) or rec

    # ── Lifecycle ──────────────────────────────────────────────────────────

    async def shutdown(self, *, drain_timeout_s: float = 5.0) -> None:
        """Drain in-flight jobs (best-effort) on API process exit."""
        if self._runner is not None:
            await self._runner.shutdown(drain_timeout_s=drain_timeout_s)


# ── Singleton ────────────────────────────────────────────────────────────────

manager: JobManager = JobManager()


def _reset_for_tests() -> None:
    """Test helper — clear the singleton's runner state IN PLACE.

    We deliberately do NOT rebind the module-level `manager` variable.
    Other modules (client.py, etc.) imported it via
    `from .manager import manager`, which captures the OBJECT, not the
    name — rebinding here would leave them pointing at the stale
    instance. Mutating the existing instance keeps every consumer in
    sync.
    """
    import asyncio
    # If there's an existing runner with in-flight tasks, cancel them
    # so old tasks can't race with the fresh test's tmp_jobs_db.
    old_runner = manager._runner
    if old_runner is not None:
        in_flight = getattr(old_runner, "_in_flight", set())
        for t in list(in_flight):
            try:
                t.cancel()
            except Exception:
                pass
    manager._runner = None    # next create() will lazily build a fresh runner


__all__ = ["JobManager", "manager", "_reset_for_tests"]
