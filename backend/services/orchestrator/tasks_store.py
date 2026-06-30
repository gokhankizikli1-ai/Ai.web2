# coding: utf-8
# Phase 5.1 — Task graph persistence.
#
# A `tasks` table in projects.db (the same SQLite file Phase 2's
# project tables + Phase 3.4's `runs` table already live in). One row
# per delegate() invocation, lifecycle tracked from creation through
# completion / failure.
#
# Tasks are observability + state, not behavioural. delegate() will
# write through this store opportunistically — if init or write fails,
# the orchestration continues uninterrupted. This keeps the new layer
# strictly additive: nothing about delegate's correctness depends on
# tasks_store being healthy.

import logging
import os
import sqlite3
from backend.core.paths import resolve_db_path
import threading
import uuid
import json
from contextlib import contextmanager
from datetime import datetime
from typing import Any, Dict, Iterator, List, Optional

logger = logging.getLogger(__name__)

DB_PATH = resolve_db_path("projects.db", "PROJECTS_DB_PATH")

_LOCK = threading.Lock()
_COUNTS = {
    "tasks_created":   0,
    "tasks_started":   0,
    "tasks_completed": 0,
    "tasks_failed":    0,
    "errors":          0,
    "last_error":      "",
}


def _bump(field_: str, error: str = "") -> None:
    with _LOCK:
        _COUNTS[field_] = _COUNTS.get(field_, 0) + 1
        if error:
            _COUNTS["errors"]     = _COUNTS.get("errors", 0) + 1
            _COUNTS["last_error"] = error[:140]


def tasks_stats() -> dict:
    with _LOCK:
        return dict(_COUNTS)


def _now() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


def _dump_json(value: Any) -> str:
    if value is None:
        return "{}" if isinstance(value, dict) else "[]"
    try:
        return json.dumps(value, ensure_ascii=False, default=str)
    except Exception:
        return "{}" if isinstance(value, dict) else "[]"


def _load_json(raw: Optional[str], default: Any) -> Any:
    if not raw:
        return default
    try:
        v = json.loads(raw)
        return v if v is not None else default
    except Exception:
        return default


@contextmanager
def _conn() -> Iterator[sqlite3.Connection]:
    c = sqlite3.connect(DB_PATH, timeout=10)
    try:
        c.row_factory = sqlite3.Row
        yield c
        c.commit()
    finally:
        c.close()


# ── Schema ────────────────────────────────────────────────────────────
#
# Single table. `run_id` is a soft FK to runs.id (Phase 3.4) — no
# constraint so tasks can be inspected even after a runs row is
# pruned. `dependencies` stores a JSON array of task_ids this task
# depends on; in 5.1 it's captured but not enforced (the supervisor's
# delegation order is still the execution sequence). The schema is
# ready for a future DAG executor that respects dependencies.

_SCHEMA = """
CREATE TABLE IF NOT EXISTS tasks (
    id              TEXT PRIMARY KEY,
    run_id          TEXT NOT NULL,
    project_id      TEXT,
    title           TEXT NOT NULL,
    assigned_agent  TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'queued',
    dependencies    TEXT NOT NULL DEFAULT '[]',
    result_summary  TEXT NOT NULL DEFAULT '',
    started_at      TEXT,
    completed_at    TEXT,
    error           TEXT,
    metadata_json   TEXT NOT NULL DEFAULT '{}',
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_tasks_run     ON tasks(run_id);
CREATE INDEX IF NOT EXISTS ix_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS ix_tasks_status  ON tasks(status);
CREATE INDEX IF NOT EXISTS ix_tasks_created ON tasks(created_at);
"""


VALID_STATUSES = (
    "queued",      # task created, not yet picked up
    "planning",    # supervisor decomposing (reserved for future planner step)
    "running",     # specialist is executing
    "waiting",     # blocked on a dependency (reserved for future DAG executor)
    "completed",   # specialist returned successfully
    "failed",      # specialist errored or guard couldn't recover
)


def init_tasks_table() -> None:
    """Create the tasks table if missing. Idempotent; safe to call
    repeatedly. Logs + bumps error counter on failure but does not
    raise — delegate.py is allowed to keep working without it."""
    try:
        with _conn() as c:
            c.executescript(_SCHEMA)
    except Exception as exc:
        logger.warning("orchestrator.tasks_store.init failed: %s", exc)
        _bump("errors", str(exc))


# ── CRUD ─────────────────────────────────────────────────────────────

def create_task(
    *,
    run_id: str,
    title: str,
    assigned_agent: str,
    project_id: Optional[str] = None,
    dependencies: Optional[List[str]] = None,
    metadata: Optional[Dict[str, Any]] = None,
    task_id: Optional[str] = None,
) -> str:
    """Insert a new task with status='queued'. Returns the task_id.
    Returns '' on failure (caller treats as no-op)."""
    tid = (task_id or "").strip() or _new_id()
    now = _now()
    try:
        with _conn() as c:
            c.execute(
                """INSERT INTO tasks
                   (id, run_id, project_id, title, assigned_agent, status,
                    dependencies, metadata_json, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)""",
                (
                    tid, str(run_id), (project_id or None),
                    (title or "")[:240] or "Untitled task",
                    str(assigned_agent or "unknown"),
                    _dump_json(dependencies or []),
                    _dump_json(metadata or {}),
                    now, now,
                ),
            )
        _bump("tasks_created")
        return tid
    except sqlite3.IntegrityError as exc:
        # Duplicate id — return the existing tid
        _bump("errors", f"create_task conflict: {exc}")
        return tid
    except Exception as exc:
        _bump("errors", f"create_task: {exc}")
        return ""


