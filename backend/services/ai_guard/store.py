# coding: utf-8
"""
Phase 14L.1 — Founder-Beta AI protection: durable SQLite store (ai_guard.db).

Same per-subsystem WAL SQLite pattern as backend/services/tool_executions/store.py.
This is the AUTHORITATIVE, cross-process (single-node) source of truth for:
  • operation records (also the concurrency lock + reservation ledger),
  • per-user per-UTC-day operation counters,
  • the global daily spend ledger (reserved + actual),
  • owner-writable runtime overrides,
  • a short-window rate-limit event log.

Atomicity: the reservation path runs inside a single `BEGIN IMMEDIATE`
transaction, so SQLite's writer lock serializes the check+reserve — two
simultaneous "1 remaining" requests can never both pass. On a single Railway
instance this is globally safe; horizontal scaling would move these counters
to Redis (documented limitation, not silently assumed).

Every function is defensive and self-initializing; the caller decides fail-open
vs fail-closed (see service.py). Time is UTC epoch seconds for TTL math and UTC
'YYYY-MM-DD' for the daily window.
"""
from __future__ import annotations

import logging
import os
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from typing import Dict, Iterator, List, Optional

from backend.core.paths import resolve_db_path
from backend.services.ai_guard import policy as P

logger = logging.getLogger(__name__)

# The Web Build family shares ONE per-user concurrency lock: a build's planning,
# planning-repairs, visual step, code-gen and code-repairs are all sub-calls of the
# SAME operation. Image generation is a separate operation and never attaches here.
FAMILY_TYPES = (P.OP_WEB_BUILD_FULL, P.OP_WEB_BUILD_MAJOR_REDESIGN, P.OP_WEB_BUILD_SMALL_EDIT)

_LOCK = threading.Lock()
_INITIALIZED = False

# Non-empty when a CONFIGURED persistent path could not be prepared/opened. While
# set, protected AI operations fail closed (the store raises) rather than silently
# writing quota state to an ephemeral fresh DB that vanishes on the next redeploy.
_STORAGE_ERROR: Optional[str] = None

_AI_GUARD_DB_ENV = "AI_GUARD_DB_PATH"
_SCHEMA_VERSION = "1"


def _db_path() -> str:
    """The one authoritative on-disk path for ai_guard.db, used by EVERY guard
    connection. Deterministic precedence (via resolve_db_path):
        1. AI_GUARD_DB_PATH — a full absolute file path (e.g. /data/ai_guard.db)
        2. <KORVIX_DATA_DIR | RAILWAY_VOLUME_MOUNT_PATH>/ai_guard.db
        3. the bare relative dev fallback 'ai_guard.db'
    """
    return resolve_db_path("ai_guard.db", _AI_GUARD_DB_ENV)


def _persistent_configured() -> bool:
    """True when a DURABLE location is configured (absolute AI_GUARD_DB_PATH, or a
    KORVIX_DATA_DIR / Railway volume) — i.e. NOT the ephemeral dev fallback. When
    True, a storage failure must fail closed instead of using ephemeral storage."""
    explicit = (os.getenv(_AI_GUARD_DB_ENV) or "").strip()
    if explicit:
        return os.path.isabs(explicit)
    try:
        from backend.core.paths import data_dir
        return bool(data_dir())
    except Exception:
        return False


def _ensure_parent(path: str) -> bool:
    """Create the DB file's parent directory (mkdir -p). Returns True when it
    exists afterwards. resolve_db_path does NOT create the parent for an explicit
    absolute AI_GUARD_DB_PATH, so we do it here — /data/ai_guard.db needs /data."""
    parent = os.path.dirname(os.path.abspath(path)) or "."
    try:
        os.makedirs(parent, exist_ok=True)
    except OSError as exc:
        logger.error("ai_guard: cannot create DB parent dir %r: %s", parent, exc)
        return False
    return os.path.isdir(parent)

# Non-terminal statuses hold the per-user concurrency lock while unexpired.
STATUS_RUNNING = "running"
STATUS_SUCCEEDED = "succeeded"
STATUS_FAILED = "failed"
STATUS_FAILED_AMBIGUOUS = "failed_ambiguous"
STATUS_CANCELLED = "cancelled"
STATUS_EXPIRED = "expired"
_ACTIVE = (STATUS_RUNNING,)
_TERMINAL = {STATUS_SUCCEEDED, STATUS_FAILED, STATUS_FAILED_AMBIGUOUS, STATUS_CANCELLED, STATUS_EXPIRED}


