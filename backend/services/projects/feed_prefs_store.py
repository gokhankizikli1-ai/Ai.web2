# coding: utf-8
"""Project Workspace — the canonical PER-USER, PER-PROJECT FEED PRESENTATION
preference.

WHAT THIS IS
------------
One person's answer to "what do I want to see first on this project's feed?".
A founder who lives in Gmail and a founder who lives in GitHub pull-requests
are looking at the same project and want different rows at the top of it, and a
Vercel-heavy project currently drowns both of them in deployments.

Three values, per source, and nothing more:

    highlight   guarantee this source a share of the feed's bounded slots
    normal      the default — compete for slots purely on recency
    hidden      keep this source out of MY feed

WHAT THIS IS ABSOLUTELY NOT — THE SEMANTIC BOUNDARY
---------------------------------------------------
This is a VIEW preference. It changes what one person sees on one surface. It
is not evidence, not policy, and not a second opinion about importance.

It does NOT:
  * delete, hide or alter a single observation. The observations store is
    untouched — nothing here writes to it, and every row a hidden source ever
    produced is still there, still readable, still ingested identically.
  * change connector ingestion, sync scheduling, or what a connector fetches.
  * reach Project Intelligence, Project Understanding, candidate synthesis, the
    action prioritizer, the Business Brain, execution policy, approvals, or
    durable memory. None of those ever read this table; the search that proves
    it is `grep -r feed_prefs_store backend/` — the only consumers are the
    workspace PROJECTION and the routes that let a person set their own value.
  * suppress decisive evidence. Needs Attention, Today, Focus, Project State,
    Project Understanding and "since your last visit" are computed from the
    same observations regardless of every preference here. If a user hides
    Vercel and production then breaks, the outage is still ranked, still shown,
    and the Brain still knows.

The single surface it touches is the chronological ACTIVITY feed — the "what
happened" list — which is exactly the list that gets dominated, and exactly the
list where "which of these do I care about" is a question of taste rather than
a question of fact.

WHY A NEW STORE WAS UNAVOIDABLE
-------------------------------
The audit found no per-user, per-project SETTINGS authority anywhere in Korvix:

  * `projects.views_store` is one per-user, per-project column with one meaning
    (the last-visit marker) and a monotonic clamp built into its writer — it
    stores an instant, not a choice;
  * Memory Plane "preferences" are SEMANTIC user memory that is deliberately
    injected into the model's prompt. Putting a display choice there would do
    the one thing this feature must never do: leak presentation into the
    Brain's context;
  * `auth_users` is account-level, so it could not express "GitHub matters on
    this project, Gmail on that one";
  * the connector stores hold bindings and credentials — a display preference
    is not a property of a connection, and a user must be able to de-emphasise
    a source without touching what the project is connected to.

So this is the smallest thing that works: one narrow table, in the SAME
`projects.db` as `projects`, `project_views` and `observations`, following
`views_store` line for line. One row per (user, project, source).

DEFAULTS AND FORWARD COMPATIBILITY
----------------------------------
Absence of a row means `normal`. A user who never opens Customize has no rows
at all and gets byte-identical behaviour to before this existed. An unknown or
malformed stored value ALSO reads as `normal`, so a bad write, a hand-edited
row, or a value from a future version can never blank someone's feed.

ISOLATION
---------
Keyed by (user_id, project_id, source), and the user id always comes from
server auth at the route boundary — never from a request body. One account's
preferences are unreachable from another's, and the same person's choices on
two projects are independent.

COST: pure SQLite, one bounded read per page load. ZERO model tokens.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Dict, Optional

from backend.core.paths import resolve_db_path
from backend.services.orchestrator import _sqlite

logger = logging.getLogger(__name__)

DB_PATH = resolve_db_path("projects.db", "PROJECTS_DB_PATH")

# ── The vocabulary. Three values, deliberately. ──────────────────────────────
PREF_HIGHLIGHT = "highlight"
PREF_NORMAL = "normal"
PREF_HIDDEN = "hidden"

#: Every value a caller may store. Anything else is refused on write and read
#: as `normal` — see the module docstring.
PREFERENCES = (PREF_HIGHLIGHT, PREF_NORMAL, PREF_HIDDEN)

#: Every source the feed can carry a preference for: the five connector
#: providers, plus the project's own non-connector activity sources.
#:
#: Deliberately derived from the connector REGISTRY rather than re-listed, so a
#: sixth connector becomes preferable the moment it is registered — the same
#: rule `observations_store.CONNECTOR_SOURCES` follows. The non-connector
#: sources are named here because they have no registry to come from.
NON_CONNECTOR_SOURCES = ("chat", "build", "task", "knowledge")

MAX_SOURCE = 40
#: A hard bound on how many rows one (user, project) may hold, so a scripted
#: client cannot grow the table without limit. Comfortably above the number of
#: real sources.
MAX_ROWS_PER_PROJECT = 32
#: How deep into a submitted map we are willing to look. Anything past this is
#: not a person customising a panel, and refusing to walk it is what keeps a
#: malformed or hostile request cheap.
MAX_INPUT_ENTRIES = 200

_SCHEMA = """
CREATE TABLE IF NOT EXISTS project_feed_preferences (
    user_id     TEXT NOT NULL,
    project_id  TEXT NOT NULL,
    source      TEXT NOT NULL,
    preference  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    PRIMARY KEY (user_id, project_id, source)
);
CREATE INDEX IF NOT EXISTS ix_feedprefs_project
    ON project_feed_preferences(project_id);
