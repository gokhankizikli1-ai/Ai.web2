# coding: utf-8
"""Vercel connector — durable connection + credential store.

WHY A SMALL TABLE (NOT project.metadata_json)
----------------------------------------------
A Vercel connection carries an ENCRYPTED access token plus scope/identity/
lifecycle state and the bound Vercel project. That is credential material with
its own lifecycle (authorize, revoke, rebind), not a plain project setting, so
it gets the SMALLEST durable table that models the connection — in the EXISTING
`projects.db` (same file as `projects` and `observations`, so (user, project)
scoping joins stay local). No second database.

  vercel_connections   (project_id ⇄ owner_user_id ⇄ Vercel account/team ⇄ project)

TWO-STEP LIFECYCLE
------------------
`STATUS_PENDING_SELECTION` — the OAuth exchange succeeded and the token is
stored, but the user has not yet chosen WHICH Vercel project belongs to this
Korvix project. Nothing is synced in this state.
`STATUS_CONNECTED` — a server-revalidated Vercel project is bound; sync may run.
`STATUS_REVOKED` — the token was rejected by Vercel; credential material is
wiped and a reconnect is required.

ISOLATION
---------
* `project_id` is the PRIMARY KEY → one Vercel connection per Korvix project.
* `owner_user_id` is stored denormalized from the PROJECT at connect time and is
  the ONLY user id ever used to scope recorded observations — a caller can never
  smuggle a different user_id in.

SECRETS
-------
* The access token is stored ONLY as an encrypted envelope, produced by the
  EXISTING credential authority (`gmail.crypto`, keyed by
  `KORVIX_CREDENTIAL_ENCRYPTION_KEY`). This connector adds no second cipher and
  no second key, and there is no plaintext fallback: `upsert_connection` raises
  `CredentialEncryptionError` rather than writing a bare token.
* `public_view()` carries NO token material.

TEAM SCOPE
----------
`team_id` (empty for a personal installation) is persisted and applied by the
read client on EVERY request. Losing it would silently re-scope reads to the
personal account, so it is part of the connection identity, not an option.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, Optional

from backend.core.paths import resolve_db_path
# The single credential-at-rest authority (see module docstring) — imported,
# never reimplemented.
from backend.services.gmail import crypto as credential_crypto
from backend.services.orchestrator import _sqlite

logger = logging.getLogger(__name__)

DB_PATH = resolve_db_path("projects.db", "PROJECTS_DB_PATH")

PROVIDER = "vercel"

STATUS_PENDING_SELECTION = "pending_selection"
STATUS_CONNECTED = "connected"
STATUS_REVOKED = "revoked"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS vercel_connections (
    project_id            TEXT PRIMARY KEY,          -- one Vercel connection per Korvix project
    owner_user_id         TEXT NOT NULL,             -- authoritative scope (from project)
    provider              TEXT NOT NULL DEFAULT 'vercel',
    account_label         TEXT NOT NULL DEFAULT '',  -- team name or username (display only)
    team_id               TEXT NOT NULL DEFAULT '',  -- '' ⇒ personal installation
    installation_id       TEXT NOT NULL DEFAULT '',  -- Vercel integration configuration id
    vercel_user_id        TEXT NOT NULL DEFAULT '',  -- the Vercel user who authorized
    access_token_enc      TEXT NOT NULL DEFAULT '',  -- ENCRYPTED envelope (never plaintext)
    vercel_project_id     TEXT NOT NULL DEFAULT '',  -- bound Vercel project (after selection)
    vercel_project_name   TEXT NOT NULL DEFAULT '',
    framework             TEXT NOT NULL DEFAULT '',
    production_url        TEXT NOT NULL DEFAULT '',
    status                TEXT NOT NULL DEFAULT 'pending_selection',
    created_at            TEXT NOT NULL,
    updated_at            TEXT NOT NULL,
    last_sync_at          TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_vercelconn_owner   ON vercel_connections(owner_user_id);
CREATE INDEX IF NOT EXISTS ix_vercelconn_status  ON vercel_connections(status);
CREATE INDEX IF NOT EXISTS ix_vercelconn_project ON vercel_connections(vercel_project_id);
"""


@dataclass(frozen=True)
class VercelConnection:
    project_id: str
    owner_user_id: str
    provider: str
    account_label: str
    team_id: str
    installation_id: str
    vercel_user_id: str
    access_token_enc: str
    vercel_project_id: str
    vercel_project_name: str
    framework: str
    production_url: str
    status: str
    created_at: str
    updated_at: str
    last_sync_at: str

    @property
    def is_revoked(self) -> bool:
        return self.status == STATUS_REVOKED

    @property
    def is_connected(self) -> bool:
        """A connection is only usable for sync once a Vercel project is bound."""
        return self.status == STATUS_CONNECTED and bool(self.vercel_project_id)

    @property
    def needs_project_selection(self) -> bool:
        return self.status == STATUS_PENDING_SELECTION

    def public_view(self) -> Dict[str, Any]:
        """Frontend-safe projection — carries NO token/secret material, only the
        connection's identity + lifecycle metadata."""
        return {
            "project_id": self.project_id,
            "provider": self.provider,
            "account_label": self.account_label,
            "team_id": self.team_id or None,
            "vercel_project_id": self.vercel_project_id or None,
            "vercel_project_name": self.vercel_project_name or None,
            "framework": self.framework or None,
            "production_url": self.production_url or None,
            "status": self.status,
            "connected": self.is_connected,
            "needs_project_selection": self.needs_project_selection,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "last_sync_at": self.last_sync_at or None,
        }


