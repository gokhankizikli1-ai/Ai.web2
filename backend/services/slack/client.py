# coding: utf-8
"""Slack Web API client — thin, READ-ONLY, stdlib-only.

WHY urllib (no new dependency)
------------------------------
Matches `github.client` / `gmail.client` / `vercel.client` / `google_calendar.client`:
stdlib `urllib.request`, no httpx/requests/slack_sdk. Tests inject a fake client
or a fake transport (mirroring the other connector test suites), so no real
Slack call is ever made in CI.

READ-ONLY GUARANTEE — ENFORCED, NOT PROMISED
--------------------------------------------
Every request is an HTTP **GET** against one of exactly FOUR Slack read methods,
and `_get` hard-asserts BOTH the HTTP verb and membership of `_READ_METHODS`:

    conversations.list      which channels this installation can see
    conversations.info      one channel's metadata (server-side revalidation)
    conversations.history   recent messages in a channel the bot is IN
    conversations.replies   bounded replies of ONE thread

There is deliberately no helper for `chat.postMessage`, `chat.update`,
`chat.delete`, `conversations.create/archive/rename/invite/kick/join`,
`reactions.*`, `files.*`, `users.*`, `admin.*` or `auth.revoke`, and the granted
scopes could not perform them anyway. A caller cannot mutate the workspace
through this class even by accident.

SLACK ANSWERS 200 EVEN WHEN IT FAILS
------------------------------------
The Slack Web API returns HTTP 200 with `{"ok": false, "error": "<code>"}` for
most failures. `_get` therefore inspects the envelope and maps the code onto the
typed taxonomy, so `not_in_channel` can NEVER be mistaken for "the channel is
quiet". The distinction between a dead INSTALLATION (`invalid_auth` →
`SlackAuthError`, credential wiped, reconnect required) and an unreadable
CHANNEL (`not_in_channel` → `SlackAccessError`, credential untouched) is the
whole point of the split.

BOUNDED
-------
* `list_channels` follows Slack's `response_metadata.next_cursor` at most
  `channels_max_pages` (≤10) times, `channels_page_size` (≤200) per page, and
  stops at the `pending_channels_max` ceiling.
* `history` windows the read with `oldest` (computed by the sync from the
  configured lookback) and follows the cursor at most `max_pages` (≤5) times.
* `replies` is capped at `sync_thread_max_replies` and never paginates.
* Every request has a wall-clock timeout and a response-size cap.

TOKEN HANDLING
--------------
The bot token is decrypted from the connection on first use and kept only in
memory for the life of the client instance. It is never logged and never
returned. A Slack bot token has no refresh grant, so an auth failure means the
app was uninstalled or the token revoked: the connection is marked revoked and a
typed auth error is raised ("reconnect required"), never an empty success.
"""
from __future__ import annotations

import json
import logging
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional

from backend.services.slack import config as sl_config
from backend.services.slack import store as sl_store
from backend.services.slack.errors import (
    SlackAccessError, SlackAuthError, SlackError, SlackNotFoundError,
    SlackRateLimitError, SlackServerError,
)
from backend.services.slack.store import SlackConnection

logger = logging.getLogger(__name__)

_USER_AGENT = "KorvixAI-Slack-Connector/1.0"
_MAX_RESPONSE_BYTES = 2 * 1024 * 1024  # 2 MiB hard cap per response
_HARD_PAGE_CEILING = 10                 # absolute ceiling regardless of config

# The ONLY Slack methods this client may ever reach. Enforced in `_get`.
_READ_METHODS = frozenset({
    "conversations.list",
    "conversations.info",
    "conversations.history",
    "conversations.replies",
})

# Slack error codes that mean THE INSTALLATION IS DEAD (reconnect required).
_AUTH_FATAL = frozenset({
    "invalid_auth", "not_authed", "account_inactive", "token_revoked",
    "token_expired", "no_permission",
})

# Slack error codes that mean THIS RESOURCE is unreadable while the token is
# fine. Never wipes the credential; the sync records the channel as failed.
_ACCESS_DENIED = frozenset({
    "not_in_channel", "channel_not_found", "missing_scope", "is_archived",
    "restricted_action", "user_is_restricted", "method_not_supported_for_channel_type",
})


