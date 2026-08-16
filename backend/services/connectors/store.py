# coding: utf-8
"""Durable store for the shared connector authority.

Two tables (see the package docstring for the model):

  connector_authorizations     one provider account, authorized once per owner
  connector_project_bindings   which project uses which authorization + resources

ISOLATION INVARIANTS (enforced here, not just at the route)
-----------------------------------------------------------
* `owner_user_id` on an authorization is the AUTHENTICATED Korvix owner. It is
  written from server-resolved identity only; nothing in this module accepts an
  owner id that a caller could have influenced without the route having already
  proved it.
* A binding is refused unless the authorization it points at belongs to the SAME
  owner recorded on the binding. That single check is what stops user A binding
  user B's Gmail authorization to A's project.
* UNIQUE(owner_user_id, provider, account_key) — re-authorizing the same provider
  account updates the existing row instead of creating a parallel credential, and
  two DIFFERENT owners who connect the same provider account keep two separate,
  independent authorizations (they are never deduplicated across owners).

SECRETS
-------
`credentials_json` is a JSON object mapping a credential field name to an
ENCRYPTED envelope from `backend.services.gmail.crypto`. Every value is
ciphertext; the object itself carries no secret. `public_view()` never includes
it. Encryption happens in `put_credentials`, which raises
`CredentialEncryptionError` rather than writing anything readable.
"""
from __future__ import annotations

import json
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from backend.core.paths import resolve_db_path
# The single credential-at-rest authority — imported, never reimplemented.
from backend.services.gmail import crypto as credential_crypto
from backend.services.orchestrator import _sqlite

logger = logging.getLogger(__name__)

def _db() -> str:
    """Resolve the DB file on EVERY call.

    The legacy connector stores captured this once at import. Tests (and any
    runtime that repoints `PROJECTS_DB_PATH`) need the current value, and the
    shared authority is imported by five connectors, so a stale module-level
    capture here would be five times as wrong. `resolve_db_path` is a cheap
    pure-string resolution."""
    return resolve_db_path("projects.db", "PROJECTS_DB_PATH")


#: Back-compat alias for callers that referenced the module's file directly.
#: Prefer `_db()` inside this module.
DB_PATH = _db()

# Authorization lifecycle
AUTH_ACTIVE = "authorized"
AUTH_REVOKED = "revoked"

# Binding lifecycle
BIND_PENDING = "pending_selection"   # authorized, but no resource chosen yet
BIND_CONNECTED = "connected"
BIND_REVOKED = "revoked"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS connector_authorizations (
    id                TEXT PRIMARY KEY,
    owner_user_id     TEXT NOT NULL,               -- authenticated Korvix owner
    provider          TEXT NOT NULL,               -- gmail|calendar|github|vercel|slack
    account_key       TEXT NOT NULL,               -- provider account identity
    account_label     TEXT NOT NULL DEFAULT '',    -- display only
    scopes            TEXT NOT NULL DEFAULT '',
    credentials_json  TEXT NOT NULL DEFAULT '{}',  -- {field: encrypted envelope}
    metadata_json     TEXT NOT NULL DEFAULT '{}',  -- NON-SECRET provider metadata
    status            TEXT NOT NULL DEFAULT 'authorized',
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL,
    last_sync_at      TEXT NOT NULL DEFAULT ''
);
-- One authorization per (owner, provider, provider account). Two owners who
-- connect the same provider account keep two independent rows.
CREATE UNIQUE INDEX IF NOT EXISTS ux_connauth_owner_provider_account
    ON connector_authorizations(owner_user_id, provider, account_key);
CREATE INDEX IF NOT EXISTS ix_connauth_owner    ON connector_authorizations(owner_user_id);
CREATE INDEX IF NOT EXISTS ix_connauth_provider ON connector_authorizations(provider);

