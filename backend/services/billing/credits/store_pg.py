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
from backend.services.billing.credits import errors as credit_errors
from backend.services.billing.credits.errors import CreditStoreError, CreditStoreUnavailable
from backend.services.billing.credits.types import (
    CreditAccount, CreditTransaction, TxnResult,
    REASON_APPLIED, REASON_IDEMPOTENT, REASON_INSUFFICIENT, REASON_CONFLICT,
)


logger = logging.getLogger(__name__)

_LOCK = threading.Lock()
_COUNTS: dict[str, object] = {
    "appends": 0, "idempotent_hits": 0, "insufficient": 0, "conflicts": 0,
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

def _fail_closed(op: str, exc: Exception) -> CreditStoreUnavailable:
    """Map a Postgres-path failure to the typed fail-closed error, logging only
    a bounded exception TYPE (never SQL, DSNs, params, ids or metadata)."""
    logger.warning("billing.credits.store_pg.%s error: %s", op, type(exc).__name__)
    _bump("reads", type(exc).__name__)
    return CreditStoreUnavailable(f"credit {op} failed")


def get_account(user_id: str) -> CreditAccount:
    """Fetch the account row. A MISSING row is a legitimate zero-balance
    account; an OPERATIONAL/connection failure fails closed as
    `CreditStoreUnavailable` — never a fake zero balance."""
    uid = str(user_id)
    try:
        _ensure_init()
        with engine.acquire_sync() as conn:
            with _dict_cursor(conn) as cur:
                cur.execute("SELECT * FROM billing_credit_accounts WHERE user_id=%s", (uid,))
                row = cur.fetchone()
        _bump("reads")
        if row is None:
            return CreditAccount(user_id=uid, balance=0)
        return CreditAccount(user_id=row["user_id"], balance=int(row["balance"]),
                             created_at=row["created_at"], updated_at=row["updated_at"])
    except CreditStoreError:
        raise
    except (DBConfigError, DBUnavailable) as e:
        raise _fail_closed("get_account", e) from e
    except Exception as e:
        raise _fail_closed("get_account", e) from e


def get_balance(user_id: str) -> int:
    return get_account(user_id).balance


def get_by_reference(user_id: str, reference: str) -> Optional[CreditTransaction]:
    """Look up a transaction by `(user_id, reference)`. A missing reference is a
    legitimate `None`; an OPERATIONAL failure fails closed as
    `CreditStoreUnavailable` (never a silent `None` masking a store outage)."""
    if not reference:
        return None
    try:
        _ensure_init()
        with engine.acquire_sync() as conn:
            with _dict_cursor(conn) as cur:
                cur.execute(
                    "SELECT * FROM billing_credit_transactions WHERE user_id=%s AND reference=%s",
                    (str(user_id), str(reference)),
                )
                row = cur.fetchone()
        return _row_to_txn(row) if row else None
    except CreditStoreError:
        raise
    except (DBConfigError, DBUnavailable) as e:
        raise _fail_closed("get_by_reference", e) from e
    except Exception as e:
        raise _fail_closed("get_by_reference", e) from e


def list_transactions(user_id: str, *, limit: int = 50, offset: int = 0) -> List[CreditTransaction]:
    try:
        _ensure_init()
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
    except CreditStoreError:
        raise
    except (DBConfigError, DBUnavailable) as e:
        raise _fail_closed("list_transactions", e) from e
    except Exception as e:
        raise _fail_closed("list_transactions", e) from e


def sum_ledger(user_id: str) -> int:
    try:
        _ensure_init()
        with engine.acquire_sync() as conn:
            with _dict_cursor(conn) as cur:
                cur.execute(
                    "SELECT COALESCE(SUM(amount), 0) AS s FROM billing_credit_transactions WHERE user_id=%s",
                    (str(user_id),),
                )
                row = cur.fetchone()
        return int((row or {}).get("s") or 0)
    except CreditStoreError:
        raise
    except (DBConfigError, DBUnavailable) as e:
        raise _fail_closed("sum_ledger", e) from e
    except Exception as e:
        raise _fail_closed("sum_ledger", e) from e


# ── Atomic append ─────────────────────────────────────────────────────────────

def _resolve_prior(
    prior, balance: int, new_type: str, new_delta: int,
    reason: str, metadata: Optional[dict],
) -> TxnResult:
    """Decide the deterministic outcome when a transaction already exists for
    the same `(user_id, reference)`: an identical immutable payload is an
    idempotent no-op returning the ORIGINAL transaction (never mutated); a
    divergent payload is a REASON_CONFLICT rejection. Balance is unchanged."""
    if credit_errors.payload_conflict(
        prior_type=prior["type"], prior_amount=prior["amount"],
        prior_reason=prior["reason"], prior_metadata_raw=prior.get("metadata_json"),
        new_type=new_type, new_delta=int(new_delta),
        new_reason=reason, new_metadata=metadata,
    ):
        _bump("conflicts")
        return TxnResult(
            applied=False, reason_code=REASON_CONFLICT,
            balance=int(balance), idempotent=False, transaction=None,
        )
    _bump("idempotent_hits")
    return TxnResult(
        applied=True, reason_code=REASON_IDEMPOTENT,
        balance=int(balance), idempotent=True, transaction=_row_to_txn(prior),
    )


def _is_unique_violation(exc: Exception) -> bool:
    """True when a psycopg exception is a unique-constraint violation (sqlstate
    23505). Read defensively without importing psycopg at module load."""
    return getattr(exc, "sqlstate", None) == "23505"


def _resolve_after_unique_violation(
    uid: str, reference: str, new_type: str, new_delta: int,
    reason: str, metadata: Optional[dict],
) -> TxnResult:
    """Final safety net for the unique reference index. The FOR UPDATE lock
    already serialises same-account writes so the reference re-check normally
    resolves a concurrent retry deterministically; if the unique index still
    fires (a losing concurrent insert on the same reference), the winner is now
    committed and visible — re-read it in a FRESH transaction and resolve to the
    same idempotent/conflict outcome instead of surfacing a raw constraint
    error."""
    with engine.acquire_sync() as conn:
        with _dict_cursor(conn) as cur:
            cur.execute(
                "SELECT * FROM billing_credit_transactions WHERE user_id=%s AND reference=%s",
                (uid, reference),
            )
            prior = cur.fetchone()
            cur.execute("SELECT balance FROM billing_credit_accounts WHERE user_id=%s", (uid,))
            bal_row = cur.fetchone()
    if prior is None:
        # The index fired but no committed winner is visible — a genuinely
        # unexpected state. Fail closed rather than guess.
        raise CreditStoreUnavailable("credit apply reference race unresolved")
    balance = int((bal_row or {}).get("balance") if bal_row else prior["balance_after"])
    return _resolve_prior(prior, balance, new_type, int(new_delta), reason, metadata)


def apply(
    *, user_id: str, delta: int, type: str, reason: str = "",
    reference: Optional[str] = None, metadata: Optional[dict] = None,
    allow_negative: bool = False,
) -> TxnResult:
    uid = str(user_id)
    now = _now()
    ref = str(reference) if reference else None
    try:
        _ensure_init()
        with engine.acquire_sync() as conn:
            with _dict_cursor(conn) as cur:
                # Ensure the account exists, then lock it FOR UPDATE FIRST so
                # every same-user mutation serialises BEFORE the idempotency /
                # append decision. Acquiring the lock up front is what makes a
                # concurrent same-reference retry resolve deterministically: the
                # loser blocks here until the winner commits, then its reference
                # re-check below sees the committed original.
                cur.execute(
                    "INSERT INTO billing_credit_accounts (user_id, balance, created_at, updated_at) "
                    "VALUES (%s, 0, %s, %s) ON CONFLICT (user_id) DO NOTHING",
                    (uid, now, now),
                )
                cur.execute("SELECT balance FROM billing_credit_accounts WHERE user_id=%s FOR UPDATE", (uid,))
                bal_row = cur.fetchone()
                balance = int((bal_row or {}).get("balance") or 0)

                # Idempotency re-check UNDER the account lock. This runs after
                # the FOR UPDATE so two concurrent same-reference requests can no
                # longer both miss: the second one sees the first's committed
                # transaction here and resolves to idempotent/conflict.
                if ref:
                    cur.execute(
                        "SELECT * FROM billing_credit_transactions WHERE user_id=%s AND reference=%s",
                        (uid, ref),
                    )
                    prior = cur.fetchone()
                    if prior is not None:
                        conn.commit()
                        return _resolve_prior(prior, balance, type, int(delta), reason, metadata)

                new_balance = balance + int(delta)
                if int(delta) < 0 and new_balance < 0 and not allow_negative:
                    conn.commit()
                    _bump("insufficient")
                    return TxnResult(applied=False, reason_code=REASON_INSUFFICIENT,
                                     balance=balance, idempotent=False, transaction=None)

                tid = _new_id()
                md = credit_errors.canonical_metadata(metadata)
                cur.execute(
                    "INSERT INTO billing_credit_transactions "
                    "(id, user_id, type, amount, balance_after, reason, reference, metadata_json, created_at) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
                    (tid, uid, type, int(delta), new_balance, reason or "", ref, md, now),
                )
                cur.execute(
                    "UPDATE billing_credit_accounts SET balance=%s, updated_at=%s WHERE user_id=%s",
                    (new_balance, now, uid),
                )
            conn.commit()
        _bump("appends")
        txn = CreditTransaction(
            id=tid, user_id=uid, type=type, amount=int(delta), balance_after=new_balance,
            reason=reason or "", reference=ref, metadata=metadata or {}, created_at=now,
        )
        return TxnResult(applied=True, reason_code=REASON_APPLIED, balance=new_balance,
                         idempotent=False, transaction=txn)
    except CreditStoreError:
        raise
    except (DBConfigError, DBUnavailable) as e:
        logger.warning("billing.credits.store_pg.apply error: %s", type(e).__name__)
        _bump("appends", type(e).__name__)
        raise CreditStoreUnavailable("credit apply failed") from e
    except Exception as e:
        # The unique reference index remains the DB-level final safety net. If a
        # losing concurrent insert trips it, resolve deterministically against
        # the committed winner rather than raising a raw constraint error.
        if ref and _is_unique_violation(e):
            try:
                return _resolve_after_unique_violation(uid, ref, type, int(delta), reason, metadata)
            except CreditStoreError:
                raise
            except Exception as e2:  # pragma: no cover — resolution itself failed
                logger.warning("billing.credits.store_pg.apply resolve error: %s", type(e2).__name__)
                _bump("appends", type(e2).__name__)
                raise CreditStoreUnavailable("credit apply conflict resolution failed") from e2
        logger.warning("billing.credits.store_pg.apply error: %s", type(e).__name__)
        _bump("appends", type(e).__name__)
        raise CreditStoreUnavailable("credit apply failed") from e


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
