# coding: utf-8
"""
Phase 6 — Memory Plane SQLite adapter.

A NEW SQLite file (default `memory_plane.db`, override via
MEMORY_PLANE_DB_PATH). Kept SEPARATE from memory.db / sessions.db /
auth.db so this phase has a clean rollback path:

    rm memory_plane.db   # forgets the whole memory plane; nothing else moves

This file is the only place that touches SQL for the memory plane.
Every other module talks to it via this module's typed functions.

Design rules:
  * TEXT primary keys (uuid4 hex) + ISO-8601 UTC timestamps so the
    schema ports onto Postgres without lossy conversions.
  * Soft delete via `deleted_at`. Active queries always filter it.
  * `embedding` is nullable JSON-encoded TEXT today. When Postgres +
    pgvector lands, ALTER COLUMN flips it to `vector(1536)` — no
    callsite churn because callers go through MemoryRecord (a
    list[float]).
  * Indexes are partial WHERE deleted_at IS NULL so soft-deleted rows
    don't bloat the hot path.
  * Every function is non-raising on transient SQLite errors; they
    log + bump counters + return a sensible empty value. The store
    raises only for truly programmer-level mistakes (e.g. inserting
    with no user_id).
"""
from __future__ import annotations

import json
import logging
import os
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from typing import Iterator, Optional

from backend.services.memory_plane.types import (
    MemoryRecord, MemoryQuery,
    DEFAULT_KIND, normalize_kind, clamp_importance,
    SOURCE_MANUAL,
)


logger = logging.getLogger(__name__)


# ── DB path ──────────────────────────────────────────────────────────────────
#
# Read dynamically on every connection so tests can monkeypatch
# MEMORY_PLANE_DB_PATH and re-call init() against a tmp file. Mirrors
# the sessions store's approach so the existing conftest patterns
# carry over.

def _db_path() -> str:
    return os.getenv("MEMORY_PLANE_DB_PATH", "memory_plane.db")


# ── Observability counters ───────────────────────────────────────────────────

_LOCK = threading.Lock()
_COUNTS: dict[str, object] = {
    "writes":          0,
    "reads":           0,
    "searches":        0,
    "soft_deletes":    0,
    "hard_deletes":    0,
    "ttl_evictions":   0,
    "errors":          0,
    "last_error":      "",
}


def _bump(field_: str, error: str = "") -> None:
    with _LOCK:
        cur = _COUNTS.get(field_, 0)
        _COUNTS[field_] = (cur if isinstance(cur, int) else 0) + 1
        if error:
            err_cur = _COUNTS.get("errors", 0)
            _COUNTS["errors"] = (err_cur if isinstance(err_cur, int) else 0) + 1
            _COUNTS["last_error"] = error[:140]


def store_stats() -> dict:
    """Snapshot for /tools/health-style probes. Never leaks content."""
    with _LOCK:
        out = dict(_COUNTS)
    out["db_path"] = _db_path()
    return out


# ── Time + id helpers ────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _now_dt() -> datetime:
    return datetime.now(timezone.utc)


def _new_id() -> str:
    return uuid.uuid4().hex


# ── Connection management ────────────────────────────────────────────────────

@contextmanager
def _conn() -> Iterator[sqlite3.Connection]:
    """One connection per call. SQLite serialises writes via the
    file-level lock; reads run in parallel. We do NOT cache connections
    so per-process state stays stateless — important for the lazy
    init pattern + tests that monkeypatch the db path."""
    c = sqlite3.connect(_db_path(), timeout=10)
    try:
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA foreign_keys = ON")
        c.execute("PRAGMA journal_mode = WAL")
        yield c
        c.commit()
    finally:
        c.close()


# ── Schema ───────────────────────────────────────────────────────────────────
#
# Indexes use partial WHERE deleted_at IS NULL so soft-deleted rows
# never weigh on the hot path. ttl/expires_at index speeds up the
# periodic eviction sweep.

