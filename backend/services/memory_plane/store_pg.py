# coding: utf-8
"""Phase 6 slice 2 — Memory Plane Postgres adapter.

Mirror of `store_sqlite.py` against Postgres via psycopg3 sync. The
public function signatures match line-for-line so the dispatcher in
`store.py` can route calls to either backend without per-call
shape-checking.

Schema differences from SQLite:
  * `embedding` is `vector(1536)` when pgvector is installed and the
    extension is enabled. We DO NOT require it for slice 2 — the
    table bootstraps with `embedding text` and the next slice's
    migration runner alters it to vector(1536) once embeddings start
    being generated. See `_SCHEMA` below for the conservative shape.
  * Partial indexes use the same `WHERE deleted_at IS NULL` predicate
    Postgres supports.
  * Booleans stay encoded as TEXT timestamps (NULL = active) so the
    SQL stays portable.

Errors:
  * The store NEVER raises on transient DB errors — it logs + bumps
    counters + returns the empty value (mirroring SQLite contract).
  * The store DOES raise on programmer-level mistakes (missing
    user_id, empty content) — same as SQLite.

psycopg3 is lazy-imported at the engine layer; this module only
imports the pool accessor. When Postgres isn't installed the
dispatcher never reaches this module so the API process still boots.
"""
from __future__ import annotations

import json
import logging
import os
import threading
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from backend.services.db import engine
from backend.services.db.errors import DBConfigError, DBUnavailable
from backend.services.memory_plane.types import (
    MemoryQuery, MemoryRecord,
    DEFAULT_KIND, normalize_kind, clamp_importance,
    SOURCE_MANUAL,
)


logger = logging.getLogger(__name__)


# ── Counters (mirrors store_sqlite for parity in /tools/health) ────────────

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
    with _LOCK:
        out = dict(_COUNTS)
    out["backend"] = "postgres"
    return out


# ── Helpers ────────────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _now_dt() -> datetime:
    return datetime.now(timezone.utc)


def _new_id() -> str:
    return uuid.uuid4().hex


def _encode_embedding(emb: Optional[list[float]]) -> Optional[str]:
    if emb is None:
        return None
    try:
        return json.dumps(list(map(float, emb)))
    except Exception:
        return None


def _decode_embedding(raw) -> Optional[list[float]]:
    if not raw:
        return None
    if isinstance(raw, list):           # pgvector codec, if registered later
        try:
            return [float(x) for x in raw]
        except Exception:
            return None
    try:
        v = json.loads(raw)
        if isinstance(v, list):
            return [float(x) for x in v]
    except Exception:
        pass
    return None


def _safe_json(raw) -> dict:
    if not raw:
        return {}
    if isinstance(raw, dict):
        return raw
    try:
        v = json.loads(raw)
        return v if isinstance(v, dict) else {}
    except Exception:
        return {}


def _compute_expires(ttl_seconds: Optional[int], created_at_dt: datetime) -> Optional[str]:
    if ttl_seconds is None or ttl_seconds <= 0:
        return None
    try:
        return (created_at_dt + timedelta(seconds=int(ttl_seconds))).isoformat()
    except Exception:
        return None


def _row_to_record(row) -> MemoryRecord:
    # row is a dict-like (DictRow) from psycopg.rows.dict_row, or a tuple.
    # We always pass dict_row in the connection so this is straightforward.
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
        embedding=   _decode_embedding(row.get("embedding")),
        metadata=    _safe_json(row.get("metadata_json")),
        created_at=  row["created_at"],
        updated_at=  row["updated_at"],
        deleted_at=  row.get("deleted_at"),
    )


# ── Schema (idempotent) ────────────────────────────────────────────────────
#
# Conservative shape — `embedding` is TEXT today (JSON-encoded floats).
# Slice 3 will run an ALTER COLUMN to `vector(1536)` after the pgvector
# extension is ensured and a backfill job populates real embeddings.
# Storing as TEXT in the meantime keeps the dispatcher transparent —
# rows persisted on SQLite copy 1:1 into Postgres via db_migrate.

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


_INITIALIZED = False