"""


def _db() -> str:
    """Resolve the DB file on EVERY call so a repointed `PROJECTS_DB_PATH` (in
    tests, or a runtime that moves the data directory) is always honoured."""
    return resolve_db_path("projects.db", "PROJECTS_DB_PATH")


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def init_feed_prefs_table() -> None:
    """Idempotent schema creation. Deliberately NOT memoised: `views_store`
    (the store this one is modelled on) creates its schema on every access for
    the same reason — a per-process "already done" flag makes the FIRST read of
    a process cost more statements than every later one, and the workspace read
    is measured for a FLAT, unchanging statement count. Two
    `CREATE … IF NOT EXISTS` are cheap; an unpredictable read cost is not."""
    try:
        with _sqlite.connection(_db()) as c:
            c.executescript(_SCHEMA)
    except Exception as exc:  # pragma: no cover — defensive
        logger.warning("projects.feed_prefs_store.init failed: %s", exc)


def known_sources() -> tuple:
    """Every source a preference may name, connectors first (in the registry's
    stable display order), then the project's own activity sources."""
    try:
        from backend.services.connectors import registry
        providers = tuple(registry.PROVIDER_ORDER)
    except Exception:  # pragma: no cover — defensive
        providers = ()
    return providers + NON_CONNECTOR_SOURCES


def normalize_source(value: str, known: Optional[frozenset] = None) -> str:
    """A source we recognise, or "" — an unknown source is never stored, so a
    typo'd or invented name cannot silently occupy a row forever.

    `known` lets a caller that checks many values in a row hoist the lookup set
    instead of rebuilding it per entry."""
    source = str(value or "").strip().lower()[:MAX_SOURCE]
    if not source:
        return ""
    allowed = known if known is not None else frozenset(known_sources())
    return source if source in allowed else ""


def normalize_preference(value: str) -> str:
    """A preference we recognise, or `normal`. Reading an unknown value as the
    DEFAULT rather than refusing it is what makes a malformed or future-version
    row harmless instead of a blanked feed."""
    pref = str(value or "").strip().lower()
    return pref if pref in PREFERENCES else PREF_NORMAL


