# coding: utf-8
"""Phase 1 — shared SQLite connection helper for the orchestrator trio.

WHY THIS MODULE EXISTS
----------------------
The three orchestrator stores — `runs_store`, `tasks_store`,
`deliverables_store` — historically each rolled their own connection:

    c = sqlite3.connect(DB_PATH, timeout=10)
    c.row_factory = sqlite3.Row
    yield c
    c.commit()

That pattern had two concrete durability defects (Phase 1 audit):

  1. No `PRAGMA journal_mode=WAL` and no `busy_timeout`. Under the default
     rollback journal a reader blocks writers and a concurrent writer gets
     an immediate `database is locked` instead of waiting. WAL + a busy
     timeout is what every *other* durable store in this repo already does
     (jobs, workflows, cost_tracking, ai_guard).

  2. Read-modify-write sequences (SELECT metadata_json → merge in Python →
     UPDATE; version = version + 1) ran under SQLite's *deferred* isolation,
     so the write lock was taken only at the UPDATE. Two writers could both
     read the old row, both merge, and the later COMMIT clobbered the
     other's metadata / lost a version bump. This is the classic
     lost-update hazard.

This helper is NOT a new database abstraction. Paths still resolve through
`backend.core.paths.resolve_db_path`; the backend is still stdlib `sqlite3`.
It is a single, shared *connection factory* + a `writer_tx()` context
manager that takes the write lock up-front (`BEGIN IMMEDIATE`) so the three
stores stop copy-pasting divergent PRAGMA setups and get lost-update-safe
mutations for free. ai_guard's store already uses exactly this
`isolation_level=None` + `BEGIN IMMEDIATE` pattern — this generalises it.

Backward compatibility: WAL and busy_timeout are pure hardening (no schema
change, no behavioural change for a single writer). `writer_tx()` only
wraps the handful of read-modify-write helpers; plain single-statement
inserts/reads keep autocommit semantics identical to before.
"""
from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from typing import Iterator

# Match the busy timeout the other durable stores use (cost_tracking,
# ai_guard both set 15000ms). A writer that finds the DB momentarily
# locked waits up to this long before raising, instead of failing fast.
_BUSY_TIMEOUT_MS = 15000
# Connection-level timeout (seconds) — how long sqlite's own C layer waits
# on the file lock. Kept >= the busy_timeout window.
_CONNECT_TIMEOUT_S = 15.0


def connect(db_path: str) -> sqlite3.Connection:
    """Open a hardened connection: Row factory, WAL, busy_timeout,
    foreign_keys, and autocommit (`isolation_level=None`).

    Autocommit is deliberate: it hands transaction control to the caller.
    Single-statement writes commit immediately (identical to the old
    `yield; commit()` for one statement); multi-statement read-modify-write
    goes through `writer_tx()` which brackets it in `BEGIN IMMEDIATE` /
    `COMMIT`.

    PRAGMA failures are swallowed — a filesystem that rejects WAL (rare;
    some network mounts) must degrade to the legacy journal rather than
    make the store unusable.
    """
    c = sqlite3.connect(db_path, timeout=_CONNECT_TIMEOUT_S, isolation_level=None)
    c.row_factory = sqlite3.Row
    try:
        c.execute("PRAGMA journal_mode=WAL")
        c.execute(f"PRAGMA busy_timeout={_BUSY_TIMEOUT_MS}")
        c.execute("PRAGMA foreign_keys=ON")
    except sqlite3.Error:  # pragma: no cover — platform/mount dependent
        pass
    return c


@contextmanager
def connection(db_path: str) -> Iterator[sqlite3.Connection]:
    """Hardened connection for reads and single-statement writes.

    In autocommit mode each executed statement is durable on return, so
    there is nothing to commit at the end — the connection is simply
    closed. Semantically identical to the legacy `_conn()` for the
    single-statement inserts/reads that use it.
    """
    c = connect(db_path)
    try:
        yield c
    finally:
        c.close()


@contextmanager
def writer_tx(db_path: str) -> Iterator[sqlite3.Connection]:
    """Atomic read-modify-write transaction.

    `BEGIN IMMEDIATE` acquires the RESERVED write lock *before* the first
    read, so a concurrent writer is serialised behind us (it waits out the
    busy_timeout) instead of interleaving between our SELECT and UPDATE.
    This closes the lost-update window on metadata merges and version
    bumps. Commits on clean exit, rolls back on any exception.
    """
    c = connect(db_path)
    try:
        c.execute("BEGIN IMMEDIATE")
        try:
            yield c
            c.execute("COMMIT")
        except BaseException:
            try:
                c.execute("ROLLBACK")
            except sqlite3.Error:  # pragma: no cover — best-effort rollback
                pass
            raise
    finally:
        c.close()


__all__ = ["connect", "connection", "writer_tx"]
