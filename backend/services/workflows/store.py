# coding: utf-8
"""Phase 8 — Workflow SQLite store (workflows.db)."""
from __future__ import annotations

import json
import logging
import os
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Iterator, Optional

from backend.services.workflows.types import (
    WorkflowRecord,
    normalize_workflow_type, normalize_workflow_status,
    STATUS_QUEUED, TERMINAL_WORKFLOW_STATUSES,
)


logger = logging.getLogger(__name__)


def _db_path() -> str:
    return os.getenv("WORKFLOWS_DB_PATH", "workflows.db")


_LOCK = threading.Lock()
_INITIALIZED = False


@contextmanager
def _conn() -> Iterator[sqlite3.Connection]:
    c = sqlite3.connect(_db_path(), timeout=10)
    try:
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA journal_mode = WAL")
        yield c
        c.commit()
    finally:
        c.close()


_SCHEMA = """
CREATE TABLE IF NOT EXISTS workflows (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    project_id    TEXT,
    type          TEXT NOT NULL DEFAULT 'research',
    status        TEXT NOT NULL DEFAULT 'queued',
    steps_json    TEXT NOT NULL DEFAULT '[]',
    current_step  INTEGER NOT NULL DEFAULT 0,
    progress      INTEGER NOT NULL DEFAULT 0,
    payload_json  TEXT NOT NULL DEFAULT '{}',
    result_json   TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_workflows_user    ON workflows(user_id);
CREATE INDEX IF NOT EXISTS ix_workflows_project ON workflows(user_id, project_id);
CREATE INDEX IF NOT EXISTS ix_workflows_type    ON workflows(type);
"""


def init() -> None:
    global _INITIALIZED
    if _INITIALIZED:
        return
    with _LOCK:
        if _INITIALIZED:
            return
        try:
            with _conn() as c:
                c.executescript(_SCHEMA)
            _INITIALIZED = True
            logger.info("workflows.store initialized | db=%s", _db_path())
        except Exception as e:
            logger.warning("workflows.store.init failed: %s", e)


def _reset_for_tests() -> None:
    global _INITIALIZED
    with _LOCK:
        _INITIALIZED = False


def _ensure_init() -> None:
    if not _INITIALIZED:
        init()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    return uuid.uuid4().hex


def _safe_json(raw: Optional[str]) -> Any:
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception:
        return None


def _row_to_record(row: sqlite3.Row) -> WorkflowRecord:
    steps = _safe_json(row["steps_json"]) or []
    return WorkflowRecord(
        id=           row["id"],
        user_id=      row["user_id"],
        project_id=   row["project_id"],
        type=         row["type"],
        status=       normalize_workflow_status(row["status"]),
        steps=        steps if isinstance(steps, list) else [],
        current_step= int(row["current_step"] or 0),
        progress=     int(row["progress"] or 0),
        payload=      _safe_json(row["payload_json"]) or {},
        result=       _safe_json(row["result_json"]),
        metadata=     _safe_json(row["metadata_json"]) or {},
        created_at=   row["created_at"],
        updated_at=   row["updated_at"],
    )


def insert(record: WorkflowRecord) -> WorkflowRecord:
    _ensure_init()
    rid = _new_id()
    now = _now()
    try:
        with _conn() as c:
            c.execute(
                "INSERT INTO workflows (id, user_id, project_id, type, status, "
                "steps_json, current_step, progress, payload_json, result_json, "
                "metadata_json, created_at, updated_at) VALUES "
                "(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (rid, str(record.user_id), record.project_id,
                 normalize_workflow_type(record.type),
                 normalize_workflow_status(record.status),
                 json.dumps(record.steps or []),
                 int(record.current_step or 0),
                 int(max(0, min(100, record.progress or 0))),
                 json.dumps(record.payload or {}),
                 json.dumps(record.result) if record.result is not None else None,
                 json.dumps(record.metadata or {}),
                 now, now),
            )
        return WorkflowRecord(**{**record.__dict__, "id": rid,
                                 "created_at": now, "updated_at": now})
    except Exception as e:
        logger.warning("workflows.insert error: %s", e)
        raise


def update(record_id: str, **fields) -> Optional[WorkflowRecord]:
    _ensure_init()
    if not record_id:
        return None
    sets, params = [], []
    if "status" in fields:
        sets.append("status=?"); params.append(normalize_workflow_status(fields["status"]))
    if "current_step" in fields:
        sets.append("current_step=?"); params.append(int(fields["current_step"]))
    if "progress" in fields:
        sets.append("progress=?")
        params.append(int(max(0, min(100, int(fields["progress"])))))
    if "result" in fields:
        sets.append("result_json=?")
        params.append(json.dumps(fields["result"]) if fields["result"] is not None else None)
    if "metadata" in fields:
        sets.append("metadata_json=?"); params.append(json.dumps(fields["metadata"] or {}))
    if not sets:
        return get(record_id)
    sets.append("updated_at=?"); params.append(_now())
    params.append(record_id)
    try:
        with _conn() as c:
            c.execute(f"UPDATE workflows SET {', '.join(sets)} WHERE id=?", params)
        return get(record_id)
    except Exception as e:
        logger.warning("workflows.update %s error: %s", record_id, e)
        return None


def get(record_id: str) -> Optional[WorkflowRecord]:
    _ensure_init()
    if not record_id:
        return None
    try:
        with _conn() as c:
            row = c.execute("SELECT * FROM workflows WHERE id=?", (record_id,)).fetchone()
        return _row_to_record(row) if row else None
    except Exception as e:
        logger.warning("workflows.get %s error: %s", record_id, e)
        return None


def list_user(
    user_id: str, *,
    project_id: Optional[str] = None,
    type_: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 50, offset: int = 0,
) -> list[WorkflowRecord]:
    _ensure_init()
    if not user_id:
        return []
    sql = "SELECT * FROM workflows WHERE user_id=?"
    params: list = [str(user_id)]
    if project_id is not None:
        sql += " AND project_id=?"; params.append(project_id)
    if type_ is not None:
        sql += " AND type=?"; params.append(normalize_workflow_type(type_))
    if status is not None:
        sql += " AND status=?"; params.append(normalize_workflow_status(status))
    sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
    params.extend([int(max(1, min(200, limit))), int(max(0, offset))])
    try:
        with _conn() as c:
            rows = c.execute(sql, params).fetchall()
        return [_row_to_record(r) for r in rows]
    except Exception:
        return []


def table_counts() -> dict:
    out = {"total": 0}
    try:
        _ensure_init()
        with _conn() as c:
            row = c.execute("SELECT COUNT(*) AS n FROM workflows").fetchone()
            out["total"] = int(row["n"] or 0)
    except Exception:
        pass
    return out


__all__ = ["init", "_reset_for_tests", "insert", "update", "get", "list_user",
           "table_counts"]
