# coding: utf-8
"""The single authority on whether a Google token may be REVOKED REMOTELY.

THE PROBLEM THIS SOLVES
-----------------------
Korvix has two Google-backed connectors — Gmail (`gmail.readonly`) and Google
Calendar (`calendar.events.readonly`) — and, by design, they reuse ONE Google
OAuth Web client (creating a second Google auth system is exactly what the
connector architecture forbids; see `google_calendar.config`).

Google models consent as ONE GRANT per (client_id, end user). When a user has
authorized both scopes for the same client, the two consents live in a single
grant record — which is why `myaccount.google.com` shows one "KorvixAI" entry
listing both permissions. Consequently, POSTing either connector's refresh token
to `https://oauth2.googleapis.com/revoke` can invalidate the WHOLE grant, taking
the sibling connector's refresh token down with it.

So the naive "disconnect ⇒ revoke remotely" behaviour, correct for a connector
that owns its client outright, becomes a cross-connector footgun here:
disconnecting Calendar would silently break Gmail (and vice versa).

THE RULE
--------
Disconnect ALWAYS deletes Korvix's locally stored credential material — that is
the action that actually ends Korvix's access, it is purely local, and it can
never fail because of another connector. The REMOTE revoke is an extra courtesy,
and it is performed only when it is provably safe:

    remote revoke is safe  ⟺  the connectors do NOT share a Google client
                              OR no sibling connector holds a live connection
                                 for the same Google account

The predicate FAILS CLOSED: when the account identity is unknown (blank), or a
sibling store cannot be read, it returns False (skip the remote revoke) rather
than risk destroying a working sibling connection. Skipping is safe — the local
credentials are gone either way, and the user can remove the grant entirely at
myaccount.google.com (the same escape hatch the Vercel card already documents).

WHY A SHARED MODULE AND NOT A COPY IN EACH ROUTE
-------------------------------------------------
This is one rule about one shared external resource (the Google grant). Putting
it in one place means adding a third Google connector later extends ONE list,
and neither connector package has to import the other's internals.
"""
from __future__ import annotations

import logging
from typing import Callable, Dict

logger = logging.getLogger(__name__)

PROVIDER_GMAIL = "gmail"
PROVIDER_CALENDAR = "calendar"


def _gmail_live_connections(google_email: str, exclude_project_id: str) -> int:
    from backend.services.gmail import store as gm_store
    return gm_store.count_connected_for_email(
        google_email, exclude_project_id=exclude_project_id)


def _calendar_live_connections(google_email: str, exclude_project_id: str) -> int:
    from backend.services.google_calendar import store as cal_store
    return cal_store.count_connected_for_email(
        google_email, exclude_project_id=exclude_project_id)


# provider key → "how many LIVE connections does this connector hold for this
# Google account, ignoring one project?". Extend this map (and nothing else)
# when a third Google connector ships.
_LIVE_CONNECTION_COUNTERS: Dict[str, Callable[[str, str], int]] = {
    PROVIDER_GMAIL: _gmail_live_connections,
    PROVIDER_CALENDAR: _calendar_live_connections,
}


def _shares_google_client() -> bool:
    """True when the Google connectors resolve to the SAME OAuth client id (the
    default deployment). False when an operator has given each its own client —
    then each grant is independent and a remote revoke is unconditionally safe.
    Any failure to determine this is treated as SHARED (fail closed)."""
    try:
        from backend.services.google_calendar import config as cal_config
        return cal_config.shares_google_client_with_gmail()
    except Exception:  # pragma: no cover — defensive
        return True