class ChannelPage:
    """One bounded page of `conversations.list`."""

    __slots__ = ("channels", "next_cursor")

    def __init__(self, channels: List[Dict[str, Any]], next_cursor: str):
        self.channels = channels
        self.next_cursor = next_cursor


class SlackClient:
    """A connection-scoped, read-only Slack Web API client."""

    def __init__(self, conn: SlackConnection):
        if conn is None:
            raise SlackError("connection is required")
        self._conn = conn
        self._token: Optional[str] = None

    # ── auth ────────────────────────────────────────────────────────────────

    def _bot_token(self) -> str:
        """Decrypt the stored bot token once per client instance. Raises
        SlackAuthError when the connection is revoked or carries no credential;
        `CredentialEncryptionError` propagates unchanged (fail closed)."""
        if self._conn.is_revoked:
            raise SlackAuthError("Slack connection is revoked — reconnect required")
        if self._token is None:
            token = sl_store.decrypt_bot_token(self._conn)
            if not token:
                raise SlackAuthError(
                    "Slack connection has no bot token — reconnect required")
            self._token = token
        return self._token

    # ── low-level GET ───────────────────────────────────────────────────────

    def _get(self, method: str, *, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Issue a single authenticated GET against ONE allowlisted read method.
        Returns the parsed JSON body (already `ok`-checked). Raises a typed
        Slack* error on any transport failure or `ok: false` envelope."""
        # A real raise, NOT an assert: `python -O` strips assertions, and the
        # read-only guarantee must not depend on how the interpreter was
        # launched. This is the single chokepoint every Slack request passes
        # through, so an allowlist here is what makes "this connector cannot
        # mutate a workspace" a property of the code rather than a promise.
        if method not in _READ_METHODS:
            raise SlackError(f"{method} is not a permitted Slack read method")
        p = {k: v for k, v in (params or {}).items() if v not in (None, "")}
        url = f"{sl_config.api_base()}/{method}"
        if p:
            url = f"{url}?{urllib.parse.urlencode(p)}"

        req = urllib.request.Request(
            url,
            method="GET",  # READ-ONLY: never anything else.
            headers={
                "Authorization": f"Bearer {self._bot_token()}",
                "Accept": "application/json",
                "User-Agent": _USER_AGENT,
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=sl_config.request_timeout_s()) as resp:
                raw = resp.read(_MAX_RESPONSE_BYTES + 1)
                if len(raw) > _MAX_RESPONSE_BYTES:
                    raise SlackServerError(
                        f"Response exceeded {_MAX_RESPONSE_BYTES} byte cap for {method}")
                if not raw:
                    raise SlackServerError(f"Empty response from Slack for {method}")
                try:
                    data = json.loads(raw.decode("utf-8", errors="replace"))
                except json.JSONDecodeError:
                    raise SlackServerError(f"Malformed JSON from Slack for {method}")
        except urllib.error.HTTPError as e:
            return self._raise_for_http_error(e, method)
        except urllib.error.URLError as e:
            raise SlackServerError(f"Network error for {method}: {e.reason}")

        if not isinstance(data, dict):
            raise SlackServerError(f"Unexpected response shape from Slack for {method}")
        if not data.get("ok"):
            self._raise_for_slack_error(str(data.get("error") or "unknown_error"), method)
        return data

    def _raise_for_http_error(self, e: "urllib.error.HTTPError", method: str):
        status = e.code
        if status == 429:
            raise SlackRateLimitError(
                f"Slack rate limit for {method}", status=status,
                retry_after=_retry_after(e), slack_error="ratelimited")
        if status in (401, 403):
            # Slack normally answers 200/ok:false, but a proxy/gateway can
            # surface these. Treat as a dead installation and wipe the token.
            sl_store.mark_revoked(self._conn.project_id)
            raise SlackAuthError(f"Slack {status} (unauthorized) for {method}", status=status)
        if status == 404:
            raise SlackNotFoundError(f"Slack 404 for {method}", status=status)
        if status >= 500:
            raise SlackServerError(f"Slack {status} for {method}", status=status)
        raise SlackError(f"Slack {status} for {method}", status=status)

    def _raise_for_slack_error(self, code: str, method: str) -> None:
        """Map Slack's `{"ok": false, "error": …}` envelope onto the taxonomy."""
        if code == "ratelimited":
            raise SlackRateLimitError(f"Slack rate limit for {method}",
                                      slack_error=code)
        if code in _AUTH_FATAL:
            # The installation itself is gone. Wipe the dead credential and
            # require a reconnect — never a silent empty read.
            sl_store.mark_revoked(self._conn.project_id)
            raise SlackAuthError(
                f"Slack rejected the installation ({code}) — reconnect required",
                slack_error=code)
        if code in _ACCESS_DENIED:
            # The token is fine; THIS conversation is not readable. The
            # credential is deliberately left intact.
            raise SlackAccessError(
                f"Slack denied access to the requested conversation ({code})",
                slack_error=code)
        raise SlackError(f"Slack {method} failed ({code})", slack_error=code)

    # ── pagination ──────────────────────────────────────────────────────────

    @staticmethod
    def _next_cursor(payload: Dict[str, Any]) -> str:
        meta = payload.get("response_metadata")
        if not isinstance(meta, dict):
            return ""
        return str(meta.get("next_cursor") or "").strip()

    # ── public read helpers ─────────────────────────────────────────────────

    def list_channels_page(self, *, cursor: str = "",
                           limit: Optional[int] = None) -> ChannelPage:
        """ONE bounded page of the conversations this installation can see.

        `types` is restricted to public + private CHANNELS: `im`/`mpim` are
        never requested, so direct messages are outside this connector entirely
        (and the granted scopes could not read them anyway). Archived channels
        are excluded — they carry no live project signal."""
        cap = sl_config.channels_page_size()
        n = cap if limit is None else max(1, min(int(limit), cap))
        data = self._get("conversations.list", params={
            "types": "public_channel,private_channel",
            "exclude_archived": "true",
            "limit": n,
            "cursor": cursor or None,
        })
        raw = data.get("channels")
        channels = [c for c in raw if isinstance(c, dict)] if isinstance(raw, list) else []
        return ChannelPage(channels=channels, next_cursor=self._next_cursor(data))

    def list_channels(self, *, max_pages: Optional[int] = None,
                      max_channels: Optional[int] = None) -> List[Dict[str, Any]]:
        """The conversations this installation can see (bounded, read-only).

        This is the authoritative server-side answer to "which Slack channels
        may this installation touch" — used both to populate the connect picker
        and (via `get_channel`) to validate a final selection. Duplicate ids
        across cursor pages are dropped defensively."""
        pages_cap = max(1, min(
            int(max_pages if max_pages is not None else sl_config.channels_max_pages()),
            _HARD_PAGE_CEILING))
        ceiling = (sl_config.pending_channels_max() if max_channels is None
                   else max(1, min(int(max_channels), 1000)))

        out: List[Dict[str, Any]] = []
        seen: set = set()
        cursor = ""
        pages = 0
        while pages < pages_cap and len(out) < ceiling:
            page = self.list_channels_page(cursor=cursor)
            for ch in page.channels:
                cid = str(ch.get("id") or "")
                if not cid or cid in seen:
                    continue
                seen.add(cid)
                out.append(ch)
                if len(out) >= ceiling:
                    break
            pages += 1
            cursor = page.next_cursor
            if not cursor:
                break
        return out

    def get_channel(self, channel_id: str) -> Dict[str, Any]:
        """ONE channel's metadata by id.

        Raises `SlackAccessError` (from `channel_not_found`) when the channel is
        not visible under this installation — which is exactly the server-side
        revalidation the connect/select route relies on. A private channel the
        bot is not in is invisible to Slack's own lookup, so it can never be
        bound."""
        channel_id = str(channel_id or "").strip()
        if not channel_id:
            raise SlackNotFoundError("missing Slack channel id")
        data = self._get("conversations.info", params={"channel": channel_id})
        ch = data.get("channel")
        return ch if isinstance(ch, dict) else {}

    def history(self, channel_id: str, *, oldest: str = "",
                max_pages: Optional[int] = None,
                max_messages: Optional[int] = None) -> List[Dict[str, Any]]:
        """Recent messages in ONE channel, newest first, hard-bounded.

        `oldest` is a Slack ts (epoch seconds as a string) computed by the sync
        from the configured lookback window — this method forwards whatever it is
        given and never invents a wider window. Returns Slack's raw message
        dicts; normalization happens in `slack.normalize`."""
        channel_id = str(channel_id or "").strip()
        if not channel_id:
            return []
        pages_cap = max(1, min(
            int(max_pages if max_pages is not None else sl_config.sync_max_pages()), 5))
        page_size = sl_config.sync_page_size()
        ceiling = (sl_config.sync_max_messages() if max_messages is None
                   else max(1, min(int(max_messages), sl_config.sync_max_messages())))

        out: List[Dict[str, Any]] = []
        seen: set = set()
        cursor = ""
        pages = 0
        while pages < pages_cap and len(out) < ceiling:
            data = self._get("conversations.history", params={
                "channel": channel_id,
                "limit": min(page_size, ceiling - len(out)),
                "oldest": oldest or None,
                "inclusive": "false",
                "cursor": cursor or None,
            })
            raw = data.get("messages")
            messages = [m for m in raw if isinstance(m, dict)] if isinstance(raw, list) else []
            for m in messages:
                ts = str(m.get("ts") or "")
                if not ts or ts in seen:
                    continue
                seen.add(ts)
                out.append(m)
                if len(out) >= ceiling:
                    break
            pages += 1
            if not data.get("has_more"):
                break
            cursor = self._next_cursor(data)
            if not cursor:
                break
        return out

    def replies(self, channel_id: str, *, thread_ts: str,
                limit: Optional[int] = None) -> List[Dict[str, Any]]:
        """A BOUNDED slice of one thread's replies (single request, no
        pagination — a thread dump is explicitly out of scope).

        Slack returns the parent message first; it is dropped here so the caller
        receives replies only. Returns [] when thread reads are disabled
        (`sync_thread_max_replies` = 0)."""
        channel_id = str(channel_id or "").strip()
        thread_ts = str(thread_ts or "").strip()
        cap = (sl_config.sync_thread_max_replies() if limit is None
               else max(0, min(int(limit), sl_config.sync_thread_max_replies())))
        if not channel_id or not thread_ts or cap <= 0:
            return []
        # +1 because Slack counts the parent message in `limit`.
        data = self._get("conversations.replies", params={
            "channel": channel_id, "ts": thread_ts, "limit": cap + 1,
        })
        raw = data.get("messages")
        messages = [m for m in raw if isinstance(m, dict)] if isinstance(raw, list) else []
        replies = [m for m in messages if str(m.get("ts") or "") != thread_ts]
        return replies[:cap]


def _retry_after(e: "urllib.error.HTTPError") -> Optional[int]:
    """Slack sends `Retry-After` (seconds) with a 429. Returned so the caller can
    report the wait truthfully; this connector never sleeps on it."""
    try:
        value = e.headers.get("Retry-After") if e.headers else None
        return int(str(value).strip()) if value else None
    except Exception:
        return None


def channel_identity(channel: Dict[str, Any]) -> Dict[str, Any]:
    """The small, explicitly-picked channel fields Korvix stores/displays.

    NOTHING else from a Slack channel payload is read — in particular `topic`,
    `purpose`, `creator`, member lists, and `shared_team_ids` are never touched.
    `is_member` is Slack's own truth about whether the bot can read the channel;
    it is preserved verbatim and never inferred from a name."""
    if not isinstance(channel, dict):
        return {"id": "", "name": "", "is_private": False, "is_member": False,
                "is_archived": False}
    return {
        "id": str(channel.get("id") or ""),
        "name": str(channel.get("name") or "")[:200],
        "is_private": bool(channel.get("is_private")),
        "is_member": bool(channel.get("is_member")),
        "is_archived": bool(channel.get("is_archived")),
    }


__all__ = ["SlackClient", "ChannelPage", "channel_identity"]
