# coding: utf-8
"""GitHub connector — App-level API used by the install flow.

Two server-side verifications, both built on the EXISTING auth authority
(`github.auth.mint_app_jwt` / `github.client.GitHubClient`) — no parallel auth:

  get_installation(installation_id)
      App-JWT-authenticated GET /app/installations/{id}. Because the JWT is
      signed with OUR App's private key, GitHub only returns installations that
      belong to THIS App — so a 200 proves the installation is ours and reachable
      (a forged / foreign / revoked id yields 404/401). We additionally assert
      the returned `app_id` matches our configured id (defence in depth). This is
      how the setup callback refuses to blindly trust the `installation_id` GitHub
      hands us.

  list_repositories(installation_id)
      Installation-token GET /installation/repositories (via GitHubClient) — the
      authoritative set of repos the installation may access. Used to populate the
      connect UI and to validate a final repo selection server-side.

Read-only. No token is persisted (the installation token is minted on the fly and
cached in-process by `github.auth`). No secret is returned to callers.
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
from backend.services.github.client import GitHubClient
from backend.services.github.errors import (
    GitHubAuthError, GitHubError, GitHubNotFoundError, GitHubServerError,
)

logger = logging.getLogger(__name__)

_USER_AGENT = "KorvixAI-GitHub-Connector/1.0"
_MAX_RESPONSE_BYTES = 512 * 1024  # installation metadata is a small JSON doc


def _app_get(path: str) -> Any:
    """App-JWT-authenticated GET. Reuses `auth.mint_app_jwt` (the ONLY signer)
    and mirrors the client's typed-error handling. Raises GitHub* on non-2xx."""
    assert path.startswith("/"), "path must be absolute"
    app_jwt = gh_auth.mint_app_jwt()  # GitHubConfigError when unconfigured
    req = urllib.request.Request(
        f"{gh_config.api_base()}{path}",
        method="GET",
        headers={
            "Authorization": f"Bearer {app_jwt}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": _USER_AGENT,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=gh_config.request_timeout_s()) as resp:
            raw = resp.read(_MAX_RESPONSE_BYTES + 1)
            if len(raw) > _MAX_RESPONSE_BYTES:
                raise GitHubServerError(f"Response exceeded cap for {path}")
            if not raw:
                return None
            try:
                return json.loads(raw.decode("utf-8", errors="replace"))
            except json.JSONDecodeError:
                raise GitHubServerError(f"Malformed JSON from GitHub for {path}")
    except urllib.error.HTTPError as e:
        status = e.code
        if status in (401, 403):
            raise GitHubAuthError(f"GitHub rejected the App JWT for {path}", status=status)
        if status == 404:
            raise GitHubNotFoundError(f"GitHub 404 for {path}", status=status)
        if status >= 500:
            raise GitHubServerError(f"GitHub {status} for {path}", status=status)
        raise GitHubError(f"GitHub {status} for {path}", status=status)
    except urllib.error.URLError as e:
        raise GitHubServerError(f"Network error for {path}: {e.reason}")


def get_installation(installation_id: str) -> Dict[str, Any]:
    """Verify an installation belongs to OUR App and is reachable. Returns the
    installation object. Raises GitHubNotFoundError for a forged/foreign/revoked
    id, GitHubAuthError when the App JWT is rejected, GitHubError when the
    returned installation is for a DIFFERENT app id than ours."""
    installation_id = str(installation_id or "").strip()
    if not installation_id or not installation_id.isdigit():
        # GitHub installation ids are numeric; refuse anything else before a call.
        raise GitHubNotFoundError(f"Invalid installation id {installation_id!r}")
    data = _app_get(f"/app/installations/{installation_id}")
    if not isinstance(data, dict) or not data.get("id"):
        raise GitHubNotFoundError("Installation not found")
    # Defence in depth: the JWT already scopes to our App, but assert the app id.
    got_app = str(data.get("app_id") or "")
    ours = str(gh_config.app_id() or "")
    if ours and got_app and got_app != ours:
        raise GitHubError("Installation belongs to a different GitHub App")
    return data


def normalize_repo(repo: Dict[str, Any]) -> Dict[str, Any]:
    """Frontend-safe repo projection for the connect picker — no tokens, no
    secrets, just identity + a couple of display fields."""
    owner = repo.get("owner") if isinstance(repo.get("owner"), dict) else {}
    return {
        "id": str(repo.get("id") or ""),
        "full_name": str(repo.get("full_name") or ""),
        "name": str(repo.get("name") or ""),
        "owner": str(owner.get("login") or ""),
        "private": bool(repo.get("private")),
        "archived": bool(repo.get("archived")),
    }


def list_repositories(installation_id: str) -> List[Dict[str, Any]]:
    """The bounded, authoritative list of repos this installation can access,
    normalized for the frontend picker. Read-only; token minted on the fly."""
    installation_id = str(installation_id or "").strip()
    if not installation_id:
        return []
    client = GitHubClient(installation_id)
    repos = client.list_installation_repositories()
    out: List[Dict[str, Any]] = []
    for r in repos:
        n = normalize_repo(r)
        if n["full_name"]:
            out.append(n)
    return out


def installation_can_access(installation_id: str, repo_full_name: str) -> Optional[Dict[str, Any]]:
    """Server-side check that `repo_full_name` is actually accessible to the
    installation. Returns the normalized repo dict when it is, else None. Case-
    insensitive on the full name (GitHub repo names are case-insensitive)."""
    target = str(repo_full_name or "").strip().strip("/").lower()
    if not target:
        return None
    for r in list_repositories(installation_id):
        if r["full_name"].lower() == target:
            return r
    return None


__all__ = [
    "get_installation", "list_repositories", "installation_can_access",
    "normalize_repo",
]
