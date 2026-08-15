# coding: utf-8
"""Slack connector — durable connection + credential store.

WHY SMALL TABLES (NOT project.metadata_json)
---------------------------------------------
A Slack connection carries an ENCRYPTED bot token plus workspace identity,
lifecycle state, and the set of channels bound to this Korvix project. That is
credential material with its own lifecycle (install, revoke, rebind), not a
plain project setting, so it gets the SMALLEST durable tables that model the
connection — in the EXISTING `projects.db` (same file as `projects`,
`observations`, `gmail_connections`, `vercel_connections` and
`calendar_connections`, so (user, project) scoping joins stay local). No second
database.

  slack_connections        (project_id ⇄ owner_user_id ⇄ Slack workspace)
  slack_selected_channels  (project_id ⇄ the channels bound to it)

WHY THE CHANNELS ARE A TABLE AND NOT A JSON COLUMN
---------------------------------------------------
Slack is the first connector that binds MANY provider resources to one Korvix
project. A child table keeps each binding individually addressable and
owner-scoped, gives the cap a real constraint to enforce, and lets a channel be
dropped without rewriting a blob. It follows the same shape as
`slack_pending_channels`, so the pending → selected transition is a straight
copy of validated rows.

THREE-STEP LIFECYCLE
--------------------
`STATUS_PENDING_SELECTION` — the OAuth exchange succeeded and the bot token is
stored, but the user has not yet chosen WHICH channels belong to this Korvix
project. Nothing is synced in this state.
`STATUS_CONNECTED` — at least one server-revalidated channel is bound; sync may
run.
`STATUS_REVOKED` — the token was rejected by Slack (uninstalled / revoked);
credential material is wiped and a reconnect is required.

ISOLATION
---------
* `project_id` is the PRIMARY KEY of `slack_connections` → one Slack connection
  per Korvix project.
* `owner_user_id` is stored denormalized from the PROJECT at install time and is
  the ONLY user id ever used to scope recorded observations — a caller can never
  smuggle a different user_id in.
* Selected-channel rows carry the same `owner_user_id`, so a read can be
  owner-scoped without a join.

ONE SLACK INSTALLATION CAN BACK MANY KORVIX PROJECTS
-----------------------------------------------------
Slack installs an app ONCE PER WORKSPACE. If two Korvix projects (even two
different owners in the same workspace) both connect Slack, Slack hands each
flow a token for the SAME installation. Consequences, both deliberate:

  * Disconnect is LOCAL-ONLY — it deletes this project's rows and never calls
    Slack, so it can never break the other project's connection. There is no
    `auth.revoke` anywhere in this package.
  * `count_connected_for_team()` exists so a caller can tell the user TRUTHFULLY
    that the workspace installation survives their disconnect (fail-closed: an
    unknown/unreadable state counts as "shared").

SECRETS
-------
* The bot token is stored ONLY as an encrypted envelope, produced by the
  EXISTING credential authority (`gmail.crypto`, keyed by
  `KORVIX_CREDENTIAL_ENCRYPTION_KEY`). This connector adds no second cipher and
  no second key, and there is no plaintext fallback: `upsert_installation`
  raises `CredentialEncryptionError` rather than writing a bare token.
* No user token is ever stored — the OAuth module never returns one.
* `public_view()` carries NO token material.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from backend.core.paths import resolve_db_path
# The single credential-at-rest authority (see module docstring) — imported,
# never reimplemented.
from backend.services.gmail import crypto as credential_crypto
from backend.services.orchestrator import _sqlite
from backend.services.slack import config as sl_config

logger = logging.getLogger(__name__)

DB_PATH = resolve_db_path("projects.db", "PROJECTS_DB_PATH")

PROVIDER = "slack"

STATUS_PENDING_SELECTION = "pending_selection"
STATUS_CONNECTED = "connected"
STATUS_REVOKED = "revoked"

# A PROJECTION-ONLY lifecycle value. It is NEVER written to `slack_connections`
# and never returned by `get_connection()` — it exists solely so the status route
# can describe a row whose `owner_user_id` no longer matches the project's
# current owner, WITHOUT echoing that row's workspace identity. See
# `SlackConnection.owner_mismatch_view()`.
STATUS_OWNER_MISMATCH = "owner_mismatch"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS slack_connections (
    project_id      TEXT PRIMARY KEY,          -- one Slack connection per Korvix project
    owner_user_id   TEXT NOT NULL,             -- authoritative scope (from project)
    provider        TEXT NOT NULL DEFAULT 'slack',
    team_id         TEXT NOT NULL DEFAULT '',  -- authoritative workspace id (from the token exchange)
    team_name       TEXT NOT NULL DEFAULT '',  -- workspace display name
    bot_user_id     TEXT NOT NULL DEFAULT '',  -- installed bot identity (NOT a token)
    app_id          TEXT NOT NULL DEFAULT '',
    scopes          TEXT NOT NULL DEFAULT '',  -- comma-delimited granted bot scopes
    bot_token_enc   TEXT NOT NULL DEFAULT '',  -- ENCRYPTED envelope (never plaintext)
    status          TEXT NOT NULL DEFAULT 'pending_selection',
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    last_sync_at    TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_slackconn_owner  ON slack_connections(owner_user_id);
CREATE INDEX IF NOT EXISTS ix_slackconn_status ON slack_connections(status);
CREATE INDEX IF NOT EXISTS ix_slackconn_team   ON slack_connections(team_id);

CREATE TABLE IF NOT EXISTS slack_selected_channels (
    project_id    TEXT NOT NULL,
    channel_id    TEXT NOT NULL,
    owner_user_id TEXT NOT NULL,             -- denormalized owner scope
    name          TEXT NOT NULL DEFAULT '',  -- display only
    is_private    INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL,
    PRIMARY KEY (project_id, channel_id)
);
CREATE INDEX IF NOT EXISTS ix_slackchan_owner ON slack_selected_channels(owner_user_id);
"""


