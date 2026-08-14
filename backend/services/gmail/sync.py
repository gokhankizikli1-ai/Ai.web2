# coding: utf-8
"""Gmail connector — bounded read/sync.

Brings USEFUL RECENT Gmail metadata for a connected project into the Business
Brain as normalized observations. Deliberately NOT a full-mailbox crawl:

  * BOUNDED — ONE page of at most `sync_max_messages` (config, ≤100) message
    ids (optionally windowed by `sync_query`, default "newer_than:30d"). Never
    follows nextPageToken.
  * METADATA ONLY — each message is fetched with format=metadata (From/Subject/
    Date headers + snippet). NO body, NO attachments.
  * IDEMPOTENT — every observation carries the stable Gmail message id as its
    `external_id`, so re-running the sync writes no duplicate (dedup happens in
    the observation store).
  * FAILURE-TRUTHFUL — a provider failure is recorded as a typed error and NEVER
    converted into an empty success. A per-message read failure is skipped and
    counted, so one bad message can't abort the whole sync.
  * ZERO model calls, ZERO embeddings. Pure REST reads + SQLite writes.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from backend.services.gmail import config as gm_config
from backend.services.gmail import normalize
from backend.services.gmail.client import GmailClient
from backend.services.gmail.errors import GmailError
from backend.services.gmail.ingest import ingest_many
from backend.services.gmail.store import GmailConnection, get_connection, mark_synced

logger = logging.getLogger(__name__)


@dataclass
class SyncReport:
    project_id: str
    google_email: str
    recorded: int = 0
    deduplicated: int = 0
    rejected: int = 0
    fetched: int = 0          # messages successfully fetched for normalization
    skipped: int = 0          # per-message read failures (skipped, not fatal)
    errors: Dict[str, str] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        """Only "ok" when NO resource-level error occurred. Partial failure is
        surfaced truthfully, never smoothed into success."""
        return not self.errors

    def as_dict(self) -> Dict[str, Any]:
        return {
            "project_id": self.project_id,
            "google_email": self.google_email,
            "recorded": self.recorded,
            "deduplicated": self.deduplicated,
            "rejected": self.rejected,
            "fetched": self.fetched,
            "skipped": self.skipped,
            "errors": dict(self.errors),
            "ok": self.ok,
        }


def _err(exc: GmailError) -> str:
    status = getattr(exc, "status", None)
    return f"{type(exc).__name__}" + (f" (HTTP {status})" if status else "")


def sync_connection(conn: GmailConnection, *, client: Optional[GmailClient] = None,
                    initial: Optional[bool] = None) -> SyncReport:
    """Run the bounded read for a connected project. Records observations only —
    never creates a task/decision/run, never calls a model.

    On the FIRST sync of a connection (no prior `last_sync_at`) a few bounded
    pages are followed so the useful recent context lands in ONE click;
    subsequent syncs read a single page. Both paths stay hard-capped and
    idempotent. `initial` can be forced for tests; otherwise it is inferred."""
    report = SyncReport(project_id=conn.project_id, google_email=conn.google_email)
    client = client or GmailClient(conn)

    is_initial = (not (conn.last_sync_at or "").strip()) if initial is None else bool(initial)
    max_pages = gm_config.sync_initial_max_pages() if is_initial else gm_config.sync_max_pages()

    # 1. Bounded list of recent message ids. A failure here is fatal to the sync
    #    (we have nothing to read) and is reported truthfully.
    try:
        message_ids = client.list_message_ids(max_pages=max_pages)
    except GmailError as exc:
        report.errors["list"] = _err(exc)
        return report

    # 2. Fetch metadata per message (bounded, headers+snippet only) and
    #    normalize. A per-message failure is skipped, not fatal.
    normalized: List[Dict[str, Any]] = []
    for mid in message_ids:
        try:
            raw = client.get_message_metadata(mid)
        except GmailError as exc:
            report.skipped += 1
            # Keep the first representative error for visibility without
            # spamming one key per message.
            report.errors.setdefault("message", _err(exc))
            continue
        o = normalize.normalize_message(raw, connection_email=conn.google_email)
        if o:
            normalized.append(o)
            report.fetched += 1

    # 3. Ingest via the canonical observation seam.
    res = ingest_many(conn, normalized)
    report.recorded += res.recorded
    report.deduplicated += res.deduplicated
    report.rejected += res.rejected

    # Mark complete ONLY on a fully clean sync (no list/message errors). A
    # partial failure (e.g. an unreadable message) leaves last_sync_at unset so
    # the next sync is still an INITIAL import (the fuller page cap) and gets its
    # intended backfill on retry; already-ingested messages dedup deterministically.
    # Mirrors the GitHub connector; partial errors stay reported in report.errors.
    if report.ok:
        mark_synced(conn.project_id)
    return report


def sync_project(project_id: str) -> SyncReport:
    """Run the bounded read for a connected project id. Requires an existing,
    non-revoked connection."""
    conn = get_connection(project_id)
    if conn is None:
        return SyncReport(project_id=str(project_id), google_email="",
                          errors={"connection": "no Gmail connection for project"})
    if conn.is_revoked:
        return SyncReport(project_id=str(project_id), google_email=conn.google_email,
                          errors={"connection": "Gmail connection is revoked — reconnect required"})
    return sync_connection(conn)


__all__ = ["SyncReport", "sync_connection", "sync_project"]
