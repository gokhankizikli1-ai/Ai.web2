# coding: utf-8
"""
Phase 8 — Project Brain.

Aggregator only — no new persistence. Reads from existing Phase
6/7/8 stores and assembles a concise project-context block ready
for chat / agent system-prompt injection.

Sources stitched together:
  * memory_plane.client     — recent project-scoped memories
  * sessions.client         — recent threads/messages metadata
  * assets.client           — project-attached assets + analyses
  * jobs.client             — recent job activity for the project
  * workflows.client        — active workflows
  * agent_tasks.client      — recent agent tasks

The result is bounded (so it doesn't blow up the system prompt) and
goes through one helper — `client.build_context(user_id, project_id)`.
"""
from backend.services.project_brain.client import (
    ProjectBrainClient, client, is_enabled,
)
from backend.services.project_brain.types import (
    ProjectBrain, ProjectContextBlock,
)

__all__ = [
    "ProjectBrainClient", "client", "is_enabled",
    "ProjectBrain", "ProjectContextBlock",
]
