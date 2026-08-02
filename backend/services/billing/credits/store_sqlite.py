# coding: utf-8
"""
Billing credits — SQLite adapter (PR 8).

Two tables in the shared billing database (billing.db):

  billing_credit_accounts       one row per user; `balance` is the CACHED
                                running total, updated transactionally with
                                each append.
  billing_credit_transactions   the IMMUTABLE, append-only ledger. Rows are
                                only ever INSERTed — never updated or deleted.
                                `balance_after` records the running balance at
                                the moment the entry was appended.

Correctness: every mutating operation runs inside a single `BEGIN IMMEDIATE`
transaction, which takes the write lock up front so concurrent operations on
the same account SERIALISE. That makes the read-compute-append-update sequence
atomic and the cached balance always equal to the ledger sum (verifiable via
service.verify_balance). Consumption is rejected when it would overdraw (unless
allow_negative), inside the same lock, so the balance can never go negative by
accident.
"""
from __future__ import annotations

import json
import logging
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Iterator, List, Optional

from backend.services.billing.credits import config as credits_config
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
    out["db_path"] = credits_config.db_path()
    out["backend"] = "sqlite"
    return out


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    return uuid.uuid4().hex


@contextmanager
def _conn() -> Iterator[sqlite3.Connection]:
    """Read-path connection (auto-commit-on-exit). Mutations use _apply()'s own
    explicit BEGIN IMMEDIATE transaction instead."""
    c = sqlite3.connect(credits_config.db_path(), timeout=10)
    try:
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA journal_mode = WAL")
        yield c
        c.commit()
    finally:
        c.close()


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
            with _conn() as c:
                c.executescript(_SCHEMA)
            _INITIALIZED = True
            logger.info("billing.credits.store_sqlite initialized | db=%s", credits_config.db_path())
        except Exception as e:
            logger.warning("billing.credits.store_sqlite.init failed: %s", e)
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
    try:
        v = json.loads(raw)
        return v if isinstance(v, dict) else {}
    except Exception:
        return {}


def _row_to_txn(row: sqlite3.Row) -> CreditTransaction:
    return CreditTransaction(
        id=row["id"], user_id=row["user_id"], type=row["type"],
        amount=int(row["amount"]), balance_after=int(row["balance_after"]),
        reason=row["reason"] or "", reference=row["reference"],
        metadata=_safe_json(row["metadata_json"]), created_at=row["created_at"],
    )


# ── Reads ────────────────────────────────────────────────────────────────────

def get_account(user_id: str) -> CreditAccount:
    """Fetch the account row. A MISSING row is a legitimate zero-balance account
    (balance 0). An OPERATIONAL failure fails closed as `CreditStoreUnavailable`
    — it must never be flattened into a fake zero balance that a caller could
    mistake for a real empty account."""
    uid = str(user_id)
    try:
        _ensure_init()
        with _conn() as c:
            row = c.execute(
                "SELECT * FROM billing_credit_accounts WHERE user_id=?", (uid,)
            ).fetchone()
        _bump("reads")
        if row is None:
            return CreditAccount(user_id=uid, balance=0)
        return CreditAccount(
            user_id=row["user_id"], balance=int(row["balance"]),
            created_at=row["created_at"], updated_at=row["updated_at"],
        )
    except CreditStoreError:
        raise
    except Exception as e:
        logger.warning("billing.credits.store_sqlite.get_account error: %s", type(e).__name__)
        _bump("reads", type(e).__name__)
        raise CreditStoreUnavailable("credit account read failed") from e


def get_balance(user_id: str) -> int:
    return get_account(user_id).balance


