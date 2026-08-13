# coding: utf-8
"""Business Brain — Phase 2: CANDIDATE ACTIONS.

WHAT A CANDIDATE ACTION IS (and is NOT)
---------------------------------------
A candidate action is a *proposal*: "of the useful things we could do, here is
one, with its evidence, expected impact, confidence, cost and risk." It is the
missing middle of the lifecycle:

    project state / observation → CANDIDATE ACTION → prioritization →
    recommendation → USER/SYSTEM DECISION → plan/task → execution policy

A candidate action is emphatically NOT a decision (that's `decisions_store`),
NOT a task (that's `tasks_store`/the planner), and NOT an approval (that's
`approvals_store`/`execution_policy`). Recording one authorizes nothing. A
high-priority candidate whose capability is APPROVAL_REQUIRED still cannot run
without a durable approval.

STORAGE
-------
One typed table in the EXISTING `projects.db` (hardened `_sqlite`), scoped by
(user, project) — same pattern as `decisions_store`/`plans_store`. Structured
dimensions are stored as coarse, HONEST levels (known/estimated/unknown) so the
ranking never fakes precision. Deduplicated by a stable `dedup_key` so the same
signal observed twice does not spawn duplicate candidates.
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

# ── Status lifecycle ─────────────────────────────────────────────────────
STATUS_PROPOSED = "proposed"
STATUS_ACCEPTED = "accepted"      # promoted toward a decision/plan by user/system
STATUS_DISMISSED = "dismissed"    # explicitly rejected
STATUS_SUPERSEDED = "superseded"  # replaced by a newer candidate for same signal
STATUS_EXECUTED = "executed"      # its work has been carried out
VALID_STATUSES = (STATUS_PROPOSED, STATUS_ACCEPTED, STATUS_DISMISSED,
                  STATUS_SUPERSEDED, STATUS_EXECUTED)
_OPEN_STATUSES = (STATUS_PROPOSED, STATUS_ACCEPTED)

# ── Coarse, honest dimension levels ──────────────────────────────────────
# We deliberately avoid fake numeric precision on impact/cost/risk. "unknown"
# is a first-class value that the prioritizer treats conservatively.
LEVEL_UNKNOWN = "unknown"
IMPACT_LEVELS = ("low", "medium", "high", LEVEL_UNKNOWN)
COST_LEVELS = ("low", "medium", "high", LEVEL_UNKNOWN)
RISK_LEVELS = ("low", "medium", "high", LEVEL_UNKNOWN)
URGENCY_LEVELS = ("low", "medium", "high", LEVEL_UNKNOWN)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS candidate_actions (
    id                    TEXT PRIMARY KEY,
    project_id            TEXT NOT NULL,
    user_id               TEXT NOT NULL,
    goal_id               TEXT,
    title                 TEXT NOT NULL,
    detail                TEXT NOT NULL DEFAULT '',
    source                TEXT NOT NULL DEFAULT 'SYSTEM',
    evidence_refs         TEXT NOT NULL DEFAULT '[]',   -- JSON list of {type,ref}
    recommended_capability TEXT,
    impact                TEXT NOT NULL DEFAULT 'unknown',
    confidence            REAL NOT NULL DEFAULT 0.3,
    cost                  TEXT NOT NULL DEFAULT 'unknown',
    risk                  TEXT NOT NULL DEFAULT 'unknown',
    urgency               TEXT NOT NULL DEFAULT 'medium',
    status                TEXT NOT NULL DEFAULT 'proposed',
    dedup_key             TEXT,
    created_at            TEXT NOT NULL,
    updated_at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_candidates_project ON candidate_actions(project_id, status);
CREATE INDEX IF NOT EXISTS ix_candidates_goal    ON candidate_actions(goal_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_candidates_dedup
    ON candidate_actions(project_id, dedup_key) WHERE dedup_key IS NOT NULL;
"""


def _now() -> str:
    return datetime.utcnow().isoformat() + "Z"


def init_candidate_actions_table() -> None:
    try:
        with _sqlite.connection(DB_PATH) as c:
            c.executescript(_SCHEMA)
    except Exception as exc:  # pragma: no cover — defensive
        logger.warning("orchestrator.candidate_actions_store.init failed: %s", exc)


