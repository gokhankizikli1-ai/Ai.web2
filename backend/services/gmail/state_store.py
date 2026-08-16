# coding: utf-8
"""Gmail connector — OAuth state store (CSRF + ownership binding).

The `state` parameter in the OAuth round-trip is the ONLY thing that ties the
unauthenticated Google callback back to an authenticated Korvix user + project.
It must therefore be:

  * UNGUESSABLE  — 256 bits from `secrets.token_urlsafe`, so a callback can't be
                   forged.
  * OWNERSHIP-BOUND — the (user_id, project_id, provider) that INITIATED the
                   flow is stored server-side and is the ONLY identity the
                   callback trusts. Query-string user_id/project_id are never
                   honoured — an attacker cannot attach Gmail to another user's
                   project.
  * ONE-TIME     — `consume()` atomically marks the row used; a replayed
                   callback finds it already consumed and is rejected.
  * SHORT-LIVED  — rows carry an expiry (config `state_ttl_s`); an expired state
                   is rejected even if never consumed.

Stored in the EXISTING `projects.db` (co-located with projects + observations),
using the shared `_sqlite` helper — no new database.
"""
from __future__ import annotations

import logging
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Optional

from backend.core.paths import resolve_db_path
from backend.services.gmail import config as gm_config
from backend.services.orchestrator import _sqlite

logger = logging.getLogger(__name__)

DB_PATH = resolve_db_path("projects.db", "PROJECTS_DB_PATH")

PROVIDER_GMAIL = "gmail"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS gmail_oauth_states (
    state         TEXT PRIMARY KEY,       -- 256-bit url-safe random (CSRF token)
    owner_user_id TEXT NOT NULL,          -- initiating (authenticated) user
    project_id    TEXT NOT NULL,          -- target project (ownership-checked at start)
    provider      TEXT NOT NULL DEFAULT 'gmail',
    created_at    TEXT NOT NULL,
    expires_at    TEXT NOT NULL,          -- ISO; rejected past this instant
    consumed_at   TEXT                    -- set once; a second consume is rejected
);
CREATE INDEX IF NOT EXISTS ix_gmail_states_expiry ON gmail_oauth_states(expires_at);
"""


@dataclass(frozen=True)
class OAuthState:
    state: str
    owner_user_id: str
    project_id: str
    provider: str


def _now() -> datetime:
    return datetime.utcnow()


def _iso(dt: datetime) -> str:
    return dt.isoformat() + "Z"


def _parse(ts: str) -> Optional[datetime]:
    try:
        return datetime.fromisoformat(str(ts).replace("Z", ""))
    except Exception:
        return None


def init_gmail_state_table() -> None:
    """Idempotent, additive bring-up. Failures are swallowed (never block)."""
    try:
        with _sqlite.connection(DB_PATH) as c:
            c.executescript(_SCHEMA)
    except Exception as exc:  # pragma: no cover — defensive
        logger.warning("gmail.state_store.init failed: %s", exc)


def create_state(*, owner_user_id: str, project_id: str,
                 provider: str = PROVIDER_GMAIL) -> str:
    """Mint and persist a one-time state bound to (user, project, provider).

    `project_id` may be EMPTY for an ACCOUNT-LEVEL authorization: the user is
    authorizing the provider for their Korvix account, not for one project, so
    there is no project to bind yet (the project binding is a separate, explicit
    step). The state is still ownership-bound to the authenticated user, still
    one-time, and still short-lived — the properties that make the callback safe
    do not depend on a project. Only the OWNER is required.

    Returns the opaque state token. Raises ValueError on a missing owner."""
    owner_user_id = str(owner_user_id or "").strip()
    project_id = str(project_id or "").strip()
    if not owner_user_id:
        raise ValueError("owner_user_id is required")
    init_gmail_state_table()
    token = secrets.token_urlsafe(32)  # 256 bits
    now = _now()
    expires = now + timedelta(seconds=gm_config.state_ttl_s())
    with _sqlite.connection(DB_PATH) as c:
        c.execute(
            """INSERT INTO gmail_oauth_states
               (state, owner_user_id, project_id, provider, created_at, expires_at, consumed_at)
               VALUES (?, ?, ?, ?, ?, ?, NULL)""",
            (token, owner_user_id, project_id, str(provider or PROVIDER_GMAIL),
             _iso(now), _iso(expires)),
        )
    return token


def consume(state: str) -> Optional[OAuthState]:
    """Atomically validate + consume a state.

    Returns the bound (user, project, provider) IFF the state exists, is not
    expired, and has NOT been consumed before — and in the same transaction
    marks it consumed so a replay fails. Returns None on unknown / expired /
    already-consumed (all indistinguishable to the caller → a single opaque
    'invalid state' rejection)."""
    state = str(state or "").strip()
    if not state:
        return None
    init_gmail_state_table()
    now = _now()
    try:
        with _sqlite.writer_tx(DB_PATH) as c:
            row = c.execute(
                "SELECT * FROM gmail_oauth_states WHERE state=?", (state,),
            ).fetchone()
            if row is None:
                return None
            d = dict(row)
            if d.get("consumed_at"):
                return None  # replay
            exp = _parse(str(d.get("expires_at") or ""))
            if exp is None or exp < now:
                return None  # expired
            cur = c.execute(
                "UPDATE gmail_oauth_states SET consumed_at=? WHERE state=? AND consumed_at IS NULL",
                (_iso(now), state),
            )
            # Guard against a race: if another writer consumed it first, the
            # UPDATE affected 0 rows → treat as already-consumed. `BEGIN
            # IMMEDIATE` (writer_tx) already serialises writers, so this is
            # belt-and-braces.
            if (cur.rowcount or 0) <= 0:
                return None
            return OAuthState(
                state=state,
                owner_user_id=str(d["owner_user_id"]),
                project_id=str(d["project_id"]),
                provider=str(d.get("provider") or PROVIDER_GMAIL),
            )
    except Exception as exc:
        logger.warning("gmail.state_store.consume failed: %s", type(exc).__name__)
        return None


def purge_expired(*, now: Optional[datetime] = None) -> int:
    """Delete expired / long-consumed states. Best-effort housekeeping; returns
    the number removed. Called opportunistically (e.g. on create) — never on a
    hot path guarantee."""
    init_gmail_state_table()
    cutoff = _iso(now or _now())
    try:
        with _sqlite.connection(DB_PATH) as c:
            cur = c.execute("DELETE FROM gmail_oauth_states WHERE expires_at < ?", (cutoff,))
            return cur.rowcount if cur.rowcount and cur.rowcount > 0 else 0
    except Exception:
        return 0


def _reset_for_tests() -> None:
    try:
        with _sqlite.connection(DB_PATH) as c:
            c.execute("DROP TABLE IF EXISTS gmail_oauth_states")
    except Exception:
        pass


__all__ = [
    "OAuthState", "PROVIDER_GMAIL", "init_gmail_state_table",
    "create_state", "consume", "purge_expired",
]