def init() -> None:
    """Idempotent schema bootstrap. Safe to call repeatedly."""
    global _INITIALIZED
    if _INITIALIZED:
        return
    with _LOCK:
        if _INITIALIZED:
            return
        try:
            with engine.acquire_sync() as conn:
                with conn.cursor() as cur:
                    cur.execute(_SCHEMA)
                conn.commit()
            _INITIALIZED = True
            logger.info("memory_plane.store_pg initialized")
        except (DBConfigError, DBUnavailable):
            raise
        except Exception as e:
            logger.warning("memory_plane.store_pg.init failed: %s", e)
            _bump("init_failed", str(e))


def _ensure_init() -> None:
    if not _INITIALIZED:
        init()


def _reset_for_tests() -> None:
    global _INITIALIZED
    with _LOCK:
        _INITIALIZED = False


def _dict_cursor(conn):
    """Return a cursor that yields dict rows — psycopg3 idiom."""
    from psycopg.rows import dict_row    # noqa: PLC0415
    return conn.cursor(row_factory=dict_row)


# ══════════════════════════════════════════════════════════════════════════════
# Writes
# ══════════════════════════════════════════════════════════════════════════════

def insert(record: MemoryRecord) -> MemoryRecord:
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
        with engine.acquire_sync() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO memory_items "
                    "(id, user_id, project_id, agent_id, kind, content, importance, "
                    " ttl_seconds, expires_at, source, embedding, metadata_json, "
                    " created_at, updated_at) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                    (
                        rid, str(record.user_id), record.project_id, record.agent_id,
                        kind, content, imp, ttl, exp, source, emb, md, now, now,
                    ),
                )
            conn.commit()
        _bump("writes")
        return MemoryRecord(
            id=rid, user_id=str(record.user_id), project_id=record.project_id,
            agent_id=record.agent_id, kind=kind, content=content,
            importance=imp, ttl_seconds=ttl, expires_at=exp,
            source=source, embedding=record.embedding,
            metadata=record.metadata or {},
            created_at=now, updated_at=now, deleted_at=None,
        )
    except (DBConfigError, DBUnavailable):
        raise
    except Exception as e:
        logger.warning("memory_plane.store_pg.insert user=%s error: %s", record.user_id, e)
        _bump("writes", str(e))
        raise


def update_embedding(record_id: str, embedding: list[float]) -> bool:
    _ensure_init()
    if not record_id:
        return False
    raw = _encode_embedding(embedding)
    if raw is None:
        return False
    try:
        with engine.acquire_sync() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE memory_items SET embedding=%s, updated_at=%s "
                    "WHERE id=%s AND deleted_at IS NULL",
                    (raw, _now(), record_id),
                )
                ok = cur.rowcount > 0
            conn.commit()
        return ok
    except (DBConfigError, DBUnavailable):
        raise
    except Exception as e:
        logger.warning("memory_plane.store_pg.update_embedding id=%s error: %s", record_id, e)
        _bump("writes", str(e))
        return False


def update_importance(record_id: str, importance: float) -> bool:
    _ensure_init()
    imp = clamp_importance(importance)
    try:
        with engine.acquire_sync() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE memory_items SET importance=%s, updated_at=%s "
                    "WHERE id=%s AND deleted_at IS NULL",
                    (imp, _now(), record_id),
                )
                ok = cur.rowcount > 0
            conn.commit()
        return ok
    except (DBConfigError, DBUnavailable):
        raise
    except Exception as e:
        logger.warning("memory_plane.store_pg.update_importance id=%s error: %s", record_id, e)
        _bump("writes", str(e))
        return False


# ══════════════════════════════════════════════════════════════════════════════
# Reads
# ══════════════════════════════════════════════════════════════════════════════

