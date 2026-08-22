# coding: utf-8
"""Project Workspace — "SINCE YOUR LAST VISIT" (and its honest fallback).

WHAT THIS IS
------------
A PURE, zero-I/O projection that answers "what changed while I was away?" from
change rows the workspace read model already assembled — connector
observations, chat updates, product/build updates, task transitions and new
knowledge. It stores nothing, and it invents nothing.

TWO MODES, AND THE HEADLINE MUST MATCH THE MODE
------------------------------------------------
    since_last_visit   We have a real marker for this (user, project) from
                       `projects.views_store`, so the window is genuinely
                       "everything after you were last here".
    recent             We do not. The window is a fixed, documented span and
                       the section is labelled "Recent changes" — never
                       "Since you were away", because we cannot prove a visit.

The mode travels in the payload precisely so the frontend cannot accidentally
print the stronger claim over the weaker data.

WHY A ROW MUST PROVE IT IS NEW
------------------------------
`attention.py` deliberately KEEPS a signal whose timestamp will not parse — an
alarm you cannot date is still an alarm. Here the opposite is correct: a change
that cannot prove it happened after the marker cannot honestly be called new,
so it is dropped rather than padding the count. Being silently short is better
than being confidently wrong.

DEDUPLICATION — AND WHY THE COUNT IS A COUNT OF STORIES
-------------------------------------------------------
Every row carries a `key` naming the real-world THING it is about — a CI
target, a Vercel target, a PR, a chat, a build, a task, a knowledge item. Only
the newest row per key survives, so five deploy attempts on one target read as
one change instead of five, and a task moved todo → doing → done during one
absence is one line, not three.

The caller chooses that key, and for a CONNECTOR row it now borrows the
identity `project_intelligence` already resolved: when the correlation
authority's membership index says a stored observation belongs to a correlated
subject, every row in that subject shares one key. So a merge on GitHub, the
Vercel deployment it triggered and the Slack thread about it collapse into ONE
change — the same story the Current-state section shows — instead of three
provider events that a reader has to re-correlate in their head.

That is deliberately NOT a second correlation engine. This module still
correlates nothing; it deduplicates on a key it is handed. The identity comes
from the one authority that owns it, so "3 things happened while you were away"
and "3 subjects" can never disagree.

BOUNDS
------
`count` is the number of deduplicated changes inside the window; `items` is the
first `limit` of them. When the two differ the frontend says so ("+N more")
rather than quietly truncating, so a bound never reads as "that was all".

COST: pure functions. ZERO model tokens, ZERO network, ZERO writes.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Sequence

from backend.services.project_brain.attention import parse_iso

#: We know when the user was last here.
MODE_SINCE_LAST_VISIT = "since_last_visit"
#: We do not — a fixed window, truthfully labelled.
MODE_RECENT = "recent"

#: The fallback window. Long enough to be useful on a first visit, short enough
#: that "recent" is not a lie.
RECENT_WINDOW = timedelta(days=7)

#: Bound on the rendered list. The section is a glance, not a log.
MAX_CHANGES = 6

# ── Change kinds. STABLE identifiers the frontend renders through the shipped
#    locale dictionaries; the backend never sends English prose for these.
CHANGE_CONNECTOR = "connector"
CHANGE_CHAT = "chat"
CHANGE_BUILD = "build"
CHANGE_TASK = "task"
CHANGE_KNOWLEDGE = "knowledge"


def _s(value: Any, limit: int = 240) -> str:
    out = "" if value is None else str(value)
    return out[:limit]


def change_row(*, key: str, change: str, source: str, title: str,
               occurred_at: Any, detail: str = "", ref: str = "",
               subject_id: str = "", subject: str = "",
               state: str = "") -> Dict[str, Any]:
    """One normalized change. `key` is the dedup identity — the thing the change
    is ABOUT, not the event id.

    `subject_id` / `subject` / `state` name the CORRELATED STORY this change
    belongs to, when the caller could resolve one through the existing
    `project_intelligence` membership index. They are carried, never derived
    here: this module does no correlation of its own and must not start. They
    exist so the page can say "Release / PR #656" over a group of provider
    events instead of listing four disconnected rows, and so the count it
    prints is a count of STORIES rather than of raw provider traffic.

    An empty `subject_id` is the honest default: no correlated subject spoke
    for this row, so the row stands alone exactly as it always did."""
    return {
        "key":         _s(key, 200),
        "change":      _s(change, 40),
        "source":      _s(source, 40),
        "title":       _s(title),
        "detail":      _s(detail, 120),
        "occurred_at": _s(occurred_at, 64),
        "ref":         _s(ref, 200),
        "subject_id":  _s(subject_id, 64),
        "subject":     _s(subject, 200),
        "state":       _s(state, 40),
    }


def _sort_key(row: Dict[str, Any]):
    when = parse_iso(row.get("occurred_at"))
    stamp = when.timestamp() if when is not None else float("-inf")
    return (-stamp, _s(row.get("source"), 40), _s(row.get("key"), 200))


def build_changes(
    rows: Sequence[Dict[str, Any]],
    *,
    last_viewed_at: str = "",
    now: Optional[datetime] = None,
    limit: int = MAX_CHANGES,
    window: timedelta = RECENT_WINDOW,
) -> Dict[str, Any]:
    """The bounded change list plus the mode that says what it means.

    Returns `{"mode", "since", "items", "count", "truncated"}`. `since` is the
    ISO instant the window opens at — the real marker in `since_last_visit`
    mode, the computed window start in `recent` mode — so the frontend and the
    tests can both check the claim against the data."""
    when = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    marker = parse_iso(last_viewed_at)
    if marker is not None:
        mode, cutoff = MODE_SINCE_LAST_VISIT, marker
    else:
        mode, cutoff = MODE_RECENT, when - window

    # Newest row per key, inside the window. A row that cannot be dated cannot
    # prove it is new, so it never counts.
    newest: Dict[str, Dict[str, Any]] = {}
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        key = _s(row.get("key"), 200)
        if not key:
            continue
        stamp = parse_iso(row.get("occurred_at"))
        if stamp is None or stamp <= cutoff or stamp > when:
            continue   # too old, undatable, or dated in the future
        current = newest.get(key)
        if current is None or stamp > (parse_iso(current.get("occurred_at"))
                                       or datetime.min.replace(tzinfo=timezone.utc)):
            newest[key] = row

    ordered = sorted(newest.values(), key=_sort_key)
    bound = max(1, int(limit or MAX_CHANGES))
    return {
        "mode":      mode,
        "since":     cutoff.isoformat().replace("+00:00", "Z"),
        "items":     ordered[:bound],
        "count":     len(ordered),
        "truncated": len(ordered) > bound,
    }


__all__ = [
    "MODE_SINCE_LAST_VISIT", "MODE_RECENT", "RECENT_WINDOW", "MAX_CHANGES",
    "CHANGE_CONNECTOR", "CHANGE_CHAT", "CHANGE_BUILD", "CHANGE_TASK",
    "CHANGE_KNOWLEDGE",
    "change_row", "build_changes",
]
