# coding: utf-8
"""Google Calendar connector — durable connection + credential store.

WHY ITS OWN SMALL TABLE
-----------------------
A Calendar connection carries an ENCRYPTED refresh token and cached access
token, plus scope/identity/lifecycle state. Those are credential material with
their own lifecycle (refresh, revoke), not a plain project setting, so they get
the SMALLEST durable table that models the connection — in the EXISTING
`projects.db` (same file as `projects`, `observations`, `gmail_connections` and
`vercel_connections`, so (user, project) scoping joins stay local). No second
database, no new persistence framework.

  calendar_connections   (project_id ⇄ owner_user_id ⇄ google account)

ISOLATION FROM GMAIL — THE POINT OF A SEPARATE TABLE
-----------------------------------------------------
Gmail and Calendar may share ONE Google OAuth client (see `config`), but they
are two logically distinct connections:

  * Separate tables → a Calendar connect/disconnect writes ONLY
    `calendar_connections`; `gmail_connections` is never read-modified-written
    by this module (it is only ever READ, without mutation, by the remote-revoke
    safety guard in `backend.services.google_grant`).
  * Separate refresh tokens → each connector holds the credential issued for
    ITS consent, carrying only ITS scope.
  * Separate `last_sync_at` / status lifecycles.

* `project_id` is the PRIMARY KEY → one Calendar connection per project (v1).
* `owner_user_id` is stored denormalized from the PROJECT at connect time and
  is the ONLY user id ever used to scope recorded observations — a caller can
  never smuggle a different user_id in.

SECRETS
-------
* The refresh token is stored ONLY as an encrypted envelope, via the EXISTING
  credential authority (`gmail.crypto` — one `KORVIX_CREDENTIAL_ENCRYPTION_KEY`,
  one cipher, the same module the Vercel connector reuses). It is never written
  in plaintext and never returned by any public projection.
* The cached access token is likewise stored encrypted; it is short-lived and
  re-derivable from the refresh token, so losing it is harmless.
* `public_view()` carries NO token material.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, Optional

from backend.core.paths import resolve_db_path
# The ONE credential-at-rest authority in the codebase (see vercel.store, which
# reuses it identically). Not a second cipher, not a second key.
from backend.services.gmail import crypto as credential_crypto
from backend.services.google_calendar import config as cal_config
from backend.services.orchestrator import _sqlite

logger = logging.getLogger(__name__)

DB_PATH = resolve_db_path("projects.db", "PROJECTS_DB_PATH")

PROVIDER = "calendar"

STATUS_CONNECTED = "connected"
STATUS_REVOKED = "revoked"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS calendar_connections (
    project_id            TEXT PRIMARY KEY,          -- one Calendar connection per project (v1)
    owner_user_id         TEXT NOT NULL,             -- authoritative scope (from project)
    provider              TEXT NOT NULL DEFAULT 'calendar',
    google_email          TEXT NOT NULL DEFAULT '',  -- connected account (primary calendar label)
    calendar_id           TEXT NOT NULL DEFAULT 'primary',
    time_zone             TEXT NOT NULL DEFAULT '',  -- calendar's IANA tz (display/context only)
    scopes                TEXT NOT NULL DEFAULT '',  -- space-delimited granted scopes
    refresh_token_enc     TEXT NOT NULL DEFAULT '',  -- ENCRYPTED envelope (never plaintext)
    access_token_enc      TEXT NOT NULL DEFAULT '',  -- ENCRYPTED envelope; short-lived cache
    access_token_expires  TEXT NOT NULL DEFAULT '',  -- ISO expiry of the cached access token
    status                TEXT NOT NULL DEFAULT 'connected',  -- connected | revoked
    created_at            TEXT NOT NULL,
    updated_at            TEXT NOT NULL,
    last_sync_at          TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_calconn_owner  ON calendar_connections(owner_user_id);
CREATE INDEX IF NOT EXISTS ix_calconn_email  ON calendar_connections(google_email);
CREATE INDEX IF NOT EXISTS ix_calconn_status ON calendar_connections(status);
"""


@dataclass(frozen=True)
class CalendarConnection:
    project_id: str
    owner_user_id: str
    provider: str
    google_email: str
    calendar_id: str
    time_zone: str
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
            "calendar_id": self.calendar_id,
            "time_zone": self.time_zone,
            "scopes": [s for s in (self.scopes or "").split(" ") if s],
            "status": self.status,
            "connected": self.status == STATUS_CONNECTED,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "last_sync_at": self.last_sync_at or None,
        }


def _now() -> str:
    return datetime.utcnow().isoformat() + "Z"


