# coding: utf-8
"""Phase 9 — Shared scratchpad SQLite store (scratchpad.db).

Append-only journal of per-project agent notes. Mirrors the pattern
established by agent_tasks/store.py — same WAL mode, same
threading.Lock + lazy init dance, same row_factory so the client
layer can read columns by name.
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

from backend.services.scratchpad.types import (
    ScratchpadEntry, normalize_kind, KIND_NOTE,
    normalize_status, STATUS_ACTIVE, STATUS_SUPERSEDED,
)


logger = logging.getLogger(__name__)


def _db_path() -> str:
    return resolve_db_path("scratchpad.db", "SCRATCHPAD_DB_PATH")


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


# Index strategy:
#   - (user_id, project_id) is the dominant access pattern (FE viewer +
#     coordinator + project_brain aggregator all query this combo).
#   - workflow_id and correlation_id support "find every note written
#     during this run" — used by the FE timeline.
#   - created_at is implicit via the lexicographic ISO-8601 ordering of
#     the column; we order DESC on read.
_SCHEMA = """
CREATE TABLE IF NOT EXISTS scratchpad_entries (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL,
    project_id      TEXT NOT NULL,
    agent_id        TEXT NOT NULL,
    kind            TEXT NOT NULL DEFAULT 'note',
    content         TEXT NOT NULL DEFAULT '',
    workflow_id     TEXT,
    job_id          TEXT,
    parent_id       TEXT,
    correlation_id  TEXT,
    metadata_json   TEXT NOT NULL DEFAULT '{}',
    created_at      TEXT NOT NULL,
    -- Phase 9 part 2 — panel grouping + entry status. The next-PR
    -- additions go via this same idempotent column-add pattern below
    -- so old DB files don't need a manual migration.
    panel_id        TEXT,
    references_json TEXT NOT NULL DEFAULT '[]',
    supersedes_id   TEXT,
    status          TEXT NOT NULL DEFAULT 'active'
);
CREATE INDEX IF NOT EXISTS ix_scratchpad_user_project
    ON scratchpad_entries(user_id, project_id);
CREATE INDEX IF NOT EXISTS ix_scratchpad_workflow
    ON scratchpad_entries(workflow_id);
CREATE INDEX IF NOT EXISTS ix_scratchpad_correlation
    ON scratchpad_entries(correlation_id);
CREATE INDEX IF NOT EXISTS ix_scratchpad_created
    ON scratchpad_entries(user_id, project_id, created_at);
CREATE INDEX IF NOT EXISTS ix_scratchpad_panel
    ON scratchpad_entries(panel_id);
CREATE INDEX IF NOT EXISTS ix_scratchpad_supersedes
    ON scratchpad_entries(supersedes_id);
"""


# Idempotent column-add migration — SQLite's ADD COLUMN is non-IF-NOT-
# EXISTS, so we check PRAGMA table_info first. Lets a deployed DB from
# the previous PR pick up the new columns without manual ops work.
_ADDITIVE_COLUMNS: tuple[tuple[str, str], ...] = (
    ("panel_id",         "TEXT"),
    ("references_json",  "TEXT NOT NULL DEFAULT '[]'"),
    ("supersedes_id",    "TEXT"),
    ("status",           "TEXT NOT NULL DEFAULT 'active'"),
)


def _apply_additive_migrations(c: sqlite3.Connection) -> None:
    """Add new columns to existing scratchpad_entries tables.

    Safe to run repeatedly — checks PRAGMA table_info first. Logs the
    columns it actually added so an ops audit can confirm migration
    completion."""
    existing = {row["name"] for row in c.execute("PRAGMA table_info(scratchpad_entries)").fetchall()}
    added: list[str] = []
    for col_name, col_def in _ADDITIVE_COLUMNS:
        if col_name in existing:
            continue
        try:
            c.execute(f"ALTER TABLE scratchpad_entries ADD COLUMN {col_name} {col_def}")
            added.append(col_name)
        except sqlite3.OperationalError as e:
            # Another worker raced us — re-check and continue.
            logger.debug("scratchpad migration ADD COLUMN %s raced: %s", col_name, e)
    if added:
        logger.info("scratchpad migration added columns: %s", added)


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
                _apply_additive_migrations(c)
            _INITIALIZED = True
            logger.info("scratchpad.store initialized | db=%s", _db_path())
        except Exception as e:
            logger.warning("scratchpad.store.init failed: %s", e)


def _reset_for_tests() -> None:
    """Test helper: forces re-init against whichever SCRATCHPAD_DB_PATH
    the current monkeypatch session is using. Module-level singleton
    pattern needs this hook because tests routinely point at a tmp DB."""
    global _INITIALIZED
    with _LOCK:
        _INITIALIZED = False


def _ensure_init() -> None:
    if not _INITIALIZED:
        init()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Insert ─────────────────────────────────────────────────────────────────

def insert(entry: ScratchpadEntry) -> ScratchpadEntry:
    """Append a new entry. ID + created_at are assigned here (callers
    pass an entry with id=None). Append-only: no UPDATE path is exposed
    for content. The status column DOES support marking entries
    (accepted/rejected/superseded) — see mark_status() below.

    When `supersedes_id` is set, this insert ALSO transitions the
    referenced earlier entry to status='superseded' in the same
    transaction. That keeps the FE timeline consistent without a
    second round-trip.
    """
    _ensure_init()
    new_id = entry.id or uuid.uuid4().hex
    ts = entry.created_at or _now_iso()
    kind = normalize_kind(entry.kind)
    status = normalize_status(entry.status)
    refs_json = json.dumps(list(entry.references or []))
    with _conn() as c:
        c.execute(
            """
            INSERT INTO scratchpad_entries (
                id, user_id, project_id, agent_id, kind, content,
                workflow_id, job_id, parent_id, correlation_id,
                metadata_json, created_at,
                panel_id, references_json, supersedes_id, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                new_id, entry.user_id, entry.project_id, entry.agent_id,
                kind, entry.content or "",
                entry.workflow_id, entry.job_id, entry.parent_id,
                entry.correlation_id,
                json.dumps(entry.metadata or {}),
                ts,
                entry.panel_id, refs_json, entry.supersedes_id, status,
            ),
        )
        if entry.supersedes_id:
            # Atomically mark the predecessor — same transaction so the
            # FE never sees a window where both rows are "active".
            c.execute(
                "UPDATE scratchpad_entries SET status = ? "
                "WHERE id = ? AND user_id = ? AND status != 'superseded'",
                (STATUS_SUPERSEDED, entry.supersedes_id, entry.user_id),
            )
    entry.id = new_id
    entry.created_at = ts
    entry.kind = kind
    entry.status = status
    return entry


