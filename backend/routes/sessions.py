# coding: utf-8
# Phase M2 — Sessions routes.
#
# Server-side conversation state CRUD: workspaces → threads → messages.
# All endpoints are gated by the ENABLE_SESSIONS env flag (default off).
# When off, every endpoint returns 503 with a clear message — no behavioural
# impact on the rest of the app.
#
# The /chat route is intentionally NOT yet wired to these tables. That comes
# in W1 (frontend) and a follow-up backend PR. M2 lays the persistent storage
# foundation so the frontend can start migrating off localStorage without
# refactoring the chat pipeline.
import os
import logging
from typing import Optional, Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

router = APIRouter(prefix="/sessions", tags=["sessions"])
logger = logging.getLogger(__name__)


def _enabled() -> bool:
    return os.getenv("ENABLE_SESSIONS", "false").strip().lower() == "true"


def _ensure_enabled() -> None:
    if not _enabled():
        raise HTTPException(
            status_code=503,
            detail={
                "error":   "sessions_disabled",
                "message": "Sessions service is disabled. Set ENABLE_SESSIONS=true to activate.",
                "rollback": "Unset ENABLE_SESSIONS (or set to 'false') to disable again.",
            },
        )


# ── Ownership enforcement (Sprint 1.2) ────────────────────────────────────
#
# DEPRECATED surface — superseded by the auth-bound /v2/sessions/* (which
# enforces ownership via workspace_or_404). This legacy copy is flag-off by
# default and not called by the frontend, but we apply the SAME ownership
# policy as /projects so it can never leak across users if enabled. Identity
# is taken from authenticated context; a workspace's owner is its user_id and
# threads/messages inherit it via their parent chain.

def _enforce_owner(request: Request, owner_user_id, *, supplied_user_id: str = "") -> None:
    from backend.core.principal import resolve_principal
    p = resolve_principal(request)
    if p.is_owner:
        return
    if owner_user_id is None:
        raise HTTPException(404, detail={"error": "not_found"})
    owner = str(owner_user_id)
    if p.is_authenticated:
        if owner != str(p.user_id):
            raise HTTPException(404, detail={"error": "not_found"})
        return
    from backend.core.deps import resolve_authoritative_uid
    resolved = resolve_authoritative_uid(request, str(supplied_user_id or ""), log_prefix="SESSIONS")
    if resolved not in ("", "anonymous") and owner != str(resolved):
        raise HTTPException(404, detail={"error": "not_found"})


def _ws_owner(workspace_id: str):
    from backend.services.sessions import client
    ws = client.get_workspace(workspace_id)
    return getattr(ws, "user_id", None) if ws is not None else None


def _thread_owner(thread_id: str):
    from backend.services.sessions import client
    th = client.get_thread(thread_id)
    if th is None:
        return None
    return _ws_owner(getattr(th, "workspace_id", ""))


# ── Pydantic request bodies ─────────────────────────────────────────────────

class CreateWorkspaceBody(BaseModel):
    user_id:  str
    name:     str = Field(..., min_length=1, max_length=120)
    kind:     str = "personal"
    slug:     Optional[str] = None
    metadata: Optional[dict] = None


