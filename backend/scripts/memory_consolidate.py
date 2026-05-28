# coding: utf-8
"""Phase 6 closure — memory_consolidate CLI.

Run the consolidation passes against the active memory_plane backend
(SQLite or Postgres — picks via the existing dispatcher).

    python -m backend.scripts.memory_consolidate --user-id <id>
    python -m backend.scripts.memory_consolidate --user-id <id> \\
        --similarity 0.95 --decay-days 14 --decay-factor 0.9
    python -m backend.scripts.memory_consolidate --all-users

Exit codes:
  0  ok (even when zero rows changed)
  1  bad args
  2  no users found
  3  unexpected error
"""
from __future__ import annotations

import argparse
import logging
import sqlite3
import sys
from typing import Optional

from backend.services.db import engine


logger = logging.getLogger("memory_consolidate")


def _list_user_ids() -> list[str]:
    """Cheap enumeration of distinct user_ids in the active store.
    Used by --all-users."""
    if engine.is_enabled():
        try:
            with engine.acquire_sync() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "SELECT DISTINCT user_id FROM memory_items "
                        "WHERE deleted_at IS NULL"
                    )
                    return [r[0] for r in cur.fetchall() if r and r[0]]
        except Exception as exc:
            print(f"[consolidate] postgres user enumerate failed: {exc}",
                  file=sys.stderr)
            return []
    # SQLite path
    from backend.services.memory_plane.store_sqlite import _db_path
    try:
        conn = sqlite3.connect(_db_path(), timeout=30)
        try:
            rows = conn.execute(
                "SELECT DISTINCT user_id FROM memory_items "
                "WHERE deleted_at IS NULL"
            ).fetchall()
            return [r[0] for r in rows if r and r[0]]
        finally:
            conn.close()
    except Exception as exc:
        print(f"[consolidate] sqlite user enumerate failed: {exc}",
              file=sys.stderr)
        return []


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="memory_consolidate",
        description="Run dedup + importance-decay against memory_plane.",
    )
    target = p.add_mutually_exclusive_group(required=True)
    target.add_argument("--user-id", help="run for one user")
    target.add_argument("--all-users", action="store_true",
                        help="enumerate distinct users and run for each")

    p.add_argument("--similarity", type=float, default=0.92,
                   help="cosine threshold for dedup (default 0.92)")
    p.add_argument("--decay-days", type=int, default=30,
                   help="rows older than N days are decayed (default 30)")
    p.add_argument("--decay-factor", type=float, default=0.95,
                   help="importance multiplier (default 0.95)")
    return p


def main(argv: Optional[list[str]] = None) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s %(message)s",
    )
    args = _build_parser().parse_args(argv)

    if args.similarity <= 0.0 or args.similarity > 1.0:
        print("ERROR: --similarity must be in (0, 1]", file=sys.stderr)
        return 1
    if args.decay_factor <= 0.0 or args.decay_factor >= 1.0:
        print("ERROR: --decay-factor must be in (0, 1)", file=sys.stderr)
        return 1
    if args.decay_days <= 0:
        print("ERROR: --decay-days must be > 0", file=sys.stderr)
        return 1

    from backend.services.memory_plane.consolidation import consolidate_user

    if args.user_id:
        users = [args.user_id]
    else:
        users = _list_user_ids()

    if not users:
        print("[consolidate] no users found", file=sys.stderr)
        return 2

    total_deduped = total_decayed = total_scanned = 0
    for uid in users:
        try:
            report = consolidate_user(
                uid,
                similarity_threshold=args.similarity,
                decay_days=args.decay_days,
                decay_factor=args.decay_factor,
            )
        except Exception as exc:                              # pragma: no cover
            print(f"[consolidate] user={uid} FAILED: {exc}", file=sys.stderr)
            return 3
        d = report["dedup"]
        z = report["decay"]
        total_deduped += d["deduped"]
        total_decayed += z["decayed"]
        total_scanned += d["scanned"] + z["scanned"]
        print(
            f"[consolidate] user={uid:>16} "
            f"deduped={d['deduped']:>4} "
            f"decayed={z['decayed']:>4} "
            f"scanned={d['scanned']+z['scanned']:>5}"
        )

    print(f"\n[consolidate] total deduped={total_deduped} "
          f"decayed={total_decayed} scanned={total_scanned} "
          f"users={len(users)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
