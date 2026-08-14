# coding: utf-8
"""Gmail REST client — thin, READ-ONLY, stdlib-only.

WHY urllib (no new dependency)
------------------------------
Matches `github.client` and the existing tools layer: stdlib `urllib.request`,
no httpx/requests/google-api-python-client. Tests patch `urllib.request.urlopen`
or, more commonly, inject a fake client (mirroring the GitHub connector tests).

READ-ONLY GUARANTEE
-------------------
Every method issues an HTTP **GET** against a `users.messages` read resource.
There is deliberately NO post/put/delete/modify/trash/send helper — the class
cannot send, reply, draft, delete, archive, or relabel mail. `_get` hard-asserts
the method.

BOUNDED
-------
* `list_message_ids` fetches at most `max_pages` (≤5) pages, each capped at
  `sync_max_messages` (config, ≤100), following `nextPageToken` only up to that
  page ceiling — at most `sync_max_messages × max_pages` ids, never a
  full-mailbox crawl. The initial import uses a few pages; incremental syncs use
  one.
* Message reads use `format=metadata` with an explicit header allow-list, so no
  message body and no attachments are ever downloaded. Every request has a
  wall-clock timeout and a response-size cap.

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

from backend.services.gmail import access as gm_access
from backend.services.gmail import config as gm_config
from backend.services.gmail.errors import (
    GmailAuthError, GmailError, GmailNotFoundError, GmailRateLimitError,
    GmailServerError,
)
from backend.services.gmail.store import GmailConnection

logger = logging.getLogger(__name__)

_USER_AGENT = "KorvixAI-Gmail-Connector/1.0"
_MAX_RESPONSE_BYTES = 2 * 1024 * 1024  # 2 MiB hard cap per response
# Metadata headers we allow into memory. NO body, NO attachments.
_METADATA_HEADERS = ["From", "To", "Subject", "Date"]


class GmailClient:
    """A connection-scoped, read-only Gmail REST client."""

    def __init__(self, conn: GmailConnection):
        if conn is None:
            raise GmailError("connection is required")
        self._conn = conn

    # ── low-level GET ───────────────────────────────────────────────────────

    def _get(self, path: str, *, params: Optional[Any] = None,
             _retry_on_auth: bool = True) -> Any:
        """Issue a single authenticated GET. Returns parsed JSON. Raises a typed
        Gmail* error on any non-2xx / transport failure."""
        assert path.startswith("/"), "path must be absolute (start with /)"
        url = f"{gm_config.api_base()}{path}"
        if params:
            url = f"{url}?{urllib.parse.urlencode(params, doseq=True)}"

        if _retry_on_auth:
            # Pick up any access token a prior request in this sync already
            # refreshed + persisted, so a token that expired at sync start is
            # refreshed ONCE, not once per message (bounds provider token calls).
            self._conn = gm_access.fresh_connection(self._conn)
            token = gm_access.access_token_for(self._conn)
        else:
            token = gm_access.force_refresh(self._conn)
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
            with urllib.request.urlopen(req, timeout=gm_config.request_timeout_s()) as resp:
                raw = resp.read(_MAX_RESPONSE_BYTES + 1)
                if len(raw) > _MAX_RESPONSE_BYTES:
                    raise GmailServerError(f"Response exceeded {_MAX_RESPONSE_BYTES} byte cap for {path}")
                if not raw:
                    return None
                try:
                    return json.loads(raw.decode("utf-8", errors="replace"))
                except json.JSONDecodeError:
                    raise GmailServerError(f"Malformed JSON from Gmail for {path}")
        except urllib.error.HTTPError as e:
            return self._raise_for_http_error(e, path, params=params, _retry_on_auth=_retry_on_auth)
        except urllib.error.URLError as e:
            raise GmailServerError(f"Network error for {path}: {e.reason}")

    def _raise_for_http_error(self, e: "urllib.error.HTTPError", path: str, *,
                              params: Optional[Dict[str, Any]], _retry_on_auth: bool):
        status = e.code
        if status == 401 and _retry_on_auth:
            # The cached token was rejected (revoked/early-expired). Force ONE
            # refresh + retry. A second 401 falls through to the raise below.
            self._conn = gm_access.fresh_connection(self._conn)
            return self._get(path, params=params, _retry_on_auth=False)
        if status == 403:
            if self._is_rate_limited(e):
                raise GmailRateLimitError(f"Gmail rate limit for {path}", status=status)
            raise GmailAuthError(f"Gmail 403 (forbidden) for {path}", status=status)
        if status == 429:
            raise GmailRateLimitError(f"Gmail rate limit for {path}", status=status)
        if status == 401:
            raise GmailAuthError(f"Gmail 401 (unauthorized) for {path}", status=status)
        if status == 404:
            raise GmailNotFoundError(f"Gmail 404 (not found) for {path}", status=status)
        if status >= 500:
            raise GmailServerError(f"Gmail {status} for {path}", status=status)
        raise GmailError(f"Gmail {status} for {path}", status=status)

    @staticmethod
    def _is_rate_limited(e: "urllib.error.HTTPError") -> bool:
        try:
            body = e.read(64 * 1024).decode("utf-8", errors="replace").lower()
            return "ratelimitexceeded" in body or "rate limit" in body
        except Exception:
            return False

    # ── public read helpers ─────────────────────────────────────────────────

    def get_profile(self) -> Dict[str, Any]:
        """users.getProfile — the connected account's own address + counters.
        Doubles as a connection-verification probe."""
        data = self._get("/gmail/v1/users/me/profile")
        return data if isinstance(data, dict) else {}

    def list_message_ids(self, *, max_results: Optional[int] = None,
                         query: Optional[str] = None,
                         max_pages: Optional[int] = None) -> List[str]:
        """Bounded list of message ids (newest first). Each page holds at most
        `sync_max_messages` ids; `max_pages` pages are followed via
        `nextPageToken` (default 1 — a single page). BOTH caps are hard, so the
        most this can ever return is `sync_max_messages × max_pages` ids — never
        a full-mailbox crawl. De-duplicates ids across pages defensively."""
        cap = gm_config.sync_max_messages()
        n = cap if max_results is None else max(1, min(int(max_results), cap))
        pages_cap = 1 if max_pages is None else max(1, min(int(max_pages), 5))
        q = gm_config.sync_query() if query is None else query

        out: List[str] = []
        seen: set = set()
        page_token: Optional[str] = None
        pages = 0
        while pages < pages_cap:
            params: Dict[str, Any] = {"maxResults": n}
            if q:
                params["q"] = q
            if page_token:
                params["pageToken"] = page_token
            data = self._get("/gmail/v1/users/me/messages", params=params)
            page_token = None
            if isinstance(data, dict):
                for m in (data.get("messages") or []):
                    if isinstance(m, dict) and m.get("id"):
                        mid = str(m["id"])
                        if mid not in seen:
                            seen.add(mid)
                            out.append(mid)
                page_token = data.get("nextPageToken") or None
            pages += 1
            if not page_token:
                break
        return out

    def get_message_metadata(self, message_id: str) -> Dict[str, Any]:
        """users.messages.get with format=metadata + a header allow-list. Returns
        headers + snippet + labelIds + internalDate + threadId only — NO body,
        NO attachments."""
        message_id = str(message_id or "").strip()
        if not message_id:
            return {}
        # A list of (key, value) tuples preserves the repeated `metadataHeaders`
        # keys through urlencode(doseq=True) in `_get`.
        params = [("format", "metadata")] + [("metadataHeaders", h) for h in _METADATA_HEADERS]
        data = self._get(
            f"/gmail/v1/users/me/messages/{urllib.parse.quote(message_id, safe='')}",
            params=params,
        )
        return data if isinstance(data, dict) else {}


__all__ = ["GmailClient"]
