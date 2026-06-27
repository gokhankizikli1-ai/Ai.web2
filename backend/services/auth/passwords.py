# coding: utf-8
"""
Email + password credentials — Phase 3b + Phase-1 PR #2 (Argon2id).

Design constraints (production-safe, Railway-safe):
  - Argon2id is now the default hash algorithm (Phase-1 PR #2 — locked
    decision #2). Argon2id is the only password hash recommended by
    RFC 9106 + OWASP 2024 against modern GPU attacks. The defaults
    from `argon2.PasswordHasher()` match RFC 9106's general-purpose
    profile (m=65536 KiB, t=3, p=4).
  - Legacy PBKDF2-HMAC-SHA256 hashes are STILL ACCEPTED on login so
    no existing user is forced to re-register. On successful login
    with a legacy hash, we silently re-hash with Argon2id and update
    the stored hash in-place — zero-downtime migration per locked
    decision #3 ("silent whenever possible"). The user never knows;
    the next login is already Argon2id-backed.
  - NEW table only (`auth_password_users`) in the SAME auth.db used
    by backend.services.auth.storage. `CREATE TABLE IF NOT EXISTS`
    — it does NOT touch `auth_users` / `auth_refresh_tokens`, so
    existing guest / v2-auth behaviour is byte-for-byte unchanged.
    Rollback for THIS PR is reverting the code; existing argon2id
    hashes stay valid as long as argon2-cffi is installed.
  - No env var added. Reuses AUTH_DB_PATH. JWT is issued/verified
    by backend.services.auth.tokens (reuses JWT_SECRET_KEY).

Hash format discrimination — the stored string is self-describing:
  $argon2id$v=19$m=65536,t=3,p=4$<salt>$<hash>   ← current
  pbkdf2_sha256$<iters>$<salt_hex>$<hash_hex>    ← legacy (still verified)

Public API (all sync, fresh connection per call — mirrors storage.py):
  init()                                  idempotent table create
  create_user(email, password, display_name="") -> dict   (raises
                                          EmailExistsError on duplicate)
  verify_credentials(email, password)     -> dict | None
                                          (silently lazy-migrates the
                                           stored hash to Argon2id on
                                           a successful PBKDF2 login)
  get_by_id(user_id)                      -> dict | None
  touch_login(user_id)                    -> None
"""
from __future__ import annotations

import contextlib
import hashlib
import hmac
import logging
import os
import re
import secrets
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from typing import Iterator, Optional

from backend.core.config import settings

logger = logging.getLogger(__name__)

# ── Validation ────────────────────────────────────────────────────────────
# Deliberately simple + permissive. We are NOT using pydantic.EmailStr
# because that needs the `email-validator` package which is not in
# requirements.txt (adding it would change the Railway build).
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
EMAIL_MAX = 254
PASSWORD_MIN = 8
PASSWORD_MAX = 128

# Legacy PBKDF2 parameters — kept for VERIFYING old hashes during the
# silent migration window. New hashes use Argon2id (see hash_password).
_PBKDF2_ITERATIONS = 200_000
_SALT_BYTES = 16

# Argon2id format marker. Stored strings starting with this prefix are
# verified by the Argon2id path; anything else falls through to the
# legacy PBKDF2 path.
_ARGON2_PREFIX = "$argon2"

# Constant string used to make the not-found-email path consume the
# SAME order of magnitude of CPU as a real Argon2id verify, so a
# missing email is not detectably faster than a wrong password
# (defeats user-enumeration via timing). Argon2id with default params
# is ~5–20ms on Railway-class hardware.
_TIMING_EQUALISER_PASSWORD = "korvix-timing-equalizer"


class PasswordAuthError(Exception):
    """Base for expected, user-facing credential failures."""
    code = "auth_error"


class EmailExistsError(PasswordAuthError):
    code = "email_exists"


class InvalidInputError(PasswordAuthError):
    code = "validation_error"


def normalize_email(raw: str) -> str:
    return (raw or "").strip().lower()


def validate_email(email: str) -> str:
    e = normalize_email(email)
    if not e or len(e) > EMAIL_MAX or not _EMAIL_RE.match(e):
        raise InvalidInputError("A valid email address is required.")
    return e


def validate_password(password: str) -> str:
    if not isinstance(password, str) or not (PASSWORD_MIN <= len(password) <= PASSWORD_MAX):
        raise InvalidInputError(
            f"Password must be between {PASSWORD_MIN} and {PASSWORD_MAX} characters."
        )
    return password


# ── Hashing (Argon2id new; PBKDF2-HMAC-SHA256 legacy for verify) ──────────

def _argon2_hasher():
    """Build a fresh PasswordHasher with library defaults.

    Lazy-imported so a missing argon2-cffi dep at module import time
    NEVER breaks `from backend.services.auth import passwords` — it
    only breaks the hash/verify path, which fails closed (login
    returns None, signup raises a clean error). Without this guard, a
    misconfigured Railway build would propagate ImportError to app
    startup and take the whole API down.
    """
    from argon2 import PasswordHasher
    return PasswordHasher()


