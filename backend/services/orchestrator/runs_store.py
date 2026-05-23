# coding: utf-8
# Phase 3.4 — Orchestrator runs persistence.
#
# Stores one row per /v2/orchestrate invocation:
#   id           — run_id, also used as RunContext.run_id
#   user_id      — owning user
#   project_id   — optional project namespace (nullable)
#   agent_id     — root agent of this run (typically "supervisor")
#   status       — running | finished | errored
#   started_at   — ISO-8601 UTC
#   finished_at  — ISO-8601 UTC, null until terminal
#   reply_chars  — synth reply length (rough quality signal)
#   trace_steps  — total AgentStep count
#   tool_calls   — total tool invocations (incl. delegate)
#   delegations  — sub-agent spawn count (subset of tool_calls)
#   error        — error message when status='errored'
#   metadata_json — additive bag
#
# Lives in projects.db (same SQLite file as Phase 2's project tables)
# so a project DELETE can optionally cascade to its runs in a future
# migration. For now project_id is a soft FK (nullable, no constraint)
# so runs work even without ENABLE_PROJECTS.

import logging
import os
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime
from typing import Any, Dict, Iterator, List, Optional

logger = logging.getLogger(__name__)

DB_PATH = os.getenv("PROJECTS_DB_PATH", "projects.db")

_LOCK = threading.Lock()
_COUNTS = {
    "runs_created":  0,
    "runs_finished": 0,
    "runs_errored":  0,
    "errors":        0,
    "last_error":    "",
}


def _bump(field_: str, error: str = "") -> None:
    with _LOCK:
        _COUNTS[field_] = _COUNTS.get(field_, 0) + 1
        if error:
            _COUNTS["errors"]     = _COUNTS.get("errors", 0) + 1
            _COUNTS["last_error"] = error[:140]


def runs_stats() -> dict:
    with _LOCK:
        return dict(_COUNTS)


def _now() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


def _dump_json(value: Optional[dict]) -> str:
    import json
    if not value:
        return "{}"
    try:
        return json.dumps(value, ensure_ascii=False, default=str)
    except Exception:
        return "{}"


def _load_json(raw: Optional[str]) -> dict:
    if not raw:
        return {}
    import json
    try:
        v = json.loads(raw)
        return v if isinstance(v, dict) else {}
    except Exception:
        return {}


@contextmanager
def _conn() -> Iterator[sqlite3.Connection]:
    c = sqlite3.connect(DB_PATH, timeout=10)
    try:
        c.row_factory = sqlite3.Row
        yield c
        c.commit()
    finally:
        c.close()


_SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL,
    project_id      TEXT,
    agent_id        TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'running',
    started_at      TEXT NOT NULL,
    finished_at     TEXT,
    reply_chars     INTEGER NOT NULL DEFAULT 0,
    trace_steps     INTEGER NOT NULL DEFAULT 0,
    tool_calls      INTEGER NOT NULL DEFAULT 0,
    delegations     INTEGER NOT NULL DEFAULT 0,
    error           TEXT,
    metadata_json   TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS ix_runs_project ON runs(project_id);
