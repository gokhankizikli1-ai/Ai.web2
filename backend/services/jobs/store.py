# coding: utf-8
"""
Phase 7 — Job Queue SQLite store.

Dedicated `jobs.db` file (override via JOBS_DB_PATH). Kept separate
from memory.db / sessions.db / auth.db / memory_plane.db so this
phase has a clean rollback: `rm jobs.db` forgets the whole subsystem,
nothing else moves.

Design rules:
  * TEXT primary keys (uuid4 hex) + ISO-8601 UTC timestamps so the
    schema ports onto Postgres without lossy conversions.
  * No soft delete — jobs are kept indefinitely (one row per real
    operation). A future GC sweep can prune terminal rows older
    than N days.
  * `idempotency_key` is unique per (user_id, kind) when not null —
    duplicate submits dedupe to the existing row.
  * Every method is non-raising on transient SQLite errors; they log
    and re-raise only for programmer-level mistakes.
"""
from __future__ import annotations

import logging
import os
import sqlite3
from backend.core.paths import resolve_db_path
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Iterator, Optional

from backend.services.jobs.types import (
    JobRecord, JOB_STATUSES, STATUS_QUEUED,
    DEFAULT_MAX_ATTEMPTS, DEFAULT_TIMEOUT_S,
    encode_json, decode_json, normalize_status,
)


logger = logging.getLogger(__name__)


# ── DB path ──────────────────────────────────────────────────────────────────

def _db_path() -> str:
    return resolve_db_path("jobs.db", "JOBS_DB_PATH")


# ── Observability ────────────────────────────────────────────────────────────

_LOCK = threading.Lock()
_COUNTS: dict[str, object] = {
    "inserts":   0,
    "updates":   0,
    "reads":     0,
    "lists":     0,
    "deletes":   0,
    "errors":    0,
    "last_error": "",
}


def _bump(key: str, error: str = "") -> None:
    with _LOCK:
        cur = _COUNTS.get(key, 0)
        _COUNTS[key] = (cur if isinstance(cur, int) else 0) + 1
        if error:
            err_cur = _COUNTS.get("errors", 0)
            _COUNTS["errors"] = (err_cur if isinstance(err_cur, int) else 0) + 1
            _COUNTS["last_error"] = error[:140]


def store_stats() -> dict:
    with _LOCK:
        out = dict(_COUNTS)
    out["db_path"] = _db_path()
    return out


# ── Time + id helpers ────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    return uuid.uuid4().hex


# ── Connection management ────────────────────────────────────────────────────

@contextmanager
def _conn() -> Iterator[sqlite3.Connection]:
    """Fresh connection per call. SQLite serialises writers via the
    file-level lock; readers run in parallel. WAL mode gives us
    concurrent readers + a single writer."""
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

_SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
    id              TEXT PRIMARY KEY,
    kind            TEXT NOT NULL,
    user_id         TEXT NOT NULL,
    project_id      TEXT,
    agent_id        TEXT,
    status          TEXT NOT NULL DEFAULT 'queued',
    payload_json    TEXT NOT NULL DEFAULT '{}',
    result_json     TEXT,
    error_json      TEXT,
    progress        INTEGER NOT NULL DEFAULT 0,
    progress_label  TEXT,
    idempotency_key TEXT,
    attempts        INTEGER NOT NULL DEFAULT 0,
    max_attempts    INTEGER NOT NULL DEFAULT 1,
    timeout_s       INTEGER,
    metadata_json   TEXT NOT NULL DEFAULT '{}',
    created_at      TEXT NOT NULL,
    queued_at       TEXT,
    started_at      TEXT,
    finished_at     TEXT,
    cancelled_at    TEXT,
    updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_jobs_user        ON jobs(user_id);