@dataclass(frozen=True)
class SelectedChannel:
    """A channel bound to a Korvix project. Metadata only — no message content
    and no token ever lands here."""
    channel_id: str
    name: str
    is_private: bool

    def public_view(self) -> Dict[str, Any]:
        return {
            "channel_id": self.channel_id,
            "name": self.name,
            "is_private": self.is_private,
        }


@dataclass(frozen=True)
class SlackConnection:
    project_id: str
    owner_user_id: str
    provider: str
    team_id: str
    team_name: str
    bot_user_id: str
    app_id: str
    scopes: str
    bot_token_enc: str
    status: str
    created_at: str
    updated_at: str
    last_sync_at: str
    # Populated by `get_connection` so the connection is self-describing (the
    # route never has to re-query to render or authorize a sync).
    channels: Tuple[SelectedChannel, ...] = field(default=())

    @property
    def is_revoked(self) -> bool:
        return self.status == STATUS_REVOKED

    @property
    def is_connected(self) -> bool:
        """Only usable for sync once at least one channel is bound."""
        return self.status == STATUS_CONNECTED and bool(self.channels)

    @property
    def needs_channel_selection(self) -> bool:
        return self.status == STATUS_PENDING_SELECTION

    def public_view(self) -> Dict[str, Any]:
        """Frontend-safe projection — carries NO token/secret material, only the
        connection's identity, its bound channels, and lifecycle metadata."""
        return {
            "project_id": self.project_id,
            "provider": self.provider,
            "team_id": self.team_id or None,
            "team_name": self.team_name or None,
            "bot_user_id": self.bot_user_id or None,
            "scopes": [s for s in (self.scopes or "").replace(" ", "").split(",") if s],
            "channels": [c.public_view() for c in self.channels],
            "channel_count": len(self.channels),
            "status": self.status,
            "connected": self.is_connected,
            "needs_channel_selection": self.needs_channel_selection,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "last_sync_at": self.last_sync_at or None,
        }

    def owner_mismatch_view(self) -> Dict[str, Any]:
        """REDACTED projection for a row whose `owner_user_id` no longer matches
        the project's current owner.

        `public_view()` carries the workspace identity (`team_id`, `team_name`,
        `bot_user_id`, granted `scopes`) and every bound channel NAME. That is
        the previous owner's Slack information, and a project changing hands must
        not hand it to the new owner — so this projection states only that a
        stale connection EXISTS and must be re-established. It deliberately
        answers instead of erroring, because the status endpoint is what tells
        the UI to offer Reconnect / Disconnect; erasing the row from the response
        entirely would strand it with no way to clean it up.

        Carries no token material, no workspace identity, and no channel data."""
        return {
            "project_id": self.project_id,
            "provider": self.provider,
            "team_id": None,
            "team_name": None,
            "bot_user_id": None,
            "scopes": [],
            "channels": [],
            "channel_count": 0,
            "status": STATUS_OWNER_MISMATCH,
            "connected": False,
            "needs_channel_selection": False,
            # Timestamps describe the ROW, not the workspace, and the UI needs
            # them to explain that something stale is present.
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "last_sync_at": None,
        }


