# coding: utf-8
"""
Phase 8 — Assets SQLite store.

Dedicated `assets.db` file (override via ASSETS_DB_PATH). Mirrors
the Phase 6/7 store pattern: TEXT primary keys, ISO-8601 UTC
timestamps, soft delete via deleted_at, partial indexes WHERE
deleted_at IS NULL.

The DB row carries ONLY metadata + the storage key. Bytes live
under the storage backend (LocalAssetStorage by default).
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

from backend.services.assets.types import (
    AssetRecord, normalize_status,
    ASSET_TYPES, ASSET_TYPE_UNKNOWN,
)


logger = logging.getLogger(__name__)


def _db_path() -> str:
    return os.getenv("ASSETS_DB_PATH", "assets.db")


_LOCK = threading.Lock()
_COUNTS: dict[str, object] = {
    "inserts": 0, "updates": 0, "reads": 0, "lists": 0,
    "soft_deletes": 0, "errors": 0, "last_error": "",
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


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    return uuid.uuid4().hex


@contextmanager
def _conn() -> Iterator[sqlite3.Connection]:
    c = sqlite3.connect(_db_path(), timeout=10)
    try:
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA foreign_keys = ON")
        c.execute("PRAGMA journal_mode = WAL")
        yield c
        c.commit()
    finally:
        c.close()


_SCHEMA = """
CREATE TABLE IF NOT EXISTS assets (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    project_id    TEXT,
    chat_id       TEXT,
    message_id    TEXT,
    filename      TEXT NOT NULL,
    mime_type     TEXT NOT NULL,
    size_bytes    INTEGER NOT NULL DEFAULT 0,
    storage_path  TEXT NOT NULL,
    asset_type    TEXT NOT NULL DEFAULT 'unknown',
    status        TEXT NOT NULL DEFAULT 'uploaded',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    deleted_at    TEXT
);

