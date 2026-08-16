# coding: utf-8
"""Google Calendar connector — connection projection over the SHARED connector
authority.

WHAT CHANGED (and why this file is now an adapter)
--------------------------------------------------
Calendar used to own a `calendar_connections` table keyed by `project_id`, so the
OAuth grant itself was project-scoped. Authorization is now ACCOUNT-LEVEL and
lives in the shared authority (`backend.services.connectors.store`):

    connector_authorizations      one Google account, authorized once per owner
                                  (holds the encrypted refresh/access token)
    connector_project_bindings    which projects may read which CALENDAR of it

The per-project resource is the CALENDAR id ('primary' in v1), so binding a
second calendar later is a data change, not a schema change.

ISOLATION FROM GMAIL — STILL EXACT
-----------------------------------
Gmail and Calendar may share ONE Google OAuth client, but they remain two
logically distinct authorizations: they are separate rows (different `provider`),
each holding the credential issued for ITS consent with ITS scope, and each with
its own status/last-sync lifecycle. A Calendar connect/disconnect never
read-modify-writes the Gmail authorization; Gmail's rows are only ever READ,
without mutation, by the remote-revoke safety guard in
`backend.services.google_grant`.

This module keeps the SAME public surface (`CalendarConnection`,
`get_connection`, `upsert_connection`, …) so the sync/access/ingest layers, the
routes and their tests are unchanged.

SECRETS
-------
Unchanged: refresh/access tokens are stored ONLY as encrypted envelopes from the
ONE credential authority (`gmail.crypto`, keyed by
`KORVIX_CREDENTIAL_ENCRYPTION_KEY`). `public_view()` carries no token material.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Dict, Optional

from backend.services.connectors import registry, store as shared
from backend.services.google_calendar import config as cal_config

logger = logging.getLogger(__name__)

#: Convenience alias — the shared store resolves its file lazily, so repointing
#: PROJECTS_DB_PATH is what actually moves the data.
DB_PATH = shared.DB_PATH

PROVIDER = registry.PROVIDER_CALENDAR

STATUS_CONNECTED = "connected"
STATUS_REVOKED = "revoked"


@dataclass(frozen=True)
class CalendarConnection:
    project_id: str
    owner_user_id: str
    provider: str
    google_email: str
    calendar_id: str
    time_zone: str
    scopes: str
    refresh_token_enc: str
    access_token_enc: str
    access_token_expires: str
    status: str
    created_at: str
    updated_at: str
    last_sync_at: str
    #: Shared-authority id of the account authorization backing this connection.
    authorization_id: str = ""

    @property
    def is_revoked(self) -> bool:
        return self.status == STATUS_REVOKED

    def public_view(self) -> Dict[str, Any]:
        """Frontend-safe projection — carries NO token/secret material, only the
        connection's identity + lifecycle metadata."""
        return {
            "project_id": self.project_id,
            "provider": self.provider,
            "google_email": self.google_email,
            "calendar_id": self.calendar_id,
            "time_zone": self.time_zone,
            "scopes": [s for s in (self.scopes or "").split(" ") if s],
            "status": self.status,
            "connected": self.status == STATUS_CONNECTED,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "last_sync_at": self.last_sync_at or None,
        }


def init_calendar_tables() -> None:
    """Idempotent, additive bring-up of the shared tables."""
    shared.init_tables()


def _account_key(owner_user_id: str, google_email: str) -> str:
    """The provider account identity used to dedupe authorizations.

    Normally the calendar's account label. `fetch_calendar_identity` is
    explicitly best-effort (failing it must not abort a successful token
    exchange), so when the label is unknown we key by a DETERMINISTIC per-owner
    placeholder instead of refusing the connection. It is scoped to the owner, so
    it can never collide with another account, and `update_calendar_metadata`
    promotes it to the real label as soon as a sync learns one."""
    email = str(google_email or "").strip().lower()
    return email or f"pending:{owner_user_id}"


