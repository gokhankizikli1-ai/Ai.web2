# coding: utf-8
"""Phase 3 (completion pass) — shared cross-replica step-dispatch claim.

THE ROOT ISSUE
--------------
Phase 4's stable idempotency key dedups a workflow step's job — but only
within ONE jobs store. On the default Railway topology every replica has its
own container filesystem, so each has its own `jobs.db`; the UNIQUE
idempotency index is per-file and two replicas can both dispatch (and pay
for) the same step.

THE FIX
-------
A single SHARED claim authority the runner consults before dispatching a
step. Whichever replica wins the atomic claim dispatches; the others attach
to the existing job (via the jobs idempotency index) instead of creating a
duplicate. This is the shared authority the multi-instance-safety gate
requires — not a new job engine, not a second idempotency framework.

BACKENDS (no new DB abstraction)
--------------------------------
  * Postgres — when `ENABLE_POSTGRES_BACKEND` + `DATABASE_URL` are set (the
    real multi-replica production answer). Uses the existing
    `backend.services.db.engine.acquire_sync()` psycopg3 pool. The claim
    table is genuinely shared across replicas.
  * SQLite  — otherwise. The table lives in the existing `projects.db`
    (hardened `_sqlite`, atomic BEGIN IMMEDIATE). Shared across replicas
    ONLY if that DB is on a shared/volume-backed path; single-node/dev
    otherwise. This keeps local development working with no Postgres.

STALENESS
---------
A claim carries a timestamp and is reclaimable after
`AI_OPERATION_LOCK_TTL_SECONDS` (reused; default 1800s), so a claim orphaned
by a crash-before-dispatch cannot deadlock a step forever. The jobs
idempotency index remains the second line of defence: even if two replicas
both (rarely) claim across the TTL boundary, a shared jobs store dedups the
create.
"""
from __future__ import annotations

import logging
import os
import time
from typing import Optional

from backend.core.paths import resolve_db_path
from backend.services.orchestrator import _sqlite

logger = logging.getLogger(__name__)

DB_PATH = resolve_db_path("projects.db", "PROJECTS_DB_PATH")

_SQLITE_SCHEMA = """
CREATE TABLE IF NOT EXISTS workflow_step_claims (
    key         TEXT PRIMARY KEY,
    owner       TEXT NOT NULL DEFAULT '',
    workflow_id TEXT,
    claimed_at  REAL NOT NULL
);
"""

_PG_SCHEMA = """
CREATE TABLE IF NOT EXISTS workflow_step_claims (
    key         TEXT PRIMARY KEY,
    owner       TEXT NOT NULL DEFAULT '',
    workflow_id TEXT,
    claimed_at  DOUBLE PRECISION NOT NULL
)
"""


def _ttl_seconds() -> int:
    try:
        return max(30, int(os.getenv("AI_OPERATION_LOCK_TTL_SECONDS", "1800") or 1800))
    except Exception:
        return 1800


def _use_postgres() -> bool:
    try:
        from backend.services.db import engine
        return bool(engine.is_enabled())
    except Exception:
        return False


# ── Postgres backend ─────────────────────────────────────────────────────

def _pg_try_claim(key: str, owner: str, workflow_id: Optional[str], now: float,
                  stale_before: float) -> bool:
    from backend.services.db import engine
    with engine.acquire_sync() as conn:
        with conn.cursor() as cur:
            cur.execute(_PG_SCHEMA)
            # Atomic: insert, or reclaim a stale row. RETURNING tells us
            # whether we now own it.
            cur.execute(
                """
                INSERT INTO workflow_step_claims (key, owner, workflow_id, claimed_at)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (key) DO UPDATE
                    SET owner = EXCLUDED.owner,
                        workflow_id = EXCLUDED.workflow_id,
                        claimed_at = EXCLUDED.claimed_at
                    WHERE workflow_step_claims.claimed_at < %s
                RETURNING key
                """,
                (key, owner, workflow_id, now, stale_before),
            )
            got = cur.fetchone()
            conn.commit()
            return got is not None


