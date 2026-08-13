# coding: utf-8
"""Phase 2 (shared jobs) — Postgres jobs backend.

The shared, cross-replica-durable production jobs authority. Mirrors the
SQLite store's public surface exactly (same JobRecord shape, same JSON-as-TEXT
columns, same ISO-8601 UTC timestamps) so callers are backend-agnostic — the
dispatcher in `store.py` picks this backend when `ENABLE_POSTGRES_BACKEND` +
`DATABASE_URL` are set, else the SQLite store.

Reuses the existing `backend.services.db.engine` sync (psycopg3) pool — no new
DB framework. Schema is additive/idempotent (CREATE ... IF NOT EXISTS).

KEY GUARANTEES vs SQLite:
  * `insert` is ATOMIC-idempotent via `INSERT ... ON CONFLICT ... DO NOTHING
    RETURNING id`: two replicas creating the same logical job yield ONE row;
    the loser gets a JobIdempotencyConflict (no double insert + reconcile).
  * `update` carries the same stale-worker guard (never resurrect a terminal
    job to `running`).

CODE-VERIFIED via mocked-connection SQL-contract tests; NOT live-Postgres
verified (no PG instance in this environment). See PR notes.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Iterator, Optional

from backend.services.db import engine
from backend.services.jobs.types import (
    JobRecord, JOB_STATUSES, STATUS_QUEUED,
    DEFAULT_MAX_ATTEMPTS,
    encode_json, decode_json, normalize_status,
)
from backend.services.jobs.errors import JobIdempotencyConflict

logger = logging.getLogger(__name__)

_TERMINAL_STATUSES = ("succeeded", "failed", "cancelled")

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


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    return uuid.uuid4().hex


def _dict_row():
    from psycopg.rows import dict_row  # lazy — psycopg only on the PG path
    return dict_row


def _cursor(conn):
    # psycopg3: dict rows so column-name access matches the SQLite Row API.
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
    logger.info("jobs.store_pg initialized (postgres)")


def _ensure_init() -> None:
    if not _INITIALIZED:
        init()


def _reset_for_tests() -> None:
    global _INITIALIZED
    _INITIALIZED = False


def _row_to_record(row: dict) -> JobRecord:
    return JobRecord(
        id=row["id"], kind=row["kind"], user_id=row["user_id"],
        project_id=row["project_id"], agent_id=row["agent_id"],
        status=normalize_status(row["status"]),
        payload=decode_json(row["payload_json"]) or {},
        result=decode_json(row["result_json"]),
        error=decode_json(row["error_json"]),
        progress=int(row["progress"] or 0),
        progress_label=row["progress_label"],
        idempotency_key=row["idempotency_key"],
        attempts=int(row["attempts"] or 0),
        max_attempts=int(row["max_attempts"] or DEFAULT_MAX_ATTEMPTS),
        timeout_s=int(row["timeout_s"]) if row["timeout_s"] is not None else None,
        metadata=decode_json(row["metadata_json"]) or {},
        created_at=row["created_at"], queued_at=row["queued_at"],
        started_at=row["started_at"], finished_at=row["finished_at"],
        cancelled_at=row["cancelled_at"], updated_at=row["updated_at"],
    )


# ── Writes ───────────────────────────────────────────────────────────────

def insert(record: JobRecord) -> JobRecord:
    _ensure_init()
    if not record.user_id:
        raise ValueError("jobs.insert: user_id is required")
    if not record.kind:
        raise ValueError("jobs.insert: kind is required")
    rid = _new_id()
    now = _now()
    status = normalize_status(record.status or STATUS_QUEUED)
    # Atomic idempotency: ON CONFLICT on the partial unique index. A conflict
    # returns NO row → the loser raises JobIdempotencyConflict (one canonical
    # job across replicas, no double insert).
    row = _fetchone(
        "INSERT INTO jobs ("
        "id, kind, user_id, project_id, agent_id, status, payload_json, "
        "result_json, error_json, progress, progress_label, idempotency_key, "
        "attempts, max_attempts, timeout_s, metadata_json, created_at, "
        "queued_at, updated_at) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) "
        "ON CONFLICT (user_id, kind, idempotency_key) "
        "WHERE idempotency_key IS NOT NULL DO NOTHING "
        "RETURNING id",
        (
            rid, record.kind, str(record.user_id), record.project_id, record.agent_id,
            status, encode_json(record.payload) or "{}", encode_json(record.result),
            encode_json(record.error), int(max(0, min(100, record.progress or 0))),
            record.progress_label, record.idempotency_key, int(record.attempts or 0),
            int(record.max_attempts or DEFAULT_MAX_ATTEMPTS),
            int(record.timeout_s) if record.timeout_s else None,
            encode_json(record.metadata) or "{}", now, now, now,
        ),
    )
    if row is None:
        raise JobIdempotencyConflict(
            f"idempotency conflict for ({record.user_id}, {record.kind}, "
            f"{record.idempotency_key})")
    return JobRecord(**{**record.__dict__, "id": rid, "status": status,
                       "created_at": now, "queued_at": now, "updated_at": now})


def update(record_id: str, **fields) -> Optional[JobRecord]:
    _ensure_init()
    if not record_id:
        return None
    _COLUMNS = {"status", "progress", "progress_label", "attempts",
                "started_at", "finished_at", "cancelled_at", "queued_at"}
    _JSON_COLUMNS = {"result": "result_json", "error": "error_json",
                     "payload": "payload_json", "metadata": "metadata_json"}
    sets: list[str] = []
    params: list = []
    for k, v in fields.items():
        if k in _COLUMNS:
            sets.append(f"{k}=%s")
            if k == "status" and v is not None:
                v = normalize_status(v)
            if k == "progress" and v is not None:
                v = int(max(0, min(100, int(v))))
            params.append(v)
        elif k in _JSON_COLUMNS:
            sets.append(f"{_JSON_COLUMNS[k]}=%s")
            params.append(encode_json(v))
    if not sets:
        return get(record_id)
    sets.append("updated_at=%s")
    params.append(_now())

    where = "id=%s"
    params.append(record_id)
    new_status = fields.get("status")
    if new_status is not None and normalize_status(new_status) == "running":
        placeholders = ",".join("%s" for _ in _TERMINAL_STATUSES)
        where += f" AND status NOT IN ({placeholders})"
        params.extend(_TERMINAL_STATUSES)

    _execute(f"UPDATE jobs SET {', '.join(sets)} WHERE {where}", tuple(params))
    return get(record_id)


def bump_max_attempts(record_id: str, new_max: int) -> bool:
    _ensure_init()
    if not record_id:
        return False
    _execute("UPDATE jobs SET max_attempts=%s, updated_at=%s WHERE id=%s",
             (int(new_max), _now(), record_id))
    return True


# ── Reads ────────────────────────────────────────────────────────────────

def get(record_id: str) -> Optional[JobRecord]:
    _ensure_init()
    if not record_id:
        return None
    row = _fetchone("SELECT * FROM jobs WHERE id=%s", (record_id,))
    return _row_to_record(row) if row else None


def get_by_idempotency_key(*, user_id: str, kind: str,
                           idempotency_key: str) -> Optional[JobRecord]:
    _ensure_init()
    if not (user_id and kind and idempotency_key):
        return None
    row = _fetchone(
        "SELECT * FROM jobs WHERE user_id=%s AND kind=%s AND idempotency_key=%s",
        (str(user_id), kind, idempotency_key))
    return _row_to_record(row) if row else None


def list_for_user(user_id: str, *, project_id: Optional[str] = None,
                  agent_id: Optional[str] = None, kind: Optional[str] = None,
                  status: Optional[str] = None, limit: int = 50,
                  offset: int = 0) -> list[JobRecord]:
    _ensure_init()
    if not user_id:
        return []
    sql = "SELECT * FROM jobs WHERE user_id=%s"
    params: list = [str(user_id)]
    if project_id is not None:
        sql += " AND project_id=%s"; params.append(project_id)
    if agent_id is not None:
        sql += " AND agent_id=%s"; params.append(agent_id)
    if kind is not None:
        sql += " AND kind=%s"; params.append(kind)
    if status is not None:
        sql += " AND status=%s"; params.append(normalize_status(status))
    sql += " ORDER BY created_at DESC LIMIT %s OFFSET %s"
    params.extend([int(max(1, min(200, limit))), int(max(0, offset))])
    return [_row_to_record(r) for r in _fetchall(sql, tuple(params))]


def list_all(*, status: Optional[str] = None, kind: Optional[str] = None,
             limit: int = 50, offset: int = 0) -> list[JobRecord]:
    _ensure_init()
    sql = "SELECT * FROM jobs WHERE 1=1"
    params: list = []
    if status is not None:
        sql += " AND status=%s"; params.append(normalize_status(status))
    if kind is not None:
        sql += " AND kind=%s"; params.append(kind)
    sql += " ORDER BY created_at DESC LIMIT %s OFFSET %s"
    params.extend([int(max(1, min(500, limit))), int(max(0, offset))])
    return [_row_to_record(r) for r in _fetchall(sql, tuple(params))]


# ── Deletes ──────────────────────────────────────────────────────────────

def delete(record_id: str) -> bool:
    _ensure_init()
    with engine.acquire_sync() as conn:
        with _cursor(conn) as cur:
            cur.execute("DELETE FROM jobs WHERE id=%s", (record_id,))
            ok = (cur.rowcount or 0) > 0
        conn.commit()
    return ok


def wipe_user(user_id: str) -> int:
    _ensure_init()
    if not user_id:
        return 0
    with engine.acquire_sync() as conn:
        with _cursor(conn) as cur:
            cur.execute("DELETE FROM jobs WHERE user_id=%s", (str(user_id),))
            n = int(cur.rowcount or 0)
        conn.commit()
    return n


# ── Health ───────────────────────────────────────────────────────────────

def table_counts() -> dict:
    out = {"total": 0, "queued": 0, "running": 0, "succeeded": 0,
           "failed": 0, "cancelled": 0, "retrying": 0}
    try:
        _ensure_init()
        total = _fetchone("SELECT COUNT(*) AS n FROM jobs")
        out["total"] = int((total or {}).get("n", 0))
        for st in JOB_STATUSES:
            r = _fetchone("SELECT COUNT(*) AS n FROM jobs WHERE status=%s", (st,))
            out[st] = int((r or {}).get("n", 0))
    except Exception:
        pass
    return out


def store_stats() -> dict:
    return {"backend": "postgres"}


__all__ = [
    "init", "_reset_for_tests",
    "insert", "update", "bump_max_attempts", "get",
    "get_by_idempotency_key", "list_for_user", "list_all",
    "delete", "wipe_user",
    "store_stats", "table_counts",
]
