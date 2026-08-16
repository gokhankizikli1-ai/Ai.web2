# coding: utf-8
"""Slack connector — OAuth state (CSRF) + verified pending channel set.

Two short-lived server-side records, mirroring the Vercel connector's
`setup_state` (same pattern, its own tables — NOT a parallel auth system):

  slack_oauth_states
      One-time, TTL-bound, owner+project-bound CSRF token. Created by
      connect/start, echoed by Slack to our Redirect URL as `?state=`, and
      consumed exactly once by the callback. This is the ONLY thing that ties
      the (unauthenticated) Slack redirect back to the initiating Korvix user +
      project — the callback trusts it, never a query-string id.

  slack_pending_channels
      The set of Slack conversations the freshly-installed bot token can
      actually SEE (read from `conversations.list` with that token), bound to
      owner + project with a short TTL. Created by the callback; read by the
      "pending channels" endpoint and validated again by connect/select. It
      stores channel ids + safe display metadata ONLY — never a token, never
      message content.

WHY A PENDING SET AND NOT AN AUTO-BIND
--------------------------------------
A workspace routinely holds hundreds of channels, and most of them have nothing
to do with a given Korvix project. Auto-binding whichever came back first would
silently ingest the wrong conversation, so the user picks explicitly (matching
the GitHub repo picker and the Vercel project picker). The final selection is
re-validated against Slack server-side before it is stored, so this table is a
UX convenience, never the authority.

`is_member` IS PART OF THE TRUTH, NOT A HINT
--------------------------------------------
A Slack bot can only read the history of a conversation it belongs to. Slack's
own `is_member` flag is therefore stored alongside each pending channel and
surfaced to the picker, so the UI can say "invite Korvix to this channel first"
instead of offering an unreadable channel as if it were connectable.

Both tables live in the EXISTING projects.db (co-located with projects +
observations), using the shared `_sqlite` helper — no new database.
"""
from __future__ import annotations

import logging
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from backend.core.paths import resolve_db_path
from backend.services.orchestrator import _sqlite
from backend.services.slack import config as sl_config

logger = logging.getLogger(__name__)

DB_PATH = resolve_db_path("projects.db", "PROJECTS_DB_PATH")

PROVIDER = "slack"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS slack_oauth_states (
    state         TEXT PRIMARY KEY,       -- 256-bit url-safe random (CSRF token)
    owner_user_id TEXT NOT NULL,          -- initiating (authenticated) user
    project_id    TEXT NOT NULL,          -- target project (ownership-checked at start)
    provider      TEXT NOT NULL DEFAULT 'slack',
    created_at    TEXT NOT NULL,
    expires_at    TEXT NOT NULL,          -- ISO; rejected past this instant
    consumed_at   TEXT                    -- set once; a second consume is rejected
);
CREATE INDEX IF NOT EXISTS ix_slack_states_expiry ON slack_oauth_states(expires_at);

