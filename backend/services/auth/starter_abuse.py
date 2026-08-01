# coding: utf-8
"""
Starter-credit abuse protection — a layered, privacy-conscious risk gate that
limits repeated FREE starter-credit grants without punishing legitimate shared
networks (households / offices / schools).

WHERE IT SITS
-------------
This module is consulted at the ONE authoritative grant boundary
(`credits_gateway.ensure_starter_grant`), BEFORE the ledger grant. The ledger's
UNIQUE(reference) `starter_grant:<uid>` remains the hard exactly-once guarantee;
this layer only decides whether the FIRST grant for a brand-new account should
happen at all. It never affects purchased/subscription credits.

SECURITY MODEL (layered signals, never one hard identifier)
-----------------------------------------------------------
  * install signal — a SERVER-ISSUED, signed, opaque installation id (cookie).
    Clients cannot forge a valid id (HMAC-signed); we store only a keyed HASH.
    "Same browser spawning many accounts" is the strongest, lowest-false-positive
    signal → it can DENY.
  * network signal — a keyed HASH of the IP's /24 (v4) or /64 (v6) PREFIX, never
    the raw IP. Shared networks legitimately produce several grants, so the
    network signal alone only DEFERS (soft), never hard-denies.
  * provider — password vs google; Google gets NO extra free-credit trust.

PRIVACY
-------
No raw IP, email, OAuth token, verification token, or device fingerprint is ever
stored or logged. Only keyed one-way hashes (IP-prefix, install id) and
non-secret reason categories. No canvas/audio/font fingerprinting.

MODES
-----
off      — dormant (feature master switch off).
shadow   — compute + count the decision, LOG a redacted category, but ALWAYS
           allow the grant. For safe pre-enforcement rollout.
enforce  — a deny/defer actually withholds the starter grant.
"""
from __future__ import annotations

import contextlib
import hashlib
import hmac
import ipaddress
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

# Outcomes.
ALLOW = "allow"
DENY = "deny"
DEFER = "defer"

# Non-secret reason categories (safe to surface; never reveal thresholds).
R_OK = "ok"
R_INSTALL_VELOCITY = "install_velocity"
R_NETWORK_VELOCITY = "network_velocity"
R_COMBINED_VELOCITY = "combined_velocity"
R_DISABLED = "disabled"


@dataclass(frozen=True)
class Decision:
    outcome: str            # ALLOW | DENY | DEFER
    reason: str             # non-secret category
    enforced: bool          # True only when mode==enforce AND outcome != ALLOW

    @property
    def grant_allowed(self) -> bool:
        """Whether the caller should proceed with the ledger grant."""
        return not (self.enforced and self.outcome in (DENY, DEFER))


# ── Config accessors (read dynamically so a Railway flip is live) ──────────────

def _enabled() -> bool:
    return bool(getattr(settings, "ENABLE_STARTER_CREDIT_ABUSE_PROTECTION", False))


def mode() -> str:
    if not _enabled():
        return "off"
    m = str(getattr(settings, "STARTER_CREDIT_ABUSE_MODE", "shadow") or "shadow").strip().lower()
    return m if m in ("off", "shadow", "enforce") else "shadow"


def _salt() -> bytes:
    s = (getattr(settings, "ABUSE_HASH_SALT", "") or "").strip() \
        or (getattr(settings, "JWT_SECRET_KEY", "") or "") \
        or "korvix-abuse-salt"
    return s.encode("utf-8")


def _keyed_hash(value: str) -> str:
    return hmac.new(_salt(), (value or "").encode("utf-8"), hashlib.sha256).hexdigest()[:32]


# ── Trusted-proxy client IP extraction ────────────────────────────────────────

def client_ip(request) -> Optional[str]:
    """Return the best-effort real client IP, respecting TRUSTED_PROXY_COUNT.

    Default (count=0): trust ONLY the socket peer (request.client.host) — a
    client-supplied X-Forwarded-For is ignored, so it cannot be spoofed to dodge
    or frame a network. With N trusted proxies, take the Nth-from-the-right XFF
    hop (the address the outermost trusted proxy saw), which a client cannot
    forge past. Never returns a client-chosen value when count=0."""
    peer = None
    try:
        peer = request.client.host if request.client else None
    except Exception:
        peer = None
    try:
        count = int(getattr(settings, "TRUSTED_PROXY_COUNT", 0) or 0)
    except Exception:
        count = 0
    if count <= 0:
        return peer
    try:
        xff = request.headers.get("x-forwarded-for") or ""
    except Exception:
        xff = ""
    hops = [h.strip() for h in xff.split(",") if h.strip()]
    if not hops:
        return peer
    # Our `count` trusted proxies each APPEND the address they saw, so the real
    # client is the first entry of that trusted block: index len - count. Anything
    # to its left is client-controlled (spoofable) and ignored. If the header has
    # fewer hops than trusted proxies, fall back to the socket peer (never a
    # client-chosen value).
    idx = len(hops) - count
    if idx < 0:
        return peer
    return hops[idx] or peer