_SCHEMA = """
CREATE TABLE IF NOT EXISTS memory_items (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    project_id    TEXT,
    agent_id      TEXT,
    kind          TEXT NOT NULL DEFAULT 'fact',
    content       TEXT NOT NULL,
    importance    REAL NOT NULL DEFAULT 0.5,
    ttl_seconds   INTEGER,
    expires_at    TEXT,
    source        TEXT NOT NULL DEFAULT 'manual',
    embedding     TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    deleted_at    TEXT
);

CREATE INDEX IF NOT EXISTS ix_memory_user
    ON memory_items(user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_memory_user_project
    ON memory_items(user_id, project_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_memory_user_agent
    ON memory_items(user_id, agent_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_memory_user_kind
    ON memory_items(user_id, kind) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_memory_expires
    ON memory_items(expires_at) WHERE expires_at IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_memory_importance
    ON memory_items(user_id, importance DESC) WHERE deleted_at IS NULL;
"""


_INITIALIZED: bool = False


def init() -> None:
    """Idempotent schema bootstrap. Safe to call repeatedly. Lazy —
    callers don't have to invoke it explicitly; every write/read
    triggers it on first use."""
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
            logger.info("memory_plane.store initialized | db=%s", _db_path())
        except Exception as e:
            logger.warning("memory_plane.store.init failed: %s", e)
            _bump("init_failed", str(e))


def _ensure_init() -> None:
    if not _INITIALIZED:
        init()


def _reset_for_tests() -> None:
    """Drop the cached init flag so the next call re-runs the schema
    against the current MEMORY_PLANE_DB_PATH. Test-only."""
    global _INITIALIZED
    with _LOCK:
        _INITIALIZED = False


# ── Encode / decode helpers ──────────────────────────────────────────────────

def _encode_embedding(emb: Optional[list[float]]) -> Optional[str]:
    if emb is None:
        return None
    try:
        return json.dumps(list(map(float, emb)))
    except Exception:
        return None


def _decode_embedding(raw: Optional[str]) -> Optional[list[float]]:
    if not raw:
        return None
    try:
        v = json.loads(raw)
        if isinstance(v, list):
            return [float(x) for x in v]
    except Exception:
        pass
    return None


def _safe_json(raw: Optional[str]) -> dict:
    if not raw:
        return {}
    try:
        v = json.loads(raw)
        return v if isinstance(v, dict) else {}
    except Exception:
        return {}


def _compute_expires(ttl_seconds: Optional[int], created_at_dt: datetime) -> Optional[str]:
    """Precompute expires_at = created_at + ttl_seconds. Stored on the
    row so the eviction sweep is a single indexed comparison."""
    if ttl_seconds is None or ttl_seconds <= 0:
        return None
    try:
        return (created_at_dt + timedelta(seconds=int(ttl_seconds))).isoformat()
    except Exception:
        return None


def _row_to_record(row: sqlite3.Row) -> MemoryRecord:
    return MemoryRecord(
        id=          row["id"],
        user_id=     row["user_id"],
        project_id=  row["project_id"],
        agent_id=    row["agent_id"],
        kind=        row["kind"],
        content=     row["content"],
        importance=  float(row["importance"] if row["importance"] is not None else 0.5),
        ttl_seconds= row["ttl_seconds"],
        expires_at=  row["expires_at"],
        source=      row["source"],
        embedding=   _decode_embedding(row["embedding"]),
        metadata=    _safe_json(row["metadata_json"]),
        created_at=  row["created_at"],
        updated_at=  row["updated_at"],
        deleted_at=  row["deleted_at"],
    )


# ══════════════════════════════════════════════════════════════════════════════
# Writes
# ══════════════════════════════════════════════════════════════════════════════