@contextmanager
def _conn() -> Iterator[sqlite3.Connection]:
    # isolation_level=None → autocommit; we drive transactions with explicit
    # BEGIN IMMEDIATE / COMMIT / ROLLBACK so the check+reserve is atomic. Without
    # this, Python's implicit transaction manager would reject the explicit BEGIN.
    c = sqlite3.connect(_db_path(), timeout=15, isolation_level=None)
    try:
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA journal_mode = WAL")
        c.execute("PRAGMA busy_timeout = 15000")
        yield c
    finally:
        c.close()


_SCHEMA = """
CREATE TABLE IF NOT EXISTS ai_operations (
    operation_id        TEXT PRIMARY KEY,
    user_id             TEXT NOT NULL,
    operation_type      TEXT NOT NULL,
    status              TEXT NOT NULL,
    quota_window        TEXT NOT NULL,
    idempotency_key     TEXT,
    request_fingerprint TEXT,
    reserved_cost       REAL NOT NULL DEFAULT 0,
    actual_cost         REAL NOT NULL DEFAULT 0,
    reservation_open    INTEGER NOT NULL DEFAULT 1,
    attempt_count       INTEGER NOT NULL DEFAULT 1,
    provider            TEXT,
    model               TEXT,
    lock_token          TEXT,
    error_code          TEXT,
    created_at          REAL NOT NULL,
    updated_at          REAL NOT NULL,
    expires_at          REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_ai_ops_user_status ON ai_operations(user_id, status);
CREATE INDEX IF NOT EXISTS ix_ai_ops_idem ON ai_operations(user_id, idempotency_key);
CREATE INDEX IF NOT EXISTS ix_ai_ops_window ON ai_operations(quota_window);

CREATE TABLE IF NOT EXISTS ai_op_usage (
    user_id         TEXT NOT NULL,
    quota_window    TEXT NOT NULL,
    operation_type  TEXT NOT NULL,
    count           INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, quota_window, operation_type)
);

CREATE TABLE IF NOT EXISTS ai_global_spend (
    quota_window    TEXT PRIMARY KEY,
    reserved_usd    REAL NOT NULL DEFAULT 0,
    actual_usd      REAL NOT NULL DEFAULT 0,
    updated_at      REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_guard_overrides (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_by  TEXT,
    updated_at  REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_rate_events (
    user_id         TEXT NOT NULL,
    operation_type  TEXT NOT NULL,
    ts              REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_ai_rate ON ai_rate_events(user_id, ts);

CREATE TABLE IF NOT EXISTS ai_guard_meta (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  REAL NOT NULL
);
"""


def init() -> None:
    global _INITIALIZED, _STORAGE_ERROR
    if _INITIALIZED:
        return
    with _LOCK:
        if _INITIALIZED:
            return
        path = _db_path()
        durable = _persistent_configured()
        # Prepare the parent BEFORE connecting. resolve_db_path returns an explicit
        # AI_GUARD_DB_PATH verbatim without creating its parent, so /data must exist.
        if not _ensure_parent(path):
            _STORAGE_ERROR = f"parent directory for {path!r} could not be created"
            if durable:
                # A configured durable path is unusable → FAIL CLOSED. Never open a
                # fresh ephemeral DB that would silently reset quota on redeploy.
                raise RuntimeError(_STORAGE_ERROR)
        try:
            with _conn() as c:
                c.executescript(_SCHEMA)
                c.execute(
                    "INSERT INTO ai_guard_meta (key,value,updated_at) VALUES ('schema_version',?,?) "
                    "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
                    (_SCHEMA_VERSION, time.time()),
                )
        except Exception as exc:
            _STORAGE_ERROR = f"schema init failed for {path!r}: {exc}"
            if durable:
                # Configured durable DB could not be opened/initialized → fail closed.
                raise
            logger.warning("ai_guard: schema init failed on dev fallback path: %s", exc)
            return
        _STORAGE_ERROR = None
        _INITIALIZED = True
        logger.info(
            "ai_guard: storage ready | path=%s | durable=%s", os.path.abspath(path), durable,
        )


def _now() -> float:
    return time.time()


