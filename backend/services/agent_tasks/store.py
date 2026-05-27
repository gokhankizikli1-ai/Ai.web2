# coding: utf-8
"""Phase 8 — Agent task SQLite store (agent_tasks.db)."""
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

from backend.services.agent_tasks.types import (
    AgentTaskRecord, normalize_status, STATUS_QUEUED,
)


logger = logging.getLogger(__name__)


def _db_path() -> str:
    return os.getenv("AGENT_TASKS_DB_PATH", "agent_tasks.db")


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
CREATE TABLE IF NOT EXISTS agent_tasks (
    id                TEXT PRIMARY KEY,
    user_id           TEXT NOT NULL,
    assigned_agent_id TEXT NOT NULL,
    task_description  TEXT NOT NULL,
    status            TEXT NOT NULL DEFAULT 'queued',
    project_id        TEXT,
    parent_job_id     TEXT,
    delegation_status TEXT,
    payload_json      TEXT NOT NULL DEFAULT '{}',
    result_json       TEXT,
    summary           TEXT,
    metadata_json     TEXT NOT NULL DEFAULT '{}',
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_agent_tasks_user      ON agent_tasks(user_id);
CREATE INDEX IF NOT EXISTS ix_agent_tasks_project   ON agent_tasks(user_id, project_id);
CREATE INDEX IF NOT EXISTS ix_agent_tasks_agent     ON agent_tasks(assigned_agent_id);
CREATE INDEX IF NOT EXISTS ix_agent_tasks_parent_job ON agent_tasks(parent_job_id);
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
            logger.info("agent_tasks.store initialized | db=%s", _db_path())
        except Exception as e:
            logger.warning("agent_tasks.store.init failed: %s", e)


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


def _safe_json(raw: Optional[str]):
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception:
        return None


def _row_to_record(row: sqlite3.Row) -> AgentTaskRecord:
    return AgentTaskRecord(
        id=                row["id"],
        user_id=           row["user_id"],
        assigned_agent_id= row["assigned_agent_id"],
        task_description=  row["task_description"],
        status=            normalize_status(row["status"]),
        project_id=        row["project_id"],
        parent_job_id=     row["parent_job_id"],
        delegation_status= row["delegation_status"],
        payload=           _safe_json(row["payload_json"]) or {},
        result=            _safe_json(row["result_json"]),
        summary=           row["summary"],
        metadata=          _safe_json(row["metadata_json"]) or {},
        created_at=        row["created_at"],
        updated_at=        row["updated_at"],
    )


def insert(record: AgentTaskRecord) -> AgentTaskRecord:
    _ensure_init()
    rid = _new_id()
    now = _now()
    try:
        with _conn() as c:
            c.execute(
                "INSERT INTO agent_tasks (id, user_id, assigned_agent_id, task_description, "
                "status, project_id, parent_job_id, delegation_status, payload_json, "
                "result_json, summary, metadata_json, created_at, updated_at) VALUES "
                "(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (rid, str(record.user_id), record.assigned_agent_id,
                 record.task_description, normalize_status(record.status),
                 record.project_id, record.parent_job_id, record.delegation_status,
                 json.dumps(record.payload or {}),
                 json.dumps(record.result) if record.result is not None else None,
                 record.summary,
                 json.dumps(record.metadata or {}),
                 now, now),
            )
        return AgentTaskRecord(**{**record.__dict__, "id": rid,
                                  "created_at": now, "updated_at": now})
    except Exception as e:
        logger.warning("agent_tasks.insert error: %s", e)
        raise


def update(record_id: str, **fields) -> Optional[AgentTaskRecord]:
    _ensure_init()
    if not record_id:
        return None
    sets, params = [], []
    if "status" in fields:
        sets.append("status=?"); params.append(normalize_status(fields["status"]))
    if "delegation_status" in fields:
        sets.append("delegation_status=?"); params.append(fields["delegation_status"])
    if "result" in fields:
        sets.append("result_json=?")
        params.append(json.dumps(fields["result"]) if fields["result"] is not None else None)
    if "summary" in fields:
        sets.append("summary=?"); params.append(fields["summary"])
    if "metadata" in fields:
        sets.append("metadata_json=?"); params.append(json.dumps(fields["metadata"] or {}))
    if not sets:
        return get(record_id)
    sets.append("updated_at=?"); params.append(_now())
    params.append(record_id)
    try:
        with _conn() as c:
            c.execute(f"UPDATE agent_tasks SET {', '.join(sets)} WHERE id=?", params)
        return get(record_id)
    except Exception as e:
        logger.warning("agent_tasks.update %s error: %s", record_id, e)
        return None


def get(record_id: str) -> Optional[AgentTaskRecord]:
    _ensure_init()
    if not record_id:
        return None
    try:
        with _conn() as c:
            row = c.execute("SELECT * FROM agent_tasks WHERE id=?", (record_id,)).fetchone()
        return _row_to_record(row) if row else None
    except Exception as e:
        logger.warning("agent_tasks.get %s error: %s", record_id, e)
        return None


def list_user(
    user_id: str, *,
    project_id: Optional[str] = None,
    assigned_agent_id: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 50, offset: int = 0,
) -> list[AgentTaskRecord]:
    _ensure_init()
    if not user_id:
        return []
    sql = "SELECT * FROM agent_tasks WHERE user_id=?"
    params: list = [str(user_id)]
    if project_id is not None:
        sql += " AND project_id=?"; params.append(project_id)
    if assigned_agent_id is not None:
        sql += " AND assigned_agent_id=?"; params.append(assigned_agent_id)
    if status is not None:
        sql += " AND status=?"; params.append(normalize_status(status))
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
            row = c.execute("SELECT COUNT(*) AS n FROM agent_tasks").fetchone()
            out["total"] = int(row["n"] or 0)
    except Exception:
        pass
    return out


__all__ = ["init", "_reset_for_tests", "insert", "update", "get",
           "list_user", "table_counts"]
