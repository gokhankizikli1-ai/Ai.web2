# coding: utf-8
"""Phase 5 (connected brain) — durable Project Decisions.

A DECISION is a durable conclusion the project has reached ("pricing = $19",
"MVP includes low-stock alerts"). Before this, important choices lived only
inside deliverable prose — a later capability had to re-read old text to learn
them. Decisions make them first-class, provenance-tagged, and SUPERSEDABLE, so
a later Web/App Build receives the CURRENT decision, not a stale one.

This is NOT a second memory system: it is a small typed table in the existing
`projects.db` (hardened `_sqlite`), scoped by project, keyed by a stable
`topic` so a newer decision on the same topic supersedes the older one
deterministically (no LLM, no prose scanning).
"""
from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from backend.core.paths import resolve_db_path
from backend.services.orchestrator import _sqlite

logger = logging.getLogger(__name__)

DB_PATH = resolve_db_path("projects.db", "PROJECTS_DB_PATH")

# Provenance sources.
SOURCE_USER = "USER"
SOURCE_RESEARCH = "RESEARCH"
SOURCE_PRODUCT = "PRODUCT"
SOURCE_BUILD = "BUILD"
SOURCE_SYSTEM = "SYSTEM"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS project_decisions (
    id            TEXT PRIMARY KEY,
    project_id    TEXT NOT NULL,
    user_id       TEXT NOT NULL,
    topic         TEXT NOT NULL,           -- stable key, e.g. "pricing"
    value         TEXT NOT NULL,           -- the decision, e.g. "$19/mo"
    source        TEXT NOT NULL DEFAULT 'SYSTEM',
    reason        TEXT NOT NULL DEFAULT '',
    run_id        TEXT,
    task_id       TEXT,
    deliverable_id TEXT,
    status        TEXT NOT NULL DEFAULT 'active',   -- active | superseded
    superseded_by TEXT,
    created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_decisions_project ON project_decisions(project_id, status);
CREATE INDEX IF NOT EXISTS ix_decisions_topic   ON project_decisions(project_id, topic, status);
"""


def _now() -> str:
    return datetime.utcnow().isoformat() + "Z"


def init_decisions_table() -> None:
    try:
        with _sqlite.connection(DB_PATH) as c:
            c.executescript(_SCHEMA)
    except Exception as exc:  # pragma: no cover — defensive
        logger.warning("orchestrator.decisions_store.init failed: %s", exc)


def record_decision(
    *,
    project_id: str,
    user_id: str,
    topic: str,
    value: str,
    source: str = SOURCE_SYSTEM,
    reason: str = "",
    run_id: Optional[str] = None,
    task_id: Optional[str] = None,
    deliverable_id: Optional[str] = None,
) -> str:
    """Record a decision, SUPERSEDING any prior active decision on the same
    (project, topic). Atomic (BEGIN IMMEDIATE) so a race can't leave two
    active decisions for one topic. Returns the new decision id."""
    if not (project_id and topic and value):
        return ""
    init_decisions_table()
    did = uuid.uuid4().hex[:12]
    now = _now()
    try:
        with _sqlite.writer_tx(DB_PATH) as c:
            # Supersede prior actives for this topic.
            c.execute(
                """UPDATE project_decisions
                   SET status='superseded', superseded_by=?
                   WHERE project_id=? AND topic=? AND status='active'""",
                (did, str(project_id), str(topic)),
            )
            c.execute(
                """INSERT INTO project_decisions
                   (id, project_id, user_id, topic, value, source, reason,
                    run_id, task_id, deliverable_id, status, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)""",
                (did, str(project_id), str(user_id), str(topic)[:120],
                 str(value)[:600], str(source or SOURCE_SYSTEM),
                 str(reason or "")[:400], run_id, task_id, deliverable_id, now),
            )
        return did
    except Exception as exc:
        logger.warning("orchestrator.decisions_store.record failed: %s", exc)
        return ""


def _row_to_dict(row) -> dict:
    return dict(row)


def active_decisions(project_id: str, *, limit: int = 50) -> List[dict]:
    """Current (non-superseded) decisions for a project, newest first."""
    if not project_id:
        return []
    try:
        with _sqlite.connection(DB_PATH) as c:
            rows = c.execute(
                """SELECT * FROM project_decisions
                   WHERE project_id=? AND status='active'
                   ORDER BY created_at DESC LIMIT ?""",
                (str(project_id), max(1, min(int(limit or 50), 200))),
            ).fetchall()
        return [_row_to_dict(r) for r in rows]
    except Exception:
        return []


def get_decision(decision_id: str) -> Optional[dict]:
    try:
        with _sqlite.connection(DB_PATH) as c:
            row = c.execute(
                "SELECT * FROM project_decisions WHERE id=?", (decision_id,),
            ).fetchone()
        return _row_to_dict(row) if row else None
    except Exception:
        return None


def history_for_topic(project_id: str, topic: str) -> List[dict]:
    try:
        with _sqlite.connection(DB_PATH) as c:
            rows = c.execute(
                """SELECT * FROM project_decisions
                   WHERE project_id=? AND topic=? ORDER BY created_at ASC""",
                (str(project_id), str(topic)),
            ).fetchall()
        return [_row_to_dict(r) for r in rows]
    except Exception:
        return []


def ingest_decisions_from_content(
    content: Any, *, project_id: str, user_id: str, source: str,
    run_id: Optional[str] = None, task_id: Optional[str] = None,
    deliverable_id: Optional[str] = None,
) -> List[str]:
    """Persist any structured `decisions` a capability emitted in its
    deliverable content. Accepts a list of {topic, value, reason?} dicts.
    Deterministic; ignores malformed entries. Returns recorded ids."""
    if not isinstance(content, dict):
        return []
    raw = content.get("decisions")
    if not isinstance(raw, list):
        return []
    ids: List[str] = []
    for entry in raw[:20]:
        if not isinstance(entry, dict):
            continue
        topic = str(entry.get("topic") or "").strip()
        value = str(entry.get("value") or "").strip()
        if not topic or not value:
            continue
        did = record_decision(
            project_id=project_id, user_id=user_id, topic=topic, value=value,
            source=source, reason=str(entry.get("reason") or ""),
            run_id=run_id, task_id=task_id, deliverable_id=deliverable_id,
        )
        if did:
            ids.append(did)
    return ids


__all__ = [
    "SOURCE_USER", "SOURCE_RESEARCH", "SOURCE_PRODUCT", "SOURCE_BUILD",
    "SOURCE_SYSTEM",
    "init_decisions_table", "record_decision", "active_decisions",
    "get_decision", "history_for_topic", "ingest_decisions_from_content",
]
