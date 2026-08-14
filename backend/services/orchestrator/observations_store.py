# coding: utf-8
"""Business Brain — Phase 4: connector-neutral OBSERVATION ingestion.

ONE SAFE ENTRANCE FOR "SOMETHING CHANGED"
-----------------------------------------
Future connectors (GitHub, Gmail, Calendar, Analytics, Payments) are built
separately. This module is the single durable seam they will call:

    authenticate → read source → normalize → record_observation(...)

A connector never touches tasks, workflows, decisions, memory tables or
approvals directly. It submits a normalized observation here, and the
deterministic Business Brain assessment decides what (if anything) follows.

WHY NOT THE EXISTING EVENT BUS
------------------------------
`backend.services.events.bus` is an IN-PROCESS, flag-gated, best-effort
pub/sub for realtime UI telemetry: it drops events under backpressure, keeps
nothing across a restart, and has no dedup or scoping. An observation must be
DURABLE (survive restart), IDEMPOTENT (webhook retries must not duplicate),
and (user, project)-scoped. Those are storage guarantees the transport bus
deliberately does not provide, so observations get their own small typed table
in the EXISTING `projects.db` — not a new event system.

OBSERVATION ≠ EXECUTION
-----------------------
Recording an observation creates NO task, NO decision, NO automatic run. The
flow is always: observation → deterministic assessment → maybe candidate
action → prioritization → maybe plan/task → execution policy.

COST: recording is pure SQLite. ZERO model tokens, ZERO embeddings.
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

# Importance hints — coarse, connector-supplied, advisory only.
IMPORTANCE_LOW = "low"
IMPORTANCE_NORMAL = "normal"
IMPORTANCE_HIGH = "high"
_IMPORTANCE_HINTS = (IMPORTANCE_LOW, IMPORTANCE_NORMAL, IMPORTANCE_HIGH)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS observations (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    project_id    TEXT NOT NULL,
    source        TEXT NOT NULL,               -- e.g. "github", "gmail", "analytics"
    kind          TEXT NOT NULL,               -- e.g. "github.issue.opened"
    external_id   TEXT,                        -- provider event id (dedup key)
    summary       TEXT NOT NULL DEFAULT '',
    payload       TEXT NOT NULL DEFAULT '{}',  -- JSON normalized payload OR ref
    importance    TEXT NOT NULL DEFAULT 'normal',
    observed_at   TEXT NOT NULL,               -- when the change happened (source time)
    ingested_at   TEXT NOT NULL                -- when Korvix recorded it
);
CREATE INDEX IF NOT EXISTS ix_obs_project ON observations(project_id, observed_at);
CREATE INDEX IF NOT EXISTS ix_obs_user    ON observations(user_id);
CREATE INDEX IF NOT EXISTS ix_obs_kind    ON observations(project_id, kind);
-- Idempotency: a provider event id is unique within (user, project, source),
-- so webhook retries / polling overlaps never create duplicate observations.
CREATE UNIQUE INDEX IF NOT EXISTS ux_obs_external
    ON observations(user_id, project_id, source, external_id)
    WHERE external_id IS NOT NULL;
"""


def _now() -> str:
    return datetime.utcnow().isoformat() + "Z"


def init_observations_table() -> None:
    try:
        with _sqlite.connection(DB_PATH) as c:
            c.executescript(_SCHEMA)
    except Exception as exc:  # pragma: no cover — defensive
        logger.warning("orchestrator.observations_store.init failed: %s", exc)


def _dump(v: Any) -> str:
    try:
        return json.dumps(v, ensure_ascii=False, default=str)
    except Exception:
        return "{}"


def _load(raw: Optional[str], default: Any) -> Any:
    if not raw:
        return default
    try:
        return json.loads(raw)
    except Exception:
        return default


def _row_to_dict(row) -> dict:
    d = dict(row)
    d["payload"] = _load(d.get("payload"), {})
    return d


