# coding: utf-8
"""Google Calendar event normalization — PURE, zero I/O.

Turns a Google Calendar `events.list` item into a `NormalizedObservation` dict
shaped to `observations_store.record_observation`'s existing contract — no new
storage schema. Mirrors `gmail.normalize` / `vercel.normalize` / `github.normalize`.

The returned dict is connector-neutral EVIDENCE only. It never says "reschedule",
"decline", or "create a task". Whether it matters is the deterministic Business
Brain's decision, downstream.

DETERMINISTIC external_id (idempotency key) — STATE AWARE, NOT CLOCK AWARE
--------------------------------------------------------------------------
`external_id` is derived from the calendar id + the STABLE event id + the
event's `status` + its `updated` timestamp:

    calendar:event:<calendar_id>:<event_id>:<status>:<updated>

Consequences, all deliberate:

  * The same unchanged event ingested twice (a re-sync, or overlapping syncs) →
    identical external_id → deduplicated, no double observation.
  * A genuine edit (time moved, attendees changed, title renamed) bumps Google's
    `updated` → a NEW external_id → a new observation recording the new state.
  * A cancellation changes BOTH `status` and `updated` → a new observation, so
    "this meeting was called off" is always recorded once.
  * The key contains NO clock-relative component. An event that merely crosses
    "now" between two syncs — going from upcoming to past — therefore does NOT
    produce a second row. (The observation *kind* is clock-relative; the dedup
    key deliberately is not, or every event would be re-recorded as it aged.)

OBSERVED_AT IS THE EVENT'S CHANGE TIME, NOT ITS START TIME
-----------------------------------------------------------
`observed_at` carries Google's `updated` (falling back to `created`) — the
truthful instant at which this fact came to be, exactly like every other
connector's source timestamp. It is NOT the event's start time: a start time is
in the FUTURE for upcoming events, and writing future instants into
`observed_at` would let calendar rows permanently outrank real recent activity
from Gmail/GitHub/Vercel in the shared, recency-ordered observation slice the
Business Brain reads. The start/end instants live in the payload, where the AI
reads them as content; imminence is expressed through the `importance` hint,
which is the vocabulary the existing prioritizer already understands.

BOUNDED PAYLOAD — AND WHAT IS DELIBERATELY DROPPED
---------------------------------------------------
Fields are picked EXPLICITLY, never copied wholesale:

  * `attachments` are NEVER read (no Drive files, no file names, no URLs).
  * `description` is included only up to `config.description_max_chars`
    (0 disables it entirely) — never an unbounded note dump.
  * attendees are capped at `config.attendees_max` entries of {email,
    response_status}; the full count is recorded separately, so a 300-person
    invite contributes a number, not 300 rows of personal data. Display names,
    phone numbers, and comments are not copied.
  * `extendedProperties`, `gadget`, `source`, `reminders`, and per-attendee
    free-text are not read at all.

COST: pure functions. ZERO model tokens, ZERO embeddings, ZERO network.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from backend.services.google_calendar import config as cal_config
from backend.services.orchestrator.observations_store import (
    IMPORTANCE_HIGH, IMPORTANCE_LOW, IMPORTANCE_NORMAL,
)

SOURCE = "calendar"

KIND_EVENT_UPCOMING = "calendar.event.upcoming"
KIND_EVENT_UPDATED = "calendar.event.updated"
KIND_EVENT_CANCELLED = "calendar.event.cancelled"

STATUS_CANCELLED = "cancelled"

_SUMMARY_MAX = 240
_TITLE_MAX = 200
_LOCATION_MAX = 200
_URL_MAX = 400
_EMAIL_MAX = 200
_ID_MAX = 300


def _s(v: Any, limit: int = 0) -> str:
    out = "" if v is None else str(v)
    return out[:limit] if limit else out


def _first_line(v: Any, limit: int) -> str:
    return _s(v).replace("\r", " ").split("\n", 1)[0][:limit]


def _parse_instant(value: str) -> Optional[datetime]:
    """Parse an RFC3339 instant ("2024-03-01T14:00:00-07:00" / "...Z") into an
    aware UTC datetime. Returns None when unparseable."""
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _parse_all_day(value: str) -> Optional[datetime]:
    """Parse an all-day `date` ("2024-03-01") as that day's UTC midnight.

    An all-day event has no timezone of its own in the API response, so any
    instant we derive is an approximation. UTC midnight is used consistently for
    both the ordering decision and the imminence hint; the raw `date` string is
    preserved verbatim in the payload, so nothing truthful is lost."""
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        d = date.fromisoformat(raw)
    except (TypeError, ValueError):
        return None
    return datetime(d.year, d.month, d.day, tzinfo=timezone.utc)


def _endpoint(node: Any) -> Dict[str, Any]:
    """Normalize a start/end node into {raw, instant, all_day, time_zone}."""
    if not isinstance(node, dict):
        return {"raw": "", "instant": None, "all_day": False, "time_zone": ""}
    dt_str = _s(node.get("dateTime"), 60)
    if dt_str:
        return {"raw": dt_str, "instant": _parse_instant(dt_str),
                "all_day": False, "time_zone": _s(node.get("timeZone"), 80)}
    d_str = _s(node.get("date"), 20)
    return {"raw": d_str, "instant": _parse_all_day(d_str),
            "all_day": bool(d_str), "time_zone": _s(node.get("timeZone"), 80)}


def _meeting_url(event: Dict[str, Any]) -> str:
    """The event's video-meeting link, if Google supplied one. Prefers the
    legacy `hangoutLink`, else the first VIDEO entry point of `conferenceData`.
    Nothing else from `conferenceData` (notes, pins, phone numbers) is read."""
    link = _s(event.get("hangoutLink"), _URL_MAX)
    if link:
        return link
    conf = event.get("conferenceData")
    entries = conf.get("entryPoints") if isinstance(conf, dict) else None
    if isinstance(entries, list):
        for e in entries:
            if isinstance(e, dict) and _s(e.get("entryPointType")).lower() == "video":
                uri = _s(e.get("uri"), _URL_MAX)
                if uri:
                    return uri
    return ""


def _person(node: Any) -> Dict[str, str]:
    """Bounded organizer/creator metadata: address + display name only."""
    if not isinstance(node, dict):
        return {}
    out: Dict[str, str] = {}
    email = _s(node.get("email"), _EMAIL_MAX)
    name = _s(node.get("displayName"), 120)
    if email:
        out["email"] = email
    if name:
        out["display_name"] = name
    return out


def _attendees(event: Dict[str, Any]) -> Dict[str, Any]:
    """Bounded attendee metadata. Always reports the true total count; copies at
    most `config.attendees_max` entries of {email, response_status}."""
    raw = event.get("attendees")
    if not isinstance(raw, list):
        return {"count": 0, "list": []}
    people = [a for a in raw if isinstance(a, dict)]
    cap = cal_config.attendees_max()
    bounded: List[Dict[str, str]] = []
    for a in people[:cap] if cap else []:
        entry: Dict[str, str] = {}
        email = _s(a.get("email"), _EMAIL_MAX)
        if email:
            entry["email"] = email
        status = _s(a.get("responseStatus"), 20)
        if status:
            entry["response_status"] = status
        if entry:
            bounded.append(entry)
    return {"count": len(people), "list": bounded}


def _is_recurring(event: Dict[str, Any]) -> bool:
    return bool(event.get("recurringEventId")) or bool(event.get("recurrence"))


def _classify(*, cancelled: bool, start: Optional[datetime],
              now: datetime, soon_delta: timedelta) -> tuple:
    """Decide (kind, importance) from the event's state and its start relative
    to `now`. Pure; the ONLY clock-dependent step in this module.

      cancelled + start in the future  → cancelled / HIGH
                                         (a commitment just disappeared — the
                                          strongest signal this connector emits)
      cancelled + start unknown        → cancelled / NORMAL
      cancelled + start in the past    → cancelled / LOW   (nothing to act on)
      active    + starts within soon   → upcoming  / HIGH   (imminent)
      active    + starts later         → upcoming  / NORMAL
      active    + already started/past → updated   / LOW    (recent context)
      active    + start unknown        → updated   / LOW
    """
    if cancelled:
        if start is None:
            return KIND_EVENT_CANCELLED, IMPORTANCE_NORMAL
        if start >= now:
            return KIND_EVENT_CANCELLED, IMPORTANCE_HIGH
        return KIND_EVENT_CANCELLED, IMPORTANCE_LOW
    if start is None or start < now:
        return KIND_EVENT_UPDATED, IMPORTANCE_LOW
    if start <= now + soon_delta:
        return KIND_EVENT_UPCOMING, IMPORTANCE_HIGH
    return KIND_EVENT_UPCOMING, IMPORTANCE_NORMAL


def normalize_event(event: Dict[str, Any], *, calendar_id: str = "",
                    now: Optional[datetime] = None) -> Optional[Dict[str, Any]]:
    """Normalize ONE Google Calendar event into an observation dict, or None when
    the input is malformed (not a dict, or no id).

    `now` (aware UTC) is injectable so the upcoming/past classification is
    deterministic in tests; it defaults to the current UTC instant.

    Cancelled instances returned by `showDeleted=true` are frequently MINIMAL —
    id + status + updated, with the timing only in `originalStartTime` and no
    title at all. That shape is handled explicitly rather than discarded, because
    "a meeting was called off" is one of the most useful signals here."""
    if not isinstance(event, dict):
        return None
    event_id = _s(event.get("id"), _ID_MAX)
    if not event_id:
        return None

    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:  # defensive: keep the comparison aware-vs-aware
        now = now.replace(tzinfo=timezone.utc)

    # The calendar this event was read from. Supplied by the caller (the sync
    # knows which calendar it queried); never inferred from event content, so a
    # third-party organizer address can never redirect the dedup key.
    cal_id = _s(calendar_id, _ID_MAX) or cal_config.PRIMARY_CALENDAR_ID
    status = _s(event.get("status"), 20).lower()
    cancelled = status == STATUS_CANCELLED

    start = _endpoint(event.get("start"))
    if not start["raw"]:
        # Cancelled instances of a recurring series carry their timing here.
        start = _endpoint(event.get("originalStartTime"))
    end = _endpoint(event.get("end"))

    kind, importance = _classify(
        cancelled=cancelled, start=start["instant"], now=now,
        soon_delta=timedelta(hours=cal_config.soon_hours()),
    )

    title = _s(event.get("summary"), _TITLE_MAX)
    updated = _s(event.get("updated"), 60)
    created = _s(event.get("created"), 60)
    # Truthful source time: when the event last CHANGED (never "now", never the
    # future start time). Empty ⇒ the store falls back to ingest time.
    observed_at = updated or created

    payload: Dict[str, Any] = {
        "provider": SOURCE,
        "calendar_id": cal_id,
        "event_id": event_id,
        "status": status or "confirmed",
        "title": title,
        "start": start["raw"],
        "end": end["raw"],
        "all_day": bool(start["all_day"]),
        "time_zone": start["time_zone"] or end["time_zone"],
        "created": created,
        "updated": updated,
        "recurring": _is_recurring(event),
    }
    if event.get("recurringEventId"):
        payload["recurring_event_id"] = _s(event.get("recurringEventId"), _ID_MAX)

    location = _first_line(event.get("location"), _LOCATION_MAX)
    if location:
        payload["location"] = location
    meeting_url = _meeting_url(event)
    if meeting_url:
        payload["meeting_url"] = meeting_url
    html_link = _s(event.get("htmlLink"), _URL_MAX)
    if html_link:
        payload["html_link"] = html_link
    organizer = _person(event.get("organizer"))
    if organizer:
        payload["organizer"] = organizer
    att = _attendees(event)
    payload["attendee_count"] = att["count"]
    if att["list"]:
        payload["attendees"] = att["list"]
    desc_cap = cal_config.description_max_chars()
    if desc_cap:
        description = _s(event.get("description"), desc_cap)
        if description:
            payload["description"] = description

    when = start["raw"]
    label = title or "(no title)"
    if kind == KIND_EVENT_CANCELLED:
        summary = f"Event cancelled: {label}" + (f" — was {when}" if when else "")
    elif kind == KIND_EVENT_UPCOMING:
        summary = f"Upcoming event: {label}" + (f" — starts {when}" if when else "")
    else:
        summary = f"Calendar event: {label}" + (f" — {when}" if when else "")

    # State-aware, clock-independent dedup key (see the module docstring).
    external_id = (f"calendar:event:{cal_id}:{event_id}:"
                   f"{status or 'confirmed'}:{updated or '0'}")

    return {
        "source": SOURCE,
        "kind": kind,
        "external_id": external_id[:400],
        "summary": _s(summary, _SUMMARY_MAX),
        "observed_at": observed_at,
        "importance": importance,
        "payload": payload,
    }


def normalize_events(events: List[Dict[str, Any]], *, calendar_id: str = "",
                     now: Optional[datetime] = None) -> List[Dict[str, Any]]:
    """Normalize a bounded batch. A malformed item is skipped, never fatal."""
    now = now or datetime.now(timezone.utc)
    out: List[Dict[str, Any]] = []
    for e in events or []:
        o = normalize_event(e, calendar_id=calendar_id, now=now)
        if o:
            out.append(o)
    return out


__all__ = [
    "SOURCE", "KIND_EVENT_UPCOMING", "KIND_EVENT_UPDATED", "KIND_EVENT_CANCELLED",
    "STATUS_CANCELLED", "normalize_event", "normalize_events",
]
