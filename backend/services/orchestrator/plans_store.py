# coding: utf-8
"""Phase 6 — persistent project plans.

A plan is a durable, structured, capability-backed task DAG for a project
goal. It persists (so it survives refresh/restart), keeps stable task ids
across edits, and is the artifact the orchestrator instantiates a run from.

Stored as one row per plan in `projects.db` (hardened `_sqlite` helper);
the task DAG is opaque JSON. Additive, idempotent, fail-soft.
"""
from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from backend.core.paths import resolve_db_path
from backend.services.orchestrator import _sqlite

logger = logging.getLogger(__name__)

DB_PATH = resolve_db_path("projects.db", "PROJECTS_DB_PATH")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS project_plans (
    id            TEXT PRIMARY KEY,
    project_id    TEXT,
    user_id       TEXT NOT NULL,
    goal          TEXT NOT NULL DEFAULT '',
    version       INTEGER NOT NULL DEFAULT 1,
    tasks_json    TEXT NOT NULL DEFAULT '[]',
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_plans_project ON project_plans(project_id);
CREATE INDEX IF NOT EXISTS ix_plans_user    ON project_plans(user_id);
"""


def _now() -> str:
    return datetime.utcnow().isoformat() + "Z"


def init_plans_table() -> None:
    try:
        with _sqlite.connection(DB_PATH) as c:
            c.executescript(_SCHEMA)
    except Exception as exc:  # pragma: no cover — defensive
        logger.warning("orchestrator.plans_store.init failed: %s", exc)


def _dump(v: Any) -> str:
    try:
        return json.dumps(v, ensure_ascii=False, default=str)
    except Exception:
        return "[]"


def _load(raw: Optional[str], default: Any) -> Any:
    if not raw:
        return default
    try:
        return json.loads(raw)
    except Exception:
        return default


def save_plan(
    *,
    user_id: str,
    goal: str,
    tasks: List[dict],
    project_id: Optional[str] = None,
    plan_id: Optional[str] = None,
) -> str:
    """Insert a new plan or replace an existing one (bumping its version and
    preserving its id — keeps task ids stable across edits). Returns id."""
    init_plans_table()
    now = _now()
    try:
        with _sqlite.writer_tx(DB_PATH) as c:
            if plan_id:
                row = c.execute(
                    "SELECT version FROM project_plans WHERE id=?", (plan_id,),
                ).fetchone()
                if row:
                    c.execute(
                        """UPDATE project_plans
                           SET goal=?, tasks_json=?, version=?, updated_at=?
                           WHERE id=?""",
                        (goal or "", _dump(tasks), int(row["version"] or 1) + 1,
                         now, plan_id),
                    )
                    return plan_id
            pid = plan_id or uuid.uuid4().hex[:12]
            c.execute(
                """INSERT INTO project_plans
                   (id, project_id, user_id, goal, version, tasks_json,
                    created_at, updated_at)
                   VALUES (?, ?, ?, ?, 1, ?, ?, ?)""",
                (pid, (project_id or None), str(user_id), goal or "",
                 _dump(tasks), now, now),
            )
            return pid
    except Exception as exc:
        logger.warning("orchestrator.plans_store.save failed: %s", exc)
        return ""


def get_plan(plan_id: str) -> Optional[dict]:
    try:
        with _sqlite.connection(DB_PATH) as c:
            row = c.execute(
                "SELECT * FROM project_plans WHERE id=?", (plan_id,),
            ).fetchone()
        if not row:
            return None
        d = dict(row)
        d["tasks"] = _load(d.pop("tasks_json", "[]"), [])
        return d
    except Exception:
        return None


def latest_for_project(project_id: str) -> Optional[dict]:
    try:
        with _sqlite.connection(DB_PATH) as c:
            row = c.execute(
                """SELECT * FROM project_plans WHERE project_id=?
                   ORDER BY updated_at DESC LIMIT 1""",
                (str(project_id),),
            ).fetchone()
        if not row:
            return None
        d = dict(row)
        d["tasks"] = _load(d.pop("tasks_json", "[]"), [])
        return d
    except Exception:
        return None


__all__ = [
    "init_plans_table", "save_plan", "get_plan", "latest_for_project",
]
