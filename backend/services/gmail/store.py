# coding: utf-8
"""Gmail connector — durable connection + credential store.

WHY A SMALL TABLE (NOT project.metadata_json)
----------------------------------------------
A Gmail connection carries an ENCRYPTED refresh token and cached access token,
plus scope/identity/lifecycle state. Those are credential material with their
own lifecycle (refresh, revoke), not a plain project setting, so they get the
SMALLEST durable table that models the connection — in the EXISTING
`projects.db` (same file as `projects` and `observations`, so (user, project)
scoping joins stay local). No second database.

  gmail_connections   (project_id ⇄ owner_user_id ⇄ google account)

ISOLATION
---------
* `project_id` is the PRIMARY KEY → one Gmail connection per project (v1).
* `owner_user_id` is stored denormalized from the PROJECT at connect time and
  is the ONLY user id ever used to scope recorded observations — a caller can
  never smuggle a different user_id in.

SECRETS
-------
* The refresh token is stored ONLY as an encrypted envelope
  (`gmail.crypto.encrypt`). It is never written in plaintext and never returned
  by any public projection. `public_view()` carries NO token material.
* The cached access token is likewise stored encrypted; it is short-lived and
  re-derivable from the refresh token, so losing it is harmless.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, Optional

from backend.core.paths import resolve_db_path
from backend.services.gmail import crypto as gm_crypto
from backend.services.orchestrator import _sqlite

logger = logging.getLogger(__name__)

DB_PATH = resolve_db_path("projects.db", "PROJECTS_DB_PATH")

PROVIDER = "gmail"

STATUS_CONNECTED = "connected"
STATUS_REVOKED = "revoked"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS gmail_connections (
    project_id            TEXT PRIMARY KEY,          -- one Gmail connection per project (v1)
    owner_user_id         TEXT NOT NULL,             -- authoritative scope (from project)
    provider              TEXT NOT NULL DEFAULT 'gmail',
    google_email          TEXT NOT NULL DEFAULT '',  -- connected account address (identity)
    scopes                TEXT NOT NULL DEFAULT '',   -- space-delimited granted scopes
    refresh_token_enc     TEXT NOT NULL DEFAULT '',   -- ENCRYPTED envelope (never plaintext)
    access_token_enc      TEXT NOT NULL DEFAULT '',   -- ENCRYPTED envelope; short-lived cache
    access_token_expires  TEXT NOT NULL DEFAULT '',   -- ISO expiry of the cached access token
    status                TEXT NOT NULL DEFAULT 'connected',  -- connected | revoked
    created_at            TEXT NOT NULL,
    updated_at            TEXT NOT NULL,
    last_sync_at          TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_gmailconn_owner  ON gmail_connections(owner_user_id);
CREATE INDEX IF NOT EXISTS ix_gmailconn_email  ON gmail_connections(google_email);
CREATE INDEX IF NOT EXISTS ix_gmailconn_status ON gmail_connections(status);
"""


@dataclass(frozen=True)
class GmailConnection:
    project_id: str
    owner_user_id: str
    provider: str
    google_email: str
    scopes: str
    refresh_token_enc: str
    access_token_enc: str
    access_token_expires: str
    status: str
    created_at: str
    updated_at: str
    last_sync_at: str

    @property
    def is_revoked(self) -> bool:
        return self.status == STATUS_REVOKED

    def public_view(self) -> Dict[str, Any]:
        """Frontend-safe projection — carries NO token/secret material, only the
        connection's identity + lifecycle metadata."""
        return {
            "project_id": self.project_id,
            "provider": self.provider,
            "google_email": self.google_email,
            "scopes": [s for s in (self.scopes or "").split(" ") if s],
            "status": self.status,
            "connected": self.status == STATUS_CONNECTED,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "last_sync_at": self.last_sync_at or None,
        }


def _now() -> str:
    return datetime.utcnow().isoformat() + "Z"


def init_gmail_tables() -> None:
    """Idempotent, additive bring-up. Failures are swallowed (never block)."""
    try:
        with _sqlite.connection(DB_PATH) as c:
            c.executescript(_SCHEMA)
    except Exception as exc:  # pragma: no cover — defensive
        logger.warning("gmail.store.init failed: %s", exc)


def _row_to_conn(row) -> GmailConnection:
    d = dict(row)
    return GmailConnection(
        project_id=str(d["project_id"]),
        owner_user_id=str(d["owner_user_id"]),
        provider=str(d.get("provider") or PROVIDER),
        google_email=str(d.get("google_email") or ""),
        scopes=str(d.get("scopes") or ""),
        refresh_token_enc=str(d.get("refresh_token_enc") or ""),
        access_token_enc=str(d.get("access_token_enc") or ""),
        access_token_expires=str(d.get("access_token_expires") or ""),
        status=str(d.get("status") or STATUS_CONNECTED),
        created_at=str(d["created_at"]),
        updated_at=str(d["updated_at"]),
        last_sync_at=str(d.get("last_sync_at") or ""),
    )


