# coding: utf-8
"""Slack message normalization — PURE, zero I/O.

Turns a Slack `conversations.history` / `conversations.replies` message into a
`NormalizedObservation` dict shaped to `observations_store.record_observation`'s
existing contract — no new storage schema. Mirrors `vercel.normalize` /
`google_calendar.normalize` / `github.normalize`.

The returned dict is connector-neutral EVIDENCE only. It never says "reply to
this", "escalate", or "create a task". Whether it matters is the deterministic
Business Brain's decision, downstream.

TWO KINDS, AND WHY THERE IS NO THIRD
------------------------------------
    slack.message.created   ONE channel message (top-level or a broadcast reply)
    slack.thread.activity   ONE thread that has replies — the parent plus a
                            BOUNDED preview of its replies, as a single row

Edit and delete semantics are deliberately ABSENT. `conversations.history` does
not report deletions at all, and an edit leaves the message's `ts` unchanged
while only bumping a nested `edited.ts` — so modelling either would require
inventing state the provider does not truthfully give us with these scopes. The
connector records what it can prove.

DETERMINISTIC external_id (idempotency key)
-------------------------------------------
    message  slack:message:<team_id>:<channel_id>:<ts>
    thread   slack:thread:<team_id>:<channel_id>:<thread_ts>:<latest_reply|count>

A Slack `ts` is immutable and unique within a channel, so re-reading the same
message (overlapping sync windows, a retry after a partial failure) always
yields the SAME key → deduplicated, no double observation. A thread's key
carries its newest reply, so a thread that gains replies records once more,
while an unchanged thread deduplicates. Neither key contains a clock-relative
component, so nothing is re-recorded merely because it aged.

OBSERVED_AT IS THE SLACK MESSAGE TIME
--------------------------------------
`observed_at` is derived from Slack's own `ts` (the message instant), never from
ingest time — so a backfilled week-old message sorts as week-old activity in the
shared, recency-ordered slice the Business Brain reads, and can never masquerade
as something that just happened. A thread row carries its LATEST reply's time,
which is the instant the thread actually last moved.

IMPORTANCE — DELIBERATELY NEVER "HIGH"
---------------------------------------
Chat is high-volume and low-signal per message. The existing Business Brain
promotes ONLY high-importance observations into candidate actions
(`candidate_synthesis`), so emitting "high" here would let ordinary chatter
outrank a failed production deployment. Slack therefore emits `normal` for human
conversation and `low` for automated/bot traffic, and nothing else. That keeps
Slack as CONTEXT the brains reason over, not as a queue-jumping alarm — a
deliberate policy choice, not an oversight.

BOUNDED PAYLOAD — AND WHAT IS DELIBERATELY DROPPED
---------------------------------------------------
Fields are picked EXPLICITLY, never copied wholesale:

  * `files` are NEVER read — no names, no URLs, no bodies, no thumbnails. Only a
    COUNT is recorded, so "someone shared something" survives without ingesting
    any file data.
  * `attachments` / `blocks` (rich unfurls, link previews, third-party payloads)
    are not read at all.
  * `reactions` are not read (this connector neither reads nor mutates them).
  * member profiles are never fetched or stored: a message carries the author's
    opaque Slack user id ONLY — no display name, no email, no phone, no avatar,
    no timezone. Resolving ids to people would need `users:read`, which this app
    deliberately does not have.
  * message text is capped at `config.message_max_chars` (0 drops text entirely).
  * thread replies are capped at `config.sync_thread_max_replies`, previewed with
    the same per-message text cap — never a full thread dump.
  * no Slack credential/auth material is ever copied into a payload.

Slack's inline markup (`<@U123>`, `<#C123|general>`, `<https://x|label>`) is
preserved verbatim rather than resolved: resolving it would require extra scopes
and extra provider calls, and the raw form is still readable evidence.

PERMALINKS ARE OMITTED
----------------------
A message permalink needs either `chat.getPermalink` (one extra request per
message — exactly the high-cost crawling the connector avoids) or the
workspace's `<team>.slack.com` domain, which `oauth.v2.access` does not return.
Rather than guess a URL that might 404, the payload carries the ids from which a
permalink can be built later if a cheap source for the domain appears.

COST: pure functions. ZERO model tokens, ZERO embeddings, ZERO network.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from backend.services.orchestrator.observations_store import (
    IMPORTANCE_LOW, IMPORTANCE_NORMAL,
)
from backend.services.slack import config as sl_config

SOURCE = "slack"

KIND_MESSAGE_CREATED = "slack.message.created"
KIND_THREAD_ACTIVITY = "slack.thread.activity"

# Message subtypes that carry NO project intelligence — membership churn and
# channel housekeeping. Skipping them keeps the observation stream about what
# the team is actually discussing.
_NOISE_SUBTYPES = frozenset({
    "channel_join", "channel_leave", "group_join", "group_leave",
    "channel_archive", "channel_unarchive", "group_archive", "group_unarchive",
    "channel_topic", "channel_purpose", "channel_name", "channel_convert_to_private",
    "channel_convert_to_public", "bot_add", "bot_remove", "pinned_item",
    "unpinned_item", "reminder_add", "tombstone",
})

_SUMMARY_MAX = 240
_ID_MAX = 60
_NAME_MAX = 200
_SUBTYPE_MAX = 60


def _s(v: Any, limit: int = 0) -> str:
    out = "" if v is None else str(v)
    return out[:limit] if limit else out


def _one_line(v: Any, limit: int) -> str:
    """Collapse a message to a single readable line for the summary field."""
    text = _s(v).replace("\r", " ").replace("\n", " ")
    return " ".join(text.split())[:limit]


def ts_to_iso(ts: Any) -> str:
    """Convert a Slack `ts` ("1700000000.000100") into a UTC ISO instant.

    Returns "" when the value is missing/unparseable (the store then falls back
    to ingest time rather than inventing one)."""
    raw = _s(ts).strip()
    if not raw:
        return ""
    try:
        seconds = float(raw)
    except (TypeError, ValueError):
        return ""
    try:
        dt = datetime.fromtimestamp(seconds, tz=timezone.utc)
    except (OverflowError, OSError, ValueError):
        return ""
    return dt.isoformat().replace("+00:00", "Z")


def _channel_label(channel_name: str, channel_id: str) -> str:
    name = _s(channel_name, _NAME_MAX).strip()
    return f"#{name}" if name else _s(channel_id, _ID_MAX)


def _is_bot(message: Dict[str, Any]) -> bool:
    """True when Slack attributes the message to an app/bot rather than a human.
    `bot_id` is present on app posts; `subtype == "bot_message"` covers legacy
    integrations."""
    return bool(message.get("bot_id")) or _s(message.get("subtype")) == "bot_message"


def _text(message: Dict[str, Any]) -> str:
    """The message text, capped by config. Returns "" when the cap is 0 (a
    metadata-only deployment) or the message carries no text."""
    cap = sl_config.message_max_chars()
    if cap <= 0:
        return ""
    return _s(message.get("text"), cap)


def _file_count(message: Dict[str, Any]) -> int:
    """How many files were attached — a COUNT ONLY. No name, URL, mimetype, or
    body is ever read from a Slack file object."""
    files = message.get("files")
    return len(files) if isinstance(files, list) else 0


def _int(v: Any) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


def normalize_message(message: Dict[str, Any], *, team_id: str = "",
                      channel_id: str = "", channel_name: str = "",
                      ) -> Optional[Dict[str, Any]]:
    """Normalize ONE Slack message into an observation dict, or None when the
    input is malformed (not a dict, no `ts`) or is pure channel noise (a
    join/leave/housekeeping subtype).

    `team_id` / `channel_id` are supplied by the CALLER (the sync knows which
    workspace and channel it queried) and are never inferred from message
    content, so a crafted message body can never redirect the dedup key or the
    channel attribution."""
    if not isinstance(message, dict):
        return None
    ts = _s(message.get("ts"), 40).strip()
    if not ts:
        return None

    subtype = _s(message.get("subtype"), _SUBTYPE_MAX).strip().lower()
    if subtype in _NOISE_SUBTYPES:
        return None

    team = _s(team_id, _ID_MAX) or "unknown"
    channel = _s(channel_id, _ID_MAX) or "unknown"
    is_bot = _is_bot(message)
    text = _text(message)
    thread_ts = _s(message.get("thread_ts"), 40).strip()

    payload: Dict[str, Any] = {
        "provider": SOURCE,
        "team_id": team,
        "channel_id": channel,
        "channel_name": _s(channel_name, _NAME_MAX),
        "ts": ts,
        "message_time": ts_to_iso(ts),
        "is_bot": is_bot,
    }
    if text:
        payload["text"] = text
    # Opaque author id only — never a profile lookup (see the module docstring).
    author = _s(message.get("user"), _ID_MAX)
    if author:
        payload["user_id"] = author
    if is_bot:
        bot_id = _s(message.get("bot_id"), _ID_MAX)
        if bot_id:
            payload["bot_id"] = bot_id
    if subtype:
        payload["subtype"] = subtype
    if thread_ts:
        payload["thread_ts"] = thread_ts
        payload["is_thread_reply"] = thread_ts != ts
    reply_count = _int(message.get("reply_count"))
    if reply_count:
        payload["reply_count"] = reply_count
    files = _file_count(message)
    if files:
        payload["file_count"] = files
    if bool(message.get("edited")):
        # Slack tells us an edit happened; it does NOT tell us what changed, and
        # `ts` (our dedup key) is unaffected. Recorded as a flag, never modelled
        # as an "edited" event.
        payload["was_edited"] = True

    label = _channel_label(channel_name, channel)
    body = _one_line(text, 160)
    if body:
        summary = f"{label}: {body}"
    elif files:
        summary = f"{label}: shared {files} file{'s' if files != 1 else ''}"
    else:
        summary = f"{label}: message from {author or payload.get('bot_id') or 'unknown'}"

    return {
        "source": SOURCE,
        "kind": KIND_MESSAGE_CREATED,
        "external_id": f"slack:message:{team}:{channel}:{ts}"[:400],
        "summary": _s(summary, _SUMMARY_MAX),
        "observed_at": ts_to_iso(ts),
        # Bot chatter is context, human conversation is signal — but neither is
        # ever "high" (see the module docstring).
        "importance": IMPORTANCE_LOW if is_bot else IMPORTANCE_NORMAL,
        "payload": payload,
    }


def normalize_messages(messages: List[Dict[str, Any]], *, team_id: str = "",
                       channel_id: str = "", channel_name: str = "",
                       ) -> List[Dict[str, Any]]:
    """Normalize a bounded batch. A malformed/noise item is skipped, never
    fatal."""
    out: List[Dict[str, Any]] = []
    for m in messages or []:
        o = normalize_message(m, team_id=team_id, channel_id=channel_id,
                              channel_name=channel_name)
        if o:
            out.append(o)
    return out


def has_thread(message: Dict[str, Any]) -> bool:
    """True when this message is a thread PARENT that actually has replies — the
    only case worth spending a `conversations.replies` request on."""
    if not isinstance(message, dict):
        return False
    ts = _s(message.get("ts")).strip()
    thread_ts = _s(message.get("thread_ts")).strip()
    if not ts or not thread_ts or thread_ts != ts:
        return False  # not a parent (or not threaded at all)
    return _int(message.get("reply_count")) > 0


def normalize_thread(parent: Dict[str, Any], replies: List[Dict[str, Any]], *,
                     team_id: str = "", channel_id: str = "",
                     channel_name: str = "") -> Optional[Dict[str, Any]]:
    """Normalize ONE thread (parent + a BOUNDED reply preview) into a single
    `slack.thread.activity` observation.

    Returns None when the parent is malformed or is not a thread parent with
    replies. The replies list is expected to be already capped by the client;
    it is capped again here so a normalization call can never exceed the
    configured bound regardless of caller."""
    if not has_thread(parent):
        return None
    thread_ts = _s(parent.get("ts"), 40).strip()
    team = _s(team_id, _ID_MAX) or "unknown"
    channel = _s(channel_id, _ID_MAX) or "unknown"

    cap = sl_config.sync_thread_max_replies()
    bounded = [r for r in (replies or []) if isinstance(r, dict)][:cap] if cap else []

    preview: List[Dict[str, Any]] = []
    for r in bounded:
        entry: Dict[str, Any] = {"ts": _s(r.get("ts"), 40)}
        author = _s(r.get("user"), _ID_MAX)
        if author:
            entry["user_id"] = author
        text = _text(r)
        if text:
            entry["text"] = text
        if _is_bot(r):
            entry["is_bot"] = True
        preview.append(entry)

    reply_count = _int(parent.get("reply_count"))
    # Slack reports the newest reply on the parent; fall back to the last reply
    # we actually read, then to the parent itself, so the key and the timestamp
    # are always derived from something real.
    latest_reply = _s(parent.get("latest_reply"), 40).strip()
    if not latest_reply and bounded:
        latest_reply = _s(bounded[-1].get("ts"), 40).strip()

    payload: Dict[str, Any] = {
        "provider": SOURCE,
        "team_id": team,
        "channel_id": channel,
        "channel_name": _s(channel_name, _NAME_MAX),
        "thread_ts": thread_ts,
        "thread_started_at": ts_to_iso(thread_ts),
        "reply_count": reply_count,
        "reply_users_count": _int(parent.get("reply_users_count")),
        "replies_sampled": len(preview),
    }
    parent_text = _text(parent)
    if parent_text:
        payload["parent_text"] = parent_text
    parent_author = _s(parent.get("user"), _ID_MAX)
    if parent_author:
        payload["parent_user_id"] = parent_author
    if latest_reply:
        payload["latest_reply_ts"] = latest_reply
        payload["latest_reply_at"] = ts_to_iso(latest_reply)
    if preview:
        payload["replies"] = preview

    label = _channel_label(channel_name, channel)
    topic = _one_line(parent_text, 120)
    summary = (f"{label}: thread with {reply_count} "
               f"{'reply' if reply_count == 1 else 'replies'}")
    if topic:
        summary = f"{summary} — {topic}"

    # State-aware key: a thread that gains replies records again; an unchanged
    # thread deduplicates. `reply_count` backs the key up when Slack omits
    # `latest_reply`.
    version = latest_reply or str(reply_count)
    return {
        "source": SOURCE,
        "kind": KIND_THREAD_ACTIVITY,
        "external_id": f"slack:thread:{team}:{channel}:{thread_ts}:{version}"[:400],
        "summary": _s(summary, _SUMMARY_MAX),
        # The truthful instant the thread last moved.
        "observed_at": ts_to_iso(latest_reply or thread_ts),
        "importance": IMPORTANCE_NORMAL,
        "payload": payload,
    }


__all__ = [
    "SOURCE", "KIND_MESSAGE_CREATED", "KIND_THREAD_ACTIVITY",
    "ts_to_iso", "has_thread", "normalize_message", "normalize_messages",
    "normalize_thread",
]
