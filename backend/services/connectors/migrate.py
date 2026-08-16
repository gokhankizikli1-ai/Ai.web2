# coding: utf-8
"""One-way, idempotent migration of the five legacy per-project connector tables
into the shared authorization + binding model.

WHAT IT DOES
------------
For every legacy row (`gmail_connections`, `calendar_connections`,
`github_connections`, `vercel_connections`, `slack_connections` +
`slack_selected_channels`) it derives:

  * the provider ACCOUNT identity that the row was really authorizing
    (mailbox address, Google account, GitHub installation, Vercel scope, Slack
    team), and creates/reuses ONE `connector_authorizations` row per
    (owner, provider, account);
  * a `connector_project_bindings` row per project (plus one per selected Slack
    channel) recording exactly the resources that project had already chosen.

SAFETY RULES
------------
* NO PLAINTEXT EVER. Credentials are copied as the ciphertext envelopes already
  on disk. The encryption key is never needed, never read, and a decrypted token
  never exists — not even transiently.
* NEVER MERGE ACROSS OWNERS. Deduplication happens only within one
  `owner_user_id`. Two owners who connected the same mailbox keep two separate
  authorizations.
* NEVER DESTROY. Legacy rows are LEFT IN PLACE. The migration only adds rows to
  the new tables; a rollback is "stop reading the new tables".
* IDEMPOTENT. Re-running is a no-op: authorizations upsert on
  (owner, provider, account_key) and bindings upsert on
  (project, provider, resource). Running it twice cannot duplicate or downgrade
  anything.
* FAIL CONSERVATIVELY, PER ROW. A row whose account identity cannot be
  determined (e.g. a Gmail connection with no recorded address, or a Slack row
  with no team id) is SKIPPED and REPORTED — never guessed at, never merged into
  someone else's authorization.
* Rows already represented in the new model are counted as `skipped_existing`
  and left alone, so a legacy row can never overwrite a binding the user has
  since changed under the new model.

The report is returned (and logged) so an operator can see exactly what moved
and what needs manual attention.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from backend.services.connectors import registry, store as shared
from backend.services.orchestrator import _sqlite

logger = logging.getLogger(__name__)

def _db() -> str:
    """The legacy connector tables live in the SAME projects.db as the new ones.
    Resolved on every call (never captured at import) so a repointed
    PROJECTS_DB_PATH is honoured — the shared store does the same."""
    return shared._db()


@dataclass
class MigrationReport:
    authorizations_created: int = 0
    bindings_created: int = 0
    skipped_existing: int = 0
    skipped_unsafe: List[str] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)
    #: Grants that arrived with their credentials already wiped (a legacy
    #: `mark_revoked`) and were therefore migrated as revoked, not authorized.
    revoked_without_credentials: List[str] = field(default_factory=list)
    #: Authorizations this run adopted, so the finalization pass can inspect
    #: exactly the rows it touched and nothing else.
    _adopted: List[str] = field(default_factory=list, repr=False)

    def as_dict(self) -> Dict[str, Any]:
        return {
            "authorizations_created": self.authorizations_created,
            "bindings_created": self.bindings_created,
            "skipped_existing": self.skipped_existing,
            "skipped_unsafe": list(self.skipped_unsafe),
            "revoked_without_credentials": list(self.revoked_without_credentials),
            "errors": list(self.errors),
            "ok": not self.errors,
        }


def _table_exists(c, name: str) -> bool:
    try:
        row = c.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (name,)
        ).fetchone()
        return row is not None
    except Exception:
        return False


def _rows(table: str) -> List[Dict[str, Any]]:
    try:
        with _sqlite.connection(_db()) as c:
            if not _table_exists(c, table):
                return []
            return [dict(r) for r in c.execute(f"SELECT * FROM {table}").fetchall()]
    except Exception as exc:
        logger.warning("connectors.migrate: could not read %s: %s", table, type(exc).__name__)
        return []


def _envelopes(row: Dict[str, Any], mapping: Dict[str, str]) -> Dict[str, str]:
    """Pick the already-ENCRYPTED credential columns off a legacy row.
    `mapping` is {new_field: legacy_column}. Empty values are dropped."""
    out: Dict[str, str] = {}
    for new_field, column in mapping.items():
        value = str(row.get(column) or "")
        if value:
            out[new_field] = value
    return out


def _adopt(
    *, report: MigrationReport, owner_user_id: str, provider: str, account_key: str,
    account_label: str, scopes: str, encrypted: Dict[str, str],
    metadata: Dict[str, Any], project_id: str, resources: List[Dict[str, Any]],
    binding_status: str, legacy_ref: str,
) -> None:
    """Create/reuse the authorization, then bind the project — or record why not."""
    owner_user_id = str(owner_user_id or "").strip()
    account_key = str(account_key or "").strip()
    project_id = str(project_id or "").strip()
    if not owner_user_id or not account_key or not project_id:
        # No provable owner or account identity → refuse to guess.
        report.skipped_unsafe.append(
            f"{legacy_ref}: missing owner/account identity — left untouched")
        return

    existing_binding = shared.list_project_bindings(project_id, provider=provider)
    if existing_binding:
        report.skipped_existing += 1
        return

    had_auth = shared.find_authorization(
        owner_user_id=owner_user_id, provider=provider, account_key=account_key)
    auth = shared.upsert_authorization(
        owner_user_id=owner_user_id, provider=provider, account_key=account_key,
        account_label=account_label, scopes=scopes,
        encrypted_credentials=encrypted, metadata=metadata,
    )
    if auth is None:
        report.skipped_unsafe.append(
            f"{legacy_ref}: authorization could not be stored — legacy row left untouched")
        return
    if had_auth is None:
        report.authorizations_created += 1
    if auth.id not in report._adopted:
        report._adopted.append(auth.id)

    bound = shared.set_binding(
        project_id=project_id, authorization_id=auth.id,
        owner_user_id=owner_user_id, resources=resources, status=binding_status,
    )
    if not bound:
        report.skipped_unsafe.append(
            f"{legacy_ref}: project binding could not be written — legacy row left untouched")
        return
    report.bindings_created += len(bound)


def _migrate_google(report: MigrationReport, *, table: str, provider: str) -> None:
    """Gmail and Google Calendar share a row shape: an OAuth refresh token bound
    to a Google account. The mailbox/calendar address IS the account identity."""
    for row in _rows(table):
        email = str(row.get("google_email") or "").strip().lower()
        ref = f"{table}[{row.get('project_id')}]"
        if not email:
            # Without the account address we cannot tell two Google accounts
            # apart, so merging would be a guess. Report instead.
            report.skipped_unsafe.append(
                f"{ref}: no recorded Google account address — reconnect required")
            continue
        if provider == registry.PROVIDER_CALENDAR:
            calendar_id = str(row.get("calendar_id") or "primary").strip() or "primary"
            resources = [{
                "resource_id": calendar_id,
                "resource_label": calendar_id,
                "resource": {"time_zone": str(row.get("time_zone") or "")},
            }]
        else:
            resources = [{"resource_id": "", "resource_label": email, "resource": {}}]
        legacy_status = str(row.get("status") or "connected")
        _adopt(
            report=report, owner_user_id=str(row.get("owner_user_id") or ""),
            provider=provider, account_key=email, account_label=email,
            scopes=str(row.get("scopes") or ""),
            encrypted=_envelopes(row, {
                "refresh_token": "refresh_token_enc",
                "access_token": "access_token_enc",
            }),
            metadata={"access_token_expires": str(row.get("access_token_expires") or "")},
            project_id=str(row.get("project_id") or ""), resources=resources,
            binding_status=(shared.BIND_REVOKED if legacy_status == "revoked"
                            else shared.BIND_CONNECTED),
            legacy_ref=ref,
        )


def _migrate_github(report: MigrationReport) -> None:
    """A GitHub App INSTALLATION is the account-level authorization; the chosen
    repository is the per-project resource. No credential is stored (installation
    tokens are minted on demand), so there is nothing to copy."""
    for row in _rows("github_connections"):
        installation_id = str(row.get("installation_id") or "").strip()
        repo = str(row.get("repo_full_name") or "").strip()
        ref = f"github_connections[{row.get('project_id')}]"
        if not installation_id or not repo:
            report.skipped_unsafe.append(
                f"{ref}: incomplete installation/repository — reconnect required")
            continue
        _adopt(
            report=report, owner_user_id=str(row.get("owner_user_id") or ""),
            provider=registry.PROVIDER_GITHUB, account_key=installation_id,
            account_label=f"Installation {installation_id}", scopes="",
            encrypted={}, metadata={"installation_id": installation_id},
            project_id=str(row.get("project_id") or ""),
            resources=[{
                "resource_id": repo, "resource_label": repo,
                "resource": {"repo_id": str(row.get("repo_id") or "")},
            }],
            binding_status=shared.BIND_CONNECTED, legacy_ref=ref,
        )


def _migrate_vercel(report: MigrationReport) -> None:
    """The Vercel access token + its TEAM SCOPE is the authorization; the chosen
    Vercel project is the per-project resource. Team scope is part of the account
    identity — losing it would silently re-scope reads to the personal account."""
    for row in _rows("vercel_connections"):
        team_id = str(row.get("team_id") or "").strip()
        vercel_user_id = str(row.get("vercel_user_id") or "").strip()
        installation_id = str(row.get("installation_id") or "").strip()
        ref = f"vercel_connections[{row.get('project_id')}]"
        account_key = team_id or vercel_user_id or installation_id
        if not account_key:
            report.skipped_unsafe.append(
                f"{ref}: no recorded Vercel account/team scope — reconnect required")
            continue
        status = str(row.get("status") or "")
        vercel_project_id = str(row.get("vercel_project_id") or "").strip()
        if vercel_project_id:
            resources = [{
                "resource_id": vercel_project_id,
                "resource_label": str(row.get("vercel_project_name") or vercel_project_id),
                "resource": {
                    "framework": str(row.get("framework") or ""),
                    "production_url": str(row.get("production_url") or ""),
                },
            }]
            binding_status = (shared.BIND_REVOKED if status == "revoked"
                              else shared.BIND_CONNECTED)
        else:
            # Authorized but the user never picked a Vercel project — preserved
            # exactly as pending, so the UI still offers the picker.
            resources = []
            binding_status = (shared.BIND_REVOKED if status == "revoked"
                              else shared.BIND_PENDING)
        _adopt(
            report=report, owner_user_id=str(row.get("owner_user_id") or ""),
            provider=registry.PROVIDER_VERCEL, account_key=account_key,
            account_label=str(row.get("account_label") or ""), scopes="",
            encrypted=_envelopes(row, {"access_token": "access_token_enc"}),
            metadata={
                "team_id": team_id, "vercel_user_id": vercel_user_id,
                "installation_id": installation_id,
            },
            project_id=str(row.get("project_id") or ""), resources=resources,
            binding_status=binding_status, legacy_ref=ref,
        )


def _migrate_slack(report: MigrationReport) -> None:
    """The workspace INSTALLATION (bot token + team) is the authorization; the
    selected channels are the per-project resources."""
    channels_by_project: Dict[str, List[Dict[str, Any]]] = {}
    for row in _rows("slack_selected_channels"):
        pid = str(row.get("project_id") or "")
        channels_by_project.setdefault(pid, []).append({
            "resource_id": str(row.get("channel_id") or ""),
            "resource_label": str(row.get("name") or ""),
            "resource": {"is_private": bool(row.get("is_private"))},
        })

    for row in _rows("slack_connections"):
        team_id = str(row.get("team_id") or "").strip()
        pid = str(row.get("project_id") or "")
        ref = f"slack_connections[{pid}]"
        if not team_id:
            report.skipped_unsafe.append(
                f"{ref}: no recorded Slack workspace id — reconnect required")
            continue
        status = str(row.get("status") or "")
        resources = channels_by_project.get(pid, [])
        if resources:
            binding_status = (shared.BIND_REVOKED if status == "revoked"
                              else shared.BIND_CONNECTED)
        else:
            binding_status = (shared.BIND_REVOKED if status == "revoked"
                              else shared.BIND_PENDING)
        _adopt(
            report=report, owner_user_id=str(row.get("owner_user_id") or ""),
            provider=registry.PROVIDER_SLACK, account_key=team_id,
            account_label=str(row.get("team_name") or team_id),
            scopes=str(row.get("scopes") or ""),
            encrypted=_envelopes(row, {"bot_token": "bot_token_enc"}),
            metadata={
                "team_id": team_id,
                "team_name": str(row.get("team_name") or ""),
                "bot_user_id": str(row.get("bot_user_id") or ""),
                "app_id": str(row.get("app_id") or ""),
            },
            project_id=pid, resources=resources,
            binding_status=binding_status, legacy_ref=ref,
        )


def _finalize_credential_status(report: MigrationReport) -> None:
    """Mark an adopted authorization REVOKED when it holds no usable credential.

    Legacy `mark_revoked()` wiped a connection's tokens in place and left the row
    behind so the UI could offer a reconnect. Migrating such a row produces an
    authorization with EMPTY credentials — and since `upsert_authorization`
    creates rows as `authorized`, the account-level Connectors card would report
    a dead grant as "Connected" while every sync failed. That is the one state
    the account view must never claim.

    The check runs AFTER every provider, because it is order-dependent: a mailbox
    with one revoked and one live legacy row merges into ONE grant that IS usable
    (the live row contributes the credential), and it must stay authorized. Only
    a grant where NOTHING contributed a credential is revoked here.

    Providers that store no credential by design (GitHub — the App mints
    short-lived installation tokens on demand) are exempt: for them, "no
    credential" is the correct and healthy state."""
    for auth_id in list(report._adopted):
        auth = shared.get_authorization(auth_id)
        if auth is None or auth.is_revoked:
            continue
        spec = registry.spec(auth.provider)
        if spec is None or not spec.credential_fields:
            continue  # nothing to store ⇒ nothing to be missing
        if any(auth.credential(f) for f in spec.credential_fields):
            continue  # a usable credential survived
        shared.mark_authorization_revoked(auth.id)
        report.revoked_without_credentials.append(
            f"{auth.provider}[{auth.account_label or auth.account_key}]: "
            f"migrated with no usable credential — reconnect required")