CREATE TABLE IF NOT EXISTS connector_project_bindings (
    project_id        TEXT NOT NULL,
    provider          TEXT NOT NULL,
    resource_id       TEXT NOT NULL DEFAULT '',    -- '' = whole account / not chosen yet
    authorization_id  TEXT NOT NULL,
    owner_user_id     TEXT NOT NULL,               -- denormalized scope (== auth owner)
    resource_label    TEXT NOT NULL DEFAULT '',
    resource_json     TEXT NOT NULL DEFAULT '{}',  -- NON-SECRET resource metadata
    status            TEXT NOT NULL DEFAULT 'connected',
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL,
    last_sync_at      TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (project_id, provider, resource_id)
);
CREATE INDEX IF NOT EXISTS ix_connbind_auth     ON connector_project_bindings(authorization_id);
CREATE INDEX IF NOT EXISTS ix_connbind_owner    ON connector_project_bindings(owner_user_id);
CREATE INDEX IF NOT EXISTS ix_connbind_provider ON connector_project_bindings(provider);
CREATE INDEX IF NOT EXISTS ix_connbind_resource ON connector_project_bindings(provider, resource_id);
"""

_initialized = False


def _now() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _json_load(raw: Optional[str]) -> Dict[str, Any]:
    if not raw:
        return {}
    try:
        value = json.loads(raw)
        return value if isinstance(value, dict) else {}
    except Exception:
        return {}


def _json_dump(value: Optional[Dict[str, Any]]) -> str:
    try:
        return json.dumps(value or {}, ensure_ascii=False, sort_keys=True)
    except Exception:
        return "{}"


def init_tables() -> None:
    """Idempotent, additive bring-up. Failures are swallowed (never block)."""
    global _initialized
    try:
        with _sqlite.connection(_db()) as c:
            c.executescript(_SCHEMA)
        _initialized = True
    except Exception as exc:  # pragma: no cover — defensive
        logger.warning("connectors.store.init failed: %s", exc)


@dataclass(frozen=True)
class Authorization:
    id: str
    owner_user_id: str
    provider: str
    account_key: str
    account_label: str
    scopes: str
    credentials: Dict[str, str]      # field -> ENCRYPTED envelope
    metadata: Dict[str, Any]
    status: str
    created_at: str
    updated_at: str
    last_sync_at: str

    @property
    def is_revoked(self) -> bool:
        return self.status == AUTH_REVOKED

    def credential(self, field_name: str) -> str:
        """The stored ENVELOPE (still encrypted) for a credential field."""
        return str(self.credentials.get(field_name) or "")

    def decrypt(self, field_name: str) -> str:
        """Decrypt one credential field. Raises CredentialEncryptionError when
        encryption is unavailable or the envelope is bad; returns "" when the
        authorization carries no such credential."""
        env = self.credential(field_name)
        if not env:
            return ""
        return credential_crypto.decrypt(env)

    def public_view(self) -> Dict[str, Any]:
        """Frontend-safe projection — carries NO credential material."""
        return {
            "id": self.id,
            "provider": self.provider,
            "account_label": self.account_label,
            "scopes": [s for s in (self.scopes or "").replace(",", " ").split(" ") if s],
            "status": self.status,
            "authorized": self.status == AUTH_ACTIVE,
            "metadata": dict(self.metadata),
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "last_sync_at": self.last_sync_at or None,
        }


@dataclass(frozen=True)
class Binding:
    project_id: str
    provider: str
    resource_id: str
    authorization_id: str
    owner_user_id: str
    resource_label: str
    resource: Dict[str, Any] = field(default_factory=dict)
    status: str = BIND_CONNECTED
    created_at: str = ""
    updated_at: str = ""
    last_sync_at: str = ""

    @property
    def is_pending(self) -> bool:
        return self.status == BIND_PENDING

    def public_view(self) -> Dict[str, Any]:
        return {
            "project_id": self.project_id,
            "provider": self.provider,
            "resource_id": self.resource_id or None,
            "resource_label": self.resource_label or None,
            "resource": dict(self.resource),
            "status": self.status,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "last_sync_at": self.last_sync_at or None,
        }


def _row_to_auth(row) -> Authorization:
    d = dict(row)
    creds_raw = _json_load(d.get("credentials_json"))
    return Authorization(
        id=str(d["id"]),
        owner_user_id=str(d["owner_user_id"]),
        provider=str(d["provider"]),
        account_key=str(d.get("account_key") or ""),
        account_label=str(d.get("account_label") or ""),
        scopes=str(d.get("scopes") or ""),
        credentials={str(k): str(v or "") for k, v in creds_raw.items()},
        metadata=_json_load(d.get("metadata_json")),
        status=str(d.get("status") or AUTH_ACTIVE),
        created_at=str(d["created_at"]),
        updated_at=str(d["updated_at"]),
        last_sync_at=str(d.get("last_sync_at") or ""),
    )


def _row_to_binding(row) -> Binding:
    d = dict(row)
    return Binding(
        project_id=str(d["project_id"]),
        provider=str(d["provider"]),
        resource_id=str(d.get("resource_id") or ""),
        authorization_id=str(d["authorization_id"]),
        owner_user_id=str(d["owner_user_id"]),
        resource_label=str(d.get("resource_label") or ""),
        resource=_json_load(d.get("resource_json")),
        status=str(d.get("status") or BIND_CONNECTED),
        created_at=str(d.get("created_at") or ""),
        updated_at=str(d.get("updated_at") or ""),
        last_sync_at=str(d.get("last_sync_at") or ""),
    )


# ── Authorizations ───────────────────────────────────────────────────────────

def upsert_authorization(
    *, owner_user_id: str, provider: str, account_key: str,
    account_label: str = "", scopes: str = "",
    credentials: Optional[Dict[str, str]] = None,
    encrypted_credentials: Optional[Dict[str, str]] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> Optional[Authorization]:
    """Create or refresh the authorization for (owner, provider, account).

    `credentials` are PLAINTEXT values encrypted here before storage — this
    raises `CredentialEncryptionError` (via the credential authority) when
    encryption is unavailable, so a readable token can never reach disk. A field
    whose value is empty/None is LEFT AS IT WAS (providers routinely omit a
    refresh token on re-consent); pass an explicit empty dict to change nothing.

    `encrypted_credentials` accepts values that are ALREADY envelopes — used
    only by the legacy migration, which copies ciphertext without ever holding a
    plaintext secret. Values are validated to look like envelopes.

    `metadata` is merged over the existing metadata (non-secret only).
    """
    owner_user_id = str(owner_user_id or "").strip()
    provider = str(provider or "").strip().lower()
    account_key = str(account_key or "").strip()
    if not owner_user_id or not provider or not account_key:
        return None

    # Encrypt BEFORE opening a transaction: a missing key must fail closed with
    # nothing written.
    new_envelopes: Dict[str, str] = {}
    for k, v in (credentials or {}).items():
        if v:
            new_envelopes[str(k)] = credential_crypto.encrypt(str(v))
    for k, v in (encrypted_credentials or {}).items():
        env = str(v or "")
        if not env:
            continue
        if not credential_crypto.is_envelope(env):
            # Refuse to store anything that is not provably ciphertext.
            logger.warning("connectors.store: refused non-envelope credential for %s", provider)
            return None
        new_envelopes[str(k)] = env

    init_tables()
    now = _now()
    try:
        with _sqlite.writer_tx(_db()) as c:
            existing = c.execute(
                """SELECT * FROM connector_authorizations
                   WHERE owner_user_id=? AND provider=? AND account_key=?""",
                (owner_user_id, provider, account_key),
            ).fetchone()
            if existing is None:
                auth_id = f"auth_{uuid.uuid4().hex[:24]}"
                c.execute(
                    """INSERT INTO connector_authorizations
                       (id, owner_user_id, provider, account_key, account_label, scopes,
                        credentials_json, metadata_json, status, created_at, updated_at, last_sync_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '')""",
                    (auth_id, owner_user_id, provider, account_key,
                     str(account_label or "")[:200], str(scopes or "")[:1000],
                     _json_dump(new_envelopes), _json_dump(metadata or {}),
                     AUTH_ACTIVE, now, now),
                )
            else:
                auth_id = str(existing["id"])
                merged_creds = _json_load(existing["credentials_json"])
                merged_creds.update(new_envelopes)
                merged_meta = _json_load(existing["metadata_json"])
                merged_meta.update(metadata or {})
                c.execute(
                    """UPDATE connector_authorizations
                       SET account_label=?, scopes=?, credentials_json=?, metadata_json=?,
                           status=?, updated_at=?
                       WHERE id=?""",
                    (str(account_label or existing["account_label"] or "")[:200],
                     str(scopes or existing["scopes"] or "")[:1000],
                     _json_dump(merged_creds), _json_dump(merged_meta),
                     AUTH_ACTIVE, now, auth_id),
                )
        return get_authorization(auth_id)
    except Exception as exc:
        logger.warning("connectors.store.upsert_authorization failed: %s", type(exc).__name__)
        return None


def get_authorization(authorization_id: str) -> Optional[Authorization]:
    authorization_id = str(authorization_id or "").strip()
    if not authorization_id:
        return None
    init_tables()
    try:
        with _sqlite.connection(_db()) as c:
            row = c.execute(
                "SELECT * FROM connector_authorizations WHERE id=?",
                (authorization_id,),
            ).fetchone()
        return _row_to_auth(row) if row else None
    except Exception:
        return None


def find_authorization(
    *, owner_user_id: str, provider: str, account_key: str = "",
) -> Optional[Authorization]:
    """The owner's authorization for a provider. With `account_key` this is an
    exact lookup; without it, the most recently updated ACTIVE authorization for
    that provider (v1 authorizes one account per provider per owner)."""
    owner_user_id = str(owner_user_id or "").strip()
    provider = str(provider or "").strip().lower()
    if not owner_user_id or not provider:
        return None
    init_tables()
    try:
        with _sqlite.connection(_db()) as c:
            if str(account_key or "").strip():
                row = c.execute(
                    """SELECT * FROM connector_authorizations
                       WHERE owner_user_id=? AND provider=? AND account_key=?""",
                    (owner_user_id, provider, str(account_key).strip()),
                ).fetchone()
            else:
                row = c.execute(
                    """SELECT * FROM connector_authorizations
                       WHERE owner_user_id=? AND provider=?
                       ORDER BY (status=?) DESC, updated_at DESC LIMIT 1""",
                    (owner_user_id, provider, AUTH_ACTIVE),
                ).fetchone()
        return _row_to_auth(row) if row else None
    except Exception:
        return None


def list_authorizations(owner_user_id: str, *, provider: str = "") -> List[Authorization]:
    owner_user_id = str(owner_user_id or "").strip()
    if not owner_user_id:
        return []
    init_tables()
    try:
        with _sqlite.connection(_db()) as c:
            if provider:
                rows = c.execute(
                    """SELECT * FROM connector_authorizations
                       WHERE owner_user_id=? AND provider=? ORDER BY provider, updated_at DESC""",
                    (owner_user_id, str(provider).strip().lower()),
                ).fetchall()
            else:
                rows = c.execute(
                    """SELECT * FROM connector_authorizations
                       WHERE owner_user_id=? ORDER BY provider, updated_at DESC""",
                    (owner_user_id,),
                ).fetchall()
        return [_row_to_auth(r) for r in rows]
    except Exception:
        return []


def count_active_authorizations_for_account(
    *, provider: str, account_key: str, exclude_authorization_id: str = "",
) -> int:
    """How many LIVE authorizations exist for a provider account, across owners.

    Read-only, used only to answer "would a remote revoke break something else?".
    A blank account key matches nothing — we cannot prove identity, so we must
    not claim a match."""
    provider = str(provider or "").strip().lower()
    account_key = str(account_key or "").strip()
    if not provider or not account_key:
        return 0
    init_tables()
    try:
        sql = ("SELECT COUNT(*) AS n FROM connector_authorizations "
               "WHERE provider=? AND account_key=? AND status=?")
        params: List[Any] = [provider, account_key, AUTH_ACTIVE]
        if str(exclude_authorization_id or "").strip():
            sql += " AND id<>?"
            params.append(str(exclude_authorization_id).strip())
        with _sqlite.connection(_db()) as c:
            row = c.execute(sql, params).fetchone()
        return int(row["n"]) if row else 0
    except Exception:
        return 0


def update_credentials(authorization_id: str, credentials: Dict[str, str]) -> bool:
    """Persist refreshed credential values (encrypted). Never stores plaintext."""
    authorization_id = str(authorization_id or "").strip()
    if not authorization_id:
        return False
    envelopes = {
        str(k): (credential_crypto.encrypt(str(v)) if v else "")
        for k, v in (credentials or {}).items()
    }
    init_tables()
    try:
        with _sqlite.writer_tx(_db()) as c:
            row = c.execute(
                "SELECT credentials_json FROM connector_authorizations WHERE id=?",
                (authorization_id,),
            ).fetchone()
            if row is None:
                return False
            merged = _json_load(row["credentials_json"])
            merged.update(envelopes)
            cur = c.execute(
                "UPDATE connector_authorizations SET credentials_json=?, updated_at=? WHERE id=?",
                (_json_dump(merged), _now(), authorization_id),
            )
            return (cur.rowcount or 0) > 0
    except Exception as exc:
        logger.warning("connectors.store.update_credentials failed: %s", type(exc).__name__)
        return False


def update_metadata(authorization_id: str, metadata: Dict[str, Any]) -> bool:
    """Merge NON-SECRET provider metadata onto an authorization."""
    authorization_id = str(authorization_id or "").strip()
    if not authorization_id or not metadata:
        return False
    init_tables()
    try:
        with _sqlite.writer_tx(_db()) as c:
            row = c.execute(
                "SELECT metadata_json FROM connector_authorizations WHERE id=?",
                (authorization_id,),
            ).fetchone()
            if row is None:
                return False
            merged = _json_load(row["metadata_json"])
            merged.update(metadata)
            cur = c.execute(
                "UPDATE connector_authorizations SET metadata_json=?, updated_at=? WHERE id=?",
                (_json_dump(merged), _now(), authorization_id),
            )
            return (cur.rowcount or 0) > 0
    except Exception:
        return False


def update_account_label(authorization_id: str, account_label: str) -> bool:
    authorization_id = str(authorization_id or "").strip()
    label = str(account_label or "").strip()
    if not authorization_id or not label:
        return False
    init_tables()
    try:
        with _sqlite.connection(_db()) as c:
            cur = c.execute(
                "UPDATE connector_authorizations SET account_label=?, updated_at=? WHERE id=?",
                (label[:200], _now(), authorization_id),
            )
            return (cur.rowcount or 0) > 0
    except Exception:
        return False


def rekey_authorization(
    authorization_id: str, *, account_key: str, account_label: str = "",
) -> Optional[str]:
    """Give an authorization its REAL provider account identity once it becomes
    known.

    Some providers only reveal the account label on a later bounded read (Google
    Calendar's identity probe is best-effort and can legitimately come back
    empty), so the authorization is first keyed by a deterministic per-owner
    placeholder. This promotes it to the real key.

    Three outcomes, all owner-scoped — this NEVER touches another owner's row:
      * the target key is free            → rename in place; returns this id;
      * the target key is already held by ANOTHER authorization of the SAME
        owner and provider → that is genuinely the same provider account, so
        this row's project bindings are repointed to it and this row is deleted;
        returns the surviving id;
      * anything else                     → no-op; returns None.
    """
    authorization_id = str(authorization_id or "").strip()
    account_key = str(account_key or "").strip()
    if not authorization_id or not account_key:
        return None
    init_tables()
    now = _now()
    try:
        with _sqlite.writer_tx(_db()) as c:
            row = c.execute(
                "SELECT * FROM connector_authorizations WHERE id=?", (authorization_id,)
            ).fetchone()
            if row is None:
                return None
            if str(row["account_key"]) == account_key:
                if account_label:
                    c.execute(
                        "UPDATE connector_authorizations SET account_label=?, updated_at=? WHERE id=?",
                        (account_label[:200], now, authorization_id),
                    )
                return authorization_id
            owner = str(row["owner_user_id"])
            provider = str(row["provider"])
            other = c.execute(
                """SELECT id FROM connector_authorizations
                   WHERE owner_user_id=? AND provider=? AND account_key=? AND id<>?""",
                (owner, provider, account_key, authorization_id),
            ).fetchone()
            if other is None:
                c.execute(
                    """UPDATE connector_authorizations
                       SET account_key=?, account_label=?, updated_at=? WHERE id=?""",
                    (account_key, (account_label or account_key)[:200],
                     now, authorization_id),
                )
                return authorization_id
            survivor = str(other["id"])
            c.execute(
                """UPDATE connector_project_bindings
                   SET authorization_id=?, updated_at=? WHERE authorization_id=?""",
                (survivor, now, authorization_id),
            )
            c.execute("DELETE FROM connector_authorizations WHERE id=?", (authorization_id,))
            if account_label:
                c.execute(
                    "UPDATE connector_authorizations SET account_label=?, updated_at=? WHERE id=?",
                    (account_label[:200], now, survivor),
                )
            return survivor
    except Exception as exc:
        logger.warning("connectors.store.rekey_authorization failed: %s", type(exc).__name__)
        return None


def mark_authorization_synced(authorization_id: str) -> None:
    authorization_id = str(authorization_id or "").strip()
    if not authorization_id:
        return
    init_tables()
    try:
        with _sqlite.connection(_db()) as c:
            c.execute(
                "UPDATE connector_authorizations SET last_sync_at=?, updated_at=? WHERE id=?",
                (_now(), _now(), authorization_id),
            )
    except Exception:
        pass


def mark_authorization_revoked(authorization_id: str) -> bool:
    """Flag an authorization revoked AND wipe its credential material, so an
    invalid grant can never be used again. The row is retained (status surfaced
    to the UI) and every project binding is marked revoked with it — a binding
    can never outlive the credential it depends on."""
    authorization_id = str(authorization_id or "").strip()
    if not authorization_id:
        return False
    init_tables()
    try:
        with _sqlite.writer_tx(_db()) as c:
            cur = c.execute(
                """UPDATE connector_authorizations
                   SET status=?, credentials_json='{}', updated_at=?
                   WHERE id=?""",
                (AUTH_REVOKED, _now(), authorization_id),
            )
            if (cur.rowcount or 0) <= 0:
                return False
            c.execute(
                "UPDATE connector_project_bindings SET status=?, updated_at=? WHERE authorization_id=?",
                (BIND_REVOKED, _now(), authorization_id),
            )
            return True
    except Exception:
        return False


def delete_authorization(authorization_id: str) -> bool:
    """Hard-delete an authorization AND every project binding that depends on it.

    This is the ACCOUNT-level disconnect. Removing the authorization without its
    bindings would leave rows pointing at a credential that no longer exists, so
    both go in one transaction."""
    authorization_id = str(authorization_id or "").strip()
    if not authorization_id:
        return False
    init_tables()
    try:
        with _sqlite.writer_tx(_db()) as c:
            c.execute(
                "DELETE FROM connector_project_bindings WHERE authorization_id=?",
                (authorization_id,),
            )
            cur = c.execute(
                "DELETE FROM connector_authorizations WHERE id=?", (authorization_id,))
            return (cur.rowcount or 0) > 0
    except Exception:
        return False


# ── Project bindings ─────────────────────────────────────────────────────────

def _authorization_row(c, authorization_id: str):
    return c.execute(
        "SELECT id, owner_user_id, provider, status FROM connector_authorizations WHERE id=?",
        (authorization_id,),
    ).fetchone()


def set_binding(
    *, project_id: str, authorization_id: str, owner_user_id: str,
    resources: List[Dict[str, Any]], status: str = BIND_CONNECTED,
    replace: bool = True,
) -> List[Binding]:
    """Bind a project to (a subset of) an authorization's resources.

    `resources` is a list of `{resource_id, resource_label, resource}` dicts. An
    EMPTY list writes a single placeholder row with `resource_id=''` — that is
    how "authorized for this project but no resource chosen yet"
    (`status=pending_selection`) and "whole-account provider" (Gmail) are both
    represented.

    Ownership: the authorization must exist AND belong to `owner_user_id`. The
    caller has already proved that the same owner owns `project_id`. Either check
    failing returns [] — never a partial write.

    `replace=True` (default) replaces the project's whole resource set for this
    provider, so unselecting is just a shorter list.
    """
    project_id = str(project_id or "").strip()
    authorization_id = str(authorization_id or "").strip()
    owner_user_id = str(owner_user_id or "").strip()
    if not project_id or not authorization_id or not owner_user_id:
        return []

    init_tables()
    now = _now()
    try:
        with _sqlite.writer_tx(_db()) as c:
            auth = _authorization_row(c, authorization_id)
            if auth is None:
                return []
            if str(auth["owner_user_id"]) != owner_user_id:
                # Cross-owner binding attempt — refuse, write nothing.
                logger.warning("connectors.store.set_binding refused: owner mismatch")
                return []
            provider = str(auth["provider"])

            rows: List[Tuple[str, str, str]] = []
            seen = set()
            for item in (resources or []):
                rid = str((item or {}).get("resource_id") or "").strip()
                if rid in seen:
                    continue
                seen.add(rid)
                rows.append((
                    rid,
                    str((item or {}).get("resource_label") or "").strip()[:200],
                    _json_dump((item or {}).get("resource") or {}),
                ))
            if not rows:
                rows = [("", "", "{}")]

            # Preserve "connected since". A resource keeps its own created_at
            # across a re-selection, and a NEWLY chosen resource inherits the
            # earliest existing one — changing which repo/channel a project reads
            # is an edit to one connection, not a new connection, so the date the
            # project connected to the provider must not jump forward.
            prior = {
                str(r["resource_id"] or ""): str(r["created_at"] or now)
                for r in c.execute(
                    """SELECT resource_id, created_at FROM connector_project_bindings
                       WHERE project_id=? AND provider=?""",
                    (project_id, provider),
                ).fetchall()
            }
            connected_since = min(prior.values()) if prior else now
            if replace:
                c.execute(
                    "DELETE FROM connector_project_bindings WHERE project_id=? AND provider=?",
                    (project_id, provider),
                )
            for rid, label, res_json in rows:
                c.execute(
                    """INSERT INTO connector_project_bindings
                       (project_id, provider, resource_id, authorization_id, owner_user_id,
                        resource_label, resource_json, status, created_at, updated_at, last_sync_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '')
                       ON CONFLICT(project_id, provider, resource_id) DO UPDATE SET
                         authorization_id=excluded.authorization_id,
                         owner_user_id=excluded.owner_user_id,
                         resource_label=excluded.resource_label,
                         resource_json=excluded.resource_json,
                         status=excluded.status,
                         updated_at=excluded.updated_at""",
                    (project_id, provider, rid, authorization_id, owner_user_id,
                     label, res_json, status, prior.get(rid, connected_since), now),
                )
        return list_project_bindings(project_id, provider=provider)
    except Exception as exc:
        logger.warning("connectors.store.set_binding failed: %s", type(exc).__name__)
        return []


def list_project_bindings(project_id: str, *, provider: str = "") -> List[Binding]:
    project_id = str(project_id or "").strip()
    if not project_id:
        return []
    init_tables()
    try:
        with _sqlite.connection(_db()) as c:
            if provider:
                rows = c.execute(
                    """SELECT * FROM connector_project_bindings
                       WHERE project_id=? AND provider=?
                       ORDER BY resource_label COLLATE NOCASE, resource_id""",
                    (project_id, str(provider).strip().lower()),
                ).fetchall()
            else:
                rows = c.execute(
                    """SELECT * FROM connector_project_bindings WHERE project_id=?
                       ORDER BY provider, resource_label COLLATE NOCASE, resource_id""",
                    (project_id,),
                ).fetchall()
        return [_row_to_binding(r) for r in rows]
    except Exception:
        return []


def list_authorization_bindings(authorization_id: str) -> List[Binding]:
    authorization_id = str(authorization_id or "").strip()
    if not authorization_id:
        return []
    init_tables()
    try:
        with _sqlite.connection(_db()) as c:
            rows = c.execute(
                """SELECT * FROM connector_project_bindings WHERE authorization_id=?
                   ORDER BY project_id, resource_label COLLATE NOCASE, resource_id""",
                (authorization_id,),
            ).fetchall()
        return [_row_to_binding(r) for r in rows]
    except Exception:
        return []


def find_bindings_by_resource(*, provider: str, resource_ids: List[str]) -> List[Binding]:
    """Reverse routing (a GitHub webhook arrives keyed by repo, not by project).
    Returns every binding whose resource matches. [] for an unknown resource →
    the event is safely ignored."""
    provider = str(provider or "").strip().lower()
    ids = [str(r).strip() for r in (resource_ids or []) if str(r or "").strip()]
    if not provider or not ids:
        return []
    init_tables()
    try:
        marks = ",".join("?" for _ in ids)
        with _sqlite.connection(_db()) as c:
            rows = c.execute(
                f"""SELECT * FROM connector_project_bindings
                    WHERE provider=? AND resource_id IN ({marks})""",
                [provider, *ids],
            ).fetchall()
        return [_row_to_binding(r) for r in rows]
    except Exception:
        return []


def list_live_bindings_for_account(*, provider: str, account_key: str) -> List[Binding]:
    """Every non-revoked project binding whose authorization is a given provider
    ACCOUNT (across owners). Read-only; used to answer "is this provider account
    still in use somewhere?" before a remote revoke."""
    provider = str(provider or "").strip().lower()
    account_key = str(account_key or "").strip()
    if not provider or not account_key:
        return []
    init_tables()
    try:
        with _sqlite.connection(_db()) as c:
            rows = c.execute(
                """SELECT b.* FROM connector_project_bindings b
                   JOIN connector_authorizations a ON a.id = b.authorization_id
                   WHERE a.provider=? AND a.account_key=? AND a.status=? AND b.status<>?""",
                (provider, account_key, AUTH_ACTIVE, BIND_REVOKED),
            ).fetchall()
        return [_row_to_binding(r) for r in rows]
    except Exception:
        return []


