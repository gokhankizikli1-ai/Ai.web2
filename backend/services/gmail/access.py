# coding: utf-8
"""Gmail connector — central access-token provider.

ONE PLACE THAT TURNS A CONNECTION INTO A USABLE ACCESS TOKEN
------------------------------------------------------------
Mirrors `github.auth.get_installation_token`: routes and the read client never
touch the refresh grant directly. They call `access_token_for(conn)` which:

  1. returns the cached access token when it is still valid (outside the
     refresh-skew window), or
  2. refreshes it from the stored (encrypted) refresh token, PERSISTS the new
     access token + expiry, and returns it.

FAILURE SEMANTICS
-----------------
* A refresh rejected with `invalid_grant` (revoked / expired refresh token)
  marks the connection REVOKED and wipes its credential material, then raises
  GmailAuthError — a caller must treat this as "reconnect required", never as
  "no data".
* CredentialEncryptionError (key missing/rotated-away) propagates unchanged so
  the connector fails closed rather than silently losing access.

The decrypted access/refresh tokens live only in local variables for the
duration of a call — never logged, never returned to the frontend.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Optional

from backend.services.gmail import oauth as gm_oauth
from backend.services.gmail import store as gm_store
from backend.services.gmail.errors import GmailAuthError, GmailOAuthError
from backend.services.gmail.store import GmailConnection

logger = logging.getLogger(__name__)

# Refresh an access token this many seconds BEFORE it actually expires, so an
# in-flight request never races the expiry boundary (mirrors github's skew).
_REFRESH_SKEW_S = 120


def _now() -> datetime:
    return datetime.utcnow()


def _parse_iso(ts: str) -> Optional[datetime]:
    try:
        return datetime.fromisoformat(str(ts).replace("Z", ""))
    except Exception:
        return None


def _cached_token_valid(conn: GmailConnection, *, now: datetime) -> bool:
    if not conn.access_token_enc or not conn.access_token_expires:
        return False
    exp = _parse_iso(conn.access_token_expires)
    if exp is None:
        return False
    return (exp - timedelta(seconds=_REFRESH_SKEW_S)) > now


def access_token_for(conn: GmailConnection) -> str:
    """Return a valid Gmail access token for `conn`, refreshing + persisting if
    necessary.

    Raises:
      * GmailAuthError — the connection is revoked, carries no refresh token, or
        the refresh was rejected (invalid_grant). The connection is marked
        revoked on an invalid_grant.
      * GmailOAuthError / GmailServerError — a transient/config refresh failure
        (connection is NOT revoked; a retry may succeed).
      * CredentialEncryptionError — encryption key unavailable (fail closed).
    """
    if conn is None or conn.is_revoked:
        raise GmailAuthError("Gmail connection is revoked — reconnect required")

    now = _now()
    if _cached_token_valid(conn, now=now):
        return gm_store.decrypt_access_token(conn)

    refresh_token = gm_store.decrypt_refresh_token(conn)
    if not refresh_token:
        raise GmailAuthError("Gmail connection has no refresh token — reconnect required")

    try:
        tok = gm_oauth.refresh_access_token(refresh_token)
    except GmailOAuthError as exc:
        if (exc.reason or "").lower() == "invalid_grant":
            # The user revoked access at Google, or the token expired. Fail
            # closed and require a reconnect; never keep a dead credential.
            gm_store.mark_revoked(conn.project_id)
            raise GmailAuthError(
                "Gmail authorization was revoked at Google — reconnect required"
            ) from exc
        raise

    expires_at = (now + timedelta(seconds=max(0, tok.expires_in))).isoformat() + "Z"
    gm_store.update_access_token(
        conn.project_id, access_token=tok.access_token, expires_at=expires_at,
    )
    return tok.access_token


def force_refresh(conn: GmailConnection) -> str:
    """Unconditionally refresh the access token (ignoring the cached one) and
    persist it. Used after a mid-request 401, where a cached token that looks
    valid-by-expiry was actually rejected. Same failure semantics as
    `access_token_for` (invalid_grant → mark revoked → GmailAuthError)."""
    latest = gm_store.get_connection(conn.project_id) or conn
    if latest.is_revoked:
        raise GmailAuthError("Gmail connection is revoked — reconnect required")
    refresh_token = gm_store.decrypt_refresh_token(latest)
    if not refresh_token:
        raise GmailAuthError("Gmail connection has no refresh token — reconnect required")
    try:
        tok = gm_oauth.refresh_access_token(refresh_token)
    except GmailOAuthError as exc:
        if (exc.reason or "").lower() == "invalid_grant":
            gm_store.mark_revoked(latest.project_id)
            raise GmailAuthError(
                "Gmail authorization was revoked at Google — reconnect required"
            ) from exc
        raise
    expires_at = (_now() + timedelta(seconds=max(0, tok.expires_in))).isoformat() + "Z"
    gm_store.update_access_token(
        latest.project_id, access_token=tok.access_token, expires_at=expires_at,
    )
    return tok.access_token


def fresh_connection(conn: GmailConnection) -> GmailConnection:
    """Re-read the connection after a possible token refresh so a caller sees the
    persisted access token/expiry. Falls back to the input on a read miss."""
    latest = gm_store.get_connection(conn.project_id)
    return latest or conn


__all__ = ["access_token_for", "force_refresh", "fresh_connection"]
