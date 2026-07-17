# coding: utf-8
"""
Cost-tracking durable store (cost_tracking.db).

Same per-subsystem WAL SQLite pattern as
backend/services/ai_guard/store.py and projects/store.py. Single-node
authoritative source of truth for:

  • cost_builds     — one row per Web Build (task #1, #6)
  • cost_ai_calls   — one row per paid AI/API call within a build
                      (task #2, #3, #4)

Build-level aggregates (task #6) are ALWAYS computed from cost_ai_calls
via SQL at read time, so a build's totals are correct regardless of
whether an explicit "completion" event ever fired. The cost_builds row
only carries lifecycle metadata (user, start/finish, status).

All token/cost values are written by the server-side tracker from
provider-reported usage. Nothing here trusts a client payload (task #8).

Every function is defensive and self-initializing. Timestamps are
ISO-8601 UTC strings; the DB path is resolvable to a Railway volume via
COST_TRACKING_DB_PATH so records survive redeploys.
"""
from __future__ import annotations

import json
import logging
import os
import sqlite3
import threading
from contextlib import contextmanager
from typing import Any, Dict, Iterator, List, Optional

from backend.core.paths import resolve_db_path

logger = logging.getLogger(__name__)

DB_PATH = resolve_db_path("cost_tracking.db", "COST_TRACKING_DB_PATH")

_LOCK = threading.Lock()
_INITIALIZED = False


@contextmanager
def _connect() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(DB_PATH, timeout=15.0)
    try:
        conn.row_factory = sqlite3.Row
        try:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA busy_timeout=15000")
            conn.execute("PRAGMA foreign_keys=ON")
        except sqlite3.Error:
            pass
        yield conn
    finally:
        conn.close()


def _init() -> None:
    global _INITIALIZED
    if _INITIALIZED:
        return
    with _LOCK:
        if _INITIALIZED:
            return
        try:
            os.makedirs(os.path.dirname(DB_PATH) or ".", exist_ok=True)
        except OSError:
            pass
        with _connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS cost_builds (
                    build_id      TEXT PRIMARY KEY,
                    user_id       TEXT NOT NULL,
                    status        TEXT NOT NULL DEFAULT 'in_progress',
                    started_at    TEXT NOT NULL,
                    completed_at  TEXT,
                    label         TEXT,
                    meta_json     TEXT
                );

                CREATE TABLE IF NOT EXISTS cost_ai_calls (
                    call_id               TEXT PRIMARY KEY,
                    build_id              TEXT NOT NULL,
                    user_id               TEXT NOT NULL,
                    provider              TEXT NOT NULL DEFAULT '',
                    model                 TEXT NOT NULL DEFAULT '',
                    operation_type        TEXT NOT NULL DEFAULT 'other',
                    request_started_at    TEXT NOT NULL,
                    request_completed_at  TEXT,
                    success               INTEGER NOT NULL DEFAULT 1,
                    retry_number          INTEGER NOT NULL DEFAULT 0,
                    input_tokens          INTEGER NOT NULL DEFAULT 0,
                    output_tokens         INTEGER NOT NULL DEFAULT 0,
                    cached_input_tokens   INTEGER NOT NULL DEFAULT 0,
                    cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
                    reasoning_tokens      INTEGER NOT NULL DEFAULT 0,
                    total_tokens          INTEGER NOT NULL DEFAULT 0,
                    usage_missing         INTEGER NOT NULL DEFAULT 0,
                    input_cost_usd            REAL NOT NULL DEFAULT 0,
                    output_cost_usd           REAL NOT NULL DEFAULT 0,
                    cache_cost_usd            REAL NOT NULL DEFAULT 0,
                    additional_tool_cost_usd  REAL NOT NULL DEFAULT 0,
                    total_call_cost_usd       REAL NOT NULL DEFAULT 0,
                    error_code   TEXT,
                    tool_key     TEXT,
                    tool_units   REAL NOT NULL DEFAULT 0,
                    duration_ms  INTEGER NOT NULL DEFAULT 0,
                    created_at   TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_calls_build
                    ON cost_ai_calls (build_id);
                CREATE INDEX IF NOT EXISTS idx_calls_user
                    ON cost_ai_calls (user_id);
                CREATE INDEX IF NOT EXISTS idx_calls_model
                    ON cost_ai_calls (model);
                CREATE INDEX IF NOT EXISTS idx_builds_user
                    ON cost_builds (user_id);
                """
            )
            conn.commit()
        _INITIALIZED = True


# ── Build lifecycle ──────────────────────────────────────────────────────────
def upsert_build(*, build_id: str, user_id: str, started_at: str,
                 label: Optional[str] = None,
                 meta: Optional[Dict[str, Any]] = None) -> None:
    """Create the build row if absent; never clobbers an existing start
    time or status (idempotent — continuations of the same build call
    this again harmlessly)."""
    _init()
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO cost_builds (build_id, user_id, status, started_at, label, meta_json)
            VALUES (?, ?, 'in_progress', ?, ?, ?)
            ON CONFLICT(build_id) DO NOTHING
            """,
            (str(build_id), str(user_id), started_at, label,
             json.dumps(meta) if meta else None),
        )
        conn.commit()