def get_binding(project_id: str, provider: str, resource_id: str = "") -> Optional[Binding]:
    bindings = list_project_bindings(project_id, provider=provider)
    if not bindings:
        return None
    if resource_id:
        for b in bindings:
            if b.resource_id == resource_id:
                return b
        return None
    return bindings[0]


def mark_binding_synced(project_id: str, provider: str) -> None:
    project_id = str(project_id or "").strip()
    provider = str(provider or "").strip().lower()
    if not project_id or not provider:
        return
    init_tables()
    try:
        with _sqlite.connection(_db()) as c:
            c.execute(
                """UPDATE connector_project_bindings
                   SET last_sync_at=?, updated_at=? WHERE project_id=? AND provider=?""",
                (_now(), _now(), project_id, provider),
            )
    except Exception:
        pass


def set_binding_status(project_id: str, provider: str, status: str) -> bool:
    project_id = str(project_id or "").strip()
    provider = str(provider or "").strip().lower()
    if not project_id or not provider:
        return False
    init_tables()
    try:
        with _sqlite.connection(_db()) as c:
            cur = c.execute(
                """UPDATE connector_project_bindings SET status=?, updated_at=?
                   WHERE project_id=? AND provider=?""",
                (str(status), _now(), project_id, provider),
            )
            return (cur.rowcount or 0) > 0
    except Exception:
        return False


