# coding: utf-8
"""Vercel connector — OAuth state (CSRF) + verified pending project selection.

Two short-lived server-side records, mirroring the GitHub connector's
`setup_state` (same pattern, its own tables — NOT a parallel auth system):

  vercel_oauth_states
      One-time, TTL-bound, owner+project-bound CSRF token. Created by
      connect/start, echoed by Vercel to our Redirect URL as `?state=`, and
      consumed exactly once by the callback. This is the ONLY thing that ties
      the (unauthenticated) Vercel redirect back to the initiating Korvix user +
      project — the callback trusts it, never a query-string id.

  vercel_pending_projects
      The set of Vercel projects the freshly-authorized token can actually see
      (read from the Vercel API with that token, under its team scope), bound to
      owner + project with a short TTL. Created by the callback; read by the
      "pending projects" endpoint and validated again by connect/select. It
      stores project ids + display metadata ONLY — never a token.

WHY A PENDING SET AND NOT AN AUTO-BIND
--------------------------------------
A Vercel account routinely holds many projects. Auto-binding whichever came
back first would silently attach the wrong deployment stream to a Korvix
project, so the user picks explicitly (matching the GitHub repo picker). The
final selection is re-validated against Vercel server-side before it is stored,
so this table is a UX convenience, never the authority.

Both live in the EXISTING projects.db (co-located with projects + observations),
using the shared `_sqlite` helper — no new database.
"""
from __future__ import annotations

import logging
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from backend.core.paths import resolve_db_path
from backend.services.orchestrator import _sqlite
from backend.services.vercel import config as vc_config

logger = logging.getLogger(__name__)

DB_PATH = resolve_db_path("projects.db", "PROJECTS_DB_PATH")

PROVIDER = "vercel"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS vercel_oauth_states (
    state         TEXT PRIMARY KEY,       -- 256-bit url-safe random (CSRF token)
    owner_user_id TEXT NOT NULL,          -- initiating (authenticated) user
    project_id    TEXT NOT NULL,          -- target project (ownership-checked at start)
    provider      TEXT NOT NULL DEFAULT 'vercel',
    created_at    TEXT NOT NULL,
    expires_at    TEXT NOT NULL,          -- ISO; rejected past this instant
    consumed_at   TEXT                    -- set once; a second consume is rejected
);
CREATE INDEX IF NOT EXISTS ix_vercel_states_expiry ON vercel_oauth_states(expires_at);

