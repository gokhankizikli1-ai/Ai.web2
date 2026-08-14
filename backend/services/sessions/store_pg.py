# coding: utf-8
"""Phase 3 (server-authoritative chat) — Postgres sessions backend.

The shared, cross-replica-durable production authority for server-side chat
state: workspaces → threads → messages. Mirrors the SQLite store's public
surface EXACTLY (same Workspace/Thread/Message shapes, same JSON-as-TEXT
metadata columns, same ISO-8601 UTC timestamps) so callers stay backend-
agnostic — the dispatcher in `client.py` picks this backend when
`ENABLE_POSTGRES_BACKEND` + `DATABASE_URL` are set (`engine.is_enabled()`),
else the SQLite store.

WHY POSTGRES FOR CHAT
---------------------
On a multi-replica deploy (Railway) a per-replica SQLite file forks chat
history — a user's conversation would depend on which replica served the
request. Chat history must be canonical and shared, so it goes on the same
Postgres substrate the jobs/billing/credits stores already use. localStorage
stays a cache; THIS is the source of truth.

Reuses `backend.services.db.engine.acquire_sync()` (the shared psycopg3 pool)
— no new DB framework. Schema is additive/idempotent (CREATE ... IF NOT
EXISTS). Placeholders are psycopg's `%s`; the SQLite store uses `?` — the only
dialect difference, isolated here.

CODE-VERIFIED for SQL contract + dispatch selection; not live-Postgres verified
in this environment (no PG instance). Mirrors the proven `jobs.store_pg`.
"""
from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

from backend.services.db import engine
from backend.services.sessions.types import (
    Workspace, Thread, Message,
    normalize_workspace_kind, normalize_thread_status, normalize_message_role,
)

logger = logging.getLogger(__name__)