def mark_started(task_id: str, *, metadata: Optional[dict] = None) -> bool:
    """Transition queued → running, record started_at. Merges metadata."""
    if not task_id:
        return False
    now = _now()
    try:
        with _conn() as c:
            row = c.execute(
                "SELECT metadata_json FROM tasks WHERE id = ?", (task_id,),
            ).fetchone()
            if not row:
                return False
            merged = {**_load_json(row["metadata_json"], {}), **(metadata or {})}
            c.execute(
                """UPDATE tasks
                   SET status='running', started_at=?, updated_at=?, metadata_json=?
                   WHERE id=? AND status IN ('queued','planning','waiting')""",
                (now, now, _dump_json(merged), task_id),
            )
        _bump("tasks_started")
        return True
    except Exception as exc:
        _bump("errors", f"mark_started: {exc}")
        return False


def mark_completed(
    task_id: str,
    *,
    result_summary: str = "",
    metadata: Optional[dict] = None,
) -> bool:
    """Transition → completed, record completed_at + result preview."""
    if not task_id:
        return False
    now = _now()
    try:
        with _conn() as c:
            row = c.execute(
                "SELECT metadata_json FROM tasks WHERE id = ?", (task_id,),
            ).fetchone()
            if not row:
                return False
            merged = {**_load_json(row["metadata_json"], {}), **(metadata or {})}
            c.execute(
                """UPDATE tasks
                   SET status='completed', completed_at=?, updated_at=?,
                       result_summary=?, metadata_json=?
                   WHERE id=?""",
                (now, now, (result_summary or "")[:600], _dump_json(merged), task_id),
            )
        _bump("tasks_completed")
        return True
    except Exception as exc:
        _bump("errors", f"mark_completed: {exc}")
        return False


def mark_failed(
    task_id: str,
    *,
    error: str = "",
    metadata: Optional[dict] = None,
) -> bool:
    if not task_id:
        return False
    now = _now()
    try:
        with _conn() as c:
            row = c.execute(
                "SELECT metadata_json FROM tasks WHERE id = ?", (task_id,),
            ).fetchone()
            if not row:
                return False
            merged = {**_load_json(row["metadata_json"], {}), **(metadata or {})}
            c.execute(
                """UPDATE tasks
                   SET status='failed', completed_at=?, updated_at=?,
                       error=?, metadata_json=?
                   WHERE id=?""",
                (now, now, (error or "")[:500], _dump_json(merged), task_id),
            )
        _bump("tasks_failed")
        return True
    except Exception as exc:
        _bump("errors", f"mark_failed: {exc}")
        return False


def get_task(task_id: str) -> Optional[dict]:
    try:
        with _conn() as c:
            row = c.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        return _row_to_dict(row) if row else None
    except Exception:
        return None


def list_tasks_for_run(run_id: str) -> List[dict]:
    """Return all tasks for a run in creation order. Newest cohort
    last so the UI renders them as a chronological list."""
    try:
        with _conn() as c:
            rows = c.execute(
                "SELECT * FROM tasks WHERE run_id = ? ORDER BY created_at ASC, id ASC",
                (run_id,),
            ).fetchall()
        return [_row_to_dict(r) for r in rows]
    except Exception:
        return []


def list_tasks_for_project(
    project_id: str, *, limit: int = 100,
) -> List[dict]:
    limit = max(1, min(int(limit or 100), 500))
    try:
        with _conn() as c:
            rows = c.execute(
                """SELECT * FROM tasks WHERE project_id = ?
                   ORDER BY created_at DESC LIMIT ?""",
                (project_id, limit),
            ).fetchall()
        return [_row_to_dict(r) for r in rows]
    except Exception:
        return []


def _row_to_dict(row: sqlite3.Row) -> dict:
    return {
        "id":             row["id"],
        "run_id":         row["run_id"],
        "project_id":     row["project_id"],
        "title":          row["title"],
        "assigned_agent": row["assigned_agent"],
        "status":         row["status"],
        "dependencies":   _load_json(row["dependencies"], []),
        "result_summary": row["result_summary"],
        "started_at":     row["started_at"],
        "completed_at":   row["completed_at"],
        "error":          row["error"],
        "metadata":       _load_json(row["metadata_json"], {}),
        "created_at":     row["created_at"],
        "updated_at":     row["updated_at"],
    }


__all__ = [
    "VALID_STATUSES",
    "init_tasks_table",
    "create_task",
    "mark_started", "mark_completed", "mark_failed",
    "get_task",
    "list_tasks_for_run", "list_tasks_for_project",
    "tasks_stats",
]