def remote_revoke_is_safe(*, provider: str, google_email: str,
                          project_id: str = "") -> bool:
    """May `provider` POST its token to Google's revoke endpoint right now?

    `provider` is the connector performing the disconnect ("gmail" | "calendar")
    and `project_id` the project it is disconnecting. EVERY Google connector is
    scanned — including `provider` itself — with that one project excluded, so
    the check also catches "the same Google account is still connected to a
    DIFFERENT Korvix project through this very connector". Returns False — skip
    the remote revoke — whenever any live sibling connection remains under a
    shared OAuth client, or whenever safety cannot be established.

    Call this BEFORE deleting the local connection row, so the row being removed
    is the only one excluded.

    Purely a read; it mutates nothing and never raises."""
    provider = str(provider or "").strip().lower()
    email = str(google_email or "").strip()
    pid = str(project_id or "").strip()
    if not email:
        # Identity unknown ⇒ we cannot prove no sibling shares this account.
        return False
    if provider not in _LIVE_CONNECTION_COUNTERS:
        # An unregistered provider has no counter, so the scan below would skip
        # its own connections entirely and could answer "safe" for a grant we
        # cannot actually reason about. Fail closed, in BOTH client
        # configurations — the separate-client branch already did.
        return False
    if not _shares_google_client():
        # Independent Google clients ⇒ independent grants for the OTHER
        # connectors. This connector's own other projects still share a client
        # with themselves, so they are still checked below.
        counter = _LIVE_CONNECTION_COUNTERS.get(provider)
        if counter is None:
            return False
        try:
            return counter(email, pid) <= 0
        except Exception:  # pragma: no cover — defensive
            return False
    for key, counter in _LIVE_CONNECTION_COUNTERS.items():
        try:
            if counter(email, pid if key == provider else "") > 0:
                return False
        except Exception:  # pragma: no cover — defensive
            return False
    return True


def _gmail_live_authorizations(google_email: str, exclude_authorization_id: str) -> int:
    from backend.services.gmail import store as gm_store
    return gm_store.count_live_authorizations_for_email(
        google_email, exclude_authorization_id=exclude_authorization_id)


def _calendar_live_authorizations(google_email: str, exclude_authorization_id: str) -> int:
    from backend.services.google_calendar import store as cal_store
    return cal_store.count_live_authorizations_for_email(
        google_email, exclude_authorization_id=exclude_authorization_id)


# provider key → "how many LIVE ACCOUNT AUTHORIZATIONS does this connector hold
# for this Google account, ignoring one of them?". Extend this map (and nothing
# else) when a third Google connector ships.
_LIVE_AUTHORIZATION_COUNTERS: Dict[str, Callable[[str, str], int]] = {
    PROVIDER_GMAIL: _gmail_live_authorizations,
    PROVIDER_CALENDAR: _calendar_live_authorizations,
}


def remote_revoke_is_safe_for_authorization(
    *, provider: str, google_email: str, authorization_id: str = "",
) -> bool:
    """The ACCOUNT-LEVEL counterpart of `remote_revoke_is_safe`.

    Since Korvix moved provider authorization from per-project rows to ONE
    account-level authorization per (owner, provider, Google account), the right
    question at an account disconnect is no longer "does another PROJECT still
    use this?" but "does another Google AUTHORIZATION still depend on this
    grant?". An authorization with zero project bindings still holds a live
    grant, so counting bindings would under-count and wrongly permit a revoke
    that breaks the sibling connector.

    Same fail-closed contract: an unknown account identity, an unreadable store,
    or an unknown provider all return False (skip the remote revoke). Skipping is
    safe — the local credential is deleted either way, and the user can remove
    the grant entirely at myaccount.google.com.

    Call this BEFORE deleting the authorization, so the row being removed is the
    only one excluded."""
    provider = str(provider or "").strip().lower()
    email = str(google_email or "").strip()
    auth_id = str(authorization_id or "").strip()
    if not email:
        # Identity unknown ⇒ we cannot prove no sibling shares this account.
        return False
    if provider not in _LIVE_AUTHORIZATION_COUNTERS:
        # See the note in `remote_revoke_is_safe`: an unregistered provider is
        # not something this guard can reason about, so it never gets a "safe".
        return False
    if not _shares_google_client():
        counter = _LIVE_AUTHORIZATION_COUNTERS.get(provider)
        if counter is None:
            return False
        try:
            return counter(email, auth_id) <= 0
        except Exception:  # pragma: no cover — defensive
            return False
    for key, counter in _LIVE_AUTHORIZATION_COUNTERS.items():
        try:
            if counter(email, auth_id if key == provider else "") > 0:
                return False
        except Exception:  # pragma: no cover — defensive
            return False
    return True


__all__ = [
    "PROVIDER_GMAIL", "PROVIDER_CALENDAR", "remote_revoke_is_safe",
    "remote_revoke_is_safe_for_authorization",
]