def insert(record: MemoryRecord) -> MemoryRecord:
    """Persist a new memory item. The store generates `id`, `created_at`,
    `updated_at` and `expires_at`. Returns the populated record.

    Raises ValueError on programmer-level mistakes (missing user_id /
    empty content); never raises on transient SQLite errors — those
    log and re-raise as-is so the caller can wrap them at the
    appropriate layer.
    """
    _ensure_init()
    if not record.user_id or not str(record.user_id).strip():
        raise ValueError("memory_plane.insert: user_id is required")
    content = (record.content or "").strip()
    if not content:
        raise ValueError("memory_plane.insert: content is required")

    rid    = _new_id()
    now_dt = _now_dt()
    now    = now_dt.isoformat()
    kind   = normalize_kind(record.kind)
    imp    = clamp_importance(record.importance)
    ttl    = int(record.ttl_seconds) if (record.ttl_seconds and record.ttl_seconds > 0) else None
    exp    = _compute_expires(ttl, now_dt)
    md     = json.dumps(record.metadata or {})
    emb    = _encode_embedding(record.embedding)
    source = (record.source or SOURCE_MANUAL).strip() or SOURCE_MANUAL

    try:
        with _conn() as c:
            c.execute(
                "INSERT INTO memory_items "
                "(id, user_id, project_id, agent_id, kind, content, importance, "
                " ttl_seconds, expires_at, source, embedding, metadata_json, "
                " created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    rid, str(record.user_id), record.project_id, record.agent_id,
                    kind, content, imp, ttl, exp, source, emb, md, now, now,
                ),
            )
        _bump("writes")
        return MemoryRecord(
            id=rid, user_id=str(record.user_id), project_id=record.project_id,
            agent_id=record.agent_id, kind=kind, content=content,
            importance=imp, ttl_seconds=ttl, expires_at=exp,
            source=source, embedding=record.embedding,
            metadata=record.metadata or {},
            created_at=now, updated_at=now, deleted_at=None,
        )
    except Exception as e:
        logger.warning("memory_plane.store.insert user=%s error: %s", record.user_id, e)
        _bump("writes", str(e))
        raise


def update_embedding(record_id: str, embedding: list[float]) -> bool:
    """Backfill an embedding onto an existing row. Phase 6 ships
    without auto-embedding; this method lets a background job populate
    them lazily once the embedding pipeline is wired."""
    _ensure_init()
    if not record_id:
        return False
    raw = _encode_embedding(embedding)
    if raw is None:
        return False
    try:
        with _conn() as c:
            cur = c.execute(
                "UPDATE memory_items SET embedding=?, updated_at=? "
                "WHERE id=? AND deleted_at IS NULL",
                (raw, _now(), record_id),
            )
            return cur.rowcount > 0
    except Exception as e:
        logger.warning("memory_plane.store.update_embedding id=%s error: %s", record_id, e)
        _bump("writes", str(e))
        return False


def update_importance(record_id: str, importance: float) -> bool:
    """Adjust importance — used by future ML scoring + manual user
    bumps. Always clamps into [0,1]."""
    _ensure_init()
    imp = clamp_importance(importance)
    try:
        with _conn() as c:
            cur = c.execute(
                "UPDATE memory_items SET importance=?, updated_at=? "
                "WHERE id=? AND deleted_at IS NULL",
                (imp, _now(), record_id),
            )
            return cur.rowcount > 0
    except Exception as e:
        logger.warning("memory_plane.store.update_importance id=%s error: %s", record_id, e)
        _bump("writes", str(e))
        return False


# ══════════════════════════════════════════════════════════════════════════════
# Reads
# ══════════════════════════════════════════════════════════════════════════════

def get(record_id: str) -> Optional[MemoryRecord]:
    """Fetch a single row by id. Returns None if not found or soft-deleted."""
    _ensure_init()
    if not record_id:
        return None
    try:
        with _conn() as c:
            row = c.execute(
                "SELECT * FROM memory_items WHERE id=? AND deleted_at IS NULL",
                (record_id,),
            ).fetchone()
        if row is None:
            return None
        _bump("reads")
        return _row_to_record(row)
    except Exception as e:
        logger.warning("memory_plane.store.get id=%s error: %s", record_id, e)
        _bump("reads", str(e))
        return None