def _now() -> str:
    return datetime.utcnow().isoformat() + "Z"


def init_slack_tables() -> None:
    """Idempotent, additive bring-up. Failures are swallowed (never block)."""
    try:
        with _sqlite.connection(DB_PATH) as c:
            c.executescript(_SCHEMA)
    except Exception as exc:  # pragma: no cover — defensive
        logger.warning("slack.store.init failed: %s", exc)


def _row_to_conn(row, channels: Tuple[SelectedChannel, ...]) -> SlackConnection:
    d = dict(row)
    return SlackConnection(
        project_id=str(d["project_id"]),
        owner_user_id=str(d["owner_user_id"]),
        provider=str(d.get("provider") or PROVIDER),
        team_id=str(d.get("team_id") or ""),
        team_name=str(d.get("team_name") or ""),
        bot_user_id=str(d.get("bot_user_id") or ""),
        app_id=str(d.get("app_id") or ""),
        scopes=str(d.get("scopes") or ""),
        bot_token_enc=str(d.get("bot_token_enc") or ""),
        status=str(d.get("status") or STATUS_PENDING_SELECTION),
        created_at=str(d["created_at"]),
        updated_at=str(d["updated_at"]),
        last_sync_at=str(d.get("last_sync_at") or ""),
        channels=channels,
    )


def upsert_installation(
    *, project_id: str, owner_user_id: str, bot_token: str, team_id: str,
    team_name: str = "", bot_user_id: str = "", app_id: str = "", scopes: str = "",
) -> Optional[SlackConnection]:
    """Store (or replace) the Slack installation for a project, AWAITING channel
    selection.

    The bot token is ENCRYPTED here before storage — this raises
    `CredentialEncryptionError` (via the credential authority) if encryption is
    unavailable, so a plaintext token can never reach disk. `owner_user_id` MUST
    be the project's real owner (the route resolves it from the OAuth state /
    project, never from client input), and `team_id` MUST come from the token
    exchange response, never from a query param.

    A re-installation RESETS the binding to `pending_selection` and CLEARS the
    previously selected channels: the new authorization may target a different
    workspace, so the old channel ids are not assumed to still be valid."""
    project_id = str(project_id or "").strip()
    owner_user_id = str(owner_user_id or "").strip()
    team_id = str(team_id or "").strip()
    if not project_id or not owner_user_id or not team_id:
        return None
    if not bot_token:
        # Never store a connection without a usable credential.
        return None

    token_enc = credential_crypto.encrypt(bot_token)

    init_slack_tables()
    now = _now()
    try:
        with _sqlite.writer_tx(DB_PATH) as c:
            existing = c.execute(
                "SELECT created_at FROM slack_connections WHERE project_id=?",
                (project_id,),
            ).fetchone()
            created_at = str(existing["created_at"]) if existing else now
            c.execute(
                """INSERT INTO slack_connections
                   (project_id, owner_user_id, provider, team_id, team_name,
                    bot_user_id, app_id, scopes, bot_token_enc, status,
                    created_at, updated_at, last_sync_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '')
                   ON CONFLICT(project_id) DO UPDATE SET
                     owner_user_id=excluded.owner_user_id,
                     team_id=excluded.team_id,
                     team_name=excluded.team_name,
                     bot_user_id=excluded.bot_user_id,
                     app_id=excluded.app_id,
                     scopes=excluded.scopes,
                     bot_token_enc=excluded.bot_token_enc,
                     status=excluded.status,
                     last_sync_at='',
                     updated_at=excluded.updated_at""",
                (project_id, owner_user_id, PROVIDER, team_id,
                 str(team_name or "")[:200], str(bot_user_id or "")[:60],
                 str(app_id or "")[:60], str(scopes or "")[:500], token_enc,
                 STATUS_PENDING_SELECTION, created_at, now),
            )
            # A re-install invalidates any previous channel binding.
            c.execute("DELETE FROM slack_selected_channels WHERE project_id=?",
                      (project_id,))
        return get_connection(project_id)
    except Exception as exc:
        # A CredentialEncryptionError from encrypt() would already have raised
        # above (before the tx); anything here is a storage fault.
        logger.warning("slack.store.upsert_installation failed: %s", type(exc).__name__)
        return None


