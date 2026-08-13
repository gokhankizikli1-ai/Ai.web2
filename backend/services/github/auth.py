# coding: utf-8
"""GitHub App authentication — private key → App JWT → installation token.

FLOW (the correct production architecture — NOT a permanent PAT)
----------------------------------------------------------------
    private key (PEM, env)                     [never leaves the backend]
        │  RS256 sign, ≤10 min TTL
        ▼
    App JWT  (proves "I am this GitHub App")
        │  POST /app/installations/{id}/access_tokens
        ▼
    installation access token  (short-lived, ~1h, scoped to the install)
        │  Authorization: Bearer
        ▼
    GitHub REST API (read-only, per the App's granted permissions)

The installation token is TREATED AS SHORT-LIVED: it is cached in-process only
until shortly before its expiry, then transparently re-minted. It is NEVER
persisted as a long-term credential (no DB row, no disk) — a process restart
simply re-mints, and a leaked DB can never yield a live token.

LAZY CRYPTO IMPORT
------------------
`PyJWT` (+ `cryptography`) is imported INSIDE `mint_app_jwt` rather than at
module top. That keeps this module importable in environments where the native
crypto backend is unavailable (and lets the whole test-suite mock the mint /
token seams without ever invoking RSA). Production imports it lazily on first
real auth.

SECRET DISCIPLINE
-----------------
The private key, the App JWT, and the installation token are NEVER logged,
returned to a caller as data, or placed in an observation. `redact()` exists so
any accidental interpolation of a token into a log line is scrubbed.
"""
from __future__ import annotations

import json
import logging
import threading
import time
import urllib.error
import urllib.request
from typing import Dict, Optional, Tuple

from backend.services.github import config as gh_config
from backend.services.github.errors import (
    GitHubAuthError, GitHubConfigError, GitHubError, GitHubNotFoundError,
    GitHubRateLimitError, GitHubServerError,
)

logger = logging.getLogger(__name__)

# Mint the App JWT with a short TTL. GitHub allows ≤10 min; we use 9 to leave
# headroom for clock skew (GitHub rejects a JWT whose `iat` is in the future,
# so we also backdate `iat` by 60s).
_JWT_TTL_S = 9 * 60
_JWT_IAT_BACKDATE_S = 60
# Re-mint an installation token this many seconds BEFORE it actually expires,
# so an in-flight request never races the expiry boundary.
_TOKEN_REFRESH_SKEW_S = 5 * 60
_USER_AGENT = "KorvixAI-GitHub-Connector/1.0"


# ── Secret redaction ────────────────────────────────────────────────────────

def redact(text: str) -> str:
    """Scrub anything token-shaped from a string before it could reach a log.
    Defence-in-depth: the code paths below never log secrets in the first
    place, but a future edit that interpolates one is neutralised here."""
    if not text:
        return text
    out = []
    for tok in str(text).split():
        low = tok.lower()
        if (tok.startswith(("ghs_", "ghu_", "github_pat_", "ey"))
                or "private key" in low or "-----begin" in low):
            out.append("[REDACTED]")
        else:
            out.append(tok)
    return " ".join(out)


# ── App JWT ─────────────────────────────────────────────────────────────────

def mint_app_jwt(*, now: Optional[int] = None) -> str:
    """Sign a short-lived RS256 App JWT from the configured App id + private
    key. Raises GitHubConfigError when unconfigured. The crypto import is lazy
    (see module docstring) so this is the ONLY function that touches PyJWT.

    Tests monkeypatch THIS function (or `get_installation_token`) to avoid
    needing a real key / the native crypto backend."""
    app_id = gh_config.app_id()
    key = gh_config.private_key()
    if not (app_id and key):
        raise GitHubConfigError("GitHub App id / private key not configured")

    iat = int(now if now is not None else time.time()) - _JWT_IAT_BACKDATE_S
    payload = {"iat": iat, "exp": iat + _JWT_IAT_BACKDATE_S + _JWT_TTL_S, "iss": str(app_id)}
    try:
        import jwt  # lazy — PyJWT[crypto]
        token = jwt.encode(payload, key, algorithm="RS256")
    except GitHubError:  # pragma: no cover — never reached; kept for clarity
        raise
    except Exception as exc:
        # A malformed key or missing crypto backend surfaces as config, not a
        # transient fault — retrying won't help.
        raise GitHubConfigError(f"Failed to sign App JWT: {type(exc).__name__}") from exc
    # PyJWT<2 returned bytes; normalise.
    return token.decode("utf-8") if isinstance(token, (bytes, bytearray)) else token


# ── Installation token acquisition + cache ──────────────────────────────────

class _CacheEntry:
    __slots__ = ("token", "expires_at")

    def __init__(self, token: str, expires_at: int):
        self.token = token
        self.expires_at = expires_at


# process-local cache: installation_id → entry. Guarded by a lock so two
# concurrent requests don't both mint. Never touches disk.
_CACHE: Dict[str, _CacheEntry] = {}
_CACHE_LOCK = threading.Lock()