def list_for_user(
    user_id: str,
    *,
    project_id: Optional[str] = None,
    agent_id: Optional[str] = None,
    kind: Optional[str] = None,
    include_expired: bool = False,
    limit: int = 50,
    offset: int = 0,
) -> list[MemoryRecord]:
    """List active rows for one user with optional project/agent/kind
    filters. Ordered: importance DESC, created_at DESC (so the most
    important + most recent surfaces first)."""
    _ensure_init()
    if not user_id:
        return []
    sql = "SELECT * FROM memory_items WHERE user_id=? AND deleted_at IS NULL"
    params: list = [str(user_id)]
    if project_id is not None:
        sql += " AND project_id=?"
        params.append(project_id)
    if agent_id is not None:
        sql += " AND agent_id=?"
        params.append(agent_id)
    if kind is not None:
        sql += " AND kind=?"
        params.append(normalize_kind(kind))
    if not include_expired:
        sql += " AND (expires_at IS NULL OR expires_at > ?)"
        params.append(_now())
    sql += " ORDER BY importance DESC, created_at DESC LIMIT ? OFFSET ?"
    params.extend([int(max(1, min(200, limit))), int(max(0, offset))])
    try:
        with _conn() as c:
            rows = c.execute(sql, params).fetchall()
        _bump("reads")
        return [_row_to_record(r) for r in rows]
    except Exception as e:
        logger.warning("memory_plane.store.list_for_user user=%s error: %s", user_id, e)
        _bump("reads", str(e))
        return []


def search_text(
    query: MemoryQuery,
) -> list[MemoryRecord]:
    """Text-LIKE search. The retriever wraps this with ranking;
    callers should generally NOT call this directly — go through
    MemoryRetriever.search() so future semantic search slots in
    transparently.

    Falls back to listing when query is empty. Importance + recency
    ordering applied at the SQL layer; the retriever may re-rank.
    """
    _ensure_init()
    if not query.user_id:
        return []
    sql = "SELECT * FROM memory_items WHERE user_id=? AND deleted_at IS NULL"
    params: list = [str(query.user_id)]
    if query.project_id is not None:
        sql += " AND project_id=?"
        params.append(query.project_id)
    if query.agent_id is not None:
        sql += " AND agent_id=?"
        params.append(query.agent_id)
    if query.kind is not None:
        sql += " AND kind=?"
        params.append(normalize_kind(query.kind))
    if query.importance_floor is not None:
        sql += " AND importance >= ?"
        params.append(clamp_importance(query.importance_floor))
    if not query.include_expired:
        sql += " AND (expires_at IS NULL OR expires_at > ?)"
        params.append(_now())
    if query.query:
        # SQLite LIKE is case-insensitive for ASCII; for unicode we
        # also lower-case both sides. Good enough as a baseline; the
        # retriever can layer fuzzy/semantic on top.
        sql += " AND LOWER(content) LIKE LOWER(?)"
        params.append(f"%{query.query.strip()}%")
    sql += " ORDER BY importance DESC, created_at DESC LIMIT ? OFFSET ?"
    params.extend([int(max(1, min(200, query.limit))), int(max(0, query.offset))])
    try:
        with _conn() as c:
            rows = c.execute(sql, params).fetchall()
        _bump("searches")
        return [_row_to_record(r) for r in rows]
    except Exception as e:
        logger.warning("memory_plane.store.search_text user=%s error: %s", query.user_id, e)
        _bump("searches", str(e))
        return []


# ══════════════════════════════════════════════════════════════════════════════
# Deletes
# ══════════════════════════════════════════════════════════════════════════════

