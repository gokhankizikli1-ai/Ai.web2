# coding: utf-8
"""
SQLite-backed users + refresh_tokens storage for Phase 3.

A NEW SQLite file (default `auth.db`, override via AUTH_DB_PATH). Kept
separate from memory.db / sessions.db so this phase has a clean rollback
(delete the file; no other subsystem reads it).

Tables:
  auth_users           one row per identity. (kind, external_id) is
                       unique so e.g. two distinct Google accounts can
                       coexist and a guest can be promoted to email
                       later without a primary-key collision.
  auth_refresh_tokens  one row per issued refresh token. Used to
                       support rotation (mark old as revoked when a new
                       one is issued in the same family) and explicit
                       logout (revoke the whole family).

Both tables use TEXT timestamps in ISO-8601 UTC so they're greppable
and survive a migration to Postgres later without lossy conversion.

Public API (all sync, all use a fresh connection per call):
  init()                                idempotent table create
  get_or_create_user(kind, external_id, display_name="")  -> User
  get_user_by_id(user_id)                                 -> User|None
  touch_user(user_id)                                     -> None
  record_refresh_token(jti, user_id, expires_at, family_id)
                                                          -> None
  refresh_token_is_revoked(jti)                           -> bool
  revoke_refresh_token(jti)                               -> None
  revoke_family(family_id)                                -> int
                                                            (rows updated)
"""
from __future__ import annotations

import contextlib
import logging
import os
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from typing import Iterator, Optional

from backend.core.config import settings
from backend.services.auth.identity import User, VALID_KINDS


logger = logging.getLogger(__name__)


# Single shared connection-lock — SQLite is fine with concurrent reads
# but writes serialize. We open a fresh connection per call (cheap on
# SQLite) and let the OS-level lock arbitrate writers.
_LOCK = threading.Lock()


def _db_path() -> str:
    return os.getenv("AUTH_DB_PATH", settings.AUTH_DB_PATH)


@contextlib.contextmanager
def _conn() -> Iterator[sqlite3.Connection]:
    c = sqlite3.connect(_db_path(), timeout=10)
    try:
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA foreign_keys = ON")
        yield c
        c.commit()
    finally:
        c.close()


_DDL = """
CREATE TABLE IF NOT EXISTS auth_users (
    id            TEXT PRIMARY KEY,
    kind          TEXT NOT NULL,
    external_id   TEXT NOT NULL,
    display_name  TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL,
    last_seen_at  TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_auth_users_kind_extid
    ON auth_users(kind, external_id);

CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
    jti          TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    family_id    TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    expires_at   TEXT NOT NULL,
    revoked_at   TEXT
);
CREATE INDEX IF NOT EXISTS ix_auth_refresh_user_id
    ON auth_refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS ix_auth_refresh_family
    ON auth_refresh_tokens(family_id);
CREATE INDEX IF NOT EXISTS ix_auth_refresh_expires
    ON auth_refresh_tokens(expires_at);
"""


_INITIALIZED = False


def init() -> None:
    """Create tables if they don't exist. Idempotent. Called lazily on
    the first storage operation so import-time isn't blocked on disk."""
    global _INITIALIZED
    if _INITIALIZED:
        return
    with _LOCK:
        if _INITIALIZED:
            return
        with _conn() as c:
            c.executescript(_DDL)
        _INITIALIZED = True
        logger.info("auth.storage initialized | db=%s", _db_path())


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    return uuid.uuid4().hex


# ── Users ─────────────────────────────────────────────────────────────────

def _row_to_user(row: sqlite3.Row) -> User:
    import json
    try:
        meta = json.loads(row["metadata_json"] or "{}")
        if not isinstance(meta, dict):
            meta = {}
    except Exception:
        meta = {}
    return User(
        id=           row["id"],
        kind=         row["kind"],
        external_id=  row["external_id"],
        display_name= row["display_name"] or "",
        created_at=   row["created_at"],
        last_seen_at= row["last_seen_at"],
        metadata=     meta,
    )


