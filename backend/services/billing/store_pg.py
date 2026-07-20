# coding: utf-8
"""
Billing — webhook inbox Postgres adapter (PR 1).

Mirror of `store_sqlite.py` against Postgres via psycopg3 sync. The public
function signatures match line-for-line so the dispatcher in `store.py`
routes to either backend without per-call shape-checking (same contract the
memory_plane store_pg / store_sqlite pair follows).

Schema is intentionally identical to the SQLite shape (TEXT ids, ISO-8601
TEXT timestamps, JSON text payload) so rows copy 1:1 across backends and the
dispatcher stays transparent. Idempotency uses the same UNIQUE(provider,
dedup_key) constraint + INSERT … ON CONFLICT DO NOTHING; Postgres reports
whether a row was actually inserted via RETURNING.

Errors:
  * NEVER raises on transient DB errors — logs, bumps a counter, returns the
    empty value (mirroring SQLite).
  * DOES raise DBConfigError / DBUnavailable so the dispatcher can fall back
    to SQLite (unless strict mode is on).
  * DOES raise ValueError on programmer-level mistakes (no dedup_key).
"""
from __future__ import annotations

import logging
import threading
import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional, Tuple

from backend.services.db import engine
from backend.services.db.errors import DBConfigError, DBUnavailable
from backend.services.billing.types import (
    DEFAULT_PROVIDER, STATUS_STORED, STATUS_PROCESSING, STATUS_PROCESSED,
    STATUS_FAILED, VALID_STATUSES, REPROCESSABLE_STATUSES, WebhookEvent,
)


# Reprocessable statuses as a stable, ordered tuple for building parameterised
# SQL IN clauses. Trusted module constants, never user input.
_REPROCESSABLE = tuple(sorted(REPROCESSABLE_STATUSES))


logger = logging.getLogger(__name__)


# ── Counters (parity with store_sqlite) ──────────────────────────────────────

