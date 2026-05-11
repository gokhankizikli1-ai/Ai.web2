# coding: utf-8
# Phase M2 — Sessions store (SQLite).
#
# A NEW SQLite file (default `sessions.db`, override via SESSIONS_DB_PATH).
# Kept separate from `memory.db` so M2 has a clean rollback (delete the file)
# and doesn't risk corrupting the legacy memory tables. M3 will unify schemas.
#
# Schema:
#   workspaces   per-user containers
#   threads      per-workspace conversations
#   messages     per-thread message log
#
# Each table uses TEXT primary keys (UUID4) and ISO-8601 UTC timestamps so
# the schema is portable to Postgres later (M3+) with no type re-mapping.
import os
import sqlite3
import logging
import threading
import uuid
import json
import re
from contextlib import contextmanager
from datetime import datetime
from typing import Optional, Iterator

from backend.services.sessions.types import (
    Workspace, Thread, Message,
    normalize_workspace_kind, normalize_thread_status, normalize_message_role,
)

logger = logging.getLogger(__name__)

DB_PATH = os.getenv("SESSIONS_DB_PATH", "sessions.db")

_LOCK   = threading.Lock()
_COUNTS = {
    "workspaces_created": 0,
    "workspaces_listed":  0,
    "threads_created":    0,
    "threads_listed":     0,
    "messages_appended":  0,
    "messages_listed":    0,
    "errors":             0,
    "last_error":         "",
}


def _bump(field_: str, error: str = "") -> None:
    with _LOCK:
        _COUNTS[field_] = _COUNTS.get(field_, 0) + 1
        if error:
            _COUNTS["errors"]     = _COUNTS.get("errors", 0) + 1
            _COUNTS["last_error"] = error[:140]


def store_stats() -> dict:
    with _LOCK:
        return dict(_COUNTS)


def _now() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _new_id() -> str:
    return uuid.uuid4().hex


_SLUG_RE = re.compile(r"[^a-z0-9]+")


def slugify(name: str, *, fallback: str = "workspace") -> str:
    s = (name or "").strip().lower()
    s = _SLUG_RE.sub("-", s).strip("-")
    return s[:48] or fallback


# ══════════════════════════════════════════════════════════════════════════
# Connection management

@contextmanager
def _conn() -> Iterator[sqlite3.Connection]:
    """One connection per call. SQLite is process-safe with serialized writes."""
    c = sqlite3.connect(DB_PATH, timeout=10)
    try:
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA foreign_keys = ON")
        yield c
        c.commit()
    finally:
        c.close()


# ══════════════════════════════════════════════════════════════════════════
# Schema

_SCHEMA = """
CREATE TABLE IF NOT EXISTS workspaces (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    name          TEXT NOT NULL,
    slug          TEXT NOT NULL,
    kind          TEXT NOT NULL DEFAULT 'personal',
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    archived_at   TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS ix_workspaces_user_id        ON workspaces(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_workspaces_user_slug
    ON workspaces(user_id, slug)
    WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS threads (
    id            TEXT PRIMARY KEY,
    workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    title         TEXT NOT NULL DEFAULT 'New thread',
    mode          TEXT,
    status        TEXT NOT NULL DEFAULT 'active',
    summary       TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    archived_at   TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS ix_threads_workspace_id ON threads(workspace_id);
CREATE INDEX IF NOT EXISTS ix_threads_updated_at    ON threads(updated_at);

CREATE TABLE IF NOT EXISTS messages (
    id            TEXT PRIMARY KEY,
    thread_id     TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    role          TEXT NOT NULL,
    content       TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    tokens        INTEGER,
    model         TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS ix_messages_thread_id  ON messages(thread_id);
CREATE INDEX IF NOT EXISTS ix_messages_created_at ON messages(created_at);
"""


def init() -> None:
    """Create tables if missing. Idempotent; safe to call repeatedly."""
    try:
        with _conn() as c:
            c.executescript(_SCHEMA)
    except Exception as e:
        logger.warning("sessions.store.init failed: %s", e)
        _bump("init_failed", str(e))


