# coding: utf-8
"""
Email + password credentials — Phase 3b (additive, self-contained).

Design constraints (production-safe, Railway-safe):
  - NO new pip dependency. Password hashing uses stdlib PBKDF2-HMAC-SHA256
    (hashlib). The stored hash is passlib-compatible
    (`pbkdf2_sha256$<iters>$<salt_hex>$<hash_hex>`) so a future swap to
    bcrypt/passlib is a one-module change with no format migration.
  - NEW table only (`auth_password_users`) in the SAME auth.db used by
    backend.services.auth.storage. `CREATE TABLE IF NOT EXISTS` — it does
    NOT touch `auth_users` / `auth_refresh_tokens`, so existing guest /
    v2-auth behaviour is byte-for-byte unchanged and rollback is "delete
    the file / drop this one table".
  - No env var added. Reuses AUTH_DB_PATH (optional; defaults to
    settings.AUTH_DB_PATH). JWT is issued/verified by the existing
    backend.services.auth.tokens (reuses JWT_SECRET_KEY).

Public API (all sync, fresh connection per call — mirrors storage.py):
  init()                                  idempotent table create
  create_user(email, password, display_name="") -> dict   (raises
                                          EmailExistsError on duplicate)
  verify_credentials(email, password)     -> dict | None
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

# PBKDF2 cost. 200k SHA256 iterations ≈ a few ms on Railway — safe.
_PBKDF2_ITERATIONS = 200_000
_SALT_BYTES = 16


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


# ── Hashing (stdlib PBKDF2-HMAC-SHA256, passlib-compatible string) ────────

def hash_password(password: str) -> str:
    salt = secrets.token_bytes(_SALT_BYTES)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${_PBKDF2_ITERATIONS}${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
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


def verify_credentials(email: str, password: str) -> Optional[dict]:
    """Return the public user dict on a correct email+password, else None.
    Constant-ish: always runs a hash compare to reduce user enumeration
    via timing."""
    init()
    e = normalize_email(email)
    with _conn() as c:
        cur = c.execute("SELECT * FROM auth_password_users WHERE email = ?", (e,))
        row = cur.fetchone()
    if row is None:
        # Spend ~equivalent time so a missing email isn't obviously faster.
        verify_password(password or "", "pbkdf2_sha256$1$00$00")
        return None
    if not verify_password(password or "", row["password_hash"]):
        return None
    return _row_to_public(row)


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
    "hash_password", "verify_password",
    "init", "create_user", "verify_credentials", "get_by_id", "touch_login",
]
