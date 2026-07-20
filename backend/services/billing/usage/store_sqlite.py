# coding: utf-8
"""
Billing usage — SQLite adapter (PR 6).

Per-(user_id, metric, period) counters in the shared billing database
(billing.db). The CORE guarantee is a CONCURRENCY-SAFE atomic consume: the
counter is incremented only when it would stay within the limit, evaluated
inside a single UPDATE whose WHERE clause is checked atomically. SQLite
serialises writers via the database lock, so two racing consumers can never
both push the counter past the limit.

Independence: this table is keyed by user + metric + period only — never by
subscription_id — so usage tracking is decoupled from billing state. Only the
LIMIT is read from entitlements (by the service layer) at check time.
"""
from __future__ import annotations

import logging
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Iterator, List, Optional, Tuple

from backend.services.billing import config as billing_config


logger = logging.getLogger(__name__)


# ── Counters ─────────────────────────────────────────────────────────────────

_LOCK = threading.Lock()
_COUNTS: dict[str, object] = {
    "consumes": 0, "allowed": 0, "denied": 0, "refunds": 0,
    "reads": 0, "resets": 0, "errors": 0, "last_error": "",
}


def _bump(field_: str, error: str = "") -> None:
    with _LOCK:
        cur = _COUNTS.get(field_, 0)
        _COUNTS[field_] = (cur if isinstance(cur, int) else 0) + 1
        if error:
            e = _COUNTS.get("errors", 0)
            _COUNTS["errors"] = (e if isinstance(e, int) else 0) + 1
            _COUNTS["last_error"] = error[:140]


def store_stats() -> dict:
    with _LOCK:
        out = dict(_COUNTS)
    out["db_path"] = billing_config.db_path()
    out["backend"] = "sqlite"
    return out


# ── Helpers ──────────────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    return uuid.uuid4().hex


@contextmanager
def _conn() -> Iterator[sqlite3.Connection]:
    c = sqlite3.connect(billing_config.db_path(), timeout=10)
    try:
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA journal_mode = WAL")
        yield c
        c.commit()
    finally:
        c.close()


# ── Schema ───────────────────────────────────────────────────────────────────

_SCHEMA = """
CREATE TABLE IF NOT EXISTS billing_usage (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    metric      TEXT NOT NULL,
    period      TEXT NOT NULL,
    used        INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_billing_usage
    ON billing_usage(user_id, metric, period);
CREATE INDEX IF NOT EXISTS ix_billing_usage_user
    ON billing_usage(user_id);
CREATE INDEX IF NOT EXISTS ix_billing_usage_updated
    ON billing_usage(updated_at);
"""


_INITIALIZED = False


def init() -> None:
    global _INITIALIZED
    if _INITIALIZED:
        return
    with _LOCK:
        if _INITIALIZED:
            return
        try:
            with _conn() as c:
                c.executescript(_SCHEMA)
            _INITIALIZED = True
            logger.info("billing.usage.store_sqlite initialized | db=%s", billing_config.db_path())
        except Exception as e:
            logger.warning("billing.usage.store_sqlite.init failed: %s", e)
            _bump("init_failed", str(e))


def _ensure_init() -> None:
    if not _INITIALIZED:
        init()


def _reset_for_tests() -> None:
    global _INITIALIZED
    with _LOCK:
        _INITIALIZED = False


# ── Reads ────────────────────────────────────────────────────────────────────

def get_used(user_id: str, metric: str, period: str) -> int:
    _ensure_init()
    if not user_id or not metric:
        return 0
    try:
        with _conn() as c:
            row = c.execute(
                "SELECT used FROM billing_usage WHERE user_id=? AND metric=? AND period=?",
                (str(user_id), metric, period),
            ).fetchone()
        _bump("reads")
        return int(row["used"]) if row and row["used"] is not None else 0
    except Exception as e:
        logger.warning("billing.usage.store_sqlite.get_used error: %s", e)
        _bump("reads", str(e))
        return 0


def list_for_user(user_id: str, *, period: Optional[str] = None, limit: int = 500) -> List[dict]:
    _ensure_init()
    if not user_id:
        return []
    sql = "SELECT metric, period, used, updated_at FROM billing_usage WHERE user_id=?"
    params: list = [str(user_id)]
    if period:
        sql += " AND period=?"
        params.append(period)
    sql += " ORDER BY updated_at DESC LIMIT ?"
    params.append(int(max(1, min(2000, limit))))
    try:
        with _conn() as c:
            rows = c.execute(sql, params).fetchall()
        _bump("reads")
        return [
            {"metric": r["metric"], "period": r["period"],
             "used": int(r["used"] or 0), "updated_at": r["updated_at"]}
            for r in rows
        ]
    except Exception as e:
        logger.warning("billing.usage.store_sqlite.list_for_user error: %s", e)
        _bump("reads", str(e))
        return []


