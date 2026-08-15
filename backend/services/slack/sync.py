# coding: utf-8
"""Slack connector — bounded, explicit read/sync.

Brings USEFUL RECENT conversation for a connected project into the Business
Brain as normalized observations. Deliberately NOT a workspace crawl:

  * BOUNDED BY CHANNEL — only the channels the OWNER explicitly selected for
    THIS Korvix project are read, at most `max_selected_channels` of them.
  * BOUNDED BY TIME — the read starts at `now − lookback_days`
    (`sync_initial_lookback_days` on the first sync). Nothing older is ever
    requested.
  * BOUNDED BY VOLUME — a HARD `sync_max_messages` ceiling for the whole sync,
    divided into a FAIR PER-CHANNEL SHARE so a busy channel can never starve the
    others, plus per-channel page caps (`sync_max_pages` /
    `sync_initial_max_pages` × `sync_page_size`).
  * BOUNDED BY THREAD — at most `sync_max_threads_per_channel` threads are
    expanded, each to at most `sync_thread_max_replies` replies, in ONE request.
  * READ-ONLY — four GET methods (`conversations.list/info/history/replies`).
    The client has no mutating helper at all, and the granted scopes could not
    perform one anyway.
  * IDEMPOTENT — every observation carries a deterministic external_id, so
    re-running the sync writes no duplicate (dedup happens in the observation
    store) and a retry after a partial failure is free.
  * SOURCE-TIME TRUTHFUL — observations carry Slack's own message `ts`, so a
    backfilled old message never masquerades as fresh activity.
  * PARTIAL-FAILURE TRUTHFUL — a channel Korvix cannot read is recorded as a
    typed error for THAT channel and never converted into "no messages";
    `last_sync_at` advances only on a FULLY clean read.
  * EXPLICIT ONLY — there is no poller, scheduler, webhook, Event Subscription
    or Celery task here. A sync happens because a user pressed "Sync now" (or a
    test called this function).
  * ZERO model calls, ZERO embeddings. Pure REST reads + SQLite writes.

RATE-LIMIT DISCIPLINE
---------------------
Slack rate-limits per method, and recent non-Marketplace apps get a very tight
allowance on `conversations.history`/`replies`. On the FIRST 429 the sync STOPS
immediately — remaining channels are left unread and the failure is recorded —
rather than hammering an already-limited workspace. Because `last_sync_at` does
not advance on an error, the next explicit sync retries with the wider initial
window and de-duplicates everything already stored.

TRUNCATION IS A BOUND, NOT A FAILURE
-------------------------------------
Hitting a configured ceiling sets `truncated` on the report (and is shown in the
UI) but does NOT mark the sync failed: bounded ingestion is the product
contract, not an error, and treating it as one would leave a busy workspace
permanently "never synced". Provider FAILURES are what keep `last_sync_at` back.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from backend.services.slack import config as sl_config
from backend.services.slack import normalize
from backend.services.slack.client import SlackClient
from backend.services.slack.errors import (
    SlackAuthError, SlackError, SlackRateLimitError,
)
from backend.services.slack.ingest import IngestResult, ingest_many
from backend.services.slack.store import (
    SlackConnection, get_connection, mark_synced,
)

logger = logging.getLogger(__name__)


@dataclass
class SyncReport:
    project_id: str
    team_id: str = ""
    channels: int = 0          # channels bound to this project
    channels_read: int = 0     # channels that returned cleanly
    messages: int = 0          # messages successfully normalized
    threads: int = 0           # thread observations produced
    recorded: int = 0
    deduplicated: int = 0
    rejected: int = 0
    window_start: str = ""     # the ISO instant the read window opened at
    truncated: bool = False    # a configured ceiling clipped the read
    # resource → typed error string; empty ⇒ the read completed cleanly.
    errors: Dict[str, str] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        """Only "ok" when NO resource-level error occurred. Partial failure is
        surfaced truthfully, never smoothed into success. Truncation is a bound,
        not an error, and does not clear this flag."""
        return not self.errors

    def as_dict(self) -> Dict[str, Any]:
        return {
            "project_id": self.project_id,
            "team_id": self.team_id,
            "channels": self.channels,
            "channels_read": self.channels_read,
            "messages": self.messages,
            "threads": self.threads,
            "recorded": self.recorded,
            "deduplicated": self.deduplicated,
            "rejected": self.rejected,
            "window_start": self.window_start,
            "truncated": self.truncated,
            "errors": dict(self.errors),
            "ok": self.ok,
        }

    def _merge(self, r: IngestResult) -> None:
        self.recorded += r.recorded
        self.deduplicated += r.deduplicated
        self.rejected += r.rejected


def _err(exc: SlackError) -> str:
    """A typed, non-secret error string: the exception class plus Slack's own
    machine-readable code. Never a token, never a message body."""
    code = getattr(exc, "slack_error", None)
    status = getattr(exc, "status", None)
    out = type(exc).__name__
    if code:
        out += f" ({code})"
    elif status:
        out += f" (HTTP {status})"
    return out


def sync_window_oldest(now: datetime, *, initial: bool) -> str:
    """The Slack `oldest` bound (epoch seconds as a string) for the read window.
    Exposed so tests (and the report) can assert the exact bound used."""
    days = (sl_config.sync_initial_lookback_days() if initial
            else sl_config.sync_lookback_days())
    start = now - timedelta(days=days)
    return f"{start.timestamp():.6f}"


def sync_connection(conn: SlackConnection, *, client: Optional[SlackClient] = None,
                    initial: Optional[bool] = None,
                    now: Optional[datetime] = None) -> SyncReport:
    """Run the bounded read for a connected project. Records observations only —
    never creates a task/decision/run, never calls a model, never mutates
    anything in Slack.

    On the FIRST sync of a connection (no prior `last_sync_at`) a wider window
    and a fuller page cap are used so a newly connected channel arrives with
    usable context in ONE click; subsequent syncs read the recent window only.
    Both paths stay hard-capped and idempotent. `initial` and `now` can be forced
    for tests; otherwise they are inferred."""
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)

    report = SyncReport(project_id=conn.project_id, team_id=conn.team_id)

    # Channels are capped defensively here too: the store enforces the cap on
    # write, but a config that was lowered after a selection must not let an old
    # binding read more than the CURRENT bound allows.
    channels = list(conn.channels)[:sl_config.max_selected_channels()]
    report.channels = len(channels)
    if not channels:
        report.errors["connection"] = "no Slack channels selected for this connection"
        return report

    is_initial = (not (conn.last_sync_at or "").strip()) if initial is None else bool(initial)
    oldest = sync_window_oldest(now, initial=is_initial)
    report.window_start = normalize.ts_to_iso(oldest)
    max_pages = (sl_config.sync_initial_max_pages() if is_initial
                 else sl_config.sync_max_pages())

    # FAIR SHARE: the global ceiling is divided evenly so channel #10 is read
    # even when channel #1 is noisy. At least one message per channel always.
    total_budget = sl_config.sync_max_messages()
    per_channel = max(1, total_budget // max(1, len(channels)))
    thread_cap = sl_config.sync_max_threads_per_channel()

    client = client or SlackClient(conn)
    remaining = total_budget

    for ch in channels:
        if remaining <= 0:
            # The absolute ceiling is spent. Truthfully a BOUND, not a failure.
            report.truncated = True
            break
        budget = min(per_channel, remaining)
        try:
            raw = client.history(ch.channel_id, oldest=oldest, max_pages=max_pages,
                                 max_messages=budget)
        except SlackAuthError as exc:
            # The installation itself is dead (the client already wiped the
            # credential). Nothing else can succeed — stop and report.
            report.errors["connection"] = _err(exc)
            return report
        except SlackRateLimitError as exc:
            # Stop the whole read rather than hammer a limited workspace.
            report.errors["rate_limit"] = _err(exc)
            return report
        except SlackError as exc:
            # THIS channel is unreadable (bot removed, archived, missing scope).
            # Record it and keep going — the other channels are independent.
            report.errors[f"channel:{ch.channel_id}"] = _err(exc)
            continue

        if len(raw) >= budget:
            # The channel filled its whole share, so there may be more we did not
            # read. This deliberately errs toward claiming a clip: over-reporting
            # "bounded" is honest, silently hiding one is not.
            report.truncated = True
        remaining -= len(raw)
        report.channels_read += 1

        normalized: List[Dict[str, Any]] = normalize.normalize_messages(
            raw, team_id=conn.team_id, channel_id=ch.channel_id,
            channel_name=ch.name)
        report.messages += len(normalized)
        report._merge(ingest_many(conn, normalized))

        # Bounded thread expansion — newest threads first, at most `thread_cap`
        # per channel, one request each.
        if thread_cap <= 0 or sl_config.sync_thread_max_replies() <= 0:
            continue
        expanded = 0
        for index, message in enumerate(raw):
            if expanded >= thread_cap:
                # Report the clip instead of hiding it: were there threads left
                # in this channel that the cap stopped us from expanding?
                report.truncated = report.truncated or any(
                    normalize.has_thread(m) for m in raw[index:])
                break
            if not normalize.has_thread(message):
                continue
            thread_ts = str(message.get("ts") or "")
            try:
                replies = client.replies(ch.channel_id, thread_ts=thread_ts)
            except SlackAuthError as exc:
                report.errors["connection"] = _err(exc)
                return report
            except SlackRateLimitError as exc:
                report.errors["rate_limit"] = _err(exc)
                return report
            except SlackError as exc:
                report.errors[f"thread:{ch.channel_id}:{thread_ts}"] = _err(exc)
                expanded += 1
                continue
            expanded += 1
            thread_obs = normalize.normalize_thread(
                message, replies, team_id=conn.team_id,
                channel_id=ch.channel_id, channel_name=ch.name)
            if thread_obs:
                report.threads += 1
                report._merge(ingest_many(conn, [thread_obs]))

    # Mark the sync complete ONLY on a fully clean read. A partial failure leaves
    # last_sync_at unset/stale, so the NEXT sync is still treated as an INITIAL
    # import (wider window, fuller page cap) and the channel that failed gets its
    # intended backfill on retry, while already-ingested messages are re-read and
    # deterministically de-duplicated (safe, no duplicates). last_sync_at
    # therefore means "last FULLY successful sync", which is also the truthful
    # value for the "last sync" UX. Mirrors the Gmail/GitHub/Vercel/Calendar
    # connectors.
    if report.ok:
        mark_synced(conn.project_id)
    return report


def sync_project(project_id: str) -> SyncReport:
    """Run the bounded read for a connected project id. Requires an existing,
    non-revoked connection with at least one selected channel."""
    conn = get_connection(project_id)
    if conn is None:
        return SyncReport(project_id=str(project_id),
                          errors={"connection": "no Slack connection for project"})
    if conn.is_revoked:
        return SyncReport(project_id=str(project_id), team_id=conn.team_id,
                          errors={"connection": "Slack authorization is no longer "
                                                "valid — reconnect required"})
    return sync_connection(conn)


__all__ = ["SyncReport", "sync_window_oldest", "sync_connection", "sync_project"]
