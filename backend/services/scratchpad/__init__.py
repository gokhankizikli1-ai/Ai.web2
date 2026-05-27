# coding: utf-8
"""
Phase 9 — Shared scratchpad foundation.

Per-project, append-only, agent-attributed journal of notes, findings,
decisions, plans, questions, and references. Read by:

  - the Coordinator (to ground the next plan in what's already known)
  - delegating agents (to leave breadcrumbs for peers)
  - the FE viewer (premium panel inside the project workspace)

Not a replacement for project_memory — project_memory is curated,
search-ranked context that the LLM system prompt pulls from. The
scratchpad is the verbose raw journal underneath it.
"""
from backend.services.scratchpad.client import (
    ScratchpadClient, client, is_enabled, append, list_project,
)
from backend.services.scratchpad.types import (
    ScratchpadEntry, SCRATCHPAD_KINDS, normalize_kind,
    KIND_NOTE, KIND_FINDING, KIND_DECISION, KIND_PLAN,
    KIND_QUESTION, KIND_ANSWER, KIND_REFERENCE, KIND_OUTPUT,
)

__all__ = [
    "ScratchpadClient", "client", "is_enabled", "append", "list_project",
    "ScratchpadEntry", "SCRATCHPAD_KINDS", "normalize_kind",
    "KIND_NOTE", "KIND_FINDING", "KIND_DECISION", "KIND_PLAN",
    "KIND_QUESTION", "KIND_ANSWER", "KIND_REFERENCE", "KIND_OUTPUT",
]