def _now() -> str:
    return datetime.utcnow().isoformat() + "Z"


def init_vercel_tables() -> None:
    """Idempotent, additive bring-up. Failures are swallowed (never block)."""
    try:
        with _sqlite.connection(DB_PATH) as c:
            c.executescript(_SCHEMA)
    except Exception as exc:  # pragma: no cover — defensive
        logger.warning("vercel.store.init failed: %s", exc)


def _row_to_conn(row) -> VercelConnection:
    d = dict(row)
    return VercelConnection(
        project_id=str(d["project_id"]),
        owner_user_id=str(d["owner_user_id"]),
        provider=str(d.get("provider") or PROVIDER),
        account_label=str(d.get("account_label") or ""),
        team_id=str(d.get("team_id") or ""),
        installation_id=str(d.get("installation_id") or ""),
        vercel_user_id=str(d.get("vercel_user_id") or ""),
        access_token_enc=str(d.get("access_token_enc") or ""),
        vercel_project_id=str(d.get("vercel_project_id") or ""),
        vercel_project_name=str(d.get("vercel_project_name") or ""),
        framework=str(d.get("framework") or ""),
        production_url=str(d.get("production_url") or ""),
        status=str(d.get("status") or STATUS_PENDING_SELECTION),
        created_at=str(d["created_at"]),
        updated_at=str(d["updated_at"]),
        last_sync_at=str(d.get("last_sync_at") or ""),
    )


def upsert_authorization(
    *, project_id: str, owner_user_id: str, access_token: str,
    account_label: str = "", team_id: str = "", installation_id: str = "",
    vercel_user_id: str = "",
) -> Optional[VercelConnection]:
    """Store (or replace) the authorization for a project, AWAITING project
    selection.

    The access token is ENCRYPTED here before storage — this raises
    `CredentialEncryptionError` (via the credential authority) if encryption is
    unavailable, so a plaintext token can never reach disk. `owner_user_id` MUST
    be the project's real owner (the route resolves it from the project, never
    from client input).

    A re-authorization RESETS the binding to `pending_selection` and clears any
    previously bound Vercel project: the new token may have a different team
    scope, so the old binding is not assumed to still be valid."""
    project_id = str(project_id or "").strip()
    owner_user_id = str(owner_user_id or "").strip()
    if not project_id or not owner_user_id:
        return None
    if not access_token:
        # Never store a connection without a usable credential.
        return None

    token_enc = credential_crypto.encrypt(access_token)

    init_vercel_tables()
    now = _now()
    try:
        with _sqlite.writer_tx(DB_PATH) as c:
            existing = c.execute(
                "SELECT created_at FROM vercel_connections WHERE project_id=?",
                (project_id,),
            ).fetchone()
            created_at = str(existing["created_at"]) if existing else now
            c.execute(
                """INSERT INTO vercel_connections
                   (project_id, owner_user_id, provider, account_label, team_id,
                    installation_id, vercel_user_id, access_token_enc,
                    vercel_project_id, vercel_project_name, framework,
                    production_url, status, created_at, updated_at, last_sync_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', '', '', '', ?, ?, ?, '')
                   ON CONFLICT(project_id) DO UPDATE SET
                     owner_user_id=excluded.owner_user_id,
                     account_label=excluded.account_label,
                     team_id=excluded.team_id,
                     installation_id=excluded.installation_id,
                     vercel_user_id=excluded.vercel_user_id,
                     access_token_enc=excluded.access_token_enc,
                     vercel_project_id='',
                     vercel_project_name='',
                     framework='',
                     production_url='',
                     status=excluded.status,
                     last_sync_at='',
                     updated_at=excluded.updated_at""",
                (project_id, owner_user_id, PROVIDER, str(account_label or "")[:200],
                 str(team_id or ""), str(installation_id or ""), str(vercel_user_id or ""),
                 token_enc, STATUS_PENDING_SELECTION, created_at, now),
            )
        return get_connection(project_id)
    except Exception as exc:
        # A CredentialEncryptionError from encrypt() would already have raised
        # above (before the tx); anything here is a storage fault.
        logger.warning("vercel.store.upsert_authorization failed: %s", type(exc).__name__)
        return None


