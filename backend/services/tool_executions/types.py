# coding: utf-8
"""Phase 10 — Tool execution log: typed payloads.

Every tool invocation (web search, browser fetch, github read, etc.)
records a row here with latency, status, error normalization, and
optional cost-estimate fields. Read by:

  - the FE "Agent activity" timeline (recent calls per panel/user)
  - the future credit accounting layer (Phase 10 follow-up)
  - ops dashboards (which provider is failing, what's the p95 latency)

NOT a replacement for events/bus — the bus is push-style observability;
this is the durable forensic log.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any, Optional


# ── Execution statuses ────────────────────────────────────────────────────
EXECUTION_STATUSES: tuple[str, ...] = (
    "queued",       # accepted, not yet running (background mode)
    "running",      # currently executing
    "completed",    # finished successfully
    "failed",       # raised / returned an error envelope
    "timeout",      # exceeded the tool's wall-clock budget
    "cancelled",    # explicit cancel before completion
    "rate_limited", # provider returned a 429-equivalent
)

STATUS_QUEUED       = "queued"
STATUS_RUNNING      = "running"
STATUS_COMPLETED    = "completed"
STATUS_FAILED       = "failed"
STATUS_TIMEOUT      = "timeout"
STATUS_CANCELLED    = "cancelled"
STATUS_RATE_LIMITED = "rate_limited"

TERMINAL_EXECUTION_STATUSES: frozenset[str] = frozenset({
    STATUS_COMPLETED, STATUS_FAILED, STATUS_TIMEOUT,
    STATUS_CANCELLED, STATUS_RATE_LIMITED,
})


def normalize_status(s: Optional[str]) -> str:
    if not s:
        return STATUS_QUEUED
    n = str(s).strip().lower()
    return n if n in EXECUTION_STATUSES else STATUS_QUEUED


# ── Execution modes — mirror the BaseTool spec ────────────────────────────
EXECUTION_MODES: tuple[str, ...] = ("sync", "async", "streaming", "background")

MODE_SYNC       = "sync"
MODE_ASYNC      = "async"
MODE_STREAMING  = "streaming"
MODE_BACKGROUND = "background"


@dataclass
class ToolExecution:
    """One row in tool_executions.

    `tool_id`        — matches BaseTool.name in the in-process registry
                       OR the canonical id used by the new /v2/tools API
                       (e.g. "web_search", "browser_fetch", "github_repo").

    `caller`         — who initiated the call:
                         "user"   direct API hit on /v2/tools/execute
                         "agent"  invoked via the agent runtime
                         "system" coordinator-driven plan execution

    `input_summary`  — short, FE-renderable summary of the input
                       (e.g. "search: tesla competitors", "fetch: github.com/x")
                       Full input lives in input_json.

    `latency_ms`     — wall-clock budget consumed. Populated only on
                       terminal status.

    `cost_estimate`  — credits, in arbitrary units. None when the tool
                       doesn't track cost (e.g. calculator, current_time).

    `panel_id`       — for the multi-agent coordination scope.
    """
    user_id:        str
    tool_id:        str
    status:         str = STATUS_QUEUED
    caller:         str = "user"          # "user" | "agent" | "system"
    execution_mode: str = MODE_SYNC
    input_summary:  str = ""
    input_json:     str = "{}"
    output_json:    Optional[str] = None
    error_code:     Optional[str] = None
    error_message:  Optional[str] = None
    provider:       Optional[str] = None
    latency_ms:     Optional[int] = None
    cost_estimate:  Optional[float] = None
    panel_id:       Optional[str] = None
    workflow_id:    Optional[str] = None
    agent_id:       Optional[str] = None
    project_id:     Optional[str] = None
    correlation_id: Optional[str] = None
    metadata:       dict = field(default_factory=dict)
    id:             Optional[str] = None
    created_at:     Optional[str] = None
    updated_at:     Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        # Convert the *_json string columns to parsed objects for the
        # FE — the storage layer keeps them as strings for cheap inserts.
        import json
        for k in ("input_json", "output_json"):
            v = d.get(k)
            if isinstance(v, str) and v:
                try:
                    d[k] = json.loads(v)
                except Exception:
                    pass
        return d


__all__ = [
    "ToolExecution",
    "EXECUTION_STATUSES", "TERMINAL_EXECUTION_STATUSES",
    "STATUS_QUEUED", "STATUS_RUNNING", "STATUS_COMPLETED",
    "STATUS_FAILED", "STATUS_TIMEOUT", "STATUS_CANCELLED",
    "STATUS_RATE_LIMITED",
    "EXECUTION_MODES", "MODE_SYNC", "MODE_ASYNC",
    "MODE_STREAMING", "MODE_BACKGROUND",
    "normalize_status",
]
