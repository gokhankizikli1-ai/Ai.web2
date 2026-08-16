# coding: utf-8
"""Vercel connector — connection projection over the SHARED connector authority.

WHAT CHANGED (and why this file is now an adapter)
--------------------------------------------------
Vercel used to own a `vercel_connections` table keyed by `project_id`, so the
access token was stored once per Korvix project. The token + its TEAM SCOPE is
really an ACCOUNT-level authorization; the chosen Vercel project is what a Korvix
project binds. That is exactly the shared model:

    connector_authorizations      the Vercel account/team authorization
                                  (holds the encrypted access token)
    connector_project_bindings    Korvix project → chosen Vercel project

This module keeps the SAME public surface (`VercelConnection`,
`upsert_authorization`, `bind_project`, `get_connection`, …) so the
sync/client/ingest layers, the routes and their tests are unchanged.

TEAM SCOPE
----------
`team_id` (empty for a personal installation) is persisted on the AUTHORIZATION
and applied by the read client on EVERY request. Losing it would silently
re-scope reads to the personal account, so it is part of the account identity,
not an option — which is why it is the authorization's `account_key`.

SECRETS
-------
Unchanged: the access token is stored ONLY as an encrypted envelope produced by
the EXISTING credential authority (`gmail.crypto`, keyed by
`KORVIX_CREDENTIAL_ENCRYPTION_KEY`). No second cipher, no second key, no
plaintext fallback. `public_view()` carries NO token material.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Dict, Optional

from backend.services.connectors import registry, store as shared

logger = logging.getLogger(__name__)

#: Convenience alias — the shared store resolves its file lazily.
DB_PATH = shared.DB_PATH

PROVIDER = registry.PROVIDER_VERCEL

STATUS_PENDING_SELECTION = "pending_selection"
STATUS_CONNECTED = "connected"
STATUS_REVOKED = "revoked"


@dataclass(frozen=True)
class VercelConnection:
    project_id: str
    owner_user_id: str
    provider: str
    account_label: str
    team_id: str
    installation_id: str
    vercel_user_id: str
    access_token_enc: str
    vercel_project_id: str
    vercel_project_name: str
    framework: str
    production_url: str
    status: str
    created_at: str
    updated_at: str
    last_sync_at: str
    #: Shared-authority id of the account authorization backing this connection.
    authorization_id: str = ""

    @property
    def is_revoked(self) -> bool:
        return self.status == STATUS_REVOKED

    @property
    def is_connected(self) -> bool:
        """A connection is only usable for sync once a Vercel project is bound."""
        return self.status == STATUS_CONNECTED and bool(self.vercel_project_id)

    @property
    def needs_project_selection(self) -> bool:
        return self.status == STATUS_PENDING_SELECTION

    def public_view(self) -> Dict[str, Any]:
        """Frontend-safe projection — carries NO token/secret material, only the
        connection's identity + lifecycle metadata."""
        return {
            "project_id": self.project_id,
            "provider": self.provider,
            "account_label": self.account_label,
            "team_id": self.team_id or None,
            "vercel_project_id": self.vercel_project_id or None,
            "vercel_project_name": self.vercel_project_name or None,
            "framework": self.framework or None,
            "production_url": self.production_url or None,
            "status": self.status,
            "connected": self.is_connected,
            "needs_project_selection": self.needs_project_selection,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "last_sync_at": self.last_sync_at or None,
        }


def init_vercel_tables() -> None:
    """Idempotent, additive bring-up of the shared tables."""
    shared.init_tables()


def _account_key(team_id: str, vercel_user_id: str, installation_id: str) -> str:
    """The Vercel account identity. TEAM SCOPE FIRST: a personal token and a team
    token grant access to different project sets, so they are different
    authorizations even for the same human."""
    return (str(team_id or "").strip()
            or str(vercel_user_id or "").strip()
            or str(installation_id or "").strip())


def _project(auth: shared.Authorization, binding: shared.Binding) -> VercelConnection:
    revoked = auth.is_revoked or binding.status == shared.BIND_REVOKED
    if revoked:
        status = STATUS_REVOKED
    elif binding.status == shared.BIND_PENDING or not binding.resource_id:
        status = STATUS_PENDING_SELECTION
    else:
        status = STATUS_CONNECTED
    return VercelConnection(
        project_id=binding.project_id,
        owner_user_id=binding.owner_user_id,
        provider=PROVIDER,
        account_label=auth.account_label,
        team_id=str(auth.metadata.get("team_id") or ""),
        installation_id=str(auth.metadata.get("installation_id") or ""),
        vercel_user_id=str(auth.metadata.get("vercel_user_id") or ""),
        access_token_enc=("" if revoked else auth.credential("access_token")),
        vercel_project_id=binding.resource_id,
        vercel_project_name=binding.resource_label,
        framework=str(binding.resource.get("framework") or ""),
        production_url=str(binding.resource.get("production_url") or ""),
        status=status,
        created_at=binding.created_at or auth.created_at,
        updated_at=max(binding.updated_at or "", auth.updated_at or ""),
        last_sync_at=binding.last_sync_at,
        authorization_id=auth.id,
    )


