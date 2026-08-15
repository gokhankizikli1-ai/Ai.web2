# coding: utf-8
"""Vercel connector — bounded read/sync.

Brings USEFUL RECENT Vercel state for a connected project into the Business
Brain as normalized observations. Deliberately NOT a full-history crawl:

  * BOUNDED — the deployments read follows at most `sync_max_pages`
    (incremental) / `sync_initial_max_pages` (first sync) pages of
    `sync_page_size` (≤100) items. Nothing walks an account's whole history.
  * READ-ONLY — two GET families only (project metadata + deployment list). No
    env values, no build logs, and no mutation of any kind.
  * IDEMPOTENT — every observation carries a deterministic, state-aware
    `external_id`, so re-running the sync writes no duplicate (dedup happens in
    the observation store).
  * SOURCE-TIME TRUTHFUL — observations carry Vercel's own timestamps, so a
    backfill of old deployments never masquerades as "new activity".
  * PARTIAL-FAILURE TRUTHFUL — a provider failure on one resource is recorded as
    a typed error for that resource and the sync continues with the other; a
    failure is NEVER converted into an empty success, and `last_sync_at` is only
    advanced on a FULLY clean sync (matching the hardened Gmail/GitHub model).
  * ZERO model calls, ZERO embeddings. Pure REST reads + SQLite writes.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from backend.services.vercel import config as vc_config
from backend.services.vercel import normalize
from backend.services.vercel.client import VercelClient
from backend.services.vercel.errors import VercelError
from backend.services.vercel.ingest import IngestResult, ingest_many
from backend.services.vercel.store import (
    VercelConnection, get_connection, mark_synced, update_project_metadata,
)

logger = logging.getLogger(__name__)


@dataclass
class SyncReport:
    project_id: str
    vercel_project_id: str
    recorded: int = 0
    deduplicated: int = 0
    rejected: int = 0
    deployments: int = 0      # deployments successfully normalized
    # resource → typed error string; empty ⇒ that resource synced cleanly.
    errors: Dict[str, str] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        """A sync is only "ok" when NO resource failed. Partial failure is
        surfaced truthfully, never smoothed into success."""
        return not self.errors

    def as_dict(self) -> Dict[str, Any]:
        return {
            "project_id": self.project_id,
            "vercel_project_id": self.vercel_project_id,
            "recorded": self.recorded,
            "deduplicated": self.deduplicated,
            "rejected": self.rejected,
            "deployments": self.deployments,
            "errors": dict(self.errors),
            "ok": self.ok,
        }

    def _merge(self, r: IngestResult) -> None:
        self.recorded += r.recorded
        self.deduplicated += r.deduplicated
        self.rejected += r.rejected


def _err(exc: VercelError) -> str:
    status = getattr(exc, "status", None)
    return f"{type(exc).__name__}" + (f" (HTTP {status})" if status else "")


def sync_connection(conn: VercelConnection, *, client: Optional[VercelClient] = None,
                    initial: Optional[bool] = None) -> SyncReport:
    """Run the bounded read for a connected project. Records observations only —
    never creates a task/decision/run, never calls a model.

    On the FIRST sync of a connection (no prior `last_sync_at`) the deployments
    read follows a few bounded pages so the useful recent history lands in ONE
    click; subsequent syncs read the newest page only. Both paths stay
    hard-capped and idempotent. `initial` can be forced for tests; otherwise it
    is inferred from the connection state."""
    report = SyncReport(project_id=conn.project_id,
                        vercel_project_id=conn.vercel_project_id)
    if not conn.vercel_project_id:
        report.errors["connection"] = "no Vercel project selected for this connection"
        return report

    client = client or VercelClient(conn)

    is_initial = (not (conn.last_sync_at or "").strip()) if initial is None else bool(initial)
    max_pages = (vc_config.sync_initial_max_pages() if is_initial
                 else vc_config.sync_max_pages())

    # 1. Project metadata — identity/config evidence + the cached display fields
    #    the UI shows. A failure here is recorded and does NOT abort the
    #    deployments read (they are independent signals).
    project_name = conn.vercel_project_name
    try:
        project = client.get_project(conn.vercel_project_id)
    except VercelError as exc:
        report.errors["project"] = _err(exc)
        project = None
    if isinstance(project, dict) and project:
        ident = normalize.project_identity(project)
        project_name = ident["name"] or project_name
        update_project_metadata(
            conn.project_id, name=ident["name"], framework=ident["framework"],
            production_url=ident["production_url"],
        )
        o = normalize.normalize_project(project)
        if o:
            report._merge(ingest_many(conn, [o]))

    # 2. Deployments — the primary signal (bounded, newest first).
    try:
        raw_deployments = client.list_deployments(conn.vercel_project_id,
                                                  max_pages=max_pages)
    except VercelError as exc:
        report.errors["deployments"] = _err(exc)
        raw_deployments = []
    normalized: List[Dict[str, Any]] = normalize.normalize_deployments(
        raw_deployments, vercel_project_id=conn.vercel_project_id,
        project_name=project_name,
    )
    report.deployments = len(normalized)
    report._merge(ingest_many(conn, normalized))

    # Mark the sync complete ONLY when every resource read cleanly. A partial
    # failure leaves last_sync_at unset, so the NEXT sync is still treated as an
    # INITIAL import (the fuller page cap): the resource that failed gets its
    # intended backfill on retry, while already-ingested deployments are re-read
    # and deterministically de-duplicated (safe, no duplicates). last_sync_at
    # therefore means "last FULLY successful sync", which is also the truthful
    # value for the "last sync" UX. Mirrors the Gmail/GitHub connectors.
    if report.ok:
        mark_synced(conn.project_id)
    return report


def sync_project(project_id: str) -> SyncReport:
    """Run the bounded read for a connected project id. Requires an existing,
    non-revoked connection with a bound Vercel project."""
    conn = get_connection(project_id)
    if conn is None:
        return SyncReport(project_id=str(project_id), vercel_project_id="",
                          errors={"connection": "no Vercel connection for project"})
    if conn.is_revoked:
        return SyncReport(project_id=str(project_id),
                          vercel_project_id=conn.vercel_project_id,
                          errors={"connection": "Vercel authorization is no longer "
                                                "valid — reconnect required"})
    return sync_connection(conn)


__all__ = ["SyncReport", "sync_connection", "sync_project"]