def _expire_stale_user_ops(c: sqlite3.Connection, user_id: str, now: float) -> None:
    """Release locks + reservations for THIS user's operations whose TTL has
    passed (crash recovery). Runs inside the caller's transaction."""
    rows = c.execute(
        "SELECT operation_id, reserved_cost, actual_cost, reservation_open, quota_window "
        "FROM ai_operations WHERE user_id=? AND status IN (%s) AND expires_at<=?"
        % ",".join("?" * len(_ACTIVE)),
        (user_id, *_ACTIVE, now),
    ).fetchall()
    for r in rows:
        if r["reservation_open"]:
            _release_reservation(c, r["quota_window"], float(r["reserved_cost"] or 0), float(r["actual_cost"] or 0), now)
        c.execute(
            "UPDATE ai_operations SET status=?, reservation_open=0, updated_at=? WHERE operation_id=?",
            (STATUS_EXPIRED, now, r["operation_id"]),
        )


def _active_family_op(c: sqlite3.Connection, user_id: str, now: float) -> Optional[sqlite3.Row]:
    """The user's currently-running Web Build operation (the held lock), if any."""
    return c.execute(
        "SELECT * FROM ai_operations WHERE user_id=? AND status=? AND expires_at>? "
        "AND operation_type IN (%s) ORDER BY created_at DESC LIMIT 1"
        % ",".join("?" * len(FAMILY_TYPES)),
        (user_id, STATUS_RUNNING, now, *FAMILY_TYPES),
    ).fetchone()


def _global_row(c: sqlite3.Connection, window: str) -> sqlite3.Row:
    c.execute(
        "INSERT INTO ai_global_spend (quota_window, reserved_usd, actual_usd, updated_at) "
        "VALUES (?,0,0,?) ON CONFLICT(quota_window) DO NOTHING",
        (window, _now()),
    )
    return c.execute("SELECT * FROM ai_global_spend WHERE quota_window=?", (window,)).fetchone()


def _release_reservation(c: sqlite3.Connection, window: str, reserved: float, actual: float, now: float) -> None:
    """Give back the outstanding reservation (reserved − already-committed actual,
    floored at 0). Never drives the ledger negative."""
    give_back = max(0.0, float(reserved) - float(actual))
    if give_back <= 0:
        return
    c.execute(
        "UPDATE ai_global_spend SET reserved_usd=MAX(0, reserved_usd-?), updated_at=? WHERE quota_window=?",
        (give_back, now, window),
    )


# ── Reservation (atomic check + reserve) ──────────────────────────────────────
class ReserveOutcome:
    __slots__ = ("code", "operation_id", "reservation_id", "replay", "detail", "used", "reset_ready")

    def __init__(self, code: str, operation_id: Optional[str] = None, reservation_id: Optional[str] = None,
                 replay: bool = False, detail: str = "", used: int = 0) -> None:
        self.code = code
        self.operation_id = operation_id
        self.reservation_id = reservation_id
        self.replay = replay
        self.detail = detail
        self.used = used


def daily_count(user_id: str, window: str, operation_type: str) -> int:
    init()
    with _conn() as c:
        row = c.execute(
            "SELECT count FROM ai_op_usage WHERE user_id=? AND quota_window=? AND operation_type=?",
            (user_id, window, operation_type),
        ).fetchone()
        return int(row["count"]) if row else 0


def try_attach_continuation(*, user_id: str, idempotency_key: Optional[str],
                            fingerprint: Optional[str], lock_ttl: int) -> tuple:
    """Atomically decide whether an incoming Web Build sub-call is a CONTINUATION of
    the user's active build. A continuation must carry the SAME client operation key
    as the active operation — so a genuine next sub-call (planning-repair, visual,
    code-gen, code-repair) attaches, while a DIFFERENT build (different key) falls to
    the START path and is blocked by the concurrency lock. Returns one of:
        ("none", None)          — no matching active build → caller runs the START path
        ("duplicate", op_id)    — same key + same fingerprint as the active op's START
                                   (double-submit / retry) → caller returns
                                   operation_in_progress, no second model call
        ("attached", op_id)     — same key, new sub-call → refresh the lock, no charge
    """
    init()
    now = _now()
    with _conn() as c:
        c.execute("BEGIN IMMEDIATE")
        try:
            _expire_stale_user_ops(c, user_id, now)
            active = _active_family_op(c, user_id, now)
            if active is None:
                c.execute("COMMIT")
                return ("none", None)
            # A different client operation key means a DIFFERENT build: not a
            # continuation. Fall to START, where the concurrency lock blocks it.
            if (active["idempotency_key"] or "") != (idempotency_key or ""):
                c.execute("COMMIT")
                return ("none", None)
            if fingerprint and (active["request_fingerprint"] or "") == fingerprint:
                c.execute("COMMIT")
                return ("duplicate", active["operation_id"])
            c.execute(
                "UPDATE ai_operations SET expires_at=?, updated_at=?, attempt_count=attempt_count+1 "
                "WHERE operation_id=?",
                (now + lock_ttl, now, active["operation_id"]),
            )
            c.execute("COMMIT")
            return ("attached", active["operation_id"])
        except Exception:
            try:
                c.execute("ROLLBACK")
            except Exception:
                pass
            return ("none", None)