CREATE TABLE IF NOT EXISTS slack_pending_channels (
    project_id    TEXT NOT NULL,          -- target Korvix project
    channel_id    TEXT NOT NULL,          -- visible under the installed bot token
    owner_user_id TEXT NOT NULL,          -- authoritative scope (from the state)
    name          TEXT NOT NULL DEFAULT '',   -- display only
    is_private    INTEGER NOT NULL DEFAULT 0,
    is_member     INTEGER NOT NULL DEFAULT 0, -- Slack's own truth: can we read it?
    created_at    TEXT NOT NULL,
    expires_at    TEXT NOT NULL,          -- ISO; rejected past this instant
    PRIMARY KEY (project_id, channel_id)
);
CREATE INDEX IF NOT EXISTS ix_slack_pending_owner  ON slack_pending_channels(owner_user_id);
CREATE INDEX IF NOT EXISTS ix_slack_pending_expiry ON slack_pending_channels(expires_at);
"""


@dataclass(frozen=True)
class OAuthState:
    state: str
    owner_user_id: str
    project_id: str
    provider: str


@dataclass(frozen=True)
class PendingChannel:
    project_id: str
    owner_user_id: str
    channel_id: str
    name: str
    is_private: bool
    is_member: bool
    created_at: str
    expires_at: str

    def public_view(self) -> Dict[str, Any]:
        """Frontend-safe projection — display metadata only, never a token and
        never message content. `is_member` is included because the picker must
        be able to tell the user WHY a channel cannot be connected yet."""
        return {
            "channel_id": self.channel_id,
            "name": self.name,
            "is_private": self.is_private,
            "is_member": self.is_member,
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


def init_slack_setup_tables() -> None:
    """Idempotent, additive bring-up. Failures are swallowed (never block)."""
    try:
        with _sqlite.connection(DB_PATH) as c:
            c.executescript(_SCHEMA)
    except Exception as exc:  # pragma: no cover — defensive
        logger.warning("slack.setup_state.init failed: %s", exc)


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
    init_slack_setup_tables()
    token = secrets.token_urlsafe(32)  # 256 bits
    now = _now()
    expires = now + timedelta(seconds=sl_config.state_ttl_s())
    with _sqlite.connection(DB_PATH) as c:
        c.execute(
            """INSERT INTO slack_oauth_states
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
    init_slack_setup_tables()
    now = _now()
    try:
        with _sqlite.writer_tx(DB_PATH) as c:
            row = c.execute(
                "SELECT * FROM slack_oauth_states WHERE state=?", (state,),
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
                "UPDATE slack_oauth_states SET consumed_at=? WHERE state=? AND consumed_at IS NULL",
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
        logger.warning("slack.setup_state.consume failed: %s", type(exc).__name__)
        return None


def purge_expired(*, now: Optional[datetime] = None) -> int:
    """Best-effort housekeeping of expired states + pending channels."""
    init_slack_setup_tables()
    cutoff = _iso(now or _now())
    removed = 0
    try:
        with _sqlite.connection(DB_PATH) as c:
            removed += c.execute(
                "DELETE FROM slack_oauth_states WHERE expires_at < ?", (cutoff,)).rowcount or 0
            removed += c.execute(
                "DELETE FROM slack_pending_channels WHERE expires_at < ?", (cutoff,)).rowcount or 0
    except Exception:
        return removed
    return max(0, removed)


# ── pending channel selection ────────────────────────────────────────────────

def _row_to_pending(d: dict) -> PendingChannel:
    return PendingChannel(
        project_id=str(d["project_id"]),
        owner_user_id=str(d["owner_user_id"]),
        channel_id=str(d["channel_id"]),
        name=str(d.get("name") or ""),
        is_private=bool(d.get("is_private")),
        is_member=bool(d.get("is_member")),
        created_at=str(d["created_at"]),
        expires_at=str(d["expires_at"]),
    )


def replace_pending_channels(*, project_id: str, owner_user_id: str,
                             channels: List[Dict[str, Any]]) -> List[PendingChannel]:
    """Atomically replace the pending Slack channel set for a Korvix project.

    `channels` is a list of dicts, each `{"channel_id", "name", "is_private",
    "is_member"}`, read from Slack with the installed bot token.
    `owner_user_id` MUST be the project's real owner (from the consumed state),
    never client input. Stores ids + display metadata ONLY, never a token.

    Replacing (delete-all-then-insert) keeps the pending set a faithful mirror
    of what the CURRENT installation actually sees: a channel the bot was
    removed from since a prior attempt does not linger as connectable."""
    project_id = str(project_id or "").strip()
    owner_user_id = str(owner_user_id or "").strip()
    if not (project_id and owner_user_id):
        return []
    cap = sl_config.pending_channels_max()
    rows = []
    seen = set()
    for item in (channels or []):
        cid = str((item or {}).get("channel_id") or "").strip()
        if not cid or cid in seen:
            continue
        seen.add(cid)
        rows.append((
            cid,
            str((item or {}).get("name") or "").strip()[:200],
            1 if (item or {}).get("is_private") else 0,
            1 if (item or {}).get("is_member") else 0,
        ))
        if len(rows) >= cap:
            break
    init_slack_setup_tables()
    now = _now()
    expires = now + timedelta(seconds=sl_config.pending_ttl_s())
    try:
        with _sqlite.writer_tx(DB_PATH) as c:
            c.execute("DELETE FROM slack_pending_channels WHERE project_id=?", (project_id,))
            for cid, name, is_private, is_member in rows:
                c.execute(
                    """INSERT INTO slack_pending_channels
                       (project_id, channel_id, owner_user_id, name, is_private,
                        is_member, created_at, expires_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    (project_id, cid, owner_user_id, name, is_private, is_member,
                     _iso(now), _iso(expires)),
                )
    except Exception as exc:
        logger.warning("slack.setup_state.replace_pending failed: %s", type(exc).__name__)
        return []
    return list_pending_channels(project_id, owner_user_id=owner_user_id)


def list_pending_channels(project_id: str, *, owner_user_id: str) -> List[PendingChannel]:
    """All non-expired pending channels for a Korvix project owned by
    `owner_user_id`. Sorted member-first then by name, so the channels the user
    can actually connect lead the picker. Owner binding is enforced here
    (defence in depth on top of the route's ownership gate)."""
    project_id = str(project_id or "").strip()
    owner_user_id = str(owner_user_id or "").strip()
    if not project_id or not owner_user_id:
        return []
    init_slack_setup_tables()
    now = _now()
    out: List[PendingChannel] = []
    try:
        with _sqlite.connection(DB_PATH) as c:
            cursor = c.execute(
                "SELECT * FROM slack_pending_channels WHERE project_id=? AND owner_user_id=?",
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
    out.sort(key=lambda p: (0 if p.is_member else 1, p.name.lower(), p.channel_id))
    return out


def get_pending_channel(project_id: str, *, owner_user_id: str,
                        channel_id: str) -> Optional[PendingChannel]:
    """The ONE non-expired pending row matching (project_id, owner_user_id,
    channel_id). A client-supplied `channel_id` that is not a currently-pending,
    owner-bound row returns None — client input is validated, never trusted."""
    project_id = str(project_id or "").strip()
    owner_user_id = str(owner_user_id or "").strip()
    channel_id = str(channel_id or "").strip()
    if not project_id or not owner_user_id or not channel_id:
        return None
    init_slack_setup_tables()
    try:
        with _sqlite.connection(DB_PATH) as c:
            row = c.execute(
                """SELECT * FROM slack_pending_channels
                   WHERE project_id=? AND channel_id=?""",
                (project_id, channel_id),
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


def delete_pending_channels(project_id: str) -> bool:
    """Remove ALL pending rows for a Korvix project (after a successful
    connect/select, on disconnect, or to clear a stale set)."""
    project_id = str(project_id or "").strip()
    if not project_id:
        return False
    init_slack_setup_tables()
    try:
        with _sqlite.connection(DB_PATH) as c:
            cur = c.execute(
                "DELETE FROM slack_pending_channels WHERE project_id=?", (project_id,))
            return (cur.rowcount or 0) > 0
    except Exception:
        return False


def _reset_for_tests() -> None:
    try:
        with _sqlite.connection(DB_PATH) as c:
            c.execute("DROP TABLE IF EXISTS slack_oauth_states")
            c.execute("DROP TABLE IF EXISTS slack_pending_channels")
    except Exception:
        pass


__all__ = [
    "OAuthState", "PendingChannel", "PROVIDER", "init_slack_setup_tables",
    "create_state", "consume", "purge_expired", "replace_pending_channels",
    "list_pending_channels", "get_pending_channel", "delete_pending_channels",
]
