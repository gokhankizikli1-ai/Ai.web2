# coding: utf-8
"""
Phase 8 — Analysis cache (vision.db).

Tiny SQLite table — one row per (asset_id) holding the most-recent
analysis result. Re-analyzing the same asset overwrites the row
(versioning is overkill at Phase 8).
"""
from __future__ import annotations

import json
import logging
import os
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Iterator, Optional

from backend.services.vision.types import AnalysisResult


logger = logging.getLogger(__name__)


def _db_path() -> str:
    return os.getenv("VISION_DB_PATH", "vision.db")


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
CREATE TABLE IF NOT EXISTS asset_analyses (
    asset_id      TEXT PRIMARY KEY,
    detected_type TEXT NOT NULL,
    result_json   TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);
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
            logger.info("vision.store initialized | db=%s", _db_path())
        except Exception as e:
            logger.warning("vision.store.init failed: %s", e)


def _reset_for_tests() -> None:
    global _INITIALIZED
    with _LOCK:
        _INITIALIZED = False


def _ensure_init() -> None:
    if not _INITIALIZED:
        init()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def upsert(result: AnalysisResult) -> AnalysisResult:
    _ensure_init()
    if not result.asset_id:
        raise ValueError("vision.store.upsert: asset_id required")
    now = _now()
    try:
        with _conn() as c:
            c.execute(
                "INSERT INTO asset_analyses (asset_id, detected_type, result_json, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?) "
                "ON CONFLICT(asset_id) DO UPDATE SET "
                "detected_type=excluded.detected_type, "
                "result_json=excluded.result_json, "
                "updated_at=excluded.updated_at",
                (result.asset_id, result.detected_type,
                 json.dumps(result.to_dict()),
                 result.created_at or now, now),
            )
        return result
    except Exception as e:
        logger.warning("vision.store.upsert %s error: %s", result.asset_id, e)
        return result


def get(asset_id: str) -> Optional[dict]:
    _ensure_init()
    if not asset_id:
        return None
    try:
        with _conn() as c:
            row = c.execute(
                "SELECT * FROM asset_analyses WHERE asset_id=?",
                (asset_id,),
            ).fetchone()
        if row is None:
            return None
        try:
            return json.loads(row["result_json"])
        except Exception:
            return None
    except Exception as e:
        logger.warning("vision.store.get %s error: %s", asset_id, e)
        return None


def table_counts() -> dict:
    out = {"total": 0}
    try:
        _ensure_init()
        with _conn() as c:
            row = c.execute("SELECT COUNT(*) AS n FROM asset_analyses").fetchone()
            out["total"] = int(row["n"] or 0)
    except Exception:
        pass
    return out


__all__ = ["init", "_reset_for_tests", "upsert", "get", "table_counts"]