def delete_project_binding(project_id: str, provider: str) -> bool:
    """Remove a project's binding to a provider.

    This is the PROJECT-level disconnect: the account authorization and every
    OTHER project's binding are untouched, and no credential is deleted."""
    project_id = str(project_id or "").strip()
    provider = str(provider or "").strip().lower()
    if not project_id or not provider:
        return False
    init_tables()
    try:
        with _sqlite.connection(_db()) as c:
            cur = c.execute(
                "DELETE FROM connector_project_bindings WHERE project_id=? AND provider=?",
                (project_id, provider),
            )
            return (cur.rowcount or 0) > 0
    except Exception:
        return False


def count_project_bindings(authorization_id: str) -> int:
    """How many DISTINCT projects use an authorization."""
    authorization_id = str(authorization_id or "").strip()
    if not authorization_id:
        return 0
    init_tables()
    try:
        with _sqlite.connection(_db()) as c:
            row = c.execute(
                """SELECT COUNT(DISTINCT project_id) AS n FROM connector_project_bindings
                   WHERE authorization_id=?""",
                (authorization_id,),
            ).fetchone()
        return int(row["n"]) if row else 0
    except Exception:
        return 0


def _reset_for_tests() -> None:
    global _initialized
    try:
        with _sqlite.connection(_db()) as c:
            c.execute("DROP TABLE IF EXISTS connector_project_bindings")
            c.execute("DROP TABLE IF EXISTS connector_authorizations")
    except Exception:
        pass
    _initialized = False


__all__ = [
    "Authorization", "Binding", "DB_PATH",
    "AUTH_ACTIVE", "AUTH_REVOKED",
    "BIND_PENDING", "BIND_CONNECTED", "BIND_REVOKED",
    "init_tables",
    "upsert_authorization", "get_authorization", "find_authorization",
    "list_authorizations", "count_active_authorizations_for_account",
    "update_credentials", "update_metadata", "update_account_label",
    "rekey_authorization",
    "mark_authorization_synced", "mark_authorization_revoked", "delete_authorization",
    "set_binding", "list_project_bindings", "list_authorization_bindings",
    "find_bindings_by_resource", "get_binding", "mark_binding_synced",
    "list_live_bindings_for_account",
    "set_binding_status", "delete_project_binding", "count_project_bindings",
]