CREATE INDEX IF NOT EXISTS ix_assets_user        ON assets(user_id)            WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_assets_user_project ON assets(user_id, project_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_assets_user_message ON assets(user_id, message_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_assets_type        ON assets(asset_type)         WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_assets_created     ON assets(created_at)         WHERE deleted_at IS NULL;
"""


_INITIALIZED = False


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
            logger.info("assets.store initialized | db=%s", _db_path())
        except Exception as e:
            logger.warning("assets.store.init failed: %s", e)
            _bump("init_failed", str(e))


def _ensure_init() -> None:
    if not _INITIALIZED:
        init()


def _reset_for_tests() -> None:
    global _INITIALIZED
    with _LOCK:
        _INITIALIZED = False


def _safe_json(raw: Optional[str]) -> dict:
    if not raw:
        return {}
    try:
        v = json.loads(raw)
        return v if isinstance(v, dict) else {}
    except Exception:
        return {}


def _row_to_record(row: sqlite3.Row) -> AssetRecord:
    return AssetRecord(
        id=           row["id"],
        user_id=      row["user_id"],
        project_id=   row["project_id"],
        chat_id=      row["chat_id"],
        message_id=   row["message_id"],
        filename=     row["filename"],
        mime_type=    row["mime_type"],
        size_bytes=   int(row["size_bytes"] or 0),
        storage_path= row["storage_path"],
        asset_type=   row["asset_type"] or ASSET_TYPE_UNKNOWN,
        status=       normalize_status(row["status"]),
        metadata=     _safe_json(row["metadata_json"]),
        created_at=   row["created_at"],
        updated_at=   row["updated_at"],
        deleted_at=   row["deleted_at"],
    )


# ── Writes ───────────────────────────────────────────────────────────────────

def insert(record: AssetRecord) -> AssetRecord:
    _ensure_init()
    if not record.user_id:
        raise ValueError("assets.insert: user_id required")
    if not record.filename:
        raise ValueError("assets.insert: filename required")
    rid = _new_id()
    now = _now()
    try:
        with _conn() as c:
            c.execute(
                "INSERT INTO assets ("
                "id, user_id, project_id, chat_id, message_id, "
                "filename, mime_type, size_bytes, storage_path, "
                "asset_type, status, metadata_json, "
                "created_at, updated_at"
                ") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    rid, str(record.user_id), record.project_id,
                    record.chat_id, record.message_id,
                    record.filename, record.mime_type,
                    int(record.size_bytes or 0), record.storage_path,
                    record.asset_type, normalize_status(record.status),
                    json.dumps(record.metadata or {}),
                    now, now,
                ),
            )
        _bump("inserts")
        out = AssetRecord(**{**record.__dict__, "id": rid,
                              "created_at": now, "updated_at": now})
        return out
    except Exception as e:
        logger.warning("assets.store.insert user=%s error: %s",
                       record.user_id, e)
        _bump("inserts", str(e))
        raise


def update(record_id: str, **fields) -> Optional[AssetRecord]:
    _ensure_init()
    if not record_id:
        return None
    _COLUMNS = {"status", "message_id", "chat_id", "project_id"}
    _JSON_COLUMNS = {"metadata": "metadata_json"}
    sets, params = [], []
    for k, v in fields.items():
        if k in _COLUMNS:
            if k == "status" and v is not None:
                v = normalize_status(v)
            sets.append(f"{k}=?"); params.append(v)
        elif k in _JSON_COLUMNS:
            sets.append(f"{_JSON_COLUMNS[k]}=?")
            params.append(json.dumps(v or {}))
    if not sets:
        return get(record_id)
    sets.append("updated_at=?"); params.append(_now())
    params.append(record_id)
    try:
        with _conn() as c:
            c.execute(f"UPDATE assets SET {', '.join(sets)} WHERE id=?", params)
        _bump("updates")
        return get(record_id)
    except Exception as e:
        logger.warning("assets.store.update id=%s error: %s", record_id, e)
        _bump("updates", str(e))
        return None


# ── Reads ────────────────────────────────────────────────────────────────────

def get(record_id: str) -> Optional[AssetRecord]:
    _ensure_init()
    if not record_id:
        return None
    try:
        with _conn() as c:
            row = c.execute(
                "SELECT * FROM assets WHERE id=? AND deleted_at IS NULL",
                (record_id,),
            ).fetchone()
        if row is None:
            return None
        _bump("reads")
        return _row_to_record(row)
    except Exception as e:
        logger.warning("assets.store.get id=%s error: %s", record_id, e)
        _bump("reads", str(e))
        return None


def list_for_user(
    user_id: str,
    *,
    project_id: Optional[str] = None,
    chat_id: Optional[str] = None,
    asset_type: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
) -> list[AssetRecord]:
    _ensure_init()
    if not user_id:
        return []
    sql = "SELECT * FROM assets WHERE user_id=? AND deleted_at IS NULL"
    params: list = [str(user_id)]
    if project_id is not None:
        sql += " AND project_id=?"
        params.append(project_id)
    if chat_id is not None:
        sql += " AND chat_id=?"
        params.append(chat_id)
    if asset_type is not None and asset_type in ASSET_TYPES:
        sql += " AND asset_type=?"
        params.append(asset_type)
    sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
    params.extend([int(max(1, min(200, limit))), int(max(0, offset))])
    try:
        with _conn() as c:
            rows = c.execute(sql, params).fetchall()
        _bump("lists")
        return [_row_to_record(r) for r in rows]
    except Exception as e:
        logger.warning("assets.store.list_for_user user=%s error: %s",
                       user_id, e)
        _bump("lists", str(e))
        return []


def list_for_message(user_id: str, message_id: str) -> list[AssetRecord]:
    """Return assets attached to one chat message owned by user_id.
    Always ownership-checked."""
    _ensure_init()
    if not user_id or not message_id:
        return []
    try:
        with _conn() as c:
            rows = c.execute(
                "SELECT * FROM assets WHERE user_id=? AND message_id=? AND deleted_at IS NULL "
                "ORDER BY created_at ASC",
                (str(user_id), message_id),
            ).fetchall()
        return [_row_to_record(r) for r in rows]
    except Exception:
        return []


def list_by_ids(user_id: str, ids: list[str]) -> list[AssetRecord]:
    """Look up multiple assets at once, ownership-checked. Used by
    chat_request → asset_ids to fold attachments into the system prompt."""
    _ensure_init()
    if not user_id or not ids:
        return []
    # Strict allowlist of hex IDs so we never interpolate untrusted strings.
    clean: list[str] = [str(i) for i in ids
                        if isinstance(i, str) and i and len(i) <= 128]
    if not clean:
        return []
    placeholders = ",".join(["?"] * len(clean))
    sql = (f"SELECT * FROM assets WHERE user_id=? AND id IN ({placeholders}) "
           "AND deleted_at IS NULL ORDER BY created_at ASC")
    try:
        with _conn() as c:
            rows = c.execute(sql, [str(user_id), *clean]).fetchall()
        return [_row_to_record(r) for r in rows]
    except Exception:
        return []


# ── Soft delete ──────────────────────────────────────────────────────────────

def soft_delete(record_id: str, *, user_id: Optional[str] = None) -> bool:
    _ensure_init()
    if not record_id:
        return False
    now = _now()
    sql = "UPDATE assets SET deleted_at=?, updated_at=? WHERE id=? AND deleted_at IS NULL"
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
        logger.warning("assets.store.soft_delete id=%s error: %s", record_id, e)
        _bump("soft_deletes", str(e))
        return False


# ── Health ───────────────────────────────────────────────────────────────────

def table_counts() -> dict:
    out = {"total": 0, "active": 0, "deleted": 0}
    try:
        _ensure_init()
        with _conn() as c:
            row = c.execute(
                "SELECT "
                "COUNT(*) AS total, "
                "SUM(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END) AS active, "
                "SUM(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END) AS deleted "
                "FROM assets"
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
    "insert", "update", "get",
    "list_for_user", "list_for_message", "list_by_ids",
    "soft_delete",
    "store_stats", "table_counts",
]
