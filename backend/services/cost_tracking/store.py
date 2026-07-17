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
                    error_kind    TEXT,
                    error_message TEXT,
                    request_id    TEXT,
                    tool_key     TEXT,
                    tool_units   REAL NOT NULL DEFAULT 0,
                    duration_ms  INTEGER NOT NULL DEFAULT 0,
                    -- Canonical attribution (cost audit). All server-set; a client
                    -- can never author these. Nullable so historical rows infer at read.
                    stage              TEXT,
                    agent              TEXT,
                    sequence_index     INTEGER,
                    parent_call_id     TEXT,
                    retry_reason       TEXT,
                    input_fingerprint  TEXT,
                    output_fingerprint TEXT,
                    context_bytes      INTEGER NOT NULL DEFAULT 0,
                    created_at   TEXT NOT NULL
                );

                -- Maps an opaque background frontend job id → its build_id so a
                -- TERMINAL background result (success or failure), which arrives on
                -- a separate poll request, is recorded against the correct build.
                CREATE TABLE IF NOT EXISTS cost_job_links (
                    job_id               TEXT PRIMARY KEY,
                    build_id             TEXT NOT NULL,
                    user_id              TEXT NOT NULL,
                    created_at           TEXT NOT NULL,
                    terminal_recorded_at TEXT
                );

                -- Maps a stable per-build CLIENT operation key (X-Korvix-Operation-Id)
                -- → build_id + owning user, so an EARLY terminal failure that arrives on
                -- a later request (e.g. a blocked frontend-generation preflight) can
                -- resolve and finalize the correct build without trusting any
                -- client-supplied build id.
                CREATE TABLE IF NOT EXISTS cost_operation_links (
                    op_key     TEXT PRIMARY KEY,
                    build_id   TEXT NOT NULL,
                    user_id    TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_calls_build
                    ON cost_ai_calls (build_id);
                CREATE INDEX IF NOT EXISTS idx_calls_user
                    ON cost_ai_calls (user_id);
                CREATE INDEX IF NOT EXISTS idx_calls_model
                    ON cost_ai_calls (model);
                CREATE INDEX IF NOT EXISTS idx_builds_user
                    ON cost_builds (user_id);
                -- Cost-audit reads scan one build ordered by call sequence; this
                -- covering-ish index keeps that per-build read cheap.
                CREATE INDEX IF NOT EXISTS idx_calls_build_seq
                    ON cost_ai_calls (build_id, sequence_index);
                """
            )
            # Safe, idempotent migration for DBs created before these columns
            # existed (production carries a table from PR #475). ALTER ... ADD
            # COLUMN is a no-op-guarded add; never drops or rewrites data.
            for col_def in (
                "error_kind TEXT", "error_message TEXT", "request_id TEXT",
                # Canonical attribution (cost audit). Additive + nullable so old
                # rows infer their stage/agent at read time (never rewritten).
                "stage TEXT", "agent TEXT", "sequence_index INTEGER",
                "parent_call_id TEXT", "retry_reason TEXT",
                "input_fingerprint TEXT", "output_fingerprint TEXT",
                "context_bytes INTEGER NOT NULL DEFAULT 0",
            ):
                try:
                    conn.execute(f"ALTER TABLE cost_ai_calls ADD COLUMN {col_def}")
                except sqlite3.OperationalError:
                    pass  # column already exists
            # cost_job_links gained a terminal-idempotency marker after PR #477,
            # then input attribution (fingerprint + context size) for background
            # frontend generation, whose terminal record lands on a later poll with
            # no request body — the input attribution is captured at LINK time.
            for col_def in (
                "terminal_recorded_at TEXT",
                "input_fingerprint TEXT", "context_bytes INTEGER NOT NULL DEFAULT 0",
            ):
                try:
                    conn.execute(f"ALTER TABLE cost_job_links ADD COLUMN {col_def}")
                except sqlite3.OperationalError:
                    pass
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


def build_exists(build_id: str) -> bool:
    """True when the build has a row OR at least one recorded call. Used by the
    admin detail route to return 404 for an unknown build instead of an empty
    zero-cost payload."""
    _init()
    with _connect() as conn:
        b = conn.execute(
            "SELECT 1 FROM cost_builds WHERE build_id = ? LIMIT 1", (str(build_id),)
        ).fetchone()
        if b:
            return True
        c = conn.execute(
            "SELECT 1 FROM cost_ai_calls WHERE build_id = ? LIMIT 1", (str(build_id),)
        ).fetchone()
        return bool(c)


# ── Background job → build link (terminal frontend failures) ─────────────────
def link_job(*, job_id: str, build_id: str, user_id: str, created_at: str,
             input_fingerprint: Optional[str] = None, context_bytes: int = 0) -> None:
    """Associate an opaque background frontend job id with its build. Idempotent.
    Captures the frontend-generation INPUT attribution (one-way fingerprint + the
    context size in bytes, never the content) at link time so the terminal record,
    which arrives on a later poll with no request body, can still attribute the
    call's input context."""
    _init()
    with _connect() as conn:
        conn.execute(
            "INSERT INTO cost_job_links (job_id, build_id, user_id, created_at, input_fingerprint, context_bytes) "
            "VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(job_id) DO NOTHING",
            (str(job_id), str(build_id), str(user_id), created_at,
             input_fingerprint, int(context_bytes or 0)),
        )
        conn.commit()


def build_id_for_job(job_id: str) -> Optional[Dict[str, Any]]:
    _init()
    with _connect() as conn:
        row = conn.execute(
            "SELECT build_id, user_id, input_fingerprint, context_bytes "
            "FROM cost_job_links WHERE job_id = ?", (str(job_id),)
        ).fetchone()
        return dict(row) if row else None


# ── Stale-build recovery (owner reaper) ──────────────────────────────────────
def list_running_builds(limit: int = 200,
                        build_ids: Optional[List[str]] = None,
                        user_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Return builds still marked in_progress (analytics status), newest-started
    first. Age filtering is done by the caller in Python from `started_at` so the
    ISO/tz handling is uniform. Read-only — mutates nothing."""
    _init()
    where = ["status = 'in_progress'"]
    params: List[Any] = []
    if user_id:
        where.append("user_id = ?")
        params.append(str(user_id))
    if build_ids:
        ids = [str(b) for b in build_ids][:200]
        where.append(f"build_id IN ({', '.join(['?'] * len(ids))})")
        params.extend(ids)
    sql = (
        "SELECT build_id, user_id, status, started_at, completed_at, label "
        f"FROM cost_builds WHERE {' AND '.join(where)} "
        "ORDER BY started_at DESC LIMIT ?"
    )
    params.append(int(limit))
    with _connect() as conn:
        return [dict(r) for r in conn.execute(sql, params).fetchall()]


def job_link_for_build(build_id: str) -> Optional[Dict[str, Any]]:
    """Return the {job_id, terminal_recorded_at} background link for a build, if
    any — used only to REPORT a linked job in the dry-run (never to poll)."""
    _init()
    with _connect() as conn:
        row = conn.execute(
            "SELECT job_id, terminal_recorded_at FROM cost_job_links WHERE build_id = ? LIMIT 1",
            (str(build_id),),
        ).fetchone()
        return dict(row) if row else None


def has_operation_call(build_id: str, operation_type: str) -> bool:
    """True if a call of this operation_type already exists for the build — used to
    avoid recording a duplicate recovery diagnostic."""
    _init()
    with _connect() as conn:
        row = conn.execute(
            "SELECT 1 FROM cost_ai_calls WHERE build_id = ? AND operation_type = ? LIMIT 1",
            (str(build_id), str(operation_type)),
        ).fetchone()
        return bool(row)


def claim_job_terminal(job_id: str, when: str) -> bool:
    """Atomically claim the ONE terminal recording for a background job. Returns
    True iff this caller won the claim (the link existed and was not yet marked).
    Repeated polls / a poll racing a cancel therefore record the terminal call
    exactly once. Returns False when the link is missing or already claimed."""
    _init()
    with _connect() as conn:
        cur = conn.execute(
            "UPDATE cost_job_links SET terminal_recorded_at = ? "
            "WHERE job_id = ? AND terminal_recorded_at IS NULL",
            (when, str(job_id)),
        )
        conn.commit()
        return cur.rowcount == 1


# ── Client operation key → build link (early terminal finalization) ──────────
def link_operation(*, op_key: str, build_id: str, user_id: str, created_at: str) -> None:
    """Associate a stable client operation key with its build. Idempotent — the
    first (planning) call writes it; later calls of the same build no-op."""
    _init()
    with _connect() as conn:
        conn.execute(
            "INSERT INTO cost_operation_links (op_key, build_id, user_id, created_at) "
            "VALUES (?, ?, ?, ?) ON CONFLICT(op_key) DO NOTHING",
            (str(op_key), str(build_id), str(user_id), created_at),
        )
        conn.commit()


def build_id_for_operation(op_key: str, user_id: str) -> Optional[str]:
    """Resolve a build_id from a client op key, VALIDATED against the owning
    user so a spoofed key can never target another user's build. None if absent."""
    _init()
    with _connect() as conn:
        row = conn.execute(
            "SELECT build_id FROM cost_operation_links WHERE op_key = ? AND user_id = ?",
            (str(op_key), str(user_id)),
        ).fetchone()
        return row["build_id"] if row else None


def finalize_build_if_running(*, build_id: str, status: str, completed_at: str) -> bool:
    """Atomically move a build to a terminal status ONLY if it is still
    in_progress. Returns True iff this call performed the transition — so a
    repeated early failure for the same build does not re-finalize or duplicate
    downstream work."""
    _init()
    with _connect() as conn:
        cur = conn.execute(
            "UPDATE cost_builds SET status = ?, completed_at = ? "
            "WHERE build_id = ? AND status = 'in_progress'",
            (str(status), completed_at, str(build_id)),
        )
        conn.commit()
        return cur.rowcount == 1


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
        "error_code", "error_kind", "error_message", "request_id",
        "tool_key", "tool_units", "duration_ms",
        "stage", "agent", "sequence_index", "parent_call_id", "retry_reason",
        "input_fingerprint", "output_fingerprint", "context_bytes",
        "created_at",
    )
    # SQLite wants ints for the boolean-ish columns.
    with _connect() as conn:
        # Server-authoritative sequence: assign the next monotonic index for this
        # build INSIDE the write transaction when the caller didn't set one. The
        # single-node WAL store serializes writers, so this is race-safe; the
        # index is never accepted from a client. Ordered call replay uses it.
        rec = dict(record)
        if rec.get("sequence_index") is None:
            row = conn.execute(
                "SELECT COALESCE(MAX(sequence_index), -1) + 1 AS n FROM cost_ai_calls WHERE build_id = ?",
                (str(rec.get("build_id")),),
            ).fetchone()
            rec["sequence_index"] = int(row["n"] if row and row["n"] is not None else 0)
        vals = [rec.get(c) for c in cols]
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
        for _t in ("cost_job_links", "cost_operation_links"):
            try:
                conn.execute(f"DELETE FROM {_t}")
            except sqlite3.OperationalError:
                pass
        conn.commit()


__all__ = [
    "DB_PATH", "upsert_build", "complete_build", "get_build_row",
    "insert_call", "list_calls", "aggregate_build", "list_builds",
    "per_build_totals", "usage_by_model", "cost_by_operation",
    "retry_cost_total", "cheapest_and_most_expensive", "counts",
]