def migrate_legacy_connections() -> MigrationReport:
    """Run the whole migration. Idempotent; safe to call on every boot."""
    report = MigrationReport()
    shared.init_tables()
    steps = (
        ("gmail", lambda: _migrate_google(report, table="gmail_connections",
                                         provider=registry.PROVIDER_GMAIL)),
        ("calendar", lambda: _migrate_google(report, table="calendar_connections",
                                            provider=registry.PROVIDER_CALENDAR)),
        ("github", lambda: _migrate_github(report)),
        ("vercel", lambda: _migrate_vercel(report)),
        ("slack", lambda: _migrate_slack(report)),
    )
    for name, run in steps:
        try:
            run()
        except Exception as exc:  # pragma: no cover — one provider must not stop the rest
            report.errors.append(f"{name}: {type(exc).__name__}")
            logger.warning("connectors.migrate %s failed: %s", name, type(exc).__name__)
    try:
        _finalize_credential_status(report)
    except Exception as exc:  # pragma: no cover — defensive
        report.errors.append(f"finalize: {type(exc).__name__}")
        logger.warning("connectors.migrate finalize failed: %s", type(exc).__name__)
    if (report.authorizations_created or report.bindings_created
            or report.skipped_unsafe or report.revoked_without_credentials):
        logger.info("connectors.migrate report: %s", report.as_dict())
    return report


__all__ = ["MigrationReport", "migrate_legacy_connections"]