# ══════════════════════════════════════════════════════════════════════════
# Workspaces

def create_workspace(
    user_id: str,
    *,
    name: str,
    kind: str = "personal",
    slug: Optional[str] = None,
    metadata: Optional[dict] = None,
) -> Workspace:
    ws_id = _new_id()
    now   = _now()
    s     = slugify(slug or name)
    k     = normalize_workspace_kind(kind)
    md    = json.dumps(metadata or {})
    try:
        with _conn() as c:
            try:
                c.execute(
                    "INSERT INTO workspaces (id, user_id, name, slug, kind, created_at, updated_at, metadata_json) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (ws_id, str(user_id), name, s, k, now, now, md),
                )
            except sqlite3.IntegrityError:
                # slug collision per user — append a short suffix
                s = f"{s}-{ws_id[:6]}"
                c.execute(
                    "INSERT INTO workspaces (id, user_id, name, slug, kind, created_at, updated_at, metadata_json) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (ws_id, str(user_id), name, s, k, now, now, md),
                )
        _bump("workspaces_created")
        return Workspace(
            id=ws_id, user_id=str(user_id), name=name, slug=s, kind=k,
            created_at=now, updated_at=now, metadata=metadata or {},
        )
    except Exception as e:
        logger.warning("sessions.store.create_workspace user=%s error: %s", user_id, e)
        _bump("workspaces_created", str(e))
        raise


def get_workspace(workspace_id: str) -> Optional[Workspace]:
    try:
        with _conn() as c:
            row = c.execute(
                "SELECT * FROM workspaces WHERE id=?", (workspace_id,),
            ).fetchone()
        return _row_to_workspace(row) if row else None
    except Exception as e:
        logger.warning("sessions.store.get_workspace id=%s error: %s", workspace_id, e)
        _bump("workspaces_listed", str(e))
        return None


def list_workspaces(
    user_id: str,
    *,
    include_archived: bool = False,
) -> list[Workspace]:
    sql = "SELECT * FROM workspaces WHERE user_id=?"
    if not include_archived:
        sql += " AND archived_at IS NULL"
    sql += " ORDER BY updated_at DESC"
    try:
        with _conn() as c:
            rows = c.execute(sql, (str(user_id),)).fetchall()
        _bump("workspaces_listed")
        return [_row_to_workspace(r) for r in rows]
    except Exception as e:
        logger.warning("sessions.store.list_workspaces user=%s error: %s", user_id, e)
        _bump("workspaces_listed", str(e))
        return []


def update_workspace(
    workspace_id: str,
    *,
    name: Optional[str] = None,
    kind: Optional[str] = None,
) -> Optional[Workspace]:
    sets: list[str] = []
    params: list = []
    if name is not None:
        sets.append("name=?"); params.append(name)
    if kind is not None:
        sets.append("kind=?"); params.append(normalize_workspace_kind(kind))
    if not sets:
        return get_workspace(workspace_id)
    sets.append("updated_at=?"); params.append(_now())
    params.append(workspace_id)
    try:
        with _conn() as c:
            c.execute(f"UPDATE workspaces SET {', '.join(sets)} WHERE id=?", params)
        return get_workspace(workspace_id)
    except Exception as e:
        logger.warning("sessions.store.update_workspace id=%s error: %s", workspace_id, e)
        _bump("workspaces_listed", str(e))
        return None


def archive_workspace(workspace_id: str) -> bool:
    try:
        with _conn() as c:
            cur = c.execute(
                "UPDATE workspaces SET archived_at=?, updated_at=? WHERE id=? AND archived_at IS NULL",
                (_now(), _now(), workspace_id),
            )
            return cur.rowcount > 0
    except Exception as e:
        logger.warning("sessions.store.archive_workspace id=%s error: %s", workspace_id, e)
        _bump("workspaces_listed", str(e))
        return False


