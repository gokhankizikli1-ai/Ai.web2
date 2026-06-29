# coding: utf-8
# Phase A.2 — Deliverable registry persistence.
#
# A `deliverables` table in projects.db (the same SQLite file Phase 2's
# project tables + Phase 3.4's `runs` table + Phase 5.1's `tasks` table
# already live in). One row per node of a project-orchestrator run: the
# structured artifact a specific agent is responsible for producing.
#
# This is the missing "deliverable registry" the AI_OS_ROADMAP (§2.4)
# calls for — a structured "agent X is responsible for producing
# deliverable Y; here is its status; here is the content". The Project
# Orchestrator scaffolds one row per template node up front (status
# `pending`); the `agent.run` job kind flips it to `in_progress` then
# `completed` (or `failed`) as the agent executes, writing the produced
# content back into `content_json`.
#
# Strictly additive: a brand-new table, created idempotently via
# `init_deliverables_table()`. Nothing about the existing orchestrator /
# workflow paths depends on this store being healthy — every helper
# logs + bumps an error counter on failure rather than raising, so a
# disk hiccup degrades observability without breaking a run.

import json
import logging
import os
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime
from typing import Any, Dict, Iterator, List, Optional

logger = logging.getLogger(__name__)

DB_PATH = os.getenv("PROJECTS_DB_PATH", "projects.db")

_LOCK = threading.Lock()
_COUNTS = {
    "deliverables_created":   0,
    "deliverables_completed": 0,
    "deliverables_failed":    0,
    "errors":                 0,
    "last_error":             "",
}


# ── Status taxonomy ──────────────────────────────────────────────────
#
# pending      — scaffolded, no agent has started producing it yet
# in_progress  — the responsible agent is executing
# completed    — content produced + persisted
# failed       — the agent errored or the workflow step failed
# skipped      — an upstream failure means this will never run

STATUS_PENDING     = "pending"
STATUS_IN_PROGRESS = "in_progress"
STATUS_COMPLETED   = "completed"
STATUS_FAILED      = "failed"
STATUS_SKIPPED     = "skipped"

VALID_STATUSES = (
    STATUS_PENDING, STATUS_IN_PROGRESS, STATUS_COMPLETED,
    STATUS_FAILED, STATUS_SKIPPED,
)

TERMINAL_STATUSES = frozenset({STATUS_COMPLETED, STATUS_FAILED, STATUS_SKIPPED})


def _bump(field_: str, error: str = "") -> None:
    with _LOCK:
        _COUNTS[field_] = _COUNTS.get(field_, 0) + 1
        if error:
            _COUNTS["errors"]     = _COUNTS.get("errors", 0) + 1
            _COUNTS["last_error"] = error[:140]


def deliverables_stats() -> dict:
    with _LOCK:
        return dict(_COUNTS)


def _now() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


def _dump_json(value: Any) -> str:
    if value is None:
        return "{}"
    try:
        return json.dumps(value, ensure_ascii=False, default=str)
    except Exception:
        return "{}"


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
# `run_id` is a soft FK to runs.id (Phase 3.4). `node_id` is the stable
# template-node key (e.g. "research", "copy") so the FE can match a
# deliverable to a task-graph node. `content_json` is opaque JSON —
# only `status` and `kind` are typed (matches the roadmap's lock-in
# avoidance: "keep content_json as opaque JSON").

_SCHEMA = """
CREATE TABLE IF NOT EXISTS deliverables (
    id              TEXT PRIMARY KEY,
    run_id          TEXT NOT NULL,
    project_id      TEXT,
    agent_id        TEXT NOT NULL,
    node_id         TEXT NOT NULL,
    kind            TEXT NOT NULL,
    title           TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'pending',
    content_json    TEXT NOT NULL DEFAULT '{}',
    version         INTEGER NOT NULL DEFAULT 0,
    error           TEXT,
    metadata_json   TEXT NOT NULL DEFAULT '{}',
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_deliverables_run     ON deliverables(run_id);
CREATE INDEX IF NOT EXISTS ix_deliverables_project ON deliverables(project_id);
CREATE INDEX IF NOT EXISTS ix_deliverables_status  ON deliverables(status);
"""


def init_deliverables_table() -> None:
    """Create the deliverables table if missing. Idempotent; safe to
    call repeatedly. Logs + bumps the error counter on failure but does
    not raise."""
    try:
        with _conn() as c:
            c.executescript(_SCHEMA)
    except Exception as exc:
        logger.warning("orchestrator.deliverables_store.init failed: %s", exc)
        _bump("errors", str(exc))


# ── CRUD ─────────────────────────────────────────────────────────────