def _project(auth: shared.Authorization, binding: shared.Binding) -> CalendarConnection:
    revoked = auth.is_revoked or binding.status == shared.BIND_REVOKED
    return CalendarConnection(
        project_id=binding.project_id,
        owner_user_id=binding.owner_user_id,
        provider=PROVIDER,
        google_email=auth.account_label or auth.account_key,
        calendar_id=binding.resource_id or cal_config.PRIMARY_CALENDAR_ID,
        time_zone=str(binding.resource.get("time_zone") or ""),
        scopes=auth.scopes,
        refresh_token_enc=("" if revoked else auth.credential("refresh_token")),
        access_token_enc=("" if revoked else auth.credential("access_token")),
        access_token_expires=("" if revoked
                              else str(auth.metadata.get("access_token_expires") or "")),
        status=STATUS_REVOKED if revoked else STATUS_CONNECTED,
        created_at=binding.created_at or auth.created_at,
        updated_at=max(binding.updated_at or "", auth.updated_at or ""),
        last_sync_at=binding.last_sync_at,
        authorization_id=auth.id,
    )


def upsert_connection(
    *, project_id: str, owner_user_id: str, google_email: str = "",
    calendar_id: str = "", time_zone: str = "", scopes: str = "",
    refresh_token: str, access_token: str = "", access_token_expires: str = "",
) -> Optional[CalendarConnection]:
    """Authorize the Google account for `owner_user_id` (once) and bind a calendar
    of it to `project_id`.

    The refresh token (and any access token) are ENCRYPTED by the shared store —
    it raises CredentialEncryptionError if encryption is unavailable, so a
    plaintext token can never reach disk. On a reconnect that yields no new
    refresh token (Google omits it), the caller must pass the previously-decrypted
    refresh token so the authorization keeps a usable credential. `owner_user_id`
    MUST be the project's real owner (the route resolves it from the OAuth state /
    project, never from client input)."""
    project_id = str(project_id or "").strip()
    owner_user_id = str(owner_user_id or "").strip()
    email = str(google_email or "").strip()
    if not project_id or not owner_user_id:
        return None
    if not refresh_token:
        # Never store an authorization without a usable refresh credential.
        return None

    auth = shared.upsert_authorization(
        owner_user_id=owner_user_id, provider=PROVIDER,
        account_key=_account_key(owner_user_id, email), account_label=email,
        scopes=str(scopes or ""),
        credentials={"refresh_token": refresh_token, "access_token": access_token},
        metadata={"access_token_expires": str(access_token_expires or "")},
    )
    if auth is None:
        return None
    cal_id = str(calendar_id or cal_config.PRIMARY_CALENDAR_ID).strip() \
        or cal_config.PRIMARY_CALENDAR_ID
    bindings = shared.set_binding(
        project_id=project_id, authorization_id=auth.id, owner_user_id=owner_user_id,
        resources=[{
            "resource_id": cal_id, "resource_label": cal_id,
            "resource": {"time_zone": str(time_zone or "")},
        }],
        status=shared.BIND_CONNECTED,
    )
    if not bindings:
        return None
    return get_connection(project_id)


def authorize_account(
    *, owner_user_id: str, google_email: str = "", scopes: str = "",
    refresh_token: str, access_token: str = "", access_token_expires: str = "",
) -> Optional[shared.Authorization]:
    """ACCOUNT-LEVEL authorization: store the Google grant for this owner and
    bind it to NOTHING.

    This is the "authorize once" entry point. Connecting a provider must never,
    by itself, expose it to a project — a project binding is a separate,
    explicit act (see `bind_project`)."""
    owner_user_id = str(owner_user_id or "").strip()
    if not owner_user_id or not refresh_token:
        return None
    email = str(google_email or "").strip()
    return shared.upsert_authorization(
        owner_user_id=owner_user_id, provider=PROVIDER,
        account_key=_account_key(owner_user_id, email), account_label=email,
        scopes=str(scopes or ""),
        credentials={"refresh_token": refresh_token, "access_token": access_token},
        metadata={"access_token_expires": str(access_token_expires or "")},
    )


