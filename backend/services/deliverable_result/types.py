# coding: utf-8
"""
Deliverable Result — typed, renderer-agnostic result/preview contract.

This is the stable shape every FUTURE module reads when it wants the output
of an orchestrator run, WITHOUT knowing the internal deliverable schema:

    Website Builder → reads html_preview / renderer == "iframe"
    Startup Hub     → reads structured_data / renderer == "markdown"
    Ecommerce       → reads structured_data
    Game Studio     → reads content / files
    Research         → reads content / summary

The contract is renderer-agnostic: `renderer` is a plain string hint
(iframe / code / markdown / file_tree / none) and `artifact_type` carries the
typed kind. New artifact types (research_report, startup_analysis,
game_design_document, …) slot in without contract changes.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


class ResultStatus(str, Enum):
    """Explicit lifecycle states — normal states never raise a 500."""
    NOT_FOUND = "not_found"                    # unknown run / cross-user
    NO_RUN = "no_run"                          # project has no run yet
    PENDING = "pending"                        # run queued, nothing produced
    RUNNING = "running"                        # run in progress
    PARTIAL = "partial"                        # some deliverables, none final
    COMPLETED = "completed"                    # final artifact resolved
    COMPLETED_NO_ARTIFACT = "completed_no_artifact"  # run done, no artifact
    ARTIFACT_NOT_FOUND = "artifact_not_found"  # filter matched nothing
    FAILED = "failed"                          # run errored
    CANCELLED = "cancelled"                    # run cancelled


# Statuses a caller can treat as "still working — poll again later".
NON_TERMINAL = frozenset({ResultStatus.PENDING, ResultStatus.RUNNING, ResultStatus.PARTIAL})


@dataclass
class SourceDeliverable:
    """A compact reference to a deliverable that fed the result (no heavy
    content — callers fetch the full run snapshot if they need everything)."""
    id: str
    node_id: str
    kind: str
    status: str
    agent_id: str = ""
    title: str = ""
    version: int = 0

    def to_dict(self) -> dict:
        return {
            "id": self.id, "node_id": self.node_id, "kind": self.kind,
            "status": self.status, "agent_id": self.agent_id,
            "title": self.title, "version": self.version,
        }


@dataclass
class PreviewPayload:
    """The stable result/preview a caller receives. Renderer-agnostic."""
    status: ResultStatus
    project_id: Optional[str] = None
    run_id: Optional[str] = None
    workflow_id: Optional[str] = None
    artifact_id: Optional[str] = None
    artifact_type: Optional[str] = None
    renderer: Optional[str] = None
    title: Optional[str] = None
    summary: Optional[str] = None
    content: Optional[str] = None
    html_preview: Optional[str] = None
    structured_data: Optional[Dict[str, Any]] = None
    source_deliverables: List[SourceDeliverable] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "status": self.status.value,
            "project_id": self.project_id,
            "run_id": self.run_id,
            "workflow_id": self.workflow_id,
            "artifact_id": self.artifact_id,
            "artifact_type": self.artifact_type,
            "renderer": self.renderer,
            "title": self.title,
            "summary": self.summary,
            "content": self.content,
            "html_preview": self.html_preview,
            "structured_data": self.structured_data,
            "source_deliverables": [s.to_dict() for s in self.source_deliverables],
            "warnings": list(self.warnings),
            "errors": list(self.errors),
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


__all__ = ["ResultStatus", "NON_TERMINAL", "SourceDeliverable", "PreviewPayload"]
