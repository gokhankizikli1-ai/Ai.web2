# coding: utf-8
"""GitHub connector — install-flow setup state (CSRF + verified pending install).

The GitHub App **installation** flow needs two short-lived server-side records,
mirroring the Gmail connector's OAuth state store (same pattern, its own tables —
NOT a parallel auth system):

  github_setup_states
      One-time, TTL-bound, owner+project-bound CSRF token. Created by
      connect/start, echoed by GitHub to our Setup URL as `?state=`, and
      consumed exactly once by the callback. This is the ONLY thing that ties
      the (unauthenticated) GitHub setup redirect back to the initiating Korvix
      user + project — the callback trusts it, never a query-string id.

  github_pending_installations
      The VERIFIED set of installations (each installation_id we confirmed both
      (a) belongs to our App and (b) is accessible to the authorized GitHub user,
      bound to owner + project, short TTL). Created by the callback after
      verification; read by the "available repositories" endpoint and the final
      connect/select. A single authorization can surface SEVERAL accessible
      installations (personal account + orgs), so this is a set keyed by
      (project_id, installation_id) — the frontend picks which to connect. It
      stores installation ids ONLY — never an installation token (tokens are
      minted on the fly via the App JWT and never persisted).

Both live in the EXISTING projects.db (co-located with projects + connections),
using the shared `_sqlite` helper — no new database.
"""
from __future__ import annotations

import logging
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Optional

from backend.core.paths import resolve_db_path
from backend.services.github import config as gh_config
from backend.services.orchestrator import _sqlite

logger = logging.getLogger(__name__)

DB_PATH = resolve_db_path("projects.db", "PROJECTS_DB_PATH")

PROVIDER = "github"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS github_setup_states (
    state         TEXT PRIMARY KEY,       -- 256-bit url-safe random (CSRF token)
    owner_user_id TEXT NOT NULL,          -- initiating (authenticated) user
    project_id    TEXT NOT NULL,          -- target project (ownership-checked at start)
    provider      TEXT NOT NULL DEFAULT 'github',
    created_at    TEXT NOT NULL,
    expires_at    TEXT NOT NULL,          -- ISO; rejected past this instant
    consumed_at   TEXT                    -- set once; a second consume is rejected
);
CREATE INDEX IF NOT EXISTS ix_gh_setup_states_expiry ON github_setup_states(expires_at);