def bind_project(
    *, project_id: str, owner_user_id: str, authorization_id: str,
    calendar_id: str = "", time_zone: str = "",
) -> Optional[CalendarConnection]:
    """Bind an EXISTING account authorization to another project — the
    "authorize once, use in many projects" path. No OAuth involved."""
    auth = shared.get_authorization(authorization_id)
    if auth is None or auth.provider != PROVIDER:
        return None
    cal_id = str(calendar_id or cal_config.PRIMARY_CALENDAR_ID).strip() \
        or cal_config.PRIMARY_CALENDAR_ID
    bindings = shared.set_binding(
        project_id=project_id, authorization_id=auth.id,
        owner_user_id=str(owner_user_id or "").strip(),
        resources=[{
            "resource_id": cal_id, "resource_label": cal_id,
            "resource": {"time_zone": str(time_zone or "")},
        }],
        status=shared.BIND_CONNECTED,
    )
    if not bindings:
        return None
    return get_connection(project_id)


def get_connection(project_id: str) -> Optional[CalendarConnection]:
    binding = shared.get_binding(str(project_id or ""), PROVIDER)
    if binding is None:
        return None
    auth = shared.get_authorization(binding.authorization_id)
    if auth is None:
        return None
    return _project(auth, binding)


def get_authorization_for_owner(owner_user_id: str) -> Optional[shared.Authorization]:
    """The owner's Calendar authorization (account level), independent of projects."""
    return shared.find_authorization(owner_user_id=owner_user_id, provider=PROVIDER)


def update_access_token(project_id: str, *, access_token: str, expires_at: str) -> bool:
    """Persist a freshly-refreshed access token (encrypted) + its expiry on the
    ACCOUNT authorization, so every bound project benefits from one refresh."""
    conn = get_connection(project_id)
    if conn is None or not conn.authorization_id:
        return False
    ok = shared.update_credentials(conn.authorization_id, {"access_token": access_token})
    if ok:
        shared.update_metadata(
            conn.authorization_id, {"access_token_expires": str(expires_at or "")})
    return ok


def update_calendar_metadata(project_id: str, *, google_email: str = "",
                             calendar_id: str = "", time_zone: str = "") -> bool:
    """Refresh the cached display identity (calendar label / id / timezone) the
    sync learned from the provider. Non-empty values only — a provider read that
    omits a field never blanks a previously known one. Touches NO credential.

    The ACCOUNT address updates the authorization; the calendar id / timezone are
    per-project resource facts and update the binding."""
    conn = get_connection(project_id)
    if conn is None:
        return False
    changed = False
    email = str(google_email or "").strip()
    authorization_id = conn.authorization_id
    if email and authorization_id:
        # Promote a placeholder-keyed authorization to its REAL account identity
        # (and dedupe onto an existing one for the same owner + account). The
        # rekey returns the surviving authorization id.
        survivor = shared.rekey_authorization(
            authorization_id, account_key=email.lower(), account_label=email)
        if survivor:
            authorization_id = survivor
            changed = True
        else:
            changed = shared.update_account_label(authorization_id, email) or changed
    cal_id = str(calendar_id or "").strip()
    tz = str(time_zone or "").strip()
    if cal_id or tz:
        resources = [{
            "resource_id": cal_id or conn.calendar_id,
            "resource_label": cal_id or conn.calendar_id,
            "resource": {"time_zone": tz or conn.time_zone},
        }]
        written = shared.set_binding(
            project_id=conn.project_id, authorization_id=authorization_id,
            owner_user_id=conn.owner_user_id, resources=resources,
            status=shared.BIND_CONNECTED,
        )
        changed = bool(written) or changed
    return changed


def mark_synced(project_id: str) -> None:
    project_id = str(project_id or "").strip()
    if not project_id:
        return
    shared.mark_binding_synced(project_id, PROVIDER)
    conn = get_connection(project_id)
    if conn and conn.authorization_id:
        shared.mark_authorization_synced(conn.authorization_id)


