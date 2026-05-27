# coding: utf-8
"""
Phase 8 — Agent task foundation.

Mirrors the workflows package structure. Each agent task captures
a unit of work delegated to (or by) an agent — it can attach to a
parent Job and a project; the project_brain aggregator surfaces
recent task summaries as agent_notes.
"""
from backend.services.agent_tasks.client import (
    AgentTasksClient, client, is_enabled,
)
from backend.services.agent_tasks.types import (
    AgentTaskRecord, AGENT_TASK_STATUSES,
)

__all__ = [
    "AgentTasksClient", "client", "is_enabled",
    "AgentTaskRecord", "AGENT_TASK_STATUSES",
]
