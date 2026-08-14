# coding: utf-8
"""
/v2/sessions — auth-bound sessions (Phase 5).

The parallel-namespace version of legacy /sessions/* that derives
`user_id` from the authenticated JWT instead of accepting it in the
request body. Every endpoint:

  - is gated by `require_auth` (Phase 3a) so guests can still call it
    (Phase 3a treats a fresh anonymous browser as a stable guest user)
    but no caller can spoof another user's id
  - returns the v2 envelope ({success, data, error, metadata, timestamp})
  - hides existence on cross-user access (NotFoundError, not 403)

Legacy /sessions/* stays UNCHANGED for back-compat with any existing
caller. New code should target /v2/sessions/*.

Two env flags must be on for these routes to function as designed:
  ENABLE_SESSIONS=true   (storage layer)
  ENABLE_AUTH_V2=true    (AuthMiddleware populates request.state.user)

When either is off, the routes still respond — sessions disabled
returns 503 (matching legacy behaviour); auth disabled means
request.state.user falls back to a synthetic "guest:no-middleware"
identity which still gets a stable user_id for its own data, just
without cross-device persistence.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from backend.core.deps import current_user
from backend.core.errors import NotFoundError
from backend.core.responses import ok as envelope_ok
from backend.services.auth.identity import User
from backend.services.sessions import client as sessions_client
from backend.services.sessions.auth import (
    thread_or_404,
    workspace_or_404,
)


logger = logging.getLogger(__name__)


router = APIRouter(prefix="/v2/sessions", tags=["sessions-v2"])


def _sessions_enabled() -> bool:
    return os.getenv("ENABLE_SESSIONS", "false").strip().lower() == "true"


def _ensure_enabled() -> None:
    if not _sessions_enabled():
        raise HTTPException(
            status_code=503,
            detail={
                "code":     "SESSIONS_DISABLED",
                "message":  "Sessions service is disabled. Set ENABLE_SESSIONS=true to activate.",
                "rollback": "Unset ENABLE_SESSIONS (or set to 'false') to disable again.",
            },
        )


# ── Request bodies (no user_id field — derived from JWT) ─────────────────

class CreateWorkspaceBody(BaseModel):
    name:     str = Field(..., min_length=1, max_length=120)
    kind:     str = "personal"
    slug:     Optional[str] = Field(None, max_length=64)
    metadata: Optional[Dict[str, Any]] = None


class UpdateWorkspaceBody(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    kind: Optional[str] = None


class CreateThreadBody(BaseModel):
    title:    str = Field("New thread", min_length=1, max_length=200)
    mode:     Optional[str] = Field(None, max_length=32)
    metadata: Optional[Dict[str, Any]] = None


class UpdateThreadBody(BaseModel):
    title:   Optional[str] = Field(None, min_length=1, max_length=200)
    mode:    Optional[str] = Field(None, max_length=32)
    status:  Optional[str] = Field(None, max_length=32)
    summary: Optional[str] = Field(None, max_length=2000)


class AppendMessageBody(BaseModel):
    role:     str = Field(..., max_length=32)
    content:  str = Field(..., min_length=1, max_length=64_000)
    model:    Optional[str] = Field(None, max_length=128)
    tokens:   Optional[int] = Field(None, ge=0)
    metadata: Optional[Dict[str, Any]] = None


# ── Workspaces ────────────────────────────────────────────────────────────

@router.get("/workspaces")
def list_workspaces(
    include_archived: bool = False,
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    """List the authenticated user's workspaces only."""
    _ensure_enabled()
    items = sessions_client.list_workspaces(user.id, include_archived=include_archived)
    return envelope_ok(
        data={"workspaces": [w.to_dict() for w in items]},
        endpoint="/v2/sessions/workspaces",
        user_id=user.id,
        count=len(items),
    )