def upsert_authorization(
    *, project_id: str, owner_user_id: str, access_token: str,
    account_label: str = "", team_id: str = "", installation_id: str = "",
    vercel_user_id: str = "",
) -> Optional[VercelConnection]:
    """Authorize the Vercel account/team for `owner_user_id` (once) and start a
    project binding AWAITING Vercel-project selection.

    The access token is ENCRYPTED by the shared store — it raises
    `CredentialEncryptionError` if encryption is unavailable, so a plaintext
    token can never reach disk. `owner_user_id` MUST be the project's real owner
    (the route resolves it from the OAuth state / project, never from client
    input).

    A re-authorization RESETS this project's binding to `pending_selection` and
    clears any previously bound Vercel project: the new token may have a
    different team scope, so the old binding is not assumed to still be valid."""
    project_id = str(project_id or "").strip()
    owner_user_id = str(owner_user_id or "").strip()
    if not project_id or not owner_user_id:
        return None
    if not access_token:
        # Never store an authorization without a usable credential.
        return None
    account_key = _account_key(team_id, vercel_user_id, installation_id) \
        or f"pending:{owner_user_id}"

    auth = shared.upsert_authorization(
        owner_user_id=owner_user_id, provider=PROVIDER, account_key=account_key,
        account_label=str(account_label or ""),
        credentials={"access_token": access_token},
        metadata={
            "team_id": str(team_id or ""),
            "installation_id": str(installation_id or ""),
            "vercel_user_id": str(vercel_user_id or ""),
        },
    )
    if auth is None:
        return None
    bindings = shared.set_binding(
        project_id=project_id, authorization_id=auth.id, owner_user_id=owner_user_id,
        resources=[], status=shared.BIND_PENDING,
    )
    if not bindings:
        return None
    return get_connection(project_id)


def authorize_account(
    *, owner_user_id: str, access_token: str, account_label: str = "",
    team_id: str = "", installation_id: str = "", vercel_user_id: str = "",
) -> Optional[shared.Authorization]:
    """ACCOUNT-LEVEL authorization: store the Vercel grant (token + team scope)
    for this owner and bind it to NOTHING.

    This is the "authorize once" entry point. Connecting Vercel must never, by
    itself, expose it to a project — a project binding (and then a Vercel-project
    selection) is a separate, explicit act."""
    owner_user_id = str(owner_user_id or "").strip()
    if not owner_user_id or not access_token:
        return None
    account_key = _account_key(team_id, vercel_user_id, installation_id) \
        or f"pending:{owner_user_id}"
    return shared.upsert_authorization(
        owner_user_id=owner_user_id, provider=PROVIDER, account_key=account_key,
        account_label=str(account_label or ""),
        credentials={"access_token": access_token},
        metadata={
            "team_id": str(team_id or ""),
            "installation_id": str(installation_id or ""),
            "vercel_user_id": str(vercel_user_id or ""),
        },
    )


def start_project_binding(
    *, project_id: str, owner_user_id: str, authorization_id: str,
) -> Optional[VercelConnection]:
    """Attach an EXISTING account authorization to another project, awaiting that
    project's own Vercel-project selection — the "authorize once, use in many
    projects" path. No OAuth involved."""
    auth = shared.get_authorization(authorization_id)
    if auth is None or auth.provider != PROVIDER:
        return None
    bindings = shared.set_binding(
        project_id=str(project_id or "").strip(), authorization_id=auth.id,
        owner_user_id=str(owner_user_id or "").strip(),
        resources=[], status=shared.BIND_PENDING,
    )
    if not bindings:
        return None
    return get_connection(project_id)