def get_preferences(user_id: str, project_id: str) -> Dict[str, str]:
    """This user's EXPLICIT choices for this project, keyed by source.

    Only rows that differ from the default are meaningful, so a `normal` value
    is not returned — the caller's default is `normal` for everything, and
    round-tripping "normal" through the payload would make an untouched project
    look configured. ONE statement; {} on any failure."""
    if not (user_id and project_id):
        return {}
    try:
        # Schema + read on ONE connection: the workspace snapshot reads this on
        # every page load, so it is the one caller worth saving a connection
        # (and its three PRAGMAs) for.
        with _sqlite.connection(_db()) as c:
            c.executescript(_SCHEMA)
            rows = c.execute(
                "SELECT source, preference FROM project_feed_preferences "
                "WHERE user_id=? AND project_id=?",
                (str(user_id), str(project_id)),
            ).fetchall()
    except Exception as exc:
        logger.debug("projects.feed_prefs_store.get failed: %s", exc)
        return {}
    known = frozenset(known_sources())
    out: Dict[str, str] = {}
    for row in rows:
        source = normalize_source(str(row["source"]), known)
        if not source:
            continue          # a source we no longer recognise is simply ignored
        pref = normalize_preference(str(row["preference"]))
        if pref == PREF_NORMAL:
            continue          # the default is never reported as a choice
        out[source] = pref
    return out


def set_preferences(user_id: str, project_id: str,
                    preferences: Dict[str, str], *,
                    now: Optional[datetime] = None) -> Dict[str, str]:
    """REPLACE this user's choices for this project, and return what is stored.

    A whole-map replace (rather than a per-source patch) is deliberate: the
    Customize panel edits every source at once, so one idempotent write cannot
    leave a half-applied state behind, and pressing Save twice is a no-op.

    Unknown sources are dropped. `normal` is stored as the ABSENCE of a row, so
    resetting a source really removes its row instead of leaving a tombstone
    that looks like a choice. Returns {} on failure — the caller then keeps
    showing what is actually persisted rather than an optimistic lie."""
    if not (user_id and project_id):
        return {}
    init_feed_prefs_table()

    # The lookup set is built ONCE, and the input is walked at most
    # `MAX_INPUT_ENTRIES` deep. Without that bound a client could hand us a
    # dictionary of a million unknown keys and make the server walk all of them
    # to store nothing — cheap to send, not cheap to process.
    known = frozenset(known_sources())
    cleaned: Dict[str, str] = {}
    for index, (raw_source, raw_pref) in enumerate((preferences or {}).items()):
        if index >= MAX_INPUT_ENTRIES or len(cleaned) >= MAX_ROWS_PER_PROJECT:
            break
        source = normalize_source(raw_source, known)
        if not source or source in cleaned:
            continue
        pref = normalize_preference(raw_pref)
        if pref == PREF_NORMAL:
            continue
        cleaned[source] = pref

    stamp = _iso((now or datetime.now(timezone.utc)))
    try:
        with _sqlite.writer_tx(_db()) as c:
            c.execute(
                "DELETE FROM project_feed_preferences "
                "WHERE user_id=? AND project_id=?",
                (str(user_id), str(project_id)))
            for source, pref in cleaned.items():
                c.execute(
                    "INSERT INTO project_feed_preferences "
                    "(user_id, project_id, source, preference, updated_at) "
                    "VALUES (?, ?, ?, ?, ?)",
                    (str(user_id), str(project_id), source, pref, stamp))
    except Exception as exc:
        logger.warning("projects.feed_prefs_store.set failed: %s", exc)
        return {}
    return cleaned


def forget_project(project_id: str) -> int:
    """Drop every user's preferences for a project. Called when the project is
    deleted so a view preference cannot outlive the thing it was a view of."""
    if not project_id:
        return 0
    init_feed_prefs_table()
    try:
        with _sqlite.connection(_db()) as c:
            cur = c.execute(
                "DELETE FROM project_feed_preferences WHERE project_id=?",
                (str(project_id),))
            return int(cur.rowcount or 0)
    except Exception as exc:  # pragma: no cover — defensive
        logger.debug("projects.feed_prefs_store.forget failed: %s", exc)
        return 0


def _reset_for_tests() -> None:
    try:
        with _sqlite.connection(_db()) as c:
            c.execute("DROP TABLE IF EXISTS project_feed_preferences")
    except Exception:
        pass


__all__ = [
    "PREF_HIGHLIGHT", "PREF_NORMAL", "PREF_HIDDEN", "PREFERENCES",
    "NON_CONNECTOR_SOURCES", "MAX_INPUT_ENTRIES", "MAX_ROWS_PER_PROJECT",
    "known_sources", "normalize_source",
    "normalize_preference", "init_feed_prefs_table", "get_preferences",
    "set_preferences", "forget_project",
]