@router.post("/workspaces", status_code=201)
def create_workspace(
    body: CreateWorkspaceBody,
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    """Create a new workspace owned by the authenticated user."""
    _ensure_enabled()
    ws = sessions_client.create_workspace(
        user.id, name=body.name, kind=body.kind,
        slug=body.slug, metadata=body.metadata,
    )
    return envelope_ok(
        data=ws.to_dict(),
        endpoint="/v2/sessions/workspaces",
        user_id=user.id,
    )


@router.post("/workspaces/ensure_default")
def ensure_default(user: User = Depends(current_user)) -> Dict[str, Any]:
    """Return (or create) the authenticated user's default workspace.

    Idempotent — calling twice returns the same workspace. Frontends
    should call this on first load when they don't yet have a
    workspace id stashed in localStorage.
    """
    _ensure_enabled()
    ws = sessions_client.ensure_default_workspace(user.id)
    return envelope_ok(
        data=ws.to_dict(),
        endpoint="/v2/sessions/workspaces/ensure_default",
        user_id=user.id,
    )


@router.get("/workspaces/{workspace_id}")
def get_workspace(
    workspace_id: str,
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    ws = workspace_or_404(workspace_id, user)
    return envelope_ok(
        data=ws.to_dict(),
        endpoint=f"/v2/sessions/workspaces/{workspace_id}",
    )


@router.patch("/workspaces/{workspace_id}")
def update_workspace(
    workspace_id: str,
    body: UpdateWorkspaceBody,
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    workspace_or_404(workspace_id, user)
    ws = sessions_client.update_workspace(
        workspace_id, name=body.name, kind=body.kind,
    )
    if ws is None:
        raise NotFoundError(f"workspace '{workspace_id}' not found")
    return envelope_ok(
        data=ws.to_dict(),
        endpoint=f"/v2/sessions/workspaces/{workspace_id}",
    )


@router.delete("/workspaces/{workspace_id}")
def archive_workspace(
    workspace_id: str,
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    workspace_or_404(workspace_id, user)
    archived = sessions_client.archive_workspace(workspace_id)
    if not archived:
        raise NotFoundError(f"workspace '{workspace_id}' not found")
    return envelope_ok(
        data={"archived": True, "id": workspace_id},
        endpoint=f"/v2/sessions/workspaces/{workspace_id}",
    )


# ── Threads ───────────────────────────────────────────────────────────────

@router.get("/workspaces/{workspace_id}/threads")
def list_threads(
    workspace_id: str,
    include_archived: bool = False,
    limit: int = 50,
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    workspace_or_404(workspace_id, user)
    items = sessions_client.list_threads(
        workspace_id, include_archived=include_archived, limit=limit,
    )
    return envelope_ok(
        data={"threads": [t.to_dict() for t in items]},
        endpoint=f"/v2/sessions/workspaces/{workspace_id}/threads",
        count=len(items),
    )


@router.post("/workspaces/{workspace_id}/threads", status_code=201)
def create_thread(
    workspace_id: str,
    body: CreateThreadBody,
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    workspace_or_404(workspace_id, user)
    th = sessions_client.create_thread(
        workspace_id=workspace_id, title=body.title,
        mode=body.mode, metadata=body.metadata,
    )
    return envelope_ok(
        data=th.to_dict(),
        endpoint=f"/v2/sessions/workspaces/{workspace_id}/threads",
    )


@router.get("/threads/{thread_id}")
def get_thread(
    thread_id: str,
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    th = thread_or_404(thread_id, user)
    return envelope_ok(
        data=th.to_dict(),
        endpoint=f"/v2/sessions/threads/{thread_id}",
    )


@router.patch("/threads/{thread_id}")
def update_thread(
    thread_id: str,
    body: UpdateThreadBody,
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    thread_or_404(thread_id, user)
    th = sessions_client.update_thread(
        thread_id, title=body.title, mode=body.mode,
        status=body.status, summary=body.summary,
    )
    if th is None:
        raise NotFoundError(f"thread '{thread_id}' not found")
    return envelope_ok(
        data=th.to_dict(),
        endpoint=f"/v2/sessions/threads/{thread_id}",
    )


@router.delete("/threads/{thread_id}")
def archive_thread(
    thread_id: str,
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    thread_or_404(thread_id, user)
    archived = sessions_client.archive_thread(thread_id)
    if not archived:
        raise NotFoundError(f"thread '{thread_id}' not found")
    return envelope_ok(
        data={"archived": True, "id": thread_id},
        endpoint=f"/v2/sessions/threads/{thread_id}",
    )


# ── Messages ──────────────────────────────────────────────────────────────

@router.get("/threads/{thread_id}/messages")
def list_messages(
    thread_id: str,
    limit: int = 100,
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    thread_or_404(thread_id, user)
    items = sessions_client.list_messages(thread_id, limit=limit)
    return envelope_ok(
        data={"messages": [m.to_dict() for m in items]},
        endpoint=f"/v2/sessions/threads/{thread_id}/messages",
        count=len(items),
    )


@router.post("/threads/{thread_id}/messages", status_code=201)
def append_message(
    thread_id: str,
    body: AppendMessageBody,
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    thread_or_404(thread_id, user)
    msg = sessions_client.append_message(
        thread_id=thread_id, role=body.role, content=body.content,
        model=body.model, tokens=body.tokens, metadata=body.metadata,
    )
    return envelope_ok(
        data=msg.to_dict(),
        endpoint=f"/v2/sessions/threads/{thread_id}/messages",
    )


# ── Chat ↔ Project binding (backend-authoritative) ─────────────────────────
#
# A chat (thread) can be assigned to, moved between, or removed from any project
# the caller owns. The association is the canonical `project_threads` binding in
# the projects store — the SAME record Project Brain reads for a project's chats.
#
# Both sides are ownership-checked SERVER-SIDE, never trusting the client:
#   * the thread must belong to the caller (thread_or_404, via its workspace)
#   * the target project must be owned by the caller (_project_or_404)
# so user B can neither read A's chat nor file it under A's project.

class AssignProjectBody(BaseModel):
    project_id: str = Field(..., min_length=1, max_length=64)


def _project_or_404(project_id: str, user: User):
    """Return the project iff it exists AND belongs to `user`. Existence-hidden
    404 on any mismatch, mirroring thread_or_404's non-leaking contract."""
    from backend.services.projects import store as projects_store
    p = None
    try:
        p = projects_store.get_project(project_id)
    except Exception:
        p = None
    if p is None or str(p.owner_user_id) != str(user.id):
        raise NotFoundError(f"project '{project_id}' not found")
    return p


@router.get("/threads/{thread_id}/project")
def get_thread_project(
    thread_id: str,
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    """The project a thread is currently filed under (or null)."""
    _ensure_enabled()
    thread_or_404(thread_id, user)
    from backend.services.projects import store as projects_store
    pid = projects_store.get_project_of_thread(thread_id)
    return envelope_ok(
        data={"thread_id": thread_id, "project_id": pid},
        endpoint=f"/v2/sessions/threads/{thread_id}/project",
        user_id=user.id,
    )


@router.put("/threads/{thread_id}/project")
def assign_thread_project(
    thread_id: str,
    body: AssignProjectBody,
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    """Assign or MOVE a chat to a project the caller owns. Moving is a detach of
    any prior binding + attach of the new one, so a thread is filed under at most
    one project. Idempotent when the thread is already in the target project."""
    _ensure_enabled()
    thread_or_404(thread_id, user)
    _project_or_404(body.project_id, user)
    from backend.services.projects import store as projects_store
    prior = projects_store.get_project_of_thread(thread_id)
    if prior and prior != body.project_id:
        projects_store.detach_thread(prior, thread_id)
    projects_store.attach_thread(body.project_id, thread_id)
    return envelope_ok(
        data={"thread_id": thread_id, "project_id": body.project_id,
              "moved_from": prior if prior and prior != body.project_id else None},
        endpoint=f"/v2/sessions/threads/{thread_id}/project",
        user_id=user.id,
    )


@router.delete("/threads/{thread_id}/project")
def remove_thread_project(
    thread_id: str,
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    """Remove a chat from its project (the thread and its messages are kept —
    only the binding is dropped)."""
    _ensure_enabled()
    thread_or_404(thread_id, user)
    from backend.services.projects import store as projects_store
    prior = projects_store.get_project_of_thread(thread_id)
    if prior:
        projects_store.detach_thread(prior, thread_id)
    return envelope_ok(
        data={"thread_id": thread_id, "project_id": None, "removed_from": prior},
        endpoint=f"/v2/sessions/threads/{thread_id}/project",
        user_id=user.id,
    )


@router.get("/projects/{project_id}/threads")
def list_project_threads(
    project_id: str,
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    """List the chats filed under a project the caller owns. Returns full thread
    summaries (title/mode/timestamps) by resolving each binding through the
    sessions authority; bindings whose thread is missing/foreign are skipped."""
    _ensure_enabled()
    _project_or_404(project_id, user)
    from backend.services.projects import store as projects_store
    links = projects_store.list_project_threads(project_id)
    threads: List[Dict[str, Any]] = []
    for link in links:
        th = sessions_client.get_thread(link.thread_id)
        if th is None:
            continue
        ws = sessions_client.get_workspace(th.workspace_id)
        if ws is None or str(ws.user_id) != str(user.id):
            continue   # defense-in-depth: never surface a foreign thread
        threads.append({**th.to_dict(), "added_at": link.added_at})
    return envelope_ok(
        data={"threads": threads},
        endpoint=f"/v2/sessions/projects/{project_id}/threads",
        user_id=user.id,
        count=len(threads),
    )


__all__ = ["router"]
