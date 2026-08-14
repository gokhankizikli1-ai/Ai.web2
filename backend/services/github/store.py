# coding: utf-8
"""GitHub connector — durable connection + delivery-dedup store.

WHY A SMALL TABLE (NOT project.metadata_json)
----------------------------------------------
A project's `metadata_json` (projects.store) is the right home for a value you
only ever read *given the project id*. GitHub is the opposite: a webhook
arrives keyed by REPOSITORY / INSTALLATION and must be routed to the owning
project. That is a REVERSE lookup, which a JSON blob on each project row cannot
serve without scanning every project (unsafe + O(projects)). So the connector
gets the SMALLEST durable mapping that genuinely makes multi-user installations
possible and reverse-routable — two tiny tables in the EXISTING `projects.db`
(same file as `projects` and `observations`, so scoping joins stay local):

  github_connections   (project_id ⇄ installation_id ⇄ repo)   — the mapping
  github_deliveries    (delivery_id)                            — webhook dedup

Nothing here decides what matters, calls a model, or creates a task.

ISOLATION
---------
* `owner_user_id` is stored denormalized from the project at connect time and
  is the ONLY user id ever used to scope recorded observations — a caller can
  never smuggle a different user_id in.
* UNIQUE(installation_id, repo_full_name): a given repo under a given
  installation maps to exactly one project, so repo A can never inject activity
  into an unrelated project B.
* A webhook for an unknown installation/repo resolves to no connection → the
  delivery is safely ignored (no observation written).
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from typing import List, Optional

from backend.core.paths import resolve_db_path
from backend.services.orchestrator import _sqlite

logger = logging.getLogger(__name__)

# Co-located with projects + observations so (user, project) scoping is one DB.
DB_PATH = resolve_db_path("projects.db", "PROJECTS_DB_PATH")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS github_connections (
    project_id       TEXT PRIMARY KEY,           -- one GitHub repo per project (v1)
    owner_user_id    TEXT NOT NULL,              -- authoritative scope (from project)
    installation_id  TEXT NOT NULL,              -- GitHub App installation
    repo_full_name   TEXT NOT NULL,              -- "owner/repo"
    repo_id          TEXT NOT NULL DEFAULT '',   -- stable numeric id (survives rename)
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL,
    last_sync_at     TEXT NOT NULL DEFAULT ''     -- last successful backfill (UX + first-sync detection)
);
-- A repo under an installation belongs to exactly one project → no cross-project leak.
CREATE UNIQUE INDEX IF NOT EXISTS ux_ghconn_inst_repo
    ON github_connections(installation_id, repo_full_name);
CREATE INDEX IF NOT EXISTS ix_ghconn_repo  ON github_connections(repo_full_name);
CREATE INDEX IF NOT EXISTS ix_ghconn_inst  ON github_connections(installation_id);
CREATE INDEX IF NOT EXISTS ix_ghconn_owner ON github_connections(owner_user_id);

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


def _now() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _migrate_add_last_sync_at(c) -> None:
    """Additive, idempotent: pre-existing github_connections rows (created before
    the last_sync_at column existed) get it via ALTER. ALTER TABLE ADD COLUMN
    raises when the column already exists — swallow that one case so init stays
    idempotent. Legacy rows default to '' (⇒ treated as never-synced, so the
    next sync runs the fuller initial import)."""
    try:
        cols = {r["name"] for r in c.execute("PRAGMA table_info(github_connections)").fetchall()}
        if "last_sync_at" not in cols:
            c.execute("ALTER TABLE github_connections ADD COLUMN last_sync_at TEXT NOT NULL DEFAULT ''")
    except Exception as exc:  # pragma: no cover — defensive
        logger.debug("github.store last_sync_at migration soft-failed: %s", exc)


def init_github_tables() -> None:
    """Idempotent, additive bring-up. Failures are swallowed (never block)."""
    try:
        with _sqlite.connection(DB_PATH) as c:
            c.executescript(_SCHEMA)
            _migrate_add_last_sync_at(c)
    except Exception as exc:  # pragma: no cover — defensive
        logger.warning("github.store.init failed: %s", exc)


def _row_to_conn(row) -> GitHubConnection:
    d = dict(row)
    return GitHubConnection(
        project_id=str(d["project_id"]),
        owner_user_id=str(d["owner_user_id"]),
        installation_id=str(d["installation_id"]),
        repo_full_name=str(d["repo_full_name"]),
        repo_id=str(d.get("repo_id") or ""),
        created_at=str(d["created_at"]),
        updated_at=str(d["updated_at"]),
        last_sync_at=str(d.get("last_sync_at") or ""),
    )


def upsert_connection(*, project_id: str, owner_user_id: str, installation_id: str,
                      repo_full_name: str, repo_id: str = "") -> Optional[GitHubConnection]:
    """Create/replace the GitHub connection for a project.

    Returns None on invalid input or when the (installation, repo) pair is
    already claimed by a DIFFERENT project (the UNIQUE index) — the caller maps
    that to a 409 conflict. The `owner_user_id` MUST be the project's real
    owner; the route resolves it from `projects.get_project(...).owner_user_id`,
    never from client input."""
    project_id = str(project_id or "").strip()
    owner_user_id = str(owner_user_id or "").strip()
    installation_id = str(installation_id or "").strip()
    repo_full_name = str(repo_full_name or "").strip().strip("/")
    if not (project_id and owner_user_id and installation_id and repo_full_name):
        return None
    if repo_full_name.count("/") != 1:
        return None

    init_github_tables()
    now = _now()
    try:
        with _sqlite.writer_tx(DB_PATH) as c:
            # Guard the reverse-uniqueness explicitly so a conflict with another
            # project is a clean None, not an opaque IntegrityError.
            clash = c.execute(
                """SELECT project_id FROM github_connections
                   WHERE installation_id=? AND repo_full_name=? AND project_id<>?""",
                (installation_id, repo_full_name, project_id),
            ).fetchone()
            if clash is not None:
                logger.info("github.store.upsert conflict: repo already connected elsewhere")
                return None
            existing = c.execute(
                "SELECT created_at FROM github_connections WHERE project_id=?",
                (project_id,),
            ).fetchone()
            created_at = str(existing["created_at"]) if existing else now
            c.execute(
                """INSERT INTO github_connections
                   (project_id, owner_user_id, installation_id, repo_full_name,
                    repo_id, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(project_id) DO UPDATE SET
                     owner_user_id=excluded.owner_user_id,
                     installation_id=excluded.installation_id,
                     repo_full_name=excluded.repo_full_name,
                     repo_id=excluded.repo_id,
                     updated_at=excluded.updated_at""",
                (project_id, owner_user_id, installation_id, repo_full_name,
                 str(repo_id or ""), created_at, now),
            )
        return get_connection(project_id)
    except Exception as exc:
        logger.warning("github.store.upsert_connection failed: %s", type(exc).__name__)
        return None


def get_connection(project_id: str) -> Optional[GitHubConnection]:
    if not project_id:
        return None
    init_github_tables()
    try:
        with _sqlite.connection(DB_PATH) as c:
            row = c.execute(
                "SELECT * FROM github_connections WHERE project_id=?",
                (str(project_id),),
            ).fetchone()
        return _row_to_conn(row) if row else None
    except Exception:
        return None


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
    try:
        with _sqlite.connection(DB_PATH) as c:
            rows = c.execute(
                """SELECT * FROM github_connections
                   WHERE installation_id=? AND (repo_full_name=? OR (repo_id<>'' AND repo_id=?))""",
                (installation_id, repo_full_name, repo_id or "\x00"),
            ).fetchall()
        return [_row_to_conn(r) for r in rows]
    except Exception:
        return []


def delete_connection(project_id: str) -> bool:
    if not project_id:
        return False
    init_github_tables()
    try:
        with _sqlite.connection(DB_PATH) as c:
            cur = c.execute(
                "DELETE FROM github_connections WHERE project_id=?", (str(project_id),))
            return cur.rowcount > 0
    except Exception:
        return False


def mark_synced(project_id: str) -> None:
    """Stamp the connection's last successful backfill time. Used both for the
    Connectors UX ("last sync …") and to detect the FIRST sync of a connection
    (empty ⇒ run the fuller bounded initial import). Best-effort; never raises."""
    project_id = str(project_id or "").strip()
    if not project_id:
        return
    init_github_tables()
    try:
        with _sqlite.connection(DB_PATH) as c:
            c.execute(
                "UPDATE github_connections SET last_sync_at=?, updated_at=? WHERE project_id=?",
                (_now(), _now(), project_id),
            )
    except Exception:
        pass


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
        with _sqlite.connection(DB_PATH) as c:
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
    try:
        with _sqlite.connection(DB_PATH) as c:
            c.execute("DROP TABLE IF EXISTS github_connections")
            c.execute("DROP TABLE IF EXISTS github_deliveries")
    except Exception:
        pass


__all__ = [
    "GitHubConnection", "init_github_tables", "upsert_connection",
    "get_connection", "find_connections_for_repo", "delete_connection",
    "mark_synced", "mark_delivery",
]
