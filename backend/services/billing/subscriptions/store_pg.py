# coding: utf-8
"""
Billing subscriptions — Postgres adapter (PR 3).

Line-for-line parity with store_sqlite so the dispatcher routes to either
backend transparently. Same `billing_subscriptions` table, same monotonic
UPSERT guard. `RETURNING id` tells us whether the INSERT/UPDATE actually
applied (a guard-skipped stale event returns no row).
"""
from __future__ import annotations

import logging
import threading
import uuid
from datetime import datetime, timezone
from typing import List, Optional, Tuple

from backend.services.db import engine
from backend.services.db.errors import DBConfigError, DBUnavailable
from backend.services.billing.subscriptions.types import (
    DATA_COLUMNS, Subscription,
)


logger = logging.getLogger(__name__)


# ── Counters ─────────────────────────────────────────────────────────────────

_LOCK = threading.Lock()
_COUNTS: dict[str, object] = {
    "upserts": 0, "applied": 0, "skipped_stale": 0,
    "reads": 0, "errors": 0, "last_error": "",
}


def _bump(field_: str, error: str = "") -> None:
    with _LOCK:
        cur = _COUNTS.get(field_, 0)
        _COUNTS[field_] = (cur if isinstance(cur, int) else 0) + 1
        if error:
            err_cur = _COUNTS.get("errors", 0)
            _COUNTS["errors"] = (err_cur if isinstance(err_cur, int) else 0) + 1
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


# ── Schema ───────────────────────────────────────────────────────────────────

