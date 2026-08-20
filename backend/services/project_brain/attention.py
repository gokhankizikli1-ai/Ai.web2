# coding: utf-8
"""Project Workspace — the deterministic NEEDS-ATTENTION presentation ranking.

WHAT THIS IS (AND IS NOT)
-------------------------
This is a PURE, zero-I/O projection: given observations that the connectors have
already ingested (through the single canonical `observations_store`) and the
project's own build products, it answers ONE question for the Project page:

    "of what Korvix already knows, which few things most deserve a look now?"

It is NOT a second Business Brain and NOT a second prioritizer:

  * `action_prioritizer` ranks CANDIDATE ACTIONS — proposals that must first be
    WRITTEN by `candidate_synthesis`. Opening a project page must never write,
    so the workspace cannot go through that path (observation ≠ execution stays
    intact: reading this page creates no task, run, candidate or decision).
  * `project_supervisor` assesses a RUN snapshot. A project with no active run —
    the common case for a connector-driven project — has no snapshot to assess.

So this module implements the small, documented, deterministic PRESENTATION
ranking the prompt explicitly allows, built only from fields the connector
normalizers already produce. No model call, no network, no writes, no clock
except the `now` that is passed in.

THE RULES, IN FULL
------------------
1. CLASSIFICATION. An observation becomes a signal only if its `kind` appears in
   the explicit table below. Anything else (Gmail, Slack, commits, issues,
   pushes, project settings changes) is ACTIVITY, never attention. Gmail and
   Slack are deliberately excluded entirely: their normalizers never emit a
   `high` importance because chat and mail are high-volume/low-signal per item,
   and promoting them here would let ordinary chatter outrank a broken
   production deploy.

   The connector-supplied `importance` hint is deliberately NOT the trigger. It
   is coarse and advisory, and "importance == high → needs attention" is exactly
   the naive rule that turns a routine merged PR into an alarm.

2. SUBJECTS AND SUPERSESSION. Every signal carries a SUBJECT — the real-world
   thing it is about (this repo's CI, this Vercel target, this PR, this calendar
   event). Only the LATEST signal per subject counts. A failed deploy followed
   by a successful one is resolved; a PR that was opened and later merged is
   resolved. Without this, the page would keep shouting about a fire that was
   put out days ago, which is precisely "fake attention".

3. OPEN vs RESOLVED. Only OPEN signals are surfaced. A `pending`/`in_progress`
   deployment status is neither: it is ignored outright, so it can neither raise
   an alarm nor silently resolve a real failure that preceded it.

4. TRUTHFUL RECOMPUTATION FOR CALENDAR. A calendar observation is written once
   and then deduplicated for the life of the event, so an "upcoming" row stays
   in the store long after the meeting happened. Imminence is therefore
   RECOMPUTED here from the event's own `start` payload field against `now`,
   never trusted from the stored `importance`.

5. AGE. A signal older than `MAX_AGE_DAYS` is dropped. An unresolved failure
   from a month ago is history, not something to look at now. Signals with an
   unparseable timestamp are KEPT (never silently hidden) and sort last.

6. ORDER. severity DESC, then `observed_at` DESC, then subject ASC. Fully
   deterministic — the same inputs always produce the same list.

7. BOUND. At most `MAX_ATTENTION` items. The section is meant to be scannable.

COST: pure functions. ZERO model tokens, ZERO network, ZERO writes.
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple

# ── Severity vocabulary (ordinal, coarse on purpose) ─────────────────────────
SEV_BLOCKING = "blocking"              # something the user owns is broken now
SEV_TIME_SENSITIVE = "time_sensitive"  # a commitment that will lapse
SEV_WAITING = "waiting"                # something is waiting on the user

_SEVERITY_RANK: Dict[str, int] = {
    SEV_BLOCKING: 3,
    SEV_TIME_SENSITIVE: 2,
    SEV_WAITING: 1,
}

# ── Reason codes. STABLE identifiers, never user-facing prose: the frontend
#    renders each one through the shipped locale dictionaries, so "why it
#    matters" is translated rather than hardcoded English from the backend.
REASON_CI_FAILED = "ci_failed"
REASON_DEPLOY_FAILED = "deploy_failed"
REASON_PREVIEW_DEPLOY_FAILED = "preview_deploy_failed"
REASON_PR_AWAITING = "pr_awaiting"
REASON_MEETING_SOON = "meeting_soon"
REASON_MEETING_CANCELLED = "meeting_cancelled"
REASON_BUILD_FAILED = "build_failed"

#: Bound on the rendered section.
MAX_ATTENTION = 5
#: A signal older than this is history, not attention.
MAX_AGE_DAYS = 14
#: "Imminent" for a calendar event, recomputed from its own start time.
UPCOMING_WINDOW = timedelta(hours=24)

#: Build/product statuses that mean the artifact did not come out.
_FAILED_PRODUCT_STATUSES = frozenset({"failed", "error", "errored"})

#: Vercel's own production marker (mirrors `vercel.normalize.TARGET_PRODUCTION`).
_VERCEL_PRODUCTION = "production"

#: GitHub deployment_status states that mean the deploy did not land.
_GH_DEPLOY_FAILURE_STATES = frozenset({"failure", "error"})


# ── time helpers ─────────────────────────────────────────────────────────────

def parse_iso(value: Any) -> Optional[datetime]:
    """Tolerant ISO-8601 → aware UTC datetime, or None.

    Connectors write several truthful shapes: `...Z`, an explicit offset, a
    naive instant, and (for all-day calendar events) a bare `YYYY-MM-DD`. All of
    them are accepted; anything else resolves to None and the caller keeps the
    signal rather than dropping it on a parse failure."""
    raw = str(value or "").strip()
    if not raw:
        return None
    text = raw[:-1] + "+00:00" if raw.endswith("Z") else raw
    dt: Optional[datetime] = None
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        try:
            dt = datetime.fromisoformat(raw[:10])   # bare date (all-day event)
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _stable_id(subject: str) -> str:
    """A short, stable, opaque id for a subject.

    Subjects embed provider identifiers (a calendar event id, a Vercel project
    id). Those are never handed to the client — the digest is, so the frontend
    gets a durable React key and nothing else."""
    return hashlib.sha1(subject.encode("utf-8", "replace")).hexdigest()[:12]


# ── one classified signal ────────────────────────────────────────────────────

#: The digest, exported. Every payload that carries a SUBJECT-derived identity
#: must ship this rather than the subject itself — subjects embed provider
#: resource ids (a Vercel project id, a Google calendar event id) and those are
#: not something a client asked to see. One implementation means the workspace's
#: change list and this ranking cannot disagree about an identity either.
stable_id = _stable_id


def _signal(
    *, subject: str, is_open: bool, severity: str, reason: str,
    source: str, kind: str, title: str, context: str, observed_at: str,
    ref: str = "", observation_id: str = "",
) -> Dict[str, Any]:
    return {
        "subject":     subject,
        "open":        bool(is_open),
        "severity":    severity,
        "reason":      reason,
        "source":      source,
        "kind":        kind,
        "title":       title,
        "context":     context,
        "observed_at": observed_at,
        "ref":         ref,
        # WHICH stored row raised this. Carried so a consumer can trace an
        # alarm back to its provenance — and so the workspace can say which
        # correlated story an alarm belongs to — without re-deriving the
        # classification. Empty for a product signal (it has no observation).
        "observation_id": observation_id,
    }


def _payload(obs: Dict[str, Any]) -> Dict[str, Any]:
    p = obs.get("payload")
    return p if isinstance(p, dict) else {}


def _str(value: Any, limit: int = 200) -> str:
    out = "" if value is None else str(value)
    return out[:limit]


def _classify_github(kind: str, obs: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    payload = _payload(obs)
    repo = _str(payload.get("repo"), 160)
    summary = _str(obs.get("summary"), 240)
    observed_at = _str(obs.get("observed_at"), 64)
    verb = kind.rsplit(".", 1)[-1]

    if kind in ("github.check.failed", "github.check.succeeded"):
        # One subject per CI target: a check run id, else a workflow run id, else
        # the check's name (the stable identity GitHub gives us in that order).
        key = _str(payload.get("check_id") or payload.get("run_id")
                   or payload.get("name"), 160)
        return _signal(
            subject=f"github:check:{repo}:{key}",
            is_open=(verb == "failed"),
            severity=SEV_BLOCKING, reason=REASON_CI_FAILED,
            source="github", kind=kind, title=summary,
            context=repo, observed_at=observed_at,
            observation_id=_str(obs.get("id"), 64),
        )

    if kind.startswith("github.deployment_status."):
        state = verb
        if state in _GH_DEPLOY_FAILURE_STATES:
            is_open = True
        elif state == "success":
            is_open = False
        else:
            return None   # pending / in_progress / queued — not a signal at all
        env = _str(payload.get("environment"), 80)
        return _signal(
            subject=f"github:deploy:{repo}:{env}",
            is_open=is_open,
            severity=SEV_BLOCKING, reason=REASON_DEPLOY_FAILED,
            source="github", kind=kind, title=summary,
            context=(f"{repo} · {env}" if repo and env else (repo or env)),
            observed_at=observed_at, observation_id=_str(obs.get("id"), 64),
        )

    if kind.startswith("github.pull_request."):
        if verb in ("opened", "reopened"):
            is_open = True
        elif verb in ("merged", "closed"):
            is_open = False
        else:
            return None
        number = _str(payload.get("number"), 32)
        return _signal(
            subject=f"github:pr:{repo}:{number}",
            is_open=is_open,
            severity=SEV_WAITING, reason=REASON_PR_AWAITING,
            source="github", kind=kind, title=summary,
            context=repo, observed_at=observed_at,
            observation_id=_str(obs.get("id"), 64),
        )

    return None


def _classify_vercel(kind: str, obs: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not kind.startswith("vercel.deployment."):
        return None
    payload = _payload(obs)
    verb = kind.rsplit(".", 1)[-1]
    target = _str(payload.get("target"), 40).lower()
    project_key = _str(payload.get("vercel_project_id"), 120)
    subject = f"vercel:deploy:{project_key}:{target}"
    if verb == "error":
        production = target == _VERCEL_PRODUCTION
        return _signal(
            subject=subject, is_open=True,
            severity=SEV_BLOCKING if production else SEV_WAITING,
            reason=REASON_DEPLOY_FAILED if production else REASON_PREVIEW_DEPLOY_FAILED,
            source="vercel", kind=kind, title=_str(obs.get("summary"), 240),
            context=_str(payload.get("project_name"), 160),
            observed_at=_str(obs.get("observed_at"), 64),
            observation_id=_str(obs.get("id"), 64),
        )
    if verb in ("ready", "canceled"):
        # A later green (or abandoned) deployment on the same target supersedes
        # an earlier failure. Cancelled carries no outcome to act on.
        return _signal(
            subject=subject, is_open=False,
            severity=SEV_BLOCKING, reason=REASON_DEPLOY_FAILED,
            source="vercel", kind=kind, title="", context="",
            observed_at=_str(obs.get("observed_at"), 64),
            observation_id=_str(obs.get("id"), 64),
        )
    return None


def _classify_calendar(kind: str, obs: Dict[str, Any],
                       now: datetime) -> Optional[Dict[str, Any]]:
    if not kind.startswith("calendar.event."):
        return None
    payload = _payload(obs)
    event_id = _str(payload.get("event_id"), 160)
    subject = f"calendar:event:{event_id}"
    verb = kind.rsplit(".", 1)[-1]
    start = parse_iso(payload.get("start"))
    observed_at = _str(obs.get("observed_at"), 64)
    summary = _str(obs.get("summary"), 240)

    if verb == "cancelled":
        # Only a commitment that has NOT yet happened is worth surfacing. An
        # unknown start is treated as resolved rather than manufacturing urgency.
        return _signal(
            subject=subject, is_open=bool(start is not None and start >= now),
            severity=SEV_TIME_SENSITIVE, reason=REASON_MEETING_CANCELLED,
            source="calendar", kind=kind, title=summary, context="",
            observed_at=observed_at, observation_id=_str(obs.get("id"), 64),
        )
    if verb == "upcoming":
        imminent = bool(start is not None and now <= start <= now + UPCOMING_WINDOW)
        return _signal(
            subject=subject, is_open=imminent,
            severity=SEV_TIME_SENSITIVE, reason=REASON_MEETING_SOON,
            source="calendar", kind=kind, title=summary, context="",
            observed_at=observed_at, observation_id=_str(obs.get("id"), 64),
        )
    if verb == "updated":
        return _signal(
            subject=subject, is_open=False,
            severity=SEV_TIME_SENSITIVE, reason=REASON_MEETING_SOON,
            source="calendar", kind=kind, title="", context="",
            observed_at=observed_at, observation_id=_str(obs.get("id"), 64),
        )
    return None


def classify_observation(obs: Dict[str, Any], *,
                         now: Optional[datetime] = None) -> Optional[Dict[str, Any]]:
    """One observation → one classified signal, or None when the observation is
    not an attention concept at all (the common case)."""
    if not isinstance(obs, dict):
        return None
    kind = _str(obs.get("kind"), 120)
    source = _str(obs.get("source"), 60)
    if not kind:
        return None
    when = now or _utcnow()
    if source == "github":
        return _classify_github(kind, obs)
    if source == "vercel":
        return _classify_vercel(kind, obs)
    if source == "calendar":
        return _classify_calendar(kind, obs, when)
    # gmail / slack / any future or non-connector source: activity, not attention.
    return None


def _product_signal(product: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """A generated product whose build did not come out is a blocker the user
    owns. Reads only the canonical product projection's own fields."""
    if not isinstance(product, dict):
        return None
    status = _str(product.get("status"), 60).strip().lower()
    if status not in _FAILED_PRODUCT_STATUSES:
        return None
    ref = _str(product.get("deliverable_id") or product.get("id"), 200)
    if not ref:
        return None
    build_type = "app" if _str(product.get("build_type"), 16).lower() == "app" else "web"
    return _signal(
        subject=f"product:{ref}",
        is_open=True,
        severity=SEV_BLOCKING, reason=REASON_BUILD_FAILED,
        source="build", kind=f"product.{build_type}_build",
        title=_str(product.get("title"), 200).strip(),
        context="", observed_at=_str(product.get("updated_at"), 64),
        ref=ref,
    )


