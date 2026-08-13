# coding: utf-8
"""GitHub REST client — thin, read-only, stdlib-only.

WHY urllib (no new dependency)
------------------------------
The existing `backend.services.tools.github_tool` already talks to the GitHub
REST API with `urllib.request`, and the market-providers layer is tested by
patching `urllib.request.urlopen`. This client follows that established
convention: no `httpx`/`requests`/PyGithub is added. The only third-party dep
the connector needs is PyJWT (for RS256 App-JWT signing), isolated in `auth`.

READ-ONLY GUARANTEE
-------------------
Every public method issues an HTTP **GET** against a repository/installation
resource. There is deliberately NO put/post/patch/delete helper here — the
class cannot push a commit, merge a PR, close an issue, rerun a workflow, or
create a deployment. (The single POST in the whole connector is the
installation-token mint in `auth`, which is an authentication call, not a repo
mutation.) `_get` hard-asserts the method.

BOUNDED
-------
`paginate()` walks GitHub's `Link: rel="next"` chain but stops after
`max_pages` (config-capped ≤5) AND `per_page` is clamped ≤100, so a sync can
never crawl an entire repository's history. Every request has a wall-clock
timeout and a response-size cap.
"""
from __future__ import annotations

import json
import logging
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional

from backend.services.github import auth as gh_auth
from backend.services.github import config as gh_config
from backend.services.github.errors import (
    GitHubAuthError, GitHubError, GitHubNotFoundError, GitHubRateLimitError,
    GitHubServerError, GitHubUnprocessableError,
)

logger = logging.getLogger(__name__)

_USER_AGENT = "KorvixAI-GitHub-Connector/1.0"
_MAX_RESPONSE_BYTES = 2 * 1024 * 1024  # 2 MiB hard cap per response


