# coding: utf-8
# Phase 3.1 — RunContext.
#
# A RunContext is the per-orchestration-run state that flows through
# the agent runtime. It carries the run id, the user/project namespace,
# the parent agent (for sub-agents — None at the top), an ephemeral
# scratchpad shared between sibling agents in the same run, and the
# pre-built project context block (so we don't re-query projects.db
# inside each agent's LLM call).
#
# Threading uses a ContextVar — the same pattern Phase 2 used for the
# project context block. Per-asyncio-task-scoped, never leaks between
# concurrent requests.
#
# Phase 3.1 ONLY defines + threads this. The orchestrator that
# actually uses the scratchpad lands in Phase 3.3.

import logging
import os
import uuid
from contextvars import ContextVar, Token
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)


def _now() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _new_run_id() -> str:
    # 12 hex chars is plenty — run_ids are short-lived. Compact for log lines.
    return uuid.uuid4().hex[:12]


@dataclass
class RunContext:
    """Per-orchestration-run state.

    Attributes:
        run_id:        short unique id for this orchestration run.
                       Surfaced in trace/event payloads so the UI can
                       group activity across multiple agents.
        user_id:       owning user (matches request.user_id).
        project_id:    optional project namespace; populated when the
                       request was made in a project context. None for
                       freeform chats.
        parent_agent:  the spec.id of the agent that spawned this run.
                       None at the orchestrator root; set when a
                       sub-agent is delegated to (Phase 3.3).
        project_context_block:  pre-built Project Context string (the
                       same one Phase 2's chat injection produces).
                       Cached here so each sub-agent in a run pays
                       the build cost once, not N times.
        scratch:       free-form per-run k/v store. Agents can write
                       intermediate results here for sibling agents to
                       read without going through the LLM. Cleared
                       when the run ends.
        started_at:    ISO-8601 UTC timestamp.
        metadata:      additive metadata for future use (model overrides,
                       routing decisions, etc.).
    """
    run_id:                str
    user_id:               str
    project_id:            Optional[str] = None
    parent_agent:          Optional[str] = None
    project_context_block: str = ""
    scratch:               Dict[str, Any] = field(default_factory=dict)
    started_at:            str = field(default_factory=_now)
    metadata:              Dict[str, Any] = field(default_factory=dict)


# ── ContextVar transport ────────────────────────────────────────────────

_CURRENT_RUN: ContextVar[Optional[RunContext]] = ContextVar(
    "korvix_run_context", default=None,
)


def get_current_run() -> Optional[RunContext]:
    """Return the active RunContext for the current asyncio task, or None.

    Always safe to call — never raises, returns None outside an
    orchestration run.
    """
    try:
        return _CURRENT_RUN.get()
    except Exception:
        return None


def start_run(
    *,
    user_id: str,
    project_id: Optional[str] = None,
    parent_agent: Optional[str] = None,
    run_id: Optional[str] = None,
    project_context_block: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> "RunHandle":
    """Push a fresh RunContext for the current task.

    If `project_context_block` isn't supplied AND ENABLE_PROJECTS is on,
    we opportunistically read whatever block Phase 2 already injected
    via the project ContextVar — that way `/chat` callers get RunContext
    for free without changing chat.py.

    Returns a RunHandle whose `.close()` MUST be called (use the
    handle as a context manager: `with start_run(...) as run: ...`).
    """
    rid = run_id or _new_run_id()

    # Opportunistic project_context inheritance from Phase 2's ContextVar.
    block = project_context_block
    if block is None:
        try:
            from backend.services.projects.context import get_current_project_context
            block = get_current_project_context() or ""
        except Exception:
            block = ""

    ctx = RunContext(
        run_id=rid,
        user_id=str(user_id),
        project_id=(project_id or None),
        parent_agent=parent_agent,
        project_context_block=block,
        metadata=dict(metadata or {}),
    )
    token = _CURRENT_RUN.set(ctx)
    logger.info(
        "run_context_created | run_id=%s | user=%s | project=%s | parent=%s | block_chars=%d",
        ctx.run_id, ctx.user_id,
        ctx.project_id or "-",
        ctx.parent_agent or "-",
        len(ctx.project_context_block),
    )
    # Phase 3.2 — emit `run.started`. Wrapped because emission failure
    # must never break the runtime. No-op when ENABLE_REALTIME_EVENTS=false.
    try:
        from backend.services.events import emit
        emit(
            "run.started",
            run_id=ctx.run_id,
            project_id=ctx.project_id,
            user_id=ctx.user_id,
            payload={
                "parent_agent": ctx.parent_agent,
                "started_at":   ctx.started_at,
                "metadata":     dict(ctx.metadata or {}),
            },
        )
    except Exception:
        pass
    return RunHandle(ctx, token)


class RunHandle:
    """Context manager handle returned by start_run().

    The handle exposes `.ctx` for explicit access, but using `with`
    is the recommended pattern — guarantees the ContextVar is reset
    even if the body raises AND that a `run.errored` event is emitted
    (rather than `run.finished`) when an exception propagates out.
    """
    __slots__ = ("ctx", "_token", "_closed")

    def __init__(self, ctx: RunContext, token: Token):
        self.ctx = ctx
        self._token = token
        self._closed = False

    def __enter__(self) -> RunContext:
        return self.ctx

    def __exit__(self, exc_type, exc, tb) -> None:
        # Pass the exception through so close() emits run.errored
        # with the cause. The exception itself still propagates —
        # we don't suppress.
        self.close(error=exc)

    def close(self, error: Optional[BaseException] = None) -> None:
        if self._closed:
            return
        self._closed = True
        try:
            _CURRENT_RUN.reset(self._token)
        except Exception:
            pass
        # Phase 3.2 — emit run.finished or run.errored. Same try/except
        # wrap as start_run; emission failures cannot break the runtime.
        try:
            from backend.services.events import emit
            kind = "run.errored" if error is not None else "run.finished"
            emit(
                kind,
                run_id=self.ctx.run_id,
                project_id=self.ctx.project_id,
                user_id=self.ctx.user_id,
                payload={
                    "error": (
                        f"{type(error).__name__}: {str(error)[:300]}"
                        if error is not None else None
                    ),
                    "metadata": dict(self.ctx.metadata or {}),
                },
            )
        except Exception:
            pass


def _projects_enabled() -> bool:
    return os.getenv("ENABLE_PROJECTS", "false").strip().lower() == "true"


__all__ = [
    "RunContext",
    "RunHandle",
    "start_run",
    "get_current_run",
]
