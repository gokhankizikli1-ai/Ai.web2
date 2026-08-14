# coding: utf-8
"""Phase 1 (completion pass) — durable build-execution state.

WHY
---
The build capability (`build_capability.py`) routes a Web/App build to an
executor. The default executor is a truthful handoff; a REAL executor
(`build_executor.NodeBuildExecutor`) shells out to the headless build worker.
Either way, a build execution needs DURABLE backend state so that:

  * a worker/server restart can RECONCILE with an already-running or
    already-finished build (no duplicate paid execution), and
  * the orchestrator/observability layer can read a truthful build status
    (queued / running / completed / failed / cancelled) and its artifact /
    cost REFERENCES (never the source tree).

This is one small additive table in the existing `projects.db`, opened
through the Phase-1 hardened `_sqlite` helper (WAL + busy_timeout +
BEGIN IMMEDIATE on the read-modify-write transitions). It is NOT a second
job engine — a build execution is 1:1 with the `web_build.run`/`app_build.run`
job that drives it, keyed by a stable id so restart is idempotent.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from backend.core.paths import resolve_db_path
from backend.services.orchestrator import _sqlite

logger = logging.getLogger(__name__)

DB_PATH = resolve_db_path("projects.db", "PROJECTS_DB_PATH")

# Canonical, repository-consistent execution states.
STATUS_QUEUED = "queued"
STATUS_RUNNING = "running"
STATUS_COMPLETED = "completed"
STATUS_FAILED = "failed"
STATUS_CANCELLED = "cancelled"
# A worker that ran but explicitly DEFERRED (executor_unavailable) ends here.
# Distinct from `completed` (no artifact was built) and from `failed` (the
# worker did not error) — so reconcile stays consistent across restarts
# instead of flipping a handoff into a spurious failure.
STATUS_HANDOFF = "handoff"

TERMINAL = frozenset({STATUS_COMPLETED, STATUS_FAILED, STATUS_CANCELLED, STATUS_HANDOFF})
VALID = frozenset({STATUS_QUEUED, STATUS_RUNNING, *TERMINAL})

_SCHEMA = """
CREATE TABLE IF NOT EXISTS build_executions (
    id            TEXT PRIMARY KEY,       -- stable: {build_type}:{run_id}:{task_or_node}
    run_id        TEXT,
    project_id    TEXT,
    task_id       TEXT,
    node_id       TEXT,
    build_type    TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'queued',
    artifact_ref  TEXT NOT NULL DEFAULT '',
    build_ref     TEXT NOT NULL DEFAULT '',
    summary       TEXT NOT NULL DEFAULT '',
    cost_json     TEXT NOT NULL DEFAULT '{}',
    error         TEXT,
    attempts      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_build_exec_run     ON build_executions(run_id);
CREATE INDEX IF NOT EXISTS ix_build_exec_project ON build_executions(project_id);
CREATE INDEX IF NOT EXISTS ix_build_exec_status  ON build_executions(status);
"""


def _now() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _dump(v: Any) -> str:
    try:
        return json.dumps(v or {}, ensure_ascii=False, default=str)
    except Exception:
        return "{}"


def _load(raw: Optional[str]) -> dict:
    if not raw:
        return {}
    try:
        v = json.loads(raw)
        return v if isinstance(v, dict) else {}
    except Exception:
        return {}


def stable_id(build_type: str, run_id: Optional[str], task_or_node: Optional[str]) -> str:
    return f"{build_type}:{run_id or '-'}:{task_or_node or '-'}"


def init_build_executions_table() -> None:
    try:
        with _sqlite.connection(DB_PATH) as c:
            c.executescript(_SCHEMA)
    except Exception as exc:  # pragma: no cover — defensive
        logger.warning("orchestrator.build_execution_store.init failed: %s", exc)


def _row_to_dict(row) -> dict:
    d = dict(row)
    d["cost"] = _load(d.pop("cost_json", "{}"))
    return d


def get(execution_id: str) -> Optional[dict]:
    try:
        with _sqlite.connection(DB_PATH) as c:
            row = c.execute(
                "SELECT * FROM build_executions WHERE id=?", (execution_id,),
            ).fetchone()
        return _row_to_dict(row) if row else None
    except Exception:
        return None


def begin_or_reconcile(
    *,
    execution_id: str,
    build_type: str,
    run_id: Optional[str],
    project_id: Optional[str],
    task_id: Optional[str],
    node_id: Optional[str],
) -> dict:
    """Atomically claim this build execution for running, OR return the
    existing row if it is already terminal / already running.

    Returns a dict with a `_action` key:
      * "reconciled_terminal" — a prior run already finished it; caller MUST
        reuse the stored result and NOT re-execute (idempotent restart — the
        key guarantee against duplicate paid builds after a crash-then-restart
        that happened AFTER the build completed).
      * "claimed"             — this caller owns the execution; proceed. A
        pre-existing non-terminal (queued/running) row means a prior attempt
        was interrupted (crashed before finalizing); it is reclaimed and
        re-run, since no live subprocess survives a process crash.

    The BEGIN IMMEDIATE transaction makes the check-and-claim atomic so two
    concurrent callers can't both silently proceed on a terminal result.

    NOTE: this is single-store atomic. True cross-replica concurrency needs a
    shared store + lease/heartbeat (Phase 3); within one job the workflow
    idempotency key already ensures only one executor call per step.
    """
    init_build_executions_table()
    now = _now()
    with _sqlite.writer_tx(DB_PATH) as c:
        row = c.execute(
            "SELECT * FROM build_executions WHERE id=?", (execution_id,),
        ).fetchone()
        if row is not None:
            if str(row["status"]) in TERMINAL:
                d = _row_to_dict(row)
                d["_action"] = "reconciled_terminal"
                return d
            # queued/running → reclaim (a prior attempt was interrupted).
            c.execute(
                "UPDATE build_executions SET status=?, attempts=attempts+1, updated_at=? WHERE id=?",
                (STATUS_RUNNING, now, execution_id),
            )
            d = _row_to_dict(row)
            d["status"] = STATUS_RUNNING
            d["_action"] = "claimed"
            return d
        # New row → insert as running (attempt 1).
        c.execute(
            """INSERT INTO build_executions
               (id, run_id, project_id, task_id, node_id, build_type, status,
                attempts, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, 'running', 1, ?, ?)""",
            (execution_id, run_id, project_id, task_id, node_id, build_type, now, now),
        )
    return {
        "id": execution_id, "build_type": build_type, "status": STATUS_RUNNING,
        "run_id": run_id, "project_id": project_id, "task_id": task_id,
        "node_id": node_id, "attempts": 1, "_action": "claimed",
    }


def _finalize(execution_id: str, status: str, *,
              artifact_ref: str = "", build_ref: str = "",
              summary: str = "", cost: Optional[dict] = None,
              error: Optional[str] = None) -> bool:
    if status not in VALID:
        return False
    now = _now()
    try:
        with _sqlite.writer_tx(DB_PATH) as c:
            row = c.execute(
                "SELECT status FROM build_executions WHERE id=?", (execution_id,),
            ).fetchone()
            if not row:
                return False
            # Do not clobber an already-terminal state (idempotent).
            if str(row["status"]) in TERMINAL:
                return True
            c.execute(
                """UPDATE build_executions
                   SET status=?, artifact_ref=?, build_ref=?, summary=?,
                       cost_json=?, error=?, updated_at=?
                   WHERE id=?""",
                (status, artifact_ref or "", build_ref or "", (summary or "")[:600],
                 _dump(cost), (error or None), now, execution_id),
            )
        return True
    except Exception as exc:
        logger.warning("build_execution_store._finalize failed: %s", exc)
        return False


def mark_completed(execution_id: str, *, artifact_ref: str, build_ref: str = "",
                   summary: str = "", cost: Optional[dict] = None) -> bool:
    return _finalize(execution_id, STATUS_COMPLETED, artifact_ref=artifact_ref,
                     build_ref=build_ref, summary=summary, cost=cost)


def mark_failed(execution_id: str, *, error: str) -> bool:
    return _finalize(execution_id, STATUS_FAILED, error=error)


def mark_cancelled(execution_id: str, *, error: str = "cancelled") -> bool:
    return _finalize(execution_id, STATUS_CANCELLED, error=error)


def mark_handoff(execution_id: str, *, artifact_ref: str = "",
                 summary: str = "", detail: str = "") -> bool:
    """Record a truthful deferral (executor ran, produced no artifact).
    Terminal + idempotent; reconcile returns handoff, never a false failure."""
    return _finalize(execution_id, STATUS_HANDOFF, artifact_ref=artifact_ref,
                     summary=summary, error=detail or None)


def list_for_run(run_id: str) -> List[dict]:
    try:
        with _sqlite.connection(DB_PATH) as c:
            rows = c.execute(
                "SELECT * FROM build_executions WHERE run_id=? ORDER BY created_at ASC",
                (run_id,),
            ).fetchall()
        return [_row_to_dict(r) for r in rows]
    except Exception:
        return []


def list_for_project(project_id: str, *, limit: int = 200) -> List[dict]:
    """Build executions for a project, most-recent first. Mirrors
    `deliverables_store.list_for_project` so a project-scoped surface (Project
    Brain, products endpoint) can read execution status/refs without a run id.
    Uses the existing `ix_build_exec_project` index. Refs only — never source."""
    if not project_id:
        return []
    limit = max(1, min(int(limit or 200), 1000))
    try:
        with _sqlite.connection(DB_PATH) as c:
            rows = c.execute(
                "SELECT * FROM build_executions WHERE project_id=? "
                "ORDER BY created_at DESC LIMIT ?",
                (str(project_id), limit),
            ).fetchall()
        return [_row_to_dict(r) for r in rows]
    except Exception:
        return []


__all__ = [
    "STATUS_QUEUED", "STATUS_RUNNING", "STATUS_COMPLETED", "STATUS_FAILED",
    "STATUS_CANCELLED", "STATUS_HANDOFF", "TERMINAL", "VALID",
    "stable_id", "init_build_executions_table", "get", "begin_or_reconcile",
    "mark_completed", "mark_failed", "mark_cancelled", "mark_handoff",
    "list_for_run", "list_for_project",
]
