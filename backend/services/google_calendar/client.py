# coding: utf-8
"""Google Calendar REST client — thin, READ-ONLY, stdlib-only.

WHY urllib (no new dependency)
------------------------------
Matches `gmail.client` / `github.client` / `vercel.client`: stdlib
`urllib.request`, no httpx/requests/google-api-python-client. Tests inject a
fake client (mirroring the other connector test suites), so no real Google call
is ever made in CI.

READ-ONLY GUARANTEE
-------------------
The class exposes exactly ONE read family — `events.list` on a single calendar —
issued as an HTTP **GET**. There is deliberately NO insert/update/patch/delete/
move/import helper, so the client cannot create, edit, move, or delete an event
even if a caller wanted to. `_get` hard-asserts the method and the API path.

BOUNDED
-------
* `list_events` windows the read with `timeMin`/`timeMax` (config: past days /
  upcoming days) so it can never crawl calendar history.
* Each page is capped at `sync_page_size` (≤250) items; `nextPageToken` is
  followed at most `max_pages` (≤5) times; and a HARD ceiling of
  `sync_max_events` (≤500) items stops the read regardless of the other knobs.
* `singleEvents=true` expands recurring series into concrete instances *inside
  the window* — without it a recurring master event would have no usable start
  time, and the whole series (potentially years of it) would be summarised into
  one ambiguous row.
* `showDeleted=true` is required so CANCELLED instances are visible; that is the
  only way this connector can report "a meeting was called off", which is one of
  its most valuable signals.
* Every request has a wall-clock timeout and a response-size cap.

TOKEN HANDLING
--------------
The access token comes from the central `access` provider (refresh + persist).
A mid-request 401 triggers exactly ONE forced refresh + retry; a second 401 is
surfaced as a typed auth error (the connection is marked revoked on
invalid_grant inside the provider).
"""
from __future__ import annotations

import json
import logging
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional

from backend.services.google_calendar import access as cal_access
from backend.services.google_calendar import config as cal_config
from backend.services.google_calendar.errors import (
    CalendarAuthError, CalendarError, CalendarNotFoundError,
    CalendarRateLimitError, CalendarServerError,
)
from backend.services.google_calendar.store import CalendarConnection

logger = logging.getLogger(__name__)

_USER_AGENT = "KorvixAI-Calendar-Connector/1.0"
_MAX_RESPONSE_BYTES = 2 * 1024 * 1024  # 2 MiB hard cap per response


class EventsPage:
    """One page of the bounded events read, plus the calendar-level envelope
    fields Google returns alongside it (used for the connection's display
    identity — no extra scope, no extra request)."""

    __slots__ = ("items", "next_page_token", "summary", "time_zone")

    def __init__(self, items: List[Dict[str, Any]], next_page_token: str,
                 summary: str, time_zone: str):
        self.items = items
        self.next_page_token = next_page_token
        self.summary = summary
        self.time_zone = time_zone