def _dump(v: Any) -> str:
    try:
        return json.dumps(v, ensure_ascii=False, default=str)
    except Exception:
        return "[]"


def _load(raw: Optional[str], default: Any) -> Any:
    if not raw:
        return default
    try:
        return json.loads(raw)
    except Exception:
        return default


def _one_of(value: Optional[str], allowed: tuple, default: str) -> str:
    v = (value or "").strip().lower()
    return v if v in allowed else default


def _clamp_conf(value: Optional[float]) -> float:
    try:
        v = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 0.3
    if v != v:  # NaN
        return 0.3
    return max(0.0, min(1.0, v))


def _normalize_evidence(raw: Any) -> List[dict]:
    """Bounded list of {type, ref} evidence pointers. Missing evidence is
    allowed but should lower confidence at the callsite — we never invent it."""
    if not isinstance(raw, list):
        return []
    out: List[dict] = []
    for item in raw[:20]:
        if isinstance(item, dict):
            entry = {}
            if item.get("type"):
                entry["type"] = str(item["type"])[:40]
            if item.get("ref"):
                entry["ref"] = str(item["ref"])[:200]
            if item.get("note"):
                entry["note"] = str(item["note"])[:240]
            if entry:
                out.append(entry)
        elif isinstance(item, str) and item.strip():
            out.append({"ref": item.strip()[:200]})
    return out


def _row_to_dict(row) -> dict:
    d = dict(row)
    d["evidence_refs"] = _load(d.get("evidence_refs"), [])
    return d


def record_candidate_action(
    *,
    project_id: str,
    user_id: str,
    title: str,
    detail: str = "",
    goal_id: Optional[str] = None,
    source: str = "SYSTEM",
    evidence_refs: Optional[List[Any]] = None,
    recommended_capability: Optional[str] = None,
    impact: str = LEVEL_UNKNOWN,
    confidence: Optional[float] = None,
    cost: str = LEVEL_UNKNOWN,
    risk: str = LEVEL_UNKNOWN,
    urgency: str = "medium",
    dedup_key: Optional[str] = None,
) -> str:
    """Record a candidate action. Returns its id ("" on invalid input).

    When `dedup_key` is provided and an OPEN candidate already exists for
    (project, dedup_key), that row is UPDATED in place (its dimensions and
    updated_at refreshed) rather than inserting a duplicate — so repeated
    observations of the same signal converge on one candidate. A dedup hit
    against a closed (dismissed/executed) candidate inserts a fresh one."""
    if not (project_id and user_id and (title or "").strip()):
        return ""
    init_candidate_actions_table()
    now = _now()
    ev = _dump(_normalize_evidence(evidence_refs))
    imp = _one_of(impact, IMPACT_LEVELS, LEVEL_UNKNOWN)
    cst = _one_of(cost, COST_LEVELS, LEVEL_UNKNOWN)
    rsk = _one_of(risk, RISK_LEVELS, LEVEL_UNKNOWN)
    urg = _one_of(urgency, URGENCY_LEVELS, "medium")
    conf = _clamp_conf(confidence if confidence is not None else 0.3)
    cap = (str(recommended_capability).strip().lower() if recommended_capability else None)

    try:
        with _sqlite.writer_tx(DB_PATH) as c:
            if dedup_key:
                row = c.execute(
                    """SELECT id, status FROM candidate_actions
                       WHERE project_id=? AND dedup_key=?""",
                    (str(project_id), str(dedup_key)),
                ).fetchone()
                if row is not None and str(row["status"]) in _OPEN_STATUSES:
                    c.execute(
                        """UPDATE candidate_actions
                           SET title=?, detail=?, goal_id=?, source=?,
                               evidence_refs=?, recommended_capability=?,
                               impact=?, confidence=?, cost=?, risk=?, urgency=?,
                               updated_at=?
                           WHERE id=?""",
                        (str(title)[:300], str(detail or "")[:2000],
                         (goal_id or None), str(source or "SYSTEM")[:40], ev, cap,
                         imp, conf, cst, rsk, urg, now, row["id"]),
                    )
                    return str(row["id"])
                if row is not None:
                    # Closed candidate holds the dedup_key (partial unique
                    # index). Retire it so the fresh insert can take the key.
                    c.execute(
                        "UPDATE candidate_actions SET dedup_key=NULL, updated_at=? WHERE id=?",
                        (now, row["id"]),
                    )
            cid = uuid.uuid4().hex[:12]
            c.execute(
                """INSERT INTO candidate_actions
                   (id, project_id, user_id, goal_id, title, detail, source,
                    evidence_refs, recommended_capability, impact, confidence,
                    cost, risk, urgency, status, dedup_key, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?, ?)""",
                (cid, str(project_id), str(user_id), (goal_id or None),
                 str(title)[:300], str(detail or "")[:2000],
                 str(source or "SYSTEM")[:40], ev, cap, imp, conf, cst, rsk, urg,
                 (str(dedup_key) if dedup_key else None), now, now),
            )
            return cid
    except Exception as exc:
        logger.warning("orchestrator.candidate_actions_store.record failed: %s", exc)
        return ""


