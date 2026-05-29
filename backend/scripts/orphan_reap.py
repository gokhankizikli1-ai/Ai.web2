# coding: utf-8
"""Phase 7 slice 4 — orphan reaper CLI.

Sweep jobs that have been status=running longer than
WORKER_HEARTBEAT_TIMEOUT_S and mark them failed with
error=orphan_reaped.

Usage:
    python -m backend.scripts.orphan_reap
    python -m backend.scripts.orphan_reap --dry-run

Exit codes: 0 ok (even when zero rows reaped), 1 unexpected error.

Operator runbook:
    Attach to a Railway cron / scheduled task hitting this entry every
    5-15 minutes. Idempotent — safe to over-run.
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
from typing import Optional


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="orphan_reap",
        description="Phase 7 slice 4 — reap stuck-running job rows.",
    )
    p.add_argument(
        "--dry-run", action="store_true",
        help="Count how many rows would be reaped without writing.",
    )
    return p


def main(argv: Optional[list[str]] = None) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s %(message)s",
    )
    args = _build_parser().parse_args(argv)

    try:
        from backend.services.jobs.orphan_reaper import reap_orphans
    except Exception as exc:
        print(f"[reap] import failed: {exc}", file=sys.stderr)
        return 1

    try:
        result = reap_orphans(dry_run=bool(args.dry_run))
    except Exception as exc:
        print(f"[reap] unexpected error: {exc}", file=sys.stderr)
        return 1

    mode = "DRY-RUN" if result.dry_run else "REAP"
    print(
        f"[reap] mode={mode} scanned={result.scanned} "
        f"reaped={result.reaped} threshold_s={result.threshold_s}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
