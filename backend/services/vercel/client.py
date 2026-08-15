# coding: utf-8
"""Vercel REST client — thin, READ-ONLY, stdlib-only.

WHY urllib (no new dependency)
------------------------------
Matches `github.client` / `gmail.client` and the existing tools layer: stdlib
`urllib.request`, no httpx/requests/vercel SDK. Tests inject a fake client or
patch `urllib.request.urlopen` (mirroring the GitHub/Gmail connector tests).

READ-ONLY GUARANTEE
-------------------
Every method issues an HTTP **GET** against a project/deployment read resource.
There is deliberately NO post/patch/put/delete helper — the class cannot deploy,
redeploy, promote, roll back, cancel a build, mutate env vars, add/remove a
domain, or change project configuration. `_get` hard-asserts the method.

The endpoints reached are exactly two families:
  * `/v9/projects` + `/v9/projects/{id}`   — project metadata
  * `/v6/deployments`                       — deployment list items
Nothing reads env-var VALUES (`/v9/projects/{id}/env` is never called, and the
project payload's `env` is dropped during normalization), and nothing reads
build LOGS (`/v2/deployments/{id}/events` is never called).

BOUNDED
-------
* `list_projects` and `list_deployments` follow Vercel's `pagination.next`
  cursor for at most `max_pages` (≤5) pages of `sync_page_size` (≤100) items,
  so a read can never crawl an account's entire deployment history.
* Every request has a wall-clock timeout and a response-size cap.

TEAM SCOPE
----------
`teamId` from the connection is attached to EVERY request when present. Without
it Vercel answers for the authorizing user's personal account, which would read
the wrong projects entirely — so scope is applied centrally in `_get`, never
per-call-site.

TOKEN HANDLING
--------------
The access token is decrypted from the connection on first use and kept only in
memory for the life of the client instance. It is never logged and never
returned. A Vercel integration token has no refresh grant, so a 401 means the
authorization was removed at Vercel: the connection is marked revoked and a
typed auth error is raised ("reconnect required"), never an empty success.
"""
from __future__ import annotations

import json
import logging
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional

from backend.services.vercel import config as vc_config
from backend.services.vercel import store as vc_store
from backend.services.vercel.errors import (
    VercelAuthError, VercelError, VercelNotFoundError, VercelRateLimitError,
    VercelServerError,
)
from backend.services.vercel.store import VercelConnection

logger = logging.getLogger(__name__)

_USER_AGENT = "KorvixAI-Vercel-Connector/1.0"
_MAX_RESPONSE_BYTES = 2 * 1024 * 1024  # 2 MiB hard cap per response
_HARD_PAGE_CEILING = 5                  # absolute ceiling regardless of config


