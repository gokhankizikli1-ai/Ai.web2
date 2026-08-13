# coding: utf-8
"""Business Brain — Phase 1: durable GOAL hierarchy.

WHY THIS EXISTS (and what it is NOT)
------------------------------------
The `long_horizon_planner` answers "what WORK should exist?"; this store
answers "what OUTCOME does that work serve?". A GOAL is the durable "why":
a first-class, provenance-tagged, supersedable-by-status record of an
objective the user/company is pursuing. Before this, the "why" lived only
in a free-text `user_goal` string on a run — a later capability could not
ask "which goal does this serve?" or "what does success mean?".

This is NOT a second planner and NOT a second decision store. A goal is not
a task and not a decision. It is a small typed table living in the EXISTING
`projects.db` (hardened `_sqlite`), scoped by (user, project), exactly like
`decisions_store` / `plans_store`. The planner and Project Intelligence read
it; nothing here executes work.

HIERARCHY
---------
The smallest useful shape: a goal may have ONE parent goal, forming a tree
(workspace/business goal → project goal → milestone). Arbitrary horizon
layers (annual/quarterly/…) are deliberately NOT modelled — only the parent
link, which is enough to trace alignment. Cycles are structurally prevented
on write.

SUCCESS CRITERIA
----------------
Structured, evidence-friendly criteria are stored as JSON (e.g.
`{"metric": "paying_users", "op": ">=", "target": 100}`). They are recorded
truthfully — the store never asserts a criterion is MET; measuring that is
the metrics/experiments authorities' job (Phases 5/6).
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

# ── Canonical status vocabulary ──────────────────────────────────────────
STATUS_ACTIVE = "active"
STATUS_ACHIEVED = "achieved"
STATUS_PAUSED = "paused"
STATUS_ABANDONED = "abandoned"
VALID_STATUSES = (STATUS_ACTIVE, STATUS_ACHIEVED, STATUS_PAUSED, STATUS_ABANDONED)

# Priority is a small ordinal; higher = more important. Kept coarse.
PRIORITY_LOW = 1
PRIORITY_NORMAL = 2
PRIORITY_HIGH = 3
PRIORITY_CRITICAL = 4
_VALID_PRIORITIES = (PRIORITY_LOW, PRIORITY_NORMAL, PRIORITY_HIGH, PRIORITY_CRITICAL)

# Depth guard so a pathological parent chain can never blow the stack or a
# query budget. A business/project/milestone tree is 3 deep in practice.
_MAX_DEPTH = 12

_SCHEMA = """
CREATE TABLE IF NOT EXISTS project_goals (
    id                TEXT PRIMARY KEY,
    project_id        TEXT NOT NULL,
    user_id           TEXT NOT NULL,
    title             TEXT NOT NULL,
    description       TEXT NOT NULL DEFAULT '',
    status            TEXT NOT NULL DEFAULT 'active',
    priority          INTEGER NOT NULL DEFAULT 2,
    parent_id         TEXT,
    success_criteria  TEXT NOT NULL DEFAULT '[]',   -- JSON list of structured criteria
    target_metric_key TEXT,                          -- optional metric_key reference
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_goals_project ON project_goals(project_id, status);
CREATE INDEX IF NOT EXISTS ix_goals_parent  ON project_goals(parent_id);
CREATE INDEX IF NOT EXISTS ix_goals_user    ON project_goals(user_id);
"""


class GoalCycleError(ValueError):
    """Raised when linking a parent would create a cycle (or self-parent)."""


class GoalNotFoundError(ValueError):
    """Raised when a referenced parent goal does not exist / is out of scope."""


def _now() -> str:
    return datetime.utcnow().isoformat() + "Z"


def init_goals_table() -> None:
    try:
        with _sqlite.connection(DB_PATH) as c:
            c.executescript(_SCHEMA)
    except Exception as exc:  # pragma: no cover — defensive
        logger.warning("orchestrator.goals_store.init failed: %s", exc)


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


def _normalize_status(status: Optional[str]) -> str:
    s = (status or "").strip().lower()
    return s if s in VALID_STATUSES else STATUS_ACTIVE


def _normalize_priority(priority: Optional[int]) -> int:
    try:
        p = int(priority)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return PRIORITY_NORMAL
    return p if p in _VALID_PRIORITIES else PRIORITY_NORMAL


def _normalize_criteria(raw: Any) -> List[dict]:
    """Coerce success criteria into a bounded list of structured dicts.

    Accepts a list of dicts (kept as-is, shallow-validated) or strings
    (wrapped as {"text": ...}). Never invents a target/value. Bounded to
    20 entries so a goal can't carry an unbounded payload."""
    if not isinstance(raw, list):
        return []
    out: List[dict] = []
    for item in raw[:20]:
        if isinstance(item, dict):
            entry = {k: item[k] for k in ("metric", "op", "target", "text", "unit")
                     if k in item}
            if entry:
                out.append(entry)
        elif isinstance(item, str) and item.strip():
            out.append({"text": item.strip()[:240]})
    return out


def _row_to_dict(row) -> dict:
    d = dict(row)
    d["success_criteria"] = _load(d.get("success_criteria"), [])
    return d


def create_goal(
    *,
    project_id: str,
    user_id: str,
    title: str,
    description: str = "",
    status: str = STATUS_ACTIVE,
    priority: int = PRIORITY_NORMAL,
    parent_id: Optional[str] = None,
    success_criteria: Optional[List[Any]] = None,
    target_metric_key: Optional[str] = None,
) -> str:
    """Create a goal. Returns its id ("" on invalid input).

    A `parent_id` is validated to exist, to belong to the SAME project, and
    to not create a cycle (a fresh insert can only self-reference, which is
    rejected). Raises GoalNotFoundError / GoalCycleError on a bad parent so
    the caller learns exactly why rather than getting a silent no-op."""
    if not (project_id and user_id and (title or "").strip()):
        return ""
    init_goals_table()
    gid = uuid.uuid4().hex[:12]
    now = _now()

    if parent_id:
        parent = get_goal(parent_id)
        if parent is None or str(parent.get("project_id")) != str(project_id):
            raise GoalNotFoundError(f"parent goal {parent_id!r} not found in project")
        if str(parent_id) == gid:  # impossible for a fresh uuid, defensive
            raise GoalCycleError("a goal cannot be its own parent")

    try:
        with _sqlite.connection(DB_PATH) as c:
            c.execute(
                """INSERT INTO project_goals
                   (id, project_id, user_id, title, description, status,
                    priority, parent_id, success_criteria, target_metric_key,
                    created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (gid, str(project_id), str(user_id), str(title)[:300],
                 str(description or "")[:2000], _normalize_status(status),
                 _normalize_priority(priority), (parent_id or None),
                 _dump(_normalize_criteria(success_criteria)),
                 (str(target_metric_key)[:120] if target_metric_key else None),
                 now, now),
            )
        return gid
    except Exception as exc:
        logger.warning("orchestrator.goals_store.create failed: %s", exc)
        return ""


def get_goal(goal_id: str) -> Optional[dict]:
    if not goal_id:
        return None
    try:
        with _sqlite.connection(DB_PATH) as c:
            row = c.execute(
                "SELECT * FROM project_goals WHERE id=?", (str(goal_id),),
            ).fetchone()
        return _row_to_dict(row) if row else None
    except Exception:
        return None


def list_goals(
    project_id: str, *, status: Optional[str] = None, limit: int = 200,
) -> List[dict]:
    """All goals for a project (optionally filtered by status), newest first."""
    if not project_id:
        return []
    try:
        with _sqlite.connection(DB_PATH) as c:
            if status:
                rows = c.execute(
                    """SELECT * FROM project_goals
                       WHERE project_id=? AND status=?
                       ORDER BY priority DESC, created_at DESC LIMIT ?""",
                    (str(project_id), _normalize_status(status),
                     max(1, min(int(limit or 200), 500))),
                ).fetchall()
            else:
                rows = c.execute(
                    """SELECT * FROM project_goals WHERE project_id=?
                       ORDER BY priority DESC, created_at DESC LIMIT ?""",
                    (str(project_id), max(1, min(int(limit or 200), 500))),
                ).fetchall()
        return [_row_to_dict(r) for r in rows]
    except Exception:
        return []


def active_goals(project_id: str, *, limit: int = 50) -> List[dict]:
    """Current (status='active') goals, highest priority first. This is the
    slice Project Intelligence and the prioritizer consume."""
    return list_goals(project_id, status=STATUS_ACTIVE, limit=limit)


def children_of(goal_id: str) -> List[dict]:
    if not goal_id:
        return []
    try:
        with _sqlite.connection(DB_PATH) as c:
            rows = c.execute(
                """SELECT * FROM project_goals WHERE parent_id=?
                   ORDER BY priority DESC, created_at DESC""",
                (str(goal_id),),
            ).fetchall()
        return [_row_to_dict(r) for r in rows]
    except Exception:
        return []


def ancestors_of(goal_id: str) -> List[dict]:
    """The parent chain from the immediate parent up to the root, in order.
    Bounded by `_MAX_DEPTH` so a corrupt chain can never loop forever."""
    out: List[dict] = []
    seen = {str(goal_id)}
    cur = get_goal(goal_id)
    depth = 0
    while cur and cur.get("parent_id") and depth < _MAX_DEPTH:
        pid = str(cur["parent_id"])
        if pid in seen:  # defensive — a persisted cycle should be impossible
            break
        seen.add(pid)
        parent = get_goal(pid)
        if parent is None:
            break
        out.append(parent)
        cur = parent
        depth += 1
    return out


def _would_create_cycle(goal_id: str, new_parent_id: str) -> bool:
    """True when making `new_parent_id` the parent of `goal_id` would form a
    cycle — i.e. `goal_id` is `new_parent_id` itself or one of its ancestors."""
    if str(goal_id) == str(new_parent_id):
        return True
    chain = ancestors_of(new_parent_id)
    return any(str(a.get("id")) == str(goal_id) for a in chain)


def update_goal(
    goal_id: str,
    *,
    title: Optional[str] = None,
    description: Optional[str] = None,
    priority: Optional[int] = None,
    parent_id: Optional[str] = None,
    success_criteria: Optional[List[Any]] = None,
    target_metric_key: Optional[str] = None,
    _unset_parent: bool = False,
) -> bool:
    """Partial update. Only provided fields change. Re-parenting is
    cycle-checked. Returns True when a row was updated.

    Pass `_unset_parent=True` to detach a goal (make it a root)."""
    existing = get_goal(goal_id)
    if existing is None:
        return False

    fields: List[str] = []
    params: List[Any] = []

    if title is not None:
        fields.append("title=?"); params.append(str(title)[:300])
    if description is not None:
        fields.append("description=?"); params.append(str(description)[:2000])
    if priority is not None:
        fields.append("priority=?"); params.append(_normalize_priority(priority))
    if success_criteria is not None:
        fields.append("success_criteria=?")
        params.append(_dump(_normalize_criteria(success_criteria)))
    if target_metric_key is not None:
        fields.append("target_metric_key=?")
        params.append(str(target_metric_key)[:120] if target_metric_key else None)

    if _unset_parent:
        fields.append("parent_id=?"); params.append(None)
    elif parent_id is not None:
        parent = get_goal(parent_id)
        if parent is None or str(parent.get("project_id")) != str(existing.get("project_id")):
            raise GoalNotFoundError(f"parent goal {parent_id!r} not found in project")
        if _would_create_cycle(goal_id, parent_id):
            raise GoalCycleError("re-parenting would create a cycle")
        fields.append("parent_id=?"); params.append(str(parent_id))

    if not fields:
        return False

    fields.append("updated_at=?"); params.append(_now())
    params.append(str(goal_id))
    try:
        with _sqlite.connection(DB_PATH) as c:
            cur = c.execute(
                f"UPDATE project_goals SET {', '.join(fields)} WHERE id=?", params,
            )
        return cur.rowcount > 0
    except Exception as exc:
        logger.warning("orchestrator.goals_store.update failed: %s", exc)
        return False


def set_status(goal_id: str, status: str) -> bool:
    """Transition a goal's lifecycle status. Deterministic; any of the four
    canonical statuses is reachable from any other (a paused goal may be
    reactivated, an abandoned goal revived, etc.)."""
    if get_goal(goal_id) is None:
        return False
    try:
        with _sqlite.connection(DB_PATH) as c:
            cur = c.execute(
                "UPDATE project_goals SET status=?, updated_at=? WHERE id=?",
                (_normalize_status(status), _now(), str(goal_id)),
            )
        return cur.rowcount > 0
    except Exception as exc:
        logger.warning("orchestrator.goals_store.set_status failed: %s", exc)
        return False


def goals_stats(project_id: str) -> Dict[str, int]:
    """Count of goals by status for a project — cheap health/summary read."""
    out: Dict[str, int] = {}
    for g in list_goals(project_id):
        out[str(g.get("status"))] = out.get(str(g.get("status")), 0) + 1
    return out


__all__ = [
    "STATUS_ACTIVE", "STATUS_ACHIEVED", "STATUS_PAUSED", "STATUS_ABANDONED",
    "VALID_STATUSES",
    "PRIORITY_LOW", "PRIORITY_NORMAL", "PRIORITY_HIGH", "PRIORITY_CRITICAL",
    "GoalCycleError", "GoalNotFoundError",
    "init_goals_table", "create_goal", "get_goal", "list_goals",
    "active_goals", "children_of", "ancestors_of", "update_goal",
    "set_status", "goals_stats",
]
