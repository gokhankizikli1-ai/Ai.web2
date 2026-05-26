# coding: utf-8
"""
Phase 7 — JobsClient.

The stable public surface every caller speaks. Routes, future agent
orchestration, future memory consolidation, future file pipeline —
all go through this client. Internal modules (store / manager /
runner / events) are NOT part of the public API.

Why a client wrapper:
  * Feature-flag gate: every method checks `is_enabled()` so the
    whole subsystem is a no-op while ENABLE_JOB_QUEUE=false.
  * Single chokepoint for future telemetry / circuit-breakers.
  * Future swap: when CeleryJobRunner ships in Phase 14, the client
    signatures stay the same.

Behaviour when disabled (`ENABLE_JOB_QUEUE` ≠ "true"):
  * `create`, `cancel`, `retry` raise JobQueueDisabled (so routes
    can surface a 503 envelope cleanly).
  * `get`, `list_user` return None / [] respectively.
  * `stats` and `is_enabled` always work.
"""
from __future__ import annotations

import logging
import os
from typing import Optional

from backend.services.jobs import store
from backend.services.jobs.errors import JobQueueDisabled
from backend.services.jobs.events import get_bus
from backend.services.jobs.manager import manager as _manager
from backend.services.jobs.registry import is_registered, known_kinds
from backend.services.jobs.runner import build_runner
from backend.services.jobs.types import (
    JobRecord, DEFAULT_MAX_ATTEMPTS, DEFAULT_TIMEOUT_S,
)


logger = logging.getLogger(__name__)


def is_enabled() -> bool:
    """Read ENABLE_JOB_QUEUE on every call so Railway flag flips take
    effect on the very next request without a restart. Default OFF."""
    return os.getenv("ENABLE_JOB_QUEUE", "false").strip().lower() == "true"


class JobsClient:
    """Stateless wrapper around the JobManager singleton."""

    def init(self) -> None:
        """Idempotent storage bootstrap."""
        store.init()

    def is_enabled(self) -> bool:
        return is_enabled()

    # ── Create ─────────────────────────────────────────────────────────────

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
        if not is_enabled():
            raise JobQueueDisabled(
                "Job queue is disabled. Set ENABLE_JOB_QUEUE=true to activate.",
            )
        return await _manager.create(
            user_id=user_id, kind=kind, payload=payload,
            project_id=project_id, agent_id=agent_id,
            idempotency_key=idempotency_key,
            max_attempts=max_attempts, timeout_s=timeout_s,
            metadata=metadata,
        )

    # ── Read ───────────────────────────────────────────────────────────────

    def get(self, job_id: str, *, user_id: Optional[str] = None) -> Optional[JobRecord]:
        if not is_enabled():
            return None
        return _manager.get(job_id, user_id=user_id)

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
        if not is_enabled():
            return []
        return _manager.list_user(
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
        if not is_enabled():
            return []
        return _manager.list_all(status=status, kind=kind, limit=limit, offset=offset)

    # ── Mutate ─────────────────────────────────────────────────────────────

    async def cancel(self, job_id: str, *, user_id: Optional[str] = None,
                     by_owner: bool = False) -> JobRecord:
        if not is_enabled():
            raise JobQueueDisabled("Job queue is disabled.")
        return await _manager.cancel(job_id, user_id=user_id, by_owner=by_owner)

    async def retry(self, job_id: str, *, user_id: Optional[str] = None,
                    by_owner: bool = False,
                    extra_max_attempts: int = 1) -> JobRecord:
        if not is_enabled():
            raise JobQueueDisabled("Job queue is disabled.")
        return await _manager.retry(job_id, user_id=user_id, by_owner=by_owner,
                                    extra_max_attempts=extra_max_attempts)

    # ── Lifecycle ──────────────────────────────────────────────────────────

    async def shutdown(self, *, drain_timeout_s: float = 5.0) -> None:
        await _manager.shutdown(drain_timeout_s=drain_timeout_s)

    # ── Observability ──────────────────────────────────────────────────────

    def stats(self) -> dict:
        runner_stats: dict = {}
        try:
            # Don't construct the runner solely for stats — use the
            # manager's runner if already built.
            if _manager._runner is not None:
                runner_stats = _manager._runner.stats()
        except Exception:
            pass
        return {
            "enabled":      is_enabled(),
            "mode":         os.getenv("JOB_QUEUE_MODE", "inline"),
            "store":        store.store_stats(),
            "tables":       store.table_counts(),
            "runner":       runner_stats,
            "event_bus":    get_bus().stats(),
            "known_kinds":  known_kinds(),
        }


# ── Singleton ────────────────────────────────────────────────────────────────

client: JobsClient = JobsClient()


# Best-effort bootstrap on import — non-fatal.
try:
    client.init()
except Exception as _e:
    logger.warning("jobs.client: init failed: %s", _e)


__all__ = ["JobsClient", "client", "is_enabled"]
