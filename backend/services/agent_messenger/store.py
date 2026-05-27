# coding: utf-8
"""Phase 9 — Agent message SQLite store (agent_messages.db).

Append-only log of typed envelopes — agents never update / delete a
prior message. Threading happens via `in_reply_to`.
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

from backend.services.agent_messenger.types import (
    AgentMessage, normalize_message_type,
)


logger = logging.getLogger(__name__)


def _db_path() -> str:
    return os.getenv("AGENT_MESSAGES_DB_PATH", "agent_messages.db")


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
CREATE TABLE IF NOT EXISTS agent_messages (
    id            TEXT PRIMARY KEY,
    panel_id      TEXT NOT NULL,
    user_id       TEXT NOT NULL,
    from_agent    TEXT NOT NULL,
    to_agent      TEXT NOT NULL,
    message_type  TEXT NOT NULL DEFAULT 'request',
    content       TEXT NOT NULL DEFAULT '',
    in_reply_to   TEXT,
    payload_json  TEXT NOT NULL DEFAULT '{}',
    created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_agent_messages_panel
    ON agent_messages(panel_id, created_at);
CREATE INDEX IF NOT EXISTS ix_agent_messages_user
    ON agent_messages(user_id, created_at);
CREATE INDEX IF NOT EXISTS ix_agent_messages_reply
    ON agent_messages(in_reply_to);
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
            logger.info("agent_messenger.store initialized | db=%s", _db_path())
        except Exception as e:
            logger.warning("agent_messenger.store.init failed: %s", e)


def _reset_for_tests() -> None:
    global _INITIALIZED
    with _LOCK:
        _INITIALIZED = False


def _ensure_init() -> None:
    if not _INITIALIZED:
        init()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row(r: sqlite3.Row) -> AgentMessage:
    try:
        payload = json.loads(r["payload_json"] or "{}")
    except Exception:
        payload = {}
    if not isinstance(payload, dict):
        payload = {}
    return AgentMessage(
        id=           r["id"],
        panel_id=     r["panel_id"],
        user_id=      r["user_id"],
        from_agent=   r["from_agent"],
        to_agent=     r["to_agent"],
        message_type= r["message_type"],
        content=      r["content"],
        in_reply_to=  r["in_reply_to"],
        payload=      payload,
        created_at=   r["created_at"],
    )


def insert(msg: AgentMessage) -> AgentMessage:
    _ensure_init()
    new_id = msg.id or uuid.uuid4().hex
    ts = msg.created_at or _now_iso()
    mtype = normalize_message_type(msg.message_type)
    with _conn() as c:
        c.execute(
            """
            INSERT INTO agent_messages (
                id, panel_id, user_id, from_agent, to_agent,
                message_type, content, in_reply_to, payload_json,
                created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                new_id, msg.panel_id, msg.user_id, msg.from_agent,
                msg.to_agent, mtype, msg.content or "",
                msg.in_reply_to, json.dumps(msg.payload or {}),
                ts,
            ),
        )
    msg.id = new_id
    msg.created_at = ts
    msg.message_type = mtype
    return msg


def list_panel(
    *, panel_id: str, user_id: str,
    limit: int = 100, offset: int = 0,
    newest_first: bool = False,
) -> list[AgentMessage]:
    """Read messages for one panel. Ownership-checked via user_id.

    Default ordering is OLDEST first — message threads read naturally
    top-to-bottom. Caller can flip for "show me the last 10".
    """
    _ensure_init()
    order = "DESC" if newest_first else "ASC"
    sql = (
        f"SELECT * FROM agent_messages WHERE panel_id = ? AND user_id = ? "
        f"ORDER BY created_at {order} LIMIT ? OFFSET ?"
    )
    params = [panel_id, user_id,
              max(1, min(int(limit), 500)), max(0, int(offset))]
    with _conn() as c:
        rows = c.execute(sql, params).fetchall()
    return [_row(r) for r in rows]


__all__ = ["init", "insert", "list_panel", "_reset_for_tests"]