# Kept for API parity with the SQLite store (client.stats reads store.DB_PATH);
# meaningless for Postgres, surfaced only as a label.
DB_PATH = "postgres"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions_workspaces (
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
CREATE INDEX IF NOT EXISTS ix_sw_user ON sessions_workspaces(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_sw_user_slug
    ON sessions_workspaces(user_id, slug)
    WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS sessions_threads (
    id            TEXT PRIMARY KEY,
    workspace_id  TEXT NOT NULL REFERENCES sessions_workspaces(id) ON DELETE CASCADE,
    title         TEXT NOT NULL DEFAULT 'New thread',
    mode          TEXT,
    status        TEXT NOT NULL DEFAULT 'active',
    summary       TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    archived_at   TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS ix_st_workspace ON sessions_threads(workspace_id);
CREATE INDEX IF NOT EXISTS ix_st_updated   ON sessions_threads(updated_at);

CREATE TABLE IF NOT EXISTS sessions_messages (
    id            TEXT PRIMARY KEY,
    thread_id     TEXT NOT NULL REFERENCES sessions_threads(id) ON DELETE CASCADE,
    role          TEXT NOT NULL,
    content       TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    tokens        INTEGER,
    model         TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS ix_sm_thread  ON sessions_messages(thread_id);
CREATE INDEX IF NOT EXISTS ix_sm_created ON sessions_messages(created_at);
"""

_INITIALIZED = False

_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    return uuid.uuid4().hex


def slugify(name: str, *, fallback: str = "workspace") -> str:
    s = (name or "").strip().lower()
    s = _SLUG_RE.sub("-", s).strip("-")
    return s[:48] or fallback


def _safe_json(s: Optional[str]) -> dict:
    if not s:
        return {}
    try:
        v = json.loads(s)
        return v if isinstance(v, dict) else {}
    except Exception:
        return {}


# ── Connection helpers (psycopg3 via the shared sync pool) ──────────────────

def _dict_row():
    from psycopg.rows import dict_row   # lazy — psycopg only on the PG path
    return dict_row


def _cursor(conn):
    try:
        return conn.cursor(row_factory=_dict_row())
    except Exception:
        return conn.cursor()


def _execute(sql: str, params: tuple = ()) -> None:
    with engine.acquire_sync() as conn:
        with _cursor(conn) as cur:
            cur.execute(sql, params)
        conn.commit()


def _fetchone(sql: str, params: tuple = ()) -> Optional[dict]:
    with engine.acquire_sync() as conn:
        with _cursor(conn) as cur:
            cur.execute(sql, params)
            return cur.fetchone()


def _fetchall(sql: str, params: tuple = ()) -> list:
    with engine.acquire_sync() as conn:
        with _cursor(conn) as cur:
            cur.execute(sql, params)
            return list(cur.fetchall() or [])


def init() -> None:
    global _INITIALIZED
    if _INITIALIZED:
        return
    with engine.acquire_sync() as conn:
        with _cursor(conn) as cur:
            cur.execute(_SCHEMA)
        conn.commit()
    _INITIALIZED = True
    logger.info("sessions.store_pg initialized (postgres)")


def _ensure_init() -> None:
    if not _INITIALIZED:
        init()


def _reset_for_tests() -> None:
    global _INITIALIZED
    _INITIALIZED = False


# ── Workspaces ──────────────────────────────────────────────────────────────

def create_workspace(user_id: str, *, name: str, kind: str = "personal",
                     slug: Optional[str] = None,
                     metadata: Optional[dict] = None) -> Workspace:
    _ensure_init()
    ws_id = _new_id()
    now = _now()
    s = slugify(slug or name)
    k = normalize_workspace_kind(kind)
    md = json.dumps(metadata or {})
    try:
        _execute(
            "INSERT INTO sessions_workspaces "
            "(id, user_id, name, slug, kind, created_at, updated_at, metadata_json) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
            (ws_id, str(user_id), name, s, k, now, now, md),
        )
    except Exception:
        # slug collision per user — append a short suffix (parity with SQLite).
        s = f"{s}-{ws_id[:6]}"
        _execute(
            "INSERT INTO sessions_workspaces "
            "(id, user_id, name, slug, kind, created_at, updated_at, metadata_json) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
            (ws_id, str(user_id), name, s, k, now, now, md),
        )
    return Workspace(id=ws_id, user_id=str(user_id), name=name, slug=s, kind=k,
                     created_at=now, updated_at=now, metadata=metadata or {})


def get_workspace(workspace_id: str) -> Optional[Workspace]:
    _ensure_init()
    row = _fetchone("SELECT * FROM sessions_workspaces WHERE id=%s", (workspace_id,))
    return _row_to_workspace(row) if row else None


def list_workspaces(user_id: str, *, include_archived: bool = False) -> list[Workspace]:
    _ensure_init()
    sql = "SELECT * FROM sessions_workspaces WHERE user_id=%s"
    if not include_archived:
        sql += " AND archived_at IS NULL"
    sql += " ORDER BY updated_at DESC"
    return [_row_to_workspace(r) for r in _fetchall(sql, (str(user_id),))]


def update_workspace(workspace_id: str, *, name: Optional[str] = None,
                     kind: Optional[str] = None) -> Optional[Workspace]:
    _ensure_init()
    sets: list[str] = []
    params: list = []
    if name is not None:
        sets.append("name=%s"); params.append(name)
    if kind is not None:
        sets.append("kind=%s"); params.append(normalize_workspace_kind(kind))
    if not sets:
        return get_workspace(workspace_id)
    sets.append("updated_at=%s"); params.append(_now())
    params.append(workspace_id)
    _execute(f"UPDATE sessions_workspaces SET {', '.join(sets)} WHERE id=%s", tuple(params))
    return get_workspace(workspace_id)


def archive_workspace(workspace_id: str) -> bool:
    _ensure_init()
    now = _now()
    row = _fetchone(
        "UPDATE sessions_workspaces SET archived_at=%s, updated_at=%s "
        "WHERE id=%s AND archived_at IS NULL RETURNING id",
        (now, now, workspace_id),
    )
    return row is not None


def ensure_default_workspace(user_id: str) -> Workspace:
    for w in list_workspaces(user_id, include_archived=False):
        if w.kind == "personal":
            return w
    return create_workspace(user_id, name="Personal", kind="personal", slug="personal")


def _row_to_workspace(row: dict) -> Workspace:
    return Workspace(
        id=row["id"], user_id=row["user_id"], name=row["name"], slug=row["slug"],
        kind=row["kind"], created_at=row["created_at"], updated_at=row["updated_at"],
        archived_at=row["archived_at"], metadata=_safe_json(row["metadata_json"]),
    )


# ── Threads ─────────────────────────────────────────────────────────────────

def create_thread(*, workspace_id: str, title: str = "New thread",
                  mode: Optional[str] = None,
                  metadata: Optional[dict] = None) -> Thread:
    _ensure_init()
    th_id = _new_id()
    now = _now()
    md = json.dumps(metadata or {})
    _execute(
        "INSERT INTO sessions_threads "
        "(id, workspace_id, title, mode, status, created_at, updated_at, metadata_json) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
        (th_id, workspace_id, title, mode, "active", now, now, md),
    )
    return Thread(id=th_id, workspace_id=workspace_id, title=title, mode=mode,
                  status="active", created_at=now, updated_at=now, metadata=metadata or {})


def get_thread(thread_id: str) -> Optional[Thread]:
    _ensure_init()
    row = _fetchone("SELECT * FROM sessions_threads WHERE id=%s", (thread_id,))
    return _row_to_thread(row) if row else None


def list_threads(workspace_id: str, *, include_archived: bool = False,
                 limit: int = 50) -> list[Thread]:
    _ensure_init()
    sql = "SELECT * FROM sessions_threads WHERE workspace_id=%s"
    if not include_archived:
        sql += " AND status != 'archived' AND archived_at IS NULL"
    sql += " ORDER BY updated_at DESC LIMIT %s"
    return [_row_to_thread(r) for r in _fetchall(sql, (workspace_id, int(limit)))]


def update_thread(thread_id: str, *, title: Optional[str] = None,
                  mode: Optional[str] = None, status: Optional[str] = None,
                  summary: Optional[str] = None) -> Optional[Thread]:
    _ensure_init()
    sets: list[str] = []
    params: list = []
    if title is not None:
        sets.append("title=%s"); params.append(title)
    if mode is not None:
        sets.append("mode=%s"); params.append(mode)
    if status is not None:
        sets.append("status=%s"); params.append(normalize_thread_status(status))
    if summary is not None:
        sets.append("summary=%s"); params.append(summary)
    if not sets:
        return get_thread(thread_id)
    sets.append("updated_at=%s"); params.append(_now())
    params.append(thread_id)
    _execute(f"UPDATE sessions_threads SET {', '.join(sets)} WHERE id=%s", tuple(params))
    return get_thread(thread_id)


def archive_thread(thread_id: str) -> bool:
    _ensure_init()
    now = _now()
    row = _fetchone(
        "UPDATE sessions_threads SET status='archived', archived_at=%s, updated_at=%s "
        "WHERE id=%s AND archived_at IS NULL RETURNING id",
        (now, now, thread_id),
    )
    return row is not None


def _row_to_thread(row: dict) -> Thread:
    return Thread(
        id=row["id"], workspace_id=row["workspace_id"], title=row["title"],
        mode=row["mode"], status=row["status"], summary=row["summary"],
        created_at=row["created_at"], updated_at=row["updated_at"],
        archived_at=row["archived_at"], metadata=_safe_json(row["metadata_json"]),
    )


# ── Messages ────────────────────────────────────────────────────────────────

def append_message(*, thread_id: str, role: str, content: str,
                   model: Optional[str] = None, tokens: Optional[int] = None,
                   metadata: Optional[dict] = None) -> Message:
    _ensure_init()
    m_id = _new_id()
    now = _now()
    md = json.dumps(metadata or {})
    r = normalize_message_role(role)
    _execute(
        "INSERT INTO sessions_messages "
        "(id, thread_id, role, content, created_at, tokens, model, metadata_json) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
        (m_id, thread_id, r, content, now, tokens, model, md),
    )
    # Bump the thread's updated_at so it floats to the top of the list.
    _execute("UPDATE sessions_threads SET updated_at=%s WHERE id=%s", (now, thread_id))
    return Message(id=m_id, thread_id=thread_id, role=r, content=content,
                   created_at=now, tokens=tokens, model=model, metadata=metadata or {})


def list_messages(thread_id: str, *, limit: int = 100,
                  after_id: Optional[str] = None) -> list[Message]:
    _ensure_init()
    sql = "SELECT * FROM sessions_messages WHERE thread_id=%s"
    params: list = [thread_id]
    if after_id:
        sql += (" AND created_at > "
                "(SELECT created_at FROM sessions_messages WHERE id=%s)")
        params.append(after_id)
    # (created_at, id) is a TOTAL order so pagination + reload are deterministic
    # even for two messages written in the same microsecond.
    sql += " ORDER BY created_at ASC, id ASC LIMIT %s"
    params.append(int(limit))
    return [_row_to_message(r) for r in _fetchall(sql, tuple(params))]


def get_message(message_id: str) -> Optional[Message]:
    _ensure_init()
    row = _fetchone("SELECT * FROM sessions_messages WHERE id=%s", (message_id,))
    return _row_to_message(row) if row else None


def delete_message(message_id: str) -> bool:
    _ensure_init()
    row = _fetchone("DELETE FROM sessions_messages WHERE id=%s RETURNING id", (message_id,))
    return row is not None


def _row_to_message(row: dict) -> Message:
    return Message(
        id=row["id"], thread_id=row["thread_id"], role=row["role"],
        content=row["content"], created_at=row["created_at"],
        tokens=row["tokens"], model=row["model"],
        metadata=_safe_json(row["metadata_json"]),
    )


# ── Observability ───────────────────────────────────────────────────────────

def store_stats() -> dict:
    return {"backend": "postgres"}


def table_counts() -> dict:
    out = {"workspaces": 0, "threads": 0, "messages": 0}
    table_for = {
        "workspaces": "sessions_workspaces",
        "threads": "sessions_threads",
        "messages": "sessions_messages",
    }
    try:
        _ensure_init()
        for key, table in table_for.items():
            row = _fetchone(f"SELECT COUNT(*) AS n FROM {table}")
            out[key] = int(row["n"]) if row else 0
    except Exception:
        pass
    return out


__all__ = [
    "DB_PATH", "init", "_reset_for_tests", "slugify",
    "create_workspace", "get_workspace", "list_workspaces", "update_workspace",
    "archive_workspace", "ensure_default_workspace",
    "create_thread", "get_thread", "list_threads", "update_thread", "archive_thread",
    "append_message", "list_messages", "get_message", "delete_message",
    "store_stats", "table_counts",
]
