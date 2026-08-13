# coding: utf-8
"""Phase 5 — durable execution-approval records.

WHY
---
Before this, Korvix had NO approval concept: any capability the orchestrator
routed executed with no human-in-the-loop gate. Phase 5 adds a durable
approval so an expensive/external operation (a paid Web/App Build, an
external deploy/message) can require a recorded, user-bound approval before
it runs.

BINDING TO A VERSION
--------------------
An approval binds to an operation *fingerprint* — a deterministic hash of
the material fields of the operation (capability + spec). If the plan
materially changes, the fingerprint changes, and the old approval no longer
matches: a changed plan invalidates prior approval automatically, with no
extra bookkeeping. (See `execution_policy.operation_fingerprint`.)

STORAGE
-------
A new `approvals` table in the existing `projects.db`, opened through the
Phase-1 hardened `_sqlite` helper (WAL + busy_timeout + BEGIN IMMEDIATE on
the read-modify-write revoke path). This is NOT a cost ledger — it records
authorization, not money. Additive, idempotent schema; fail-soft like the
other orchestrator stores.
"""
from __future__ import annotations

import logging
import sqlite3
import uuid
from datetime import datetime
from typing import List, Optional

from backend.core.paths import resolve_db_path
from backend.services.orchestrator import _sqlite

logger = logging.getLogger(__name__)

DB_PATH = resolve_db_path("projects.db", "PROJECTS_DB_PATH")

STATUS_ACTIVE = "active"
STATUS_REVOKED = "revoked"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS approvals (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    project_id    TEXT,
    capability    TEXT NOT NULL,
    fingerprint   TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'active',
    approved_by   TEXT NOT NULL DEFAULT '',
    note          TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL,
    revoked_at    TEXT
);
CREATE INDEX IF NOT EXISTS ix_approvals_lookup
    ON approvals(user_id, capability, fingerprint, status);
CREATE INDEX IF NOT EXISTS ix_approvals_project ON approvals(project_id);
"""


def _now() -> str:
    return datetime.utcnow().isoformat() + "Z"


def init_approvals_table() -> None:
    """Create the approvals table if missing. Idempotent; fail-soft."""
    try:
        with _sqlite.connection(DB_PATH) as c:
            c.executescript(_SCHEMA)
    except Exception as exc:  # pragma: no cover — defensive
        logger.warning("orchestrator.approvals_store.init failed: %s", exc)


def record_approval(
    *,
    user_id: str,
    capability: str,
    fingerprint: str,
    project_id: Optional[str] = None,
    approved_by: str = "",
    note: str = "",
) -> str:
    """Record a durable active approval for (user, capability, fingerprint).
    Returns the approval id, or '' on failure."""
    if not (user_id and capability and fingerprint):
        return ""
    init_approvals_table()
    aid = uuid.uuid4().hex[:12]
    try:
        with _sqlite.connection(DB_PATH) as c:
            c.execute(
                """INSERT INTO approvals
                   (id, user_id, project_id, capability, fingerprint, status,
                    approved_by, note, created_at)
                   VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)""",
                (aid, str(user_id), (project_id or None), str(capability),
                 str(fingerprint), str(approved_by or user_id)[:120],
                 str(note or "")[:240], _now()),
            )
        return aid
    except Exception as exc:
        logger.warning("orchestrator.approvals_store.record failed: %s", exc)
        return ""


def is_approved(
    *,
    user_id: str,
    capability: str,
    fingerprint: str,
) -> bool:
    """True iff there is an ACTIVE approval matching exactly this user,
    capability AND fingerprint. A different fingerprint (materially changed
    plan) does not match — old approval is automatically invalid."""
    if not (user_id and capability and fingerprint):
        return False
    try:
        with _sqlite.connection(DB_PATH) as c:
            row = c.execute(
                """SELECT 1 FROM approvals
                   WHERE user_id=? AND capability=? AND fingerprint=?
                     AND status='active' LIMIT 1""",
                (str(user_id), str(capability), str(fingerprint)),
            ).fetchone()
        return row is not None
    except Exception:
        return False


def revoke_for_capability(
    *, user_id: str, capability: str, project_id: Optional[str] = None,
) -> int:
    """Revoke all active approvals for a (user, capability[, project]).
    Used when a plan is regenerated/edited so stale approvals can be
    proactively invalidated. Returns the count revoked."""
    now = _now()
    try:
        with _sqlite.writer_tx(DB_PATH) as c:
            if project_id is None:
                cur = c.execute(
                    """UPDATE approvals SET status='revoked', revoked_at=?
                       WHERE user_id=? AND capability=? AND status='active'""",
                    (now, str(user_id), str(capability)),
                )
            else:
                cur = c.execute(
                    """UPDATE approvals SET status='revoked', revoked_at=?
                       WHERE user_id=? AND capability=? AND project_id=?
                         AND status='active'""",
                    (now, str(user_id), str(capability), str(project_id)),
                )
            return int(cur.rowcount or 0)
    except Exception as exc:
        logger.warning("orchestrator.approvals_store.revoke failed: %s", exc)
        return 0


def list_for_project(project_id: str, *, limit: int = 100) -> List[dict]:
    limit = max(1, min(int(limit or 100), 500))
    try:
        with _sqlite.connection(DB_PATH) as c:
            rows = c.execute(
                """SELECT * FROM approvals WHERE project_id=?
                   ORDER BY created_at DESC LIMIT ?""",
                (str(project_id), limit),
            ).fetchall()
        return [dict(r) for r in rows]
    except Exception:
        return []


__all__ = [
    "STATUS_ACTIVE", "STATUS_REVOKED",
    "init_approvals_table", "record_approval", "is_approved",
    "revoke_for_capability", "list_for_project",
]
