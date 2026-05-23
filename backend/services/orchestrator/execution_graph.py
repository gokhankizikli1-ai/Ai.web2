# coding: utf-8
# Phase 5.1 — Execution graph helpers.
#
# A thin dataclass + serialisation layer over tasks_store. The actual
# graph lives in SQLite (the `tasks` table); this module reads it back
# into typed Task objects + provides the response-envelope shape the
# /v2/orchestrate route returns to the frontend.
#
# A real DAG executor (parallel-where-possible + dependency waits) is
# explicitly NOT in 5.1 — the supervisor's delegation order is still
# the de-facto execution sequence. dependencies are captured but
# unenforced. The schema + types are ready for the executor to plug
# in later without re-modelling state.

from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Optional


@dataclass(frozen=True)
class Task:
    """Public-facing representation of an execution task. Read from
    tasks_store rows via Task.from_row. Immutable — mutations happen
    through the store's mark_* helpers."""
    id:             str
    run_id:         str
    project_id:     Optional[str]
    title:          str
    assigned_agent: str
    status:         str          # one of VALID_STATUSES in tasks_store
    dependencies:   List[str]
    result_summary: str
    started_at:     Optional[str]
    completed_at:   Optional[str]
    error:          Optional[str]
    metadata:       Dict[str, Any] = field(default_factory=dict)
    created_at:     str = ""
    updated_at:     str = ""

    @staticmethod
    def from_row(row: dict) -> "Task":
        """Build a Task from a tasks_store row dict. Tolerates missing
        optional fields so callers don't need to map defensively."""
        return Task(
            id=             row.get("id", ""),
            run_id=         row.get("run_id", ""),
            project_id=     row.get("project_id"),
            title=          row.get("title", ""),
            assigned_agent= row.get("assigned_agent", ""),
            status=         row.get("status", "queued"),
            dependencies=   list(row.get("dependencies") or []),
            result_summary= row.get("result_summary", "") or "",
            started_at=     row.get("started_at"),
            completed_at=   row.get("completed_at"),
            error=          row.get("error"),
            metadata=       dict(row.get("metadata") or {}),
            created_at=     row.get("created_at", ""),
            updated_at=     row.get("updated_at", ""),
        )

    def to_dict(self) -> dict:
        d = asdict(self)
        # asdict converts frozen dataclasses to a plain dict cleanly
        return d

    @property
    def duration_ms(self) -> Optional[int]:
        """Elapsed time from started_at → completed_at in milliseconds.
        Returns None when either timestamp is missing (task still in
        flight or never started). Useful for the timeline UI."""
        if not self.started_at or not self.completed_at:
            return None
        try:
            from datetime import datetime
            t0 = datetime.fromisoformat(self.started_at.rstrip("Z"))
            t1 = datetime.fromisoformat(self.completed_at.rstrip("Z"))
            return max(0, int((t1 - t0).total_seconds() * 1000))
        except Exception:
            return None


@dataclass
class ExecutionGraph:
    """All tasks belonging to a single orchestration run, plus a few
    derived counters convenient for the response envelope + UI."""
    run_id:    str
    tasks:     List[Task] = field(default_factory=list)

    @staticmethod
    def for_run(run_id: str) -> "ExecutionGraph":
        """Load the graph from tasks_store. Empty when no tasks exist
        — caller decides how to surface (e.g. older runs created
        before Phase 5.1 simply have no graph)."""
        from backend.services.orchestrator.tasks_store import list_tasks_for_run
        rows = list_tasks_for_run(run_id)
        return ExecutionGraph(
            run_id=run_id,
            tasks=[Task.from_row(r) for r in rows],
        )

    @property
    def counts(self) -> Dict[str, int]:
        """Per-status counts for quick UI badges."""
        out: Dict[str, int] = {}
        for t in self.tasks:
            out[t.status] = out.get(t.status, 0) + 1
        return out

    @property
    def total_duration_ms(self) -> int:
        """Sum of durations of completed tasks. Wall-clock for the run
        is shorter when tasks ran in parallel — this is the total
        compute-time across all specialists."""
        return sum(t.duration_ms or 0 for t in self.tasks)

    def to_envelope(self) -> dict:
        """JSON-serialisable shape returned in /v2/orchestrate's
        response envelope under the `task_graph` key. Compact enough
        to send on every response without bloating it."""
        return {
            "run_id":            self.run_id,
            "tasks":             [t.to_dict() for t in self.tasks],
            "counts":            self.counts,
            "total_count":       len(self.tasks),
            "total_duration_ms": self.total_duration_ms,
        }


def truncate_for_summary(text: str, max_chars: int = 500) -> str:
    """Trim a specialist's reply down to the result_summary length.
    Reaches for the first paragraph or section header so the preview
    is meaningful, not an arbitrary mid-sentence cut. Used by
    delegate() when calling tasks_store.mark_completed."""
    if not text:
        return ""
    text = text.strip()
    if len(text) <= max_chars:
        return text
    # Prefer a paragraph break boundary if one falls within the window
    for sep in ("\n\n", "\n", ". "):
        cut = text.rfind(sep, 0, max_chars)
        if cut > max_chars // 2:
            return text[:cut].rstrip() + "…"
    return text[:max_chars - 1].rstrip() + "…"


__all__ = [
    "Task",
    "ExecutionGraph",
    "truncate_for_summary",
]
