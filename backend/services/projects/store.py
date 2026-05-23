# coding: utf-8
# Phase 2 — Projects store (SQLite).
#
# Schema (TEXT PKs + ISO-8601 UTC timestamps so a future Postgres
# migration is byte-identical re-mapping):
#
#   projects          per-user containers
#   project_threads   binds existing sessions.threads rows to a project
#                     (soft FK on thread_id — projects works whether or
#                     not the sessions module is enabled)
#   project_agents    per-project agent definitions
#   project_memory    per-project shared context for system-prompt injection
#   project_files     placeholder schema for future file storage backend
import os
import sqlite3
import logging
import threading
import uuid
import json
from contextlib import contextmanager
from datetime import datetime
from typing import Optional, Iterator, List

from backend.services.projects.types import (
    Project, ProjectAgent, ProjectMemoryEntry, ProjectThreadLink, ProjectFile,
    normalize_status, normalize_memory_kind, normalize_memory_source,
)

logger = logging.getLogger(__name__)

DB_PATH = os.getenv("PROJECTS_DB_PATH", "projects.db")

_LOCK = threading.Lock()
_COUNTS = {
    "projects_created":   0,
    "projects_listed":    0,
    "projects_updated":   0,
    "projects_deleted":   0,
    "memory_added":       0,
    "memory_listed":      0,
    "agents_created":     0,
    "agents_listed":      0,
    "threads_attached":   0,
    "files_registered":   0,
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


def _load_json(raw: Optional[str]) -> dict:
    if not raw:
        return {}
    try:
        v = json.loads(raw)
        return v if isinstance(v, dict) else {}
    except Exception:
        return {}


def _dump_json(value: Optional[dict]) -> str:
    if not value:
        return "{}"
    try:
        return json.dumps(value, ensure_ascii=False)
    except Exception:
        return "{}"


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
CREATE TABLE IF NOT EXISTS projects (
    id              TEXT PRIMARY KEY,
    owner_user_id   TEXT NOT NULL,
    name            TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'active',
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    archived_at     TEXT,
    metadata_json   TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS ix_projects_owner  ON projects(owner_user_id);
CREATE INDEX IF NOT EXISTS ix_projects_status ON projects(owner_user_id, status);

CREATE TABLE IF NOT EXISTS project_threads (
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    thread_id   TEXT NOT NULL,
    added_at    TEXT NOT NULL,
    PRIMARY KEY (project_id, thread_id)
);
CREATE INDEX IF NOT EXISTS ix_project_threads_thread ON project_threads(thread_id);

CREATE TABLE IF NOT EXISTS project_agents (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    role            TEXT NOT NULL DEFAULT '',
    system_prompt   TEXT NOT NULL DEFAULT '',
    model_hint      TEXT NOT NULL DEFAULT '',
    color           TEXT NOT NULL DEFAULT '',
    icon            TEXT NOT NULL DEFAULT '',
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    metadata_json   TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS ix_project_agents_project ON project_agents(project_id);

CREATE TABLE IF NOT EXISTS project_memory (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kind            TEXT NOT NULL DEFAULT 'note',
    content         TEXT NOT NULL,
    source          TEXT NOT NULL DEFAULT 'user',
    created_at      TEXT NOT NULL,
    metadata_json   TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS ix_project_memory_project ON project_memory(project_id);
CREATE INDEX IF NOT EXISTS ix_project_memory_recent  ON project_memory(project_id, created_at);

CREATE TABLE IF NOT EXISTS project_files (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    path            TEXT NOT NULL,
    sha256          TEXT NOT NULL DEFAULT '',
    size_bytes      INTEGER NOT NULL DEFAULT 0,
    mime            TEXT NOT NULL DEFAULT '',
    storage_url     TEXT NOT NULL DEFAULT '',
    created_at      TEXT NOT NULL,
    metadata_json   TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS ix_project_files_project ON project_files(project_id);
"""


def init() -> None:
    """Create tables if missing. Idempotent; safe to call repeatedly."""
    try:
        with _conn() as c:
            c.executescript(_SCHEMA)
    except Exception as e:
        logger.warning("projects.store.init failed: %s", e)
        _bump("errors", str(e))


# ══════════════════════════════════════════════════════════════════════════
# Projects CRUD

def create_project(
    owner_user_id: str,
    *,
    name: str,
    description: str = "",
    metadata: Optional[dict] = None,
    project_id: Optional[str] = None,
) -> Project:
    """Insert a new project for the given user.

    `project_id` may be supplied so a client-generated id (e.g. the
    one already used in localStorage) can be preserved through the
    backfill migration. Falls back to a fresh UUID otherwise.
    """
    pid = (project_id or "").strip() or _new_id()
    now = _now()
    try:
        with _conn() as c:
            c.execute(
                """INSERT INTO projects
                   (id, owner_user_id, name, description, status,
                    created_at, updated_at, archived_at, metadata_json)
                   VALUES (?, ?, ?, ?, 'active', ?, ?, NULL, ?)""",
                (
                    pid, str(owner_user_id), name.strip() or "Untitled project",
                    (description or "").strip(),
                    now, now,
                    _dump_json(metadata),
                ),
            )
        _bump("projects_created")
    except sqlite3.IntegrityError as e:
        # Most likely a duplicate id — return the existing row.
        _bump("errors", f"create_project conflict: {e}")
        existing = get_project(pid)
        if existing:
            return existing
        raise
    return Project(
        id=pid, owner_user_id=str(owner_user_id),
        name=name.strip() or "Untitled project",
        description=(description or "").strip(),
        status="active", created_at=now, updated_at=now,
        archived_at=None, metadata=dict(metadata or {}),
    )


def get_project(project_id: str) -> Optional[Project]:
    with _conn() as c:
        row = c.execute(
            "SELECT * FROM projects WHERE id = ?", (project_id,),
        ).fetchone()
    return _row_to_project(row) if row else None


def list_projects(owner_user_id: str, *, include_archived: bool = False) -> List[Project]:
    query = "SELECT * FROM projects WHERE owner_user_id = ?"
    params: tuple = (str(owner_user_id),)
    if not include_archived:
        query += " AND status = 'active'"
    query += " ORDER BY updated_at DESC"
    with _conn() as c:
        rows = c.execute(query, params).fetchall()
    _bump("projects_listed")
    return [_row_to_project(r) for r in rows]


def update_project(
    project_id: str,
    *,
    name: Optional[str] = None,
    description: Optional[str] = None,
    status: Optional[str] = None,
    metadata: Optional[dict] = None,
) -> Optional[Project]:
    existing = get_project(project_id)
    if not existing:
        return None
    new_name = (name.strip() if name is not None else existing.name) or existing.name
    new_desc = description.strip() if description is not None else existing.description
    new_status = normalize_status(status, default=existing.status)
    new_meta = {**existing.metadata, **(metadata or {})}
    now = _now()
    archived_at = existing.archived_at
    if new_status == "archived" and existing.status != "archived":
        archived_at = now
    if new_status == "active":
        archived_at = None
    with _conn() as c:
        c.execute(
            """UPDATE projects
               SET name = ?, description = ?, status = ?, updated_at = ?,
                   archived_at = ?, metadata_json = ?
               WHERE id = ?""",
            (new_name, new_desc, new_status, now, archived_at,
             _dump_json(new_meta), project_id),
        )
    _bump("projects_updated")
    return Project(
        id=project_id, owner_user_id=existing.owner_user_id,
        name=new_name, description=new_desc, status=new_status,
        created_at=existing.created_at, updated_at=now,
        archived_at=archived_at, metadata=new_meta,
    )


def delete_project(project_id: str) -> bool:
    """Hard delete — cascades to memory/agents/threads/files via FK."""
    with _conn() as c:
        cur = c.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        deleted = cur.rowcount > 0
    if deleted:
        _bump("projects_deleted")
    return deleted


def _row_to_project(row: sqlite3.Row) -> Project:
    return Project(
        id=row["id"],
        owner_user_id=row["owner_user_id"],
        name=row["name"],
        description=row["description"],
        status=row["status"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        archived_at=row["archived_at"],
        metadata=_load_json(row["metadata_json"]),
    )


# ══════════════════════════════════════════════════════════════════════════
# Project memory

def add_memory(
    project_id: str,
    *,
    content: str,
    kind: str = "note",
    source: str = "user",
    metadata: Optional[dict] = None,
) -> Optional[ProjectMemoryEntry]:
    content = (content or "").strip()
    if not content:
        return None
    if not get_project(project_id):
        return None
    mid = _new_id()
    now = _now()
    with _conn() as c:
        c.execute(
            """INSERT INTO project_memory
               (id, project_id, kind, content, source, created_at, metadata_json)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                mid, project_id,
                normalize_memory_kind(kind),
                content,
                normalize_memory_source(source),
                now,
                _dump_json(metadata),
            ),
        )
        # Touch the project so list_projects ordering reflects activity.
        c.execute("UPDATE projects SET updated_at = ? WHERE id = ?", (now, project_id))
    _bump("memory_added")
    return ProjectMemoryEntry(
        id=mid, project_id=project_id,
        kind=normalize_memory_kind(kind),
        content=content,
        source=normalize_memory_source(source),
        created_at=now, metadata=dict(metadata or {}),
    )


def list_memory(
    project_id: str,
    *,
    kind: Optional[str] = None,
    limit: int = 50,
    newest_first: bool = True,
) -> List[ProjectMemoryEntry]:
    limit = max(1, min(int(limit or 50), 500))
    query = "SELECT * FROM project_memory WHERE project_id = ?"
    params: tuple = (project_id,)
    if kind:
        query += " AND kind = ?"
        params = (*params, normalize_memory_kind(kind))
    query += f" ORDER BY created_at {'DESC' if newest_first else 'ASC'} LIMIT ?"
    params = (*params, limit)
    with _conn() as c:
        rows = c.execute(query, params).fetchall()
    _bump("memory_listed")
    return [_row_to_memory(r) for r in rows]


def delete_memory(memory_id: str, project_id: Optional[str] = None) -> bool:
    with _conn() as c:
        if project_id is not None:
            cur = c.execute(
                "DELETE FROM project_memory WHERE id = ? AND project_id = ?",
                (memory_id, project_id),
            )
        else:
            cur = c.execute("DELETE FROM project_memory WHERE id = ?", (memory_id,))
        return cur.rowcount > 0


def _row_to_memory(row: sqlite3.Row) -> ProjectMemoryEntry:
    return ProjectMemoryEntry(
        id=row["id"],
        project_id=row["project_id"],
        kind=row["kind"],
        content=row["content"],
        source=row["source"],
        created_at=row["created_at"],
        metadata=_load_json(row["metadata_json"]),
    )


# ══════════════════════════════════════════════════════════════════════════
# Project ↔ thread binding (soft FK — works without sessions module)

def attach_thread(project_id: str, thread_id: str) -> bool:
    if not get_project(project_id) or not thread_id:
        return False
    with _conn() as c:
        c.execute(
            """INSERT OR IGNORE INTO project_threads
               (project_id, thread_id, added_at) VALUES (?, ?, ?)""",
            (project_id, thread_id, _now()),
        )
    _bump("threads_attached")
    return True


def detach_thread(project_id: str, thread_id: str) -> bool:
    with _conn() as c:
        cur = c.execute(
            "DELETE FROM project_threads WHERE project_id = ? AND thread_id = ?",
            (project_id, thread_id),
        )
        return cur.rowcount > 0


def list_project_threads(project_id: str) -> List[ProjectThreadLink]:
    with _conn() as c:
        rows = c.execute(
            "SELECT * FROM project_threads WHERE project_id = ? ORDER BY added_at DESC",
            (project_id,),
        ).fetchall()
    return [
        ProjectThreadLink(
            project_id=r["project_id"], thread_id=r["thread_id"], added_at=r["added_at"],
        )
        for r in rows
    ]


def get_project_of_thread(thread_id: str) -> Optional[str]:
    """Reverse lookup — useful when /chat needs to discover the project
    from a chat_id without the client sending project_id explicitly."""
    with _conn() as c:
        row = c.execute(
            "SELECT project_id FROM project_threads WHERE thread_id = ? LIMIT 1",
            (thread_id,),
        ).fetchone()
    return row["project_id"] if row else None


# ══════════════════════════════════════════════════════════════════════════
# Project agents

def create_agent(
    project_id: str,
    *,
    name: str,
    role: str = "",
    system_prompt: str = "",
    model_hint: str = "",
    color: str = "",
    icon: str = "",
    metadata: Optional[dict] = None,
    agent_id: Optional[str] = None,
) -> Optional[ProjectAgent]:
    if not get_project(project_id):
        return None
    aid = (agent_id or "").strip() or _new_id()
    now = _now()
    with _conn() as c:
        row = c.execute(
            "SELECT * FROM project_agents WHERE id = ?",
            (aid,),
        ).fetchone()
        if row:
            existing = _row_to_agent(row)
            return existing if existing.project_id == project_id else None
        c.execute(
            """INSERT INTO project_agents
               (id, project_id, name, role, system_prompt, model_hint,
                color, icon, created_at, updated_at, metadata_json)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                aid, project_id,
                (name or "").strip() or "Agent",
                (role or "").strip(),
                (system_prompt or "").strip(),
                (model_hint or "").strip(),
                (color or "").strip(),
                (icon or "").strip(),
                now, now,
                _dump_json(metadata),
            ),
        )
    _bump("agents_created")
    return ProjectAgent(
        id=aid, project_id=project_id,
        name=(name or "").strip() or "Agent",
        role=(role or "").strip(),
        system_prompt=(system_prompt or "").strip(),
        model_hint=(model_hint or "").strip(),
        color=(color or "").strip(),
        icon=(icon or "").strip(),
        created_at=now, updated_at=now,
        metadata=dict(metadata or {}),
    )


def list_agents(project_id: str) -> List[ProjectAgent]:
    with _conn() as c:
        rows = c.execute(
            "SELECT * FROM project_agents WHERE project_id = ? ORDER BY created_at ASC",
            (project_id,),
        ).fetchall()
    _bump("agents_listed")
    return [_row_to_agent(r) for r in rows]


def update_agent(
    agent_id: str,
    *,
    project_id: Optional[str] = None,
    name: Optional[str] = None,
    role: Optional[str] = None,
    system_prompt: Optional[str] = None,
    model_hint: Optional[str] = None,
    color: Optional[str] = None,
    icon: Optional[str] = None,
    metadata: Optional[dict] = None,
) -> Optional[ProjectAgent]:
    with _conn() as c:
        if project_id is not None:
            row = c.execute(
                "SELECT * FROM project_agents WHERE id = ? AND project_id = ?",
                (agent_id, project_id),
            ).fetchone()
        else:
            row = c.execute(
                "SELECT * FROM project_agents WHERE id = ?", (agent_id,),
            ).fetchone()
        if not row:
            return None
        existing = _row_to_agent(row)
        new_name = (name.strip() if name is not None else existing.name) or existing.name
        new_role = role.strip() if role is not None else existing.role
        new_sp   = system_prompt.strip() if system_prompt is not None else existing.system_prompt
        new_mh   = model_hint.strip() if model_hint is not None else existing.model_hint
        new_col  = color.strip() if color is not None else existing.color
        new_ic   = icon.strip() if icon is not None else existing.icon
        new_meta = {**existing.metadata, **(metadata or {})}
        now = _now()
        c.execute(
            """UPDATE project_agents
               SET name = ?, role = ?, system_prompt = ?, model_hint = ?,
                   color = ?, icon = ?, updated_at = ?, metadata_json = ?
               WHERE id = ?""",
            (new_name, new_role, new_sp, new_mh, new_col, new_ic, now,
             _dump_json(new_meta), agent_id),
        )
    return ProjectAgent(
        id=agent_id, project_id=existing.project_id,
        name=new_name, role=new_role,
        system_prompt=new_sp, model_hint=new_mh,
        color=new_col, icon=new_ic,
        created_at=existing.created_at, updated_at=now,
        metadata=new_meta,
    )


def delete_agent(agent_id: str, project_id: Optional[str] = None) -> bool:
    with _conn() as c:
        if project_id is not None:
            cur = c.execute(
                "DELETE FROM project_agents WHERE id = ? AND project_id = ?",
                (agent_id, project_id),
            )
        else:
            cur = c.execute("DELETE FROM project_agents WHERE id = ?", (agent_id,))
        return cur.rowcount > 0


def _row_to_agent(row: sqlite3.Row) -> ProjectAgent:
    return ProjectAgent(
        id=row["id"], project_id=row["project_id"],
        name=row["name"], role=row["role"],
        system_prompt=row["system_prompt"], model_hint=row["model_hint"],
        color=row["color"], icon=row["icon"],
        created_at=row["created_at"], updated_at=row["updated_at"],
        metadata=_load_json(row["metadata_json"]),
    )


# ══════════════════════════════════════════════════════════════════════════
# Project files (placeholder — schema only; actual upload pipeline is
# deliberately deferred. register_file() is here so an external uploader
# can record file metadata once it lands.)

def register_file(
    project_id: str,
    *,
    path: str,
    sha256: str = "",
    size_bytes: int = 0,
    mime: str = "",
    storage_url: str = "",
    metadata: Optional[dict] = None,
) -> Optional[ProjectFile]:
    if not get_project(project_id):
        return None
    fid = _new_id()
    now = _now()
    with _conn() as c:
        c.execute(
            """INSERT INTO project_files
               (id, project_id, path, sha256, size_bytes, mime, storage_url,
                created_at, metadata_json)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (fid, project_id, path, sha256, int(size_bytes or 0), mime,
             storage_url, now, _dump_json(metadata)),
        )
    _bump("files_registered")
    return ProjectFile(
        id=fid, project_id=project_id, path=path, sha256=sha256,
        size_bytes=int(size_bytes or 0), mime=mime, storage_url=storage_url,
        created_at=now, metadata=dict(metadata or {}),
    )


def list_files(project_id: str) -> List[ProjectFile]:
    with _conn() as c:
        rows = c.execute(
            "SELECT * FROM project_files WHERE project_id = ? ORDER BY created_at DESC",
            (project_id,),
        ).fetchall()
    return [
        ProjectFile(
            id=r["id"], project_id=r["project_id"], path=r["path"],
            sha256=r["sha256"], size_bytes=r["size_bytes"], mime=r["mime"],
            storage_url=r["storage_url"], created_at=r["created_at"],
            metadata=_load_json(r["metadata_json"]),
        )
        for r in rows
    ]
