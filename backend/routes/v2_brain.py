# coding: utf-8
"""/v2/projects/{id}/brain — Phase 8 Project Brain."""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Path
from pydantic import BaseModel, Field

from backend.core.deps import current_user
from backend.core.responses import ok as envelope_ok
from backend.services.auth.identity import User
from backend.services.project_brain import client as brain_client


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
