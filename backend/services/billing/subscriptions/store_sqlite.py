# coding: utf-8
"""
Billing subscriptions — SQLite adapter (PR 3).

Lives in the SAME billing database file as the PR-1 inbox (billing.db, override
BILLING_DB_PATH) — one billing store, a separate `billing_subscriptions` table.

Design rules mirror the inbox store:
  * TEXT primary key (uuid4 hex) + ISO-8601 timestamps → ports onto Postgres.
  * One row per (provider, subscription_id), enforced by a UNIQUE index.
  * UPSERT with a MONOTONIC ORDERING GUARD: the DO UPDATE only applies when the
    incoming event's `lemon_updated_at` is newer-or-equal to the stored one, so
    a reordered/duplicate webhook can never regress the projected state.
  * Non-raising on transient SQLite errors (logs + counters); raises only on
    programmer-level mistakes (upserting without a subscription_id).
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
            with _conn() as c:
                c.executescript(_SCHEMA)
            _INITIALIZED = True
            logger.info("billing.subscriptions.store_sqlite initialized | db=%s", billing_config.db_path())
        except Exception as e:
            logger.warning("billing.subscriptions.store_sqlite.init failed: %s", e)
            _bump("init_failed", str(e))


def _ensure_init() -> None:
    if not _INITIALIZED:
        init()


def _reset_for_tests() -> None:
    global _INITIALIZED
    with _LOCK:
        _INITIALIZED = False


# ── Upsert (monotonic) ───────────────────────────────────────────────────────

# Built once from the shared DATA_COLUMNS so the two backends can never drift.
_INSERT_COLS = ("id", "provider", "subscription_id", *DATA_COLUMNS, "created_at", "updated_at")
_SET_CLAUSE = ", ".join(f"{c}=excluded.{c}" for c in DATA_COLUMNS) + ", updated_at=excluded.updated_at"
# Monotonic guard: apply the update only when the incoming event is
# newer-or-equal. NULLs (missing timestamps) always apply — we cannot order
# them, and the newest write we have is better than nothing.
_GUARD = (
    "excluded.lemon_updated_at IS NULL "
    "OR billing_subscriptions.lemon_updated_at IS NULL "
    "OR excluded.lemon_updated_at >= billing_subscriptions.lemon_updated_at"
)


def upsert(sub: Subscription) -> Tuple[bool, Optional[Subscription]]:
    """Insert or update the projected state for one subscription.

    Returns (applied, current):
      * applied=True  → the row was inserted or updated by THIS call.
      * applied=False → a newer state already existed and the ordering guard
                        skipped this (stale/reordered) event — NOT an error.
    `current` is the row's state after the call (always the freshest).

    Raises ValueError only on a missing subscription_id.
    """
    _ensure_init()
    if not sub.subscription_id or not str(sub.subscription_id).strip():
        raise ValueError("billing.subscriptions.upsert: subscription_id is required")

    now = _now()
    rid = _new_id()
    placeholders = ", ".join("?" for _ in _INSERT_COLS)
    values = [rid, sub.provider, str(sub.subscription_id), *sub.data_values(), now, now]
    sql = (
        f"INSERT INTO billing_subscriptions ({', '.join(_INSERT_COLS)}) "
        f"VALUES ({placeholders}) "
        f"ON CONFLICT(provider, subscription_id) DO UPDATE SET {_SET_CLAUSE} "
        f"WHERE {_GUARD}"
    )
    try:
        with _conn() as c:
            cur = c.execute(sql, values)
            applied = cur.rowcount > 0
        _bump("upserts")
        _bump("applied" if applied else "skipped_stale")
        return applied, get(sub.provider, str(sub.subscription_id))
    except ValueError:
        raise
    except Exception as e:
        logger.warning("billing.subscriptions.store_sqlite.upsert sub=%s error: %s",
                       sub.subscription_id, e)
        _bump("upserts", str(e))
        raise


# ── Reads ────────────────────────────────────────────────────────────────────

def get(provider: str, subscription_id: str) -> Optional[Subscription]:
    _ensure_init()
    if not subscription_id:
        return None
    try:
        with _conn() as c:
            row = c.execute(
                "SELECT * FROM billing_subscriptions "
                "WHERE provider=? AND subscription_id=?",
                (provider, str(subscription_id)),
            ).fetchone()
        if row is None:
            return None
        _bump("reads")
        return Subscription.from_row(row)
    except Exception as e:
        logger.warning("billing.subscriptions.store_sqlite.get error: %s", e)
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
        sql += " AND provider=?"; params.append(provider)
    if status:
        sql += " AND status=?"; params.append(status)
    if app_user_id:
        sql += " AND app_user_id=?"; params.append(app_user_id)
    if customer_id:
        sql += " AND customer_id=?"; params.append(customer_id)
    sql += " ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?"
    params.extend([int(max(1, min(500, limit))), int(max(0, offset))])
    try:
        with _conn() as c:
            rows = c.execute(sql, params).fetchall()
        _bump("reads")
        return [Subscription.from_row(r) for r in rows]
    except Exception as e:
        logger.warning("billing.subscriptions.store_sqlite.list error: %s", e)
        _bump("reads", str(e))
        return []


def count_by_status() -> dict:
    out: dict = {"total": 0, "by_status": {}}
    try:
        _ensure_init()
        with _conn() as c:
            total = c.execute("SELECT COUNT(*) AS n FROM billing_subscriptions").fetchone()
            out["total"] = int(total["n"] or 0) if total else 0
            for r in c.execute(
                "SELECT status, COUNT(*) AS n FROM billing_subscriptions "
                "GROUP BY status ORDER BY n DESC"
            ).fetchall():
                key = r["status"] if r["status"] else "(unknown)"
                out["by_status"][key] = int(r["n"] or 0)
    except Exception as e:
        logger.warning("billing.subscriptions.store_sqlite.count_by_status error: %s", e)
    return out


def table_counts() -> dict:
    out = {"total": 0}
    try:
        _ensure_init()
        with _conn() as c:
            row = c.execute("SELECT COUNT(*) AS n FROM billing_subscriptions").fetchone()
        if row is not None:
            out["total"] = int(row["n"] or 0)
    except Exception:
        pass
    return out


__all__ = [
    "init", "_reset_for_tests",
    "upsert", "get", "list_subscriptions",
    "count_by_status", "table_counts", "store_stats",
]
