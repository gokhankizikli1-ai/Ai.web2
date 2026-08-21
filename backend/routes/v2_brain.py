# coding: utf-8
"""/v2/projects/{id}/brain — Phase 8 Project Brain."""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Path
from pydantic import BaseModel, Field

from backend.core.deps import current_user
from backend.core.responses import ok as envelope_ok
from backend.services.auth.identity import User
from backend.services.project_brain import client as brain_client
from backend.services.project_brain import workspace as project_workspace


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v2/projects", tags=["project-brain-v2"])


def _ensure_enabled() -> None:
    if not os.getenv("ENABLE_PROJECT_BRAIN", "false").strip().lower() == "true":
        raise HTTPException(
            status_code=503,
            detail={
                "code":     "PROJECT_BRAIN_DISABLED",
                "message":  "Project Brain is disabled. Set ENABLE_PROJECT_BRAIN=true.",
                "rollback": "Unset ENABLE_PROJECT_BRAIN to disable.",
            },
        )


# ── Project workspace read model ─────────────────────────────────────────────

@router.get("/{project_id}/workspace")
def get_workspace(
    background: BackgroundTasks,
    project_id: str = Path(..., max_length=64),
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    """The bounded Project Workspace snapshot the Project page renders from:
    summary, goals, needs-attention, recent activity, products, chats, connected
    tools and freshness — assembled from the EXISTING authorities in one request.

    Deliberately NOT gated on `ENABLE_PROJECT_BRAIN`. The workspace is the
    project's own surface (its chats, builds and connected tools exist whether or
    not the Project Brain is switched on); the brain-derived slices simply
    degrade — the summary falls back to the project's own description and
    memory-plane goals are omitted — instead of the whole page 503-ing.

    Ownership is enforced through the canonical `projects` record: a project the
    caller does not own is 404, existence-hidden. Building the snapshot performs
    no provider API call, no model call, and no write of any kind — that is
    still `project_workspace.build`'s whole contract.

    SMART REFRESH (stale-while-revalidate)
    --------------------------------------
    The snapshot in the response is the PERSISTED one, computed and returned
    before any refresh is even considered — the response body and its latency
    are identical to before. Only after it is assembled does this route ask the
    connector refresh coordinator which of the project's BOUND connectors are
    past their freshness TTL, take the lease for at most `MAX_PER_OPEN` of them,
    and hand the actual provider reads to `BackgroundTasks`, which runs AFTER
    the response has been sent.

    So, per page open:
      * every connector fresh (the common case) → ZERO provider calls, and the
        only added cost is one bounded read of the attempt table;
      * a stale connector → ONE bounded refresh, through the same
        `connectors.sync.sync_binding` the explicit Sync button uses;
      * a second tab, a React double-mount, or a rapid navigate-away-and-back →
        ZERO extra calls: the lease is taken synchronously here, so the second
        arrival sees the first one's claim and reports it as `in_flight`.

    Nothing about this can start a run, write a candidate action, request an
    approval or spend a model token: a refresh ingests observations through the
    one canonical store and stops there. The `refresh` block it adds to the
    payload is coordination metadata for the page, never project state."""
    snapshot = project_workspace.build(str(user.id), project_id)
    if snapshot is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "PROJECT_NOT_FOUND", "message": "Project not found."},
        )
    snapshot["refresh"] = _schedule_stale_refresh(background, str(user.id),
                                                  str(project_id))
    return envelope_ok(
        data=snapshot,
        endpoint=f"/v2/projects/{project_id}/workspace",
        user_id=user.id,
    )


