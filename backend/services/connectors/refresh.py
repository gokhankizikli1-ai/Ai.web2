# coding: utf-8
"""Project Workspace SMART REFRESH — the project-level connector refresh
coordinator.

THE PROBLEM THIS SOLVES
-----------------------
Opening a Project Workspace renders whatever the LAST explicit Sync ingested.
A user who deployed twenty minutes ago and opens their project sees a
days-old Vercel timeline and has to notice a Sync button to fix it. The data
Korvix needs already exists at the provider; nobody asked for it.

THE SHAPE OF THE FIX (stale-while-revalidate, and nothing more)
---------------------------------------------------------------
    1. the workspace read returns the persisted snapshot IMMEDIATELY, exactly
       as before — it still performs no provider call and no model call;
    2. this module says which of the project's BOUND connectors are stale;
    3. the route starts a bounded background refresh for at most
       `MAX_PER_OPEN` of them, through the connectors' own
       `sync.sync_binding` (the same code path the explicit Sync button uses);
    4. when those land, the page re-reads ONCE per started refresh and shows
       the new observations.

There is no polling loop, no scheduler, no worker, no queue, and no new
provider abstraction. Nothing here fetches from a provider itself.

WHY THIS AUTHORITY HAD TO EXIST
-------------------------------
The obvious answer — "just use `connector_project_bindings.last_sync_at`" — is
the right answer for STALENESS and is exactly what `plan()` reads. It
is NOT sufficient for SAFETY, because `last_sync_at` means "last FULLY
successful sync" by deliberate design across every connector: a provider that
is rate-limited, timing out, or holding a dead credential never advances it.
With only that field, a broken connector would be re-attempted on EVERY page
open, forever — a storm aimed at the one provider least able to take it.

Two facts are therefore needed that no existing authority records:

    started_at    a refresh is running RIGHT NOW (so two tabs, a double-mount,
                  or a rapid navigate-away-and-back collapse to ONE call)
    finished_at   an attempt ENDED, whether or not it succeeded (so a failing
                  connector backs off instead of being hammered)

`connectors.store` is the authority for what a project is bound to and when it
last succeeded; the in-process TTL cache is per-worker and cannot dedupe across
two gunicorn workers; Memory Plane preferences are semantic user memory, not
coordination state. So this adds ONE table — attempt bookkeeping and nothing
else — in the SAME `projects.db` every other project-scoped store already uses,
following `projects.views_store` exactly.

WHAT THIS IS NOT
----------------
  * NOT connector state. It records attempts, never results. Delete this table
    and every connector still works, every binding is intact, and every
    observation ever ingested is still there — the only loss is that a broken
    connector gets retried a bit more eagerly for one TTL window.
  * NOT a second sync path. It calls `connectors.sync.sync_binding`, which is
    what the explicit `POST /v2/connectors/{p}/sync` route calls too.
  * NOT execution. A refresh ingests observations through the one canonical
    store. It creates no candidate action, no task, no run, no approval, and
    spends no model token. Opening a project page still cannot start anything.
  * NOT a ranking or a projection. It never touches what the page SHOWS.

THE LEASE, AND WHY IT EXPIRES
-----------------------------
`started_at` is a LEASE, not a lock: a worker that dies mid-refresh would
otherwise wedge that (project, provider) forever. A claim older than
`LEASE_SECONDS` is treated as dead and may be re-claimed, so the worst case of
a crash is one extra refresh after the lease window, never a permanently stuck
connector.

ISOLATION
---------
Every row is keyed by (project_id, provider) and carries the owner it was
claimed for. Every entry point takes the AUTHENTICATED user id and re-resolves
ownership through `connectors.sync.sync_binding`, which fails closed. Nothing
here is reachable with a client-supplied identity, and a foreign project never
reaches this module at all — the workspace route 404s first.

COST: a bounded number of pure-SQLite statements per page open, and provider
calls ONLY for connectors that are genuinely stale, not already refreshing, and
not backing off. ZERO model tokens.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from backend.core.paths import resolve_db_path
from backend.services.connectors import registry
from backend.services.connectors import store as shared
from backend.services.connectors import sync as connector_sync

logger = logging.getLogger(__name__)

def _db() -> str:
    """Resolve the DB file on EVERY call, exactly as `connectors.store` does —
    the coordinator lives in the same file as the bindings it reads, and a
    module-level capture would go stale the moment `PROJECTS_DB_PATH` moves."""
    return resolve_db_path("projects.db", "PROJECTS_DB_PATH")


#: Back-compat alias for callers that referenced the module's file directly.
DB_PATH = resolve_db_path("projects.db", "PROJECTS_DB_PATH")

# ── Freshness policy ─────────────────────────────────────────────────────────
#
# How old a provider's last FULLY SUCCESSFUL sync may be before opening the
# project is allowed to refresh it. Deliberately per-provider, because the
# providers are not alike:
#
#   github / vercel   the code and the deploys. This is where "the page is
#                     showing something from days ago" is actually felt, and
#                     both are cheap, well-behaved, generously-rate-limited
#                     reads. Highest freshness priority, shortest TTL.
#   gmail / calendar  mail and meetings move on human timescales and the reads
#                     are heavier; a quarter of an hour is not a stale inbox.
#   slack             high-volume, low-signal per item (it is deliberately
#                     excluded from Needs Attention for exactly that reason),
#                     so it has the least to gain from an aggressive TTL.
#
# Every value is a bound on how OFTEN we may call, never a promise to call.
_TTL_SECONDS: Dict[str, int] = {
    registry.PROVIDER_GITHUB:   300,    # 5 minutes
    registry.PROVIDER_VERCEL:   300,    # 5 minutes
    registry.PROVIDER_GMAIL:    900,    # 15 minutes
    registry.PROVIDER_CALENDAR: 900,    # 15 minutes
    registry.PROVIDER_SLACK:    900,    # 15 minutes
}
_DEFAULT_TTL_SECONDS = 900

#: Refresh priority when more connectors are stale than one page open may
#: start. GitHub and Vercel lead deliberately — see the TTL table above.
_PRIORITY: tuple = (
    registry.PROVIDER_GITHUB, registry.PROVIDER_VERCEL,
    registry.PROVIDER_GMAIL, registry.PROVIDER_CALENDAR, registry.PROVIDER_SLACK,
)

#: How many provider refreshes ONE page open may start. A project with five
#: stale connectors refreshes two now and the rest on a later visit; the page
#: never fans out to every provider it has ever been bound to.
MAX_PER_OPEN = 2

#: How long an unfinished claim is honoured before it is treated as dead.
LEASE_SECONDS = 180

#: How long after an attempt ENDS (success or failure) that (project, provider)
#: is left alone. This is the back-off that makes a broken connector cheap.
ATTEMPT_COOLDOWN_SECONDS = 300

#: What the page is told to wait before re-reading, when a refresh was started.
RECHECK_IN_MS = 6000


def is_enabled() -> bool:
    """The kill switch. Default ON — the feature is inert anyway on a project
    with no bound connectors, and every provider is independently gated by its
    own `ENABLE_*_CONNECTOR` flag. Set `ENABLE_WORKSPACE_AUTO_REFRESH=false` to
    return the workspace read to its previous behaviour with no other change:
    the plan comes back empty, nothing is claimed, and no provider is called."""
    raw = os.getenv("ENABLE_WORKSPACE_AUTO_REFRESH", "true").strip().lower()
    return raw not in ("false", "0", "no", "off")


_SCHEMA = """
CREATE TABLE IF NOT EXISTS connector_refresh_attempts (
    project_id     TEXT NOT NULL,
    provider       TEXT NOT NULL,
    owner_user_id  TEXT NOT NULL,
    started_at     TEXT NOT NULL DEFAULT '',   -- lease: a refresh is running
    finished_at    TEXT NOT NULL DEFAULT '',   -- last attempt END (any outcome)
    last_outcome   TEXT NOT NULL DEFAULT '',   -- stable code from connectors.sync
    updated_at     TEXT NOT NULL,
    PRIMARY KEY (project_id, provider)
);
CREATE INDEX IF NOT EXISTS ix_refresh_owner
    ON connector_refresh_attempts(owner_user_id);