def init_calendar_tables() -> None:
    """Idempotent, additive bring-up. Failures are swallowed (never block)."""
    try:
        with _sqlite.connection(DB_PATH) as c:
            c.executescript(_SCHEMA)
    except Exception as exc:  # pragma: no cover — defensive
        logger.warning("calendar.store.init failed: %s", exc)


def _row_to_conn(row) -> CalendarConnection:
    d = dict(row)
    return CalendarConnection(
        project_id=str(d["project_id"]),
        owner_user_id=str(d["owner_user_id"]),
        provider=str(d.get("provider") or PROVIDER),
        google_email=str(d.get("google_email") or ""),
        calendar_id=str(d.get("calendar_id") or cal_config.PRIMARY_CALENDAR_ID),
        time_zone=str(d.get("time_zone") or ""),
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
    *, project_id: str, owner_user_id: str, google_email: str = "",
    calendar_id: str = "", time_zone: str = "", scopes: str = "",
    refresh_token: str, access_token: str = "", access_token_expires: str = "",
) -> Optional[CalendarConnection]:
    """Create/replace the Calendar connection for a project.

    The refresh token (and any access token) are ENCRYPTED here before storage —
    this method raises CredentialEncryptionError (via credential_crypto.encrypt)
    if encryption is unavailable, so a plaintext token can never reach disk. On a
    reconnect that yields no new refresh token (Google omits it), the caller must
    pass the previously-decrypted refresh token so the connection keeps a usable
    credential. `owner_user_id` MUST be the project's real owner (the route
    resolves it from the OAuth state / project, never from client input).

    Writes ONLY `calendar_connections` — the Gmail connection for the same
    project (and the same Google account) is untouched."""
    project_id = str(project_id or "").strip()
    owner_user_id = str(owner_user_id or "").strip()
    if not project_id or not owner_user_id:
        return None
    if not refresh_token:
        # Never store a connection without a usable refresh credential.
        return None

    refresh_enc = credential_crypto.encrypt(refresh_token)
    access_enc = credential_crypto.encrypt(access_token) if access_token else ""

    init_calendar_tables()
    now = _now()
    try:
        with _sqlite.writer_tx(DB_PATH) as c:
            existing = c.execute(
                "SELECT created_at FROM calendar_connections WHERE project_id=?",
                (project_id,),
            ).fetchone()
            created_at = str(existing["created_at"]) if existing else now
            c.execute(
                """INSERT INTO calendar_connections
                   (project_id, owner_user_id, provider, google_email, calendar_id,
                    time_zone, scopes, refresh_token_enc, access_token_enc,
                    access_token_expires, status, created_at, updated_at, last_sync_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '')
                   ON CONFLICT(project_id) DO UPDATE SET
                     owner_user_id=excluded.owner_user_id,
                     google_email=excluded.google_email,
                     calendar_id=excluded.calendar_id,
                     time_zone=excluded.time_zone,
                     scopes=excluded.scopes,
                     refresh_token_enc=excluded.refresh_token_enc,
                     access_token_enc=excluded.access_token_enc,
                     access_token_expires=excluded.access_token_expires,
                     status=excluded.status,
                     updated_at=excluded.updated_at""",
                (project_id, owner_user_id, PROVIDER, str(google_email or ""),
                 str(calendar_id or cal_config.PRIMARY_CALENDAR_ID),
                 str(time_zone or ""), str(scopes or ""), refresh_enc, access_enc,
                 str(access_token_expires or ""), STATUS_CONNECTED, created_at, now),
            )
        return get_connection(project_id)
    except Exception as exc:
        # A CredentialEncryptionError from encrypt() would already have raised
        # above (before the tx); anything here is a storage fault.
        logger.warning("calendar.store.upsert_connection failed: %s", type(exc).__name__)
        return None


