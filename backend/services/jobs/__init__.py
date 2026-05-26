# coding: utf-8
"""
Phase 7 — Job Queue & Async Execution.

Durable, project- and user-scoped async job runtime for the KorvixAI
AI Operating System (PROJECT_ROADMAP.md Phase 7).

Public API:
    from backend.services.jobs import (
        client,            # JobsClient singleton
        JobRecord, JobEvent,
        STATUS_QUEUED, STATUS_RUNNING, STATUS_SUCCEEDED,
        STATUS_FAILED, STATUS_CANCELLED, STATUS_RETRYING,
        is_enabled,
    )

Authoring a new job kind:
    from backend.services.jobs.decorators import korvix_task
    from backend.services.jobs.registry import JobContext

    @korvix_task("my_kind")
    async def my_handler(ctx: JobContext) -> dict:
        await ctx.report_progress(50, "halfway")
        if await ctx.is_cancelled():
            return {"cancelled": True}
        return {"result": ...}

Then add "my_kind" to `backend/services/jobs/kinds.py:_PUBLIC_KINDS`
if it should be callable from the public API.

Feature flag:
    ENABLE_JOB_QUEUE=true     → /v2/jobs routes live, runner active
    default / off             → routes return 503; client methods either
                                no-op (reads) or raise JobQueueDisabled
                                (writes) so callers see a clear failure.

Rollback:
    1. ENABLE_JOB_QUEUE=false   (instant; no restart)
    2. (optional) rm jobs.db    (forgets every job; nothing else moves)

This package is a SIBLING of the existing `backend.services.tasks`
(Phase 4b fire-and-forget queue). They serve different needs — tasks
for "do this DB write later" (no IDs, no API); jobs for durable async
operations with status / progress / SSE.
"""
# Triggering the kinds import here registers the built-in handlers
# (echo / sleep_progress / memory_consolidation_stub) when the package
# is imported. Test code that wants to clear the registry can call
# `registry._reset_for_tests()`.
from backend.services.jobs import kinds   # noqa: F401 — side-effect registration

from backend.services.jobs.client import (
    JobsClient, client, is_enabled,
)
from backend.services.jobs.errors import (
    JobError, JobNotFound, JobAccessDenied,
    JobInvalidTransition, JobValidationError,
    JobKindUnknown, JobQueueDisabled,
)
from backend.services.jobs.events import JobEventBus, get_bus
from backend.services.jobs.kinds import public_kinds, is_public_kind
from backend.services.jobs.manager import JobManager, manager
from backend.services.jobs.registry import (
    JobContext, JobHandler,
    register_job, get_handler, is_registered, known_kinds,
)
from backend.services.jobs.runner import (
    JobRunner, InlineJobRunner, CeleryJobRunner, build_runner,
)
from backend.services.jobs.types import (
    JobRecord, JobEvent,
    JOB_STATUSES, TERMINAL_STATUSES,
    STATUS_QUEUED, STATUS_RUNNING, STATUS_SUCCEEDED,
    STATUS_FAILED, STATUS_CANCELLED, STATUS_RETRYING,
    DEFAULT_MAX_ATTEMPTS, DEFAULT_TIMEOUT_S, MAX_PAYLOAD_BYTES,
)


__all__ = [
    # Client
    "JobsClient", "client", "is_enabled",
    # Types
    "JobRecord", "JobEvent",
    "JOB_STATUSES", "TERMINAL_STATUSES",
    "STATUS_QUEUED", "STATUS_RUNNING", "STATUS_SUCCEEDED",
    "STATUS_FAILED", "STATUS_CANCELLED", "STATUS_RETRYING",
    "DEFAULT_MAX_ATTEMPTS", "DEFAULT_TIMEOUT_S", "MAX_PAYLOAD_BYTES",
    # Errors
    "JobError", "JobNotFound", "JobAccessDenied",
    "JobInvalidTransition", "JobValidationError",
    "JobKindUnknown", "JobQueueDisabled",
    # Registry / handlers
    "JobContext", "JobHandler",
    "register_job", "get_handler", "is_registered", "known_kinds",
    "public_kinds", "is_public_kind",
    # Runner
    "JobRunner", "InlineJobRunner", "CeleryJobRunner", "build_runner",
    # Manager + events
    "JobManager", "manager",
    "JobEventBus", "get_bus",
]
