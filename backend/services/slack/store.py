# coding: utf-8
"""Slack connector — connection projection over the SHARED connector authority.

WHAT CHANGED (and why this file is now an adapter)
--------------------------------------------------
Slack used to own `slack_connections` (keyed by `project_id`) plus a child
`slack_selected_channels` table. The WORKSPACE INSTALLATION (bot token + team) is
really an ACCOUNT-level authorization — Slack installs the app once per workspace
— while the CHANNELS are what each Korvix project binds. That is exactly the
shared model, and Slack is the provider that motivates its MULTI resource shape:

    connector_authorizations      the workspace installation
                                  (holds the encrypted bot token)
    connector_project_bindings    Korvix project → selected channels (one row per
                                  channel, individually addressable + owner-scoped)

THREE-STEP LIFECYCLE (unchanged)
--------------------------------
`STATUS_PENDING_SELECTION` — the OAuth exchange succeeded and the bot token is
stored, but the user has not yet chosen WHICH channels belong to this Korvix
project. Nothing is synced in this state.
`STATUS_CONNECTED` — at least one server-revalidated channel is bound; sync may
run.
`STATUS_REVOKED` — the token was rejected by Slack (uninstalled / revoked);
credential material is wiped and a reconnect is required.

ISOLATION
---------
* `owner_user_id` is still the project's real owner, resolved server-side, and is
  still the ONLY user id used to scope recorded observations.
* Each selected-channel binding row carries that same `owner_user_id`, so a read
  is owner-scoped without a join.

ONE SLACK INSTALLATION CAN BACK MANY KORVIX PROJECTS
-----------------------------------------------------
That was already true and is now modelled directly rather than duplicated:

  * Project disconnect is LOCAL-ONLY and drops only this project's channel
    bindings; it never calls Slack, so it can never break another project's
    connection. There is no `auth.revoke` anywhere in this package.
  * `count_connected_for_team()` still exists so a caller can tell the user
    TRUTHFULLY that the workspace installation survives their disconnect
    (fail-closed: an unknown/unreadable state counts as "shared").

SECRETS
-------
Unchanged: the bot token is stored ONLY as an encrypted envelope produced by the
EXISTING credential authority (`gmail.crypto`, keyed by
`KORVIX_CREDENTIAL_ENCRYPTION_KEY`). No second cipher, no second key, no
plaintext fallback. No user token is ever stored. `public_view()` carries NO
token material.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from backend.services.connectors import registry, store as shared
from backend.services.slack import config as sl_config

logger = logging.getLogger(__name__)

#: Convenience alias — the shared store resolves its file lazily.
DB_PATH = shared.DB_PATH

PROVIDER = registry.PROVIDER_SLACK

STATUS_PENDING_SELECTION = "pending_selection"
STATUS_CONNECTED = "connected"
STATUS_REVOKED = "revoked"

# A PROJECTION-ONLY lifecycle value. It is NEVER stored and never returned by
# `get_connection()` — it exists solely so the status route can describe a
# binding whose `owner_user_id` no longer matches the project's current owner,
# WITHOUT echoing that row's workspace identity. See `owner_mismatch_view()`.
STATUS_OWNER_MISMATCH = "owner_mismatch"


@dataclass(frozen=True)
class SelectedChannel:
    """A channel bound to a Korvix project. Metadata only — no message content
    and no token ever lands here."""
    channel_id: str
    name: str
    is_private: bool

    def public_view(self) -> Dict[str, Any]:
        return {
            "channel_id": self.channel_id,
            "name": self.name,
            "is_private": self.is_private,
        }


@dataclass(frozen=True)
class SlackConnection:
    project_id: str
    owner_user_id: str
    provider: str
    team_id: str
    team_name: str
    bot_user_id: str
    app_id: str
    scopes: str
    bot_token_enc: str
    status: str
    created_at: str
    updated_at: str
    last_sync_at: str
    # Populated by `get_connection` so the connection is self-describing (the
    # route never has to re-query to render or authorize a sync).
    channels: Tuple[SelectedChannel, ...] = field(default=())
    #: Shared-authority id of the workspace authorization backing this row.
    authorization_id: str = ""

    @property
    def is_revoked(self) -> bool:
        return self.status == STATUS_REVOKED

    @property
    def is_connected(self) -> bool:
        """Only usable for sync once at least one channel is bound."""
        return self.status == STATUS_CONNECTED and bool(self.channels)

    @property
    def needs_channel_selection(self) -> bool:
        return self.status == STATUS_PENDING_SELECTION

    def public_view(self) -> Dict[str, Any]:
        """Frontend-safe projection — carries NO token/secret material, only the
        connection's identity, its bound channels, and lifecycle metadata."""
        return {
            "project_id": self.project_id,
            "provider": self.provider,
            "team_id": self.team_id or None,
            "team_name": self.team_name or None,
            "bot_user_id": self.bot_user_id or None,
            "scopes": [s for s in (self.scopes or "").replace(" ", "").split(",") if s],
            "channels": [c.public_view() for c in self.channels],
            "channel_count": len(self.channels),
            "status": self.status,
            "connected": self.is_connected,
            "needs_channel_selection": self.needs_channel_selection,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "last_sync_at": self.last_sync_at or None,
        }

    def owner_mismatch_view(self) -> Dict[str, Any]:
        """REDACTED projection for a binding whose `owner_user_id` no longer
        matches the project's current owner.

        `public_view()` carries the workspace identity (`team_id`, `team_name`,
        `bot_user_id`, granted `scopes`) and every bound channel NAME. That is
        the previous owner's Slack information, and a project changing hands must
        not hand it to the new owner — so this projection states only that a
        stale connection EXISTS and must be re-established. It deliberately
        answers instead of erroring, because the status endpoint is what tells
        the UI to offer Reconnect / Disconnect; erasing the row from the response
        entirely would strand it with no way to clean it up.

        Carries no token material, no workspace identity, and no channel data."""
        return {
            "project_id": self.project_id,
            "provider": self.provider,
            "team_id": None,
            "team_name": None,
            "bot_user_id": None,
            "scopes": [],
            "channels": [],
            "channel_count": 0,
            "status": STATUS_OWNER_MISMATCH,
            "connected": False,
            "needs_channel_selection": False,
            # Timestamps describe the ROW, not the workspace, and the UI needs
            # them to explain that something stale is present.
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "last_sync_at": None,
        }