_LOCK = threading.Lock()
_COUNTS: dict[str, object] = {
    "inserts":     0,
    "duplicates":  0,
    "reads":       0,
    "transitions": 0,
    "errors":      0,
    "last_error":  "",
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


def _row_to_event(row) -> WebhookEvent:
    return WebhookEvent(
        id=               row["id"],
        provider=         row["provider"],
        event_name=       row["event_name"],
        resource_type=    row["resource_type"],
        resource_id=      row["resource_id"],
        dedup_key=        row["dedup_key"],
        signature=        row["signature"],
        payload_json=     row["payload_json"],
        status=           row["status"],
        processing_error= row["processing_error"],
        attempts=         int(row["attempts"] if row["attempts"] is not None else 0),
        received_at=      row["received_at"],
        processed_at=     row["processed_at"],
        created_at=       row["created_at"],
        updated_at=       row["updated_at"],
    )


# ── Schema (idempotent) ──────────────────────────────────────────────────────

_SCHEMA = """
CREATE TABLE IF NOT EXISTS billing_webhook_events (
    id               TEXT PRIMARY KEY,
    provider         TEXT NOT NULL DEFAULT 'lemon_squeezy',
    event_name       TEXT NOT NULL DEFAULT '',
    resource_type    TEXT,
    resource_id      TEXT,
    dedup_key        TEXT NOT NULL,
    signature        TEXT,
    payload_json     TEXT NOT NULL DEFAULT '{}',
    status           TEXT NOT NULL DEFAULT 'stored',
    processing_error TEXT,
    attempts         INTEGER NOT NULL DEFAULT 0,
    received_at      TEXT NOT NULL,
    processed_at     TEXT,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_billing_wh_dedup
    ON billing_webhook_events(provider, dedup_key);
CREATE INDEX IF NOT EXISTS ix_billing_wh_status
    ON billing_webhook_events(status);
CREATE INDEX IF NOT EXISTS ix_billing_wh_event_name
    ON billing_webhook_events(event_name);
CREATE INDEX IF NOT EXISTS ix_billing_wh_received
    ON billing_webhook_events(received_at DESC);
CREATE INDEX IF NOT EXISTS ix_billing_wh_resource
    ON billing_webhook_events(provider, resource_type, resource_id);
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
            logger.info("billing.store_pg initialized")
        except (DBConfigError, DBUnavailable):
            raise
        except Exception as e:
            logger.warning("billing.store_pg.init failed: %s", e)
            _bump("init_failed", str(e))


def _ensure_init() -> None:
    if not _INITIALIZED:
        init()


def _reset_for_tests() -> None:
    global _INITIALIZED
    with _LOCK:
        _INITIALIZED = False


# ══════════════════════════════════════════════════════════════════════════════
# Writes
# ══════════════════════════════════════════════════════════════════════════════

def insert_idempotent(event: WebhookEvent) -> Tuple[bool, WebhookEvent]:
    _ensure_init()
    if not event.dedup_key or not str(event.dedup_key).strip():
        raise ValueError("billing.insert: dedup_key is required")

    provider = (event.provider or DEFAULT_PROVIDER).strip() or DEFAULT_PROVIDER
    dedup_key = str(event.dedup_key).strip()
    rid = _new_id()
    now = _now()
    status = event.status if event.status in VALID_STATUSES else STATUS_STORED

    try:
        with engine.acquire_sync() as conn:
            with conn.cursor() as cur:
                # RETURNING id yields a row ONLY when the insert actually
                # happened; a conflict returns no rows → duplicate path.
                cur.execute(
                    "INSERT INTO billing_webhook_events "
                    "(id, provider, event_name, resource_type, resource_id, dedup_key, "
                    " signature, payload_json, status, processing_error, attempts, "
                    " received_at, processed_at, created_at, updated_at) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) "
                    "ON CONFLICT (provider, dedup_key) DO NOTHING "
                    "RETURNING id",
                    (
                        rid, provider, (event.event_name or "").strip(),
                        event.resource_type, event.resource_id, dedup_key,
                        event.signature, event.payload_json or "{}", status,
                        None, 0, now, None, now, now,
                    ),
                )
                inserted_row = cur.fetchone()
            conn.commit()

        if inserted_row is not None:
            _bump("inserts")
            return True, WebhookEvent(
                id=rid, provider=provider, event_name=(event.event_name or "").strip(),
                resource_type=event.resource_type, resource_id=event.resource_id,
                dedup_key=dedup_key, signature=event.signature,
                payload_json=event.payload_json or "{}", status=status,
                processing_error=None, attempts=0,
                received_at=now, processed_at=None, created_at=now, updated_at=now,
            )

        _bump("duplicates")
        existing = get_by_dedup(provider, dedup_key)
        if existing is not None:
            return False, existing
        return False, WebhookEvent(
            id=None, provider=provider, dedup_key=dedup_key,
            event_name=(event.event_name or "").strip(), status=STATUS_STORED,
        )
    except (DBConfigError, DBUnavailable):
        raise
    except ValueError:
        raise
    except Exception as e:
        logger.warning("billing.store_pg.insert_idempotent error: %s", e)
        _bump("inserts", str(e))
        raise


def _transition(
    event_id: str,
    *,
    status: str,
    processing_error: Optional[str] = None,
    set_processed_at: bool = False,
    bump_attempts: bool = False,
) -> bool:
    _ensure_init()
    if not event_id or status not in VALID_STATUSES:
        return False
    now = _now()
    sets = ["status=%s", "updated_at=%s", "processing_error=%s"]
    params: list = [status, now, processing_error[:1000] if processing_error else None]
    if bump_attempts:
        sets.append("attempts=attempts+1")
    if set_processed_at:
        sets.append("processed_at=%s")
        params.append(now)
    params.append(event_id)
    sql = f"UPDATE billing_webhook_events SET {', '.join(sets)} WHERE id=%s"
    try:
        with engine.acquire_sync() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, tuple(params))
                ok = cur.rowcount > 0
            conn.commit()
        if ok:
            _bump("transitions")
        return ok
    except (DBConfigError, DBUnavailable):
        raise
    except Exception as e:
        logger.warning("billing.store_pg._transition id=%s error: %s", event_id, e)
        _bump("transitions", str(e))
        return False


def mark_processing(event_id: str) -> bool:
    return _transition(event_id, status=STATUS_PROCESSING, bump_attempts=True)


def mark_processed(event_id: str) -> bool:
    return _transition(event_id, status=STATUS_PROCESSED, set_processed_at=True)


def mark_failed(event_id: str, error: str) -> bool:
    return _transition(event_id, status=STATUS_FAILED, processing_error=error)


# ══════════════════════════════════════════════════════════════════════════════
# Reads
# ══════════════════════════════════════════════════════════════════════════════

def get(event_id: str) -> Optional[WebhookEvent]:
    _ensure_init()
    if not event_id:
        return None
    try:
        with engine.acquire_sync() as conn:
            with _dict_cursor(conn) as cur:
                cur.execute(
                    "SELECT * FROM billing_webhook_events WHERE id=%s",
                    (event_id,),
                )
                row = cur.fetchone()
        if row is None:
            return None
        _bump("reads")
        return _row_to_event(row)
    except (DBConfigError, DBUnavailable):
        raise
    except Exception as e:
        logger.warning("billing.store_pg.get id=%s error: %s", event_id, e)
        _bump("reads", str(e))
        return None


def get_by_dedup(provider: str, dedup_key: str) -> Optional[WebhookEvent]:
    _ensure_init()
    if not dedup_key:
        return None
    try:
        with engine.acquire_sync() as conn:
            with _dict_cursor(conn) as cur:
                cur.execute(
                    "SELECT * FROM billing_webhook_events "
                    "WHERE provider=%s AND dedup_key=%s",
                    (provider or DEFAULT_PROVIDER, dedup_key),
                )
                row = cur.fetchone()
        if row is None:
            return None
        return _row_to_event(row)
    except (DBConfigError, DBUnavailable):
        raise
    except Exception as e:
        logger.warning("billing.store_pg.get_by_dedup error: %s", e)
        _bump("reads", str(e))
        return None


def list_events(
    *,
    limit: int = 50,
    offset: int = 0,
    status: Optional[str] = None,
    event_name: Optional[str] = None,
    provider: Optional[str] = None,
) -> List[WebhookEvent]:
    _ensure_init()
    sql = "SELECT * FROM billing_webhook_events WHERE 1=1"
    params: list = []
    if provider:
        sql += " AND provider=%s"
        params.append(provider)
    if status:
        sql += " AND status=%s"
        params.append(status)
    if event_name:
        sql += " AND event_name=%s"
        params.append(event_name)
    sql += " ORDER BY received_at DESC, id DESC LIMIT %s OFFSET %s"
    params.extend([int(max(1, min(500, limit))), int(max(0, offset))])
    try:
        with engine.acquire_sync() as conn:
            with _dict_cursor(conn) as cur:
                cur.execute(sql, tuple(params))
                rows = cur.fetchall()
        _bump("reads")
        return [_row_to_event(r) for r in rows]
    except (DBConfigError, DBUnavailable):
        raise
    except Exception as e:
        logger.warning("billing.store_pg.list_events error: %s", e)
        _bump("reads", str(e))
        return []


# ══════════════════════════════════════════════════════════════════════════════
# Diagnostics aggregates
# ══════════════════════════════════════════════════════════════════════════════

def stats() -> dict:
    out: dict = {"total": 0, "by_status": {}, "by_event_name": {}}
    try:
        _ensure_init()
        with engine.acquire_sync() as conn:
            with _dict_cursor(conn) as cur:
                cur.execute("SELECT COUNT(*) AS n FROM billing_webhook_events")
                total = cur.fetchone()
                out["total"] = int((total or {}).get("n") or 0)
                cur.execute(
                    "SELECT status, COUNT(*) AS n FROM billing_webhook_events "
                    "GROUP BY status ORDER BY n DESC"
                )
                for r in cur.fetchall():
                    out["by_status"][r["status"]] = int(r["n"] or 0)
                cur.execute(
                    "SELECT event_name, COUNT(*) AS n FROM billing_webhook_events "
                    "GROUP BY event_name ORDER BY n DESC LIMIT 25"
                )
                for r in cur.fetchall():
                    key = r["event_name"] if r["event_name"] else "(unknown)"
                    out["by_event_name"][key] = int(r["n"] or 0)
    except (DBConfigError, DBUnavailable):
        raise
    except Exception as e:
        logger.warning("billing.store_pg.stats error: %s", e)
    return out


def table_counts() -> dict:
    out = {"total": 0}
    try:
        _ensure_init()
        with engine.acquire_sync() as conn:
            with _dict_cursor(conn) as cur:
                cur.execute("SELECT COUNT(*) AS n FROM billing_webhook_events")
                row = cur.fetchone()
        if row:
            out["total"] = int(row["n"] or 0)
    except Exception:
        pass
    return out


# ══════════════════════════════════════════════════════════════════════════════
# Consumer support (PR 2) — atomic claim, reprocessable queue, stale reclaim
# ══════════════════════════════════════════════════════════════════════════════
#
# Line-for-line parity with store_sqlite so the dispatcher routes to either
# backend transparently. The claim UPDATE is atomic in Postgres too — the row
# lock the UPDATE takes serialises competing claims, and RETURNING id tells us
# whether THIS statement won.

def claim_for_processing(event_id: str, *, max_attempts: int) -> Optional[WebhookEvent]:
    """Atomically claim a reprocessable event for processing. Returns the
    claimed event (status=processing) on success, else None (concurrent claim,
    already processed, or dead-lettered)."""
    _ensure_init()
    if not event_id:
        return None
    cap = int(max_attempts) if max_attempts and int(max_attempts) > 0 else 1
    now = _now()
    placeholders = ",".join(["%s"] * len(_REPROCESSABLE))
    sql = (
        "UPDATE billing_webhook_events "
        "SET status=%s, attempts=attempts+1, processing_error=NULL, updated_at=%s "
        f"WHERE id=%s AND status IN ({placeholders}) AND attempts < %s "
        "RETURNING id"
    )
    params = [STATUS_PROCESSING, now, event_id, *_REPROCESSABLE, cap]
    try:
        with engine.acquire_sync() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, tuple(params))
                won = cur.fetchone() is not None
            conn.commit()
        if not won:
            return None
        _bump("transitions")
        return get(event_id)
    except (DBConfigError, DBUnavailable):
        raise
    except Exception as e:
        logger.warning("billing.store_pg.claim_for_processing id=%s error: %s", event_id, e)
        _bump("transitions", str(e))
        return None


def list_reprocessable(*, limit: int = 100, max_attempts: int) -> List[WebhookEvent]:
    """Oldest-first list of events eligible for processing. Bounded limit."""
    _ensure_init()
    cap = int(max_attempts) if max_attempts and int(max_attempts) > 0 else 1
    placeholders = ",".join(["%s"] * len(_REPROCESSABLE))
    sql = (
        "SELECT * FROM billing_webhook_events "
        f"WHERE status IN ({placeholders}) AND attempts < %s "
        "ORDER BY received_at ASC, id ASC LIMIT %s"
    )
    params = [*_REPROCESSABLE, cap, int(max(1, min(1000, limit)))]
    try:
        with engine.acquire_sync() as conn:
            with _dict_cursor(conn) as cur:
                cur.execute(sql, tuple(params))
                rows = cur.fetchall()
        _bump("reads")
        return [_row_to_event(r) for r in rows]
    except (DBConfigError, DBUnavailable):
        raise
    except Exception as e:
        logger.warning("billing.store_pg.list_reprocessable error: %s", e)
        _bump("reads", str(e))
        return []


def count_dead_letter(*, max_attempts: int) -> int:
    """Count failed events that have exhausted the attempt cap (dead-letter)."""
    _ensure_init()
    cap = int(max_attempts) if max_attempts and int(max_attempts) > 0 else 1
    try:
        with engine.acquire_sync() as conn:
            with _dict_cursor(conn) as cur:
                cur.execute(
                    "SELECT COUNT(*) AS n FROM billing_webhook_events "
                    "WHERE status=%s AND attempts >= %s",
                    (STATUS_FAILED, cap),
                )
                row = cur.fetchone()
        return int((row or {}).get("n") or 0)
    except (DBConfigError, DBUnavailable):
        raise
    except Exception as e:
        logger.warning("billing.store_pg.count_dead_letter error: %s", e)
        return 0


def requeue(event_id: str) -> bool:
    """Force an event back into the reprocessable queue (owner-initiated
    retry / replay). Resets status→stored, attempts→0, clears error +
    processed_at. Unconditional by design. Returns True when a row updated."""
    _ensure_init()
    if not event_id:
        return False
    now = _now()
    try:
        with engine.acquire_sync() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE billing_webhook_events "
                    "SET status=%s, attempts=0, processing_error=NULL, processed_at=NULL, updated_at=%s "
                    "WHERE id=%s",
                    (STATUS_STORED, now, event_id),
                )
                ok = cur.rowcount > 0
            conn.commit()
        if ok:
            _bump("transitions")
        return ok
    except (DBConfigError, DBUnavailable):
        raise
    except Exception as e:
        logger.warning("billing.store_pg.requeue id=%s error: %s", event_id, e)
        _bump("transitions", str(e))
        return False


def reclaim_stale_processing(*, older_than_seconds: int) -> int:
    """Move events stuck in `processing` past the staleness threshold back to
    `failed` so they re-enter the reprocessable queue. Returns count reclaimed."""
    _ensure_init()
    cutoff = (datetime.now(timezone.utc)
              - timedelta(seconds=max(1, int(older_than_seconds)))).isoformat()
    now = _now()
    try:
        with engine.acquire_sync() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE billing_webhook_events "
                    "SET status=%s, processing_error=%s, updated_at=%s "
                    "WHERE status=%s AND updated_at < %s",
                    (STATUS_FAILED, "reclaimed_stale_processing", now,
                     STATUS_PROCESSING, cutoff),
                )
                n = cur.rowcount
            conn.commit()
        if n:
            _bump("transitions")
        return int(n)
    except (DBConfigError, DBUnavailable):
        raise
    except Exception as e:
        logger.warning("billing.store_pg.reclaim_stale_processing error: %s", e)
        _bump("transitions", str(e))
        return 0


__all__ = [
    "init", "_reset_for_tests",
    "insert_idempotent", "mark_processing", "mark_processed", "mark_failed",
    "get", "get_by_dedup", "list_events",
    "claim_for_processing", "list_reprocessable", "count_dead_letter",
    "reclaim_stale_processing", "requeue",
    "stats", "table_counts", "store_stats",
]