"""

#: Databases this process has already created the table in. Keyed by PATH, not
#: a bare boolean, so a test that repoints `DB_PATH` at a temp file still gets
#: its schema created instead of inheriting a "already done" flag from another
#: database.
_initialized: set = set()


def init_refresh_table() -> None:
    """Idempotent schema creation. Cheap after the first call per database, so
    every entry point may call it without adding a statement per page open."""
    path = _db()
    if path in _initialized:
        return
    try:
        from backend.services.orchestrator import _sqlite
        with _sqlite.connection(path) as c:
            c.executescript(_SCHEMA)
        _initialized.add(path)
    except Exception as exc:  # pragma: no cover — defensive
        logger.warning("connectors.refresh.init failed: %s", exc)


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _parse_iso(value: str):
    """The SHARED tolerant ISO parser (`project_brain.attention.parse_iso`) —
    connectors write both `...Z` and explicit offsets, and this repo already has
    exactly one function that copes with both. Imported lazily rather than at
    module scope so this foundational package never pulls the Project Brain
    aggregate (and everything IT imports) into an import graph that does not
    need it."""
    try:
        from backend.services.project_brain.attention import parse_iso
        return parse_iso(value)
    except Exception:  # pragma: no cover — defensive
        return None


def _age_seconds(stamp: str, now: datetime) -> Optional[float]:
    """Seconds since `stamp`, or None when it is missing/unparseable. A FUTURE
    timestamp (provider clock skew) reads as age 0, never as a negative age
    that would make something look infinitely fresh."""
    parsed = _parse_iso(str(stamp or "").strip())
    if parsed is None:
        return None
    delta = (now - parsed).total_seconds()
    return max(0.0, delta)


def ttl_seconds(provider: str) -> int:
    return _TTL_SECONDS.get(str(provider or "").strip().lower(),
                            _DEFAULT_TTL_SECONDS)


# ── attempt bookkeeping ──────────────────────────────────────────────────────

def _rows(project_id: str) -> Dict[str, Dict[str, str]]:
    """The attempt rows for one project, keyed by provider. ONE statement."""
    init_refresh_table()
    try:
        from backend.services.orchestrator import _sqlite
        with _sqlite.connection(_db()) as c:
            found = c.execute(
                "SELECT provider, started_at, finished_at, last_outcome "
                "FROM connector_refresh_attempts WHERE project_id=?",
                (str(project_id),),
            ).fetchall()
        return {str(r["provider"]): {
            "started_at":   str(r["started_at"] or ""),
            "finished_at":  str(r["finished_at"] or ""),
            "last_outcome": str(r["last_outcome"] or ""),
        } for r in found}
    except Exception as exc:
        logger.debug("connectors.refresh: attempt read failed: %s", exc)
        return {}


def claim(project_id: str, provider: str, owner_user_id: str, *,
          now: Optional[datetime] = None) -> str:
    """Take the refresh lease for one (project, provider).

    Returns a LEASE TOKEN (the instant the claim was written) when this caller
    now owns the refresh and must call `release` with that token; "" when
    somebody else is already refreshing it, or it is still cooling down after a
    recent attempt.

    The whole check-and-set runs inside `BEGIN IMMEDIATE`, so two tabs arriving
    in the same instant cannot both win: the second one reads the first one's
    `started_at` and backs off. This is the dedup guarantee the page relies on
    to make repeated opens free."""
    project_id = str(project_id or "").strip()
    provider = str(provider or "").strip().lower()
    if not (project_id and provider and owner_user_id):
        return ""
    init_refresh_table()
    when = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    stamp = _iso(when)
    try:
        from backend.services.orchestrator import _sqlite
        with _sqlite.writer_tx(_db()) as c:
            row = c.execute(
                "SELECT started_at, finished_at FROM connector_refresh_attempts "
                "WHERE project_id=? AND provider=?",
                (project_id, provider),
            ).fetchone()
            if row is not None:
                running = _age_seconds(str(row["started_at"] or ""), when)
                if running is not None and running < LEASE_SECONDS:
                    return ""               # already refreshing (live lease)
                cooling = _age_seconds(str(row["finished_at"] or ""), when)
                if cooling is not None and cooling < ATTEMPT_COOLDOWN_SECONDS:
                    return ""               # attempted very recently — back off
            c.execute(
                """INSERT INTO connector_refresh_attempts
                       (project_id, provider, owner_user_id, started_at,
                        finished_at, last_outcome, updated_at)
                   VALUES (?, ?, ?, ?, '', '', ?)
                   ON CONFLICT(project_id, provider) DO UPDATE SET
                       owner_user_id=excluded.owner_user_id,
                       started_at=excluded.started_at,
                       updated_at=excluded.updated_at""",
                (project_id, provider, str(owner_user_id), stamp, stamp),
            )
        return stamp
    except Exception as exc:
        # Fail CLOSED: if the coordinator cannot guarantee dedup, it must not
        # authorise a provider call. A missed refresh costs one stale page;
        # an unguarded one costs a storm.
        logger.warning("connectors.refresh: claim failed for %s/%s: %s",
                       project_id, provider, exc)
        return ""


def release(project_id: str, provider: str, outcome: str, *,
            token: str = "", now: Optional[datetime] = None) -> None:
    """End the attempt: clear the lease and stamp the cooldown. Called in a
    `finally`, so a raising refresh can never leave a lease behind for the whole
    lease window. Best-effort — an unwritten release simply expires as a dead
    lease, which is the exact case the lease exists for.

    `token` is the value `claim` returned, and the release is SCOPED to it. That
    matters for one specific race: a refresh that outlives its lease window (a
    provider crawling slowly) has already had its lease expire, and a later page
    open may legitimately have taken a NEW one. Without the token, the slow
    holder's release would wipe that new lease and let a third page open start
    yet another concurrent read of the same provider — a small sync storm, from
    the very mechanism meant to prevent one. With it, a stale holder's release
    matches no row and changes nothing; the live holder finishes normally.

    An empty token releases unconditionally (for callers that never held a real
    lease, and for tests)."""
    project_id = str(project_id or "").strip()
    provider = str(provider or "").strip().lower()
    if not (project_id and provider):
        return
    when = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    stamp = _iso(when)
    sql = ("UPDATE connector_refresh_attempts "
           "SET started_at='', finished_at=?, last_outcome=?, updated_at=? "
           "WHERE project_id=? AND provider=?")
    params = [stamp, str(outcome or "")[:40], stamp, project_id, provider]
    if token:
        sql += " AND started_at=?"
        params.append(str(token))
    try:
        from backend.services.orchestrator import _sqlite
        with _sqlite.connection(_db()) as c:
            c.execute(sql, tuple(params))
    except Exception as exc:  # pragma: no cover — defensive
        logger.debug("connectors.refresh: release failed: %s", exc)


def forget_project(project_id: str) -> int:
    """Drop a project's attempt bookkeeping. Used when a project is deleted so
    coordination metadata does not outlive the thing it coordinated."""
    if not project_id:
        return 0
    init_refresh_table()
    try:
        from backend.services.orchestrator import _sqlite
        with _sqlite.connection(_db()) as c:
            cur = c.execute(
                "DELETE FROM connector_refresh_attempts WHERE project_id=?",
                (str(project_id),))
            return int(cur.rowcount or 0)
    except Exception as exc:  # pragma: no cover — defensive
        logger.debug("connectors.refresh: forget failed: %s", exc)
        return 0


# ── the plan ─────────────────────────────────────────────────────────────────

def _last_sync_by_provider(user_id: str, project_id: str) -> Dict[str, str]:
    """The AUTHORITATIVE last-successful-sync stamp per provider for this
    (user, project), from the shared connector store, for LIVE bindings this
    user owns.

    When a provider has several resources (Slack channels), the OLDEST stamp
    wins: a provider is only as fresh as its least recently synced binding, so
    a channel selected after the last sync makes Slack stale — which is exactly
    the case where there is genuinely something new to fetch."""
    out: Dict[str, str] = {}
    try:
        bindings = shared.list_project_bindings(str(project_id))
    except Exception as exc:
        logger.debug("connectors.refresh: bindings unavailable: %s", exc)
        return out
    for b in bindings:
        if str(getattr(b, "owner_user_id", "")) != str(user_id):
            continue
        if str(b.status) != shared.BIND_CONNECTED:
            continue
        provider = str(b.provider)
        stamp = str(b.last_sync_at or "").strip()
        current = out.get(provider, "")
        if not current:
            out[provider] = stamp
            continue
        if not stamp:
            out[provider] = ""            # one never-synced resource ⇒ stale
            continue
        a, bb = _parse_iso(current), _parse_iso(stamp)
        # The OLDEST resource decides: a provider is only as fresh as its least
        # recently synced binding.
        if a is not None and bb is not None and bb < a:
            out[provider] = stamp
    return out


def plan(user_id: str, project_id: str, *,
         now: Optional[datetime] = None) -> Dict[str, Any]:
    """What opening this project SHOULD refresh. A pure read — it claims
    nothing, calls no provider, and writes nothing.

    Returns, with every list in the registry's stable order:

        stale        bound + connected + enabled, past its TTL
        in_flight    a refresh for it is already running (another tab, or the
                     previous open) — the page waits rather than duplicating it
        cooling      stale, but attempted too recently to try again
        eligible     what the caller may actually start now (bounded by
                     `MAX_PER_OPEN`, in freshness-priority order)

    An empty `eligible` is the normal, good case: everything is fresh."""
    empty = {"stale": [], "in_flight": [], "cooling": [], "eligible": [],
             "recheck_in_ms": 0}
    if not is_enabled():
        return empty
    user_id = str(user_id or "").strip()
    project_id = str(project_id or "").strip()
    if not (user_id and project_id):
        return empty

    when = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    last_sync = _last_sync_by_provider(user_id, project_id)
    if not last_sync:
        return empty                       # no live bindings ⇒ nothing to do

    attempts = _rows(project_id)

    stale: List[str] = []
    in_flight: List[str] = []
    cooling: List[str] = []
    for provider in registry.PROVIDER_ORDER:
        if provider not in last_sync:
            continue
        if not connector_sync.is_provider_enabled(provider):
            continue                       # switched off on this deployment
        age = _age_seconds(last_sync[provider], when)
        if age is not None and age < ttl_seconds(provider):
            continue                       # FRESH — zero provider calls
        stale.append(provider)
        row = attempts.get(provider) or {}
        running = _age_seconds(row.get("started_at", ""), when)
        if running is not None and running < LEASE_SECONDS:
            in_flight.append(provider)
            continue
        settled = _age_seconds(row.get("finished_at", ""), when)
        if settled is not None and settled < ATTEMPT_COOLDOWN_SECONDS:
            cooling.append(provider)

    startable = [p for p in stale if p not in in_flight and p not in cooling]
    startable.sort(key=lambda p: _PRIORITY.index(p) if p in _PRIORITY else 99)
    eligible = startable[:MAX_PER_OPEN]

    return {
        "stale":     stale,
        "in_flight": in_flight,
        "cooling":   cooling,
        "eligible":  eligible,
        "recheck_in_ms": RECHECK_IN_MS if (eligible or in_flight) else 0,
    }


# ── claiming + running ───────────────────────────────────────────────────────

def claim_eligible(user_id: str, project_id: str, providers: List[str], *,
                   now: Optional[datetime] = None) -> Dict[str, str]:
    """Take the lease for each provider that is still free, and return
    {provider: lease token} for the ones actually claimed.

    Called SYNCHRONOUSLY by the workspace route so the response can say
    truthfully which refreshes it started and which were already running — and
    so two simultaneous tabs are serialised HERE, before either could reach a
    provider."""
    claimed: Dict[str, str] = {}
    for provider in providers or []:
        token = claim(project_id, provider, user_id, now=now)
        if token:
            claimed[provider] = token
    return claimed


def run_claimed(user_id: str, project_id: str,
                claims: Dict[str, str]) -> List[Dict[str, Any]]:
    """Run the provider reads for leases this caller ALREADY holds, then release
    each one against the token it was claimed with.

    This is what the route hands to `BackgroundTasks`: it executes after the
    response has been sent, so the workspace read's latency is untouched. Each
    provider is independent — one failing, timing out, or being disconnected
    mid-flight cannot stop the others, and none of it can surface an error to a
    page that has already rendered.

    Never raises."""
    results: List[Dict[str, Any]] = []
    for provider, token in (claims or {}).items():
        outcome = connector_sync.OUTCOME_FAILED
        try:
            result = connector_sync.sync_binding(user_id, project_id, provider)
            outcome = result.outcome
            row = result.as_dict()
            row["provider"] = provider
            results.append(row)
        except Exception as exc:  # pragma: no cover — sync_binding never raises
            logger.warning("connectors.refresh: run failed for %s/%s: %s",
                           project_id, provider, exc)
            results.append({"project_id": project_id, "provider": provider,
                            "ok": False, "reason": connector_sync.OUTCOME_FAILED})
        finally:
            release(project_id, provider, outcome, token=token)
    return results


def _reset_for_tests() -> None:
    _initialized.clear()
    try:
        from backend.services.orchestrator import _sqlite
        with _sqlite.connection(_db()) as c:
            c.execute("DROP TABLE IF EXISTS connector_refresh_attempts")
    except Exception:
        pass


__all__ = [
    "is_enabled", "init_refresh_table", "plan", "claim", "claim_eligible",
    "release", "run_claimed", "forget_project", "ttl_seconds",
    "MAX_PER_OPEN", "LEASE_SECONDS", "ATTEMPT_COOLDOWN_SECONDS", "RECHECK_IN_MS",
]
