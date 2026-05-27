# coding: utf-8
"""Phase 8 — Project Brain typed payloads."""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any, Optional


@dataclass
class ProjectBrain:
    """Aggregated project state. Each field is bounded — at most a
    handful of items — so the full structure fits inside a single
    chat system-prompt without bloating tokens."""
    project_id:         str
    user_id:            str
    project_summary:    str = ""
    current_goals:      list[str]  = field(default_factory=list)
    important_context:  list[str]  = field(default_factory=list)
    linked_assets:      list[dict] = field(default_factory=list)   # [{id, filename, type, summary?}]
    recent_decisions:   list[str]  = field(default_factory=list)
    agent_notes:        list[str]  = field(default_factory=list)
    workflow_state:     list[dict] = field(default_factory=list)   # [{id, type, status, progress}]
    counts:             dict       = field(default_factory=dict)   # health snapshot

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class ProjectContextBlock:
    """The prompt-ready string + metadata. The chat-context builder
    folds `text` into the system prompt and surfaces `metadata` for
    debug overlays."""
    text:     str
    metadata: dict = field(default_factory=dict)


__all__ = ["ProjectBrain", "ProjectContextBlock"]