def mark_status(
    entry_id: str, *, user_id: str, status: str,
) -> Optional[ScratchpadEntry]:
    """Coordinator-driven endorsement / dismissal of an entry. Returns
    the updated row, or None when the entry doesn't exist or the user
    doesn't own it."""
    _ensure_init()
    new_status = normalize_status(status)
    with _conn() as c:
        cur = c.execute(
            "SELECT id FROM scratchpad_entries WHERE id = ? AND user_id = ?",
            (entry_id, user_id),
        ).fetchone()
        if cur is None:
            return None
        c.execute(
            "UPDATE scratchpad_entries SET status = ? WHERE id = ? AND user_id = ?",
            (new_status, entry_id, user_id),
        )
    return get(entry_id, user_id=user_id)


# ── Reads ──────────────────────────────────────────────────────────────────

def _row_to_entry(r: sqlite3.Row) -> ScratchpadEntry:
    try:
        meta = json.loads(r["metadata_json"] or "{}")
    except Exception:
        meta = {}
    if not isinstance(meta, dict):
        meta = {}
    # New columns — defaulted on read so a row inserted before the
    # migration (improbable since insert always writes them now) still
    # reads cleanly.
    panel_id      = r["panel_id"] if "panel_id" in r.keys() else None
    supersedes_id = r["supersedes_id"] if "supersedes_id" in r.keys() else None
    status        = r["status"] if "status" in r.keys() else STATUS_ACTIVE
    refs_raw      = r["references_json"] if "references_json" in r.keys() else "[]"
    try:
        refs = json.loads(refs_raw or "[]")
    except Exception:
        refs = []
    if not isinstance(refs, list):
        refs = []
    return ScratchpadEntry(
        id=             r["id"],
        user_id=        r["user_id"],
        project_id=     r["project_id"],
        agent_id=       r["agent_id"],
        kind=           r["kind"],
        content=        r["content"],
        workflow_id=    r["workflow_id"],
        job_id=         r["job_id"],
        parent_id=      r["parent_id"],
        correlation_id= r["correlation_id"],
        metadata=       meta,
        panel_id=       panel_id,
        references=     refs,
        supersedes_id=  supersedes_id,
        status=         status,
        created_at=     r["created_at"],
    )


def list_project(
    *, user_id: str, project_id: str,
    limit: int = 50, offset: int = 0,
    kind: Optional[str] = None,
    workflow_id: Optional[str] = None,
    correlation_id: Optional[str] = None,
    panel_id: Optional[str] = None,
    status: Optional[str] = None,
    newest_first: bool = True,
) -> list[ScratchpadEntry]:
    """Read entries for one user+project, optionally filtered.

    Ownership: (user_id, project_id) is the index key, so a malicious
    project_id from one user CAN'T accidentally surface another user's
    rows. The route layer also validates that the user owns the
    project, but this is the second line of defence."""
    _ensure_init()
    where = ["user_id = ?", "project_id = ?"]
    params: list = [user_id, project_id]
    if kind:
        where.append("kind = ?")
        params.append(normalize_kind(kind))
    if workflow_id:
        where.append("workflow_id = ?")
        params.append(workflow_id)
    if correlation_id:
        where.append("correlation_id = ?")
        params.append(correlation_id)
    if panel_id:
        where.append("panel_id = ?")
        params.append(panel_id)
    if status:
        where.append("status = ?")
        params.append(normalize_status(status))
    order = "DESC" if newest_first else "ASC"
    sql = (
        f"SELECT * FROM scratchpad_entries "
        f"WHERE {' AND '.join(where)} "
        f"ORDER BY created_at {order} LIMIT ? OFFSET ?"
    )
    params.extend([max(1, min(int(limit), 500)), max(0, int(offset))])
    with _conn() as c:
        rows = c.execute(sql, params).fetchall()
    return [_row_to_entry(r) for r in rows]


def get(entry_id: str, *, user_id: str) -> Optional[ScratchpadEntry]:
    """Fetch a single entry. Ownership-checked at read time so a stray
    id from one user's project doesn't leak through cross-user URLs."""
    _ensure_init()
    with _conn() as c:
        r = c.execute(
            "SELECT * FROM scratchpad_entries WHERE id = ? AND user_id = ?",
            (entry_id, user_id),
        ).fetchone()
    return _row_to_entry(r) if r else None


def count_project(*, user_id: str, project_id: str) -> int:
    _ensure_init()
    with _conn() as c:
        r = c.execute(
            "SELECT COUNT(*) AS n FROM scratchpad_entries "
            "WHERE user_id = ? AND project_id = ?",
            (user_id, project_id),
        ).fetchone()
    return int(r["n"]) if r else 0


__all__ = [
    "init", "insert", "list_project", "get", "count_project",
    "_reset_for_tests",
]