def get_by_reference(user_id: str, reference: str) -> Optional[CreditTransaction]:
    """Look up a transaction by `(user_id, reference)`. A missing reference is a
    legitimate `None`; an OPERATIONAL failure fails closed as
    `CreditStoreUnavailable` (never a silent `None` that hides a store outage)."""
    if not reference:
        return None
    try:
        _ensure_init()
        with _conn() as c:
            row = c.execute(
                "SELECT * FROM billing_credit_transactions WHERE user_id=? AND reference=?",
                (str(user_id), str(reference)),
            ).fetchone()
        return _row_to_txn(row) if row else None
    except CreditStoreError:
        raise
    except Exception as e:
        logger.warning("billing.credits.store_sqlite.get_by_reference error: %s", type(e).__name__)
        _bump("reads", type(e).__name__)
        raise CreditStoreUnavailable("credit reference read failed") from e


def list_transactions(user_id: str, *, limit: int = 50, offset: int = 0) -> List[CreditTransaction]:
    try:
        _ensure_init()
        with _conn() as c:
            rows = c.execute(
                "SELECT * FROM billing_credit_transactions WHERE user_id=? "
                "ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
                (str(user_id), int(max(1, min(500, limit))), int(max(0, offset))),
            ).fetchall()
        _bump("reads")
        return [_row_to_txn(r) for r in rows]
    except CreditStoreError:
        raise
    except Exception as e:
        logger.warning("billing.credits.store_sqlite.list_transactions error: %s", type(e).__name__)
        _bump("reads", type(e).__name__)
        raise CreditStoreUnavailable("credit transactions read failed") from e


def sum_ledger(user_id: str) -> int:
    """Independent recomputation of the balance from the immutable ledger — the
    audit cross-check against the cached account balance."""
    try:
        _ensure_init()
        with _conn() as c:
            row = c.execute(
                "SELECT COALESCE(SUM(amount), 0) AS s FROM billing_credit_transactions WHERE user_id=?",
                (str(user_id),),
            ).fetchone()
        return int(row["s"] or 0) if row else 0
    except CreditStoreError:
        raise
    except Exception as e:
        logger.warning("billing.credits.store_sqlite.sum_ledger error: %s", type(e).__name__)
        _bump("reads", type(e).__name__)
        raise CreditStoreUnavailable("credit ledger sum failed") from e


# ── Atomic append ─────────────────────────────────────────────────────────────

