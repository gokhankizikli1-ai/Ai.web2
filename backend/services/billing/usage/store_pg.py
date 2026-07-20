# coding: utf-8
"""
Billing usage — Postgres adapter (PR 6).

Line-for-line parity with store_sqlite. The atomic consume relies on Postgres
row locking: the guarded UPDATE takes a row lock, so concurrent consumers
serialise and cannot both exceed the limit. The ensure-row INSERT uses
ON CONFLICT DO NOTHING; the guarded UPDATE then governs the increment.
"""
from __future__ import annotations

import logging
import threading
import uuid
from datetime import datetime, timezone
from typing import List, Optional, Tuple

from backend.services.db import engine
from backend.services.db.errors import DBConfigError, DBUnavailable


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
    out["backend"] = "postgres"
    return out


# ── Helpers ──────────────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    return uuid.uuid4().hex


def _dict_cursor(conn):
    from psycopg.rows import dict_row  # noqa: PLC0415
    return conn.cursor(row_factory=dict_row)


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
            with engine.acquire_sync() as conn:
                with conn.cursor() as cur:
                    cur.execute(_SCHEMA)
                conn.commit()
            _INITIALIZED = True
            logger.info("billing.usage.store_pg initialized")
        except (DBConfigError, DBUnavailable):
            raise
        except Exception as e:
            logger.warning("billing.usage.store_pg.init failed: %s", e)
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
        with engine.acquire_sync() as conn:
            with _dict_cursor(conn) as cur:
                cur.execute(
                    "SELECT used FROM billing_usage WHERE user_id=%s AND metric=%s AND period=%s",
                    (str(user_id), metric, period),
                )
                row = cur.fetchone()
        _bump("reads")
        return int(row["used"]) if row and row.get("used") is not None else 0
    except (DBConfigError, DBUnavailable):
        raise
    except Exception as e:
        logger.warning("billing.usage.store_pg.get_used error: %s", e)
        _bump("reads", str(e))
        return 0


def list_for_user(user_id: str, *, period: Optional[str] = None, limit: int = 500) -> List[dict]:
    _ensure_init()
    if not user_id:
        return []
    sql = "SELECT metric, period, used, updated_at FROM billing_usage WHERE user_id=%s"
    params: list = [str(user_id)]
    if period:
        sql += " AND period=%s"
        params.append(period)
    sql += " ORDER BY updated_at DESC LIMIT %s"
    params.append(int(max(1, min(2000, limit))))
    try:
        with engine.acquire_sync() as conn:
            with _dict_cursor(conn) as cur:
                cur.execute(sql, tuple(params))
                rows = cur.fetchall()
        _bump("reads")
        return [
            {"metric": r["metric"], "period": r["period"],
             "used": int(r["used"] or 0), "updated_at": r["updated_at"]}
            for r in rows
        ]
    except (DBConfigError, DBUnavailable):
        raise
    except Exception as e:
        logger.warning("billing.usage.store_pg.list_for_user error: %s", e)
        _bump("reads", str(e))
        return []


# ── Atomic consume / refund ──────────────────────────────────────────────────

def consume(
    user_id: str, metric: str, period: str, amount: int, limit: Optional[int],
) -> Tuple[bool, int]:
    _ensure_init()
    amount = int(amount)
    if amount <= 0:
        return True, get_used(user_id, metric, period)
    now = _now()
    try:
        with engine.acquire_sync() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO billing_usage "
                    "(id, user_id, metric, period, used, created_at, updated_at) "
                    "VALUES (%s, %s, %s, %s, 0, %s, %s) "
                    "ON CONFLICT (user_id, metric, period) DO NOTHING",
                    (_new_id(), str(user_id), metric, period, now, now),
                )
                if limit is None:
                    cur.execute(
                        "UPDATE billing_usage SET used=used+%s, updated_at=%s "
                        "WHERE user_id=%s AND metric=%s AND period=%s",
                        (amount, now, str(user_id), metric, period),
                    )
                    allowed = True
                else:
                    cur.execute(
                        "UPDATE billing_usage SET used=used+%s, updated_at=%s "
                        "WHERE user_id=%s AND metric=%s AND period=%s AND used+%s<=%s",
                        (amount, now, str(user_id), metric, period, amount, int(limit)),
                    )
                    allowed = cur.rowcount > 0
                cur.execute(
                    "SELECT used FROM billing_usage WHERE user_id=%s AND metric=%s AND period=%s",
                    (str(user_id), metric, period),
                )
                r = cur.fetchone()
            conn.commit()
        used = int(r[0]) if r and r[0] is not None else 0
        _bump("consumes")
        _bump("allowed" if allowed else "denied")
        return allowed, used
    except (DBConfigError, DBUnavailable):
        raise
    except Exception as e:
        logger.warning("billing.usage.store_pg.consume error: %s", e)
        _bump("consumes", str(e))
        return True, get_used(user_id, metric, period)


def refund(user_id: str, metric: str, period: str, amount: int) -> int:
    _ensure_init()
    amount = int(amount)
    if amount <= 0:
        return get_used(user_id, metric, period)
    now = _now()
    try:
        with engine.acquire_sync() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE billing_usage SET used=GREATEST(0, used-%s), updated_at=%s "
                    "WHERE user_id=%s AND metric=%s AND period=%s",
                    (amount, now, str(user_id), metric, period),
                )
                cur.execute(
                    "SELECT used FROM billing_usage WHERE user_id=%s AND metric=%s AND period=%s",
                    (str(user_id), metric, period),
                )
                r = cur.fetchone()
            conn.commit()
        _bump("refunds")
        return int(r[0]) if r and r[0] is not None else 0
    except (DBConfigError, DBUnavailable):
        raise
    except Exception as e:
        logger.warning("billing.usage.store_pg.refund error: %s", e)
        _bump("refunds", str(e))
        return get_used(user_id, metric, period)


def reset(user_id: str, metric: str, period: Optional[str] = None) -> int:
    _ensure_init()
    if not user_id or not metric:
        return 0
    sql = "DELETE FROM billing_usage WHERE user_id=%s AND metric=%s"
    params: list = [str(user_id), metric]
    if period:
        sql += " AND period=%s"
        params.append(period)
    try:
        with engine.acquire_sync() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, tuple(params))
                n = cur.rowcount
            conn.commit()
        _bump("resets")
        return int(n)
    except (DBConfigError, DBUnavailable):
        raise
    except Exception as e:
        logger.warning("billing.usage.store_pg.reset error: %s", e)
        _bump("resets", str(e))
        return 0


def table_counts() -> dict:
    out = {"total": 0}
    try:
        _ensure_init()
        with engine.acquire_sync() as conn:
            with _dict_cursor(conn) as cur:
                cur.execute("SELECT COUNT(*) AS n FROM billing_usage")
                row = cur.fetchone()
        if row:
            out["total"] = int(row["n"] or 0)
    except Exception:
        pass
    return out


__all__ = [
    "init", "_reset_for_tests",
    "get_used", "list_for_user", "consume", "refund", "reset",
    "table_counts", "store_stats",
]
