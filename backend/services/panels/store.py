# coding: utf-8
"""Phase 9 — Panel SQLite store (panels.db).

Same WAL pattern as scratchpad/store.py and agent_tasks/store.py. The
DB path is overridable via PANELS_DB_PATH so tests can use a tmp file.
"""
from __future__ import annotations

import json
import logging
import os
import sqlite3
from backend.core.paths import resolve_db_path
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Iterator, Optional

from backend.services.panels.types import (
    PanelRecord, normalize_status,
    STATUS_ACTIVE, TERMINAL_PANEL_STATUSES,
)


logger = logging.getLogger(__name__)


def _db_path() -> str:
    return resolve_db_path("panels.db", "PANELS_DB_PATH")


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
CREATE TABLE IF NOT EXISTS panels (
    id                  TEXT PRIMARY KEY,
    user_id             TEXT NOT NULL,
    title               TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'active',
    project_id          TEXT,
    parent_panel_id     TEXT,
    chat_id             TEXT,
    coordinator_intent  TEXT,
    metadata_json       TEXT NOT NULL DEFAULT '{}',
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_panels_user_project
    ON panels(user_id, project_id);
CREATE INDEX IF NOT EXISTS ix_panels_user_status
    ON panels(user_id, status);
CREATE INDEX IF NOT EXISTS ix_panels_parent
    ON panels(parent_panel_id);
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
            logger.info("panels.store initialized | db=%s", _db_path())
        except Exception as e:
            logger.warning("panels.store.init failed: %s", e)


def _reset_for_tests() -> None:
    global _INITIALIZED
    with _LOCK:
        _INITIALIZED = False


def _ensure_init() -> None:
    if not _INITIALIZED:
        init()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_record(r: sqlite3.Row) -> PanelRecord:
    try:
        meta = json.loads(r["metadata_json"] or "{}")
    except Exception:
        meta = {}
    if not isinstance(meta, dict):
        meta = {}
    return PanelRecord(
        id=                 r["id"],
        user_id=            r["user_id"],
        title=              r["title"],
        status=             r["status"],
        project_id=         r["project_id"],
        parent_panel_id=    r["parent_panel_id"],
        chat_id=            r["chat_id"],
        coordinator_intent= r["coordinator_intent"],
        metadata=           meta,
        created_at=         r["created_at"],
        updated_at=         r["updated_at"],
    )


# ── CRUD ───────────────────────────────────────────────────────────────────

def insert(record: PanelRecord) -> PanelRecord:
    _ensure_init()
    new_id = record.id or uuid.uuid4().hex
    ts = _now_iso()
    status = normalize_status(record.status)
    with _conn() as c:
        c.execute(
            """
            INSERT INTO panels (
                id, user_id, title, status, project_id, parent_panel_id,
                chat_id, coordinator_intent, metadata_json,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                new_id, record.user_id, record.title, status,
                record.project_id, record.parent_panel_id,
                record.chat_id, record.coordinator_intent,
                json.dumps(record.metadata or {}),
                ts, ts,
            ),
        )
    record.id = new_id
    record.status = status
    record.created_at = ts
    record.updated_at = ts
    return record


def get(panel_id: str, *, user_id: str) -> Optional[PanelRecord]:
    """Ownership-checked single fetch."""
    _ensure_init()
    with _conn() as c:
        r = c.execute(
            "SELECT * FROM panels WHERE id = ? AND user_id = ?",
            (panel_id, user_id),
        ).fetchone()
    return _row_to_record(r) if r else None


def list_user(
    *, user_id: str,
    project_id: Optional[str] = None,
    status:     Optional[str] = None,
    limit:      int = 50,
    offset:     int = 0,
) -> list[PanelRecord]:
    _ensure_init()
    where = ["user_id = ?"]
    params: list = [user_id]
    if project_id:
        where.append("project_id = ?")
        params.append(project_id)
    if status:
        where.append("status = ?")
        params.append(normalize_status(status))
    sql = (
        "SELECT * FROM panels WHERE "
        + " AND ".join(where)
        + " ORDER BY updated_at DESC LIMIT ? OFFSET ?"
    )
    params.extend([max(1, min(int(limit), 200)), max(0, int(offset))])
    with _conn() as c:
        rows = c.execute(sql, params).fetchall()
    return [_row_to_record(r) for r in rows]


def mark_status(
    panel_id: str, *, user_id: str, status: str,
) -> Optional[PanelRecord]:
    """Update status. Terminal → terminal transitions are refused (a
    completed panel cannot move back to active; that would mask a
    coordinator bug)."""
    _ensure_init()
    new_status = normalize_status(status)
    ts = _now_iso()
    with _conn() as c:
        # Refuse to bring a terminal panel back to active/paused.
        current = c.execute(
            "SELECT status FROM panels WHERE id = ? AND user_id = ?",
            (panel_id, user_id),
        ).fetchone()
        if current is None:
            return None
        cur_status = current["status"]
        if cur_status in TERMINAL_PANEL_STATUSES and new_status not in TERMINAL_PANEL_STATUSES:
            logger.warning(
                "panels.mark_status refused %s→%s for %s (terminal lock)",
                cur_status, new_status, panel_id,
            )
            return get(panel_id, user_id=user_id)
        c.execute(
            "UPDATE panels SET status = ?, updated_at = ? WHERE id = ? AND user_id = ?",
            (new_status, ts, panel_id, user_id),
        )
    return get(panel_id, user_id=user_id)


__all__ = [
    "init", "insert", "get", "list_user", "mark_status",
    "_reset_for_tests",
]