def ensure_default_workspace(user_id: str) -> Workspace:
    """Get-or-create the user's `personal` workspace. Idempotent."""
    existing = list_workspaces(user_id, include_archived=False)
    for w in existing:
        if w.kind == "personal":
            return w
    return create_workspace(user_id, name="Personal", kind="personal", slug="personal")


def _row_to_workspace(row: sqlite3.Row) -> Workspace:
    return Workspace(
        id=row["id"],
        user_id=row["user_id"],
        name=row["name"],
        slug=row["slug"],
        kind=row["kind"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        archived_at=row["archived_at"],
        metadata=_safe_json(row["metadata_json"]),
    )


# ══════════════════════════════════════════════════════════════════════════
# Threads

def create_thread(
    *,
    workspace_id: str,
    title: str = "New thread",
    mode: Optional[str] = None,
    metadata: Optional[dict] = None,
) -> Thread:
    th_id = _new_id()
    now   = _now()
    md    = json.dumps(metadata or {})
    try:
        with _conn() as c:
            c.execute(
                "INSERT INTO threads (id, workspace_id, title, mode, status, created_at, updated_at, metadata_json) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (th_id, workspace_id, title, mode, "active", now, now, md),
            )
        _bump("threads_created")
        return Thread(
            id=th_id, workspace_id=workspace_id, title=title, mode=mode,
            status="active", created_at=now, updated_at=now, metadata=metadata or {},
        )
    except Exception as e:
        logger.warning("sessions.store.create_thread ws=%s error: %s", workspace_id, e)
        _bump("threads_created", str(e))
        raise


def get_thread(thread_id: str) -> Optional[Thread]:
    try:
        with _conn() as c:
            row = c.execute("SELECT * FROM threads WHERE id=?", (thread_id,)).fetchone()
        return _row_to_thread(row) if row else None
    except Exception as e:
        logger.warning("sessions.store.get_thread id=%s error: %s", thread_id, e)
        _bump("threads_listed", str(e))
        return None


def list_threads(
    workspace_id: str,
    *,
    include_archived: bool = False,
    limit: int = 50,
) -> list[Thread]:
    sql = "SELECT * FROM threads WHERE workspace_id=?"
    if not include_archived:
        sql += " AND status != 'archived' AND archived_at IS NULL"
    sql += " ORDER BY updated_at DESC LIMIT ?"
    try:
        with _conn() as c:
            rows = c.execute(sql, (workspace_id, int(limit))).fetchall()
        _bump("threads_listed")
        return [_row_to_thread(r) for r in rows]
    except Exception as e:
        logger.warning("sessions.store.list_threads ws=%s error: %s", workspace_id, e)
        _bump("threads_listed", str(e))
        return []


def update_thread(
    thread_id: str,
    *,
    title: Optional[str] = None,
    mode: Optional[str] = None,
    status: Optional[str] = None,
    summary: Optional[str] = None,
) -> Optional[Thread]:
    sets: list[str] = []
    params: list = []
    if title is not None:
        sets.append("title=?"); params.append(title)
    if mode is not None:
        sets.append("mode=?"); params.append(mode)
    if status is not None:
        sets.append("status=?"); params.append(normalize_thread_status(status))
    if summary is not None:
        sets.append("summary=?"); params.append(summary)
    if not sets:
        return get_thread(thread_id)
    sets.append("updated_at=?"); params.append(_now())
    params.append(thread_id)
    try:
        with _conn() as c:
            c.execute(f"UPDATE threads SET {', '.join(sets)} WHERE id=?", params)
        return get_thread(thread_id)
    except Exception as e:
        logger.warning("sessions.store.update_thread id=%s error: %s", thread_id, e)
        _bump("threads_listed", str(e))
        return None


def archive_thread(thread_id: str) -> bool:
    try:
        with _conn() as c:
            cur = c.execute(
                "UPDATE threads SET status='archived', archived_at=?, updated_at=? WHERE id=? AND archived_at IS NULL",
                (_now(), _now(), thread_id),
            )
            return cur.rowcount > 0
    except Exception as e:
        logger.warning("sessions.store.archive_thread id=%s error: %s", thread_id, e)
        _bump("threads_listed", str(e))
        return False


def _row_to_thread(row: sqlite3.Row) -> Thread:
    return Thread(
        id=row["id"],
        workspace_id=row["workspace_id"],
        title=row["title"],
        mode=row["mode"],
        status=row["status"],
        summary=row["summary"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        archived_at=row["archived_at"],
        metadata=_safe_json(row["metadata_json"]),
    )


# ══════════════════════════════════════════════════════════════════════════
# Messages

def append_message(
    *,
    thread_id: str,
    role: str,
    content: str,
    model: Optional[str] = None,
    tokens: Optional[int] = None,
    metadata: Optional[dict] = None,
) -> Message:
    m_id = _new_id()
    now  = _now()
    md   = json.dumps(metadata or {})
    r    = normalize_message_role(role)
    try:
        with _conn() as c:
            c.execute(
                "INSERT INTO messages (id, thread_id, role, content, created_at, tokens, model, metadata_json) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (m_id, thread_id, r, content, now, tokens, model, md),
            )
            # Bump thread updated_at so the thread floats to the top of the list.
            c.execute(
                "UPDATE threads SET updated_at=? WHERE id=?",
                (now, thread_id),
            )
        _bump("messages_appended")
        return Message(
            id=m_id, thread_id=thread_id, role=r, content=content,
            created_at=now, tokens=tokens, model=model, metadata=metadata or {},
        )
    except Exception as e:
        logger.warning("sessions.store.append_message thread=%s error: %s", thread_id, e)
        _bump("messages_appended", str(e))
        raise


def list_messages(
    thread_id: str,
    *,
    limit: int = 100,
    after_id: Optional[str] = None,
) -> list[Message]:
    sql = "SELECT * FROM messages WHERE thread_id=?"
    params: list = [thread_id]
    if after_id:
        sql += " AND created_at > (SELECT created_at FROM messages WHERE id=?)"
        params.append(after_id)
    sql += " ORDER BY created_at ASC LIMIT ?"
    params.append(int(limit))
    try:
        with _conn() as c:
            rows = c.execute(sql, params).fetchall()
        _bump("messages_listed")
        return [_row_to_message(r) for r in rows]
    except Exception as e:
        logger.warning("sessions.store.list_messages thread=%s error: %s", thread_id, e)
        _bump("messages_listed", str(e))
        return []


def get_message(message_id: str) -> Optional[Message]:
    try:
        with _conn() as c:
            row = c.execute("SELECT * FROM messages WHERE id=?", (message_id,)).fetchone()
        return _row_to_message(row) if row else None
    except Exception as e:
        logger.warning("sessions.store.get_message id=%s error: %s", message_id, e)
        return None


def delete_message(message_id: str) -> bool:
    try:
        with _conn() as c:
            cur = c.execute("DELETE FROM messages WHERE id=?", (message_id,))
            return cur.rowcount > 0
    except Exception as e:
        logger.warning("sessions.store.delete_message id=%s error: %s", message_id, e)
        return False


def _row_to_message(row: sqlite3.Row) -> Message:
    return Message(
        id=row["id"],
        thread_id=row["thread_id"],
        role=row["role"],
        content=row["content"],
        created_at=row["created_at"],
        tokens=row["tokens"],
        model=row["model"],
        metadata=_safe_json(row["metadata_json"]),
    )


# ══════════════════════════════════════════════════════════════════════════
# Internal

def _safe_json(s: Optional[str]) -> dict:
    if not s:
        return {}
    try:
        v = json.loads(s)
        return v if isinstance(v, dict) else {}
    except Exception:
        return {}


def table_counts() -> dict:
    """For /tools/health observability. Returns 0 if tables don't exist."""
    out = {"workspaces": 0, "threads": 0, "messages": 0}
    try:
        with _conn() as c:
            for t in out.keys():
                row = c.execute(f"SELECT COUNT(*) AS n FROM {t}").fetchone()
                out[t] = int(row["n"]) if row else 0
    except Exception:
        pass
    return out
