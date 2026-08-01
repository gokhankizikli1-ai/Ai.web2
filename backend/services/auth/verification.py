# coding: utf-8
"""
Email-verification identity state + single-use token store (auth.db).

WHY
---
A password account is created UNVERIFIED. Before the app grants starter credits
or lets the account run paid AI/build operations, the user must prove they
control the email by clicking a single-use link. Google OAuth accounts are
provider-verified (Google asserts email_verified server-side) and are marked
verified at login. Guests are never verified and never granted.

STORAGE (two NEW tables in the existing auth.db — additive, CREATE IF NOT
EXISTS, no ALTER, matching services/auth/{passwords,storage}.py conventions):

  auth_email_verifications        one row per account. verified_at NULL until
                                  the email is confirmed. `version` bumps on
                                  each (re)verification for future auditing.
  auth_email_verification_tokens  one row per issued link. Only a SHA-256 HASH
                                  of the token is stored (never the token).
                                  Single-use via an atomic consumed_at update;
                                  short TTL; UNIQUE(token_hash) for idempotency.

SECURITY
--------
  * Cryptographically-random token (secrets.token_urlsafe); only its hash is
    persisted; the raw value exists just long enough to build the email link.
  * Consumption is atomic: `UPDATE … WHERE consumed_at IS NULL AND expires_at>now`
    — concurrent confirmations resolve to exactly one winner, so a token can
    never be spent twice and credits are granted at most once.
  * The starter grant is idempotent at the ledger layer (UNIQUE(reference)
    `starter_grant:<uid>`), so a retry after a transient grant failure is safe.
  * No token, URL, password, access token, or full email is logged here.

The starter grant fires from `mark_verified()` on the unverified→verified
transition. If that best-effort grant hiccups, verification still succeeds and
`reconcile_grant()` provides an idempotent retry path (called by the status
endpoint).
"""
from __future__ import annotations

import contextlib
import hashlib
import logging
import os
import secrets
import sqlite3
import threading
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Iterator, Optional

from backend.core.config import settings

logger = logging.getLogger(__name__)

_LOCK = threading.Lock()
_INITIALIZED = False

