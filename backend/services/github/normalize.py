# coding: utf-8
"""GitHub event normalization — PURE, webhook-ready, zero I/O.

ONE NORMALIZATION CONTRACT
--------------------------
Both the bounded initial sync (which reads REST list resources) and the webhook
endpoint (which receives event payloads) funnel through the SAME core builders
here. A builder takes a GitHub resource object + the repository object (+ an
optional webhook `action`) and returns a `NormalizedObservation` dict shaped to
`observations_store.record_observation`'s existing contract — no new storage
schema per event type.

The returned dict is connector-neutral evidence ONLY. It NEVER says "create a
task", "fix this", or "deploy". Whether it matters is the deterministic
Business Brain's decision, downstream.

DETERMINISTIC provider_event_id (`external_id`) — STATE-TRANSITION AWARE
-----------------------------------------------------------------------
`external_id` is the idempotency key (unique per (user, project, source,
external_id) in the store). It is derived from the STABLE numeric repo id +
resource id + the *meaningful state*, NOT from the webhook delivery id or the
ingestion time. Consequences:

  * same event/state ingested twice (webhook retry, or sync overlapping a
    webhook) → identical external_id → deduplicated, no double observation.
  * a real state transition → a NEW external_id → a new observation:
        PR opened → merged           two observations
        issue opened → closed        two observations
        check failed → passed        two observations
        deployment pending → success two observations
  * an immutable object (a commit) is keyed by its sha, so sync and a push
    webhook that both see it converge on one observation.

BOUNDED PAYLOAD
---------------
Payloads carry only small structured fields (numbers, titles, states, urls,
actor login). No file contents, no diffs, no README blobs — the Business Brain
gets evidence, not a repository dump.

COST: pure functions. ZERO model tokens, ZERO embeddings, ZERO network.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from backend.services.orchestrator.observations_store import (
    IMPORTANCE_HIGH, IMPORTANCE_LOW, IMPORTANCE_NORMAL,
)

SOURCE = "github"

# A single push webhook may carry many commits; GitHub itself truncates the
# `commits` array, but cap defensively so one push can never fan out unbounded.
_MAX_COMMITS_PER_PUSH = 20
_SUMMARY_MAX = 240
_TITLE_MAX = 200


# ── small helpers ────────────────────────────────────────────────────────────

def _s(v: Any, limit: int = 0) -> str:
    out = "" if v is None else str(v)
    return out[:limit] if limit else out


def _first_line(v: Any, limit: int = _TITLE_MAX) -> str:
    return _s(v).split("\n", 1)[0][:limit]


def _repo_ident(repo: Dict[str, Any]) -> "tuple[str, str]":
    """(repo_key, full_name). repo_key is the STABLE numeric id when present
    (survives a repo rename), else the full name."""
    full = _s((repo or {}).get("full_name"))
    rid = (repo or {}).get("id")
    key = str(rid) if rid not in (None, "") else (full or "unknown")
    return key, full


def _actor(obj: Dict[str, Any], *keys: str) -> str:
    for k in keys:
        u = (obj or {}).get(k)
        if isinstance(u, dict) and u.get("login"):
            return _s(u.get("login"), 80)
    return ""


def _obs(kind: str, external_id: str, summary: str, *,
         observed_at: str, importance: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "source": SOURCE,
        "kind": kind,
        "external_id": external_id,
        "summary": _s(summary, _SUMMARY_MAX),
        "observed_at": _s(observed_at) or "",
        "importance": importance,
        "payload": payload,
    }


# ── pull requests ────────────────────────────────────────────────────────────

def normalize_pull_request(pr: Dict[str, Any], repo: Dict[str, Any], *,
                           action: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """PR resource (REST) or webhook `pull_request` payload's `pull_request`."""
    if not isinstance(pr, dict) or pr.get("number") in (None, ""):
        return None
    number = pr.get("number")
    merged = bool(pr.get("merged") or pr.get("merged_at"))
    state = _s(pr.get("state")).lower()

    # meaningful transition
    if action == "closed" and merged:
        transition = "merged"
    elif action in ("opened", "reopened", "closed"):
        transition = action
    elif merged:
        transition = "merged"
    elif state == "closed":
        transition = "closed"
    else:
        transition = "opened"

    observed_at = (
        pr.get("merged_at") if transition == "merged" else
        pr.get("closed_at") if transition == "closed" else
        pr.get("updated_at") or pr.get("created_at")
    ) or pr.get("updated_at") or pr.get("created_at")

    repo_key, full = _repo_ident(repo)
    base = pr.get("base") if isinstance(pr.get("base"), dict) else {}
    head = pr.get("head") if isinstance(pr.get("head"), dict) else {}
    payload = {
        "repo": full,
        "number": number,
        "title": _first_line(pr.get("title")),
        "state": state,
        "merged": merged,
        "author": _actor(pr, "user"),
        "base_ref": _s(base.get("ref"), 120),
        "head_ref": _s(head.get("ref"), 120),
        "url": _s(pr.get("html_url"), 400),
    }
    return _obs(
        f"github.pull_request.{transition}",
        f"github:pr:{repo_key}:{number}:{transition}",
        f"PR #{number} {transition}: {payload['title']}",
        observed_at=observed_at, importance=IMPORTANCE_NORMAL, payload=payload,
    )


