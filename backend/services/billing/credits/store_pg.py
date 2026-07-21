# coding: utf-8
"""
Billing credits — Postgres adapter (PR 8). Parity with store_sqlite.

Atomicity uses row locking: the mutating path does
`SELECT balance ... FOR UPDATE` on the account row inside one transaction, so
concurrent operations on the same account serialise. The transactions table is
append-only (INSERT only); the cached account balance is updated in the same
transaction.
"""
from __future__ import annotations

import json
import logging
import threading
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from backend.services.db import engine
from backend.services.db.errors import DBConfigError, DBUnavailable
from backend.services.billing.credits.types import (
    CreditAccount, CreditTransaction, TxnResult,
    REASON_APPLIED, REASON_IDEMPOTENT, REASON_INSUFFICIENT,
)


logger = logging.getLogger(__name__)

_LOCK = threading.Lock()
_COUNTS: dict[str, object] = {
    "appends": 0, "idempotent_hits": 0, "insufficient": 0,
    "reads": 0, "errors": 0, "last_error": "",
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


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    return uuid.uuid4().hex


def _dict_cursor(conn):
    from psycopg.rows import dict_row  # noqa: PLC0415
    return conn.cursor(row_factory=dict_row)


_SCHEMA = """
CREATE TABLE IF NOT EXISTS billing_credit_accounts (
    user_id     TEXT PRIMARY KEY,
    balance     INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS billing_credit_transactions (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    type          TEXT NOT NULL,
    amount        INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    reason        TEXT NOT NULL DEFAULT '',
    reference     TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at    TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_credit_txn_reference
    ON billing_credit_transactions(user_id, reference);
CREATE INDEX IF NOT EXISTS ix_credit_txn_user
    ON billing_credit_transactions(user_id, created_at DESC);
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
            logger.info("billing.credits.store_pg initialized")
        except (DBConfigError, DBUnavailable):
            raise
        except Exception as e:
            logger.warning("billing.credits.store_pg.init failed: %s", e)
            _bump("init_failed", str(e))


def _ensure_init() -> None:
    if not _INITIALIZED:
        init()


def _reset_for_tests() -> None:
    global _INITIALIZED
    with _LOCK:
        _INITIALIZED = False


def _safe_json(raw) -> dict:
    if not raw:
        return {}
    if isinstance(raw, dict):
        return raw
    try:
        v = json.loads(raw)
        return v if isinstance(v, dict) else {}
    except Exception:
        return {}


def _row_to_txn(row) -> CreditTransaction:
    return CreditTransaction(
        id=row["id"], user_id=row["user_id"], type=row["type"],
        amount=int(row["amount"]), balance_after=int(row["balance_after"]),
        reason=row["reason"] or "", reference=row["reference"],
        metadata=_safe_json(row.get("metadata_json")), created_at=row["created_at"],
    )


# ── Reads ────────────────────────────────────────────────────────────────────

def get_account(user_id: str) -> CreditAccount:
    _ensure_init()
    uid = str(user_id)
    try:
        with engine.acquire_sync() as conn:
            with _dict_cursor(conn) as cur:
                cur.execute("SELECT * FROM billing_credit_accounts WHERE user_id=%s", (uid,))
                row = cur.fetchone()
        _bump("reads")
        if row is None:
            return CreditAccount(user_id=uid, balance=0)
        return CreditAccount(user_id=row["user_id"], balance=int(row["balance"]),
                             created_at=row["created_at"], updated_at=row["updated_at"])
    except (DBConfigError, DBUnavailable):
        raise
    except Exception as e:
        logger.warning("billing.credits.store_pg.get_account error: %s", e)
        _bump("reads", str(e))
        return CreditAccount(user_id=uid, balance=0)


def get_balance(user_id: str) -> int:
    return get_account(user_id).balance


def get_by_reference(user_id: str, reference: str) -> Optional[CreditTransaction]:
    _ensure_init()
    if not reference:
        return None
    try:
        with engine.acquire_sync() as conn:
            with _dict_cursor(conn) as cur:
                cur.execute(
                    "SELECT * FROM billing_credit_transactions WHERE user_id=%s AND reference=%s",
                    (str(user_id), str(reference)),
                )
                row = cur.fetchone()
        return _row_to_txn(row) if row else None
    except (DBConfigError, DBUnavailable):
        raise
    except Exception as e:
        logger.warning("billing.credits.store_pg.get_by_reference error: %s", e)
        return None


def list_transactions(user_id: str, *, limit: int = 50, offset: int = 0) -> List[CreditTransaction]:
    _ensure_init()
    try:
        with engine.acquire_sync() as conn:
            with _dict_cursor(conn) as cur:
                cur.execute(
                    "SELECT * FROM billing_credit_transactions WHERE user_id=%s "
                    "ORDER BY created_at DESC, id DESC LIMIT %s OFFSET %s",
                    (str(user_id), int(max(1, min(500, limit))), int(max(0, offset))),
                )
                rows = cur.fetchall()
        _bump("reads")
        return [_row_to_txn(r) for r in rows]
    except (DBConfigError, DBUnavailable):
        raise
    except Exception as e:
        logger.warning("billing.credits.store_pg.list_transactions error: %s", e)
        _bump("reads", str(e))
        return []


def sum_ledger(user_id: str) -> int:
    _ensure_init()
    try:
        with engine.acquire_sync() as conn:
            with _dict_cursor(conn) as cur:
                cur.execute(
                    "SELECT COALESCE(SUM(amount), 0) AS s FROM billing_credit_transactions WHERE user_id=%s",
                    (str(user_id),),
                )
                row = cur.fetchone()
        return int((row or {}).get("s") or 0)
    except (DBConfigError, DBUnavailable):
        raise
    except Exception as e:
        logger.warning("billing.credits.store_pg.sum_ledger error: %s", e)
        return 0


# ── Atomic append ─────────────────────────────────────────────────────────────

def apply(
    *, user_id: str, delta: int, type: str, reason: str = "",
    reference: Optional[str] = None, metadata: Optional[dict] = None,
    allow_negative: bool = False,
) -> TxnResult:
    _ensure_init()
    uid = str(user_id)
    now = _now()
    try:
        with engine.acquire_sync() as conn:
            with _dict_cursor(conn) as cur:
                # Idempotency check (inside the txn).
                if reference:
                    cur.execute(
                        "SELECT * FROM billing_credit_transactions WHERE user_id=%s AND reference=%s",
                        (uid, str(reference)),
                    )
                    prior = cur.fetchone()
                    if prior is not None:
                        cur.execute("SELECT balance FROM billing_credit_accounts WHERE user_id=%s", (uid,))
                        bal_row = cur.fetchone()
                        conn.commit()
                        _bump("idempotent_hits")
                        return TxnResult(
                            applied=True, reason_code=REASON_IDEMPOTENT,
                            balance=int((bal_row or {}).get("balance", prior["balance_after"])),
                            idempotent=True, transaction=_row_to_txn(prior),
                        )

                # Ensure the account exists, then lock it FOR UPDATE so
                # concurrent applies on this account serialise.
                cur.execute(
                    "INSERT INTO billing_credit_accounts (user_id, balance, created_at, updated_at) "
                    "VALUES (%s, 0, %s, %s) ON CONFLICT (user_id) DO NOTHING",
                    (uid, now, now),
                )
                cur.execute("SELECT balance FROM billing_credit_accounts WHERE user_id=%s FOR UPDATE", (uid,))
                bal_row = cur.fetchone()
                balance = int((bal_row or {}).get("balance") or 0)
                new_balance = balance + int(delta)

                if int(delta) < 0 and new_balance < 0 and not allow_negative:
                    conn.commit()
                    _bump("insufficient")
                    return TxnResult(applied=False, reason_code=REASON_INSUFFICIENT,
                                     balance=balance, idempotent=False, transaction=None)

                tid = _new_id()
                md = json.dumps(metadata or {})
                cur.execute(
                    "INSERT INTO billing_credit_transactions "
                    "(id, user_id, type, amount, balance_after, reason, reference, metadata_json, created_at) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
                    (tid, uid, type, int(delta), new_balance, reason or "", reference, md, now),
                )
                cur.execute(
                    "UPDATE billing_credit_accounts SET balance=%s, updated_at=%s WHERE user_id=%s",
                    (new_balance, now, uid),
                )
            conn.commit()
        _bump("appends")
        txn = CreditTransaction(
            id=tid, user_id=uid, type=type, amount=int(delta), balance_after=new_balance,
            reason=reason or "", reference=reference, metadata=metadata or {}, created_at=now,
        )
        return TxnResult(applied=True, reason_code=REASON_APPLIED, balance=new_balance,
                         idempotent=False, transaction=txn)
    except (DBConfigError, DBUnavailable):
        raise
    except Exception as e:
        logger.warning("billing.credits.store_pg.apply error: %s", e)
        _bump("appends", str(e))
        raise


def table_counts() -> dict:
    out = {"accounts": 0, "transactions": 0}
    try:
        _ensure_init()
        with engine.acquire_sync() as conn:
            with _dict_cursor(conn) as cur:
                cur.execute("SELECT COUNT(*) AS n FROM billing_credit_accounts")
                out["accounts"] = int((cur.fetchone() or {}).get("n") or 0)
                cur.execute("SELECT COUNT(*) AS n FROM billing_credit_transactions")
                out["transactions"] = int((cur.fetchone() or {}).get("n") or 0)
    except Exception:
        pass
    return out


__all__ = [
    "init", "_reset_for_tests",
    "get_account", "get_balance", "get_by_reference", "list_transactions",
    "sum_ledger", "apply", "table_counts", "store_stats",
]