CREATE INDEX IF NOT EXISTS ix_runs_user    ON runs(user_id);
CREATE INDEX IF NOT EXISTS ix_runs_started ON runs(started_at);
"""


def init_runs_table() -> None:
    """Create the runs table if missing. Idempotent."""
    try:
        with _conn() as c:
            c.executescript(_SCHEMA)
    except Exception as exc:
        logger.warning("orchestrator.runs_store.init failed: %s", exc)
        _bump("errors", str(exc))


def create_run(
    *,
    user_id: str,
    agent_id: str,
    project_id: Optional[str] = None,
    run_id: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> str:
    """Insert a new row with status='running'. Returns the run_id."""
    rid = run_id or _new_id()
    now = _now()
    try:
        with _conn() as c:
            c.execute(
                """INSERT INTO runs
                   (id, user_id, project_id, agent_id, status,
                    started_at, metadata_json)
                   VALUES (?, ?, ?, ?, 'running', ?, ?)""",
                (rid, str(user_id), (project_id or None), agent_id, now,
                 _dump_json(metadata)),
            )
        _bump("runs_created")
    except sqlite3.IntegrityError:
        # Caller supplied a clashing run_id — best-effort: return it
        # without re-inserting. Tests / future re-entrancy.
        pass
    except Exception as exc:
        _bump("errors", f"create_run: {exc}")
    return rid


def finish_run(
    run_id: str,
    *,
    reply_chars: int = 0,
    trace_steps: int = 0,
    tool_calls: int = 0,
    delegations: int = 0,
    metadata: Optional[Dict[str, Any]] = None,
) -> bool:
    """Mark a run finished. Returns True on success."""
    now = _now()
    try:
        with _conn() as c:
            row = c.execute(
                "SELECT metadata_json FROM runs WHERE id = ?", (run_id,),
            ).fetchone()
            if not row:
                return False
            merged = {**_load_json(row["metadata_json"]), **(metadata or {})}
            c.execute(
                """UPDATE runs
                   SET status='finished', finished_at=?,
                       reply_chars=?, trace_steps=?, tool_calls=?, delegations=?,
                       metadata_json=?
                   WHERE id=?""",
                (now, int(reply_chars or 0), int(trace_steps or 0),
                 int(tool_calls or 0), int(delegations or 0),
                 _dump_json(merged), run_id),
            )
        _bump("runs_finished")
        return True
    except Exception as exc:
        _bump("errors", f"finish_run: {exc}")
        return False


def error_run(run_id: str, *, error: str, metadata: Optional[Dict[str, Any]] = None) -> bool:
    now = _now()
    try:
        with _conn() as c:
            row = c.execute(
                "SELECT metadata_json FROM runs WHERE id = ?", (run_id,),
            ).fetchone()
            if not row:
                return False
            merged = {**_load_json(row["metadata_json"]), **(metadata or {})}
            c.execute(
                """UPDATE runs
                   SET status='errored', finished_at=?, error=?, metadata_json=?
                   WHERE id=?""",
                (now, str(error or "")[:500], _dump_json(merged), run_id),
            )
        _bump("runs_errored")
        return True
    except Exception as exc:
        _bump("errors", f"error_run: {exc}")
        return False


def get_run(run_id: str) -> Optional[dict]:
    try:
        with _conn() as c:
            row = c.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()
        return _row_to_dict(row) if row else None
    except Exception:
        return None


def list_runs(
    *,
    user_id: Optional[str] = None,
    project_id: Optional[str] = None,
    limit: int = 50,
) -> List[dict]:
    limit = max(1, min(int(limit or 50), 500))
    query = "SELECT * FROM runs WHERE 1=1"
    params: list = []
    if user_id:
        query += " AND user_id = ?"
        params.append(str(user_id))
    if project_id:
        query += " AND project_id = ?"
        params.append(project_id)
    query += " ORDER BY started_at DESC LIMIT ?"
    params.append(limit)
    try:
        with _conn() as c:
            rows = c.execute(query, tuple(params)).fetchall()
        return [_row_to_dict(r) for r in rows]
    except Exception:
        return []


def _row_to_dict(row: sqlite3.Row) -> dict:
    return {
        "id":          row["id"],
        "user_id":     row["user_id"],
        "project_id":  row["project_id"],
        "agent_id":    row["agent_id"],
        "status":      row["status"],
        "started_at":  row["started_at"],
        "finished_at": row["finished_at"],
        "reply_chars": row["reply_chars"],
        "trace_steps": row["trace_steps"],
        "tool_calls":  row["tool_calls"],
        "delegations": row["delegations"],
        "error":       row["error"],
        "metadata":    _load_json(row["metadata_json"]),
    }


__all__ = [
    "init_runs_table",
    "create_run", "finish_run", "error_run",
    "get_run", "list_runs",
    "runs_stats",
]