def apply(
    *, user_id: str, delta: int, type: str, reason: str = "",
    reference: Optional[str] = None, metadata: Optional[dict] = None,
    allow_negative: bool = False,
) -> TxnResult:
    """Append one immutable ledger entry atomically and update the cached
    balance. `delta` is the SIGNED change. Rejects an overdrawing consume
    (delta<0 driving balance below zero) unless allow_negative.

    Idempotent by (user_id, reference) when reference is provided: an identical
    retry (same type/amount/reason/metadata) returns the ORIGINAL transaction
    and does NOT append; a reuse of the same reference with a DIFFERENT
    immutable payload is rejected as REASON_CONFLICT (no append, no balance
    change, original never mutated). An operational failure fails closed as
    `CreditStoreUnavailable`."""
    uid = str(user_id)
    now = _now()
    ref = str(reference) if reference else None
    try:
        _ensure_init()
    except CreditStoreError:
        raise
    except Exception as e:  # pragma: no cover — init guards its own errors
        logger.warning("billing.credits.store_sqlite.apply init error: %s", type(e).__name__)
        raise CreditStoreUnavailable("credit store init failed") from e
    con = sqlite3.connect(credits_config.db_path(), timeout=10)
    con.row_factory = sqlite3.Row
    try:
        con.execute("PRAGMA journal_mode = WAL")
        # BEGIN IMMEDIATE takes the write lock now, so concurrent applies on any
        # account serialise — no lost updates, no stale-read races. The
        # reference lookup below therefore already sees every committed prior
        # writer's row (identical conflict semantics to the Postgres path).
        con.execute("BEGIN IMMEDIATE")

        # Idempotency: a prior entry with the same reference wins; do not append
        # a second one. Compare the immutable payload so a same-reference reuse
        # with a DIFFERENT operation is a conflict, not a false success.
        if ref:
            prior = con.execute(
                "SELECT * FROM billing_credit_transactions WHERE user_id=? AND reference=?",
                (uid, ref),
            ).fetchone()
            if prior is not None:
                bal_row = con.execute(
                    "SELECT balance FROM billing_credit_accounts WHERE user_id=?", (uid,)
                ).fetchone()
                con.execute("ROLLBACK")
                balance = int(bal_row["balance"]) if bal_row else int(prior["balance_after"])
                return _resolve_prior(prior, balance, type, int(delta), reason, metadata)

        con.execute(
            "INSERT OR IGNORE INTO billing_credit_accounts (user_id, balance, created_at, updated_at) "
            "VALUES (?, 0, ?, ?)", (uid, now, now),
        )
        bal_row = con.execute(
            "SELECT balance FROM billing_credit_accounts WHERE user_id=?", (uid,)
        ).fetchone()
        balance = int(bal_row["balance"]) if bal_row else 0
        new_balance = balance + int(delta)

        if int(delta) < 0 and new_balance < 0 and not allow_negative:
            con.execute("ROLLBACK")
            _bump("insufficient")
            return TxnResult(
                applied=False, reason_code=REASON_INSUFFICIENT,
                balance=balance, idempotent=False, transaction=None,
            )

        tid = _new_id()
        md = credit_errors.canonical_metadata(metadata)
        con.execute(
            "INSERT INTO billing_credit_transactions "
            "(id, user_id, type, amount, balance_after, reason, reference, metadata_json, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (tid, uid, type, int(delta), new_balance, reason or "", ref, md, now),
        )
        con.execute(
            "UPDATE billing_credit_accounts SET balance=?, updated_at=? WHERE user_id=?",
            (new_balance, now, uid),
        )
        con.execute("COMMIT")
        _bump("appends")
        txn = CreditTransaction(
            id=tid, user_id=uid, type=type, amount=int(delta), balance_after=new_balance,
            reason=reason or "", reference=ref, metadata=metadata or {}, created_at=now,
        )
        return TxnResult(applied=True, reason_code=REASON_APPLIED, balance=new_balance,
                         idempotent=False, transaction=txn)
    except CreditStoreError:
        try:
            con.execute("ROLLBACK")
        except Exception:  # pragma: no cover
            pass
        raise
    except Exception as e:
        try:
            con.execute("ROLLBACK")
        except Exception:  # pragma: no cover
            pass
        logger.warning("billing.credits.store_sqlite.apply error: %s", type(e).__name__)
        _bump("appends", type(e).__name__)
        raise CreditStoreUnavailable("credit apply failed") from e
    finally:
        con.close()


def _resolve_prior(
    prior, balance: int, new_type: str, new_delta: int,
    reason: str, metadata: Optional[dict],
) -> TxnResult:
    """Given an existing transaction for the same `(user_id, reference)`, decide
    the deterministic outcome: an identical payload is an idempotent no-op (the
    original transaction is returned, never mutated); a divergent payload is a
    REASON_CONFLICT rejection. Balance is unchanged in both cases."""
    if credit_errors.payload_conflict(
        prior_type=prior["type"], prior_amount=prior["amount"],
        prior_reason=prior["reason"], prior_metadata_raw=prior["metadata_json"],
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


def table_counts() -> dict:
    out = {"accounts": 0, "transactions": 0}
    try:
        _ensure_init()
        with _conn() as c:
            out["accounts"] = int(c.execute("SELECT COUNT(*) AS n FROM billing_credit_accounts").fetchone()["n"] or 0)
            out["transactions"] = int(c.execute("SELECT COUNT(*) AS n FROM billing_credit_transactions").fetchone()["n"] or 0)
    except Exception:
        pass
    return out


__all__ = [
    "init", "_reset_for_tests",
    "get_account", "get_balance", "get_by_reference", "list_transactions",
    "sum_ledger", "apply", "table_counts", "store_stats",
]