def get_candidate_action(candidate_id: str) -> Optional[dict]:
    if not candidate_id:
        return None
    try:
        with _sqlite.connection(DB_PATH) as c:
            row = c.execute(
                "SELECT * FROM candidate_actions WHERE id=?", (str(candidate_id),),
            ).fetchone()
        return _row_to_dict(row) if row else None
    except Exception:
        return None


def list_candidate_actions(
    project_id: str, *, status: Optional[str] = None,
    open_only: bool = False, limit: int = 100,
) -> List[dict]:
    """Candidate actions for a project, newest first. `open_only` returns
    proposed+accepted; `status` filters to one exact status."""
    if not project_id:
        return []
    try:
        with _sqlite.connection(DB_PATH) as c:
            if status:
                rows = c.execute(
                    """SELECT * FROM candidate_actions
                       WHERE project_id=? AND status=?
                       ORDER BY created_at DESC LIMIT ?""",
                    (str(project_id), _one_of(status, VALID_STATUSES, STATUS_PROPOSED),
                     max(1, min(int(limit or 100), 500))),
                ).fetchall()
            elif open_only:
                rows = c.execute(
                    f"""SELECT * FROM candidate_actions
                        WHERE project_id=? AND status IN ({','.join('?' * len(_OPEN_STATUSES))})
                        ORDER BY created_at DESC LIMIT ?""",
                    (str(project_id), *_OPEN_STATUSES, max(1, min(int(limit or 100), 500))),
                ).fetchall()
            else:
                rows = c.execute(
                    """SELECT * FROM candidate_actions WHERE project_id=?
                       ORDER BY created_at DESC LIMIT ?""",
                    (str(project_id), max(1, min(int(limit or 100), 500))),
                ).fetchall()
        return [_row_to_dict(r) for r in rows]
    except Exception:
        return []


def set_status(candidate_id: str, status: str) -> bool:
    if get_candidate_action(candidate_id) is None:
        return False
    try:
        with _sqlite.connection(DB_PATH) as c:
            cur = c.execute(
                "UPDATE candidate_actions SET status=?, updated_at=? WHERE id=?",
                (_one_of(status, VALID_STATUSES, STATUS_PROPOSED), _now(),
                 str(candidate_id)),
            )
        return cur.rowcount > 0
    except Exception as exc:
        logger.warning("orchestrator.candidate_actions_store.set_status failed: %s", exc)
        return False


__all__ = [
    "STATUS_PROPOSED", "STATUS_ACCEPTED", "STATUS_DISMISSED",
    "STATUS_SUPERSEDED", "STATUS_EXECUTED", "VALID_STATUSES",
    "LEVEL_UNKNOWN", "IMPACT_LEVELS", "COST_LEVELS", "RISK_LEVELS", "URGENCY_LEVELS",
    "init_candidate_actions_table", "record_candidate_action",
    "get_candidate_action", "list_candidate_actions", "set_status",
]