def reserve_start(
    *, user_id: str, operation_type: str, window: str, daily_limit: int, max_concurrent: int,
    estimate_usd: float, spend_enabled: bool, spend_limit: float, lock_ttl: int,
    idempotency_key: Optional[str], fingerprint: Optional[str], idem_ttl: int,
) -> ReserveOutcome:
    """Atomically start a NEW protected operation: recover stale locks → concurrency
    lock (Web Build family) → daily quota → global spend → create the running
    operation (holding the lock), increment the daily counter and reserve the
    estimated spend. All-or-nothing. Callers resolve CONTINUATIONS before this."""
    init()
    now = _now()
    with _conn() as c:
        c.execute("BEGIN IMMEDIATE")
        try:
            _expire_stale_user_ops(c, user_id, now)

            # Concurrency lock — a build already running blocks a new one (also the
            # atomic race-guard for a near-simultaneous double START → in_progress).
            if max_concurrent >= 1:
                active = _active_family_op(c, user_id, now)
                if active is not None:
                    c.execute("ROLLBACK")
                    return ReserveOutcome("operation_in_progress", operation_id=active["operation_id"])

            # Per-user daily quota (atomic under this transaction).
            used_row = c.execute(
                "SELECT count FROM ai_op_usage WHERE user_id=? AND quota_window=? AND operation_type=?",
                (user_id, window, operation_type),
            ).fetchone()
            used = int(used_row["count"]) if used_row else 0
            if daily_limit <= 0 or used >= daily_limit:
                c.execute("ROLLBACK")
                return ReserveOutcome("daily_limit_reached", detail="quota", used=used)

            # Global daily spend reservation (before the provider call).
            if spend_enabled:
                g = _global_row(c, window)
                projected = float(g["reserved_usd"]) + float(g["actual_usd"]) + float(estimate_usd)
                if projected > spend_limit:
                    c.execute("ROLLBACK")
                    return ReserveOutcome("global_spend_limit_reached", detail="spend")

            # Commit the reservation: create the lock-holding operation, bump the
            # daily counter, add the estimate to the global reserved ledger.
            op_id = uuid.uuid4().hex
            lock_token = uuid.uuid4().hex
            c.execute(
                "INSERT INTO ai_operations (operation_id,user_id,operation_type,status,quota_window,"
                "idempotency_key,request_fingerprint,reserved_cost,actual_cost,reservation_open,attempt_count,"
                "lock_token,created_at,updated_at,expires_at) VALUES (?,?,?,?,?,?,?,?,0,1,1,?,?,?,?)",
                (op_id, user_id, operation_type, STATUS_RUNNING, window, idempotency_key, fingerprint,
                 float(estimate_usd), lock_token, now, now, now + lock_ttl),
            )
            c.execute(
                "INSERT INTO ai_op_usage (user_id,quota_window,operation_type,count) VALUES (?,?,?,1) "
                "ON CONFLICT(user_id,quota_window,operation_type) DO UPDATE SET count=count+1",
                (user_id, window, operation_type),
            )
            if spend_enabled and estimate_usd > 0:
                c.execute(
                    "UPDATE ai_global_spend SET reserved_usd=reserved_usd+?, updated_at=? WHERE quota_window=?",
                    (float(estimate_usd), now, window),
                )
            c.execute("COMMIT")
            return ReserveOutcome("allowed", operation_id=op_id, reservation_id=lock_token, used=used + 1)
        except Exception:
            try:
                c.execute("ROLLBACK")
            except Exception:
                pass
            raise