# ── issues ───────────────────────────────────────────────────────────────────

def normalize_issue(issue: Dict[str, Any], repo: Dict[str, Any], *,
                    action: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Issue resource / webhook `issues` payload's `issue`. The REST issues
    endpoint also returns PRs; those carry a `pull_request` key and are
    filtered out (a PR is normalized via `normalize_pull_request`)."""
    if not isinstance(issue, dict) or issue.get("number") in (None, ""):
        return None
    if issue.get("pull_request"):
        return None  # this is a PR surfaced by the issues endpoint — skip
    number = issue.get("number")
    state = _s(issue.get("state")).lower()
    if action in ("opened", "reopened", "closed"):
        transition = action
    elif state == "closed":
        transition = "closed"
    else:
        transition = "opened"

    observed_at = (
        issue.get("closed_at") if transition == "closed" else
        issue.get("updated_at") or issue.get("created_at")
    ) or issue.get("updated_at") or issue.get("created_at")

    repo_key, full = _repo_ident(repo)
    importance = IMPORTANCE_LOW if transition == "closed" else IMPORTANCE_NORMAL
    payload = {
        "repo": full,
        "number": number,
        "title": _first_line(issue.get("title")),
        "state": state,
        "author": _actor(issue, "user"),
        "url": _s(issue.get("html_url"), 400),
    }
    return _obs(
        f"github.issue.{transition}",
        f"github:issue:{repo_key}:{number}:{transition}",
        f"Issue #{number} {transition}: {payload['title']}",
        observed_at=observed_at, importance=importance, payload=payload,
    )


# ── CI: workflow runs & check runs ──────────────────────────────────────────

_FAILURE_CONCLUSIONS = {"failure", "timed_out", "startup_failure", "action_required"}


def normalize_workflow_run(run: Dict[str, Any], repo: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """GitHub Actions run (REST `actions/runs` item or webhook `workflow_run`).
    Only COMPLETED runs are observed — an in-progress run is not yet a signal.
    Failure ⇒ high importance; success ⇒ low (a recovery/routine green)."""
    if not isinstance(run, dict) or run.get("id") in (None, ""):
        return None
    status = _s(run.get("status")).lower()
    if status and status != "completed":
        return None
    conclusion = _s(run.get("conclusion")).lower()
    if not conclusion:
        return None
    failed = conclusion in _FAILURE_CONCLUSIONS
    repo_key, full = _repo_ident(repo)
    run_id = run.get("id")
    observed_at = run.get("updated_at") or run.get("run_started_at") or run.get("created_at")
    payload = {
        "repo": full,
        "run_id": run_id,
        "name": _s(run.get("name"), 160),
        "status": status or "completed",
        "conclusion": conclusion,
        "branch": _s(run.get("head_branch"), 120),
        "event": _s(run.get("event"), 40),
        "url": _s(run.get("html_url"), 400),
    }
    verb = "failed" if failed else "succeeded"
    return _obs(
        f"github.check.{'failed' if failed else 'succeeded'}",
        f"github:workflow_run:{repo_key}:{run_id}:{conclusion}",
        f"CI '{payload['name'] or 'workflow'}' {verb} on {payload['branch'] or 'branch'}",
        observed_at=observed_at,
        importance=IMPORTANCE_HIGH if failed else IMPORTANCE_LOW,
        payload=payload,
    )


def normalize_check_run(check: Dict[str, Any], repo: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Webhook `check_run` payload's `check_run`. Same failure/recovery
    semantics as a workflow run, keyed by the check id + conclusion."""
    if not isinstance(check, dict) or check.get("id") in (None, ""):
        return None
    status = _s(check.get("status")).lower()
    if status and status != "completed":
        return None
    conclusion = _s(check.get("conclusion")).lower()
    if not conclusion:
        return None
    failed = conclusion in _FAILURE_CONCLUSIONS
    repo_key, full = _repo_ident(repo)
    cid = check.get("id")
    observed_at = check.get("completed_at") or check.get("started_at")
    payload = {
        "repo": full,
        "check_id": cid,
        "name": _s(check.get("name"), 160),
        "status": status or "completed",
        "conclusion": conclusion,
        "url": _s(check.get("html_url"), 400),
    }
    verb = "failed" if failed else "succeeded"
    return _obs(
        f"github.check.{'failed' if failed else 'succeeded'}",
        f"github:check_run:{repo_key}:{cid}:{conclusion}",
        f"Check '{payload['name'] or 'check'}' {verb}",
        observed_at=observed_at,
        importance=IMPORTANCE_HIGH if failed else IMPORTANCE_LOW,
        payload=payload,
    )


# ── deployments ──────────────────────────────────────────────────────────────

_DEPLOY_FAILURE_STATES = {"failure", "error"}


def normalize_deployment(deployment: Dict[str, Any], repo: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """A deployment being created (REST `deployments` item / webhook
    `deployment`). The pending→success/failure transitions arrive as
    deployment_status observations."""
    if not isinstance(deployment, dict) or deployment.get("id") in (None, ""):
        return None
    repo_key, full = _repo_ident(repo)
    did = deployment.get("id")
    payload = {
        "repo": full,
        "deployment_id": did,
        "environment": _s(deployment.get("environment"), 80),
        "ref": _s(deployment.get("ref"), 200),
        "creator": _actor(deployment, "creator"),
        "url": _s(deployment.get("url"), 400),
    }
    return _obs(
        "github.deployment.created",
        f"github:deployment:{repo_key}:{did}:created",
        f"Deployment created for {payload['environment'] or 'env'} @ {payload['ref'] or 'ref'}",
        observed_at=deployment.get("created_at") or deployment.get("updated_at") or "",
        importance=IMPORTANCE_NORMAL, payload=payload,
    )


def normalize_deployment_status(status_obj: Dict[str, Any], deployment: Dict[str, Any],
                                repo: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Webhook `deployment_status` — the pending/success/failure/error
    transition. Failure/error ⇒ high; success ⇒ normal (a shipped release)."""
    if not isinstance(status_obj, dict):
        return None
    state = _s(status_obj.get("state")).lower()
    if not state:
        return None
    repo_key, full = _repo_ident(repo)
    did = (deployment or {}).get("id") if isinstance(deployment, dict) else None
    if did in (None, ""):
        return None
    failed = state in _DEPLOY_FAILURE_STATES
    payload = {
        "repo": full,
        "deployment_id": did,
        "state": state,
        "environment": _s(status_obj.get("environment") or (deployment or {}).get("environment"), 80),
        "description": _first_line(status_obj.get("description"), 200),
        "url": _s(status_obj.get("target_url") or status_obj.get("environment_url"), 400),
    }
    return _obs(
        f"github.deployment_status.{state}",
        f"github:deployment_status:{repo_key}:{did}:{state}",
        f"Deployment {state} for {payload['environment'] or 'env'}",
        observed_at=status_obj.get("created_at") or status_obj.get("updated_at") or "",
        importance=IMPORTANCE_HIGH if failed else (
            IMPORTANCE_NORMAL if state == "success" else IMPORTANCE_LOW),
        payload=payload,
    )


# ── commits ──────────────────────────────────────────────────────────────────

def normalize_commit(commit: Dict[str, Any], repo: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """A single commit — from a REST `commits` item (has `sha` + nested
    `commit`) OR a webhook push `commits[]` entry (has `id` + flat fields).
    Keyed by the immutable sha, so sync and a push webhook converge on one
    observation. Low importance (routine activity)."""
    if not isinstance(commit, dict):
        return None
    sha = _s(commit.get("sha") or commit.get("id"))
    if not sha:
        return None
    repo_key, full = _repo_ident(repo)
    inner = commit.get("commit") if isinstance(commit.get("commit"), dict) else {}
    inner_author = inner.get("author") if isinstance(inner.get("author"), dict) else {}
    message = commit.get("message") or inner.get("message") or ""
    # Author login (REST: nested `author.login`) → git author name (REST nested
    # `commit.author.name`) → push payload flat `author.name`.
    author = _actor(commit, "author") or _s(inner_author.get("name"), 80)
    if not author and isinstance(commit.get("author"), dict):
        author = _s(commit["author"].get("name"), 80)
    observed_at = inner_author.get("date") or commit.get("timestamp") or ""
    payload = {
        "repo": full,
        "sha": sha[:40],
        "message": _first_line(message),
        "author": author,
        "url": _s(commit.get("html_url") or commit.get("url"), 400),
    }
    return _obs(
        "github.commit.pushed",
        f"github:commit:{repo_key}:{sha[:40]}",
        f"Commit {sha[:8]}: {payload['message']}",
        observed_at=observed_at, importance=IMPORTANCE_LOW, payload=payload,
    )


# ── webhook dispatcher ───────────────────────────────────────────────────────

# Events we deliberately understand. Anything else is safe-ignored (returns []).
SUPPORTED_WEBHOOK_EVENTS = frozenset({
    "pull_request", "issues", "check_run", "check_suite", "workflow_run",
    "deployment", "deployment_status", "push", "ping",
})


def normalize_webhook_event(event_name: str, payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Map a (X-GitHub-Event, payload) pair to 0..N normalized observations.

    Unsupported / non-actionable events return [] (safe-ignore, never an
    error). `repository` is read from the payload — the caller has already
    authenticated the delivery and resolved which project it belongs to."""
    if not isinstance(payload, dict):
        return []
    event = _s(event_name).lower()
    repo = payload.get("repository") if isinstance(payload.get("repository"), dict) else {}
    action = _s(payload.get("action")).lower() or None

    if event == "ping":
        return []
    if event == "pull_request":
        o = normalize_pull_request(payload.get("pull_request") or {}, repo, action=action)
        return [o] if o else []
    if event == "issues":
        o = normalize_issue(payload.get("issue") or {}, repo, action=action)
        return [o] if o else []
    if event == "workflow_run":
        o = normalize_workflow_run(payload.get("workflow_run") or {}, repo)
        return [o] if o else []
    if event == "check_run":
        o = normalize_check_run(payload.get("check_run") or {}, repo)
        return [o] if o else []
    if event == "check_suite":
        o = normalize_workflow_run(payload.get("check_suite") or {}, repo)
        return [o] if o else []
    if event == "deployment":
        o = normalize_deployment(payload.get("deployment") or {}, repo)
        return [o] if o else []
    if event == "deployment_status":
        o = normalize_deployment_status(
            payload.get("deployment_status") or {}, payload.get("deployment") or {}, repo)
        return [o] if o else []
    if event == "push":
        commits = payload.get("commits") if isinstance(payload.get("commits"), list) else []
        out: List[Dict[str, Any]] = []
        for c in commits[:_MAX_COMMITS_PER_PUSH]:
            o = normalize_commit(c, repo)
            if o:
                out.append(o)
        return out
    return []


__all__ = [
    "SOURCE", "SUPPORTED_WEBHOOK_EVENTS",
    "normalize_pull_request", "normalize_issue", "normalize_workflow_run",
    "normalize_check_run", "normalize_deployment", "normalize_deployment_status",
    "normalize_commit", "normalize_webhook_event",
]