def get_or_create_user(
    kind: str,
    external_id: str,
    display_name: str = "",
) -> User:
    """Return the existing user for (kind, external_id) or create one.

    Caller is responsible for passing a canonical external_id (e.g.
    lowercase email, OAuth subject id, etc.). For guest users the
    external_id is "guest:<nonce>" where nonce is the stable browser id
    sent in X-Korvix-Guest-Id (the auth middleware generates one if
    absent).
    """
    if kind not in VALID_KINDS:
        raise ValueError(f"unknown user kind: {kind!r}")
    init()
    with _conn() as c:
        cur = c.execute(
            "SELECT * FROM auth_users WHERE kind = ? AND external_id = ?",
            (kind, external_id),
        )
        row = cur.fetchone()
        if row:
            return _row_to_user(row)
        # Insert — race-safe via UNIQUE constraint.
        uid = _new_id()
        now = _now_iso()
        try:
            c.execute(
                "INSERT INTO auth_users (id, kind, external_id, display_name, "
                "created_at, last_seen_at, metadata_json) "
                "VALUES (?, ?, ?, ?, ?, ?, '{}')",
                (uid, kind, external_id, display_name, now, now),
            )
        except sqlite3.IntegrityError:
            # Another concurrent caller inserted first — re-read.
            cur = c.execute(
                "SELECT * FROM auth_users WHERE kind = ? AND external_id = ?",
                (kind, external_id),
            )
            row = cur.fetchone()
            if row:
                return _row_to_user(row)
            raise   # genuinely unexpected
        return User(
            id=uid, kind=kind, external_id=external_id,
            display_name=display_name, created_at=now, last_seen_at=now,
            metadata={},
        )


def get_user_by_id(user_id: str) -> Optional[User]:
    init()
    with _conn() as c:
        cur = c.execute("SELECT * FROM auth_users WHERE id = ?", (user_id,))
        row = cur.fetchone()
        return _row_to_user(row) if row else None


def touch_user(user_id: str) -> None:
    """Update last_seen_at to now. Best-effort — silently no-ops if the
    user is missing (the middleware shouldn't crash on a freshly-deleted
    user racing with an in-flight request)."""
    init()
    with _conn() as c:
        c.execute(
            "UPDATE auth_users SET last_seen_at = ? WHERE id = ?",
            (_now_iso(), user_id),
        )


# ── Refresh tokens ────────────────────────────────────────────────────────

def record_refresh_token(jti: str, user_id: str, expires_at: str, family_id: str) -> None:
    init()
    with _conn() as c:
        c.execute(
            "INSERT INTO auth_refresh_tokens (jti, user_id, family_id, created_at, expires_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (jti, user_id, family_id, _now_iso(), expires_at),
        )


def refresh_token_is_revoked(jti: str) -> bool:
    """Return True if the jti was issued AND has been revoked.

    NOTE: returns False for a jti we've never seen — that's
    intentional. The verify() step on the token itself catches
    signature/expiry; this table is only for explicit invalidation.
    """
    init()
    with _conn() as c:
        cur = c.execute(
            "SELECT revoked_at FROM auth_refresh_tokens WHERE jti = ?",
            (jti,),
        )
        row = cur.fetchone()
        if not row:
            return False
        return row["revoked_at"] is not None


def revoke_refresh_token(jti: str) -> None:
    init()
    with _conn() as c:
        c.execute(
            "UPDATE auth_refresh_tokens SET revoked_at = ? WHERE jti = ? AND revoked_at IS NULL",
            (_now_iso(), jti),
        )


def revoke_family(family_id: str) -> int:
    """Revoke every refresh token in a rotation family. Returns the
    number of rows updated. Used on logout and on suspected theft
    (when an already-revoked token is presented for refresh)."""
    init()
    with _conn() as c:
        cur = c.execute(
            "UPDATE auth_refresh_tokens SET revoked_at = ? "
            "WHERE family_id = ? AND revoked_at IS NULL",
            (_now_iso(), family_id),
        )
        return cur.rowcount


def get_refresh_token_family(jti: str) -> Optional[str]:
    init()
    with _conn() as c:
        cur = c.execute(
            "SELECT family_id FROM auth_refresh_tokens WHERE jti = ?",
            (jti,),
        )
        row = cur.fetchone()
        return row["family_id"] if row else None


__all__ = [
    "init",
    "get_or_create_user", "get_user_by_id", "touch_user",
    "record_refresh_token", "refresh_token_is_revoked",
    "revoke_refresh_token", "revoke_family",
    "get_refresh_token_family",
]