def _pg_release(key: str) -> None:
    from backend.services.db import engine
    with engine.acquire_sync() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM workflow_step_claims WHERE key=%s", (key,))
            conn.commit()


def _pg_is_claimed(key: str, stale_before: float) -> bool:
    from backend.services.db import engine
    with engine.acquire_sync() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM workflow_step_claims WHERE key=%s AND claimed_at>=%s",
                (key, stale_before),
            )
            return cur.fetchone() is not None


# ── SQLite backend ───────────────────────────────────────────────────────

def _sqlite_init() -> None:
    with _sqlite.connection(DB_PATH) as c:
        c.executescript(_SQLITE_SCHEMA)


def _sqlite_try_claim(key: str, owner: str, workflow_id: Optional[str], now: float,
                      stale_before: float) -> bool:
    _sqlite_init()
    with _sqlite.writer_tx(DB_PATH) as c:
        row = c.execute(
            "SELECT claimed_at FROM workflow_step_claims WHERE key=?", (key,),
        ).fetchone()
        if row is not None and float(row["claimed_at"]) >= stale_before:
            return False  # a fresh claim is held by someone else
        c.execute(
            "INSERT OR REPLACE INTO workflow_step_claims "
            "(key, owner, workflow_id, claimed_at) VALUES (?, ?, ?, ?)",
            (key, owner, workflow_id, now),
        )
        return True


def _sqlite_release(key: str) -> None:
    try:
        with _sqlite.connection(DB_PATH) as c:
            c.execute("DELETE FROM workflow_step_claims WHERE key=?", (key,))
    except Exception:
        pass


def _sqlite_is_claimed(key: str, stale_before: float) -> bool:
    try:
        with _sqlite.connection(DB_PATH) as c:
            row = c.execute(
                "SELECT claimed_at FROM workflow_step_claims WHERE key=?", (key,),
            ).fetchone()
        return bool(row is not None and float(row["claimed_at"]) >= stale_before)
    except Exception:
        return False


# ── Public surface ───────────────────────────────────────────────────────

def try_claim(key: str, *, owner: str = "", workflow_id: Optional[str] = None) -> bool:
    """Atomically acquire the shared dispatch claim for `key`.

    Returns True if THIS caller now owns the claim (proceed to dispatch),
    False if a fresh claim is held by another owner (do not double-dispatch).
    A claim older than the TTL is reclaimable. Fail-open on backend error
    (returns True) — a claim-store outage must not block execution; the jobs
    idempotency index still guards duplicate creates within a shared store."""
    if not key:
        return True
    now = time.time()
    stale_before = now - _ttl_seconds()
    try:
        if _use_postgres():
            return _pg_try_claim(key, owner or "", workflow_id, now, stale_before)
        return _sqlite_try_claim(key, owner or "", workflow_id, now, stale_before)
    except Exception as exc:
        logger.warning("step_claim.try_claim fail-open (%s): %s", key, exc)
        return True


def release(key: str) -> None:
    """Release a claim (best-effort). Called when a step reaches a terminal
    state so a re-run of the SAME logical step id can proceed cleanly."""
    if not key:
        return
    try:
        if _use_postgres():
            _pg_release(key)
        else:
            _sqlite_release(key)
    except Exception:  # pragma: no cover — best effort
        pass


def is_claimed(key: str) -> bool:
    """True if a FRESH (non-stale) claim exists for key."""
    if not key:
        return False
    stale_before = time.time() - _ttl_seconds()
    if _use_postgres():
        try:
            return _pg_is_claimed(key, stale_before)
        except Exception:
            return False
    return _sqlite_is_claimed(key, stale_before)


def backend() -> str:
    return "postgres" if _use_postgres() else "sqlite"


__all__ = ["try_claim", "release", "is_claimed", "backend"]