_DDL = """
CREATE TABLE IF NOT EXISTS auth_email_verifications (
    user_id      TEXT PRIMARY KEY,
    email        TEXT NOT NULL,
    verified_at  TEXT,
    version      INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_email_verification_tokens (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL,
    token_hash      TEXT NOT NULL UNIQUE,
    email           TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    expires_at      TEXT NOT NULL,
    consumed_at     TEXT,
    request_ip_hash TEXT
);
CREATE INDEX IF NOT EXISTS ix_evt_user       ON auth_email_verification_tokens(user_id);
CREATE INDEX IF NOT EXISTS ix_evt_expires    ON auth_email_verification_tokens(expires_at);
CREATE INDEX IF NOT EXISTS ix_evt_user_created ON auth_email_verification_tokens(user_id, created_at);
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
    global _INITIALIZED
    if _INITIALIZED:
        return
    with _LOCK:
        if _INITIALIZED:
            return
        with _conn() as c:
            c.executescript(_DDL)
        _INITIALIZED = True
        logger.info("auth.verification initialized | db=%s", _db_path())


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


def _hash_token(raw: str) -> str:
    return hashlib.sha256((raw or "").encode("utf-8")).hexdigest()


def _hash_ip(ip: Optional[str]) -> Optional[str]:
    """Privacy-safe, non-reversible IP fingerprint for abuse metrics. Keyed on
    the app secret so it cannot be reversed by rainbow table. Never the raw IP."""
    ip = (ip or "").strip()
    if not ip:
        return None
    salt = (settings.JWT_SECRET_KEY or "korvix-evt-salt").encode("utf-8")
    return hashlib.sha256(salt + ip.encode("utf-8")).hexdigest()[:16]


# ── Verification state ────────────────────────────────────────────────────────

def is_verified(user_id: str) -> bool:
    uid = (user_id or "").strip()
    if not uid:
        return False
    init()
    with _conn() as c:
        row = c.execute(
            "SELECT verified_at FROM auth_email_verifications WHERE user_id = ?", (uid,)
        ).fetchone()
    return bool(row and row["verified_at"])


def record_pending(user_id: str, email: str) -> None:
    """Ensure an (unverified) verification row exists for a new account. No-op if
    a row already exists (never downgrades a verified row)."""
    uid = (user_id or "").strip()
    if not uid:
        return
    init()
    now = _now_iso()
    with _conn() as c:
        c.execute(
            "INSERT OR IGNORE INTO auth_email_verifications "
            "(user_id, email, verified_at, version, created_at, updated_at) "
            "VALUES (?, ?, NULL, 0, ?, ?)",
            (uid, (email or "").strip().lower(), now, now),
        )


def mark_verified(user_id: str, email: str = "", *, source: str = "confirm") -> bool:
    """Mark the account verified (idempotent). Returns True only on the
    unverified→verified TRANSITION (so callers can react exactly once).

    On the transition the one-time starter grant is fired (best-effort,
    idempotent). `source` is a short non-secret tag for the log line only."""
    uid = (user_id or "").strip()
    if not uid:
        return False
    init()
    now = _now_iso()
    em = (email or "").strip().lower()
    transitioned = False
    with _conn() as c:
        row = c.execute(
            "SELECT verified_at FROM auth_email_verifications WHERE user_id = ?", (uid,)
        ).fetchone()
        if row is None:
            c.execute(
                "INSERT INTO auth_email_verifications "
                "(user_id, email, verified_at, version, created_at, updated_at) "
                "VALUES (?, ?, ?, 1, ?, ?)",
                (uid, em, now, now, now),
            )
            transitioned = True
        elif row["verified_at"] is None:
            cur = c.execute(
                "UPDATE auth_email_verifications "
                "SET verified_at = ?, version = version + 1, updated_at = ?, "
                "    email = CASE WHEN ? != '' THEN ? ELSE email END "
                "WHERE user_id = ? AND verified_at IS NULL",
                (now, now, em, em, uid),
            )
            transitioned = cur.rowcount == 1
        # else: already verified → no transition.
    if transitioned:
        logger.info("auth.verification verified | user=%s | source=%s", uid, source)
    _grant_starter(uid)
    return transitioned


def _grant_starter(user_id: str) -> None:
    """Best-effort, idempotent starter grant. Never raises into the caller."""
    try:
        from backend.services.credits_gateway import ensure_starter_grant
        ensure_starter_grant(user_id)
    except Exception:  # pragma: no cover — verification must not fail on credits
        logger.warning("auth.verification: starter grant deferred (non-fatal)")


def reconcile_grant(user_id: str) -> None:
    """Idempotent retry path: if the account is verified, (re)attempt the starter
    grant. Safe to call repeatedly — the ledger dedupes on the stable reference.
    Used by the status endpoint so a transient grant failure self-heals."""
    if is_verified(user_id):
        _grant_starter(user_id)


def get_status(user_id: str) -> dict:
    """Non-secret verification snapshot for the account UI."""
    uid = (user_id or "").strip()
    if not uid:
        return {"verified": False, "verified_at": None, "email": None, "version": 0}
    init()
    with _conn() as c:
        row = c.execute(
            "SELECT email, verified_at, version FROM auth_email_verifications WHERE user_id = ?",
            (uid,),
        ).fetchone()
    if row is None:
        return {"verified": False, "verified_at": None, "email": None, "version": 0}
    return {
        "verified": bool(row["verified_at"]),
        "verified_at": row["verified_at"],
        "email": row["email"],
        "version": int(row["version"] or 0),
    }


# ── Token lifecycle ───────────────────────────────────────────────────────────

@dataclass(frozen=True)
class ConsumeResult:
    status: str            # "verified" | "already_verified" | "already_used" | "expired" | "invalid"
    user_id: str = ""
    email: str = ""

    @property
    def ok(self) -> bool:
        return self.status in ("verified", "already_verified")


def _ttl_minutes() -> int:
    return max(1, int(getattr(settings, "EMAIL_VERIFICATION_TOKEN_TTL_MIN", 30) or 30))


def issue_token(user_id: str, email: str, *, request_ip: Optional[str] = None) -> str:
    """Create a single-use verification token and return the RAW value (the only
    time it exists in plaintext — the caller embeds it in the email link and
    discards it). Only the hash is persisted."""
    uid = (user_id or "").strip()
    if not uid:
        raise ValueError("user_id required")
    init()
    raw = secrets.token_urlsafe(32)  # 256 bits of entropy
    now = _now()
    expires = now + timedelta(minutes=_ttl_minutes())
    with _conn() as c:
        c.execute(
            "INSERT INTO auth_email_verification_tokens "
            "(id, user_id, token_hash, email, created_at, expires_at, consumed_at, request_ip_hash) "
            "VALUES (?, ?, ?, ?, ?, ?, NULL, ?)",
            (
                uuid.uuid4().hex, uid, _hash_token(raw), (email or "").strip().lower(),
                now.isoformat(), expires.isoformat(), _hash_ip(request_ip),
            ),
        )
    return raw


def consume_token(raw_token: str) -> ConsumeResult:
    """Atomically spend a verification token and mark the account verified.

    Single-use + expiry are enforced in one UPDATE so concurrent confirmations
    resolve to exactly one winner. On success the account is marked verified and
    the starter grant fires (idempotent)."""
    raw = (raw_token or "").strip()
    if not raw:
        return ConsumeResult(status="invalid")
    init()
    token_hash = _hash_token(raw)
    now_iso = _now_iso()
    with _conn() as c:
        cur = c.execute(
            "UPDATE auth_email_verification_tokens SET consumed_at = ? "
            "WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?",
            (now_iso, token_hash, now_iso),
        )
        claimed = cur.rowcount == 1
        row = c.execute(
            "SELECT user_id, email, consumed_at, expires_at FROM auth_email_verification_tokens "
            "WHERE token_hash = ?",
            (token_hash,),
        ).fetchone()

    if not claimed:
        if row is None:
            return ConsumeResult(status="invalid")
        # Row exists but we didn't claim it: either already consumed by us just
        # now (row shows a consumed_at we didn't set this call) or expired.
        if row["consumed_at"] is not None and row["consumed_at"] != now_iso:
            return ConsumeResult(status="already_used", user_id=row["user_id"], email=row["email"])
        if row["expires_at"] <= now_iso:
            return ConsumeResult(status="expired", user_id=row["user_id"], email=row["email"])
        return ConsumeResult(status="already_used", user_id=row["user_id"], email=row["email"])

    user_id = row["user_id"]
    email = row["email"]
    transitioned = mark_verified(user_id, email, source="confirm")
    return ConsumeResult(
        status="verified" if transitioned else "already_verified",
        user_id=user_id, email=email,
    )


# ── Resend cooldown / rate limiting ───────────────────────────────────────────

def _cooldown_sec() -> int:
    return max(0, int(getattr(settings, "EMAIL_VERIFICATION_RESEND_COOLDOWN_SEC", 60) or 0))


def _max_per_hour() -> int:
    return max(1, int(getattr(settings, "EMAIL_VERIFICATION_MAX_SENDS_PER_HOUR", 5) or 5))


def send_cooldown_remaining(user_id: str) -> int:
    """Seconds the user must wait before another send is allowed (0 = allowed
    now). Enforced from the persisted token timestamps (durable across
    redeploys), so a fast resend loop cannot mint unlimited emails."""
    uid = (user_id or "").strip()
    if not uid:
        return 0
    init()
    now = _now()
    with _conn() as c:
        last = c.execute(
            "SELECT created_at FROM auth_email_verification_tokens "
            "WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
            (uid,),
        ).fetchone()
        hour_ago = (now - timedelta(hours=1)).isoformat()
        recent = c.execute(
            "SELECT COUNT(*) AS n FROM auth_email_verification_tokens "
            "WHERE user_id = ? AND created_at > ?",
            (uid, hour_ago),
        ).fetchone()
    # Hourly cap → report a full-window wait.
    if recent and int(recent["n"]) >= _max_per_hour():
        return 3600
    if last:
        try:
            last_dt = datetime.fromisoformat(last["created_at"])
        except Exception:
            return 0
        elapsed = (now - last_dt).total_seconds()
        remaining = _cooldown_sec() - int(elapsed)
        return max(0, remaining)
    return 0


__all__ = [
    "init",
    "is_verified", "record_pending", "mark_verified", "reconcile_grant", "get_status",
    "issue_token", "consume_token", "ConsumeResult",
    "send_cooldown_remaining",
]
