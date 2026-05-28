# coding: utf-8
"""Phase 6 slice 2 — db_migrate CLI.

Operational helper for Railway. Three subcommands:

    python -m backend.scripts.db_migrate init
        Bootstrap every Postgres schema (idempotent CREATE TABLE +
        CREATE EXTENSION IF NOT EXISTS vector). Safe to re-run.

    python -m backend.scripts.db_migrate status
        Print row counts in BOTH backends so the operator can see how
        far the SQLite → Postgres migration has progressed.

    python -m backend.scripts.db_migrate copy --subsystem memory_plane
        Copy data from the SQLite subsystem store to Postgres. Idempotent
        per-row via ON CONFLICT (id) DO NOTHING — re-running is safe and
        only inserts missing rows. Streams in 1k-row batches so a large
        SQLite file doesn't blow memory.

Constraints:
  * The CLI NEVER deletes from SQLite. The operator decides when to
    retire the file once Postgres has been the source-of-truth for a
    while + backups confirm. This is the "dual-running" period.
  * The CLI is the only thing in the codebase that touches the
    pgvector extension at the moment — stores can run without it.
  * Exit codes: 0 ok, 1 user error (bad args), 2 environment error
    (Postgres unreachable / not enabled), 3 partial failure.

Operator runbook (Railway):
  $ railway run python -m backend.scripts.db_migrate init
  $ railway run python -m backend.scripts.db_migrate status
  $ railway run python -m backend.scripts.db_migrate copy --subsystem memory_plane
  $ railway run python -m backend.scripts.db_migrate status   # verify counts match
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from typing import Iterable, Optional

from backend.services.db import engine
from backend.services.db.errors import DBConfigError, DBUnavailable
from backend.services.db.pgvector import ensure_pgvector, is_pgvector_available


# Subsystems the CLI knows how to operate on. Adding a new one is a
# one-line addition here + a `_copy_<name>` helper.
KNOWN_SUBSYSTEMS = ("memory_plane",)


logger = logging.getLogger("db_migrate")


# ── init ───────────────────────────────────────────────────────────────────

def _cmd_init() -> int:
    """Bootstrap every known subsystem against Postgres + try to enable
    pgvector. Idempotent."""
    if not engine.is_enabled():
        print(
            "ERROR: Postgres backend disabled. "
            "Set DATABASE_URL and ENABLE_POSTGRES_BACKEND=true before running init.",
            file=sys.stderr,
        )
        return 2

    # pgvector — best-effort. If the managed host doesn't allow
    # CREATE EXTENSION, we surface the error but continue (the stores
    # use TEXT-encoded embeddings today; the vector column lands in a
    # future slice ALTER once vectors actually exist).
    try:
        pgv = asyncio.run(ensure_pgvector())
        print(f"[init] pgvector: {'enabled' if pgv else 'unavailable'}")
    except Exception as exc:
        print(f"[init] pgvector: skipped ({exc})", file=sys.stderr)

    # Each subsystem's init() is idempotent.
    for name in KNOWN_SUBSYSTEMS:
        try:
            _init_subsystem(name)
            print(f"[init] {name}: schema ready")
        except Exception as exc:
            print(f"[init] {name}: FAILED ({exc})", file=sys.stderr)
            return 3
    print("[init] done")
    return 0


def _init_subsystem(name: str) -> None:
    if name == "memory_plane":
        from backend.services.memory_plane import store_pg
        store_pg.init()
        return
    raise ValueError(f"unknown subsystem: {name}")


# ── status ─────────────────────────────────────────────────────────────────

def _cmd_status() -> int:
    print(f"Postgres enabled:  {engine.is_enabled()}")
    print(f"Current backend:   {engine.current_backend()}")
    try:
        pgv = asyncio.run(is_pgvector_available())
        print(f"pgvector available: {pgv}")
    except Exception as exc:
        print(f"pgvector probe: error ({exc})")

    for name in KNOWN_SUBSYSTEMS:
        print(f"\n── {name} ─────────────────────────────────")
        try:
            sqlite_c, pg_c = _subsystem_counts(name)
            print(f"  SQLite: total={sqlite_c['total']:>6} "
                  f"active={sqlite_c['active']:>6} deleted={sqlite_c['deleted']:>6}")
            print(f"  PG:     total={pg_c['total']:>6} "
                  f"active={pg_c['active']:>6} deleted={pg_c['deleted']:>6}")
            if sqlite_c["total"] == pg_c["total"]:
                print(f"  ✓ counts match")
            else:
                diff = sqlite_c["total"] - pg_c["total"]
                print(f"  ! drift: SQLite has {diff:+d} more rows than Postgres")
        except DBConfigError as exc:
            print(f"  ! {exc}")
        except DBUnavailable as exc:
            print(f"  ! postgres unavailable: {exc}")
        except Exception as exc:
            print(f"  ! probe error: {exc}")
    return 0


def _subsystem_counts(name: str) -> tuple[dict, dict]:
    if name == "memory_plane":
        from backend.services.memory_plane import store_sqlite, store_pg
        sqlite_c = store_sqlite.table_counts()
        pg_c = store_pg.table_counts() if engine.is_enabled() else {"total": 0, "active": 0, "deleted": 0}
        return sqlite_c, pg_c
    raise ValueError(f"unknown subsystem: {name}")


# ── copy ───────────────────────────────────────────────────────────────────

_BATCH_SIZE = 1000


def _cmd_copy(subsystem: str, *, dry_run: bool = False) -> int:
    if subsystem not in KNOWN_SUBSYSTEMS:
        print(f"ERROR: unknown subsystem {subsystem!r}. "
              f"Known: {', '.join(KNOWN_SUBSYSTEMS)}", file=sys.stderr)
        return 1

    if not engine.is_enabled():
        print(
            "ERROR: Postgres backend disabled. "
            "Set DATABASE_URL and ENABLE_POSTGRES_BACKEND=true before copying.",
            file=sys.stderr,
        )
        return 2

    if subsystem == "memory_plane":
        return _copy_memory_plane(dry_run=dry_run)
    return 1


def _copy_memory_plane(*, dry_run: bool) -> int:
    """Stream rows from SQLite to Postgres in batches. ON CONFLICT
    DO NOTHING in insert_bulk makes re-runs idempotent."""
    from backend.services.memory_plane import store_sqlite, store_pg
    from backend.services.memory_plane.types import MemoryRecord

    print(f"[copy memory_plane] starting (dry_run={dry_run})")

    # Total source rows for progress reporting.
    src_counts = store_sqlite.table_counts()
    total = int(src_counts.get("total") or 0)
    if total == 0:
        print("[copy memory_plane] source is empty — nothing to copy")
        return 0
    print(f"[copy memory_plane] source rows: {total}")

    # Ensure target schema exists before we stream.
    if not dry_run:
        try:
            store_pg.init()
        except Exception as exc:
            print(f"[copy memory_plane] target init failed: {exc}", file=sys.stderr)
            return 2

    inserted = 0
    skipped = 0
    offset = 0

    # SQLite store doesn't expose a "list every row including
    # deleted" helper — we use a low-level cursor here against the
    # SQLite file because the migration is the one place we read all
    # rows including soft-deleted ones (Postgres should know about
    # those too).
    import sqlite3
    from backend.services.memory_plane.store_sqlite import _db_path
    conn = sqlite3.connect(_db_path(), timeout=30)
    conn.row_factory = sqlite3.Row
    try:
        while True:
            rows = conn.execute(
                "SELECT * FROM memory_items ORDER BY created_at ASC LIMIT ? OFFSET ?",
                (_BATCH_SIZE, offset),
            ).fetchall()
            if not rows:
                break

            batch = [_sqlite_row_to_record(r) for r in rows]

            if dry_run:
                inserted += len(batch)
            else:
                try:
                    n = store_pg.insert_bulk(batch)
                    inserted += n
                    skipped += (len(batch) - n)
                except Exception as exc:
                    print(f"[copy memory_plane] batch at offset {offset} failed: {exc}",
                          file=sys.stderr)
                    return 3

            offset += len(rows)
            print(f"[copy memory_plane] offset={offset:>7} "
                  f"inserted={inserted:>7} skipped={skipped:>7}")
    finally:
        conn.close()

    print(f"[copy memory_plane] done. inserted={inserted} skipped={skipped} "
          f"(of {total} source rows)")
    if inserted + skipped < total:
        print(f"[copy memory_plane] ! mismatch — {total - inserted - skipped} rows unaccounted",
              file=sys.stderr)
        return 3
    return 0


def _sqlite_row_to_record(row) -> "MemoryRecord":
    """Reuse memory_plane's row decoder shape — we hand-build it here
    so we can also propagate `deleted_at` (the regular _row_to_record
    omits it from the active path)."""
    from backend.services.memory_plane.types import MemoryRecord
    import json
    emb_raw = row["embedding"]
    embedding = None
    if emb_raw:
        try:
            emb_v = json.loads(emb_raw)
            if isinstance(emb_v, list):
                embedding = [float(x) for x in emb_v]
        except Exception:
            embedding = None
    md = {}
    md_raw = row["metadata_json"]
    if md_raw:
        try:
            md_v = json.loads(md_raw)
            if isinstance(md_v, dict):
                md = md_v
        except Exception:
            pass
    return MemoryRecord(
        id=          row["id"],
        user_id=     row["user_id"],
        project_id=  row["project_id"],
        agent_id=    row["agent_id"],
        kind=        row["kind"],
        content=     row["content"],
        importance=  float(row["importance"] if row["importance"] is not None else 0.5),
        ttl_seconds= row["ttl_seconds"],
        expires_at=  row["expires_at"],
        source=      row["source"],
        embedding=   embedding,
        metadata=    md,
        created_at=  row["created_at"],
        updated_at=  row["updated_at"],
        deleted_at=  row["deleted_at"],
    )


# ── argparse entry ─────────────────────────────────────────────────────────

def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="db_migrate",
        description="KorvixAI DB migration helper (Phase 6 slice 2).",
    )
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("init", help="bootstrap Postgres schemas + pgvector")
    sub.add_parser("status", help="show row counts in each backend")

    c = sub.add_parser("copy", help="copy data SQLite → Postgres")
    c.add_argument("--subsystem", required=True, choices=KNOWN_SUBSYSTEMS)
    c.add_argument("--dry-run", action="store_true",
                   help="count what would be copied without writing")
    return p


def main(argv: Optional[list[str]] = None) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s %(message)s",
    )
    args = _build_parser().parse_args(argv)

    if args.cmd == "init":
        return _cmd_init()
    if args.cmd == "status":
        return _cmd_status()
    if args.cmd == "copy":
        return _cmd_copy(args.subsystem, dry_run=bool(args.dry_run))
    return 1


if __name__ == "__main__":
    sys.exit(main())
