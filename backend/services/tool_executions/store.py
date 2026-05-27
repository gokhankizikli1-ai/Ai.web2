# coding: utf-8
"""Phase 10 — Tool execution SQLite store (tool_executions.db).

Same WAL pattern as the other Phase 9/10 stores. Schema is wide because
the FE renders directly from it (avoids a join-by-id round-trip just to
get a tool's name / status / latency). Columns we expect to query on
get indexes; the rest stay narrow.
"""
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

from backend.services.tool_executions.types import (
    ToolExecution, normalize_status, STATUS_QUEUED, STATUS_RUNNING,
    TERMINAL_EXECUTION_STATUSES,
)


logger = logging.getLogger(__name__)


def _db_path() -> str:
    return os.getenv("TOOL_EXECUTIONS_DB_PATH", "tool_executions.db")


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
CREATE TABLE IF NOT EXISTS tool_executions (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL,
    tool_id         TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'queued',
    caller          TEXT NOT NULL DEFAULT 'user',
    execution_mode  TEXT NOT NULL DEFAULT 'sync',
    input_summary   TEXT NOT NULL DEFAULT '',
    input_json      TEXT NOT NULL DEFAULT '{}',
    output_json     TEXT,
    error_code      TEXT,
    error_message   TEXT,
    provider        TEXT,
    latency_ms      INTEGER,
    cost_estimate   REAL,
    panel_id        TEXT,
    workflow_id     TEXT,
    agent_id        TEXT,
    project_id      TEXT,
    correlation_id  TEXT,
    metadata_json   TEXT NOT NULL DEFAULT '{}',
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_tool_exec_user_created
    ON tool_executions(user_id, created_at);
CREATE INDEX IF NOT EXISTS ix_tool_exec_tool
    ON tool_executions(tool_id, created_at);
CREATE INDEX IF NOT EXISTS ix_tool_exec_panel
    ON tool_executions(panel_id);
CREATE INDEX IF NOT EXISTS ix_tool_exec_status
    ON tool_executions(user_id, status);
CREATE INDEX IF NOT EXISTS ix_tool_exec_agent
    ON tool_executions(agent_id, created_at);
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
            logger.info("tool_executions.store initialized | db=%s", _db_path())
        except Exception as e:
            logger.warning("tool_executions.store.init failed: %s", e)


def _reset_for_tests() -> None:
    global _INITIALIZED
    with _LOCK:
        _INITIALIZED = False


def _ensure_init() -> None:
    if not _INITIALIZED:
        init()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row(r: sqlite3.Row) -> ToolExecution:
    try:
        meta = json.loads(r["metadata_json"] or "{}")
    except Exception:
        meta = {}
    if not isinstance(meta, dict):
        meta = {}
    return ToolExecution(
        id=             r["id"],
        user_id=        r["user_id"],
        tool_id=        r["tool_id"],
        status=         r["status"],
        caller=         r["caller"],
        execution_mode= r["execution_mode"],
        input_summary=  r["input_summary"],
        input_json=     r["input_json"],
        output_json=    r["output_json"],
        error_code=     r["error_code"],
        error_message=  r["error_message"],
        provider=       r["provider"],
        latency_ms=     r["latency_ms"],
        cost_estimate=  r["cost_estimate"],
        panel_id=       r["panel_id"],
        workflow_id=    r["workflow_id"],
        agent_id=       r["agent_id"],
        project_id=     r["project_id"],
        correlation_id= r["correlation_id"],
        metadata=       meta,
        created_at=     r["created_at"],
        updated_at=     r["updated_at"],
    )


# ── Writes ─────────────────────────────────────────────────────────────────

def insert(execution: ToolExecution) -> ToolExecution:
    _ensure_init()
    new_id = execution.id or uuid.uuid4().hex
    ts = _now_iso()
    status = normalize_status(execution.status)
    with _conn() as c:
        c.execute(
            """
            INSERT INTO tool_executions (
                id, user_id, tool_id, status, caller, execution_mode,
                input_summary, input_json, output_json, error_code,
                error_message, provider, latency_ms, cost_estimate,
                panel_id, workflow_id, agent_id, project_id,
                correlation_id, metadata_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                new_id, execution.user_id, execution.tool_id, status,
                execution.caller, execution.execution_mode,
                execution.input_summary, execution.input_json or "{}",
                execution.output_json, execution.error_code,
                execution.error_message, execution.provider,
                execution.latency_ms, execution.cost_estimate,
                execution.panel_id, execution.workflow_id,
                execution.agent_id, execution.project_id,
                execution.correlation_id,
                json.dumps(execution.metadata or {}),
                ts, ts,
            ),
        )
    execution.id = new_id
    execution.status = status
    execution.created_at = ts
    execution.updated_at = ts
    return execution


def mark_running(execution_id: str, *, user_id: str) -> Optional[ToolExecution]:
    return _update_status(execution_id, user_id=user_id, status=STATUS_RUNNING)


def mark_terminal(
    execution_id: str, *, user_id: str, status: str,
    output_json: Optional[str] = None,
    error_code: Optional[str] = None,
    error_message: Optional[str] = None,
    provider: Optional[str] = None,
    latency_ms: Optional[int] = None,
    cost_estimate: Optional[float] = None,
) -> Optional[ToolExecution]:
    """Atomic terminal write — sets status + result payload + cost in
    one UPDATE so the FE never sees a "completed with no output" row.
    """
    _ensure_init()
    new_status = normalize_status(status)
    if new_status not in TERMINAL_EXECUTION_STATUSES:
        # Use _update_status for non-terminal transitions.
        return _update_status(execution_id, user_id=user_id, status=new_status)
    ts = _now_iso()
    with _conn() as c:
        # Verify ownership before write.
        cur = c.execute(
            "SELECT id FROM tool_executions WHERE id = ? AND user_id = ?",
            (execution_id, user_id),
        ).fetchone()
        if cur is None:
            return None
        c.execute(
            """
            UPDATE tool_executions
               SET status = ?,
                   output_json   = COALESCE(?, output_json),
                   error_code    = COALESCE(?, error_code),
                   error_message = COALESCE(?, error_message),
                   provider      = COALESCE(?, provider),
                   latency_ms    = COALESCE(?, latency_ms),
                   cost_estimate = COALESCE(?, cost_estimate),
                   updated_at    = ?
             WHERE id = ? AND user_id = ?
            """,
            (
                new_status, output_json, error_code, error_message,
                provider, latency_ms, cost_estimate, ts,
                execution_id, user_id,
            ),
        )
    return get(execution_id, user_id=user_id)


def _update_status(
    execution_id: str, *, user_id: str, status: str,
) -> Optional[ToolExecution]:
    _ensure_init()
    new_status = normalize_status(status)
    ts = _now_iso()
    with _conn() as c:
        cur = c.execute(
            "SELECT id FROM tool_executions WHERE id = ? AND user_id = ?",
            (execution_id, user_id),
        ).fetchone()
        if cur is None:
            return None
        c.execute(
            "UPDATE tool_executions SET status = ?, updated_at = ? "
            "WHERE id = ? AND user_id = ?",
            (new_status, ts, execution_id, user_id),
        )
    return get(execution_id, user_id=user_id)


# ── Reads ──────────────────────────────────────────────────────────────────

def get(execution_id: str, *, user_id: str) -> Optional[ToolExecution]:
    _ensure_init()
    with _conn() as c:
        r = c.execute(
            "SELECT * FROM tool_executions WHERE id = ? AND user_id = ?",
            (execution_id, user_id),
        ).fetchone()
    return _row(r) if r else None


def list_user(
    *, user_id: str,
    tool_id: Optional[str] = None,
    status: Optional[str] = None,
    panel_id: Optional[str] = None,
    agent_id: Optional[str] = None,
    limit: int = 50, offset: int = 0,
) -> list[ToolExecution]:
    _ensure_init()
    where = ["user_id = ?"]
    params: list = [user_id]
    if tool_id:
        where.append("tool_id = ?"); params.append(tool_id)
    if status:
        where.append("status = ?"); params.append(normalize_status(status))
    if panel_id:
        where.append("panel_id = ?"); params.append(panel_id)
    if agent_id:
        where.append("agent_id = ?"); params.append(agent_id)
    sql = (
        "SELECT * FROM tool_executions WHERE "
        + " AND ".join(where)
        + " ORDER BY created_at DESC LIMIT ? OFFSET ?"
    )
    params.extend([max(1, min(int(limit), 500)), max(0, int(offset))])
    with _conn() as c:
        rows = c.execute(sql, params).fetchall()
    return [_row(r) for r in rows]


def usage_summary(*, user_id: str, since_iso: Optional[str] = None) -> dict:
    """Aggregate counts + latency + cost since `since_iso`. Used by the
    credit accounting layer (next PR) and ops dashboards."""
    _ensure_init()
    where = ["user_id = ?"]
    params: list = [user_id]
    if since_iso:
        where.append("created_at >= ?"); params.append(since_iso)
    sql_total = (
        "SELECT COUNT(*) AS total, "
        "SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed, "
        "SUM(CASE WHEN status IN ('failed','timeout') THEN 1 ELSE 0 END) AS failed, "
        "AVG(latency_ms) AS avg_latency_ms, "
        "SUM(COALESCE(cost_estimate, 0)) AS cost_total "
        "FROM tool_executions WHERE " + " AND ".join(where)
    )
    sql_by_tool = (
        "SELECT tool_id, COUNT(*) AS n, "
        "SUM(COALESCE(cost_estimate, 0)) AS cost "
        "FROM tool_executions WHERE " + " AND ".join(where)
        + " GROUP BY tool_id ORDER BY n DESC"
    )
    with _conn() as c:
        totals = c.execute(sql_total, params).fetchone()
        by_tool = c.execute(sql_by_tool, params).fetchall()
    return {
        "total":      int(totals["total"] or 0),
        "completed":  int(totals["completed"] or 0),
        "failed":     int(totals["failed"] or 0),
        "avg_latency_ms": (
            float(totals["avg_latency_ms"]) if totals["avg_latency_ms"] is not None else None
        ),
        "cost_total": float(totals["cost_total"] or 0.0),
        "by_tool": [
            {"tool_id": r["tool_id"], "n": int(r["n"]),
             "cost": float(r["cost"] or 0.0)}
            for r in by_tool
        ],
    }


__all__ = [
    "init", "insert", "mark_running", "mark_terminal",
    "get", "list_user", "usage_summary", "_reset_for_tests",
]