def create_deliverable(
    *,
    run_id: str,
    agent_id: str,
    node_id: str,
    kind: str,
    title: str = "",
    project_id: Optional[str] = None,
    status: str = STATUS_PENDING,
    content: Optional[dict] = None,
    metadata: Optional[Dict[str, Any]] = None,
    deliverable_id: Optional[str] = None,
) -> str:
    """Insert a new deliverable row. Returns the deliverable_id (or ''
    on failure so the caller can treat it as a no-op)."""
    did = (deliverable_id or "").strip() or _new_id()
    now = _now()
    st = status if status in VALID_STATUSES else STATUS_PENDING
    try:
        with _conn() as c:
            c.execute(
                """INSERT INTO deliverables
                   (id, run_id, project_id, agent_id, node_id, kind, title,
                    status, content_json, version, metadata_json,
                    created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)""",
                (
                    did, str(run_id), (project_id or None),
                    str(agent_id or "unknown"), str(node_id or ""),
                    str(kind or "artifact"), (title or "")[:240],
                    st, _dump_json(content or {}),
                    _dump_json(metadata or {}), now, now,
                ),
            )
        _bump("deliverables_created")
        return did
    except sqlite3.IntegrityError as exc:
        _bump("errors", f"create_deliverable conflict: {exc}")
        return did
    except Exception as exc:
        _bump("errors", f"create_deliverable: {exc}")
        return ""


def set_status(
    deliverable_id: str, status: str, *,
    error: Optional[str] = None,
    metadata: Optional[dict] = None,
) -> bool:
    """Transition a deliverable to a new status. Merges metadata. No-op
    (returns False) on unknown id or invalid status."""
    if not deliverable_id or status not in VALID_STATUSES:
        return False
    now = _now()
    try:
        with _conn() as c:
            row = c.execute(
                "SELECT metadata_json FROM deliverables WHERE id = ?",
                (deliverable_id,),
            ).fetchone()
            if not row:
                return False
            merged = {**_load_json(row["metadata_json"], {}), **(metadata or {})}
            c.execute(
                """UPDATE deliverables
                   SET status=?, error=?, updated_at=?, metadata_json=?
                   WHERE id=?""",
                (status, (error or None), now, _dump_json(merged), deliverable_id),
            )
        if status == STATUS_COMPLETED:
            _bump("deliverables_completed")
        elif status == STATUS_FAILED:
            _bump("deliverables_failed")
        return True
    except Exception as exc:
        _bump("errors", f"set_status: {exc}")
        return False


def set_content(
    deliverable_id: str, content: dict, *,
    status: Optional[str] = None,
    bump_version: bool = True,
    metadata: Optional[dict] = None,
) -> bool:
    """Write produced content into a deliverable, bumping its version.
    Optionally also transitions status in the same write."""
    if not deliverable_id:
        return False
    now = _now()
    try:
        with _conn() as c:
            row = c.execute(
                "SELECT version, status, metadata_json FROM deliverables WHERE id = ?",
                (deliverable_id,),
            ).fetchone()
            if not row:
                return False
            version = int(row["version"] or 0) + (1 if bump_version else 0)
            new_status = status if (status in VALID_STATUSES) else row["status"]
            merged = {**_load_json(row["metadata_json"], {}), **(metadata or {})}
            c.execute(
                """UPDATE deliverables
                   SET content_json=?, version=?, status=?, updated_at=?,
                       metadata_json=?
                   WHERE id=?""",
                (_dump_json(content or {}), version, new_status, now,
                 _dump_json(merged), deliverable_id),
            )
        if new_status == STATUS_COMPLETED:
            _bump("deliverables_completed")
        return True
    except Exception as exc:
        _bump("errors", f"set_content: {exc}")
        return False


def get_deliverable(deliverable_id: str) -> Optional[dict]:
    try:
        with _conn() as c:
            row = c.execute(
                "SELECT * FROM deliverables WHERE id = ?", (deliverable_id,),
            ).fetchone()
        return _row_to_dict(row) if row else None
    except Exception:
        return None


def list_for_run(run_id: str) -> List[dict]:
    """All deliverables for a run, in creation order (matches the
    template-node order the orchestrator scaffolded them in)."""
    try:
        with _conn() as c:
            rows = c.execute(
                "SELECT * FROM deliverables WHERE run_id = ? "
                "ORDER BY created_at ASC, id ASC",
                (run_id,),
            ).fetchall()
        return [_row_to_dict(r) for r in rows]
    except Exception:
        return []


def list_for_project(project_id: str, *, limit: int = 200) -> List[dict]:
    limit = max(1, min(int(limit or 200), 1000))
    try:
        with _conn() as c:
            rows = c.execute(
                """SELECT * FROM deliverables WHERE project_id = ?
                   ORDER BY created_at DESC LIMIT ?""",
                (project_id, limit),
            ).fetchall()
        return [_row_to_dict(r) for r in rows]
    except Exception:
        return []


def _row_to_dict(row: sqlite3.Row) -> dict:
    return {
        "id":         row["id"],
        "run_id":     row["run_id"],
        "project_id": row["project_id"],
        "agent_id":   row["agent_id"],
        "node_id":    row["node_id"],
        "kind":       row["kind"],
        "title":      row["title"],
        "status":     row["status"],
        "content":    _load_json(row["content_json"], {}),
        "version":    row["version"],
        "error":      row["error"],
        "metadata":   _load_json(row["metadata_json"], {}),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


__all__ = [
    "STATUS_PENDING", "STATUS_IN_PROGRESS", "STATUS_COMPLETED",
    "STATUS_FAILED", "STATUS_SKIPPED",
    "VALID_STATUSES", "TERMINAL_STATUSES",
    "init_deliverables_table",
    "create_deliverable", "set_status", "set_content",
    "get_deliverable", "list_for_run", "list_for_project",
    "deliverables_stats",
]