def bind_project(
    *, project_id: str, vercel_project_id: str, name: str = "",
    framework: str = "", production_url: str = "",
) -> Optional[VercelConnection]:
    """Bind a SERVER-REVALIDATED Vercel project to an existing authorization and
    mark the connection connected. The caller MUST have confirmed the project is
    accessible under the stored token's team scope before calling this — this
    function persists a decision, it does not make one."""
    project_id = str(project_id or "").strip()
    vercel_project_id = str(vercel_project_id or "").strip()
    if not project_id or not vercel_project_id:
        return None
    current = get_connection(project_id)
    if current is None or current.is_revoked or not current.access_token_enc:
        return None
    written = shared.set_binding(
        project_id=project_id, authorization_id=current.authorization_id,
        owner_user_id=current.owner_user_id,
        resources=[{
            "resource_id": vercel_project_id,
            "resource_label": str(name or "")[:200],
            "resource": {
                "framework": str(framework or "")[:60],
                "production_url": str(production_url or "")[:400],
            },
        }],
        status=shared.BIND_CONNECTED,
    )
    if not written:
        return None
    return get_connection(project_id)


def update_project_metadata(project_id: str, *, name: str = "", framework: str = "",
                            production_url: str = "") -> bool:
    """Refresh the cached display metadata of the bound Vercel project (name /
    framework / production URL) after a sync read. Carries no credential."""
    current = get_connection(project_id)
    if current is None or not current.vercel_project_id:
        return False
    written = shared.set_binding(
        project_id=current.project_id, authorization_id=current.authorization_id,
        owner_user_id=current.owner_user_id,
        resources=[{
            "resource_id": current.vercel_project_id,
            "resource_label": str(name or "")[:200],
            "resource": {
                "framework": str(framework or "")[:60],
                "production_url": str(production_url or "")[:400],
            },
        }],
        status=shared.BIND_CONNECTED,
    )
    return bool(written)


def get_connection(project_id: str) -> Optional[VercelConnection]:
    binding = shared.get_binding(str(project_id or ""), PROVIDER)
    if binding is None:
        return None
    auth = shared.get_authorization(binding.authorization_id)
    if auth is None:
        return None
    return _project(auth, binding)


def get_authorization_for_owner(owner_user_id: str) -> Optional[shared.Authorization]:
    """The owner's Vercel authorization (account level), independent of projects."""
    return shared.find_authorization(owner_user_id=owner_user_id, provider=PROVIDER)


def mark_synced(project_id: str) -> None:
    project_id = str(project_id or "").strip()
    if not project_id:
        return
    shared.mark_binding_synced(project_id, PROVIDER)
    conn = get_connection(project_id)
    if conn and conn.authorization_id:
        shared.mark_authorization_synced(conn.authorization_id)


def mark_revoked(project_id: str) -> bool:
    """The stored token was REJECTED by Vercel — account-level truth, so the
    authorization is flagged revoked and its credential wiped. Every project
    bound to it is marked revoked with it; the rows are retained so the UI can
    offer a one-click reconnect."""
    conn = get_connection(project_id)
    if conn is None or not conn.authorization_id:
        return False
    return shared.mark_authorization_revoked(conn.authorization_id)


def delete_connection(project_id: str) -> bool:
    """PROJECT-level disconnect: drop this project's binding.

    Local only — it never mutates anything at Vercel. The account authorization
    survives while ANOTHER project still uses it; when this was the last binding
    the authorization (and its token) is deleted too, exactly matching the
    previous single-project behaviour."""
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
    """ACCOUNT-level disconnect: remove the authorization (and its token) plus
    EVERY project binding that depends on it. Local only."""
    auth = shared.get_authorization(authorization_id)
    if auth is None or auth.provider != PROVIDER:
        return False
    return shared.delete_authorization(authorization_id)


def decrypt_access_token(conn: VercelConnection) -> str:
    """Decrypt and return the stored access token. Raises
    `CredentialEncryptionError` if encryption is unavailable or the envelope is
    bad. Returns "" when the connection carries no stored token."""
    if not conn.access_token_enc:
        return ""
    from backend.services.gmail import crypto as credential_crypto
    return credential_crypto.decrypt(conn.access_token_enc)


def _reset_for_tests() -> None:
    shared._reset_for_tests()
    try:
        from backend.services.orchestrator import _sqlite
        with _sqlite.connection(shared._db()) as c:
            c.execute("DROP TABLE IF EXISTS vercel_connections")
    except Exception:
        pass


__all__ = [
    "VercelConnection", "PROVIDER", "STATUS_PENDING_SELECTION",
    "STATUS_CONNECTED", "STATUS_REVOKED", "init_vercel_tables",
    "upsert_authorization", "authorize_account", "start_project_binding", "bind_project",
    "update_project_metadata", "get_connection", "get_authorization_for_owner",
    "mark_synced", "mark_revoked", "delete_connection", "delete_authorization",
    "decrypt_access_token",
]
