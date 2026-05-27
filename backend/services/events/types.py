# coding: utf-8
# Phase 3.2 — Event types.
#
# An ActivityEvent is a single observable thing that happened during
# an orchestration or agent invocation. Subscribers (Phase 3.5 SSE
# endpoint + future tracing/observability plumbing) consume the bus
# and project these events into whatever surface they care about.
#
# Frozen dataclass — events are immutable once emitted. Per-subscriber
# transformations create new events; the original never mutates.

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, Optional


# Canonical event kinds. Subscribers can use raw string comparison;
# this set is the authoritative whitelist for documentation + filtering.
EVENT_KINDS = (
    # Run lifecycle (one pair per orchestration)
    "run.started",
    "run.finished",
    "run.errored",
    # Agent lifecycle (one pair per run_agent invocation; nested runs
    # emit their own pair while sharing the parent's run_id).
    "agent.started",
    "agent.finished",
    # Tool lifecycle (one called → one completed-or-errored per tool call).
    "tool.called",
    "tool.completed",
    "tool.errored",
    # Phase 4.2 — deeper specialist execution telemetry. Emitted per
    # delegated sub-agent so the UI activity timeline can show
    # "context lookup → draft generated → quality check → completed"
    # rather than just "started/finished".
    "agent.context_lookup",   # supervisor handed inherited project context to the sub-agent
    "agent.draft_generated",  # specialist produced its initial reply (pre-guard)
    "agent.quality_check",    # quality guard verdict (ok or with reasons)
    "agent.regenerated",      # guard rejected the draft and the specialist re-ran
    # Phase 5.1 — task graph lifecycle. Tied 1:1 to rows in the
    # `tasks` table; emitted by delegate around its existing
    # delegate.* events so the UI can render a per-task list with
    # status badges + per-task durations.
    "task.created",     # task row inserted, status=queued
    "task.started",     # task transitioned to status=running
    "task.completed",   # task transitioned to status=completed
    "task.failed",      # task transitioned to status=failed
    # Phase 9 — panel + presence + messenger lifecycle.
    "panel.created",        # PanelsClient.create() succeeded
    "panel.status_changed", # PanelsClient.mark_status() transitioned a panel
    "presence.changed",     # AgentPresence.update() flipped an agent's state
    "agent_message.posted", # AgentMessenger.send() recorded a new envelope
)


def _now() -> str:
    return datetime.utcnow().isoformat() + "Z"


@dataclass(frozen=True)
class ActivityEvent:
    """One thing that happened during a run.

    Fields:
        kind:       one of EVENT_KINDS.
        scope:      routing key for subscribers. Conventions:
                      project:<project_id>   — events visible to a project
                      user:<user_id>         — user-scoped events when no project
                      run:<run_id>           — run-scoped (sub-run streams)
                    Subscribers can also subscribe to "*" for everything.
        run_id:     optional — populated when an active RunContext exists.
        agent_id:   optional — populated for agent.*/tool.* events.
        payload:    free-form per-kind payload. Keep keys stable; future
                    consumers depend on them.
        emitted_at: ISO-8601 UTC timestamp.
    """
    kind:       str
    scope:      str
    run_id:     Optional[str]              = None
    agent_id:   Optional[str]              = None
    payload:    Dict[str, Any]             = field(default_factory=dict)
    emitted_at: str                        = field(default_factory=_now)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "kind":       self.kind,
            "scope":      self.scope,
            "run_id":     self.run_id,
            "agent_id":   self.agent_id,
            "payload":    dict(self.payload),
            "emitted_at": self.emitted_at,
        }


__all__ = ["ActivityEvent", "EVENT_KINDS"]