class GitHubClient:
    """An installation-scoped, read-only REST client.

    Construct with an `installation_id`; the client fetches (and lazily
    refreshes) the short-lived installation token via `auth`. Never store or
    log the token — it lives only inside the per-request Authorization header.
    """

    def __init__(self, installation_id: str):
        if not installation_id:
            raise GitHubError("installation_id is required")
        self.installation_id = str(installation_id)

    # ── low-level GET ───────────────────────────────────────────────────────

    def _get(self, path: str, *, params: Optional[Dict[str, Any]] = None,
             _retry_on_auth: bool = True) -> "tuple[Any, Dict[str, str]]":
        """Issue a single authenticated GET. Returns (parsed_json, headers).
        Raises a typed GitHub* error on any non-2xx / transport failure."""
        assert path.startswith("/"), "path must be absolute (start with /)"
        url = f"{gh_config.api_base()}{path}"
        if params:
            url = f"{url}?{urllib.parse.urlencode(params)}"

        token = gh_auth.get_installation_token(self.installation_id)
        req = urllib.request.Request(
            url,
            method="GET",  # READ-ONLY: never anything else.
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": _USER_AGENT,
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=gh_config.request_timeout_s()) as resp:
                raw = resp.read(_MAX_RESPONSE_BYTES + 1)
                if len(raw) > _MAX_RESPONSE_BYTES:
                    raise GitHubServerError(f"Response exceeded {_MAX_RESPONSE_BYTES} byte cap for {path}")
                headers = {k.lower(): v for k, v in (resp.headers.items() if resp.headers else [])}
                if not raw:
                    return None, headers
                try:
                    return json.loads(raw.decode("utf-8", errors="replace")), headers
                except json.JSONDecodeError:
                    raise GitHubServerError(f"Malformed JSON from GitHub for {path}")
        except urllib.error.HTTPError as e:
            return self._raise_for_http_error(e, path, _retry_on_auth=_retry_on_auth, params=params)
        except urllib.error.URLError as e:
            raise GitHubServerError(f"Network error for {path}: {e.reason}")

    def _raise_for_http_error(self, e: "urllib.error.HTTPError", path: str, *,
                              _retry_on_auth: bool, params: Optional[Dict[str, Any]]):
        status = e.code
        if status == 401 and _retry_on_auth:
            # Token may have been revoked/expired between cache and use — drop
            # it and retry ONCE with a fresh mint.
            gh_auth.invalidate_installation_token(self.installation_id)
            return self._get(path, params=params, _retry_on_auth=False)
        if status in (403, 429):
            reset = self._reset_at(e)
            if status == 429 or self._is_rate_limited(e) or reset is not None:
                raise GitHubRateLimitError(
                    f"GitHub rate limit for {path}", status=status, reset_at=reset,
                )
            raise GitHubAuthError(f"GitHub 403 (forbidden) for {path}", status=status)
        if status == 401:
            raise GitHubAuthError(f"GitHub 401 (unauthorized) for {path}", status=status)
        if status == 404:
            raise GitHubNotFoundError(f"GitHub 404 (not found) for {path}", status=status)
        if status == 422:
            raise GitHubUnprocessableError(f"GitHub 422 (unprocessable) for {path}", status=status)
        if status >= 500:
            raise GitHubServerError(f"GitHub {status} for {path}", status=status)
        raise GitHubError(f"GitHub {status} for {path}", status=status)

    @staticmethod
    def _is_rate_limited(e: "urllib.error.HTTPError") -> bool:
        try:
            remaining = e.headers.get("X-RateLimit-Remaining") if getattr(e, "headers", None) else None
            if remaining is not None and str(remaining).strip() == "0":
                return True
            return "rate limit" in (e.read().decode("utf-8", errors="replace").lower())
        except Exception:
            return False

    @staticmethod
    def _reset_at(e: "urllib.error.HTTPError") -> Optional[int]:
        try:
            val = e.headers.get("X-RateLimit-Reset") if getattr(e, "headers", None) else None
            return int(val) if val else None
        except (TypeError, ValueError):
            return None

    # ── public read helpers ─────────────────────────────────────────────────

    def get_repo(self, full_name: str) -> Dict[str, Any]:
        owner, repo = _split_repo(full_name)
        data, _ = self._get(f"/repos/{owner}/{repo}")
        return data if isinstance(data, dict) else {}

    def paginate(self, path: str, *, params: Optional[Dict[str, Any]] = None,
                 max_pages: Optional[int] = None) -> List[Dict[str, Any]]:
        """GET a list resource, following `rel="next"` up to a BOUNDED number
        of pages. Returns the flattened list. `per_page` is clamped to the
        config page size; `max_pages` defaults to the config cap.

        A per-page provider failure propagates as a typed error (never a
        partial silent success) — the caller decides how to record it."""
        page_size = gh_config.sync_page_size()
        pages_cap = max(1, min(int(max_pages if max_pages is not None else gh_config.sync_max_pages()), 5))
        p = dict(params or {})
        p.setdefault("per_page", page_size)
        p["per_page"] = min(int(p.get("per_page") or page_size), 100)

        out: List[Dict[str, Any]] = []
        next_path: Optional[str] = path
        next_params: Optional[Dict[str, Any]] = p
        pages = 0
        while next_path and pages < pages_cap:
            data, headers = self._get(next_path, params=next_params)
            if isinstance(data, list):
                out.extend(x for x in data if isinstance(x, dict))
            elif isinstance(data, dict):
                out.append(data)
            pages += 1
            next_path, next_params = _parse_next_link(headers.get("link"))
        return out


# ── helpers ─────────────────────────────────────────────────────────────────

def _split_repo(full_name: str) -> "tuple[str, str]":
    parts = str(full_name or "").strip().strip("/").split("/")
    if len(parts) != 2 or not parts[0] or not parts[1]:
        raise GitHubError(f"Invalid repository full name: {full_name!r}")
    return parts[0], parts[1]


def _parse_next_link(link_header: Optional[str]) -> "tuple[Optional[str], Optional[Dict[str, Any]]]":
    """Extract the `rel="next"` URL from a GitHub Link header and split it back
    into (path, query-params) so the next GET reuses the same _get plumbing.
    Returns (None, None) when there is no next page."""
    if not link_header:
        return None, None
    for part in link_header.split(","):
        segs = part.split(";")
        if len(segs) < 2:
            continue
        url = segs[0].strip().strip("<>")
        rel = "".join(segs[1:])
        if 'rel="next"' in rel:
            parsed = urllib.parse.urlparse(url)
            params = {k: v[0] for k, v in urllib.parse.parse_qs(parsed.query).items()}
            return parsed.path, params
    return None, None


__all__ = ["GitHubClient"]