def bind_project(
    *, project_id: str, vercel_project_id: str, name: str = "",
    framework: str = "", production_url: str = "",
) -> Optional[VercelConnection]:
    """Bind a SERVER-REVALIDATED Vercel project to an existing authorization and
    mark the connection connected. The caller MUST have confirmed the project is
    accessible under the stored token's team scope before calling this — this
    function persists a decision, it does not make one."""
    project_id = str(project_id or "").strip()
    vercel_project_id = str(vercel_project_id or "").strip()
    if not project_id or not vercel_project_id:
        return None
    init_vercel_tables()
    now = _now()
    try:
        with _sqlite.connection(DB_PATH) as c:
            cur = c.execute(
                """UPDATE vercel_connections
                   SET vercel_project_id=?, vercel_project_name=?, framework=?,
                       production_url=?, status=?, updated_at=?
                   WHERE project_id=? AND access_token_enc != '' AND status != ?""",
                (vercel_project_id, str(name or "")[:200], str(framework or "")[:60],
                 str(production_url or "")[:400], STATUS_CONNECTED, now,
                 project_id, STATUS_REVOKED),
            )
            if (cur.rowcount or 0) <= 0:
                return None
        return get_connection(project_id)
    except Exception as exc:
        logger.warning("vercel.store.bind_project failed: %s", type(exc).__name__)
        return None


def update_project_metadata(project_id: str, *, name: str = "", framework: str = "",
                            production_url: str = "") -> bool:
    """Refresh the cached display metadata of the bound Vercel project (name /
    framework / production URL) after a sync read. Carries no credential."""
    project_id = str(project_id or "").strip()
    if not project_id:
        return False
    init_vercel_tables()
    try:
        with _sqlite.connection(DB_PATH) as c:
            cur = c.execute(
                """UPDATE vercel_connections
                   SET vercel_project_name=?, framework=?, production_url=?, updated_at=?
                   WHERE project_id=?""",
                (str(name or "")[:200], str(framework or "")[:60],
                 str(production_url or "")[:400], _now(), project_id),
            )
            return (cur.rowcount or 0) > 0
    except Exception:
        return False


def get_connection(project_id: str) -> Optional[VercelConnection]:
    if not project_id:
        return None
    init_vercel_tables()
    try:
        with _sqlite.connection(DB_PATH) as c:
            row = c.execute(
                "SELECT * FROM vercel_connections WHERE project_id=?",
                (str(project_id),),
            ).fetchone()
        return _row_to_conn(row) if row else None
    except Exception:
        return None


def mark_synced(project_id: str) -> None:
    project_id = str(project_id or "").strip()
    if not project_id:
        return
    init_vercel_tables()
    try:
        with _sqlite.connection(DB_PATH) as c:
            c.execute(
                "UPDATE vercel_connections SET last_sync_at=?, updated_at=? WHERE project_id=?",
                (_now(), _now(), project_id),
            )
    except Exception:
        pass


def mark_revoked(project_id: str) -> bool:
    """Flag a connection as revoked AND clear its credential material, so a
    rejected token can never be used again. The row is retained (status surfaced
    to the UI); the token is wiped."""
    project_id = str(project_id or "").strip()
    if not project_id:
        return False
    init_vercel_tables()
    try:
        with _sqlite.connection(DB_PATH) as c:
            cur = c.execute(
                """UPDATE vercel_connections
                   SET status=?, access_token_enc='', updated_at=?
                   WHERE project_id=?""",
                (STATUS_REVOKED, _now(), project_id),
            )
            return (cur.rowcount or 0) > 0
    except Exception:
        return False


def delete_connection(project_id: str) -> bool:
    """Hard-delete the connection row (used by disconnect). Removes all stored
    credential material. Local only — it never mutates anything at Vercel."""
    project_id = str(project_id or "").strip()
    if not project_id:
        return False
    init_vercel_tables()
    try:
        with _sqlite.connection(DB_PATH) as c:
            cur = c.execute(
                "DELETE FROM vercel_connections WHERE project_id=?", (project_id,))
            return (cur.rowcount or 0) > 0
    except Exception:
        return False


def decrypt_access_token(conn: VercelConnection) -> str:
    """Decrypt and return the stored access token. Raises
    `CredentialEncryptionError` if encryption is unavailable or the envelope is
    bad. Returns "" when the connection carries no stored token."""
    if not conn.access_token_enc:
        return ""
    return credential_crypto.decrypt(conn.access_token_enc)


def _reset_for_tests() -> None:
    try:
        with _sqlite.connection(DB_PATH) as c:
            c.execute("DROP TABLE IF EXISTS vercel_connections")
    except Exception:
        pass


__all__ = [
    "VercelConnection", "PROVIDER", "STATUS_PENDING_SELECTION",
    "STATUS_CONNECTED", "STATUS_REVOKED", "init_vercel_tables",
    "upsert_authorization", "bind_project", "update_project_metadata",
    "get_connection", "mark_synced", "mark_revoked", "delete_connection",
    "decrypt_access_token",
]