class CalendarClient:
    """A connection-scoped, read-only Google Calendar REST client."""

    def __init__(self, conn: CalendarConnection):
        if conn is None:
            raise CalendarError("connection is required")
        self._conn = conn

    # ── low-level GET ───────────────────────────────────────────────────────

    def _get(self, path: str, *, params: Optional[Any] = None,
             _retry_on_auth: bool = True) -> Any:
        """Issue a single authenticated GET. Returns parsed JSON. Raises a typed
        Calendar* error on any non-2xx / transport failure."""
        assert path.startswith("/calendar/v3/"), "path must be a Calendar v3 read path"
        url = f"{cal_config.api_base()}{path}"
        if params:
            url = f"{url}?{urllib.parse.urlencode(params, doseq=True)}"

        if _retry_on_auth:
            # Pick up any access token a prior request in this sync already
            # refreshed + persisted, so a token that expired at sync start is
            # refreshed ONCE, not once per page (bounds provider token calls).
            self._conn = cal_access.fresh_connection(self._conn)
            token = cal_access.access_token_for(self._conn)
        else:
            token = cal_access.force_refresh(self._conn)
        req = urllib.request.Request(
            url,
            method="GET",  # READ-ONLY: never anything else.
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/json",
                "User-Agent": _USER_AGENT,
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=cal_config.request_timeout_s()) as resp:
                raw = resp.read(_MAX_RESPONSE_BYTES + 1)
                if len(raw) > _MAX_RESPONSE_BYTES:
                    raise CalendarServerError(
                        f"Response exceeded {_MAX_RESPONSE_BYTES} byte cap for {path}")
                if not raw:
                    return None
                try:
                    return json.loads(raw.decode("utf-8", errors="replace"))
                except json.JSONDecodeError:
                    raise CalendarServerError(f"Malformed JSON from Google Calendar for {path}")
        except urllib.error.HTTPError as e:
            return self._raise_for_http_error(e, path, params=params,
                                              _retry_on_auth=_retry_on_auth)
        except urllib.error.URLError as e:
            raise CalendarServerError(f"Network error for {path}: {e.reason}")

    def _raise_for_http_error(self, e: "urllib.error.HTTPError", path: str, *,
                              params: Optional[Any], _retry_on_auth: bool):
        status = e.code
        if status == 401 and _retry_on_auth:
            # The cached token was rejected (revoked/early-expired). Force ONE
            # refresh + retry. A second 401 falls through to the raise below.
            self._conn = cal_access.fresh_connection(self._conn)
            return self._get(path, params=params, _retry_on_auth=False)
        if status == 403:
            if self._is_rate_limited(e):
                raise CalendarRateLimitError(f"Google Calendar rate limit for {path}",
                                             status=status)
            raise CalendarAuthError(f"Google Calendar 403 (forbidden) for {path}",
                                    status=status)
        if status == 429:
            raise CalendarRateLimitError(f"Google Calendar rate limit for {path}", status=status)
        if status == 401:
            raise CalendarAuthError(f"Google Calendar 401 (unauthorized) for {path}",
                                    status=status)
        if status == 404:
            raise CalendarNotFoundError(f"Google Calendar 404 (not found) for {path}",
                                        status=status)
        if status == 410:
            # Google returns 410 Gone when a syncToken/pageToken has expired.
            # This connector uses neither across syncs, but a mid-run expiry is
            # possible; surface it as a retryable server-side condition.
            raise CalendarServerError(f"Google Calendar 410 (token expired) for {path}",
                                      status=status)
        if status >= 500:
            raise CalendarServerError(f"Google Calendar {status} for {path}", status=status)
        raise CalendarError(f"Google Calendar {status} for {path}", status=status)

    @staticmethod
    def _is_rate_limited(e: "urllib.error.HTTPError") -> bool:
        try:
            body = e.read(64 * 1024).decode("utf-8", errors="replace").lower()
            return ("ratelimitexceeded" in body or "rate limit" in body
                    or "quotaexceeded" in body)
        except Exception:
            return False

    # ── public read helpers ─────────────────────────────────────────────────

    def list_events_page(self, *, calendar_id: str = "", time_min: str = "",
                         time_max: str = "", page_token: str = "",
                         max_results: Optional[int] = None) -> EventsPage:
        """Read ONE bounded page of events from a single calendar.

        `time_min`/`time_max` are RFC3339 instants and are REQUIRED by the sync
        (the caller computes them from the configured window) — this method
        forwards whatever it is given without inventing a wider window."""
        cal_id = str(calendar_id or cal_config.PRIMARY_CALENDAR_ID)
        cap = cal_config.sync_page_size()
        n = cap if max_results is None else max(1, min(int(max_results), cap))
        params: Dict[str, Any] = {
            "maxResults": n,
            "singleEvents": "true",   # expand recurrences into windowed instances
            "orderBy": "startTime",   # requires singleEvents=true
            "showDeleted": "true",    # so cancellations are observable
        }
        if time_min:
            params["timeMin"] = time_min
        if time_max:
            params["timeMax"] = time_max
        if page_token:
            params["pageToken"] = page_token
        data = self._get(
            f"/calendar/v3/calendars/{urllib.parse.quote(cal_id, safe='')}/events",
            params=params,
        )
        if not isinstance(data, dict):
            return EventsPage([], "", "", "")
        items = [i for i in (data.get("items") or []) if isinstance(i, dict)]
        return EventsPage(
            items=items,
            next_page_token=str(data.get("nextPageToken") or ""),
            summary=str(data.get("summary") or "")[:200],
            time_zone=str(data.get("timeZone") or "")[:80],
        )

    def list_events(self, *, calendar_id: str = "", time_min: str = "",
                    time_max: str = "", max_pages: Optional[int] = None
                    ) -> EventsPage:
        """Bounded multi-page events read, returning ONE merged page-like result.

        Follows `nextPageToken` at most `max_pages` times (≤5) and stops early at
        the HARD `sync_max_events` ceiling, so the most this can ever return is
        `min(sync_max_events, sync_page_size × max_pages)` events — never a full
        calendar crawl. Duplicate event ids across pages are dropped defensively.
        The returned envelope carries the FIRST page's calendar summary/timezone."""
        pages_cap = (cal_config.sync_max_pages() if max_pages is None
                     else max(1, min(int(max_pages), 5)))
        hard_ceiling = cal_config.sync_max_events()

        merged: List[Dict[str, Any]] = []
        seen: set = set()
        summary = ""
        time_zone = ""
        page_token = ""
        pages = 0
        while pages < pages_cap and len(merged) < hard_ceiling:
            page = self.list_events_page(
                calendar_id=calendar_id, time_min=time_min, time_max=time_max,
                page_token=page_token,
            )
            if pages == 0:
                summary, time_zone = page.summary, page.time_zone
            for item in page.items:
                eid = str(item.get("id") or "")
                # A recurring series yields one instance per occurrence; each
                # carries a distinct id, so id-dedup is safe here.
                if not eid or eid in seen:
                    continue
                seen.add(eid)
                merged.append(item)
                if len(merged) >= hard_ceiling:
                    break
            pages += 1
            page_token = page.next_page_token
            if not page_token:
                break
        return EventsPage(items=merged, next_page_token="", summary=summary,
                          time_zone=time_zone)


__all__ = ["CalendarClient", "EventsPage"]