def record_observation(
    *,
    user_id: str,
    project_id: str,
    source: str,
    kind: str,
    summary: str = "",
    payload: Optional[dict] = None,
    external_id: Optional[str] = None,
    observed_at: Optional[str] = None,
    importance: str = IMPORTANCE_NORMAL,
) -> Dict[str, Any]:
    """The single connector-neutral ingestion entrance.

    Returns {"id": <str>, "deduplicated": <bool>, "ok": <bool>}:
      * ok=False       → malformed/empty input (rejected, nothing stored).
      * deduplicated=True → an observation with this (user, project, source,
                          external_id) already existed; its id is returned and
                          NOTHING new is written (webhook-retry safe).

    NEVER creates a task/decision/run. Pure storage. Malformed payloads are
    coerced to an empty object rather than raising."""
    if not (user_id and project_id and source and kind):
        return {"id": "", "deduplicated": False, "ok": False}

    init_observations_table()
    now = _now()
    obs_at = str(observed_at) if observed_at else now
    imp = (importance or IMPORTANCE_NORMAL).strip().lower()
    if imp not in _IMPORTANCE_HINTS:
        imp = IMPORTANCE_NORMAL
    payload_json = _dump(payload if isinstance(payload, dict) else ({} if payload is None else {"value": payload}))
    oid = uuid.uuid4().hex[:12]

    try:
        with _sqlite.writer_tx(DB_PATH) as c:
            if external_id:
                existing = c.execute(
                    """SELECT id FROM observations
                       WHERE user_id=? AND project_id=? AND source=? AND external_id=?""",
                    (str(user_id), str(project_id), str(source), str(external_id)),
                ).fetchone()
                if existing is not None:
                    return {"id": str(existing["id"]), "deduplicated": True, "ok": True}
            c.execute(
                """INSERT INTO observations
                   (id, user_id, project_id, source, kind, external_id, summary,
                    payload, importance, observed_at, ingested_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (oid, str(user_id), str(project_id), str(source)[:60],
                 str(kind)[:120], (str(external_id) if external_id else None),
                 str(summary or "")[:600], payload_json, imp, obs_at, now),
            )
        return {"id": oid, "deduplicated": False, "ok": True}
    except Exception as exc:
        # A UNIQUE race (two concurrent identical webhooks) is a dedup, not a
        # failure — resolve to the winner's id.
        if external_id:
            try:
                with _sqlite.connection(DB_PATH) as c:
                    row = c.execute(
                        """SELECT id FROM observations
                           WHERE user_id=? AND project_id=? AND source=? AND external_id=?""",
                        (str(user_id), str(project_id), str(source), str(external_id)),
                    ).fetchone()
                if row is not None:
                    return {"id": str(row["id"]), "deduplicated": True, "ok": True}
            except Exception:
                pass
        logger.warning("orchestrator.observations_store.record failed: %s", exc)
        return {"id": "", "deduplicated": False, "ok": False}


def get_observation(observation_id: str) -> Optional[dict]:
    if not observation_id:
        return None
    try:
        with _sqlite.connection(DB_PATH) as c:
            row = c.execute(
                "SELECT * FROM observations WHERE id=?", (str(observation_id),),
            ).fetchone()
        return _row_to_dict(row) if row else None
    except Exception:
        return None


def list_observations(
    project_id: str, *, kind: Optional[str] = None,
    source: Optional[str] = None, user_id: Optional[str] = None,
    limit: int = 100,
) -> List[dict]:
    """Observations for a project, most-recently-OBSERVED first (source time,
    not ingest time — so a late-arriving old event sorts by when it actually
    happened, never masquerading as the newest change).

    `user_id`, when supplied, additionally scopes the read to that owner — a
    defense-in-depth filter for callers (e.g. the Project Brain aggregate) whose
    entry point is keyed by (user, project) and must never surface another
    user's rows even if handed an unowned project_id. Omitted ⇒ project-only
    scoping (the existing behaviour for the orchestrator assessment)."""
    if not project_id:
        return []
    try:
        clauses = ["project_id=?"]
        params: List[Any] = [str(project_id)]
        if kind:
            clauses.append("kind=?"); params.append(str(kind))
        if source:
            clauses.append("source=?"); params.append(str(source))
        if user_id:
            clauses.append("user_id=?"); params.append(str(user_id))
        params.append(max(1, min(int(limit or 100), 500)))
        with _sqlite.connection(DB_PATH) as c:
            rows = c.execute(
                f"""SELECT * FROM observations WHERE {' AND '.join(clauses)}
                    ORDER BY observed_at DESC, ingested_at DESC LIMIT ?""",
                params,
            ).fetchall()
        return [_row_to_dict(r) for r in rows]
    except Exception:
        return []


def recent_observations(project_id: str, *, user_id: Optional[str] = None,
                        limit: int = 10) -> List[dict]:
    """Bounded recent-observations slice for the Business Brain assessment.
    `user_id` optionally adds owner-scoping (see `list_observations`)."""
    return list_observations(project_id, user_id=user_id, limit=limit)


def observations_stats(project_id: str) -> Dict[str, int]:
    out: Dict[str, int] = {}
    for o in list_observations(project_id, limit=500):
        out[str(o.get("source"))] = out.get(str(o.get("source")), 0) + 1
    return out


__all__ = [
    "IMPORTANCE_LOW", "IMPORTANCE_NORMAL", "IMPORTANCE_HIGH",
    "init_observations_table", "record_observation", "get_observation",
    "list_observations", "recent_observations", "observations_stats",
]
