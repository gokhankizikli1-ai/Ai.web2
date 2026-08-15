# coding: utf-8
"""Vercel resource normalization — PURE, zero I/O.

Turns a Vercel project / deployment resource into a `NormalizedObservation` dict
shaped to `observations_store.record_observation`'s existing contract — no new
storage schema. Mirrors `github.normalize` / `gmail.normalize`.

The returned dict is connector-neutral EVIDENCE only. It never says "redeploy",
"roll back", or "create a task". Whether it matters is the deterministic
Business Brain's decision, downstream.

DETERMINISTIC external_id (idempotency key) — STATE-TRANSITION AWARE
--------------------------------------------------------------------
`external_id` is derived from the STABLE Vercel project id + deployment id + the
*terminal state*, never from the sync time. Consequences:

  * the same deployment ingested twice (a re-sync, or overlapping syncs) →
    identical external_id → deduplicated, no double observation.
  * a real state transition (a deployment observed READY after an earlier ERROR
    of the same id, e.g. after a redeploy of the same build) → a NEW external_id
    → a new observation.

ONLY TERMINAL DEPLOYMENTS ARE OBSERVED
--------------------------------------
BUILDING / QUEUED / INITIALIZING deployments are skipped: an in-flight build is
not yet a signal, and observing it would produce a stream of rows that the next
sync would have to contradict. This mirrors `github.normalize_workflow_run`,
which only observes COMPLETED runs.

BOUNDED PAYLOAD — AND WHAT IS DELIBERATELY DROPPED
--------------------------------------------------
Payloads carry only small structured fields (ids, state, target, timestamps,
deployment URL, and the git commit metadata Vercel already returns on the
deployment). Fields are picked EXPLICITLY, never copied wholesale, so:

  * env var metadata/values on a project payload (`env`) are NEVER copied;
  * build logs are never present here at all (the client does not read them);
  * commit messages / project names are length-capped.

GIT CORRELATION (structure, not a correlation engine)
-----------------------------------------------------
When Vercel returns git metadata for a deployment (`meta.githubCommitSha`,
`githubCommitRef`, `githubRepo`…), it is preserved as STRUCTURED payload fields
so Project Brain can later line a failed production deploy up with the GitHub
commit observation that carries the same sha. This PR adds no correlation
engine — only the structured evidence one would need.

COST: pure functions. ZERO model tokens, ZERO embeddings, ZERO network.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from backend.services.orchestrator.observations_store import (
    IMPORTANCE_HIGH, IMPORTANCE_LOW, IMPORTANCE_NORMAL,
)

SOURCE = "vercel"

KIND_DEPLOYMENT_READY = "vercel.deployment.ready"
KIND_DEPLOYMENT_ERROR = "vercel.deployment.error"
KIND_DEPLOYMENT_CANCELED = "vercel.deployment.canceled"
KIND_PROJECT_UPDATED = "vercel.project.updated"

TARGET_PRODUCTION = "production"
TARGET_PREVIEW = "preview"

# Vercel deployment states we treat as TERMINAL (worth observing) → our verb.
_TERMINAL_STATES = {
    "READY": "ready",
    "ERROR": "error",
    "CANCELED": "canceled",
}

_SUMMARY_MAX = 240
_NAME_MAX = 200
_MESSAGE_MAX = 200
_URL_MAX = 400
_SHA_MAX = 40


def _s(v: Any, limit: int = 0) -> str:
    out = "" if v is None else str(v)
    return out[:limit] if limit else out


def _first_line(v: Any, limit: int = _MESSAGE_MAX) -> str:
    return _s(v).split("\n", 1)[0][:limit]


def _iso_from_ms(value: Any) -> str:
    """Vercel timestamps are epoch MILLISECONDS. Convert to a UTC ISO instant so
    `observed_at` is the TRUTHFUL source time — a historical backfill therefore
    sorts as old activity and can never masquerade as a fresh event. Returns ""
    when the value is missing/unparseable (the store then falls back to ingest
    time rather than inventing one)."""
    if value in (None, ""):
        return ""
    try:
        ms = int(value)
    except (TypeError, ValueError):
        return ""
    try:
        dt = datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc)
    except (OverflowError, OSError, ValueError):
        return ""
    return dt.isoformat().replace("+00:00", "Z")


def _https(host: Any) -> str:
    """Vercel returns deployment URLs as bare hosts ("my-app-abc.vercel.app").
    Render a usable absolute URL; pass an already-absolute value through."""
    raw = _s(host).strip()
    if not raw:
        return ""
    if raw.startswith("http://") or raw.startswith("https://"):
        return raw[:_URL_MAX]
    return f"https://{raw}"[:_URL_MAX]


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


def _git_meta(deployment: Dict[str, Any]) -> Dict[str, Any]:
    """The git provenance Vercel already attaches to a deployment, picked field
    by field (never copied wholesale). Empty dict when the deployment has none
    (a CLI deploy). GitHub/GitLab/Bitbucket key families are all read so the
    commit sha survives regardless of provider."""
    meta = deployment.get("meta")
    if not isinstance(meta, dict):
        return {}
    sha = (meta.get("githubCommitSha") or meta.get("gitlabCommitSha")
           or meta.get("bitbucketCommitSha") or "")
    ref = (meta.get("githubCommitRef") or meta.get("gitlabCommitRef")
           or meta.get("bitbucketCommitRef") or "")
    message = (meta.get("githubCommitMessage") or meta.get("gitlabCommitMessage")
               or meta.get("bitbucketCommitMessage") or "")
    author = (meta.get("githubCommitAuthorName") or meta.get("gitlabCommitAuthorName")
              or meta.get("bitbucketCommitAuthorName") or "")
    repo = (meta.get("githubRepo") or meta.get("gitlabProjectName")
            or meta.get("bitbucketRepoName") or "")
    org = (meta.get("githubOrg") or meta.get("gitlabProjectNamespace")
           or meta.get("bitbucketRepoOwner") or "")
    out: Dict[str, Any] = {}
    if sha:
        out["commit_sha"] = _s(sha, _SHA_MAX)
    if ref:
        out["ref"] = _s(ref, 120)
    if message:
        out["commit_message"] = _first_line(message)
    if author:
        out["commit_author"] = _s(author, 80)
    if repo:
        out["repo"] = _s(f"{org}/{repo}" if org else repo, 140)
    return out


def _target_of(deployment: Dict[str, Any]) -> str:
    """Vercel marks production deployments with `target="production"`; a preview
    build carries null (or "staging"). Normalize to a stable two/three-value
    field so importance policy can key off it."""
    target = _s(deployment.get("target")).strip().lower()
    return target or TARGET_PREVIEW


def _deployment_importance(verb: str, target: str) -> str:
    """Advisory importance hint, expressed with the EXISTING three-level
    vocabulary (no second prioritizer):

      production error    → high    (the live site is broken — the strongest
                                     signal this connector can produce)
      production ready    → normal  (a shipped release; mirrors the GitHub
                                     deployment_status success policy)
      preview error       → normal  (a real failure, but not user-facing)
      preview ready       → low     (routine green)
      canceled (any)      → low     (no outcome to act on)
    """
    if verb == "canceled":
        return IMPORTANCE_LOW
    if target == TARGET_PRODUCTION:
        return IMPORTANCE_HIGH if verb == "error" else IMPORTANCE_NORMAL
    return IMPORTANCE_NORMAL if verb == "error" else IMPORTANCE_LOW


def normalize_deployment(deployment: Dict[str, Any], *,
                         vercel_project_id: str = "",
                         project_name: str = "") -> Optional[Dict[str, Any]]:
    """Normalize ONE Vercel deployment list item into an observation dict.

    Returns None when the input is malformed (no id) or the deployment has not
    reached a terminal state yet (BUILDING / QUEUED / INITIALIZING)."""
    if not isinstance(deployment, dict):
        return None
    uid = _s(deployment.get("uid") or deployment.get("id"))
    if not uid:
        return None

    state = _s(deployment.get("state") or deployment.get("readyState")).strip().upper()
    verb = _TERMINAL_STATES.get(state)
    if not verb:
        return None  # still in flight — not yet a signal

    target = _target_of(deployment)
    project_key = _s(vercel_project_id or deployment.get("projectId") or "unknown")

    # Source time: when the deployment actually reached its terminal state,
    # falling back to when it started/was created. Never "now".
    observed_at = (
        _iso_from_ms(deployment.get("ready")) if verb == "ready" else ""
    ) or _iso_from_ms(deployment.get("buildingAt")) \
        or _iso_from_ms(deployment.get("created")) \
        or _iso_from_ms(deployment.get("createdAt"))

    git = _git_meta(deployment)
    creator = deployment.get("creator") if isinstance(deployment.get("creator"), dict) else {}

    payload: Dict[str, Any] = {
        "provider": SOURCE,
        "vercel_project_id": project_key,
        "project_name": _s(project_name or deployment.get("name"), _NAME_MAX),
        "deployment_id": uid,
        "state": state,
        "target": target,
        "url": _https(deployment.get("url")),
        "inspector_url": _s(deployment.get("inspectorUrl"), _URL_MAX),
        "created_at": _iso_from_ms(deployment.get("created") or deployment.get("createdAt")),
        "ready_at": _iso_from_ms(deployment.get("ready")),
        "creator": _s(creator.get("username") or creator.get("email"), 120),
    }
    if git:
        payload["git"] = git
    # A bounded, human-readable failure hint when Vercel supplies one. NEVER a
    # build log — only the short structured error message on the list item.
    err = deployment.get("aliasError") if isinstance(deployment.get("aliasError"), dict) else None
    if verb == "error" and err and err.get("message"):
        payload["error_message"] = _first_line(err.get("message"))

    label = "Production" if target == TARGET_PRODUCTION else "Preview"
    name = payload["project_name"] or project_key
    verb_text = {"ready": "succeeded", "error": "FAILED", "canceled": "was canceled"}[verb]
    summary = f"{label} deployment {verb_text} for {name}"
    ref = (git or {}).get("ref")
    if ref:
        summary = f"{summary} ({ref})"

    kind = {
        "ready": KIND_DEPLOYMENT_READY,
        "error": KIND_DEPLOYMENT_ERROR,
        "canceled": KIND_DEPLOYMENT_CANCELED,
    }[verb]
    return _obs(
        kind,
        f"vercel:deployment:{project_key}:{uid}:{verb}",
        summary,
        observed_at=observed_at,
        importance=_deployment_importance(verb, target),
        payload=payload,
    )


def normalize_deployments(deployments: List[Dict[str, Any]], *,
                          vercel_project_id: str = "",
                          project_name: str = "") -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for d in deployments or []:
        o = normalize_deployment(d, vercel_project_id=vercel_project_id,
                                 project_name=project_name)
        if o:
            out.append(o)
    return out


def production_url(project: Dict[str, Any]) -> str:
    """Best-effort production URL for a project payload: the production target's
    alias/url, else the first configured alias. Returns "" when unknown."""
    if not isinstance(project, dict):
        return ""
    targets = project.get("targets")
    prod = targets.get("production") if isinstance(targets, dict) else None
    if isinstance(prod, dict):
        alias = prod.get("alias")
        if isinstance(alias, list) and alias:
            return _https(alias[0])
        if prod.get("url"):
            return _https(prod.get("url"))
    alias = project.get("alias")
    if isinstance(alias, list) and alias:
        first = alias[0]
        if isinstance(first, dict):
            return _https(first.get("domain"))
        return _https(first)
    return ""


def project_identity(project: Dict[str, Any]) -> Dict[str, str]:
    """The small, explicitly-picked identity fields the connection caches for the
    UI. NOTHING else from the project payload is read — in particular `env`
    (environment-variable metadata/values) is never touched."""
    if not isinstance(project, dict):
        return {"id": "", "name": "", "framework": "", "production_url": ""}
    return {
        "id": _s(project.get("id")),
        "name": _s(project.get("name"), _NAME_MAX),
        "framework": _s(project.get("framework"), 60),
        "production_url": production_url(project),
    }


def normalize_project(project: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Normalize a Vercel project resource into a low-importance identity/config
    observation. Keyed by (project id, updatedAt) so a re-sync of an unchanged
    project deduplicates, while a genuine project change records once."""
    if not isinstance(project, dict):
        return None
    ident = project_identity(project)
    pid = ident["id"]
    if not pid:
        return None
    updated_ms = project.get("updatedAt") or project.get("createdAt")
    observed_at = _iso_from_ms(updated_ms)
    # The dedup key must be stable for an unchanged project, so it uses the raw
    # updatedAt value (or "0" when Vercel omits it) rather than the sync time.
    version = _s(updated_ms) or "0"

    payload: Dict[str, Any] = {
        "provider": SOURCE,
        "vercel_project_id": pid,
        "project_name": ident["name"],
        "framework": ident["framework"],
        "production_url": ident["production_url"],
        "created_at": _iso_from_ms(project.get("createdAt")),
        "updated_at": _iso_from_ms(project.get("updatedAt")),
    }
    link = project.get("link") if isinstance(project.get("link"), dict) else None
    if link:
        repo = _s(link.get("repo"), 140)
        org = _s(link.get("org") or link.get("owner"), 140)
        if repo:
            payload["git_repo"] = _s(f"{org}/{repo}" if org else repo, 140)
        if link.get("type"):
            payload["git_provider"] = _s(link.get("type"), 40)

    return _obs(
        KIND_PROJECT_UPDATED,
        f"vercel:project:{pid}:{version}",
        f"Vercel project {ident['name'] or pid}"
        + (f" ({ident['framework']})" if ident["framework"] else ""),
        observed_at=observed_at,
        importance=IMPORTANCE_LOW,
        payload=payload,
    )


__all__ = [
    "SOURCE", "KIND_DEPLOYMENT_READY", "KIND_DEPLOYMENT_ERROR",
    "KIND_DEPLOYMENT_CANCELED", "KIND_PROJECT_UPDATED",
    "TARGET_PRODUCTION", "TARGET_PREVIEW",
    "normalize_deployment", "normalize_deployments", "normalize_project",
    "project_identity", "production_url",
]