def soft_delete(record_id: str, *, user_id: Optional[str] = None) -> bool:
    """Mark a row deleted. When `user_id` is passed it acts as an
    ownership guard — the DELETE only fires when the row belongs to
    that user. Callers SHOULD pass user_id; the API does."""
    _ensure_init()
    if not record_id:
        return False
    now = _now()
    sql = "UPDATE memory_items SET deleted_at=?, updated_at=? WHERE id=? AND deleted_at IS NULL"
    params: list = [now, now, record_id]
    if user_id is not None:
        sql += " AND user_id=?"
        params.append(str(user_id))
    try:
        with _conn() as c:
            cur = c.execute(sql, params)
            ok = cur.rowcount > 0
        if ok:
            _bump("soft_deletes")
        return ok
    except Exception as e:
        logger.warning("memory_plane.store.soft_delete id=%s error: %s", record_id, e)
        _bump("soft_deletes", str(e))
        return False


def hard_delete(record_id: str) -> bool:
    """Permanent delete. Used by GDPR "forget me" flows + the periodic
    purge of tombstoned rows older than the retention window."""
    _ensure_init()
    if not record_id:
        return False
    try:
        with _conn() as c:
            cur = c.execute("DELETE FROM memory_items WHERE id=?", (record_id,))
            ok = cur.rowcount > 0
        if ok:
            _bump("hard_deletes")
        return ok
    except Exception as e:
        logger.warning("memory_plane.store.hard_delete id=%s error: %s", record_id, e)
        _bump("hard_deletes", str(e))
        return False


def expire_due(*, now: Optional[str] = None) -> int:
    """Soft-delete every row whose expires_at has passed. Idempotent;
    intended to be called from a periodic job (Phase 7) or opportunistic
    cleanup. Returns count evicted."""
    _ensure_init()
    cutoff = now or _now()
    try:
        with _conn() as c:
            cur = c.execute(
                "UPDATE memory_items "
                "SET deleted_at=?, updated_at=? "
                "WHERE deleted_at IS NULL "
                "  AND expires_at IS NOT NULL "
                "  AND expires_at <= ?",
                (cutoff, cutoff, cutoff),
            )
            n = cur.rowcount
        if n:
            _bump("ttl_evictions")
            with _LOCK:
                cur_count = _COUNTS.get("ttl_evictions_total", 0)
                _COUNTS["ttl_evictions_total"] = (cur_count if isinstance(cur_count, int) else 0) + n
        return int(n)
    except Exception as e:
        logger.warning("memory_plane.store.expire_due error: %s", e)
        _bump("ttl_evictions", str(e))
        return 0


def wipe_user(user_id: str) -> int:
    """Hard delete every row for one user. GDPR "forget me". Returns
    count removed. Soft-deleted rows are also purged."""
    _ensure_init()
    if not user_id:
        return 0
    try:
        with _conn() as c:
            cur = c.execute("DELETE FROM memory_items WHERE user_id=?", (str(user_id),))
            return int(cur.rowcount)
    except Exception as e:
        logger.warning("memory_plane.store.wipe_user user=%s error: %s", user_id, e)
        _bump("hard_deletes", str(e))
        return 0


# ══════════════════════════════════════════════════════════════════════════════
# Health
# ══════════════════════════════════════════════════════════════════════════════

def table_counts() -> dict:
    """For /tools/health. Total + soft-deleted + active counts. Cheap."""
    out = {"total": 0, "active": 0, "deleted": 0}
    try:
        _ensure_init()
        with _conn() as c:
            row = c.execute(
                "SELECT "
                "  COUNT(*) AS total, "
                "  SUM(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END) AS active, "
                "  SUM(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END) AS deleted "
                "FROM memory_items"
            ).fetchone()
        if row is not None:
            out["total"]   = int(row["total"] or 0)
            out["active"]  = int(row["active"] or 0)
            out["deleted"] = int(row["deleted"] or 0)
    except Exception:
        pass
    return out


__all__ = [
    "init", "_reset_for_tests",
    "insert", "update_embedding", "update_importance",
    "get", "list_for_user", "search_text",
    "soft_delete", "hard_delete", "expire_due", "wipe_user",
    "store_stats", "table_counts",
]