_SCHEMA = """
CREATE TABLE IF NOT EXISTS billing_subscriptions (
    id               TEXT PRIMARY KEY,
    provider         TEXT NOT NULL DEFAULT 'lemon_squeezy',
    subscription_id  TEXT NOT NULL,
    status           TEXT,
    status_raw       TEXT,
    store_id         TEXT,
    customer_id      TEXT,
    order_id         TEXT,
    product_id       TEXT,
    variant_id       TEXT,
    price_id         TEXT,
    product_name     TEXT,
    variant_name     TEXT,
    customer_email   TEXT,
    customer_name    TEXT,
    card_brand       TEXT,
    card_last_four   TEXT,
    app_user_id      TEXT,
    custom_data_json TEXT NOT NULL DEFAULT '{}',
    cancelled        INTEGER NOT NULL DEFAULT 0,
    paused           INTEGER NOT NULL DEFAULT 0,
    pause_mode       TEXT,
    resumes_at       TEXT,
    test_mode        INTEGER NOT NULL DEFAULT 0,
    trial_ends_at    TEXT,
    renews_at        TEXT,
    ends_at          TEXT,
    billing_anchor   TEXT,
    lemon_created_at TEXT,
    lemon_updated_at TEXT,
    last_event_name  TEXT,
    last_event_id    TEXT,
    last_event_at    TEXT,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_billing_sub
    ON billing_subscriptions(provider, subscription_id);
CREATE INDEX IF NOT EXISTS ix_billing_sub_status
    ON billing_subscriptions(status);
CREATE INDEX IF NOT EXISTS ix_billing_sub_app_user
    ON billing_subscriptions(app_user_id);
CREATE INDEX IF NOT EXISTS ix_billing_sub_customer
    ON billing_subscriptions(provider, customer_id);
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
            logger.info("billing.subscriptions.store_pg initialized")
        except (DBConfigError, DBUnavailable):
            raise
        except Exception as e:
            logger.warning("billing.subscriptions.store_pg.init failed: %s", e)
            _bump("init_failed", str(e))


def _ensure_init() -> None:
    if not _INITIALIZED:
        init()


def _reset_for_tests() -> None:
    global _INITIALIZED
    with _LOCK:
        _INITIALIZED = False


# ── Upsert (monotonic) ───────────────────────────────────────────────────────

_INSERT_COLS = ("id", "provider", "subscription_id", *DATA_COLUMNS, "created_at", "updated_at")
_SET_CLAUSE = ", ".join(f"{c}=excluded.{c}" for c in DATA_COLUMNS) + ", updated_at=excluded.updated_at"
_GUARD = (
    "excluded.lemon_updated_at IS NULL "
    "OR billing_subscriptions.lemon_updated_at IS NULL "
    "OR excluded.lemon_updated_at >= billing_subscriptions.lemon_updated_at"
)


def upsert(sub: Subscription) -> Tuple[bool, Optional[Subscription]]:
    """Insert/update projected state with the monotonic ordering guard.
    Returns (applied, current). Raises ValueError on a missing subscription_id."""
    _ensure_init()
    if not sub.subscription_id or not str(sub.subscription_id).strip():
        raise ValueError("billing.subscriptions.upsert: subscription_id is required")

    now = _now()
    rid = _new_id()
    placeholders = ", ".join(["%s"] * len(_INSERT_COLS))
    values = [rid, sub.provider, str(sub.subscription_id), *sub.data_values(), now, now]
    sql = (
        f"INSERT INTO billing_subscriptions ({', '.join(_INSERT_COLS)}) "
        f"VALUES ({placeholders}) "
        f"ON CONFLICT (provider, subscription_id) DO UPDATE SET {_SET_CLAUSE} "
        f"WHERE {_GUARD} "
        f"RETURNING id"
    )
    try:
        with engine.acquire_sync() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, tuple(values))
                applied = cur.fetchone() is not None
            conn.commit()
        _bump("upserts")
        _bump("applied" if applied else "skipped_stale")
        return applied, get(sub.provider, str(sub.subscription_id))
    except (DBConfigError, DBUnavailable):
        raise
    except ValueError:
        raise
    except Exception as e:
        logger.warning("billing.subscriptions.store_pg.upsert sub=%s error: %s",
                       sub.subscription_id, e)
        _bump("upserts", str(e))
        raise


# ── Reads ────────────────────────────────────────────────────────────────────

def get(provider: str, subscription_id: str) -> Optional[Subscription]:
    _ensure_init()
    if not subscription_id:
        return None
    try:
        with engine.acquire_sync() as conn:
            with _dict_cursor(conn) as cur:
                cur.execute(
                    "SELECT * FROM billing_subscriptions "
                    "WHERE provider=%s AND subscription_id=%s",
                    (provider, str(subscription_id)),
                )
                row = cur.fetchone()
        if row is None:
            return None
        _bump("reads")
        return Subscription.from_row(row)
    except (DBConfigError, DBUnavailable):
        raise
    except Exception as e:
        logger.warning("billing.subscriptions.store_pg.get error: %s", e)
        _bump("reads", str(e))
        return None


def list_subscriptions(
    *,
    limit: int = 50,
    offset: int = 0,
    status: Optional[str] = None,
    app_user_id: Optional[str] = None,
    customer_id: Optional[str] = None,
    provider: Optional[str] = None,
) -> List[Subscription]:
    _ensure_init()
    sql = "SELECT * FROM billing_subscriptions WHERE 1=1"
    params: list = []
    if provider:
        sql += " AND provider=%s"; params.append(provider)
    if status:
        sql += " AND status=%s"; params.append(status)
    if app_user_id:
        sql += " AND app_user_id=%s"; params.append(app_user_id)
    if customer_id:
        sql += " AND customer_id=%s"; params.append(customer_id)
    sql += " ORDER BY updated_at DESC, id DESC LIMIT %s OFFSET %s"
    params.extend([int(max(1, min(500, limit))), int(max(0, offset))])
    try:
        with engine.acquire_sync() as conn:
            with _dict_cursor(conn) as cur:
                cur.execute(sql, tuple(params))
                rows = cur.fetchall()
        _bump("reads")
        return [Subscription.from_row(r) for r in rows]
    except (DBConfigError, DBUnavailable):
        raise
    except Exception as e:
        logger.warning("billing.subscriptions.store_pg.list error: %s", e)
        _bump("reads", str(e))
        return []


def count_by_status() -> dict:
    out: dict = {"total": 0, "by_status": {}}
    try:
        _ensure_init()
        with engine.acquire_sync() as conn:
            with _dict_cursor(conn) as cur:
                cur.execute("SELECT COUNT(*) AS n FROM billing_subscriptions")
                total = cur.fetchone()
                out["total"] = int((total or {}).get("n") or 0)
                cur.execute(
                    "SELECT status, COUNT(*) AS n FROM billing_subscriptions "
                    "GROUP BY status ORDER BY n DESC"
                )
                for r in cur.fetchall():
                    key = r["status"] if r["status"] else "(unknown)"
                    out["by_status"][key] = int(r["n"] or 0)
    except (DBConfigError, DBUnavailable):
        raise
    except Exception as e:
        logger.warning("billing.subscriptions.store_pg.count_by_status error: %s", e)
    return out


def table_counts() -> dict:
    out = {"total": 0}
    try:
        _ensure_init()
        with engine.acquire_sync() as conn:
            with _dict_cursor(conn) as cur:
                cur.execute("SELECT COUNT(*) AS n FROM billing_subscriptions")
                row = cur.fetchone()
        if row:
            out["total"] = int(row["n"] or 0)
    except Exception:
        pass
    return out


__all__ = [
    "init", "_reset_for_tests",
    "upsert", "get", "list_subscriptions",
    "count_by_status", "table_counts", "store_stats",
]