def record_cost(*, operation_id: Optional[str], user_id: str, window: str, actual_usd: float,
                model: Optional[str], provider: Optional[str]) -> None:
    """Book REAL provider cost (server-derived from token usage) into the global
    actual ledger and, when known, onto the operation. Never negative."""
    if actual_usd is None or actual_usd < 0:
        actual_usd = 0.0
    init()
    now = _now()
    with _conn() as c:
        c.execute("BEGIN IMMEDIATE")
        try:
            _global_row(c, window)
            c.execute(
                "UPDATE ai_global_spend SET actual_usd=actual_usd+?, updated_at=? WHERE quota_window=?",
                (float(actual_usd), now, window),
            )
            if operation_id:
                c.execute(
                    "UPDATE ai_operations SET actual_cost=actual_cost+?, model=COALESCE(?,model), "
                    "provider=COALESCE(?,provider), updated_at=? WHERE operation_id=?",
                    (float(actual_usd), model, provider, now, operation_id),
                )
            c.execute("COMMIT")
        except Exception:
            try:
                c.execute("ROLLBACK")
            except Exception:
                pass


def finalize(*, operation_id: str, user_id: str, status: str, error_code: Optional[str] = None) -> bool:
    """Terminal transition for a user's own operation: release the lock + give back
    the outstanding reservation. Idempotent (a second finalize is a no-op). The
    daily counter is deliberately NOT refunded (a launched build consumed real
    model work; refunds are abuse-prone), so 1/day stays 1/day."""
    init()
    now = _now()
    st = status if status in _TERMINAL else STATUS_SUCCEEDED
    with _conn() as c:
        c.execute("BEGIN IMMEDIATE")
        try:
            op = c.execute("SELECT * FROM ai_operations WHERE operation_id=?", (operation_id,)).fetchone()
            if op is None or str(op["user_id"]) != str(user_id):
                c.execute("ROLLBACK")
                return False
            if op["reservation_open"]:
                _release_reservation(c, op["quota_window"], float(op["reserved_cost"] or 0),
                                     float(op["actual_cost"] or 0), now)
            c.execute(
                "UPDATE ai_operations SET status=?, reservation_open=0, error_code=COALESCE(?,error_code), "
                "expires_at=?, updated_at=? WHERE operation_id=?",
                (st, error_code, now, now, operation_id),
            )
            c.execute("COMMIT")
            return True
        except Exception:
            try:
                c.execute("ROLLBACK")
            except Exception:
                pass
            return False


def finalize_by_key(*, user_id: str, idempotency_key: str, status: str, error_code: Optional[str] = None) -> bool:
    """Finalize a user's most recent operation carrying this client idempotency key.
    Lets the frontend release the lock after an abort that happened BEFORE it
    captured the server operationId (e.g. Stop pressed during planning)."""
    init()
    with _conn() as c:
        row = c.execute(
            "SELECT operation_id FROM ai_operations WHERE user_id=? AND idempotency_key=? "
            "ORDER BY created_at DESC LIMIT 1",
            (str(user_id), idempotency_key),
        ).fetchone()
    if not row:
        return False
    return finalize(operation_id=row["operation_id"], user_id=user_id, status=status, error_code=error_code)


def get_operation(operation_id: str) -> Optional[Dict[str, object]]:
    init()
    with _conn() as c:
        op = c.execute("SELECT * FROM ai_operations WHERE operation_id=?", (operation_id,)).fetchone()
        return dict(op) if op else None


def rate_check(user_id: str, operation_type: str, limit_per_min: int) -> tuple:
    """Sliding-window attempt limiter. Returns (ok, retry_after_seconds). Records
    the attempt when ok. Distinct from the daily quota — this only throttles
    submission bursts."""
    init()
    if limit_per_min <= 0:
        return True, 0
    now = _now()
    cutoff = now - 60.0
    with _conn() as c:
        c.execute("BEGIN IMMEDIATE")
        try:
            c.execute("DELETE FROM ai_rate_events WHERE ts < ?", (cutoff - 120.0,))
            recent = c.execute(
                "SELECT ts FROM ai_rate_events WHERE user_id=? AND operation_type=? AND ts>=? ORDER BY ts ASC",
                (user_id, operation_type, cutoff),
            ).fetchall()
            if len(recent) >= limit_per_min:
                oldest = float(recent[0]["ts"])
                retry = max(1, int(60 - (now - oldest)) + 1)
                c.execute("ROLLBACK")
                return False, retry
            c.execute(
                "INSERT INTO ai_rate_events (user_id, operation_type, ts) VALUES (?,?,?)",
                (user_id, operation_type, now),
            )
            c.execute("COMMIT")
            return True, 0
        except Exception:
            try:
                c.execute("ROLLBACK")
            except Exception:
                pass
            # Fail closed for the burst limiter is unnecessary; allow (money guards remain).
            return True, 0


