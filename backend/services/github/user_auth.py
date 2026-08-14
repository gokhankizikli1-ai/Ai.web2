# coding: utf-8
"""GitHub connector — user-to-server OAuth (install-time identity verification).

WHY THIS EXISTS (security fix)
------------------------------
The GitHub App **Setup URL** `installation_id` can be SPOOFED — GitHub's own docs
warn that a user can substitute a different installation id in the redirect.
Verifying only that (a) our state is valid and (b) the installation belongs to
our App is NOT enough: it does not prove the installation belongs to the GitHub
account of the user who initiated the flow. Without this, a Korvix user who knows
another Korvix-AI installation's id could bind it to their project and read that
account's repositories through our backend installation token.

GitHub's official mitigation is the **user-to-server OAuth** flow ("Request user
authorization (OAuth) during installation"): after install, GitHub returns a
`code` alongside `installation_id`. We exchange the code (with the App's OAuth
Client id/secret) for a short-lived USER access token, then call
`GET /user/installations` with it — which returns ONLY installations of THIS App
that the authenticated user may access. If the callback's `installation_id` is in
that set, the installing user is genuinely authorized for it; otherwise it is a
spoof and is rejected.

DISCIPLINE
----------
* The user access token is used ONLY for this verification and is NEVER persisted
  or logged (no PAT, no token storage).
* This is the EXISTING GitHub App's own OAuth (Client id/secret) — not a second
  identity system. App-JWT → installation-token architecture is unchanged.
"""
from __future__ import annotations

import json
import logging
import urllib.error
import urllib.parse
import urllib.request
from typing import Set

from backend.services.github import config as gh_config
from backend.services.github.errors import (
    GitHubAuthError, GitHubConfigError, GitHubError, GitHubServerError,
)

logger = logging.getLogger(__name__)

_USER_AGENT = "KorvixAI-GitHub-Connector/1.0"
_MAX_RESPONSE_BYTES = 512 * 1024
# Bound the /user/installations walk — an account with an enormous number of
# app installations still terminates. GitHub returns at most 100 per page.
_MAX_INSTALL_PAGES = 5


def exchange_code_for_user_token(code: str) -> str:
    """Exchange the install-time OAuth `code` for a user-to-server access token,
    using the App's Client id/secret. Returns the token (opaque, never logged).
    Raises GitHubConfigError when unconfigured, GitHubAuthError when GitHub
    rejects the code, GitHubServerError on transport failure."""
    code = (code or "").strip()
    if not code:
        raise GitHubAuthError("missing OAuth code")
    client_id = gh_config.app_client_id()
    client_secret = gh_config.app_client_secret()
    if not (client_id and client_secret):
        raise GitHubConfigError("GitHub App OAuth client id/secret not configured")

    data = urllib.parse.urlencode({
        "client_id": client_id,
        "client_secret": client_secret,
        "code": code,
    }).encode("utf-8")
    req = urllib.request.Request(
        gh_config.oauth_token_url(),
        data=data,
        method="POST",
        headers={
            "Accept": "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": _USER_AGENT,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=gh_config.request_timeout_s()) as resp:
            raw = resp.read(_MAX_RESPONSE_BYTES + 1)
            payload = json.loads(raw.decode("utf-8", errors="replace"))
    except urllib.error.HTTPError as e:
        raise GitHubAuthError(f"GitHub rejected the OAuth code (HTTP {e.code})", status=e.code)
    except urllib.error.URLError as e:
        raise GitHubServerError(f"Network error exchanging OAuth code: {e.reason}")
    except json.JSONDecodeError:
        raise GitHubServerError("Malformed JSON from OAuth token endpoint")

    if not isinstance(payload, dict):
        raise GitHubAuthError("Unexpected OAuth token response")
    # GitHub returns {"error": "..."} with HTTP 200 on a bad/expired code.
    if payload.get("error"):
        raise GitHubAuthError(f"OAuth exchange failed: {payload.get('error')}")
    token = payload.get("access_token")
    if not token:
        raise GitHubAuthError("OAuth token response missing access_token")
    return str(token)


def list_user_installation_ids(user_token: str) -> Set[str]:
    """Installation ids of OUR App that the AUTHENTICATED user may access
    (`GET /user/installations`). Bounded pagination. Because the token is scoped
    to our App's OAuth, this set is inherently limited to our App's installations
    the user is authorized for — the authoritative answer to "does this user own /
    belong to this installation"."""
    user_token = (user_token or "").strip()
    if not user_token:
        return set()
    ids: Set[str] = set()
    url = f"{gh_config.api_base()}/user/installations?per_page=100"
    pages = 0
    while url and pages < _MAX_INSTALL_PAGES:
        req = urllib.request.Request(
            url,
            method="GET",
            headers={
                "Authorization": f"token {user_token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": _USER_AGENT,
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=gh_config.request_timeout_s()) as resp:
                raw = resp.read(_MAX_RESPONSE_BYTES + 1)
                if len(raw) > _MAX_RESPONSE_BYTES:
                    raise GitHubServerError("Response exceeded cap for /user/installations")
                payload = json.loads(raw.decode("utf-8", errors="replace"))
                link = (resp.headers.get("Link") or resp.headers.get("link") or "")
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                raise GitHubAuthError(f"User token rejected by /user/installations (HTTP {e.code})", status=e.code)
            raise GitHubServerError(f"GitHub {e.code} for /user/installations", status=e.code)
        except urllib.error.URLError as e:
            raise GitHubServerError(f"Network error for /user/installations: {e.reason}")
        except json.JSONDecodeError:
            raise GitHubServerError("Malformed JSON from /user/installations")

        installs = payload.get("installations") if isinstance(payload, dict) else None
        for inst in (installs or []):
            if isinstance(inst, dict) and inst.get("id") is not None:
                ids.add(str(inst["id"]))
        pages += 1
        url = _next_link(link)
    return ids


def user_can_access_installation(user_token: str, installation_id: str) -> bool:
    """True iff `installation_id` is one the authenticated user may access — the
    provider-verified relationship that defeats installation_id spoofing."""
    installation_id = str(installation_id or "").strip()
    if not installation_id:
        return False
    try:
        return installation_id in list_user_installation_ids(user_token)
    except GitHubError:
        raise
    except Exception:  # pragma: no cover — defensive; treat unknown as unverified
        return False


def _next_link(link_header: str) -> str:
    if not link_header:
        return ""
    for part in link_header.split(","):
        segs = part.split(";")
        if len(segs) < 2:
            continue
        url = segs[0].strip().strip("<>")
        if 'rel="next"' in "".join(segs[1:]):
            return url
    return ""


__all__ = [
    "exchange_code_for_user_token", "list_user_installation_ids",
    "user_can_access_installation",
]