def network_hash(ip: Optional[str]) -> Optional[str]:
    """Keyed hash of the IP's network PREFIX (/24 v4, /64 v6). Never the raw IP.
    Returns None when there is no usable IP (so IP-absence can't be a group)."""
    ip = (ip or "").strip()
    if not ip:
        return None
    try:
        addr = ipaddress.ip_address(ip)
    except Exception:
        return None
    try:
        if addr.version == 4:
            plen = int(getattr(settings, "STARTER_ABUSE_IPV4_PREFIX", 24) or 24)
            net = ipaddress.ip_network(f"{ip}/{plen}", strict=False)
        else:
            net = ipaddress.ip_network(f"{ip}/64", strict=False)
    except Exception:
        return None
    return _keyed_hash(f"net:{net.network_address}/{net.prefixlen}")


# ── Signed, opaque installation id (server-issued; client cannot forge) ────────

def _install_sig(rid: str) -> str:
    return hmac.new(_salt(), f"install:{rid}".encode("utf-8"), hashlib.sha256).hexdigest()[:24]


def issue_install_id() -> str:
    """Mint a fresh signed installation id: '<random>.<hmac>'. The signature binds
    it to our secret so a client can present only ids WE issued (it cannot pick an
    arbitrary identity). The raw value goes in an HttpOnly cookie; only its hash
    is ever stored."""
    rid = secrets.token_urlsafe(18)
    return f"{rid}.{_install_sig(rid)}"


def verify_install_id(raw: Optional[str]) -> Optional[str]:
    """Return the raw install id IF it carries a valid signature, else None
    (caller then issues a new one). Constant-time signature check."""
    raw = (raw or "").strip()
    if not raw or "." not in raw or len(raw) > 128:
        return None
    rid, _, sig = raw.rpartition(".")
    if not rid or not sig:
        return None
    if not hmac.compare_digest(sig, _install_sig(rid)):
        return None
    return raw


def install_hash(raw: Optional[str]) -> Optional[str]:
    valid = verify_install_id(raw)
    if not valid:
        return None
    return _keyed_hash(f"install:{valid}")


# ── Durable store (auth.db) ────────────────────────────────────────────────────

_LOCK = threading.Lock()
_INITIALIZED = False