class UpdateWorkspaceBody(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    kind: Optional[str] = None


class CreateThreadBody(BaseModel):
    title:    str = Field("New thread", min_length=1, max_length=200)
    mode:     Optional[str] = None
    metadata: Optional[dict] = None


class UpdateThreadBody(BaseModel):
    title:   Optional[str] = Field(None, min_length=1, max_length=200)
    mode:    Optional[str] = None
    status:  Optional[str] = None
    summary: Optional[str] = None


class AppendMessageBody(BaseModel):
    role:     str
    content:  str = Field(..., min_length=1)
    model:    Optional[str] = None
    tokens:   Optional[int] = None
    metadata: Optional[dict] = None


# ── Health ──────────────────────────────────────────────────────────────────

@router.get("/health")
def sessions_health() -> dict:
    """Tiny status endpoint — always callable; tells you whether the flag is on."""
    try:
        from backend.services.sessions import client
        stats = client.stats() if _enabled() else {"counts": {"workspaces": 0, "threads": 0, "messages": 0}}
    except Exception as exc:
        logger.warning("/sessions/health: stats unavailable: %s", exc)
        stats = {"error": str(exc)}
    return {
        "enabled": _enabled(),
        "phase":   "M2 — server-side sessions (workspaces, threads, messages)",
        "stats":   stats,
    }


# ── Workspaces ──────────────────────────────────────────────────────────────

@router.get("/workspaces")
def list_workspaces(request: Request, user_id: str, include_archived: bool = False) -> dict:
    _ensure_enabled()
    from backend.services.sessions import client
    from backend.core.principal import resolve_principal
    p = resolve_principal(request)
    eff_user = user_id if (p.is_owner or not p.is_authenticated) else p.user_id
    items = client.list_workspaces(eff_user, include_archived=include_archived)
    return {"workspaces": [w.to_dict() for w in items]}


@router.post("/workspaces", status_code=201)
def create_workspace(body: CreateWorkspaceBody, request: Request) -> dict:
    _ensure_enabled()
    from backend.services.sessions import client
    from backend.core.deps import resolve_authoritative_uid
    owner_uid = resolve_authoritative_uid(request, str(body.user_id or ""), log_prefix="SESSIONS")
    ws = client.create_workspace(
        owner_uid, name=body.name, kind=body.kind,
        slug=body.slug, metadata=body.metadata,
    )
    return ws.to_dict()


@router.get("/workspaces/{workspace_id}")
def get_workspace(workspace_id: str, request: Request) -> dict:
    _ensure_enabled()
    from backend.services.sessions import client
    ws = client.get_workspace(workspace_id)
    if ws is None:
        raise HTTPException(404, detail={"error": "not_found", "id": workspace_id})
    _enforce_owner(request, getattr(ws, "user_id", None))
    return ws.to_dict()


@router.patch("/workspaces/{workspace_id}")
def update_workspace(workspace_id: str, body: UpdateWorkspaceBody, request: Request) -> dict:
    _ensure_enabled()
    from backend.services.sessions import client
    _enforce_owner(request, _ws_owner(workspace_id))
    ws = client.update_workspace(workspace_id, name=body.name, kind=body.kind)
    if ws is None:
        raise HTTPException(404, detail={"error": "not_found", "id": workspace_id})
    return ws.to_dict()


@router.delete("/workspaces/{workspace_id}", status_code=200)
def archive_workspace(workspace_id: str, request: Request) -> dict:
    _ensure_enabled()
    from backend.services.sessions import client
    _enforce_owner(request, _ws_owner(workspace_id))
    ok = client.archive_workspace(workspace_id)
    if not ok:
        raise HTTPException(404, detail={"error": "not_found_or_already_archived", "id": workspace_id})
    return {"archived": True, "id": workspace_id}


@router.post("/workspaces/ensure_default")
def ensure_default_workspace(user_id: str, request: Request) -> dict:
    _ensure_enabled()
    from backend.services.sessions import client
    from backend.core.deps import resolve_authoritative_uid
    owner_uid = resolve_authoritative_uid(request, str(user_id or ""), log_prefix="SESSIONS")
    ws = client.ensure_default_workspace(owner_uid)
    return ws.to_dict()


# ── Threads ─────────────────────────────────────────────────────────────────

@router.get("/workspaces/{workspace_id}/threads")
def list_threads(workspace_id: str, request: Request, include_archived: bool = False, limit: int = 50) -> dict:
    _ensure_enabled()
    from backend.services.sessions import client
    _enforce_owner(request, _ws_owner(workspace_id))
    items = client.list_threads(workspace_id, include_archived=include_archived, limit=limit)
    return {"threads": [t.to_dict() for t in items]}


@router.post("/workspaces/{workspace_id}/threads", status_code=201)
def create_thread(workspace_id: str, body: CreateThreadBody, request: Request) -> dict:
    _ensure_enabled()
    from backend.services.sessions import client
    owner = _ws_owner(workspace_id)
    if owner is None:
        raise HTTPException(404, detail={"error": "workspace_not_found", "id": workspace_id})
    _enforce_owner(request, owner)
    th = client.create_thread(
        workspace_id=workspace_id, title=body.title, mode=body.mode, metadata=body.metadata,
    )
    return th.to_dict()


@router.get("/threads/{thread_id}")
def get_thread(thread_id: str, request: Request) -> dict:
    _ensure_enabled()
    from backend.services.sessions import client
    th = client.get_thread(thread_id)
    if th is None:
        raise HTTPException(404, detail={"error": "not_found", "id": thread_id})
    _enforce_owner(request, _ws_owner(getattr(th, "workspace_id", "")))
    return th.to_dict()


@router.patch("/threads/{thread_id}")
def update_thread(thread_id: str, body: UpdateThreadBody, request: Request) -> dict:
    _ensure_enabled()
    from backend.services.sessions import client
    _enforce_owner(request, _thread_owner(thread_id))
    th = client.update_thread(
        thread_id, title=body.title, mode=body.mode,
        status=body.status, summary=body.summary,
    )
    if th is None:
        raise HTTPException(404, detail={"error": "not_found", "id": thread_id})
    return th.to_dict()


@router.delete("/threads/{thread_id}", status_code=200)
def archive_thread(thread_id: str, request: Request) -> dict:
    _ensure_enabled()
    from backend.services.sessions import client
    _enforce_owner(request, _thread_owner(thread_id))
    ok = client.archive_thread(thread_id)
    if not ok:
        raise HTTPException(404, detail={"error": "not_found_or_already_archived", "id": thread_id})
    return {"archived": True, "id": thread_id}


# ── Messages ────────────────────────────────────────────────────────────────

@router.get("/threads/{thread_id}/messages")
def list_messages(thread_id: str, request: Request, limit: int = 100, after_id: Optional[str] = None) -> dict:
    _ensure_enabled()
    from backend.services.sessions import client
    _enforce_owner(request, _thread_owner(thread_id))
    items = client.list_messages(thread_id, limit=limit, after_id=after_id)
    return {"messages": [m.to_dict() for m in items]}


@router.post("/threads/{thread_id}/messages", status_code=201)
def append_message(thread_id: str, body: AppendMessageBody, request: Request) -> dict:
    _ensure_enabled()
    from backend.services.sessions import client
    owner = _thread_owner(thread_id)
    if owner is None:
        raise HTTPException(404, detail={"error": "thread_not_found", "id": thread_id})
    _enforce_owner(request, owner)
    msg = client.append_message(
        thread_id=thread_id, role=body.role, content=body.content,
        model=body.model, tokens=body.tokens, metadata=body.metadata,
    )
    return msg.to_dict()


@router.delete("/messages/{message_id}", status_code=200)
def delete_message(message_id: str, request: Request) -> dict:
    _ensure_enabled()
    from backend.services.sessions import client
    # Resolve the owning workspace via the message's thread before deleting.
    try:
        msg = client.get_message(message_id) if hasattr(client, "get_message") else None
    except Exception:
        msg = None
    if msg is not None:
        _enforce_owner(request, _thread_owner(getattr(msg, "thread_id", "")))
    else:
        raise HTTPException(404, detail={"error": "not_found", "id": message_id})
    ok = client.delete_message(message_id)
    if not ok:
        raise HTTPException(404, detail={"error": "not_found", "id": message_id})
    return {"deleted": True, "id": message_id}