def complete_build(*, build_id: str, status: str, completed_at: str) -> bool:
    _init()
    with _connect() as conn:
        cur = conn.execute(
            "UPDATE cost_builds SET status = ?, completed_at = ? WHERE build_id = ?",
            (str(status), completed_at, str(build_id)),
        )
        conn.commit()
        return cur.rowcount > 0


def get_build_row(build_id: str) -> Optional[Dict[str, Any]]:
    _init()
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM cost_builds WHERE build_id = ?", (str(build_id),)
        ).fetchone()
        return dict(row) if row else None


# ── Call insertion ───────────────────────────────────────────────────────────
def insert_call(record: Dict[str, Any]) -> None:
    """Persist one AICallRecord dict. Caller supplies every column; the
    store computes nothing about cost (that's the tracker's job)."""
    _init()
    cols = (
        "call_id", "build_id", "user_id", "provider", "model", "operation_type",
        "request_started_at", "request_completed_at", "success", "retry_number",
        "input_tokens", "output_tokens", "cached_input_tokens", "cache_creation_tokens",
        "reasoning_tokens", "total_tokens", "usage_missing",
        "input_cost_usd", "output_cost_usd", "cache_cost_usd",
        "additional_tool_cost_usd", "total_call_cost_usd",
        "error_code", "tool_key", "tool_units", "duration_ms", "created_at",
    )
    vals = [record.get(c) for c in cols]
    # SQLite wants ints for the boolean-ish columns.
    with _connect() as conn:
        conn.execute(
            f"INSERT OR REPLACE INTO cost_ai_calls ({', '.join(cols)}) "
            f"VALUES ({', '.join(['?'] * len(cols))})",
            [
                int(v) if c in ("success", "usage_missing") and isinstance(v, bool) else v
                for c, v in zip(cols, vals)
            ],
        )
        conn.commit()


def list_calls(build_id: str) -> List[Dict[str, Any]]:
    _init()
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM cost_ai_calls WHERE build_id = ? ORDER BY request_started_at, created_at",
            (str(build_id),),
        ).fetchall()
        return [dict(r) for r in rows]


# ── Aggregation (task #6) — always computed from the call rows ───────────────
_AGG_SQL = """
    SELECT
        COALESCE(SUM(input_tokens), 0)          AS total_input_tokens,
        COALESCE(SUM(output_tokens), 0)         AS total_output_tokens,
        COALESCE(SUM(cached_input_tokens), 0)   AS total_cached_tokens,
        COALESCE(SUM(reasoning_tokens), 0)      AS total_reasoning_tokens,
        COUNT(*)                                AS total_ai_calls,
        COALESCE(SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END), 0)        AS failed_calls,
        COALESCE(SUM(CASE WHEN retry_number > 0 THEN 1 ELSE 0 END), 0)   AS retry_calls,
        COALESCE(SUM(usage_missing), 0)         AS usage_missing_calls,
        COALESCE(SUM(input_cost_usd + output_cost_usd + cache_cost_usd), 0) AS total_token_cost_usd,
        COALESCE(SUM(additional_tool_cost_usd), 0)                       AS total_tool_cost_usd,
        COALESCE(SUM(total_call_cost_usd), 0)                           AS total_build_cost_usd,
        COALESCE(SUM(CASE WHEN retry_number > 0 THEN total_call_cost_usd ELSE 0 END), 0) AS retry_cost_usd
    FROM cost_ai_calls
    WHERE build_id = ?
"""