def get(record_id: str) -> Optional[MemoryRecord]:
    _ensure_init()
    if not record_id:
        return None
    try:
        with engine.acquire_sync() as conn:
            with _dict_cursor(conn) as cur:
                cur.execute(
                    "SELECT * FROM memory_items WHERE id=%s AND deleted_at IS NULL",
                    (record_id,),
                )
                row = cur.fetchone()
        if row is None:
            return None
        _bump("reads")
        return _row_to_record(row)
    except (DBConfigError, DBUnavailable):
        raise
    except Exception as e:
        logger.warning("memory_plane.store_pg.get id=%s error: %s", record_id, e)
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
    _ensure_init()
    if not user_id:
        return []
    sql = "SELECT * FROM memory_items WHERE user_id=%s AND deleted_at IS NULL"
    params: list = [str(user_id)]
    if project_id is not None:
        sql += " AND project_id=%s"
        params.append(project_id)
    if agent_id is not None:
        sql += " AND agent_id=%s"
        params.append(agent_id)
    if kind is not None:
        sql += " AND kind=%s"
        params.append(normalize_kind(kind))
    if not include_expired:
        sql += " AND (expires_at IS NULL OR expires_at > %s)"
        params.append(_now())
    sql += " ORDER BY importance DESC, created_at DESC LIMIT %s OFFSET %s"
    params.extend([int(max(1, min(200, limit))), int(max(0, offset))])
    try:
        with engine.acquire_sync() as conn:
            with _dict_cursor(conn) as cur:
                cur.execute(sql, tuple(params))
                rows = cur.fetchall()
        _bump("reads")
        return [_row_to_record(r) for r in rows]
    except (DBConfigError, DBUnavailable):
        raise
    except Exception as e:
        logger.warning("memory_plane.store_pg.list_for_user user=%s error: %s", user_id, e)
        _bump("reads", str(e))
        return []


def search_text(query: MemoryQuery) -> list[MemoryRecord]:
    _ensure_init()
    if not query.user_id:
        return []
    sql = "SELECT * FROM memory_items WHERE user_id=%s AND deleted_at IS NULL"
    params: list = [str(query.user_id)]
    if query.project_id is not None:
        sql += " AND project_id=%s"
        params.append(query.project_id)
    if query.agent_id is not None:
        sql += " AND agent_id=%s"
        params.append(query.agent_id)
    if query.kind is not None:
        sql += " AND kind=%s"
        params.append(normalize_kind(query.kind))
    if query.importance_floor is not None:
        sql += " AND importance >= %s"
        params.append(clamp_importance(query.importance_floor))
    if not query.include_expired:
        sql += " AND (expires_at IS NULL OR expires_at > %s)"
        params.append(_now())
    if query.query:
        # Postgres ILIKE is case-insensitive by default and handles
        # unicode correctly — beats SQLite's LOWER() trick.
        sql += " AND content ILIKE %s"
        params.append(f"%{query.query.strip()}%")
    sql += " ORDER BY importance DESC, created_at DESC LIMIT %s OFFSET %s"
    params.extend([int(max(1, min(200, query.limit))), int(max(0, query.offset))])
    try:
        with engine.acquire_sync() as conn:
            with _dict_cursor(conn) as cur:
                cur.execute(sql, tuple(params))
                rows = cur.fetchall()
        _bump("searches")
        return [_row_to_record(r) for r in rows]
    except (DBConfigError, DBUnavailable):
        raise
    except Exception as e:
        logger.warning("memory_plane.store_pg.search_text user=%s error: %s", query.user_id, e)
        _bump("searches", str(e))
        return []


# ══════════════════════════════════════════════════════════════════════════════
# Deletes
# ══════════════════════════════════════════════════════════════════════════════

def soft_delete(record_id: str, *, user_id: Optional[str] = None) -> bool:
    _ensure_init()
    if not record_id:
        return False
    now = _now()
    sql = ("UPDATE memory_items SET deleted_at=%s, updated_at=%s "
           "WHERE id=%s AND deleted_at IS NULL")
    params: list = [now, now, record_id]
    if user_id is not None:
        sql += " AND user_id=%s"
        params.append(str(user_id))
    try:
        with engine.acquire_sync() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, tuple(params))
                ok = cur.rowcount > 0
            conn.commit()
        if ok:
            _bump("soft_deletes")
        return ok
    except (DBConfigError, DBUnavailable):
        raise
    except Exception as e:
        logger.warning("memory_plane.store_pg.soft_delete id=%s error: %s", record_id, e)
        _bump("soft_deletes", str(e))
        return False


def hard_delete(record_id: str) -> bool:
    _ensure_init()
    if not record_id:
        return False
    try:
        with engine.acquire_sync() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM memory_items WHERE id=%s", (record_id,))
                ok = cur.rowcount > 0
            conn.commit()
        if ok:
            _bump("hard_deletes")
        return ok
    except (DBConfigError, DBUnavailable):
        raise
    except Exception as e:
        logger.warning("memory_plane.store_pg.hard_delete id=%s error: %s", record_id, e)
        _bump("hard_deletes", str(e))
        return False