def hash_password(password: str) -> str:
    """Hash a password using Argon2id (RFC 9106 general-purpose profile).

    Returns the self-describing argon2-cffi string
    `$argon2id$v=19$m=…,t=…,p=…$<salt>$<hash>` so callers don't have
    to know the parameters — `verify_password` re-derives them from
    the stored string.
    """
    return _argon2_hasher().hash(password)


def _verify_pbkdf2_legacy(password: str, stored: str) -> bool:
    """Verify against the legacy `pbkdf2_sha256$<iters>$<salt_hex>$<hash_hex>`
    format. Kept for users whose hashes pre-date the Argon2id migration
    — replaced silently on the next successful login. Pure stdlib so
    legacy verify keeps working even if argon2-cffi is somehow absent."""
    try:
        algo, iters_s, salt_hex, hash_hex = stored.split("$", 3)
        if algo != "pbkdf2_sha256":
            return False
        iters = int(iters_s)
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(hash_hex)
    except Exception:
        return False
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iters)
    return hmac.compare_digest(dk, expected)


def verify_password(password: str, stored: str) -> bool:
    """Verify against Argon2id or legacy PBKDF2-HMAC-SHA256.

    Discriminates by the stored string's prefix:
      $argon2…         → Argon2id (current)
      pbkdf2_sha256$…  → legacy PBKDF2 (still valid; lazy-migrated on
                         next successful login via verify_credentials)
      anything else    → False (bad data; never crash)
    """
    if not isinstance(stored, str) or not stored:
        return False
    if stored.startswith(_ARGON2_PREFIX):
        try:
            from argon2.exceptions import (
                VerifyMismatchError, VerificationError, InvalidHashError,
            )
        except ImportError:
            # argon2-cffi was uninstalled but old hashes still exist.
            # Fail closed; don't let an env regression silently accept
            # tokens it can't actually verify.
            logger.error("verify_password: argon2-cffi not importable but "
                         "stored hash is argon2id")
            return False
        try:
            return _argon2_hasher().verify(stored, password)
        except (VerifyMismatchError, VerificationError, InvalidHashError):
            return False
        except Exception as exc:                                # pragma: no cover
            # Defensive — verifier raised something unexpected. Treat
            # as bad credentials, not a 500.
            logger.warning("verify_password: argon2 verify raised %s", exc)
            return False
    # Anything that isn't argon2 → try legacy PBKDF2.
    return _verify_pbkdf2_legacy(password, stored)


def needs_rehash(stored: str) -> bool:
    """Return True when `stored` should be re-hashed with the current
    Argon2id parameters and persisted. Drives the silent migration
    inside `verify_credentials`.

    Triggers on:
      - Legacy PBKDF2 hash → unconditionally needs Argon2id rehash.
      - Argon2id hash with stale parameters (e.g. lower memory/time
        than the current `argon2-cffi` defaults after a library
        upgrade) → argon2-cffi's `check_needs_rehash` decides.

    Failure-tolerant: any exception means "don't rehash" (we never
    block a successful login on rehash inspection)."""
    if not isinstance(stored, str) or not stored:
        return False
    if not stored.startswith(_ARGON2_PREFIX):
        # Legacy → always rehash to Argon2id.
        return True
    try:
        return _argon2_hasher().check_needs_rehash(stored)
    except Exception:
        return False


# ── Storage (new table in the existing auth.db) ───────────────────────────

_LOCK = threading.Lock()
_INITIALIZED = False

_DDL = """
CREATE TABLE IF NOT EXISTS auth_password_users (
    id             TEXT PRIMARY KEY,
    email          TEXT NOT NULL UNIQUE,
    password_hash  TEXT NOT NULL,
    display_name   TEXT NOT NULL DEFAULT '',
    created_at     TEXT NOT NULL,
    last_login_at  TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_auth_password_users_email
    ON auth_password_users(email);
"""


def _db_path() -> str:
    return os.getenv("AUTH_DB_PATH", settings.AUTH_DB_PATH)


@contextlib.contextmanager
def _conn() -> Iterator[sqlite3.Connection]:
    c = sqlite3.connect(_db_path(), timeout=10)
    try:
        c.row_factory = sqlite3.Row
        yield c
        c.commit()
    finally:
        c.close()


def init() -> None:
    """Idempotent. Called lazily on first use so import-time isn't
    blocked on disk (matches backend.services.auth.storage)."""
    global _INITIALIZED
    if _INITIALIZED:
        return
    with _LOCK:
        if _INITIALIZED:
            return
        with _conn() as c:
            c.executescript(_DDL)
        _INITIALIZED = True
        logger.info("auth.passwords initialized | db=%s", _db_path())


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_public(row: sqlite3.Row) -> dict:
    return {
        "id":            row["id"],
        "email":         row["email"],
        "kind":          "email",
        "display_name":  row["display_name"] or "",
        "created_at":    row["created_at"],
        "last_login_at": row["last_login_at"],
    }


