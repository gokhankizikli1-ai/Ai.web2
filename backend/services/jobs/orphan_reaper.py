# coding: utf-8
"""Phase 7 slice 4 — orphan reaper.

Worker crash mid-task leaves the job row in `status=running` forever.
The inline runner cancels in-flight tasks on API shutdown; Celery
workers have no such hook. This module sweeps the store for stale
`running` rows and marks them `failed` with `error=orphan_reaped`.

Threshold:
    A row is "stale" when:
      status == "running"  AND
      started_at older than WORKER_HEARTBEAT_TIMEOUT_S (default 900s)

The threshold is intentionally generous: the dispatcher's
`task_time_limit=900s` already kills any single task at 15 minutes,
and acks_late=True requeues mid-task crashes. The reaper is a
backstop for the cases where Celery's own machinery fails (worker
SIGKILL'd, network partition, etc).

Surface:
    reap_orphans(*, dry_run=False) → ReaperResult
    reap_orphans_cli()                  # used by the script

NOT scheduled automatically — operator runs via:
    python -m backend.scripts.orphan_reap
or attaches to a Railway cron job. Auto-scheduling via Celery beat
ships when we wire beat in a later phase.
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from typing import Optional


logger = logging.getLogger(__name__)


def _timeout_sec() -> int:
    try:
        return max(60, min(int(os.getenv("WORKER_HEARTBEAT_TIMEOUT_S", "900") or 900), 86400))
    except Exception:
        return 900


@dataclass
class ReaperResult:
    scanned:    int = 0
    reaped:     int = 0
    threshold_s: int = 0
    dry_run:    bool = False

    def to_dict(self) -> dict:
        return {
            "scanned":     self.scanned,
            "reaped":      self.reaped,
            "threshold_s": self.threshold_s,
            "dry_run":     self.dry_run,
        }


def _parse_iso(ts: Optional[str]) -> Optional[datetime]:
    if not ts:
        return None
    try:
        # Python's fromisoformat handles "+00:00" and "Z" in 3.11+.
        s = ts.replace("Z", "+00:00")
        return datetime.fromisoformat(s)
    except Exception:
        return None


def reap_orphans(*, dry_run: bool = False) -> ReaperResult:
    """Sweep rows with status=running whose started_at is older than
    the threshold. Flips them to status=failed + error=orphan_reaped.

    Returns counts. Logs each reaped record_id at INFO so operators
    can audit a sweep.
    """
    from backend.services.jobs import store
    from backend.services.jobs.types import STATUS_RUNNING, STATUS_FAILED

    threshold = _timeout_sec()
    cutoff_dt = datetime.now(timezone.utc) - timedelta(seconds=threshold)
    out = ReaperResult(threshold_s=threshold, dry_run=dry_run)

    # store.list_all takes status + limit; we sweep in pages so a big
    # backlog doesn't load everything at once.
    page = 0
    page_size = 500
    while True:
        try:
            rows = store.list_all(
                status=STATUS_RUNNING,
                limit=page_size, offset=page * page_size,
            )
        except Exception as exc:
            logger.warning("[REAPER] list_all failed at page=%d: %s", page, exc)
            break
        if not rows:
            break
        for rec in rows:
            out.scanned += 1
            started = _parse_iso(rec.started_at)
            if started is None:
                # Defensive — if we have no started_at, we cannot tell
                # if the row is stale. Leave it.
                continue
            if started > cutoff_dt:
                continue
            if dry_run:
                logger.info(
                    "[REAPER][DRYRUN] would reap record_id=%s kind=%s age=%ds",
                    rec.id, rec.kind,
                    int((datetime.now(timezone.utc) - started).total_seconds()),
                )
                out.reaped += 1
                continue
            try:
                store.update(
                    rec.id,
                    status=STATUS_FAILED,
                    error={
                        "message":     "orphan_reaped",
                        "reason":      (f"row in status=running for >"
                                         f"{threshold}s (started_at="
                                         f"{rec.started_at})"),
                        "threshold_s": threshold,
                    },
                    finished_at=datetime.now(timezone.utc).isoformat(),
                )
                out.reaped += 1
                logger.info(
                    "[REAPER] reaped record_id=%s kind=%s age=%ds",
                    rec.id, rec.kind,
                    int((datetime.now(timezone.utc) - started).total_seconds()),
                )
            except Exception as exc:                          # pragma: no cover
                logger.warning(
                    "[REAPER] update failed record_id=%s err=%s",
                    rec.id, exc,
                )
        if len(rows) < page_size:
            break
        page += 1
    return out


__all__ = ["ReaperResult", "reap_orphans"]
