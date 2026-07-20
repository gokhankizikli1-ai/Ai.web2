# coding: utf-8
"""
Billing — webhook inbox SQLite adapter (PR 1).

A NEW SQLite file (default `billing.db`, override via BILLING_DB_PATH), kept
SEPARATE from every other subsystem DB so the rollback path is clean:

    rm billing.db   # forgets the webhook inbox; nothing else moves

Design rules (mirroring backend.services.memory_plane.store_sqlite so the
two backends and the rest of the codebase read the same way):

  * TEXT primary key (uuid4 hex) + ISO-8601 UTC timestamps → ports onto
    Postgres without lossy conversions.
  * Idempotency via a UNIQUE(provider, dedup_key) index + INSERT … ON
    CONFLICT DO NOTHING. A duplicate delivery (Lemon Squeezy retrying the
    exact same bytes) is a no-op that resolves to the already-stored row.
  * Every function is non-raising on transient SQLite errors — it logs,
    bumps a counter and returns a sensible empty value. It raises only for
    programmer-level mistakes (inserting without a dedup_key).
  * `payload_json` is the VERIFIED raw body. The store never sees an
    unverified payload — the route verifies the signature first.
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
from backend.services.billing.types import (
    DEFAULT_PROVIDER, STATUS_STORED, STATUS_PROCESSING, STATUS_PROCESSED,
    STATUS_FAILED, VALID_STATUSES, WebhookEvent,
)


logger = logging.getLogger(__name__)


# ── Observability counters ───────────────────────────────────────────────────

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
    out["db_path"] = billing_config.db_path()
    out["backend"] = "sqlite"
    return out


# ── Time + id helpers ────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    return uuid.uuid4().hex


# ── Connection management ────────────────────────────────────────────────────

@contextmanager
def _conn() -> Iterator[sqlite3.Connection]:
    """One connection per call — read the db path dynamically so tests can
    monkeypatch BILLING_DB_PATH between cases (mirrors memory_plane)."""
    c = sqlite3.connect(billing_config.db_path(), timeout=10)
    try:
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA journal_mode = WAL")
        yield c
        c.commit()
    finally:
        c.close()


# ── Schema ───────────────────────────────────────────────────────────────────
#
# The UNIQUE(provider, dedup_key) index is the idempotency backbone. The
# status / event_name / received_at indexes serve the owner diagnostics
# list + stats queries.

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


_INITIALIZED: bool = False


def init() -> None:
    """Idempotent schema bootstrap. Safe to call repeatedly; every read /
    write triggers it lazily on first use."""
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
            logger.info("billing.store_sqlite initialized | db=%s", billing_config.db_path())
        except Exception as e:
            logger.warning("billing.store_sqlite.init failed: %s", e)
            _bump("init_failed", str(e))


def _ensure_init() -> None:
    if not _INITIALIZED:
        init()


def _reset_for_tests() -> None:
    global _INITIALIZED
    with _LOCK:
        _INITIALIZED = False


# ── Row mapping ──────────────────────────────────────────────────────────────

def _row_to_event(row: sqlite3.Row) -> WebhookEvent:
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


# ══════════════════════════════════════════════════════════════════════════════
# Writes
# ══════════════════════════════════════════════════════════════════════════════

def insert_idempotent(event: WebhookEvent) -> Tuple[bool, WebhookEvent]:
    """Persist a verified webhook delivery exactly once.

    Returns (inserted, stored):
      * inserted=True  → this call created the row (the returned event carries
                         the store-assigned id + timestamps).
      * inserted=False → a delivery with the same (provider, dedup_key)
                         already existed; `stored` is that pre-existing row.
                         This is the idempotent duplicate path (Lemon Squeezy
                         retry) and is NOT an error.

    Raises ValueError only on a programmer-level mistake (no dedup_key).
    """
    _ensure_init()
    if not event.dedup_key or not str(event.dedup_key).strip():
        raise ValueError("billing.insert: dedup_key is required")

    provider = (event.provider or DEFAULT_PROVIDER).strip() or DEFAULT_PROVIDER
    dedup_key = str(event.dedup_key).strip()
    rid = _new_id()
    now = _now()
    status = event.status if event.status in VALID_STATUSES else STATUS_STORED

    try:
        with _conn() as c:
            cur = c.execute(
                "INSERT INTO billing_webhook_events "
                "(id, provider, event_name, resource_type, resource_id, dedup_key, "
                " signature, payload_json, status, processing_error, attempts, "
                " received_at, processed_at, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(provider, dedup_key) DO NOTHING",
                (
                    rid, provider, (event.event_name or "").strip(),
                    event.resource_type, event.resource_id, dedup_key,
                    event.signature, event.payload_json or "{}", status,
                    None, 0, now, None, now, now,
                ),
            )
            inserted = cur.rowcount > 0

        if inserted:
            _bump("inserts")
            return True, WebhookEvent(
                id=rid, provider=provider, event_name=(event.event_name or "").strip(),
                resource_type=event.resource_type, resource_id=event.resource_id,
                dedup_key=dedup_key, signature=event.signature,
                payload_json=event.payload_json or "{}", status=status,
                processing_error=None, attempts=0,
                received_at=now, processed_at=None, created_at=now, updated_at=now,
            )

        # Conflict → fetch the row that won the race / arrived first.
        _bump("duplicates")
        existing = get_by_dedup(provider, dedup_key)
        if existing is not None:
            return False, existing
        # Extremely unlikely: conflict reported but row not readable. Return a
        # synthetic view so the caller still gets a stable "duplicate" answer.
        return False, WebhookEvent(
            id=None, provider=provider, dedup_key=dedup_key,
            event_name=(event.event_name or "").strip(), status=STATUS_STORED,
        )
    except ValueError:
        raise
    except Exception as e:
        logger.warning("billing.store_sqlite.insert_idempotent error: %s", e)
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
    """Shared lifecycle mutation used by mark_processing/processed/failed."""
    _ensure_init()
    if not event_id or status not in VALID_STATUSES:
        return False
    now = _now()
    sets = ["status=?", "updated_at=?"]
    params: list = [status, now]
    sets.append("processing_error=?")
    params.append(processing_error[:1000] if processing_error else None)
    if bump_attempts:
        sets.append("attempts=attempts+1")
    if set_processed_at:
        sets.append("processed_at=?")
        params.append(now)
    params.append(event_id)
    sql = f"UPDATE billing_webhook_events SET {', '.join(sets)} WHERE id=?"
    try:
        with _conn() as c:
            cur = c.execute(sql, params)
            ok = cur.rowcount > 0
        if ok:
            _bump("transitions")
        return ok
    except Exception as e:
        logger.warning("billing.store_sqlite._transition id=%s error: %s", event_id, e)
        _bump("transitions", str(e))
        return False


def mark_processing(event_id: str) -> bool:
    """Claim an event for processing (future consumer). Increments attempts."""
    return _transition(event_id, status=STATUS_PROCESSING, bump_attempts=True)


def mark_processed(event_id: str) -> bool:
    """Mark an event fully processed (future consumer)."""
    return _transition(event_id, status=STATUS_PROCESSED, set_processed_at=True)


def mark_failed(event_id: str, error: str) -> bool:
    """Mark a processing attempt failed; the event stays reprocessable."""
    return _transition(event_id, status=STATUS_FAILED, processing_error=error)


# ══════════════════════════════════════════════════════════════════════════════
# Reads
# ══════════════════════════════════════════════════════════════════════════════

def get(event_id: str) -> Optional[WebhookEvent]:
    _ensure_init()
    if not event_id:
        return None
    try:
        with _conn() as c:
            row = c.execute(
                "SELECT * FROM billing_webhook_events WHERE id=?",
                (event_id,),
            ).fetchone()
        if row is None:
            return None
        _bump("reads")
        return _row_to_event(row)
    except Exception as e:
        logger.warning("billing.store_sqlite.get id=%s error: %s", event_id, e)
        _bump("reads", str(e))
        return None


def get_by_dedup(provider: str, dedup_key: str) -> Optional[WebhookEvent]:
    _ensure_init()
    if not dedup_key:
        return None
    try:
        with _conn() as c:
            row = c.execute(
                "SELECT * FROM billing_webhook_events "
                "WHERE provider=? AND dedup_key=?",
                (provider or DEFAULT_PROVIDER, dedup_key),
            ).fetchone()
        if row is None:
            return None
        return _row_to_event(row)
    except Exception as e:
        logger.warning("billing.store_sqlite.get_by_dedup error: %s", e)
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
    """List events newest-first with optional status/event_name/provider
    filters. Bounded limit so a diagnostics call can never scan the table."""
    _ensure_init()
    sql = "SELECT * FROM billing_webhook_events WHERE 1=1"
    params: list = []
    if provider:
        sql += " AND provider=?"
        params.append(provider)
    if status:
        sql += " AND status=?"
        params.append(status)
    if event_name:
        sql += " AND event_name=?"
        params.append(event_name)
    sql += " ORDER BY received_at DESC, id DESC LIMIT ? OFFSET ?"
    params.extend([int(max(1, min(500, limit))), int(max(0, offset))])
    try:
        with _conn() as c:
            rows = c.execute(sql, params).fetchall()
        _bump("reads")
        return [_row_to_event(r) for r in rows]
    except Exception as e:
        logger.warning("billing.store_sqlite.list_events error: %s", e)
        _bump("reads", str(e))
        return []


# ══════════════════════════════════════════════════════════════════════════════
# Diagnostics aggregates
# ══════════════════════════════════════════════════════════════════════════════

def stats() -> dict:
    """Owner-diagnostics aggregate: totals, counts by status, top event
    names. Cheap, index-backed, content-free."""
    out: dict = {"total": 0, "by_status": {}, "by_event_name": {}}
    try:
        _ensure_init()
        with _conn() as c:
            total = c.execute("SELECT COUNT(*) AS n FROM billing_webhook_events").fetchone()
            out["total"] = int(total["n"] or 0) if total else 0
            for r in c.execute(
                "SELECT status, COUNT(*) AS n FROM billing_webhook_events "
                "GROUP BY status ORDER BY n DESC"
            ).fetchall():
                out["by_status"][r["status"]] = int(r["n"] or 0)
            for r in c.execute(
                "SELECT event_name, COUNT(*) AS n FROM billing_webhook_events "
                "GROUP BY event_name ORDER BY n DESC LIMIT 25"
            ).fetchall():
                key = r["event_name"] if r["event_name"] else "(unknown)"
                out["by_event_name"][key] = int(r["n"] or 0)
    except Exception as e:
        logger.warning("billing.store_sqlite.stats error: %s", e)
    return out


def table_counts() -> dict:
    out = {"total": 0}
    try:
        _ensure_init()
        with _conn() as c:
            row = c.execute("SELECT COUNT(*) AS n FROM billing_webhook_events").fetchone()
        if row is not None:
            out["total"] = int(row["n"] or 0)
    except Exception:
        pass
    return out


__all__ = [
    "init", "_reset_for_tests",
    "insert_idempotent", "mark_processing", "mark_processed", "mark_failed",
    "get", "get_by_dedup", "list_events",
    "stats", "table_counts", "store_stats",
]