def aggregate_build(build_id: str) -> Dict[str, Any]:
    _init()
    with _connect() as conn:
        row = conn.execute(_AGG_SQL, (str(build_id),)).fetchone()
        agg = dict(row) if row else {}
    # Round the money fields.
    for k in ("total_token_cost_usd", "total_tool_cost_usd",
              "total_build_cost_usd", "retry_cost_usd"):
        agg[k] = round(float(agg.get(k) or 0.0), 6)
    return agg


def list_builds(limit: int = 100, offset: int = 0,
                user_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Builds with their computed aggregates, newest first."""
    _init()
    params: List[Any] = []
    where = ""
    if user_id:
        where = "WHERE b.user_id = ?"
        params.append(str(user_id))
    sql = f"""
        SELECT
            b.build_id, b.user_id, b.status, b.started_at, b.completed_at, b.label,
            COUNT(c.call_id)                                   AS total_ai_calls,
            COALESCE(SUM(c.total_call_cost_usd), 0)            AS total_build_cost_usd,
            COALESCE(SUM(c.input_tokens), 0)                   AS total_input_tokens,
            COALESCE(SUM(c.output_tokens), 0)                  AS total_output_tokens,
            COALESCE(SUM(c.cached_input_tokens), 0)            AS total_cached_tokens,
            COALESCE(SUM(CASE WHEN c.success = 0 THEN 1 ELSE 0 END), 0)      AS failed_calls,
            COALESCE(SUM(CASE WHEN c.retry_number > 0 THEN 1 ELSE 0 END), 0) AS retry_calls,
            COALESCE(SUM(CASE WHEN c.retry_number > 0 THEN c.total_call_cost_usd ELSE 0 END), 0) AS retry_cost_usd
        FROM cost_builds b
        LEFT JOIN cost_ai_calls c ON c.build_id = b.build_id
        {where}
        GROUP BY b.build_id
        ORDER BY b.started_at DESC
        LIMIT ? OFFSET ?
    """
    params.extend([int(limit), int(offset)])
    with _connect() as conn:
        rows = conn.execute(sql, params).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["total_build_cost_usd"] = round(float(d.get("total_build_cost_usd") or 0.0), 6)
            d["retry_cost_usd"] = round(float(d.get("retry_cost_usd") or 0.0), 6)
            # duration
            d["build_duration_seconds"] = _duration_seconds(
                d.get("started_at"), d.get("completed_at"))
            out.append(d)
        return out


# ── Analytics helpers (task #7) ──────────────────────────────────────────────
def per_build_totals(user_id: Optional[str] = None) -> List[float]:
    """Total USD per build (only builds that have at least one call), for
    percentile math in Python (SQLite lacks a percentile function)."""
    _init()
    params: List[Any] = []
    where = ""
    if user_id:
        where = "WHERE c.user_id = ?"
        params.append(str(user_id))
    sql = f"""
        SELECT c.build_id AS bid, COALESCE(SUM(c.total_call_cost_usd), 0) AS total
        FROM cost_ai_calls c
        {where}
        GROUP BY c.build_id
    """
    with _connect() as conn:
        rows = conn.execute(sql, params).fetchall()
        return [float(r["total"] or 0.0) for r in rows]


def usage_by_model() -> List[Dict[str, Any]]:
    _init()
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT
                model,
                COUNT(*)                               AS calls,
                COALESCE(SUM(input_tokens), 0)         AS input_tokens,
                COALESCE(SUM(output_tokens), 0)        AS output_tokens,
                COALESCE(SUM(cached_input_tokens), 0)  AS cached_tokens,
                COALESCE(SUM(reasoning_tokens), 0)     AS reasoning_tokens,
                COALESCE(SUM(total_call_cost_usd), 0)  AS cost_usd
            FROM cost_ai_calls
            GROUP BY model
            ORDER BY cost_usd DESC
            """
        ).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["cost_usd"] = round(float(d.get("cost_usd") or 0.0), 6)
            out.append(d)
        return out