# ── Atomic consume / refund ──────────────────────────────────────────────────

def consume(
    user_id: str, metric: str, period: str, amount: int, limit: Optional[int],
) -> Tuple[bool, int]:
    """Atomically add `amount` to the counter iff it stays within `limit`.

    Returns (allowed, used_after). When `limit` is None the increment is
    unconditional (unlimited) and always allowed. When the increment would
    exceed the limit, the counter is left UNCHANGED and allowed=False.

    Concurrency: the guarded UPDATE is evaluated atomically under SQLite's
    write lock, so racing consumers cannot both exceed the limit.
    """
    _ensure_init()
    amount = int(amount)
    if amount <= 0:
        return True, get_used(user_id, metric, period)
    now = _now()
    try:
        with _conn() as c:
            # Ensure the row exists (idempotent) so the guarded UPDATE has a
            # target; the initial `used` is 0 so the guard governs the whole
            # increment including the first one.
            c.execute(
                "INSERT OR IGNORE INTO billing_usage "
                "(id, user_id, metric, period, used, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, 0, ?, ?)",
                (_new_id(), str(user_id), metric, period, now, now),
            )
            if limit is None:
                c.execute(
                    "UPDATE billing_usage SET used=used+?, updated_at=? "
                    "WHERE user_id=? AND metric=? AND period=?",
                    (amount, now, str(user_id), metric, period),
                )
                allowed = True
            else:
                cur = c.execute(
                    "UPDATE billing_usage SET used=used+?, updated_at=? "
                    "WHERE user_id=? AND metric=? AND period=? AND used+?<=?",
                    (amount, now, str(user_id), metric, period, amount, int(limit)),
                )
                allowed = cur.rowcount > 0
            row = c.execute(
                "SELECT used FROM billing_usage WHERE user_id=? AND metric=? AND period=?",
                (str(user_id), metric, period),
            ).fetchone()
        used = int(row["used"]) if row and row["used"] is not None else 0
        _bump("consumes")
        _bump("allowed" if allowed else "denied")
        return allowed, used
    except Exception as e:
        logger.warning("billing.usage.store_sqlite.consume error: %s", e)
        _bump("consumes", str(e))
        # Fail OPEN at the store level too — never block a product op on a
        # metering bug. Report the current counter best-effort.
        return True, get_used(user_id, metric, period)


def refund(user_id: str, metric: str, period: str, amount: int) -> int:
    """Decrement the counter (floored at 0). Used to release a reservation when
    the metered operation ultimately fails. Returns used_after."""
    _ensure_init()
    amount = int(amount)
    if amount <= 0:
        return get_used(user_id, metric, period)
    now = _now()
    try:
        with _conn() as c:
            c.execute(
                "UPDATE billing_usage SET used=MAX(0, used-?), updated_at=? "
                "WHERE user_id=? AND metric=? AND period=?",
                (amount, now, str(user_id), metric, period),
            )
            row = c.execute(
                "SELECT used FROM billing_usage WHERE user_id=? AND metric=? AND period=?",
                (str(user_id), metric, period),
            ).fetchone()
        _bump("refunds")
        return int(row["used"]) if row and row["used"] is not None else 0
    except Exception as e:
        logger.warning("billing.usage.store_sqlite.refund error: %s", e)
        _bump("refunds", str(e))
        return get_used(user_id, metric, period)


def reset(user_id: str, metric: str, period: Optional[str] = None) -> int:
    """Delete usage rows for a user+metric (a specific period, or all periods).
    Owner/maintenance tool. Returns rows removed."""
    _ensure_init()
    if not user_id or not metric:
        return 0
    sql = "DELETE FROM billing_usage WHERE user_id=? AND metric=?"
    params: list = [str(user_id), metric]
    if period:
        sql += " AND period=?"
        params.append(period)
    try:
        with _conn() as c:
            cur = c.execute(sql, params)
            n = cur.rowcount
        _bump("resets")
        return int(n)
    except Exception as e:
        logger.warning("billing.usage.store_sqlite.reset error: %s", e)
        _bump("resets", str(e))
        return 0


def table_counts() -> dict:
    out = {"total": 0}
    try:
        _ensure_init()
        with _conn() as c:
            row = c.execute("SELECT COUNT(*) AS n FROM billing_usage").fetchone()
        if row is not None:
            out["total"] = int(row["n"] or 0)
    except Exception:
        pass
    return out


__all__ = [
    "init", "_reset_for_tests",
    "get_used", "list_for_user", "consume", "refund", "reset",
    "table_counts", "store_stats",
]