def _schedule_stale_refresh(background: BackgroundTasks, user_id: str,
                            project_id: str) -> Dict[str, Any]:
    """Plan, claim and schedule the background refresh; return what the page is
    told about it.

    Reached only AFTER the ownership gate above, so a foreign or nonexistent
    project never gets here. Fail-soft by construction: any error in the
    coordinator degrades to "nothing is refreshing", which is exactly the
    pre-existing behaviour of this endpoint.

    `started`   leases this request took — a provider read WILL run
    `in_flight` already being refreshed by another tab / a previous open
    `stale`     everything past its TTL, whether or not it is being acted on
    `recheck_in_ms` how long the page should wait before ONE re-read; 0 means
                there is nothing coming and the page must not re-read at all."""
    quiet = {"started": [], "in_flight": [], "stale": [], "recheck_in_ms": 0}
    try:
        from backend.services.connectors import refresh as refresh_mod
        plan = refresh_mod.plan(user_id, project_id)
        eligible = list(plan.get("eligible") or [])
        started = refresh_mod.claim_eligible(user_id, project_id, eligible)
        if started:
            background.add_task(refresh_mod.run_claimed, user_id, project_id,
                                started)
        in_flight = list(plan.get("in_flight") or [])
        # A provider we could not claim is being refreshed by somebody else —
        # report it as in-flight rather than pretending it will not update.
        for provider in eligible:
            if provider not in started and provider not in in_flight:
                in_flight.append(provider)
        pending = bool(started or in_flight)
        return {
            "started":       started,
            "in_flight":     in_flight,
            "stale":         list(plan.get("stale") or []),
            "recheck_in_ms": refresh_mod.RECHECK_IN_MS if pending else 0,
        }
    except Exception as exc:
        logger.warning("project_workspace: refresh planning failed: %s", exc)
        return quiet


# ── Brain snapshot ───────────────────────────────────────────────────────────

@router.get("/{project_id}/brain")
def get_brain(
    project_id: str = Path(..., max_length=64),
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    """Full ProjectBrain aggregate (goals + decisions + context +
    linked assets + workflow state + agent notes + counts)."""
    _ensure_enabled()
    brain = brain_client.get(user.id, project_id)
    if brain is None:
        # Disabled OR project effectively empty — return an empty shell
        # rather than 404 so the FE renders the "no project context yet"
        # placeholder.
        return envelope_ok(
            data={"brain": None, "empty": True},
            endpoint=f"/v2/projects/{project_id}/brain",
            user_id=user.id,
        )
    return envelope_ok(
        data={"brain": brain.to_dict()},
        endpoint=f"/v2/projects/{project_id}/brain",
        user_id=user.id,
    )


@router.post("/{project_id}/brain/refresh")
def refresh_brain(
    project_id: str = Path(..., max_length=64),
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    """Force a fresh aggregation. The brain is computed on every call,
    so refresh is currently a synonym for `get` — kept as a separate
    POST so the FE can clearly signal user-initiated refreshes."""
    _ensure_enabled()
    brain = brain_client.get(user.id, project_id)
    return envelope_ok(
        data={"brain": brain.to_dict() if brain else None},
        endpoint=f"/v2/projects/{project_id}/brain/refresh",
        user_id=user.id,
    )


# ── Notes — append a project_context memory ─────────────────────────────────

class NoteBody(BaseModel):
    content: str = Field(..., min_length=2, max_length=2000)


@router.post("/{project_id}/brain/notes")
def add_note(
    project_id: str = Path(..., max_length=64),
    body: NoteBody = ...,
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    """Add a brain note. Persisted as a `project_context` memory in
    Memory Plane so the same data feeds chat-context injection."""
    _ensure_enabled()
    try:
        from backend.services.memory_plane import client as mp
        rec = mp.create(
            user_id=user.id, content=body.content,
            kind="project_context", project_id=project_id,
            importance=0.7,
        )
    except Exception as e:
        logger.warning("project_brain.note write failed: %s", e)
        raise HTTPException(
            status_code=503,
            detail={"code": "MEMORY_PLANE_REQUIRED",
                    "message": "ENABLE_MEMORY_PLANE must also be true to add brain notes"},
        )
    if rec is None:
        raise HTTPException(
            status_code=503,
            detail={"code": "MEMORY_PLANE_DISABLED",
                    "message": "Memory Plane is disabled; brain notes cannot be saved"},
        )
    return envelope_ok(
        data={"note_id": rec.id, "kind": rec.kind},
        endpoint=f"/v2/projects/{project_id}/brain/notes",
        user_id=user.id,
    )


# ── Prompt-injection helper ──────────────────────────────────────────────────

@router.get("/{project_id}/context")
def get_context(
    project_id: str = Path(..., max_length=64),
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    """Return the prompt-ready context block + counts metadata. This
    is what the chat-context builder calls per-turn."""
    _ensure_enabled()
    block = brain_client.build_context(user.id, project_id)
    if block is None:
        return envelope_ok(
            data={"text": "", "metadata": {}, "empty": True},
            endpoint=f"/v2/projects/{project_id}/context",
            user_id=user.id,
        )
    return envelope_ok(
        data={"text": block.text, "metadata": block.metadata},
        endpoint=f"/v2/projects/{project_id}/context",
        user_id=user.id,
    )


__all__ = ["router"]