_DDL = """
CREATE TABLE IF NOT EXISTS starter_grant_events (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    network_hash  TEXT,
    install_hash  TEXT,
    provider      TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_sge_network ON starter_grant_events(network_hash, created_at);
CREATE INDEX IF NOT EXISTS ix_sge_install ON starter_grant_events(install_hash);
CREATE UNIQUE INDEX IF NOT EXISTS ix_sge_user ON starter_grant_events(user_id);

CREATE TABLE IF NOT EXISTS starter_abuse_counters (
    key    TEXT PRIMARY KEY,
    count  INTEGER NOT NULL DEFAULT 0
);
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


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _bump_counter(key: str) -> None:
    try:
        with _conn() as c:
            c.execute(
                "INSERT INTO starter_abuse_counters (key, count) VALUES (?, 1) "
                "ON CONFLICT(key) DO UPDATE SET count = count + 1",
                (key,),
            )
    except Exception:  # pragma: no cover — metrics must never break the flow
        pass


# ── Risk evaluation ────────────────────────────────────────────────────────────

def _max_per_install() -> int:
    return max(1, int(getattr(settings, "STARTER_ABUSE_MAX_GRANTS_PER_INSTALL", 1) or 1))


def _max_per_network() -> int:
    return max(1, int(getattr(settings, "STARTER_ABUSE_MAX_GRANTS_PER_NETWORK_DAY", 8) or 8))


def _network_window() -> timedelta:
    return timedelta(hours=max(1, int(getattr(settings, "STARTER_ABUSE_NETWORK_WINDOW_HOURS", 24) or 24)))


def evaluate(user_id: str, *, provider: str, ip: Optional[str], install_id: Optional[str]) -> Decision:
    """Decide whether a brand-new account should receive its starter grant.

    Layered: the install signal (server-issued, low false-positive) can DENY; the
    network signal alone only DEFERS (shared networks are legitimate). The caller
    only reaches here for the FIRST grant (ledger idempotency handles repeats),
    and owners / paid users are exempted BEFORE this is called."""
    m = mode()
    if m == "off":
        return Decision(ALLOW, R_DISABLED, enforced=False)
    init()

    net_h = network_hash(ip)
    inst_h = install_hash(install_id)

    install_grants = 0
    network_grants = 0
    try:
        with _conn() as c:
            if inst_h:
                row = c.execute(
                    "SELECT COUNT(*) AS n FROM starter_grant_events WHERE install_hash = ?",
                    (inst_h,),
                ).fetchone()
                install_grants = int(row["n"]) if row else 0
            if net_h:
                cutoff = (_now() - _network_window()).isoformat()
                row = c.execute(
                    "SELECT COUNT(*) AS n FROM starter_grant_events "
                    "WHERE network_hash = ? AND created_at > ?",
                    (net_h, cutoff),
                ).fetchone()
                network_grants = int(row["n"]) if row else 0
    except Exception:  # pragma: no cover — on read failure, do NOT deny (fail open for a promo)
        return Decision(ALLOW, R_OK, enforced=False)

    install_hit = inst_h is not None and install_grants >= _max_per_install()
    network_hit = net_h is not None and network_grants >= _max_per_network()

    if install_hit and network_hit:
        outcome, reason = DENY, R_COMBINED_VELOCITY
    elif install_hit:
        # Same browser already seeded an account → strong farm signal → deny.
        outcome, reason = DENY, R_INSTALL_VELOCITY
    elif network_hit:
        # Only the shared network is hot (distinct browsers) → soft defer, no
        # hard "abuser" label; legitimate offices/schools land here.
        outcome, reason = DEFER, R_NETWORK_VELOCITY
    else:
        outcome, reason = ALLOW, R_OK

    enforced = (m == "enforce") and outcome != ALLOW
    _bump_counter(f"{m}:{outcome}:{reason}")
    # Redacted structured log — categories only, never IP/email/token/id.
    logger.info(
        "starter_abuse decision | mode=%s outcome=%s reason=%s provider=%s enforced=%s",
        m, outcome, reason, (provider or "unknown"), enforced,
    )
    return Decision(outcome, reason, enforced=enforced)


def record_grant(user_id: str, *, provider: str, ip: Optional[str], install_id: Optional[str]) -> None:
    """Record that `user_id` received a starter grant, for future velocity. Keyed
    hashes only — never raw IP/id. Idempotent per user (UNIQUE(user_id))."""
    uid = (user_id or "").strip()
    if not uid:
        return
    init()
    try:
        with _conn() as c:
            c.execute(
                "INSERT OR IGNORE INTO starter_grant_events "
                "(id, user_id, network_hash, install_hash, provider, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (uuid.uuid4().hex, uid, network_hash(ip), install_hash(install_id),
                 (provider or "").strip().lower(), _now().isoformat()),
            )
    except Exception:  # pragma: no cover — recording must never break the grant
        logger.warning("starter_abuse: record_grant failed (non-fatal)")


def was_denied(user_id: str) -> bool:
    """True when the account has NO recorded starter grant AND the abuse layer is
    actively enforcing — a best-effort signal for the neutral UI message. Cheap;
    never raises."""
    uid = (user_id or "").strip()
    if not uid or mode() != "enforce":
        return False
    try:
        init()
        with _conn() as c:
            row = c.execute(
                "SELECT 1 FROM starter_grant_events WHERE user_id = ? LIMIT 1", (uid,)
            ).fetchone()
        return row is None
    except Exception:
        return False


def counters() -> dict:
    """Redacted metric counters {key: count} for the owner diagnostics."""
    try:
        init()
        with _conn() as c:
            rows = c.execute("SELECT key, count FROM starter_abuse_counters ORDER BY key").fetchall()
        return {r["key"]: int(r["count"]) for r in rows}
    except Exception:  # pragma: no cover
        return {}


def readiness() -> dict:
    """Redacted owner diagnostics — mode, thresholds, trusted-proxy assumption, and
    allow/defer/deny counters by reason category. NEVER any IP, email, id, or
    secret. Thresholds are operational config (not exploitable secrets)."""
    total = 0
    try:
        init()
        with _conn() as c:
            row = c.execute("SELECT COUNT(*) AS n FROM starter_grant_events").fetchone()
            total = int(row["n"]) if row else 0
    except Exception:  # pragma: no cover
        total = 0
    return {
        "enabled": _enabled(),
        "mode": mode(),
        "trustedProxyCount": int(getattr(settings, "TRUSTED_PROXY_COUNT", 0) or 0),
        "thresholds": {
            "maxGrantsPerInstall": _max_per_install(),
            "maxGrantsPerNetworkDay": _max_per_network(),
            "networkWindowHours": int(getattr(settings, "STARTER_ABUSE_NETWORK_WINDOW_HOURS", 24) or 24),
            "ipv4Prefix": int(getattr(settings, "STARTER_ABUSE_IPV4_PREFIX", 24) or 24),
        },
        "recordedGrants": total,
        "counters": counters(),
    }


def _reset_for_tests() -> None:  # pragma: no cover — test hook
    global _INITIALIZED
    _INITIALIZED = False


__all__ = [
    "Decision", "ALLOW", "DENY", "DEFER", "mode", "evaluate", "record_grant",
    "was_denied", "counters", "client_ip", "network_hash",
    "issue_install_id", "verify_install_id", "install_hash", "init",
]