CREATE INDEX IF NOT EXISTS ix_jobs_project     ON jobs(project_id);
CREATE INDEX IF NOT EXISTS ix_jobs_status      ON jobs(status);
CREATE INDEX IF NOT EXISTS ix_jobs_kind        ON jobs(kind);
CREATE INDEX IF NOT EXISTS ix_jobs_created     ON jobs(created_at);
CREATE INDEX IF NOT EXISTS ix_jobs_user_status ON jobs(user_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS ux_jobs_idempotency
    ON jobs(user_id, kind, idempotency_key)
    WHERE idempotency_key IS NOT NULL;
"""


_INITIALIZED = False


def init() -> None:
    """Idempotent schema bootstrap."""
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
            logger.info("jobs.store initialized | db=%s", _db_path())
        except Exception as e:
            logger.warning("jobs.store.init failed: %s", e)
            _bump("init_failed", str(e))


def _ensure_init() -> None:
    if not _INITIALIZED:
        init()


def _reset_for_tests() -> None:
    """Test-only: clear the init flag so the next call re-creates
    the schema against the current JOBS_DB_PATH."""
    global _INITIALIZED
    with _LOCK:
        _INITIALIZED = False


# ── Row mapping ──────────────────────────────────────────────────────────────

def _row_to_record(row: sqlite3.Row) -> JobRecord:
    return JobRecord(
        id=              row["id"],
        kind=            row["kind"],
        user_id=         row["user_id"],
        project_id=      row["project_id"],
        agent_id=        row["agent_id"],
        status=          normalize_status(row["status"]),
        payload=         decode_json(row["payload_json"]) or {},
        result=          decode_json(row["result_json"]),
        error=           decode_json(row["error_json"]),
        progress=        int(row["progress"] or 0),
        progress_label=  row["progress_label"],
        idempotency_key= row["idempotency_key"],
        attempts=        int(row["attempts"] or 0),
        max_attempts=    int(row["max_attempts"] or DEFAULT_MAX_ATTEMPTS),
        timeout_s=       int(row["timeout_s"]) if row["timeout_s"] is not None else None,
        metadata=        decode_json(row["metadata_json"]) or {},
        created_at=      row["created_at"],
        queued_at=       row["queued_at"],
        started_at=      row["started_at"],
        finished_at=     row["finished_at"],
        cancelled_at=    row["cancelled_at"],
        updated_at=      row["updated_at"],
    )


# ══════════════════════════════════════════════════════════════════════════════
# Writes
# ══════════════════════════════════════════════════════════════════════════════

def insert(record: JobRecord) -> JobRecord:
    """Persist a new job row. The store fills `id`, `created_at`,
    `queued_at`, `updated_at`. Returns the populated record.

    Raises sqlite3.IntegrityError if the (user_id, kind,
    idempotency_key) tuple collides — the manager catches this and
    returns the existing row.
    """
    _ensure_init()
    if not record.user_id:
        raise ValueError("jobs.insert: user_id is required")
    if not record.kind:
        raise ValueError("jobs.insert: kind is required")

    rid = _new_id()
    now = _now()
    status = normalize_status(record.status or STATUS_QUEUED)
    try:
        with _conn() as c:
            c.execute(
                "INSERT INTO jobs ("
                "id, kind, user_id, project_id, agent_id, status, "
                "payload_json, result_json, error_json, progress, progress_label, "
                "idempotency_key, attempts, max_attempts, timeout_s, metadata_json, "
                "created_at, queued_at, updated_at"
                ") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    rid, record.kind, str(record.user_id), record.project_id, record.agent_id,
                    status,
                    encode_json(record.payload) or "{}",
                    encode_json(record.result),
                    encode_json(record.error),
                    int(max(0, min(100, record.progress or 0))),
                    record.progress_label,
                    record.idempotency_key,
                    int(record.attempts or 0),
                    int(record.max_attempts or DEFAULT_MAX_ATTEMPTS),
                    int(record.timeout_s) if record.timeout_s else None,
                    encode_json(record.metadata) or "{}",
                    now, now, now,
                ),
            )
        _bump("inserts")
        out = JobRecord(**{**record.__dict__, "id": rid, "status": status,
                           "created_at": now, "queued_at": now, "updated_at": now})
        return out
    except sqlite3.IntegrityError:
        # Idempotency collision — caller handles.
        raise
    except Exception as e:
        logger.warning("jobs.store.insert user=%s kind=%s error: %s",
                       record.user_id, record.kind, e)
        _bump("inserts", str(e))
        raise


def update(record_id: str, **fields) -> Optional[JobRecord]:
    """Update one or more columns. Whitelisted set of columns; unknown
    keys are silently dropped (defensive — caller must know the schema).

    Returns the updated record, or None if the row doesn't exist."""
    _ensure_init()
    if not record_id:
        return None

    _COLUMNS = {
        "status", "progress", "progress_label", "attempts",
        "started_at", "finished_at", "cancelled_at", "queued_at",
    }
    _JSON_COLUMNS = {"result": "result_json", "error": "error_json",
                     "payload": "payload_json", "metadata": "metadata_json"}

    sets: list[str] = []
    params: list = []
    for k, v in fields.items():
        if k in _COLUMNS:
            sets.append(f"{k}=?")
            if k == "status" and v is not None:
                v = normalize_status(v)
            if k == "progress" and v is not None:
                v = int(max(0, min(100, int(v))))
            params.append(v)
        elif k in _JSON_COLUMNS:
            sets.append(f"{_JSON_COLUMNS[k]}=?")
            params.append(encode_json(v))
    if not sets:
        return get(record_id)
    sets.append("updated_at=?")
    params.append(_now())
    params.append(record_id)

    try:
        with _conn() as c:
            c.execute(f"UPDATE jobs SET {', '.join(sets)} WHERE id=?", params)
        _bump("updates")
        return get(record_id)
    except Exception as e:
        logger.warning("jobs.store.update id=%s error: %s", record_id, e)
        _bump("updates", str(e))
        return None


# ══════════════════════════════════════════════════════════════════════════════
# Reads
# ══════════════════════════════════════════════════════════════════════════════

def get(record_id: str) -> Optional[JobRecord]:
    _ensure_init()
    if not record_id:
        return None
    try:
        with _conn() as c:
            row = c.execute("SELECT * FROM jobs WHERE id=?", (record_id,)).fetchone()
        if row is None:
            return None
        _bump("reads")
        return _row_to_record(row)
    except Exception as e:
        logger.warning("jobs.store.get id=%s error: %s", record_id, e)
        _bump("reads", str(e))
        return None


def get_by_idempotency_key(
    *,
    user_id: str,
    kind: str,
    idempotency_key: str,
) -> Optional[JobRecord]:
    """Return the existing row that matches the dedup key, or None."""
    _ensure_init()
    if not (user_id and kind and idempotency_key):
        return None
    try:
        with _conn() as c:
            row = c.execute(
                "SELECT * FROM jobs WHERE user_id=? AND kind=? AND idempotency_key=?",
                (str(user_id), kind, idempotency_key),
            ).fetchone()
        if row is None:
            return None
        _bump("reads")
        return _row_to_record(row)
    except Exception as e:
        logger.warning("jobs.store.get_by_idempotency_key error: %s", e)
        _bump("reads", str(e))
        return None


def list_for_user(
    user_id: str,
    *,
    project_id: Optional[str] = None,
    agent_id: Optional[str] = None,
    kind: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
) -> list[JobRecord]:
    _ensure_init()
    if not user_id:
        return []
    sql = "SELECT * FROM jobs WHERE user_id=?"
    params: list = [str(user_id)]
    if project_id is not None:
        sql += " AND project_id=?"
        params.append(project_id)
    if agent_id is not None:
        sql += " AND agent_id=?"
        params.append(agent_id)
    if kind is not None:
        sql += " AND kind=?"
        params.append(kind)
    if status is not None:
        sql += " AND status=?"
        params.append(normalize_status(status))
    sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
    params.extend([int(max(1, min(200, limit))), int(max(0, offset))])
    try:
        with _conn() as c:
            rows = c.execute(sql, params).fetchall()
        _bump("lists")
        return [_row_to_record(r) for r in rows]
    except Exception as e:
        logger.warning("jobs.store.list_for_user user=%s error: %s", user_id, e)
        _bump("lists", str(e))
        return []


def list_all(
    *,
    status: Optional[str] = None,
    kind: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
) -> list[JobRecord]:
    """Cross-user list — for OWNER-only routes. Routes MUST gate
    this behind require_owner."""
    _ensure_init()
    sql = "SELECT * FROM jobs WHERE 1=1"
    params: list = []
    if status is not None:
        sql += " AND status=?"
        params.append(normalize_status(status))
    if kind is not None:
        sql += " AND kind=?"
        params.append(kind)
    sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
    params.extend([int(max(1, min(500, limit))), int(max(0, offset))])
    try:
        with _conn() as c:
            rows = c.execute(sql, params).fetchall()
        _bump("lists")
        return [_row_to_record(r) for r in rows]
    except Exception as e:
        logger.warning("jobs.store.list_all error: %s", e)
        _bump("lists", str(e))
        return []


# ══════════════════════════════════════════════════════════════════════════════
# Deletes
# ══════════════════════════════════════════════════════════════════════════════

def delete(record_id: str) -> bool:
    """Hard delete one row. Used by GDPR / test cleanup."""
    _ensure_init()
    try:
        with _conn() as c:
            cur = c.execute("DELETE FROM jobs WHERE id=?", (record_id,))
            ok = cur.rowcount > 0
        if ok:
            _bump("deletes")
        return ok
    except Exception as e:
        logger.warning("jobs.store.delete id=%s error: %s", record_id, e)
        _bump("deletes", str(e))
        return False


def wipe_user(user_id: str) -> int:
    """GDPR forget-me: delete every job for one user."""
    _ensure_init()
    if not user_id:
        return 0
    try:
        with _conn() as c:
            cur = c.execute("DELETE FROM jobs WHERE user_id=?", (str(user_id),))
            return int(cur.rowcount)
    except Exception as e:
        logger.warning("jobs.store.wipe_user user=%s error: %s", user_id, e)
        return 0


# ── Health ───────────────────────────────────────────────────────────────────

def table_counts() -> dict:
    out = {"total": 0, "queued": 0, "running": 0, "succeeded": 0,
           "failed": 0, "cancelled": 0, "retrying": 0}
    try:
        _ensure_init()
        with _conn() as c:
            out["total"] = int(c.execute("SELECT COUNT(*) FROM jobs").fetchone()[0])
            for st in JOB_STATUSES:
                n = c.execute("SELECT COUNT(*) FROM jobs WHERE status=?",
                              (st,)).fetchone()[0]
                out[st] = int(n)
    except Exception:
        pass
    return out


__all__ = [
    "init", "_reset_for_tests",
    "insert", "update", "get",
    "get_by_idempotency_key", "list_for_user", "list_all",
    "delete", "wipe_user",
    "store_stats", "table_counts",
]