def init_slack_tables() -> None:
    """Idempotent, additive bring-up of the shared tables."""
    shared.init_tables()


def _channels_from(bindings: List[shared.Binding]) -> Tuple[SelectedChannel, ...]:
    """Name-sorted for a stable display order, skipping the placeholder row that
    represents "installed but no channel chosen yet"."""
    chans = [
        SelectedChannel(
            channel_id=b.resource_id,
            name=b.resource_label,
            is_private=bool(b.resource.get("is_private")),
        )
        for b in bindings if b.resource_id
    ]
    chans.sort(key=lambda c: ((c.name or "").lower(), c.channel_id))
    return tuple(chans)


def _project(auth: shared.Authorization,
             bindings: List[shared.Binding]) -> Optional[SlackConnection]:
    if not bindings:
        return None
    head = bindings[0]
    channels = _channels_from(bindings)
    revoked = auth.is_revoked or all(b.status == shared.BIND_REVOKED for b in bindings)
    if revoked:
        status = STATUS_REVOKED
    elif channels and any(b.status == shared.BIND_CONNECTED for b in bindings):
        status = STATUS_CONNECTED
    else:
        status = STATUS_PENDING_SELECTION
    return SlackConnection(
        project_id=head.project_id,
        owner_user_id=head.owner_user_id,
        provider=PROVIDER,
        team_id=str(auth.metadata.get("team_id") or auth.account_key or ""),
        team_name=str(auth.metadata.get("team_name") or ""),
        bot_user_id=str(auth.metadata.get("bot_user_id") or ""),
        app_id=str(auth.metadata.get("app_id") or ""),
        scopes=auth.scopes,
        bot_token_enc=("" if revoked else auth.credential("bot_token")),
        status=status,
        created_at=min((b.created_at for b in bindings if b.created_at), default=auth.created_at),
        updated_at=max([b.updated_at for b in bindings] + [auth.updated_at or ""]),
        last_sync_at=max((b.last_sync_at for b in bindings), default=""),
        channels=channels,
        authorization_id=auth.id,
    )


