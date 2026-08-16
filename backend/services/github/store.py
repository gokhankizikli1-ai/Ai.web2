# coding: utf-8
"""GitHub connector — connection projection over the SHARED connector authority,
plus the webhook delivery-dedup table.

WHAT CHANGED (and why this file is now an adapter)
--------------------------------------------------
GitHub used to own a `github_connections` table keyed by `project_id`. The GitHub
App INSTALLATION is really an ACCOUNT-level authorization — it is granted once per
Korvix owner and can serve many projects — while the REPOSITORY is what a project
actually binds. That is exactly the shared model, so this connector now stores:

    connector_authorizations      the GitHub App installation (no credential:
                                  installation tokens are minted on demand)
    connector_project_bindings    project → chosen repository

`github_deliveries` stays a GitHub-local table: it is webhook plumbing (an
at-most-once ledger of delivery ids), not connection state.

ISOLATION
---------
* `owner_user_id` is still the project's real owner, resolved server-side, and is
  still the ONLY user id used to scope recorded observations.
* A repository under an installation still maps to exactly ONE project — the
  conflict is detected explicitly and reported as None (the route maps it to a
  409) rather than silently letting repo A inject activity into project B.
* A webhook for an unknown installation/repo resolves to no binding → the
  delivery is safely ignored (no observation written).
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Dict, List, Optional

from backend.services.connectors import registry, store as shared
from backend.services.orchestrator import _sqlite

logger = logging.getLogger(__name__)

#: Convenience alias — the shared store resolves its file lazily.
DB_PATH = shared.DB_PATH

PROVIDER = registry.PROVIDER_GITHUB

_DELIVERY_SCHEMA = """
CREATE TABLE IF NOT EXISTS github_deliveries (
    delivery_id   TEXT PRIMARY KEY,              -- X-GitHub-Delivery (webhook dedup)
    received_at   TEXT NOT NULL
);
"""


@dataclass(frozen=True)
class GitHubConnection:
    project_id: str
    owner_user_id: str
    installation_id: str
    repo_full_name: str
    repo_id: str
    created_at: str
    updated_at: str
    last_sync_at: str = ""
    #: Shared-authority id of the installation authorization backing this row.
    authorization_id: str = ""


def _now() -> str:
    return datetime.utcnow().isoformat() + "Z"


def init_github_tables() -> None:
    """Idempotent, additive bring-up. Failures are swallowed (never block)."""
    shared.init_tables()
    try:
        with _sqlite.connection(shared._db()) as c:
            c.executescript(_DELIVERY_SCHEMA)
    except Exception as exc:  # pragma: no cover — defensive
        logger.warning("github.store.init failed: %s", exc)


def _project(auth: shared.Authorization, binding: shared.Binding) -> GitHubConnection:
    return GitHubConnection(
        project_id=binding.project_id,
        owner_user_id=binding.owner_user_id,
        installation_id=auth.account_key,
        repo_full_name=binding.resource_id,
        repo_id=str(binding.resource.get("repo_id") or ""),
        created_at=binding.created_at or auth.created_at,
        updated_at=max(binding.updated_at or "", auth.updated_at or ""),
        last_sync_at=binding.last_sync_at,
        authorization_id=auth.id,
    )


def upsert_connection(*, project_id: str, owner_user_id: str, installation_id: str,
                      repo_full_name: str, repo_id: str = "") -> Optional[GitHubConnection]:
    """Authorize the installation for `owner_user_id` (once) and bind a repository
    to `project_id`.

    Returns None on invalid input or when the (installation, repo) pair is
    already claimed by a DIFFERENT project — the caller maps that to a 409
    conflict. `owner_user_id` MUST be the project's real owner; the route
    resolves it from `projects.get_project(...).owner_user_id`, never from client
    input."""
    project_id = str(project_id or "").strip()
    owner_user_id = str(owner_user_id or "").strip()
    installation_id = str(installation_id or "").strip()
    repo_full_name = str(repo_full_name or "").strip().strip("/")
    if not (project_id and owner_user_id and installation_id and repo_full_name):
        return None
    if repo_full_name.count("/") != 1:
        return None

    init_github_tables()
    # Reverse-uniqueness: a repo under an installation belongs to one project.
    for existing in shared.find_bindings_by_resource(
            provider=PROVIDER, resource_ids=[repo_full_name]):
        if existing.project_id == project_id:
            continue
        other = shared.get_authorization(existing.authorization_id)
        if other is not None and other.account_key == installation_id:
            logger.info("github.store.upsert conflict: repo already connected elsewhere")
            return None

    auth = shared.upsert_authorization(
        owner_user_id=owner_user_id, provider=PROVIDER,
        account_key=installation_id,
        account_label=f"Installation {installation_id}",
        metadata={"installation_id": installation_id},
    )
    if auth is None:
        return None
    bindings = shared.set_binding(
        project_id=project_id, authorization_id=auth.id, owner_user_id=owner_user_id,
        resources=[{
            "resource_id": repo_full_name, "resource_label": repo_full_name,
            "resource": {"repo_id": str(repo_id or "")},
        }],
        status=shared.BIND_CONNECTED,
    )
    if not bindings:
        return None
    return get_connection(project_id)


def authorize_account(
    *, owner_user_id: str, installations: List[Dict[str, str]],
) -> Optional[shared.Authorization]:
    """ACCOUNT-LEVEL authorization: record the GitHub App installation(s) this
    owner has, and bind them to NOTHING.

    This is the "authorize once" entry point. It stores NO credential — the App
    mints short-lived installation tokens on demand — only the provider-verified
    installation ids the caller already checked. The full verified list is kept
    in the authorization metadata so a later project binding can offer every
    account the user actually has, not just the first one.

    Authorizing must never, by itself, expose a repository to a project — a
    project binding (and then a repository selection) is a separate act."""
    owner_user_id = str(owner_user_id or "").strip()
    verified = [i for i in (installations or [])
                if str((i or {}).get("installation_id") or "").strip()]
    if not owner_user_id or not verified:
        return None
    primary = verified[0]
    installation_id = str(primary.get("installation_id")).strip()
    login = str(primary.get("account_login") or "")
    return shared.upsert_authorization(
        owner_user_id=owner_user_id, provider=PROVIDER,
        account_key=installation_id,
        account_label=login or f"Installation {installation_id}",
        metadata={
            "installation_id": installation_id,
            "account_login": login,
            "account_type": str(primary.get("account_type") or ""),
            "installations": [
                {
                    "installation_id": str(i.get("installation_id") or ""),
                    "account_login": str(i.get("account_login") or ""),
                    "account_type": str(i.get("account_type") or ""),
                }
                for i in verified
            ],
        },
    )


def get_connection(project_id: str) -> Optional[GitHubConnection]:
    binding = shared.get_binding(str(project_id or ""), PROVIDER)
    if binding is None or not binding.resource_id:
        return None
    auth = shared.get_authorization(binding.authorization_id)
    if auth is None:
        return None
    return _project(auth, binding)


def get_authorization_for_owner(owner_user_id: str) -> Optional[shared.Authorization]:
    """The owner's GitHub installation authorization, independent of projects."""
    return shared.find_authorization(owner_user_id=owner_user_id, provider=PROVIDER)