class VercelClient:
    """A connection-scoped, read-only Vercel REST client."""

    def __init__(self, conn: VercelConnection):
        if conn is None:
            raise VercelError("connection is required")
        self._conn = conn
        self._token: Optional[str] = None

    # ── auth ────────────────────────────────────────────────────────────────

    def _access_token(self) -> str:
        """Decrypt the stored token once per client instance. Raises
        VercelAuthError when the connection is revoked or carries no credential;
        `CredentialEncryptionError` propagates unchanged (fail closed)."""
        if self._conn.is_revoked:
            raise VercelAuthError("Vercel connection is revoked — reconnect required")
        if self._token is None:
            token = vc_store.decrypt_access_token(self._conn)
            if not token:
                raise VercelAuthError(
                    "Vercel connection has no access token — reconnect required")
            self._token = token
        return self._token

    # ── low-level GET ───────────────────────────────────────────────────────

    def _get(self, path: str, *, params: Optional[Dict[str, Any]] = None) -> Any:
        """Issue a single authenticated GET. Returns parsed JSON. Raises a typed
        Vercel* error on any non-2xx / transport failure."""
        assert path.startswith("/"), "path must be absolute (start with /)"
        p = {k: v for k, v in (params or {}).items() if v not in (None, "")}
        # Team scope is part of the connection's identity, applied centrally so
        # no call site can forget it and silently read the personal account.
        if self._conn.team_id:
            p["teamId"] = self._conn.team_id
        url = f"{vc_config.api_base()}{path}"
        if p:
            url = f"{url}?{urllib.parse.urlencode(p)}"

        req = urllib.request.Request(
            url,
            method="GET",  # READ-ONLY: never anything else.
            headers={
                "Authorization": f"Bearer {self._access_token()}",
                "Accept": "application/json",
                "User-Agent": _USER_AGENT,
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=vc_config.request_timeout_s()) as resp:
                raw = resp.read(_MAX_RESPONSE_BYTES + 1)
                if len(raw) > _MAX_RESPONSE_BYTES:
                    raise VercelServerError(
                        f"Response exceeded {_MAX_RESPONSE_BYTES} byte cap for {path}")
                if not raw:
                    return None
                try:
                    return json.loads(raw.decode("utf-8", errors="replace"))
                except json.JSONDecodeError:
                    raise VercelServerError(f"Malformed JSON from Vercel for {path}")
        except urllib.error.HTTPError as e:
            return self._raise_for_http_error(e, path)
        except urllib.error.URLError as e:
            raise VercelServerError(f"Network error for {path}: {e.reason}")

    def _raise_for_http_error(self, e: "urllib.error.HTTPError", path: str):
        status = e.code
        if status == 429:
            raise VercelRateLimitError(f"Vercel rate limit for {path}", status=status)
        if status == 401:
            # A Vercel integration token has no refresh grant: a 401 means the
            # authorization was removed/rotated at Vercel. Wipe the dead
            # credential and require a reconnect — never a silent empty read.
            vc_store.mark_revoked(self._conn.project_id)
            raise VercelAuthError(f"Vercel 401 (unauthorized) for {path}", status=status)
        if status == 403:
            # Forbidden is NOT proof the token died (it is commonly a team-scope
            # or plan restriction), so the credential is left intact for a retry.
            raise VercelAuthError(f"Vercel 403 (forbidden) for {path}", status=status)
        if status == 404:
            raise VercelNotFoundError(f"Vercel 404 (not found) for {path}", status=status)
        if status >= 500:
            raise VercelServerError(f"Vercel {status} for {path}", status=status)
        raise VercelError(f"Vercel {status} for {path}", status=status)

    # ── pagination ──────────────────────────────────────────────────────────

    @staticmethod
    def _next_cursor(payload: Any) -> Optional[int]:
        """Vercel list responses carry `{"pagination": {"next": <ms>|null}}`.
        The cursor is an EXCLUSIVE upper-bound timestamp passed back as `until`.
        Returns None when there is no further page."""
        if not isinstance(payload, dict):
            return None
        pagination = payload.get("pagination")
        if not isinstance(pagination, dict):
            return None
        nxt = pagination.get("next")
        if nxt in (None, ""):
            return None
        try:
            return int(nxt)
        except (TypeError, ValueError):
            return None

    def _paginate(self, path: str, *, key: str, params: Optional[Dict[str, Any]] = None,
                  max_pages: Optional[int] = None,
                  max_items: Optional[int] = None) -> List[Dict[str, Any]]:
        """GET a Vercel list resource, following the `pagination.next` cursor up
        to a BOUNDED number of pages. Returns the flattened list of `key` items.

        BOTH caps are hard: at most `max_pages` (≤5) requests of at most
        `sync_page_size` (≤100) items, optionally truncated at `max_items`. A
        per-page provider failure propagates as a typed error (never a partial
        silent success) — the caller decides how to record it."""
        page_size = vc_config.sync_page_size()
        pages_cap = max(1, min(
            int(max_pages if max_pages is not None else vc_config.sync_max_pages()),
            _HARD_PAGE_CEILING))
        base_params = dict(params or {})
        base_params["limit"] = page_size

        out: List[Dict[str, Any]] = []
        seen_ids: set = set()
        until: Optional[int] = None
        pages = 0
        while pages < pages_cap:
            p = dict(base_params)
            if until is not None:
                p["until"] = until
            data = self._get(path, params=p)
            items = (data or {}).get(key) if isinstance(data, dict) else None
            if not isinstance(items, list):
                items = data if isinstance(data, list) else []
            for item in items:
                if not isinstance(item, dict):
                    continue
                # Defensive cross-page de-duplication: a cursor boundary can
                # repeat an item when two share a timestamp.
                ident = str(item.get("id") or item.get("uid") or "")
                if ident and ident in seen_ids:
                    continue
                if ident:
                    seen_ids.add(ident)
                out.append(item)
                if max_items is not None and len(out) >= max_items:
                    return out
            pages += 1
            until = self._next_cursor(data)
            if until is None:
                break
        return out

    # ── public read helpers ─────────────────────────────────────────────────

    def list_projects(self, *, max_projects: Optional[int] = None,
                      max_pages: Optional[int] = None) -> List[Dict[str, Any]]:
        """Projects visible to THIS token under its team scope (bounded,
        read-only). This is the authoritative server-side answer to "which Vercel
        projects may this authorization see" — used both to populate the connect
        picker and to validate a final selection."""
        cap = (vc_config.pending_projects_max() if max_projects is None
               else max(1, min(int(max_projects), 200)))
        pages = max_pages if max_pages is not None else _HARD_PAGE_CEILING
        return self._paginate("/v9/projects", key="projects",
                              max_pages=pages, max_items=cap)

    def get_project(self, vercel_project_id: str) -> Dict[str, Any]:
        """One project's metadata by id (or name). Raises VercelNotFoundError
        when it is not visible under this token's scope — which is exactly the
        server-side revalidation the connect/select route relies on."""
        vercel_project_id = str(vercel_project_id or "").strip()
        if not vercel_project_id:
            raise VercelNotFoundError("missing Vercel project id")
        data = self._get(
            f"/v9/projects/{urllib.parse.quote(vercel_project_id, safe='')}")
        return data if isinstance(data, dict) else {}

    def list_deployments(self, vercel_project_id: str, *,
                         max_pages: Optional[int] = None) -> List[Dict[str, Any]]:
        """Recent deployments for ONE project, newest first, bounded to
        `max_pages` × `sync_page_size`. Returns Vercel's list-item shape (ids,
        state, target, timestamps, url, git metadata) — the list endpoint carries
        no build logs and no env values."""
        vercel_project_id = str(vercel_project_id or "").strip()
        if not vercel_project_id:
            return []
        return self._paginate(
            "/v6/deployments", key="deployments",
            params={"projectId": vercel_project_id},
            max_pages=max_pages,
        )


__all__ = ["VercelClient"]
