# coding: utf-8
"""
Admin action audit log.

Append-only SQLite ledger of every action taken by an owner-mode user.
Lives in its own file (`admin_audit.db` by default — override with
ADMIN_AUDIT_DB_PATH) so an accidental delete of `auth.db` can never
take the audit trail down with it.

Schema:
  admin_audit_log
    id           INTEGER PRIMARY KEY AUTOINCREMENT
    ts           TEXT  NOT NULL  -- ISO 8601 UTC
    user_id      TEXT  NOT NULL  -- auth_users.id
    user_email   TEXT             -- denormalised for fast queries
    action       TEXT  NOT NULL  -- short verb e.g. "view.diagnostics"
    path         TEXT             -- request path when applicable
    ip           TEXT             -- request.client.host when available
    status       TEXT  NOT NULL  -- "ok" | "denied" | "blocked"
    metadata_json TEXT NOT NULL DEFAULT '{}'

Design notes:
  - No UPDATE / DELETE APIs are exported. The whole point of an audit
    log is that the audited subject can't tidy it up.
  - Best-effort writes: a DB outage MUST NOT block an admin action.
    `record()` swallows exceptions, logs a warning, and returns False.
  - Reads are paginated by ts DESC. The `tail(limit)` helper is the
    only retrieval API; that intentional asymmetry signals the table
    is for forensic review, not application logic.
"""
from __future__ import annotations

import contextlib
import json
import logging
import os
import sqlite3
import threading
from datetime import datetime, timezone
from typing import Any, Dict, Iterator, List, Optional


logger = logging.getLogger(__name__)


_LOCK = threading.Lock()
_INITIALIZED = False


_DEFAULT_PATH = "admin_audit.db"


def _db_path() -> str:
    from backend.core.paths import resolve_db_path
    return resolve_db_path(_DEFAULT_PATH, "ADMIN_AUDIT_DB_PATH")


@contextlib.contextmanager
def _conn() -> Iterator[sqlite3.Connection]:
    c = sqlite3.connect(_db_path(), timeout=10)
    try:
        c.row_factory = sqlite3.Row
        yield c
        c.commit()
    finally:
        c.close()


_DDL = """
CREATE TABLE IF NOT EXISTS admin_audit_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    ts            TEXT NOT NULL,
    user_id       TEXT NOT NULL,
    user_email    TEXT,
    action        TEXT NOT NULL,
    path          TEXT,
    ip            TEXT,
    status        TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS ix_admin_audit_ts
    ON admin_audit_log(ts DESC);
CREATE INDEX IF NOT EXISTS ix_admin_audit_user
    ON admin_audit_log(user_id, ts DESC);
"""


def init() -> None:
    """Create the audit table if missing. Idempotent."""
    global _INITIALIZED
    if _INITIALIZED:
        return
    with _LOCK:
        if _INITIALIZED:
            return
        with _conn() as c:
            c.executescript(_DDL)
        _INITIALIZED = True
        logger.info("admin.audit initialized | db=%s", _db_path())


def _reset_for_tests() -> None:
    """Test-only hook to force re-init against a new DB file."""
    global _INITIALIZED
    _INITIALIZED = False


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def record(
    *,
    user_id: str,
    action: str,
    status: str = "ok",
    user_email: Optional[str] = None,
    path: Optional[str] = None,
    ip: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> bool:
    """Append a row to the audit log. Returns True on success, False on
    any failure (logged at WARNING level). Never raises.

    Caller is responsible for trimming or hashing anything sensitive
    before passing it as metadata — this layer stores whatever it
    receives.
    """
    try:
        init()
        meta_json = json.dumps(metadata or {}, ensure_ascii=False, default=str)[:8192]
    except Exception as exc:
        logger.warning("admin.audit init/encode failed: %s", exc)
        return False
    try:
        with _conn() as c:
            c.execute(
                "INSERT INTO admin_audit_log "
                "(ts, user_id, user_email, action, path, ip, status, metadata_json) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    _now_iso(),
                    user_id,
                    user_email,
                    action[:128],
                    path[:256] if path else None,
                    ip[:64] if ip else None,
                    status[:32],
                    meta_json,
                ),
            )
        return True
    except Exception as exc:
        logger.warning("admin.audit record failed: %s", exc)
        return False


def tail(limit: int = 50, user_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Return the most recent `limit` audit rows (newest first).

    If `user_id` is provided, scoped to that user. Useful for the
    /v2/admin/audit endpoint which shows the current owner their own
    recent actions.
    """
    try:
        init()
    except Exception as exc:
        logger.warning("admin.audit init failed on read: %s", exc)
        return []
    limit = max(1, min(int(limit or 50), 500))
    rows: List[Dict[str, Any]] = []
    try:
        with _conn() as c:
            if user_id:
                cur = c.execute(
                    "SELECT * FROM admin_audit_log "
                    "WHERE user_id = ? "
                    "ORDER BY ts DESC LIMIT ?",
                    (user_id, limit),
                )
            else:
                cur = c.execute(
                    "SELECT * FROM admin_audit_log "
                    "ORDER BY ts DESC LIMIT ?",
                    (limit,),
                )
            for row in cur.fetchall():
                meta: Dict[str, Any] = {}
                try:
                    meta = json.loads(row["metadata_json"] or "{}")
                    if not isinstance(meta, dict):
                        meta = {}
                except Exception:
                    meta = {}
                rows.append({
                    "id":         row["id"],
                    "ts":         row["ts"],
                    "user_id":    row["user_id"],
                    "user_email": row["user_email"],
                    "action":     row["action"],
                    "path":       row["path"],
                    "ip":         row["ip"],
                    "status":     row["status"],
                    "metadata":   meta,
                })
    except Exception as exc:
        logger.warning("admin.audit tail failed: %s", exc)
        return []
    return rows


def count(user_id: Optional[str] = None) -> int:
    """Total audit rows. Used by tests and by the /v2/admin/status
    response (so the UI can show "23 actions logged today" etc.)."""
    try:
        init()
        with _conn() as c:
            if user_id:
                cur = c.execute(
                    "SELECT COUNT(*) AS n FROM admin_audit_log WHERE user_id = ?",
                    (user_id,),
                )
            else:
                cur = c.execute("SELECT COUNT(*) AS n FROM admin_audit_log")
            row = cur.fetchone()
            return int(row["n"]) if row else 0
    except Exception as exc:
        logger.warning("admin.audit count failed: %s", exc)
        return 0


__all__ = ["init", "record", "tail", "count"]