def set_selected_channels(
    *, project_id: str, owner_user_id: str, channels: List[Dict[str, Any]],
) -> Optional[SlackConnection]:
    """Bind a SERVER-REVALIDATED set of channels to an existing installation and
    mark the connection connected.

    The caller MUST have confirmed EVERY channel is visible AND readable under
    the stored bot token before calling this — this function persists a
    decision, it does not make one. The set is replaced wholesale (so unselecting
    is just a smaller list) and is hard-capped at
    `config.max_selected_channels()`; an over-long list is REFUSED rather than
    silently truncated, because silently ingesting fewer channels than the user
    chose would be a lie. An EMPTY list is refused too — a connection with no
    channel has nothing to sync and would strand the UI in a fake "connected"
    state."""
    project_id = str(project_id or "").strip()
    owner_user_id = str(owner_user_id or "").strip()
    if not project_id or not owner_user_id:
        return None
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
        ))
    if not rows or len(rows) > sl_config.max_selected_channels():
        return None

    init_slack_tables()
    now = _now()
    try:
        with _sqlite.writer_tx(DB_PATH) as c:
            cur = c.execute(
                """UPDATE slack_connections SET status=?, updated_at=?
                   WHERE project_id=? AND bot_token_enc != '' AND status != ?""",
                (STATUS_CONNECTED, now, project_id, STATUS_REVOKED),
            )
            if (cur.rowcount or 0) <= 0:
                # No live installation to bind to — do not create orphan rows.
                return None
            c.execute("DELETE FROM slack_selected_channels WHERE project_id=?",
                      (project_id,))
            for cid, name, is_private in rows:
                c.execute(
                    """INSERT INTO slack_selected_channels
                       (project_id, channel_id, owner_user_id, name, is_private, created_at)
                       VALUES (?, ?, ?, ?, ?, ?)""",
                    (project_id, cid, owner_user_id, name, is_private, now),
                )
        return get_connection(project_id)
    except Exception as exc:
        logger.warning("slack.store.set_selected_channels failed: %s", type(exc).__name__)
        return None


def list_selected_channels(project_id: str) -> Tuple[SelectedChannel, ...]:
    """The channels bound to a project, name-sorted for a stable display order."""
    project_id = str(project_id or "").strip()
    if not project_id:
        return ()
    init_slack_tables()
    try:
        with _sqlite.connection(DB_PATH) as c:
            rows = c.execute(
                """SELECT channel_id, name, is_private FROM slack_selected_channels
                   WHERE project_id=? ORDER BY name COLLATE NOCASE, channel_id""",
                (project_id,),
            ).fetchall()
        return tuple(
            SelectedChannel(channel_id=str(r["channel_id"]), name=str(r["name"] or ""),
                            is_private=bool(r["is_private"]))
            for r in rows
        )
    except Exception:
        return ()


def get_connection(project_id: str) -> Optional[SlackConnection]:
    if not project_id:
        return None
    init_slack_tables()
    try:
        with _sqlite.connection(DB_PATH) as c:
            row = c.execute(
                "SELECT * FROM slack_connections WHERE project_id=?",
                (str(project_id),),
            ).fetchone()
        if row is None:
            return None
        return _row_to_conn(row, list_selected_channels(str(project_id)))
    except Exception:
        return None