def get_connection(project_id: str) -> Optional[CalendarConnection]:
    if not project_id:
        return None
    init_calendar_tables()
    try:
        with _sqlite.connection(DB_PATH) as c:
            row = c.execute(
                "SELECT * FROM calendar_connections WHERE project_id=?",
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
    access_enc = credential_crypto.encrypt(access_token) if access_token else ""
    init_calendar_tables()
    try:
        with _sqlite.connection(DB_PATH) as c:
            cur = c.execute(
                """UPDATE calendar_connections
                   SET access_token_enc=?, access_token_expires=?, updated_at=?
                   WHERE project_id=?""",
                (access_enc, str(expires_at or ""), _now(), project_id),
            )
            return (cur.rowcount or 0) > 0
    except Exception as exc:
        logger.warning("calendar.store.update_access_token failed: %s", type(exc).__name__)
        return False


def update_calendar_metadata(project_id: str, *, google_email: str = "",
                             calendar_id: str = "", time_zone: str = "") -> bool:
    """Refresh the cached display identity (calendar label / id / timezone) that
    the sync learned from the provider. Non-empty values only — a provider read
    that omits a field never blanks a previously known one. Touches NO credential
    column."""
    project_id = str(project_id or "").strip()
    if not project_id:
        return False
    sets, params = [], []
    if str(google_email or "").strip():
        sets.append("google_email=?"); params.append(str(google_email).strip())
    if str(calendar_id or "").strip():
        sets.append("calendar_id=?"); params.append(str(calendar_id).strip())
    if str(time_zone or "").strip():
        sets.append("time_zone=?"); params.append(str(time_zone).strip())
    if not sets:
        return False
    sets.append("updated_at=?"); params.append(_now())
    params.append(project_id)
    init_calendar_tables()
    try:
        with _sqlite.connection(DB_PATH) as c:
            cur = c.execute(
                f"UPDATE calendar_connections SET {', '.join(sets)} WHERE project_id=?",
                params,
            )
            return (cur.rowcount or 0) > 0
    except Exception:
        return False


def mark_synced(project_id: str) -> None:
    project_id = str(project_id or "").strip()
    if not project_id:
        return
    init_calendar_tables()
    try:
        with _sqlite.connection(DB_PATH) as c:
            c.execute(
                "UPDATE calendar_connections SET last_sync_at=?, updated_at=? WHERE project_id=?",
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
    init_calendar_tables()
    try:
        with _sqlite.connection(DB_PATH) as c:
            cur = c.execute(
                """UPDATE calendar_connections
                   SET status=?, refresh_token_enc='', access_token_enc='',
                       access_token_expires='', updated_at=?
                   WHERE project_id=?""",
                (STATUS_REVOKED, _now(), project_id),
            )
            return (cur.rowcount or 0) > 0
    except Exception:
        return False


def delete_connection(project_id: str) -> bool:
    """Hard-delete the Calendar connection row (used by disconnect). Removes all
    stored Calendar credential material and NOTHING else — the project's Gmail
    connection lives in a different table and is not touched."""
    project_id = str(project_id or "").strip()
    if not project_id:
        return False
    init_calendar_tables()
    try:
        with _sqlite.connection(DB_PATH) as c:
            cur = c.execute(
                "DELETE FROM calendar_connections WHERE project_id=?", (project_id,))
            return (cur.rowcount or 0) > 0
    except Exception:
        return False


def count_connected_for_email(google_email: str, *, exclude_project_id: str = "") -> int:
    """How many LIVE Calendar connections exist for a Google account.

    Read-only; used by `backend.services.google_grant` to decide whether a
    programmatic token revoke would also destroy a sibling connector's grant on
    a shared Google OAuth client. A blank email matches nothing (we cannot prove
    identity, so we must not claim a match)."""
    email = str(google_email or "").strip().lower()
    if not email:
        return 0
    init_calendar_tables()
    try:
        sql = ("SELECT COUNT(*) AS n FROM calendar_connections "
               "WHERE LOWER(google_email)=? AND status=?")
        params = [email, STATUS_CONNECTED]
        if str(exclude_project_id or "").strip():
            sql += " AND project_id<>?"
            params.append(str(exclude_project_id).strip())
        with _sqlite.connection(DB_PATH) as c:
            row = c.execute(sql, params).fetchone()
        return int(row["n"]) if row else 0
    except Exception:
        return 0


def decrypt_refresh_token(conn: CalendarConnection) -> str:
    """Decrypt and return the stored refresh token. Raises
    CredentialEncryptionError if encryption is unavailable or the envelope is
    bad. Returns "" when the connection carries no stored refresh token."""
    if not conn.refresh_token_enc:
        return ""
    return credential_crypto.decrypt(conn.refresh_token_enc)


def decrypt_access_token(conn: CalendarConnection) -> str:
    if not conn.access_token_enc:
        return ""
    return credential_crypto.decrypt(conn.access_token_enc)


def _reset_for_tests() -> None:
    try:
        with _sqlite.connection(DB_PATH) as c:
            c.execute("DROP TABLE IF EXISTS calendar_connections")
    except Exception:
        pass


__all__ = [
    "CalendarConnection", "PROVIDER", "STATUS_CONNECTED", "STATUS_REVOKED",
    "init_calendar_tables", "upsert_connection", "get_connection",
    "update_access_token", "update_calendar_metadata", "mark_synced",
    "mark_revoked", "delete_connection", "count_connected_for_email",
    "decrypt_refresh_token", "decrypt_access_token",
]
