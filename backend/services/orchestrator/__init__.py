# coding: utf-8
# Phase 3.4 — Orchestrator service public API.
#
# Owns the runs persistence layer + (Phase 5.1) the task graph
# layer. SSE event subscription helpers live alongside in
# backend/services/events/.

from backend.services.orchestrator.runs_store import (
    init_runs_table,
    create_run, finish_run, error_run,
    get_run, list_runs,
    runs_stats,
)

# Phase 5.1 — task graph + execution engine
from backend.services.orchestrator.tasks_store import (
    init_tasks_table,
    create_task, mark_started, mark_completed, mark_failed,
    get_task, list_tasks_for_run, list_tasks_for_project,
    tasks_stats,
    VALID_STATUSES,
)
from backend.services.orchestrator.execution_graph import (
    Task, ExecutionGraph, truncate_for_summary,
)

__all__ = [
    # Runs (Phase 3.4)
    "init_runs_table",
    "create_run", "finish_run", "error_run",
    "get_run", "list_runs",
    "runs_stats",
    # Tasks (Phase 5.1)
    "init_tasks_table",
    "create_task", "mark_started", "mark_completed", "mark_failed",
    "get_task", "list_tasks_for_run", "list_tasks_for_project",
    "tasks_stats", "VALID_STATUSES",
    "Task", "ExecutionGraph", "truncate_for_summary",
]