def _latest_per_subject(signals: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Keep exactly one signal per subject: the one with the newest
    `observed_at`. Ties resolve to the EARLIER position in the input, which is
    the more recently ingested row given the observation store's
    `observed_at DESC, ingested_at DESC` ordering. Signals with an unparseable
    timestamp lose to any parseable one for the same subject, and fall back to
    input order among themselves."""
    best: Dict[str, Tuple[int, Dict[str, Any]]] = {}
    for index, sig in enumerate(signals):
        subject = str(sig.get("subject") or "")
        if not subject:
            continue
        current = best.get(subject)
        if current is None:
            best[subject] = (index, sig)
            continue
        keep_index, keep = current
        a = parse_iso(sig.get("observed_at"))
        b = parse_iso(keep.get("observed_at"))
        if a is not None and b is None:
            best[subject] = (index, sig)
        elif a is not None and b is not None and a > b:
            best[subject] = (index, sig)
        elif a is not None and b is not None and a == b and index < keep_index:
            best[subject] = (index, sig)
    # Deterministic output order (the ranking below re-sorts anyway).
    return [pair[1] for _, pair in sorted(best.items(), key=lambda kv: kv[0])]


def _sort_key(item: Dict[str, Any]) -> Tuple[int, float, str]:
    rank = _SEVERITY_RANK.get(str(item.get("severity")), 0)
    when = parse_iso(item.get("observed_at"))
    # Unparseable timestamps sort last within their severity band, never first.
    stamp = when.timestamp() if when is not None else float("-inf")
    return (-rank, -stamp, str(item.get("subject") or ""))


def rank_attention(
    observations: Sequence[Dict[str, Any]],
    *,
    products: Sequence[Dict[str, Any]] = (),
    now: Optional[datetime] = None,
    limit: int = MAX_ATTENTION,
    max_age_days: int = MAX_AGE_DAYS,
) -> List[Dict[str, Any]]:
    """The bounded, deterministic Needs-Attention list. See the module docstring
    for the exact rules. Pure — never reads a store, never writes one."""
    when = now or _utcnow()
    cutoff = when - timedelta(days=max(1, int(max_age_days or MAX_AGE_DAYS)))

    signals: List[Dict[str, Any]] = []
    for obs in observations or []:
        sig = classify_observation(obs, now=when)
        if sig is not None:
            signals.append(sig)
    for product in products or []:
        sig = _product_signal(product)
        if sig is not None:
            signals.append(sig)

    out: List[Dict[str, Any]] = []
    for sig in _latest_per_subject(signals):
        if not sig.get("open"):
            continue
        stamp = parse_iso(sig.get("observed_at"))
        if stamp is not None and stamp < cutoff:
            continue     # history, not attention
        out.append(sig)

    out.sort(key=_sort_key)
    bound = max(1, int(limit or MAX_ATTENTION))
    return [
        {
            "id":          _stable_id(str(sig["subject"])),
            "severity":    sig["severity"],
            "reason":      sig["reason"],
            "source":      sig["source"],
            "kind":        sig["kind"],
            "title":       sig["title"],
            "context":     sig["context"],
            "observed_at": sig["observed_at"],
            "ref":         sig["ref"],
            "observation_id": sig.get("observation_id", ""),
        }
        for sig in out[:bound]
    ]


__all__ = [
    "SEV_BLOCKING", "SEV_TIME_SENSITIVE", "SEV_WAITING",
    "REASON_CI_FAILED", "REASON_DEPLOY_FAILED", "REASON_PREVIEW_DEPLOY_FAILED",
    "REASON_PR_AWAITING", "REASON_MEETING_SOON", "REASON_MEETING_CANCELLED",
    "REASON_BUILD_FAILED",
    "MAX_ATTENTION", "MAX_AGE_DAYS", "UPCOMING_WINDOW",
    "classify_observation", "rank_attention", "parse_iso", "stable_id",
]