def upsert_connection(
    *, project_id: str, owner_user_id: str, google_email: str, scopes: str,
    refresh_token: str, access_token: str = "", access_token_expires: str = "",
) -> Optional[GmailConnection]:
    """Create/replace the Gmail connection for a project.

    The refresh token (and any access token) are ENCRYPTED here before storage —
    this method raises CredentialEncryptionError (via gm_crypto.encrypt) if
    encryption is unavailable, so a plaintext token can never reach disk. On a
    reconnect that yields no new refresh token (Google omits it), the caller
    must pass the previously-decrypted refresh token so the connection keeps a
    usable credential. `owner_user_id` MUST be the project's real owner (the
    route resolves it from the project, never from client input)."""
    project_id = str(project_id or "").strip()
    owner_user_id = str(owner_user_id or "").strip()
    if not project_id or not owner_user_id:
        return None
    if not refresh_token:
        # Never store a connection without a usable refresh credential.
        return None

    refresh_enc = gm_crypto.encrypt(refresh_token)
    access_enc = gm_crypto.encrypt(access_token) if access_token else ""

    init_gmail_tables()
    now = _now()
    try:
        with _sqlite.writer_tx(DB_PATH) as c:
            existing = c.execute(
                "SELECT created_at FROM gmail_connections WHERE project_id=?",
                (project_id,),
            ).fetchone()
            created_at = str(existing["created_at"]) if existing else now
            c.execute(
                """INSERT INTO gmail_connections
                   (project_id, owner_user_id, provider, google_email, scopes,
                    refresh_token_enc, access_token_enc, access_token_expires,
                    status, created_at, updated_at, last_sync_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '')
                   ON CONFLICT(project_id) DO UPDATE SET
                     owner_user_id=excluded.owner_user_id,
                     google_email=excluded.google_email,
                     scopes=excluded.scopes,
                     refresh_token_enc=excluded.refresh_token_enc,
                     access_token_enc=excluded.access_token_enc,
                     access_token_expires=excluded.access_token_expires,
                     status=excluded.status,
                     updated_at=excluded.updated_at""",
                (project_id, owner_user_id, PROVIDER, str(google_email or ""),
                 str(scopes or ""), refresh_enc, access_enc,
                 str(access_token_expires or ""), STATUS_CONNECTED, created_at, now),
            )
        return get_connection(project_id)
    except Exception as exc:
        # A CredentialEncryptionError from encrypt() would already have raised
        # above (before the tx); anything here is a storage fault.
        logger.warning("gmail.store.upsert_connection failed: %s", type(exc).__name__)
        return None


def get_connection(project_id: str) -> Optional[GmailConnection]:
    if not project_id:
        return None
    init_gmail_tables()
    try:
        with _sqlite.connection(DB_PATH) as c:
            row = c.execute(
                "SELECT * FROM gmail_connections WHERE project_id=?",
                (str(project_id),),
            ).fetchone()
        return _row_to_conn(row) if row else None
    except Exception:
        return None


def update_access_token(project_id: str, *, access_token: str, expires_at: str) -> bool:
    """Persist a freshly-refreshed access token (encrypted) + its expiry. Never
    stores plaintext. Returns True on success."""
    project_id = str(project_id or "").strip()
    if not project_id:
        return False
    access_enc = gm_crypto.encrypt(access_token) if access_token else ""
    init_gmail_tables()
    try:
        with _sqlite.connection(DB_PATH) as c:
            cur = c.execute(
                """UPDATE gmail_connections
                   SET access_token_enc=?, access_token_expires=?, updated_at=?
                   WHERE project_id=?""",
                (access_enc, str(expires_at or ""), _now(), project_id),
            )
            return (cur.rowcount or 0) > 0
    except Exception as exc:
        logger.warning("gmail.store.update_access_token failed: %s", type(exc).__name__)
        return False


def mark_synced(project_id: str) -> None:
    project_id = str(project_id or "").strip()
    if not project_id:
        return
    init_gmail_tables()
    try:
        with _sqlite.connection(DB_PATH) as c:
            c.execute(
                "UPDATE gmail_connections SET last_sync_at=?, updated_at=? WHERE project_id=?",
                (_now(), _now(), project_id),
            )
    except Exception:
        pass


def mark_revoked(project_id: str) -> bool:
    """Flag a connection as revoked AND clear its credential material, so a
    revoked/invalid grant can never be used again. The row is retained (status
    surfaced to the UI); tokens are wiped."""
    project_id = str(project_id or "").strip()
    if not project_id:
        return False
    init_gmail_tables()
    try:
        with _sqlite.connection(DB_PATH) as c:
            cur = c.execute(
                """UPDATE gmail_connections
                   SET status=?, refresh_token_enc='', access_token_enc='',
                       access_token_expires='', updated_at=?
                   WHERE project_id=?""",
                (STATUS_REVOKED, _now(), project_id),
            )
            return (cur.rowcount or 0) > 0
    except Exception:
        return False


def delete_connection(project_id: str) -> bool:
    """Hard-delete the connection row (used by disconnect after remote revoke).
    Removes all stored credential material."""
    project_id = str(project_id or "").strip()
    if not project_id:
        return False
    init_gmail_tables()
    try:
        with _sqlite.connection(DB_PATH) as c:
            cur = c.execute(
                "DELETE FROM gmail_connections WHERE project_id=?", (project_id,))
            return (cur.rowcount or 0) > 0
    except Exception:
        return False


def decrypt_refresh_token(conn: GmailConnection) -> str:
    """Decrypt and return the stored refresh token. Raises
    CredentialEncryptionError if encryption is unavailable or the envelope is
    bad. Returns "" when the connection carries no stored refresh token."""
    if not conn.refresh_token_enc:
        return ""
    return gm_crypto.decrypt(conn.refresh_token_enc)


def decrypt_access_token(conn: GmailConnection) -> str:
    if not conn.access_token_enc:
        return ""
    return gm_crypto.decrypt(conn.access_token_enc)


def _reset_for_tests() -> None:
    try:
        with _sqlite.connection(DB_PATH) as c:
            c.execute("DROP TABLE IF EXISTS gmail_connections")
    except Exception:
        pass


__all__ = [
    "GmailConnection", "PROVIDER", "STATUS_CONNECTED", "STATUS_REVOKED",
    "init_gmail_tables", "upsert_connection", "get_connection",
    "update_access_token", "mark_synced", "mark_revoked", "delete_connection",
    "decrypt_refresh_token", "decrypt_access_token",
]