def expire_due(*, now: Optional[str] = None) -> int:
    _ensure_init()
    cutoff = now or _now()
    try:
        with engine.acquire_sync() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE memory_items "
                    "SET deleted_at=%s, updated_at=%s "
                    "WHERE deleted_at IS NULL "
                    "  AND expires_at IS NOT NULL "
                    "  AND expires_at <= %s",
                    (cutoff, cutoff, cutoff),
                )
                n = cur.rowcount
            conn.commit()
        if n:
            _bump("ttl_evictions")
            with _LOCK:
                cur_count = _COUNTS.get("ttl_evictions_total", 0)
                _COUNTS["ttl_evictions_total"] = (
                    cur_count if isinstance(cur_count, int) else 0
                ) + n
        return int(n)
    except (DBConfigError, DBUnavailable):
        raise
    except Exception as e:
        logger.warning("memory_plane.store_pg.expire_due error: %s", e)
        _bump("ttl_evictions", str(e))
        return 0


def wipe_user(user_id: str) -> int:
    _ensure_init()
    if not user_id:
        return 0
    try:
        with engine.acquire_sync() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM memory_items WHERE user_id=%s", (str(user_id),))
                n = cur.rowcount
            conn.commit()
        return int(n)
    except (DBConfigError, DBUnavailable):
        raise
    except Exception as e:
        logger.warning("memory_plane.store_pg.wipe_user user=%s error: %s", user_id, e)
        _bump("hard_deletes", str(e))
        return 0


def table_counts() -> dict:
    out = {"total": 0, "active": 0, "deleted": 0}
    try:
        _ensure_init()
        with engine.acquire_sync() as conn:
            with _dict_cursor(conn) as cur:
                cur.execute(
                    "SELECT "
                    "  COUNT(*) AS total, "
                    "  SUM(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END) AS active, "
                    "  SUM(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END) AS deleted "
                    "FROM memory_items"
                )
                row = cur.fetchone()
        if row:
            out["total"]   = int(row["total"] or 0)
            out["active"]  = int(row["active"] or 0)
            out["deleted"] = int(row["deleted"] or 0)
    except Exception:
        pass
    return out


# ── Bulk-insert helper for db_migrate copy. Not part of the public
#    contract — callers go through `insert()` per record. The migration
#    runner uses this to preserve original IDs + timestamps. ──────────

def insert_bulk(records: list[MemoryRecord]) -> int:
    """Insert raw records with original id/created_at preserved (for
    SQLite → Postgres migration). Skips rows whose id already exists.

    Returns the number of rows inserted. Uses ON CONFLICT (id) DO NOTHING
    so re-runs are idempotent and partial failures don't double-count.
    """
    # Short-circuit BEFORE _ensure_init so a no-op call doesn't pull
    # the schema bootstrap (or, more importantly, a connection) on a
    # mis-configured Postgres.
    if not records:
        return 0
    _ensure_init()
    rows: list[tuple] = []
    for r in records:
        if not r.user_id or not r.content:
            continue
        rows.append((
            r.id or _new_id(),
            str(r.user_id), r.project_id, r.agent_id,
            normalize_kind(r.kind), r.content,
            clamp_importance(r.importance),
            int(r.ttl_seconds) if r.ttl_seconds else None,
            r.expires_at,
            (r.source or SOURCE_MANUAL),
            _encode_embedding(r.embedding),
            json.dumps(r.metadata or {}),
            r.created_at or _now(),
            r.updated_at or r.created_at or _now(),
            r.deleted_at,
        ))
    if not rows:
        return 0
    try:
        with engine.acquire_sync() as conn:
            with conn.cursor() as cur:
                cur.executemany(
                    "INSERT INTO memory_items "
                    "(id, user_id, project_id, agent_id, kind, content, importance, "
                    " ttl_seconds, expires_at, source, embedding, metadata_json, "
                    " created_at, updated_at, deleted_at) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) "
                    "ON CONFLICT (id) DO NOTHING",
                    rows,
                )
                n = cur.rowcount
            conn.commit()
        return int(n)
    except (DBConfigError, DBUnavailable):
        raise
    except Exception as e:
        logger.warning("memory_plane.store_pg.insert_bulk error: %s", e)
        _bump("writes", str(e))
        return 0


__all__ = [
    "init", "_reset_for_tests",
    "insert", "update_embedding", "update_importance",
    "get", "list_for_user", "search_text",
    "soft_delete", "hard_delete", "expire_due", "wipe_user",
    "store_stats", "table_counts",
    "insert_bulk",
]