CREATE TABLE IF NOT EXISTS vercel_pending_projects (
    project_id        TEXT NOT NULL,      -- target Korvix project
    vercel_project_id TEXT NOT NULL,      -- accessible under the authorized token
    owner_user_id     TEXT NOT NULL,      -- authoritative scope (from the state)
    name              TEXT NOT NULL DEFAULT '',   -- display only
    framework         TEXT NOT NULL DEFAULT '',   -- display only
    created_at        TEXT NOT NULL,
    expires_at        TEXT NOT NULL,      -- ISO; rejected past this instant
    PRIMARY KEY (project_id, vercel_project_id)
);
CREATE INDEX IF NOT EXISTS ix_vercel_pending_owner   ON vercel_pending_projects(owner_user_id);
CREATE INDEX IF NOT EXISTS ix_vercel_pending_expiry  ON vercel_pending_projects(expires_at);
CREATE INDEX IF NOT EXISTS ix_vercel_pending_project ON vercel_pending_projects(project_id);
"""


@dataclass(frozen=True)
class OAuthState:
    state: str
    owner_user_id: str
    project_id: str
    provider: str


@dataclass(frozen=True)
class PendingProject:
    project_id: str
    owner_user_id: str
    vercel_project_id: str
    name: str
    framework: str
    created_at: str
    expires_at: str

    def public_view(self) -> Dict[str, Any]:
        """Frontend-safe projection — display metadata only, never a token."""
        return {
            "vercel_project_id": self.vercel_project_id,
            "name": self.name,
            "framework": self.framework,
        }


def _now() -> datetime:
    return datetime.utcnow()


def _iso(dt: datetime) -> str:
    return dt.isoformat() + "Z"


def _parse(ts: str) -> Optional[datetime]:
    try:
        return datetime.fromisoformat(str(ts).replace("Z", ""))
    except Exception:
        return None


def init_vercel_setup_tables() -> None:
    """Idempotent, additive bring-up. Failures are swallowed (never block)."""
    try:
        with _sqlite.connection(DB_PATH) as c:
            c.executescript(_SCHEMA)
    except Exception as exc:  # pragma: no cover — defensive
        logger.warning("vercel.setup_state.init failed: %s", exc)


# ── one-time CSRF state ──────────────────────────────────────────────────────

def create_state(*, owner_user_id: str, project_id: str) -> str:
    """Mint and persist a one-time state bound to (user, project, provider).

    `project_id` may be EMPTY for an ACCOUNT-LEVEL authorization: the user is
    authorizing the provider for their Korvix account, not for one project, so
    there is no project to bind yet (the project binding is a separate, explicit
    step). The state is still ownership-bound to the authenticated user, still
    one-time, and still short-lived — the properties that make the callback safe
    do not depend on a project. Only the OWNER is required.

    Returns the opaque state token. Raises ValueError on a missing owner."""
    owner_user_id = str(owner_user_id or "").strip()
    project_id = str(project_id or "").strip()
    if not owner_user_id:
        raise ValueError("owner_user_id is required")
    init_vercel_setup_tables()
    token = secrets.token_urlsafe(32)  # 256 bits
    now = _now()
    expires = now + timedelta(seconds=vc_config.state_ttl_s())
    with _sqlite.connection(DB_PATH) as c:
        c.execute(
            """INSERT INTO vercel_oauth_states
               (state, owner_user_id, project_id, provider, created_at, expires_at, consumed_at)
               VALUES (?, ?, ?, ?, ?, ?, NULL)""",
            (token, owner_user_id, project_id, PROVIDER, _iso(now), _iso(expires)),
        )
    return token


def consume(state: str) -> Optional[OAuthState]:
    """Atomically validate + consume a state. Returns the bound (user, project)
    IFF the state exists, is not expired, and has NOT been consumed before — and
    in the same transaction marks it consumed so a replay fails. Returns None on
    unknown / expired / already-consumed (a single opaque rejection)."""
    state = str(state or "").strip()
    if not state:
        return None
    init_vercel_setup_tables()
    now = _now()
    try:
        with _sqlite.writer_tx(DB_PATH) as c:
            row = c.execute(
                "SELECT * FROM vercel_oauth_states WHERE state=?", (state,),
            ).fetchone()
            if row is None:
                return None
            d = dict(row)
            if d.get("consumed_at"):
                return None  # replay
            exp = _parse(str(d.get("expires_at") or ""))
            if exp is None or exp < now:
                return None  # expired
            cur = c.execute(
                "UPDATE vercel_oauth_states SET consumed_at=? WHERE state=? AND consumed_at IS NULL",
                (_iso(now), state),
            )
            if (cur.rowcount or 0) <= 0:
                return None  # lost a race to another consumer
            return OAuthState(
                state=state,
                owner_user_id=str(d["owner_user_id"]),
                project_id=str(d["project_id"]),
                provider=str(d.get("provider") or PROVIDER),
            )
    except Exception as exc:
        logger.warning("vercel.setup_state.consume failed: %s", type(exc).__name__)
        return None


def purge_expired(*, now: Optional[datetime] = None) -> int:
    """Best-effort housekeeping of expired states + pending projects."""
    init_vercel_setup_tables()
    cutoff = _iso(now or _now())
    removed = 0
    try:
        with _sqlite.connection(DB_PATH) as c:
            removed += c.execute(
                "DELETE FROM vercel_oauth_states WHERE expires_at < ?", (cutoff,)).rowcount or 0
            removed += c.execute(
                "DELETE FROM vercel_pending_projects WHERE expires_at < ?", (cutoff,)).rowcount or 0
    except Exception:
        return removed
    return max(0, removed)


# ── pending project selection ────────────────────────────────────────────────

def _row_to_pending(d: dict) -> PendingProject:
    return PendingProject(
        project_id=str(d["project_id"]),
        owner_user_id=str(d["owner_user_id"]),
        vercel_project_id=str(d["vercel_project_id"]),
        name=str(d.get("name") or ""),
        framework=str(d.get("framework") or ""),
        created_at=str(d["created_at"]),
        expires_at=str(d["expires_at"]),
    )


def replace_pending_projects(*, project_id: str, owner_user_id: str,
                             projects: List[Dict[str, Any]]) -> List[PendingProject]:
    """Atomically replace the pending Vercel project set for a Korvix project.

    `projects` is a list of dicts, each `{"vercel_project_id", "name",
    "framework"}`, read from Vercel with the just-authorized token under its own
    team scope. `owner_user_id` MUST be the project's real owner (from the
    consumed state), never client input. Stores ids + display metadata ONLY,
    never a token.

    Replacing (delete-all-then-insert) keeps the pending set a faithful mirror
    of what the CURRENT authorization actually grants: a project the user
    removed from the integration since a prior attempt does not linger."""
    project_id = str(project_id or "").strip()
    owner_user_id = str(owner_user_id or "").strip()
    if not (project_id and owner_user_id):
        return []
    cap = vc_config.pending_projects_max()
    rows = []
    for item in (projects or []):
        vpid = str((item or {}).get("vercel_project_id") or "").strip()
        if not vpid:
            continue
        rows.append((
            vpid,
            str((item or {}).get("name") or "").strip()[:200],
            str((item or {}).get("framework") or "").strip()[:60],
        ))
        if len(rows) >= cap:
            break
    init_vercel_setup_tables()
    now = _now()
    expires = now + timedelta(seconds=vc_config.pending_ttl_s())
    try:
        with _sqlite.writer_tx(DB_PATH) as c:
            c.execute("DELETE FROM vercel_pending_projects WHERE project_id=?", (project_id,))
            for vpid, name, framework in rows:
                c.execute(
                    """INSERT INTO vercel_pending_projects
                       (project_id, vercel_project_id, owner_user_id, name,
                        framework, created_at, expires_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?)""",
                    (project_id, vpid, owner_user_id, name, framework, _iso(now), _iso(expires)),
                )
    except Exception as exc:
        logger.warning("vercel.setup_state.replace_pending failed: %s", type(exc).__name__)
        return []
    return list_pending_projects(project_id, owner_user_id=owner_user_id)


def list_pending_projects(project_id: str, *, owner_user_id: str) -> List[PendingProject]:
    """All non-expired pending Vercel projects for a Korvix project owned by
    `owner_user_id` (name-sorted for a stable picker order). Owner binding is
    enforced here (defence in depth on top of the route's ownership gate)."""
    project_id = str(project_id or "").strip()
    owner_user_id = str(owner_user_id or "").strip()
    if not project_id or not owner_user_id:
        return []
    init_vercel_setup_tables()
    now = _now()
    out: List[PendingProject] = []
    try:
        with _sqlite.connection(DB_PATH) as c:
            cursor = c.execute(
                "SELECT * FROM vercel_pending_projects WHERE project_id=? AND owner_user_id=?",
                (project_id, owner_user_id),
            )
            for row in cursor.fetchall():
                d = dict(row)
                exp = _parse(str(d.get("expires_at") or ""))
                if exp is None or exp < now:
                    continue  # expired
                out.append(_row_to_pending(d))
    except Exception:
        return []
    out.sort(key=lambda p: (p.name.lower(), p.vercel_project_id))
    return out


def get_pending_project(project_id: str, *, owner_user_id: str,
                        vercel_project_id: str) -> Optional[PendingProject]:
    """The ONE non-expired pending row matching (project_id, owner_user_id,
    vercel_project_id). A client-supplied `vercel_project_id` that is not a
    currently-pending, owner-bound row returns None — client input is validated,
    never trusted."""
    project_id = str(project_id or "").strip()
    owner_user_id = str(owner_user_id or "").strip()
    vercel_project_id = str(vercel_project_id or "").strip()
    if not project_id or not owner_user_id or not vercel_project_id:
        return None
    init_vercel_setup_tables()
    try:
        with _sqlite.connection(DB_PATH) as c:
            row = c.execute(
                """SELECT * FROM vercel_pending_projects
                   WHERE project_id=? AND vercel_project_id=?""",
                (project_id, vercel_project_id),
            ).fetchone()
        if row is None:
            return None
        d = dict(row)
        if str(d.get("owner_user_id")) != owner_user_id:
            return None  # not this user's pending row
        exp = _parse(str(d.get("expires_at") or ""))
        if exp is None or exp < _now():
            return None  # expired
        return _row_to_pending(d)
    except Exception:
        return None


def delete_pending_projects(project_id: str) -> bool:
    """Remove ALL pending rows for a Korvix project (after a successful
    connect/select, on disconnect, or to clear a stale set)."""
    project_id = str(project_id or "").strip()
    if not project_id:
        return False
    init_vercel_setup_tables()
    try:
        with _sqlite.connection(DB_PATH) as c:
            cur = c.execute(
                "DELETE FROM vercel_pending_projects WHERE project_id=?", (project_id,))
            return (cur.rowcount or 0) > 0
    except Exception:
        return False


def _reset_for_tests() -> None:
    try:
        with _sqlite.connection(DB_PATH) as c:
            c.execute("DROP TABLE IF EXISTS vercel_oauth_states")
            c.execute("DROP TABLE IF EXISTS vercel_pending_projects")
    except Exception:
        pass


__all__ = [
    "OAuthState", "PendingProject", "PROVIDER", "init_vercel_setup_tables",
    "create_state", "consume", "purge_expired", "replace_pending_projects",
    "list_pending_projects", "get_pending_project", "delete_pending_projects",
]