def cost_by_operation() -> List[Dict[str, Any]]:
    _init()
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT
                operation_type,
                COUNT(*)                              AS calls,
                COALESCE(SUM(total_call_cost_usd), 0) AS cost_usd
            FROM cost_ai_calls
            GROUP BY operation_type
            ORDER BY cost_usd DESC
            """
        ).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["cost_usd"] = round(float(d.get("cost_usd") or 0.0), 6)
            out.append(d)
        return out


def retry_cost_total() -> Dict[str, Any]:
    _init()
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT
                COALESCE(SUM(CASE WHEN retry_number > 0 THEN 1 ELSE 0 END), 0)                AS retry_calls,
                COALESCE(SUM(CASE WHEN retry_number > 0 THEN total_call_cost_usd ELSE 0 END), 0) AS retry_cost_usd,
                COALESCE(SUM(total_call_cost_usd), 0)                                          AS total_cost_usd
            FROM cost_ai_calls
            """
        ).fetchone()
        d = dict(row) if row else {}
        d["retry_cost_usd"] = round(float(d.get("retry_cost_usd") or 0.0), 6)
        d["total_cost_usd"] = round(float(d.get("total_cost_usd") or 0.0), 6)
        return d


def cheapest_and_most_expensive(user_id: Optional[str] = None) -> Dict[str, Any]:
    _init()
    params: List[Any] = []
    where = ""
    if user_id:
        where = "WHERE c.user_id = ?"
        params.append(str(user_id))
    sql = f"""
        SELECT c.build_id AS build_id, COALESCE(SUM(c.total_call_cost_usd), 0) AS total
        FROM cost_ai_calls c
        {where}
        GROUP BY c.build_id
        ORDER BY total
    """
    with _connect() as conn:
        rows = conn.execute(sql, params).fetchall()
    if not rows:
        return {"cheapest": None, "most_expensive": None}
    cheapest = {"build_id": rows[0]["build_id"], "total_build_cost_usd": round(float(rows[0]["total"]), 6)}
    most = {"build_id": rows[-1]["build_id"], "total_build_cost_usd": round(float(rows[-1]["total"]), 6)}
    return {"cheapest": cheapest, "most_expensive": most}


def _duration_seconds(started_at: Optional[str], completed_at: Optional[str]) -> float:
    if not started_at or not completed_at:
        return 0.0
    try:
        from datetime import datetime
        a = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
        b = datetime.fromisoformat(completed_at.replace("Z", "+00:00"))
        return max(0.0, round((b - a).total_seconds(), 3))
    except Exception:
        return 0.0


def counts() -> Dict[str, int]:
    _init()
    with _connect() as conn:
        b = conn.execute("SELECT COUNT(*) AS n FROM cost_builds").fetchone()["n"]
        c = conn.execute("SELECT COUNT(*) AS n FROM cost_ai_calls").fetchone()["n"]
    return {"builds": int(b), "calls": int(c)}


def _reset_for_tests() -> None:
    """Drop all rows — used by tests that share the module-level DB path."""
    _init()
    with _connect() as conn:
        conn.execute("DELETE FROM cost_ai_calls")
        conn.execute("DELETE FROM cost_builds")
        conn.commit()


__all__ = [
    "DB_PATH", "upsert_build", "complete_build", "get_build_row",
    "insert_call", "list_calls", "aggregate_build", "list_builds",
    "per_build_totals", "usage_by_model", "cost_by_operation",
    "retry_cost_total", "cheapest_and_most_expensive", "counts",
]