def upsert_installation(
    *, project_id: str, owner_user_id: str, bot_token: str, team_id: str,
    team_name: str = "", bot_user_id: str = "", app_id: str = "", scopes: str = "",
) -> Optional[SlackConnection]:
    """Authorize the Slack workspace for `owner_user_id` (once) and start a
    project binding AWAITING channel selection.

    The bot token is ENCRYPTED by the shared store — it raises
    `CredentialEncryptionError` if encryption is unavailable, so a plaintext
    token can never reach disk. `owner_user_id` MUST be the project's real owner
    (the route resolves it from the OAuth state / project, never from client
    input), and `team_id` MUST come from the token exchange response, never from
    a query param.

    A re-installation RESETS this project's binding to `pending_selection` and
    CLEARS its previously selected channels: the new authorization may target a
    different workspace, so the old channel ids are not assumed to still be
    valid."""
    project_id = str(project_id or "").strip()
    owner_user_id = str(owner_user_id or "").strip()
    team_id = str(team_id or "").strip()
    if not project_id or not owner_user_id or not team_id:
        return None
    if not bot_token:
        # Never store an authorization without a usable credential.
        return None

    auth = shared.upsert_authorization(
        owner_user_id=owner_user_id, provider=PROVIDER, account_key=team_id,
        account_label=str(team_name or team_id)[:200],
        scopes=str(scopes or "")[:500],
        credentials={"bot_token": bot_token},
        metadata={
            "team_id": team_id,
            "team_name": str(team_name or "")[:200],
            "bot_user_id": str(bot_user_id or "")[:60],
            "app_id": str(app_id or "")[:60],
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
    *, owner_user_id: str, bot_token: str, team_id: str, team_name: str = "",
    bot_user_id: str = "", app_id: str = "", scopes: str = "",
) -> Optional[shared.Authorization]:
    """ACCOUNT-LEVEL authorization: store the workspace installation for this
    owner and bind it to NOTHING.

    This is the "authorize once" entry point. Installing the Slack app must
    never, by itself, expose any channel to any project — a project binding (and
    then a channel selection) is a separate, explicit act."""
    owner_user_id = str(owner_user_id or "").strip()
    team_id = str(team_id or "").strip()
    if not owner_user_id or not team_id or not bot_token:
        return None
    return shared.upsert_authorization(
        owner_user_id=owner_user_id, provider=PROVIDER, account_key=team_id,
        account_label=str(team_name or team_id)[:200],
        scopes=str(scopes or "")[:500],
        credentials={"bot_token": bot_token},
        metadata={
            "team_id": team_id,
            "team_name": str(team_name or "")[:200],
            "bot_user_id": str(bot_user_id or "")[:60],
            "app_id": str(app_id or "")[:60],
        },
    )


def start_project_binding(
    *, project_id: str, owner_user_id: str, authorization_id: str,
) -> Optional[SlackConnection]:
    """Attach an EXISTING workspace authorization to another project, awaiting
    that project's own channel selection — the "authorize once, use in many
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


def set_selected_channels(
    *, project_id: str, owner_user_id: str, channels: List[Dict[str, Any]],
) -> Optional[SlackConnection]:
    """Bind a SERVER-REVALIDATED set of channels to an existing installation and
    mark the connection connected.

    The caller MUST have confirmed EVERY channel is visible AND readable under
    the stored bot token before calling this — this function persists a
    decision, it does not make one. The set is replaced wholesale (so unselecting
    is just a smaller list) and is hard-capped at
    `config.max_selected_channels()`; an over-long list is REFUSED rather than
    silently truncated, because silently ingesting fewer channels than the user
    chose would be a lie. An EMPTY list is refused too — a connection with no
    channel has nothing to sync and would strand the UI in a fake "connected"
    state."""
    project_id = str(project_id or "").strip()
    owner_user_id = str(owner_user_id or "").strip()
    if not project_id or not owner_user_id:
        return None
    rows: List[Dict[str, Any]] = []
    seen = set()
    for item in (channels or []):
        cid = str((item or {}).get("channel_id") or "").strip()
        if not cid or cid in seen:
            continue
        seen.add(cid)
        rows.append({
            "resource_id": cid,
            "resource_label": str((item or {}).get("name") or "").strip()[:200],
            "resource": {"is_private": bool((item or {}).get("is_private"))},
        })
    if not rows or len(rows) > sl_config.max_selected_channels():
        return None

    current = get_connection(project_id)
    if current is None or current.is_revoked or not current.bot_token_enc:
        # No live installation to bind to — do not create orphan rows.
        return None
    if current.owner_user_id != owner_user_id:
        # The binding belongs to a different owner — refuse rather than rewrite.
        return None

    written = shared.set_binding(
        project_id=project_id, authorization_id=current.authorization_id,
        owner_user_id=owner_user_id, resources=rows, status=shared.BIND_CONNECTED,
    )
    if not written:
        return None
    return get_connection(project_id)


def list_selected_channels(project_id: str) -> Tuple[SelectedChannel, ...]:
    """The channels bound to a project, name-sorted for a stable display order."""
    project_id = str(project_id or "").strip()
    if not project_id:
        return ()
    return _channels_from(shared.list_project_bindings(project_id, provider=PROVIDER))


def get_connection(project_id: str) -> Optional[SlackConnection]:
    bindings = shared.list_project_bindings(str(project_id or ""), provider=PROVIDER)
    if not bindings:
        return None
    auth = shared.get_authorization(bindings[0].authorization_id)
    if auth is None:
        return None
    return _project(auth, bindings)


def get_authorization_for_owner(owner_user_id: str) -> Optional[shared.Authorization]:
    """The owner's Slack workspace authorization, independent of projects."""
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
    """The stored bot token was REJECTED by Slack (uninstalled / revoked) —
    account-level truth, so the authorization is flagged revoked and its
    credential wiped. Every project bound to it is marked revoked with it; the
    rows (and their channel selections) are retained so the UI can offer a
    one-click reconnect."""
    conn = get_connection(project_id)
    if conn is None or not conn.authorization_id:
        return False
    return shared.mark_authorization_revoked(conn.authorization_id)


def delete_connection(project_id: str) -> bool:
    """PROJECT-level disconnect: drop this project's channel bindings.

    Local only — it never calls Slack, so the workspace installation and every
    other Korvix project bound to it are untouched. When this was the last
    binding of the owner's authorization, the authorization (and its token) is
    deleted too, matching the previous single-project behaviour."""
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
    """ACCOUNT-level disconnect: remove the workspace authorization (and its bot
    token) plus EVERY project binding on it. Local only — Korvix never uninstalls
    the Slack app on the user's behalf."""
    auth = shared.get_authorization(authorization_id)
    if auth is None or auth.provider != PROVIDER:
        return False
    return shared.delete_authorization(authorization_id)


def count_connected_for_team(team_id: str, *, exclude_project_id: str = "") -> int:
    """How many OTHER live Korvix project connections exist for a Slack workspace.

    Read-only. Used by disconnect to tell the user TRUTHFULLY whether the
    workspace installation is shared with another Korvix project (it is never
    used to authorize anything). A blank team id matches nothing — we cannot
    prove identity, so we must not claim a match."""
    team_id = str(team_id or "").strip()
    if not team_id:
        return 0
    exclude = str(exclude_project_id or "").strip()
    bindings = shared.list_live_bindings_for_account(
        provider=PROVIDER, account_key=team_id)
    projects = {b.project_id for b in bindings}
    projects.discard(exclude)
    return len(projects)


def decrypt_bot_token(conn: SlackConnection) -> str:
    """Decrypt and return the stored bot token. Raises
    `CredentialEncryptionError` if encryption is unavailable or the envelope is
    bad. Returns "" when the connection carries no stored token."""
    if not conn.bot_token_enc:
        return ""
    from backend.services.gmail import crypto as credential_crypto
    return credential_crypto.decrypt(conn.bot_token_enc)


def _reset_for_tests() -> None:
    shared._reset_for_tests()
    try:
        from backend.services.orchestrator import _sqlite
        with _sqlite.connection(shared._db()) as c:
            c.execute("DROP TABLE IF EXISTS slack_connections")
            c.execute("DROP TABLE IF EXISTS slack_selected_channels")
    except Exception:
        pass


__all__ = [
    "SlackConnection", "SelectedChannel", "PROVIDER",
    "STATUS_PENDING_SELECTION", "STATUS_CONNECTED", "STATUS_REVOKED",
    "STATUS_OWNER_MISMATCH",
    "init_slack_tables", "upsert_installation", "authorize_account",
    "start_project_binding",
    "set_selected_channels", "list_selected_channels", "get_connection",
    "get_authorization_for_owner", "mark_synced", "mark_revoked",
    "delete_connection", "delete_authorization",
    "count_connected_for_team", "decrypt_bot_token",
]