def _parse_expiry(expires_at_iso: str, *, now: int) -> int:
    """GitHub returns `expires_at` as ISO-8601 (`2024-01-01T00:00:00Z`). Parse
    to epoch seconds; fall back to now+50min if the shape is unexpected (still
    short-lived, so a parse hiccup can never yield a long-lived credential)."""
    try:
        from datetime import datetime, timezone
        s = expires_at_iso.strip().replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return int(dt.timestamp())
    except Exception:
        return now + 50 * 60


def _mint_installation_token(installation_id: str, *, now: int) -> Tuple[str, int]:
    """POST /app/installations/{id}/access_tokens with the App JWT.

    This is the ONLY non-GET call the connector makes to GitHub, and it is an
    AUTHENTICATION call (mint a read-only-scoped token), not a repository
    mutation — it cannot push, merge, comment, or change any repo state. The
    minted token inherits ONLY the App's granted (read-only) permissions.
    """
    app_jwt = mint_app_jwt(now=now)
    url = f"{gh_config.api_base()}/app/installations/{installation_id}/access_tokens"
    req = urllib.request.Request(
        url,
        data=b"",  # empty body — request the full read-only permission set
        method="POST",
        headers={
            "Authorization": f"Bearer {app_jwt}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": _USER_AGENT,
            "Content-Length": "0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=gh_config.request_timeout_s()) as resp:
            body = resp.read(64 * 1024)
            data = json.loads(body.decode("utf-8", errors="replace"))
    except urllib.error.HTTPError as e:
        status = e.code
        if status in (401, 403):
            # 403 here may be a rate limit on the App JWT — distinguish it.
            reset = _rate_limit_reset(e)
            if reset is not None or status == 403 and _is_rate_limited(e):
                raise GitHubRateLimitError(
                    "GitHub rate limit while minting installation token",
                    status=status, reset_at=reset,
                )
            raise GitHubAuthError(
                f"GitHub rejected App JWT / installation (HTTP {status})", status=status,
            )
        if status == 404:
            raise GitHubNotFoundError(
                f"Installation {installation_id} not found or revoked", status=status,
            )
        if status == 429:
            raise GitHubRateLimitError(
                "GitHub rate limit while minting installation token",
                status=status, reset_at=_rate_limit_reset(e),
            )
        if status >= 500:
            raise GitHubServerError(f"GitHub {status} minting installation token", status=status)
        raise GitHubAuthError(f"GitHub {status} minting installation token", status=status)
    except urllib.error.URLError as e:
        raise GitHubServerError(f"Network error minting installation token: {e.reason}")
    except json.JSONDecodeError:
        raise GitHubServerError("Malformed token response from GitHub")

    token = data.get("token") if isinstance(data, dict) else None
    if not token:
        raise GitHubAuthError("GitHub token response missing `token`")
    expires_at = _parse_expiry(str(data.get("expires_at") or ""), now=now)
    return str(token), expires_at


def _is_rate_limited(e: "urllib.error.HTTPError") -> bool:
    try:
        return "rate limit" in (e.read().decode("utf-8", errors="replace").lower())
    except Exception:
        return False


def _rate_limit_reset(e: "urllib.error.HTTPError") -> Optional[int]:
    try:
        val = e.headers.get("X-RateLimit-Reset") if getattr(e, "headers", None) else None
        return int(val) if val else None
    except (TypeError, ValueError):
        return None


def get_installation_token(installation_id: str, *, now: Optional[int] = None) -> str:
    """Return a valid installation access token for `installation_id`, minting
    (and caching) one if the cache is empty or the cached token is within the
    refresh-skew window of expiry. Thread-safe; never persists the token.

    Raises the typed GitHub* errors on failure — a caller must NOT treat a
    failure as "no data"."""
    if not installation_id:
        raise GitHubConfigError("installation_id is required")
    iid = str(installation_id)
    t_now = int(now if now is not None else time.time())

    with _CACHE_LOCK:
        entry = _CACHE.get(iid)
        if entry is not None and entry.expires_at - _TOKEN_REFRESH_SKEW_S > t_now:
            return entry.token

    # Mint outside the lock only if we could double-mint; keep it simple and
    # correct by minting under the lock (token minting is rare — once per hour
    # per installation — so lock contention is a non-issue).
    with _CACHE_LOCK:
        entry = _CACHE.get(iid)
        if entry is not None and entry.expires_at - _TOKEN_REFRESH_SKEW_S > t_now:
            return entry.token
        token, expires_at = _mint_installation_token(iid, now=t_now)
        _CACHE[iid] = _CacheEntry(token, expires_at)
        return token


def invalidate_installation_token(installation_id: str) -> None:
    """Drop a cached token (e.g. after a 401 mid-request forces a re-mint)."""
    with _CACHE_LOCK:
        _CACHE.pop(str(installation_id), None)


def _reset_cache_for_tests() -> None:
    with _CACHE_LOCK:
        _CACHE.clear()


__all__ = [
    "redact", "mint_app_jwt", "get_installation_token",
    "invalidate_installation_token",
]
