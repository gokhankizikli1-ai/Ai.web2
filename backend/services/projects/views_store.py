# coding: utf-8
"""Project Workspace — the canonical PER-USER, PER-PROJECT LAST-VISIT marker.

WHY THIS EXISTS
---------------
"Since you were away" is only allowed to exist if we actually know when the
user was last here. The audit found no such authority anywhere in Korvix:
`auth_users.last_seen_at` is an ACCOUNT-level login timestamp, agent presence
is a live-worker heartbeat, and neither answers "when did this person last open
THIS project". Rather than dress a fixed time window up as a visit ("Since you
were away — last 7 days" is a lie), this adds the smallest possible authority
that makes the honest version possible.

WHAT IT IS NOT
--------------
It is VIEWING METADATA and nothing else. It is not project intelligence, not an
activity row, not an observation, and it never appears in the project's own
timeline. Marking a project viewed changes nothing a person would call project
state, so it can never pollute what the project *is* with how often it was
looked at.

THE READ/WRITE SPLIT (the part that is easy to get wrong)
---------------------------------------------------------
Reading the workspace NEVER writes here. If it did, the very act of opening the
page would move the marker to now and the "since your last visit" list would be
empty in the same breath it was computed.

Instead:

    GET  /v2/projects/{id}/workspace        reads the marker; the snapshot's
                                            `changes` block is everything newer
                                            than it. Pure read.
    POST /v2/projects/{id}/workspace/seen   the page's EXPLICIT acknowledgement,
                                            sent after it has rendered.

The acknowledgement carries `seen_through` — the `freshness.generated_at` of
the snapshot the user actually saw. The marker therefore advances to the exact
instant the rendered list was computed at, so anything that happened between
the read and the acknowledgement is still new on the next visit. Without that,
a change landing in that window would be permanently swallowed.

`seen_through` is clamped on both sides, so it is a hint, never an authority:

    lower bound  the marker already stored  (monotonic — a replayed or
                                             out-of-order acknowledgement can
                                             never rewind the marker)
    upper bound  server `now`                (a client can never jump the marker
                                             into the future to hide changes)

ISOLATION
---------
The row is keyed by (user_id, project_id) and the user id comes from server auth
at the route boundary — never from a request body. One account's marker is
therefore unreachable from another's, and a project's marker is per-person: two
collaborators on the same project would each have their own.

COST: pure SQLite. ZERO model tokens, ZERO network.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from backend.core.paths import resolve_db_path
from backend.services.orchestrator import _sqlite
from backend.services.project_brain.attention import parse_iso

logger = logging.getLogger(__name__)

DB_PATH = resolve_db_path("projects.db", "PROJECTS_DB_PATH")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS project_views (
    user_id         TEXT NOT NULL,
    project_id      TEXT NOT NULL,
    last_viewed_at  TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    PRIMARY KEY (user_id, project_id)
);
"""


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def init_views_table() -> None:
    """Idempotent schema creation. Safe on every import/restart."""
    try:
        with _sqlite.connection(DB_PATH) as c:
            c.executescript(_SCHEMA)
    except Exception as exc:  # pragma: no cover — defensive
        logger.warning("projects.views_store.init failed: %s", exc)


def get_last_viewed_at(user_id: str, project_id: str) -> str:
    """The stored marker, or "" when this user has never acknowledged a visit to
    this project. "" is meaningful: it is what makes the workspace fall back to
    a truthfully-labelled "Recent changes" instead of claiming a visit it cannot
    prove."""
    if not (user_id and project_id):
        return ""
    init_views_table()
    try:
        with _sqlite.connection(DB_PATH) as c:
            row = c.execute(
                "SELECT last_viewed_at FROM project_views "
                "WHERE user_id=? AND project_id=?",
                (str(user_id), str(project_id)),
            ).fetchone()
        return str(row["last_viewed_at"]) if row else ""
    except Exception as exc:
        logger.debug("projects.views_store.get failed: %s", exc)
        return ""


def mark_viewed(
    user_id: str,
    project_id: str,
    *,
    seen_through: str = "",
    now: Optional[datetime] = None,
) -> str:
    """Advance the marker and return its new value ("" when the write failed).

    `seen_through` is the snapshot instant the user actually saw. It is clamped
    to `[existing marker, now]` — see the module docstring — so it can only ever
    move the marker forward, and never past the present."""
    if not (user_id and project_id):
        return ""
    init_views_table()
    when = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    previous = get_last_viewed_at(user_id, project_id)

    candidate = parse_iso(seen_through)
    if candidate is None:
        candidate = when
    if candidate > when:
        candidate = when                      # never the future
    previous_dt = parse_iso(previous)
    if previous_dt is not None and candidate < previous_dt:
        return previous                       # monotonic — never rewind

    value = _iso(candidate)
    stamp = _iso(when)
    try:
        with _sqlite.connection(DB_PATH) as c:
            c.execute(
                """INSERT INTO project_views
                       (user_id, project_id, last_viewed_at, updated_at)
                   VALUES (?, ?, ?, ?)
                   ON CONFLICT(user_id, project_id) DO UPDATE SET
                       last_viewed_at=excluded.last_viewed_at,
                       updated_at=excluded.updated_at""",
                (str(user_id), str(project_id), value, stamp),
            )
    except Exception as exc:
        logger.warning("projects.views_store.mark failed: %s", exc)
        return ""
    return value


def forget_project(project_id: str) -> int:
    """Drop every user's marker for a project. Used when a project is deleted so
    view metadata does not outlive the thing it describes."""
    if not project_id:
        return 0
    init_views_table()
    try:
        with _sqlite.connection(DB_PATH) as c:
            cur = c.execute("DELETE FROM project_views WHERE project_id=?",
                            (str(project_id),))
            return int(cur.rowcount or 0)
    except Exception as exc:
        logger.debug("projects.views_store.forget failed: %s", exc)
        return 0


__all__ = [
    "init_views_table", "get_last_viewed_at", "mark_viewed", "forget_project",
]