def mark_revoked(project_id: str) -> bool:
    """The stored grant was REJECTED by Google — account-level truth, so the
    authorization is flagged revoked and its credential material wiped. Every
    project bound to it is marked revoked with it; the rows are retained so the
    UI can offer a one-click reconnect."""
    conn = get_connection(project_id)
    if conn is None or not conn.authorization_id:
        return False
    return shared.mark_authorization_revoked(conn.authorization_id)


def delete_connection(project_id: str) -> bool:
    """PROJECT-level disconnect: drop this project's binding.

    The account authorization survives as long as ANOTHER project still uses it.
    When this was the LAST binding, the authorization (and its credentials) is
    deleted too — exactly the previous single-project behaviour."""
    project_id = str(project_id or "").strip()
    conn = get_connection(project_id)
    if conn is None:
        return False
    authorization_id = conn.authorization_id
    removed = shared.delete_project_binding(project_id, PROVIDER)
    if removed and authorization_id and shared.count_project_bindings(authorization_id) == 0:
        shared.delete_authorization(authorization_id)
    return removed


def delete_authorization(authorization_id: str) -> bool:
    """ACCOUNT-level disconnect: remove the authorization and EVERY project
    binding that depends on it."""
    auth = shared.get_authorization(authorization_id)
    if auth is None or auth.provider != PROVIDER:
        return False
    return shared.delete_authorization(authorization_id)


def count_connected_for_email(google_email: str, *, exclude_project_id: str = "") -> int:
    """How many LIVE Calendar project connections exist for a Google account.

    Read-only; used by `backend.services.google_grant` to decide whether a
    programmatic token revoke would also destroy a sibling Google connector's
    grant on a shared Google OAuth client. A blank email matches nothing."""
    email = str(google_email or "").strip().lower()
    if not email:
        return 0
    exclude = str(exclude_project_id or "").strip()
    bindings = shared.list_live_bindings_for_account(
        provider=PROVIDER, account_key=email)
    return sum(1 for b in bindings if not (exclude and b.project_id == exclude))


def count_live_authorizations_for_email(
    google_email: str, *, exclude_authorization_id: str = "",
) -> int:
    """How many LIVE Calendar ACCOUNT authorizations exist for a Google account.
    An authorization with no project bindings still holds a live Google grant, so
    the account-level disconnect must consider it before revoking remotely."""
    email = str(google_email or "").strip().lower()
    if not email:
        return 0
    return shared.count_active_authorizations_for_account(
        provider=PROVIDER, account_key=email,
        exclude_authorization_id=exclude_authorization_id)


def decrypt_refresh_token(conn: CalendarConnection) -> str:
    """Decrypt and return the stored refresh token. Raises
    CredentialEncryptionError if encryption is unavailable or the envelope is
    bad. Returns "" when the connection carries no stored refresh token."""
    if not conn.refresh_token_enc:
        return ""
    from backend.services.gmail import crypto as credential_crypto
    return credential_crypto.decrypt(conn.refresh_token_enc)


def decrypt_access_token(conn: CalendarConnection) -> str:
    if not conn.access_token_enc:
        return ""
    from backend.services.gmail import crypto as credential_crypto
    return credential_crypto.decrypt(conn.access_token_enc)


def _reset_for_tests() -> None:
    shared._reset_for_tests()
    try:
        from backend.services.orchestrator import _sqlite
        with _sqlite.connection(shared._db()) as c:
            c.execute("DROP TABLE IF EXISTS calendar_connections")
    except Exception:
        pass


__all__ = [
    "CalendarConnection", "PROVIDER", "STATUS_CONNECTED", "STATUS_REVOKED",
    "init_calendar_tables", "upsert_connection", "authorize_account", "bind_project",
    "get_connection",
    "get_authorization_for_owner", "update_access_token", "update_calendar_metadata",
    "mark_synced", "mark_revoked", "delete_connection", "delete_authorization",
    "count_connected_for_email", "count_live_authorizations_for_email",
    "decrypt_refresh_token", "decrypt_access_token",
]