# ── Owner-writable overrides ──────────────────────────────────────────────────
def get_overrides() -> Dict[str, str]:
    init()
    try:
        with _conn() as c:
            rows = c.execute("SELECT key, value FROM ai_guard_overrides").fetchall()
            return {r["key"]: r["value"] for r in rows}
    except Exception as e:
        logger.warning("ai_guard overrides read failed: %s", e)
        return {}


def set_override(key: str, value: str, updated_by: str) -> None:
    init()
    now = _now()
    with _conn() as c:
        c.execute(
            "INSERT INTO ai_guard_overrides (key,value,updated_by,updated_at) VALUES (?,?,?,?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by, "
            "updated_at=excluded.updated_at",
            (key, str(value), updated_by, now),
        )


def clear_override(key: str) -> None:
    init()
    with _conn() as c:
        c.execute("DELETE FROM ai_guard_overrides WHERE key=?", (key,))


# ── Admin/diagnostic snapshots ────────────────────────────────────────────────
def global_spend(window: str) -> Dict[str, float]:
    init()
    with _conn() as c:
        g = c.execute("SELECT reserved_usd, actual_usd FROM ai_global_spend WHERE quota_window=?", (window,)).fetchone()
        if not g:
            return {"reservedUsd": 0.0, "actualUsd": 0.0}
        return {"reservedUsd": round(float(g["reserved_usd"]), 6), "actualUsd": round(float(g["actual_usd"]), 6)}


def active_operations_count() -> int:
    init()
    now = _now()
    with _conn() as c:
        row = c.execute(
            "SELECT COUNT(*) AS n FROM ai_operations WHERE status=? AND expires_at>?",
            (STATUS_RUNNING, now),
        ).fetchone()
        return int(row["n"]) if row else 0


def counts_by_type(window: str) -> Dict[str, int]:
    init()
    with _conn() as c:
        rows = c.execute(
            "SELECT operation_type, SUM(count) AS n FROM ai_op_usage WHERE quota_window=? GROUP BY operation_type",
            (window,),
        ).fetchall()
        return {r["operation_type"]: int(r["n"]) for r in rows}


# ── Storage diagnostics (owner-only; proves the ACTIVE persistent DB path) ─────
def storage_health() -> Dict[str, object]:
    """Secret-free snapshot proving WHICH database is live. Read-only: never
    consumes quota and never calls a model. The absolute path is owner-only."""
    path = _db_path()
    abspath = os.path.abspath(path)
    parent = os.path.dirname(abspath) or "."
    parent_exists = os.path.isdir(parent)
    db_exists = os.path.isfile(abspath)
    writable = False
    try:
        if parent_exists:
            writable = os.access(parent, os.W_OK) and (not db_exists or os.access(abspath, os.W_OK))
    except Exception:
        writable = False
    return {
        "backend": "sqlite",
        "path": abspath,
        "persistentPathConfigured": _persistent_configured(),
        "parentDirExists": parent_exists,
        "databaseExists": db_exists,
        "writable": writable,
        "schemaReady": bool(_INITIALIZED),
        "walMode": True,
        "error": _STORAGE_ERROR,
    }


def verify_storage() -> Dict[str, object]:
    """Startup-safe proof of persistence: initialize the schema and write+read a
    harmless metadata marker (schema version + last-verified timestamp). Does NOT
    touch any user quota row and NEVER calls a model. Returns the storage health
    plus a `verified` flag. Never raises — a durable-path failure is reported (and
    the store is already failing closed for protected operations)."""
    try:
        init()
        now = _now()
        with _conn() as c:
            c.execute("BEGIN IMMEDIATE")
            try:
                c.execute(
                    "INSERT INTO ai_guard_meta (key,value,updated_at) VALUES ('last_verified_at',?,?) "
                    "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
                    (str(now), now),
                )
                c.execute("COMMIT")
            except Exception:
                c.execute("ROLLBACK")
                raise
            row = c.execute("SELECT value FROM ai_guard_meta WHERE key='last_verified_at'").fetchone()
        health = storage_health()
        health["verified"] = bool(row)
        return health
    except Exception as exc:
        health = storage_health()
        health["verified"] = False
        health["error"] = str(exc)[:200]
        return health
