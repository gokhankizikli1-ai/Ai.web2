# coding: utf-8
"""
Billing checkout — Postgres adapter (PR 7). Parity with store_sqlite.
"""
from __future__ import annotations

import logging
import threading
import uuid
from datetime import datetime, timezone
from typing import List, Optional, Tuple

from backend.services.db import engine
from backend.services.db.errors import DBConfigError, DBUnavailable
from backend.services.billing.checkout.types import CheckoutRecord


logger = logging.getLogger(__name__)

_LOCK = threading.Lock()
_COUNTS: dict[str, object] = {"inserts": 0, "idempotent_hits": 0, "reads": 0, "errors": 0, "last_error": ""}


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


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    return uuid.uuid4().hex


def _dict_cursor(conn):
    from psycopg.rows import dict_row  # noqa: PLC0415
    return conn.cursor(row_factory=dict_row)


_SCHEMA = """
CREATE TABLE IF NOT EXISTS billing_checkouts (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL,
    selector        TEXT NOT NULL,
    variant_id      TEXT NOT NULL,
    plan            TEXT NOT NULL,
    checkout_id     TEXT,
    checkout_url    TEXT NOT NULL DEFAULT '',
    idempotency_key TEXT,
    created_at      TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_billing_checkout_idem
    ON billing_checkouts(user_id, idempotency_key);
CREATE INDEX IF NOT EXISTS ix_billing_checkout_user
    ON billing_checkouts(user_id);
CREATE INDEX IF NOT EXISTS ix_billing_checkout_created
    ON billing_checkouts(created_at DESC);
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
            logger.info("billing.checkout.store_pg initialized")
        except (DBConfigError, DBUnavailable):
            raise
        except Exception as e:
            logger.warning("billing.checkout.store_pg.init failed: %s", e)
            _bump("init_failed", str(e))


def _ensure_init() -> None:
    if not _INITIALIZED:
        init()


def _reset_for_tests() -> None:
    global _INITIALIZED
    with _LOCK:
        _INITIALIZED = False


def _row_to_record(row) -> CheckoutRecord:
    return CheckoutRecord(
        id=row["id"], user_id=row["user_id"], selector=row["selector"],
        variant_id=row["variant_id"], plan=row["plan"],
        checkout_id=row["checkout_id"], checkout_url=row["checkout_url"] or "",
        idempotency_key=row["idempotency_key"], created_at=row["created_at"],
    )


def get_by_idempotency(user_id: str, key: str) -> Optional[CheckoutRecord]:
    _ensure_init()
    if not user_id or not key:
        return None
    try:
        with engine.acquire_sync() as conn:
            with _dict_cursor(conn) as cur:
                cur.execute(
                    "SELECT * FROM billing_checkouts WHERE user_id=%s AND idempotency_key=%s",
                    (str(user_id), str(key)),
                )
                row = cur.fetchone()
        _bump("reads")
        return _row_to_record(row) if row else None
    except (DBConfigError, DBUnavailable):
        raise
    except Exception as e:
        logger.warning("billing.checkout.store_pg.get_by_idempotency error: %s", e)
        _bump("reads", str(e))
        return None


def insert(record: CheckoutRecord) -> Tuple[bool, CheckoutRecord]:
    _ensure_init()
    rid = _new_id()
    now = _now()
    try:
        with engine.acquire_sync() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO billing_checkouts "
                    "(id, user_id, selector, variant_id, plan, checkout_id, checkout_url, "
                    " idempotency_key, created_at) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) "
                    "ON CONFLICT (user_id, idempotency_key) DO NOTHING "
                    "RETURNING id",
                    (rid, str(record.user_id), record.selector, record.variant_id, record.plan,
                     record.checkout_id, record.checkout_url or "", record.idempotency_key, now),
                )
                inserted = cur.fetchone() is not None
            conn.commit()
        if inserted:
            _bump("inserts")
            record.id = rid
            record.created_at = now
            return True, record
        _bump("idempotent_hits")
        existing = get_by_idempotency(str(record.user_id), record.idempotency_key or "")
        return False, (existing or record)
    except (DBConfigError, DBUnavailable):
        raise
    except Exception as e:
        logger.warning("billing.checkout.store_pg.insert error: %s", e)
        _bump("inserts", str(e))
        record.id = record.id or rid
        record.created_at = record.created_at or now
        return True, record


def list_recent(*, limit: int = 50, offset: int = 0, user_id: Optional[str] = None) -> List[CheckoutRecord]:
    _ensure_init()
    sql = "SELECT * FROM billing_checkouts WHERE 1=1"
    params: list = []
    if user_id:
        sql += " AND user_id=%s"
        params.append(str(user_id))
    sql += " ORDER BY created_at DESC, id DESC LIMIT %s OFFSET %s"
    params.extend([int(max(1, min(500, limit))), int(max(0, offset))])
    try:
        with engine.acquire_sync() as conn:
            with _dict_cursor(conn) as cur:
                cur.execute(sql, tuple(params))
                rows = cur.fetchall()
        _bump("reads")
        return [_row_to_record(r) for r in rows]
    except (DBConfigError, DBUnavailable):
        raise
    except Exception as e:
        logger.warning("billing.checkout.store_pg.list_recent error: %s", e)
        _bump("reads", str(e))
        return []


def table_counts() -> dict:
    out = {"total": 0}
    try:
        _ensure_init()
        with engine.acquire_sync() as conn:
            with _dict_cursor(conn) as cur:
                cur.execute("SELECT COUNT(*) AS n FROM billing_checkouts")
                row = cur.fetchone()
        if row:
            out["total"] = int(row["n"] or 0)
    except Exception:
        pass
    return out


__all__ = [
    "init", "_reset_for_tests",
    "get_by_idempotency", "insert", "list_recent",
    "table_counts", "store_stats",
]
