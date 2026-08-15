# coding: utf-8
"""Google Calendar connector — bounded read/sync.

Brings USEFUL NEAR-TERM calendar context for a connected project into the
Business Brain as normalized observations. Deliberately NOT a history crawl:

  * BOUNDED BY TIME — the read is windowed to
    [now − `sync_past_days`, now + `sync_upcoming_days`] (defaults: 7 days back,
    30 days forward). Nothing outside that window is ever requested.
  * BOUNDED BY VOLUME — at most `sync_page_size` events per page,
    `sync_max_pages` (incremental) / `sync_initial_max_pages` (first sync) pages,
    and a HARD `sync_max_events` ceiling that stops the read regardless.
  * READ-ONLY — one GET family (`events.list`). The client has no mutating
    helper at all, and the granted scope (`calendar.events.readonly`) could not
    perform one anyway.
  * IDEMPOTENT — every observation carries a deterministic, state-aware
    `external_id`, so re-running the sync writes no duplicate (dedup happens in
    the observation store).
  * SOURCE-TIME TRUTHFUL — observations carry Google's own `updated` timestamp,
    so an old event never masquerades as fresh activity.
  * PARTIAL-FAILURE TRUTHFUL — a provider failure is recorded as a typed error
    and NEVER converted into an empty success; `last_sync_at` advances only on a
    FULLY clean sync (matching the hardened Gmail/GitHub/Vercel model).
  * EXPLICIT ONLY — there is no poller, scheduler, or webhook here. A sync
    happens because a user pressed "Sync now" (or a test called this function).
  * ZERO model calls, ZERO embeddings. Pure REST reads + SQLite writes.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from backend.services.google_calendar import config as cal_config
from backend.services.google_calendar import normalize
from backend.services.google_calendar.client import CalendarClient
from backend.services.google_calendar.errors import CalendarError
from backend.services.google_calendar.ingest import IngestResult, ingest_many
from backend.services.google_calendar.store import (
    CalendarConnection, get_connection, mark_synced, update_calendar_metadata,
)

logger = logging.getLogger(__name__)


@dataclass
class SyncReport:
    project_id: str
    calendar_id: str
    google_email: str = ""
    recorded: int = 0
    deduplicated: int = 0
    rejected: int = 0
    events: int = 0            # events successfully normalized
    window_start: str = ""     # the RFC3339 timeMin actually used
    window_end: str = ""       # the RFC3339 timeMax actually used
    # resource → typed error string; empty ⇒ the read completed cleanly.
    errors: Dict[str, str] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        """Only "ok" when NO resource-level error occurred. Partial failure is
        surfaced truthfully, never smoothed into success."""
        return not self.errors

    def as_dict(self) -> Dict[str, Any]:
        return {
            "project_id": self.project_id,
            "calendar_id": self.calendar_id,
            "google_email": self.google_email,
            "recorded": self.recorded,
            "deduplicated": self.deduplicated,
            "rejected": self.rejected,
            "events": self.events,
            "window_start": self.window_start,
            "window_end": self.window_end,
            "errors": dict(self.errors),
            "ok": self.ok,
        }

    def _merge(self, r: IngestResult) -> None:
        self.recorded += r.recorded
        self.deduplicated += r.deduplicated
        self.rejected += r.rejected


def _err(exc: CalendarError) -> str:
    status = getattr(exc, "status", None)
    return f"{type(exc).__name__}" + (f" (HTTP {status})" if status else "")


def _rfc3339(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def sync_window(now: datetime) -> Tuple[str, str]:
    """The bounded [timeMin, timeMax] read window as RFC3339 instants. Exposed
    so tests (and the report) can assert the exact bounds the connector uses."""
    start = now - timedelta(days=cal_config.sync_past_days())
    end = now + timedelta(days=cal_config.sync_upcoming_days())
    return _rfc3339(start), _rfc3339(end)


def sync_connection(conn: CalendarConnection, *,
                    client: Optional[CalendarClient] = None,
                    initial: Optional[bool] = None,
                    now: Optional[datetime] = None) -> SyncReport:
    """Run the bounded read for a connected project. Records observations only —
    never creates a task/decision/run, never calls a model.

    On the FIRST sync of a connection (no prior `last_sync_at`) a few bounded
    pages are followed so the whole window lands in ONE click; subsequent syncs
    read a single page. Both paths stay hard-capped and idempotent. `initial`
    and `now` can be forced for tests; otherwise they are inferred."""
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)

    calendar_id = conn.calendar_id or cal_config.PRIMARY_CALENDAR_ID
    time_min, time_max = sync_window(now)
    report = SyncReport(project_id=conn.project_id, calendar_id=calendar_id,
                        google_email=conn.google_email,
                        window_start=time_min, window_end=time_max)

    client = client or CalendarClient(conn)

    is_initial = (not (conn.last_sync_at or "").strip()) if initial is None else bool(initial)
    max_pages = (cal_config.sync_initial_max_pages() if is_initial
                 else cal_config.sync_max_pages())

    # 1. Bounded events read. A failure here is fatal to the sync (there is
    #    nothing to normalize) and is reported truthfully — never as "0 events".
    try:
        page = client.list_events(calendar_id=calendar_id, time_min=time_min,
                                  time_max=time_max, max_pages=max_pages)
    except CalendarError as exc:
        report.errors["events"] = _err(exc)
        return report

    # 2. Refresh the cached display identity from the SAME response envelope
    #    (`events.list` returns the calendar's label + timezone), so no extra
    #    request and no wider scope is needed. Non-empty values only.
    if page.summary or page.time_zone:
        update_calendar_metadata(conn.project_id, google_email=page.summary,
                                 time_zone=page.time_zone)
        report.google_email = page.summary or report.google_email

    # 3. Normalize (pure) → ingest via the canonical observation seam.
    normalized: List[Dict[str, Any]] = normalize.normalize_events(
        page.items, calendar_id=calendar_id, now=now)
    report.events = len(normalized)
    report._merge(ingest_many(conn, normalized))

    # Mark the sync complete ONLY on a fully clean read. A partial failure leaves
    # last_sync_at unset, so the NEXT sync is still treated as an INITIAL import
    # (the fuller page cap) and gets its intended backfill on retry, while
    # already-ingested events are re-read and deterministically de-duplicated
    # (safe, no duplicates). last_sync_at therefore means "last FULLY successful
    # sync", which is also the truthful value for the "last sync" UX.
    if report.ok:
        mark_synced(conn.project_id)
    return report


def sync_project(project_id: str) -> SyncReport:
    """Run the bounded read for a connected project id. Requires an existing,
    non-revoked connection."""
    conn = get_connection(project_id)
    if conn is None:
        return SyncReport(project_id=str(project_id),
                          calendar_id=cal_config.PRIMARY_CALENDAR_ID,
                          errors={"connection": "no Calendar connection for project"})
    if conn.is_revoked:
        return SyncReport(project_id=str(project_id), calendar_id=conn.calendar_id,
                          google_email=conn.google_email,
                          errors={"connection": "Google Calendar authorization is no "
                                                "longer valid — reconnect required"})
    return sync_connection(conn)


__all__ = ["SyncReport", "sync_window", "sync_connection", "sync_project"]