def mark_synced(project_id: str) -> None:
    project_id = str(project_id or "").strip()
    if not project_id:
        return
    init_slack_tables()
    try:
        with _sqlite.connection(DB_PATH) as c:
            c.execute(
                "UPDATE slack_connections SET last_sync_at=?, updated_at=? WHERE project_id=?",
                (_now(), _now(), project_id),
            )
    except Exception:
        pass


def mark_revoked(project_id: str) -> bool:
    """Flag a connection as revoked AND clear its credential material, so a
    rejected token can never be used again. The row (and the channel selection)
    is retained so the UI can offer a one-click reconnect; only the token is
    wiped."""
    project_id = str(project_id or "").strip()
    if not project_id:
        return False
    init_slack_tables()
    try:
        with _sqlite.connection(DB_PATH) as c:
            cur = c.execute(
                """UPDATE slack_connections
                   SET status=?, bot_token_enc='', updated_at=?
                   WHERE project_id=?""",
                (STATUS_REVOKED, _now(), project_id),
            )
            return (cur.rowcount or 0) > 0
    except Exception:
        return False


def delete_connection(project_id: str) -> bool:
    """Hard-delete this project's Slack connection + channel bindings (used by
    disconnect). Removes all stored Slack credential material for THIS project
    and NOTHING else: it never calls Slack, so the workspace installation and
    every other Korvix project bound to it are untouched."""
    project_id = str(project_id or "").strip()
    if not project_id:
        return False
    init_slack_tables()
    try:
        with _sqlite.writer_tx(DB_PATH) as c:
            c.execute("DELETE FROM slack_selected_channels WHERE project_id=?",
                      (project_id,))
            cur = c.execute(
                "DELETE FROM slack_connections WHERE project_id=?", (project_id,))
            return (cur.rowcount or 0) > 0
    except Exception:
        return False


def count_connected_for_team(team_id: str, *, exclude_project_id: str = "") -> int:
    """How many OTHER live Korvix connections exist for a Slack workspace.

    Read-only. Used by disconnect to tell the user TRUTHFULLY whether the
    workspace installation is shared with another Korvix project (it is never
    used to authorize anything). A blank team id matches nothing — we cannot
    prove identity, so we must not claim a match."""
    team_id = str(team_id or "").strip()
    if not team_id:
        return 0
    init_slack_tables()
    try:
        sql = ("SELECT COUNT(*) AS n FROM slack_connections "
               "WHERE team_id=? AND status<>?")
        params = [team_id, STATUS_REVOKED]
        if str(exclude_project_id or "").strip():
            sql += " AND project_id<>?"
            params.append(str(exclude_project_id).strip())
        with _sqlite.connection(DB_PATH) as c:
            row = c.execute(sql, params).fetchone()
        return int(row["n"]) if row else 0
    except Exception:
        return 0


def decrypt_bot_token(conn: SlackConnection) -> str:
    """Decrypt and return the stored bot token. Raises
    `CredentialEncryptionError` if encryption is unavailable or the envelope is
    bad. Returns "" when the connection carries no stored token."""
    if not conn.bot_token_enc:
        return ""
    return credential_crypto.decrypt(conn.bot_token_enc)


def _reset_for_tests() -> None:
    try:
        with _sqlite.connection(DB_PATH) as c:
            c.execute("DROP TABLE IF EXISTS slack_connections")
            c.execute("DROP TABLE IF EXISTS slack_selected_channels")
    except Exception:
        pass


__all__ = [
    "SlackConnection", "SelectedChannel", "PROVIDER",
    "STATUS_PENDING_SELECTION", "STATUS_CONNECTED", "STATUS_REVOKED",
    "STATUS_OWNER_MISMATCH",
    "init_slack_tables", "upsert_installation", "set_selected_channels",
    "list_selected_channels", "get_connection",
    "mark_synced", "mark_revoked", "delete_connection",
    "count_connected_for_team", "decrypt_bot_token",
]
