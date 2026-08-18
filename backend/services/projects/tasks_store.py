# coding: utf-8
"""Project Workspace — the canonical USER-FACING PROJECT TASK authority.

WHY A NEW AUTHORITY (and why reuse was not possible)
----------------------------------------------------
The audit found four task-shaped concepts, and none of them means "a thing the
user wrote down to move this project forward":

  * `orchestrator.tasks_store`      — one row per `delegate()` call inside a RUN.
                                      Execution/observability state for a DAG
                                      node; it is created by the orchestrator,
                                      keyed to a run, and completing one means
                                      code ran. Exposing these as user tasks
                                      would mean "tick a checkbox" and
                                      "orchestration step finished" share a
                                      table — the semantics do not match.
  * `orchestrator.candidate_actions_store` — PROPOSALS the Business Brain
                                      synthesises. Recording one authorises
                                      nothing, and creating one requires the
                                      candidate-synthesis WRITE path, which the
                                      workspace must never trigger.
  * `orchestrator.plans_store` / `long_horizon_planner` — machine work
                                      decomposition, not a user's to-do list.
  * `agent_tasks`                   — units of work delegated to/by an AGENT.

So this module is ONE small canonical authority for the missing concept. It is
deliberately the smallest thing that is still honest:

    Todo → Doing → Waiting → Done

ORGANIZATIONAL STATE, NEVER PERMISSION TO EXECUTE
-------------------------------------------------
A project task is a note about intent. Creating, moving or completing one
starts NO run, writes NO candidate action, needs NO approval and calls NO
model or provider. The Business Brain lifecycle
(observation → candidate → prioritization → plan → approval → execution) is
untouched: nothing in this module is an entrance to it.

STORAGE + ISOLATION
-------------------
One typed table in the EXISTING `projects.db` (the same file `projects`,
`observations`, `goals` and `decisions` already live in), through the shared
hardened `_sqlite` helper. Every row carries BOTH `project_id` and
`owner_user_id`:

  * the ROUTE gates on the canonical `projects` record (a project the caller
    does not own is 404, existence-hidden — the same rule the workspace read
    uses), and
  * every read and write here additionally filters on `owner_user_id` as
    defense in depth, so even a mis-wired caller cannot cross accounts.

The owner is taken from server auth at the route boundary and stored once; it
is never read from a request body.

COST: pure SQLite. ZERO model tokens, ZERO network.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence

from backend.core.paths import resolve_db_path
from backend.services.orchestrator import _sqlite

logger = logging.getLogger(__name__)

DB_PATH = resolve_db_path("projects.db", "PROJECTS_DB_PATH")

# ── Status vocabulary. Four states, deliberately. Anything richer (blocked-by,
#    assignees, estimates) is project-management software, which this is not.
STATUS_TODO = "todo"
STATUS_DOING = "doing"
STATUS_WAITING = "waiting"
STATUS_DONE = "done"
VALID_STATUSES = (STATUS_TODO, STATUS_DOING, STATUS_WAITING, STATUS_DONE)
#: Everything that is not finished. The workspace summary counts these.
OPEN_STATUSES = (STATUS_DOING, STATUS_TODO, STATUS_WAITING)

# ── Priority. A small ordinal, coarse on purpose — never a score, never a
#    percentage. Used ONLY for deterministic ordering.
PRIORITY_LOW = 1
PRIORITY_NORMAL = 2
PRIORITY_HIGH = 3
VALID_PRIORITIES = (PRIORITY_LOW, PRIORITY_NORMAL, PRIORITY_HIGH)

# ── Provenance. Stable identifiers, never user-facing prose: the frontend
#    renders each through the shipped locale dictionaries.
SOURCE_USER = "user"          # typed by the user
SOURCE_RECOMMENDATION = "recommendation"   # accepted from a Today recommendation
SOURCE_GOAL = "goal"          # captured against a goal
SOURCE_SIGNAL = "signal"      # captured from a connector-derived signal
SOURCE_CHAT = "chat"          # captured from a conversation
VALID_SOURCES = (SOURCE_USER, SOURCE_RECOMMENDATION, SOURCE_GOAL,
                 SOURCE_SIGNAL, SOURCE_CHAT)

MAX_TITLE = 200
MAX_DETAILS = 2000
MAX_ORIGIN_REF = 200
#: Hard cap on any list this store will ever return.
MAX_LIMIT = 200

#: Ordering rank per status — what you are DOING outranks what you have not
#: started, which outranks what is parked, which outranks what is finished.
_STATUS_RANK: Dict[str, int] = {
    STATUS_DOING: 0, STATUS_TODO: 1, STATUS_WAITING: 2, STATUS_DONE: 3,
}

_SCHEMA = """
CREATE TABLE IF NOT EXISTS project_tasks (
    id             TEXT PRIMARY KEY,
    project_id     TEXT NOT NULL,
    owner_user_id  TEXT NOT NULL,
    title          TEXT NOT NULL,
    details        TEXT NOT NULL DEFAULT '',
    status         TEXT NOT NULL DEFAULT 'todo',
    priority       INTEGER NOT NULL DEFAULT 2,
    source         TEXT NOT NULL DEFAULT 'user',
    origin_ref     TEXT NOT NULL DEFAULT '',
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL,
    completed_at   TEXT NOT NULL DEFAULT '',
    archived_at    TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_project_tasks_project
    ON project_tasks(project_id, archived_at, status);
CREATE INDEX IF NOT EXISTS ix_project_tasks_owner
    ON project_tasks(owner_user_id, project_id);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


def init_tasks_table() -> None:
    """Idempotent schema creation. Safe on every import/restart."""
    try:
        with _sqlite.connection(DB_PATH) as c:
            c.executescript(_SCHEMA)
    except Exception as exc:  # pragma: no cover — defensive
        logger.warning("projects.tasks_store.init failed: %s", exc)


def normalize_status(value: Any, *, default: str = STATUS_TODO) -> str:
    s = str(value or "").strip().lower()
    return s if s in VALID_STATUSES else default


def normalize_priority(value: Any, *, default: int = PRIORITY_NORMAL) -> int:
    try:
        p = int(value)
    except (TypeError, ValueError):
        return default
    return p if p in VALID_PRIORITIES else default


def normalize_source(value: Any, *, default: str = SOURCE_USER) -> str:
    s = str(value or "").strip().lower()
    return s if s in VALID_SOURCES else default


def _row_to_dict(row) -> Dict[str, Any]:
    """A stored row → the shape callers get, TOTAL over anything the file can
    hold.

    SQLite columns are dynamically typed, so `priority INTEGER` does not stop a
    non-numeric value being present — from a hand-edited database, a restored
    backup, or a future writer with a bug. A bare `int(...)` here raised
    ValueError out of `list_tasks`, which the workspace projection swallowed
    (the entire task section silently vanished) and the tasks route did not
    (HTTP 500). One malformed row must cost that row's fidelity, never the
    list, so every field is coerced through the same normalizers the write path
    uses and an unknown status/source/priority falls back rather than raising."""
    d = dict(row)
    d["priority"] = normalize_priority(d.get("priority"))
    d["status"] = normalize_status(d.get("status"))
    d["source"] = normalize_source(d.get("source"))
    for field in ("id", "project_id", "owner_user_id", "title", "details",
                  "origin_ref", "created_at", "updated_at", "completed_at",
                  "archived_at"):
        d[field] = "" if d.get(field) is None else str(d.get(field))
    return d


def _sort_key(task: Dict[str, Any]):
    """status rank ASC, priority DESC, created_at ASC, id ASC — total and
    stable, so the same rows always render in the same order."""
    return (
        _STATUS_RANK.get(str(task.get("status")), 9),
        -int(task.get("priority") or PRIORITY_NORMAL),
        str(task.get("created_at") or ""),
        str(task.get("id") or ""),
    )


# ── writes ───────────────────────────────────────────────────────────────────

def create_task(
    *,
    project_id: str,
    owner_user_id: str,
    title: str,
    details: str = "",
    status: str = STATUS_TODO,
    priority: int = PRIORITY_NORMAL,
    source: str = SOURCE_USER,
    origin_ref: str = "",
) -> Optional[Dict[str, Any]]:
    """Create ONE project task. Returns the stored row, or None when the input
    carries no title (an untitled task is not a task) or the write failed.

    This is the ONLY way a task comes into existence: an explicit user action.
    Nothing in Korvix creates a task as a side effect of observing, syncing,
    building or rendering a page."""
    title = str(title or "").strip()[:MAX_TITLE]
    if not (project_id and owner_user_id and title):
        return None
    init_tasks_table()
    tid = _new_id()
    now = _now()
    status = normalize_status(status)
    row = {
        "id": tid,
        "project_id": str(project_id),
        "owner_user_id": str(owner_user_id),
        "title": title,
        "details": str(details or "").strip()[:MAX_DETAILS],
        "status": status,
        "priority": normalize_priority(priority),
        "source": normalize_source(source),
        "origin_ref": str(origin_ref or "").strip()[:MAX_ORIGIN_REF],
        "created_at": now,
        "updated_at": now,
        "completed_at": now if status == STATUS_DONE else "",
        "archived_at": "",
    }
    try:
        with _sqlite.connection(DB_PATH) as c:
            c.execute(
                """INSERT INTO project_tasks
                   (id, project_id, owner_user_id, title, details, status,
                    priority, source, origin_ref, created_at, updated_at,
                    completed_at, archived_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (row["id"], row["project_id"], row["owner_user_id"], row["title"],
                 row["details"], row["status"], row["priority"], row["source"],
                 row["origin_ref"], row["created_at"], row["updated_at"],
                 row["completed_at"], row["archived_at"]),
            )
    except Exception as exc:
        logger.warning("projects.tasks_store.create failed: %s", exc)
        return None
    return row


def update_task(
    task_id: str,
    *,
    project_id: str,
    owner_user_id: str,
    title: Optional[str] = None,
    details: Optional[str] = None,
    status: Optional[str] = None,
    priority: Optional[int] = None,
) -> Optional[Dict[str, Any]]:
    """Edit a task in place. Returns the updated row, or None when the task does
    not exist, is archived, or does not belong to BOTH this project and this
    owner — the caller turns that into the same 404 a missing task gets, so a
    foreign task's existence is never revealed.

    `completed_at` is maintained here rather than accepted from the client: it
    is set when the task first enters `done` and cleared when it leaves, so the
    timestamp can never disagree with the status."""
    current = get_task(task_id, project_id=project_id, owner_user_id=owner_user_id)
    if current is None:
        return None

    new_title = current["title"] if title is None else str(title).strip()[:MAX_TITLE]
    if not new_title:
        return None   # a rename may not empty the task
    new_details = (current["details"] if details is None
                   else str(details).strip()[:MAX_DETAILS])
    new_status = current["status"] if status is None else normalize_status(status)
    new_priority = (int(current["priority"]) if priority is None
                    else normalize_priority(priority))
    now = _now()
    if new_status == STATUS_DONE:
        completed_at = current["completed_at"] or now
    else:
        completed_at = ""

    try:
        with _sqlite.connection(DB_PATH) as c:
            c.execute(
                """UPDATE project_tasks
                   SET title=?, details=?, status=?, priority=?, updated_at=?,
                       completed_at=?
                   WHERE id=? AND project_id=? AND owner_user_id=?
                     AND archived_at=''""",
                (new_title, new_details, new_status, new_priority, now,
                 completed_at, str(task_id), str(project_id), str(owner_user_id)),
            )
    except Exception as exc:
        logger.warning("projects.tasks_store.update failed: %s", exc)
        return None
    return get_task(task_id, project_id=project_id, owner_user_id=owner_user_id)


def archive_task(task_id: str, *, project_id: str, owner_user_id: str) -> bool:
    """Remove a task from the user's view.

    Implemented as a SOFT archive: the row is stamped and then excluded from
    every read this module offers. Nothing else in Korvix reads project tasks,
    so the user-visible effect is a delete, while the row remains available for
    support/forensics rather than being silently unrecoverable."""
    if not (task_id and project_id and owner_user_id):
        return False
    init_tasks_table()
    try:
        with _sqlite.connection(DB_PATH) as c:
            cur = c.execute(
                """UPDATE project_tasks SET archived_at=?, updated_at=?
                   WHERE id=? AND project_id=? AND owner_user_id=?
                     AND archived_at=''""",
                (_now(), _now(), str(task_id), str(project_id), str(owner_user_id)),
            )
            return cur.rowcount > 0
    except Exception as exc:
        logger.warning("projects.tasks_store.archive failed: %s", exc)
        return False


# ── reads ────────────────────────────────────────────────────────────────────

def get_task(task_id: str, *, project_id: str,
             owner_user_id: str) -> Optional[Dict[str, Any]]:
    """ONE task, only if it belongs to this project AND this owner and is not
    archived. There is deliberately no "get by id alone" — every caller must
    prove both scopes."""
    if not (task_id and project_id and owner_user_id):
        return None
    init_tasks_table()
    try:
        with _sqlite.connection(DB_PATH) as c:
            row = c.execute(
                """SELECT * FROM project_tasks
                   WHERE id=? AND project_id=? AND owner_user_id=?
                     AND archived_at=''""",
                (str(task_id), str(project_id), str(owner_user_id)),
            ).fetchone()
        return _row_to_dict(row) if row else None
    except Exception as exc:
        logger.debug("projects.tasks_store.get failed: %s", exc)
        return None


def list_tasks(
    project_id: str,
    *,
    owner_user_id: str,
    statuses: Optional[Sequence[str]] = None,
    limit: int = 100,
) -> List[Dict[str, Any]]:
    """This project's non-archived tasks for THIS owner, in the canonical order
    (see `_sort_key`).

    Bounded twice, deliberately: the SQL takes the newest `MAX_LIMIT` rows and
    `limit` then clamps what is returned. A project past that hard cap therefore
    shows its most recent tasks rather than an unbounded list — and
    `count_by_status`, which is a real aggregate, keeps reporting the true
    totals, so the page's counts stay honest even when its list is capped."""
    if not (project_id and owner_user_id):
        return []
    init_tasks_table()
    bound = max(1, min(int(limit or 100), MAX_LIMIT))
    wanted = None
    if statuses:
        wanted = {normalize_status(s, default="") for s in statuses}
        wanted.discard("")
        if not wanted:
            return []
    try:
        with _sqlite.connection(DB_PATH) as c:
            rows = c.execute(
                """SELECT * FROM project_tasks
                   WHERE project_id=? AND owner_user_id=? AND archived_at=''
                   ORDER BY created_at DESC LIMIT ?""",
                (str(project_id), str(owner_user_id), MAX_LIMIT),
            ).fetchall()
    except Exception as exc:
        logger.debug("projects.tasks_store.list failed: %s", exc)
        return []
    out = [_row_to_dict(r) for r in rows]
    if wanted is not None:
        out = [t for t in out if t["status"] in wanted]
    out.sort(key=_sort_key)
    return out[:bound]


def count_by_status(project_id: str, *, owner_user_id: str) -> Dict[str, int]:
    """Non-archived task counts per status plus an `open` total. Every status is
    present (0 when empty) so the frontend never has to guess a missing key."""
    counts = {s: 0 for s in VALID_STATUSES}
    counts["open"] = 0
    if not (project_id and owner_user_id):
        return counts
    init_tasks_table()
    try:
        with _sqlite.connection(DB_PATH) as c:
            rows = c.execute(
                """SELECT status, COUNT(*) AS n FROM project_tasks
                   WHERE project_id=? AND owner_user_id=? AND archived_at=''
                   GROUP BY status""",
                (str(project_id), str(owner_user_id)),
            ).fetchall()
    except Exception as exc:
        logger.debug("projects.tasks_store.count failed: %s", exc)
        return counts
    for row in rows:
        # Normalized, NOT skipped, so the counts agree with what `list_tasks`
        # actually renders: both treat an unrecognised stored status as `todo`
        # rather than one hiding the row and the other showing it.
        status = normalize_status(row["status"])
        counts[status] = counts.get(status, 0) + int(row["n"] or 0)
    counts["open"] = sum(counts[s] for s in OPEN_STATUSES)
    return counts


def purge_project(project_id: str) -> int:
    """Hard-delete every task for a project. Called when the PROJECT itself is
    deleted — the soft archive is for a task the user removed, not for rows
    whose project no longer exists. Returns the number of rows removed."""
    if not project_id:
        return 0
    init_tasks_table()
    try:
        with _sqlite.connection(DB_PATH) as c:
            cur = c.execute("DELETE FROM project_tasks WHERE project_id=?",
                            (str(project_id),))
            return int(cur.rowcount or 0)
    except Exception as exc:
        logger.debug("projects.tasks_store.purge failed: %s", exc)
        return 0


__all__ = [
    "STATUS_TODO", "STATUS_DOING", "STATUS_WAITING", "STATUS_DONE",
    "VALID_STATUSES", "OPEN_STATUSES",
    "PRIORITY_LOW", "PRIORITY_NORMAL", "PRIORITY_HIGH", "VALID_PRIORITIES",
    "SOURCE_USER", "SOURCE_RECOMMENDATION", "SOURCE_GOAL", "SOURCE_SIGNAL",
    "SOURCE_CHAT", "VALID_SOURCES",
    "MAX_TITLE", "MAX_DETAILS", "MAX_LIMIT",
    "init_tasks_table", "normalize_status", "normalize_priority",
    "normalize_source", "create_task", "update_task", "archive_task",
    "get_task", "list_tasks", "count_by_status", "purge_project",
]