def find_connections_for_repo(*, installation_id: str, repo_full_name: str,
                              repo_id: str = "") -> List[GitHubConnection]:
    """Reverse routing for a webhook: which connection(s) own this repo under
    this installation. Matches on (installation_id, repo_full_name); also
    accepts a repo_id match so a repo rename still routes. Returns [] for an
    unknown/unmapped repo → the delivery is safely ignored."""
    installation_id = str(installation_id or "").strip()
    repo_full_name = str(repo_full_name or "").strip().strip("/")
    repo_id = str(repo_id or "").strip()
    if not installation_id or not (repo_full_name or repo_id):
        return []
    init_github_tables()
    out: List[GitHubConnection] = []
    seen = set()
    candidates = shared.find_bindings_by_resource(
        provider=PROVIDER, resource_ids=[repo_full_name] if repo_full_name else [])
    if repo_id:
        # A renamed repo keeps its numeric id — scan the installation's bindings
        # for one whose stored repo_id matches.
        for binding in _installation_bindings(installation_id):
            if str(binding.resource.get("repo_id") or "") == repo_id:
                candidates.append(binding)
    for binding in candidates:
        key = (binding.project_id, binding.resource_id)
        if key in seen:
            continue
        auth = shared.get_authorization(binding.authorization_id)
        if auth is None or auth.account_key != installation_id:
            continue
        seen.add(key)
        out.append(_project(auth, binding))
    return out


def _installation_bindings(installation_id: str) -> List[shared.Binding]:
    auth_rows = shared.list_live_bindings_for_account(
        provider=PROVIDER, account_key=installation_id)
    return list(auth_rows)


def delete_connection(project_id: str) -> bool:
    """PROJECT-level disconnect: drop this project's repository binding.

    The GitHub App installation itself is NOT uninstalled and other projects
    using it are untouched. When this was the last binding, the (credential-free)
    installation authorization is dropped too."""
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
    """ACCOUNT-level disconnect: forget the installation and EVERY project
    binding on it. Korvix cannot uninstall a GitHub App on the user's behalf —
    that is done from GitHub — so this only removes Korvix's own mapping."""
    auth = shared.get_authorization(authorization_id)
    if auth is None or auth.provider != PROVIDER:
        return False
    return shared.delete_authorization(authorization_id)


def mark_synced(project_id: str) -> None:
    """Stamp the connection's last successful backfill time. Used both for the
    Connectors UX ("last sync …") and to detect the FIRST sync of a connection
    (empty ⇒ run the fuller bounded initial import). Best-effort; never raises."""
    project_id = str(project_id or "").strip()
    if not project_id:
        return
    shared.mark_binding_synced(project_id, PROVIDER)
    conn = get_connection(project_id)
    if conn and conn.authorization_id:
        shared.mark_authorization_synced(conn.authorization_id)


# ── webhook delivery dedup ───────────────────────────────────────────────────

def mark_delivery(delivery_id: str) -> bool:
    """Record a webhook delivery id. Returns True if this is the FIRST time we
    have seen it (process it), False if it is a duplicate redelivery (ignore).
    Empty id ⇒ True (cannot dedup, so process once)."""
    delivery_id = str(delivery_id or "").strip()
    if not delivery_id:
        return True
    init_github_tables()
    try:
        with _sqlite.connection(shared._db()) as c:
            cur = c.execute(
                "INSERT OR IGNORE INTO github_deliveries (delivery_id, received_at) VALUES (?, ?)",
                (delivery_id, _now()),
            )
            return cur.rowcount > 0
    except Exception:
        # On a storage hiccup, prefer processing (idempotency at the observation
        # layer still prevents duplicate observations) over silently dropping.
        return True


def _reset_for_tests() -> None:
    shared._reset_for_tests()
    try:
        with _sqlite.connection(shared._db()) as c:
            c.execute("DROP TABLE IF EXISTS github_connections")
            c.execute("DROP TABLE IF EXISTS github_deliveries")
    except Exception:
        pass


__all__ = [
    "GitHubConnection", "PROVIDER", "init_github_tables", "upsert_connection",
    "authorize_account",
    "get_connection", "get_authorization_for_owner", "find_connections_for_repo",
    "delete_connection", "delete_authorization", "mark_synced", "mark_delivery",
]
