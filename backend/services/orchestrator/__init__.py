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

# Phase A.2 — deliverable registry. Only the bootstrap + stats helpers
# are re-exported at the package level; the CRUD surface
# (create_deliverable/set_status/set_content/...) is accessed via the
# submodule to avoid name collisions with tasks_store (both define a
# `set_status` / `VALID_STATUSES`).
from backend.services.orchestrator.deliverables_store import (
    init_deliverables_table,
    deliverables_stats,
)

# Phase A.2 — Project Orchestrator service (the conductor). Imported
# last so the storage symbols above are already bound. service.py has
# no module-level orchestrator imports (all lazy), so this is
# cycle-free.
from backend.services.orchestrator.service import (
    is_enabled as project_orchestrator_enabled,
    flags_snapshot,
    start_project_run, get_run_snapshot, cancel_run,
    ProjectOrchestratorDisabled, UnknownTemplateError, RunNotFoundError,
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
    # Deliverables (Phase A.2)
    "init_deliverables_table", "deliverables_stats",
    # Project Orchestrator service (Phase A.2)
    "project_orchestrator_enabled", "flags_snapshot",
    "start_project_run", "get_run_snapshot", "cancel_run",
    "ProjectOrchestratorDisabled", "UnknownTemplateError", "RunNotFoundError",
]
