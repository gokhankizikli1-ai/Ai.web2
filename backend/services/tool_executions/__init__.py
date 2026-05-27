# coding: utf-8
"""
Phase 10 — Tool execution log.

Durable per-call record of every tool invocation. Gated by
ENABLE_TOOLS_RUNTIME. Used by:

  - the public /v2/tools/executions route
  - the future credit-accounting layer
  - the FE "Agent activity" timeline

Not the same as events/bus — the bus is push observability; this is
the forensic log the FE renders on reload.
"""
from backend.services.tool_executions.client import (
    ToolExecutionsClient, ToolRunHandle, client, is_enabled,
)
from backend.services.tool_executions.types import (
    ToolExecution,
    EXECUTION_STATUSES, TERMINAL_EXECUTION_STATUSES,
    STATUS_QUEUED, STATUS_RUNNING, STATUS_COMPLETED,
    STATUS_FAILED, STATUS_TIMEOUT, STATUS_CANCELLED,
    STATUS_RATE_LIMITED,
    EXECUTION_MODES, MODE_SYNC, MODE_ASYNC,
    MODE_STREAMING, MODE_BACKGROUND,
    normalize_status,
)


__all__ = [
    "ToolExecutionsClient", "ToolRunHandle", "client", "is_enabled",
    "ToolExecution",
    "EXECUTION_STATUSES", "TERMINAL_EXECUTION_STATUSES",
    "STATUS_QUEUED", "STATUS_RUNNING", "STATUS_COMPLETED",
    "STATUS_FAILED", "STATUS_TIMEOUT", "STATUS_CANCELLED",
    "STATUS_RATE_LIMITED",
    "EXECUTION_MODES", "MODE_SYNC", "MODE_ASYNC",
    "MODE_STREAMING", "MODE_BACKGROUND",
    "normalize_status",
]