def create_user(email: str, password: str, display_name: str = "") -> dict:
    """Create an email/password user. Raises InvalidInputError on bad
    input, EmailExistsError if the (normalized) email already exists."""
    e = validate_email(email)
    validate_password(password)
    init()
    uid = uuid.uuid4().hex
    now = _now_iso()
    pw_hash = hash_password(password)
    with _conn() as c:
        try:
            c.execute(
                "INSERT INTO auth_password_users "
                "(id, email, password_hash, display_name, created_at, last_login_at) "
                "VALUES (?, ?, ?, ?, ?, NULL)",
                (uid, e, pw_hash, (display_name or "").strip(), now),
            )
        except sqlite3.IntegrityError:
            raise EmailExistsError("An account with this email already exists.")
        cur = c.execute("SELECT * FROM auth_password_users WHERE id = ?", (uid,))
        return _row_to_public(cur.fetchone())


def _update_password_hash(user_id: str, new_hash: str) -> None:
    """Persist a re-hashed credential. Used ONLY by the silent
    migration inside `verify_credentials` — never exposed in the
    public API to keep accidental hash overwrites impossible from
    other call sites."""
    init()
    with _conn() as c:
        c.execute(
            "UPDATE auth_password_users SET password_hash = ? WHERE id = ?",
            (new_hash, user_id),
        )


def verify_credentials(email: str, password: str) -> Optional[dict]:
    """Return the public user dict on a correct email+password, else None.

    Silent zero-downtime migration (Phase-1 PR #2):
      On a successful login against a LEGACY PBKDF2 hash, we re-hash
      the supplied password with Argon2id and update the stored hash
      in-place. The user observes nothing — their next login is
      already Argon2id-backed. Rehash failures NEVER fail the login.

    Timing equalisation:
      The not-found branch runs Argon2id of the same cost as the
      found branch (against a constant string + the supplied password)
      so an attacker cannot enumerate which emails exist by measuring
      response latency. Falls back to PBKDF2 of equivalent cost ONLY
      if argon2-cffi is somehow unavailable — keeps the timing
      defence working in a degraded env.
    """
    init()
    e = normalize_email(email)
    with _conn() as c:
        cur = c.execute("SELECT * FROM auth_password_users WHERE email = ?", (e,))
        row = cur.fetchone()
    if row is None:
        _equalise_login_timing(password or "")
        return None
    stored_hash = row["password_hash"]
    if not verify_password(password or "", stored_hash):
        return None
    # Lazy silent migration. Wrapped in try/except so a rehash failure
    # (argon2-cffi gone, DB write race, etc.) NEVER turns a successful
    # login into a failed one. Worst case: the next login retries.
    try:
        if needs_rehash(stored_hash):
            new_hash = hash_password(password or "")
            _update_password_hash(row["id"], new_hash)
            logger.info(
                "auth.passwords: silently re-hashed user=%s pbkdf2→argon2id",
                row["id"],
            )
    except Exception as exc:
        logger.warning(
            "auth.passwords: lazy rehash skipped user=%s err=%s",
            row["id"], exc,
        )
    return _row_to_public(row)


def _equalise_login_timing(password: str) -> None:
    """Consume CPU equivalent to one verify call so a missing email
    isn't detectably faster than a wrong password. Argon2id is the
    primary equaliser (matches the verify cost on migrated users);
    PBKDF2 is the fallback when argon2-cffi is unavailable (matches
    the verify cost on un-migrated users — also defensible)."""
    try:
        _argon2_hasher().hash(password + _TIMING_EQUALISER_PASSWORD)
        return
    except Exception:                                           # pragma: no cover
        pass
    # Defensive PBKDF2 fallback — preserves the equaliser even when
    # argon2-cffi import fails. Same iteration count as legacy hashes.
    hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"),
        b"korvix-timing-equalizer", _PBKDF2_ITERATIONS,
    )


def get_by_id(user_id: str) -> Optional[dict]:
    init()
    with _conn() as c:
        cur = c.execute("SELECT * FROM auth_password_users WHERE id = ?", (user_id,))
        row = cur.fetchone()
        return _row_to_public(row) if row else None


def touch_login(user_id: str) -> None:
    init()
    with _conn() as c:
        c.execute(
            "UPDATE auth_password_users SET last_login_at = ? WHERE id = ?",
            (_now_iso(), user_id),
        )


__all__ = [
    "PasswordAuthError", "EmailExistsError", "InvalidInputError",
    "normalize_email", "validate_email", "validate_password",
    "hash_password", "verify_password", "needs_rehash",
    "init", "create_user", "verify_credentials", "get_by_id", "touch_login",
]
