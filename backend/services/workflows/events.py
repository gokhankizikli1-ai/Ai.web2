# coding: utf-8
"""Phase A.1 — Completion-event type used internally by the runner.

A `CompletionEvent` is published onto a runner-internal `asyncio.Queue`
whenever a spawned job or agent_task reaches a terminal state. The
runner's main loop awaits `queue.get()` and uses each event to mark
the matching step terminal, then recomputes eligibility.

This module deliberately holds NO process-wide state. The runner owns
the queues; this file just defines the event shape so the runner and
its waiter tasks share a typed contract.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class CompletionEvent:
    """One step has reached a terminal state.

    Fields:
      workflow_id : the parent workflow's id (so a single queue can
                    multiplex across multiple runners, if a future
                    multi-workflow scheduler ever needs that)
      step_id     : the step within `workflow_id` that completed
      status      : "completed" | "failed"  (the only terminal values
                    a waiter publishes; `skipped` is set by the runner
                    itself when fan-cancelling on failure, not via an
                    event)
      result      : free-form result payload from the underlying job
                    or agent_task; persisted into Step.result. May be
                    None for failed events.
      error       : short error string when `status == "failed"`.
                    None otherwise.
    """
    workflow_id: str
    step_id:     str
    status:      str
    result:      Optional[dict] = None
    error:       Optional[str]  = field(default=None)


__all__ = ["CompletionEvent"]