CREATE TABLE IF NOT EXISTS github_pending_installations (
    project_id      TEXT NOT NULL,        -- target project
    installation_id TEXT NOT NULL,        -- VERIFIED accessible to the auth'd user
    owner_user_id   TEXT NOT NULL,        -- authoritative scope (from the state)
    account_login   TEXT NOT NULL DEFAULT '',  -- installation account (display only)
    account_type    TEXT NOT NULL DEFAULT '',   -- User | Organization (display only)
    created_at      TEXT NOT NULL,
    expires_at      TEXT NOT NULL,        -- ISO; rejected past this instant
    PRIMARY KEY (project_id, installation_id)  -- a project may have several
                                               -- accessible installations pending
);
CREATE INDEX IF NOT EXISTS ix_gh_pending_owner   ON github_pending_installations(owner_user_id);
CREATE INDEX IF NOT EXISTS ix_gh_pending_expiry  ON github_pending_installations(expires_at);
CREATE INDEX IF NOT EXISTS ix_gh_pending_project ON github_pending_installations(project_id);
"""


@dataclass(frozen=True)
class SetupState:
    state: str
    owner_user_id: str
    project_id: str
    provider: str


@dataclass(frozen=True)
class PendingInstallation:
    project_id: str
    owner_user_id: str
    installation_id: str
    account_login: str
    account_type: str
    created_at: str
    expires_at: str


def _now() -> datetime:
    return datetime.utcnow()


def _iso(dt: datetime) -> str:
    return dt.isoformat() + "Z"


def _parse(ts: str) -> Optional[datetime]:
    try:
        return datetime.fromisoformat(str(ts).replace("Z", ""))
    except Exception:
        return None


def init_github_setup_tables() -> None:
    """Idempotent, additive bring-up. Failures are swallowed (never block)."""
    try:
        with _sqlite.connection(DB_PATH) as c:
            c.executescript(_SCHEMA)
    except Exception as exc:  # pragma: no cover — defensive
        logger.warning("github.setup_state.init failed: %s", exc)


# ── one-time CSRF state ──────────────────────────────────────────────────────

def create_state(*, owner_user_id: str, project_id: str) -> str:
    """Mint and persist a one-time state bound to (user, project). Returns the
    opaque token. Raises ValueError on missing scope."""
    owner_user_id = str(owner_user_id or "").strip()
    project_id = str(project_id or "").strip()
    if not owner_user_id or not project_id:
        raise ValueError("owner_user_id and project_id are required")
    init_github_setup_tables()
    token = secrets.token_urlsafe(32)  # 256 bits
    now = _now()
    expires = now + timedelta(seconds=gh_config.setup_state_ttl_s())
    with _sqlite.connection(DB_PATH) as c:
        c.execute(
            """INSERT INTO github_setup_states
               (state, owner_user_id, project_id, provider, created_at, expires_at, consumed_at)
               VALUES (?, ?, ?, ?, ?, ?, NULL)""",
            (token, owner_user_id, project_id, PROVIDER, _iso(now), _iso(expires)),
        )
    return token


def consume(state: str) -> Optional[SetupState]:
    """Atomically validate + consume a state. Returns the bound (user, project)
    IFF the state exists, is not expired, and has NOT been consumed before — and
    in the same transaction marks it consumed so a replay fails. Returns None on
    unknown / expired / already-consumed (a single opaque rejection)."""
    state = str(state or "").strip()
    if not state:
        return None
    init_github_setup_tables()
    now = _now()
    try:
        with _sqlite.writer_tx(DB_PATH) as c:
            row = c.execute(
                "SELECT * FROM github_setup_states WHERE state=?", (state,),
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
                "UPDATE github_setup_states SET consumed_at=? WHERE state=? AND consumed_at IS NULL",
                (_iso(now), state),
            )
            if (cur.rowcount or 0) <= 0:
                return None  # lost a race to another consumer
            return SetupState(
                state=state,
                owner_user_id=str(d["owner_user_id"]),
                project_id=str(d["project_id"]),
                provider=str(d.get("provider") or PROVIDER),
            )
    except Exception as exc:
        logger.warning("github.setup_state.consume failed: %s", type(exc).__name__)
        return None


def purge_expired(*, now: Optional[datetime] = None) -> int:
    """Best-effort housekeeping of expired states + pending installs."""
    init_github_setup_tables()
    cutoff = _iso(now or _now())
    removed = 0
    try:
        with _sqlite.connection(DB_PATH) as c:
            removed += c.execute(
                "DELETE FROM github_setup_states WHERE expires_at < ?", (cutoff,)).rowcount or 0
            removed += c.execute(
                "DELETE FROM github_pending_installations WHERE expires_at < ?", (cutoff,)).rowcount or 0
    except Exception:
        return removed
    return max(0, removed)


# ── verified pending installation ────────────────────────────────────────────

def _row_to_pending(d: dict) -> PendingInstallation:
    return PendingInstallation(
        project_id=str(d["project_id"]),
        owner_user_id=str(d["owner_user_id"]),
        installation_id=str(d["installation_id"]),
        account_login=str(d.get("account_login") or ""),
        account_type=str(d.get("account_type") or ""),
        created_at=str(d["created_at"]),
        expires_at=str(d["expires_at"]),
    )


def replace_pending_installations(*, project_id: str, owner_user_id: str,
                                  installations: list) -> list:
    """Atomically replace the set of VERIFIED pending installations for a project.

    `installations` is a list of dicts, each `{"installation_id", "account_login",
    "account_type"}`. Every entry MUST already be provider-verified (accessible to
    the authenticated GitHub user AND belonging to our App) before it is passed
    here — this function only persists. Stores installation ids ONLY, never a
    token. `owner_user_id` MUST be the project's real owner (from the consumed
    state), never client input. Returns the freshly stored records.

    Replacing (delete-all-then-insert) keeps the pending set a faithful mirror of
    what the current authorization actually grants: an installation the user lost
    access to since a prior attempt does not linger."""
    project_id = str(project_id or "").strip()
    owner_user_id = str(owner_user_id or "").strip()
    if not (project_id and owner_user_id):
        return []
    rows = []
    for item in (installations or []):
        iid = str((item or {}).get("installation_id") or "").strip()
        if not iid:
            continue
        rows.append((
            iid,
            str((item or {}).get("account_login") or "").strip(),
            str((item or {}).get("account_type") or "").strip(),
        ))
    init_github_setup_tables()
    now = _now()
    expires = now + timedelta(seconds=gh_config.pending_ttl_s())
    try:
        with _sqlite.writer_tx(DB_PATH) as c:
            c.execute(
                "DELETE FROM github_pending_installations WHERE project_id=?",
                (project_id,),
            )
            for iid, login, atype in rows:
                c.execute(
                    """INSERT INTO github_pending_installations
                       (project_id, installation_id, owner_user_id, account_login,
                        account_type, created_at, expires_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?)""",
                    (project_id, iid, owner_user_id, login, atype, _iso(now), _iso(expires)),
                )
    except Exception as exc:
        logger.warning("github.setup_state.replace_pending failed: %s", type(exc).__name__)
        return []
    return list_pending_installations(project_id, owner_user_id=owner_user_id)


def list_pending_installations(project_id: str, *, owner_user_id: str) -> list:
    """All non-expired pending installations for a project owned by
    `owner_user_id`, newest-account-first is not guaranteed (login-sorted for a
    stable picker order). Owner binding enforced here (defence in depth)."""
    project_id = str(project_id or "").strip()
    owner_user_id = str(owner_user_id or "").strip()
    if not project_id or not owner_user_id:
        return []
    init_github_setup_tables()
    now = _now()
    out = []
    try:
        with _sqlite.connection(DB_PATH) as c:
            cursor = c.execute(
                "SELECT * FROM github_pending_installations WHERE project_id=? AND owner_user_id=?",
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
    out.sort(key=lambda p: (p.account_login.lower(), p.installation_id))
    return out


def get_pending_installation(project_id: str, *, owner_user_id: str,
                             installation_id: str) -> Optional[PendingInstallation]:
    """Return the ONE non-expired pending installation matching
    (project_id, owner_user_id, installation_id). Owner + membership binding is
    enforced here (defence in depth on top of the route's ownership gate): a
    client-supplied `installation_id` that is not a currently-pending, verified,
    owner-bound row returns None. Returns None on missing/expired/foreign."""
    project_id = str(project_id or "").strip()
    owner_user_id = str(owner_user_id or "").strip()
    installation_id = str(installation_id or "").strip()
    if not project_id or not owner_user_id or not installation_id:
        return None
    init_github_setup_tables()
    try:
        with _sqlite.connection(DB_PATH) as c:
            row = c.execute(
                """SELECT * FROM github_pending_installations
                   WHERE project_id=? AND installation_id=?""",
                (project_id, installation_id),
            ).fetchone()
        if row is None:
            return None
        d = dict(row)
        if str(d.get("owner_user_id")) != owner_user_id:
            return None  # not this user's pending install
        exp = _parse(str(d.get("expires_at") or ""))
        if exp is None or exp < _now():
            return None  # expired
        return _row_to_pending(d)
    except Exception:
        return None


def delete_pending_installations(project_id: str) -> bool:
    """Remove ALL pending installations for a project (called after a successful
    connect/select, or to clear a stale set)."""
    project_id = str(project_id or "").strip()
    if not project_id:
        return False
    init_github_setup_tables()
    try:
        with _sqlite.connection(DB_PATH) as c:
            cur = c.execute(
                "DELETE FROM github_pending_installations WHERE project_id=?", (project_id,))
            return (cur.rowcount or 0) > 0
    except Exception:
        return False


def _reset_for_tests() -> None:
    try:
        with _sqlite.connection(DB_PATH) as c:
            c.execute("DROP TABLE IF EXISTS github_setup_states")
            c.execute("DROP TABLE IF EXISTS github_pending_installations")
    except Exception:
        pass


__all__ = [
    "SetupState", "PendingInstallation", "PROVIDER",
    "init_github_setup_tables", "create_state", "consume", "purge_expired",
    "replace_pending_installations", "list_pending_installations",
    "get_pending_installation", "delete_pending_installations",
]
