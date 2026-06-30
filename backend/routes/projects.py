# coding: utf-8
# Phase 2 — Projects routes.
#
# CRUD for user-owned projects plus their memory, agents, files, and
# thread bindings. Gated by ENABLE_PROJECTS (default off). When the
# flag is off every endpoint returns 503 — no behavioral impact on
# the rest of the app, no DB initialization performed.
#
# Schema lives in backend/services/projects/store.py. Tables are
# created lazily on first call to init() — done here at module
# import time when the flag is on, so a fresh Railway redeploy with
# ENABLE_PROJECTS=true brings up the tables before the first request.
import os
import logging
from typing import Optional, List

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

router = APIRouter(prefix="/projects", tags=["projects"])
logger = logging.getLogger(__name__)


def _enabled() -> bool:
    return os.getenv("ENABLE_PROJECTS", "false").strip().lower() == "true"


# ── Ownership enforcement (Sprint 1.2) ────────────────────────────────────
#
# Projects carry owner_user_id. Identity is taken from the AUTHENTICATED
# context, never blindly from the request payload. Policy (mirrors the
# /v2/orchestrate read-route model, so it's consistent across the app and
# preserves the product's first-class guest support):
#
#   - OWNER/ADMIN              → may access any project.
#   - authenticated USER       → may access ONLY projects they own; a
#                                cross-user access returns 404 (existence-
#                                hidden). A spoofed body/query user_id can
#                                never grant another user's projects.
#   - GUEST / anonymous        → legacy contract preserved: a header-less
#                                call is allowed (the current FE sends no
#                                auth header on project calls), but if the
#                                guest DOES present an identity (nonce/JWT/
#                                body id) that mismatches the owner, it's
#                                denied. ENABLE_PROJECTS is off by default,
#                                so this is hardening applied before the
#                                surface is enabled in production.

def _principal(request: Request):
    from backend.core.principal import resolve_principal
    return resolve_principal(request)


def _owner_uid_for_create(request: Request, body_user_id: str) -> str:
    """The owner_user_id a new project is created under: the verified
    identity when present, else the supplied id (guest/legacy)."""
    from backend.core.deps import resolve_authoritative_uid
    return resolve_authoritative_uid(request, str(body_user_id or ""), log_prefix="PROJECTS")


def _ensure_project_access(request: Request, project, *, supplied_user_id: str = "") -> None:
    """404 unless the caller may access `project` (see policy above)."""
    if project is None:
        raise HTTPException(status_code=404, detail={"error": "project_not_found"})
    p = _principal(request)
    if p.is_owner:
        return
    owner = str(getattr(project, "owner_user_id", "") or "")
    if p.is_authenticated:
        if owner != str(p.user_id):
            raise HTTPException(status_code=404, detail={"error": "project_not_found"})
        return
    # Guest / anonymous — enforce only when an explicit identity is presented.
    from backend.core.deps import resolve_authoritative_uid
    resolved = resolve_authoritative_uid(request, str(supplied_user_id or ""), log_prefix="PROJECTS")
    if resolved not in ("", "anonymous") and owner != str(resolved):
        raise HTTPException(status_code=404, detail={"error": "project_not_found"})


def _load_project_or_403(request: Request, project_id: str, *, supplied_user_id: str = ""):
    from backend.services.projects import get_project
    p = get_project(project_id)
    _ensure_project_access(request, p, supplied_user_id=supplied_user_id)
    return p


def _ensure_enabled() -> None:
    if not _enabled():
        raise HTTPException(
            status_code=503,
            detail={
                "error":    "projects_disabled",
                "message":  "Projects service is disabled. Set ENABLE_PROJECTS=true to activate.",
                "rollback": "Unset ENABLE_PROJECTS (or set 'false') to disable again.",
            },
        )


# Bring up tables once at import time when the flag is on. Idempotent.
if _enabled():
    try:
        from backend.services.projects import init as _projects_init
        _projects_init()
        logger.info("projects.store initialized (ENABLE_PROJECTS=true)")
    except Exception as exc:  # pragma: no cover — defensive
        logger.warning("projects.store init failed: %s", exc)


# ── Pydantic request bodies ─────────────────────────────────────────────────

class CreateProjectBody(BaseModel):
    user_id:     str
    name:        str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = Field("", max_length=4000)
    metadata:    Optional[dict] = None
    # Allow the client to pass an existing id (used by the one-time
    # localStorage → backend migration so frontend references stay valid).
    project_id:  Optional[str] = None


class UpdateProjectBody(BaseModel):
    name:        Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=4000)
    status:      Optional[str] = None
    metadata:    Optional[dict] = None


class AddMemoryBody(BaseModel):
    content:  str = Field(..., min_length=1, max_length=8000)
    kind:     Optional[str] = "note"
    source:   Optional[str] = "user"
    metadata: Optional[dict] = None


class CreateAgentBody(BaseModel):
    name:          str = Field(..., min_length=1, max_length=120)
    role:          Optional[str] = ""
    system_prompt: Optional[str] = ""
    model_hint:    Optional[str] = ""
    color:         Optional[str] = ""
    icon:          Optional[str] = ""
    metadata:      Optional[dict] = None
    agent_id:      Optional[str] = None


class UpdateAgentBody(BaseModel):
    name:          Optional[str] = Field(None, min_length=1, max_length=120)
    role:          Optional[str] = None
    system_prompt: Optional[str] = None
    model_hint:    Optional[str] = None
    color:         Optional[str] = None
    icon:          Optional[str] = None
    metadata:      Optional[dict] = None


class AttachThreadBody(BaseModel):
    thread_id: str = Field(..., min_length=1, max_length=128)


# ── Serializers ────────────────────────────────────────────────────────────

def _project_dict(p) -> dict:
    return {
        "id":            p.id,
        "owner_user_id": p.owner_user_id,
        "name":          p.name,
        "description":   p.description,
        "status":        p.status,
        "created_at":    p.created_at,
        "updated_at":    p.updated_at,
        "archived_at":   p.archived_at,
        "metadata":      p.metadata,
    }


def _memory_dict(m) -> dict:
    return {
        "id":         m.id,
        "project_id": m.project_id,
        "kind":       m.kind,
        "content":    m.content,
        "source":     m.source,
        "created_at": m.created_at,
        "metadata":   m.metadata,
    }


def _agent_dict(a) -> dict:
    return {
        "id":            a.id,
        "project_id":    a.project_id,
        "name":          a.name,
        "role":          a.role,
        "system_prompt": a.system_prompt,
        "model_hint":    a.model_hint,
        "color":         a.color,
        "icon":          a.icon,
        "created_at":    a.created_at,
        "updated_at":    a.updated_at,
        "metadata":      a.metadata,
    }


# ── Health ──────────────────────────────────────────────────────────────────

@router.get("/health")
def projects_health() -> dict:
    """Always callable — reports flag state and store stats."""
    stats: dict = {}
    if _enabled():
        try:
            from backend.services.projects import store_stats
            stats = store_stats()
        except Exception as exc:
            logger.warning("/projects/health: stats unavailable: %s", exc)
            stats = {"error": str(exc)}
    return {
        "enabled": _enabled(),
        "phase":   "2 — project persistence + shared project memory",
        "stats":   stats,
    }


# ── Projects ────────────────────────────────────────────────────────────────

@router.get("")
def list_projects_route(request: Request, user_id: str, include_archived: bool = False) -> dict:
    _ensure_enabled()
    from backend.services.projects import list_projects
    p = _principal(request)
    # Authenticated non-owner: scope to self (a spoofed ?user_id is ignored).
    # Owner: honour the explicit filter. Guest: legacy — list the supplied id.
    if p.is_owner:
        eff_user = user_id
    elif p.is_authenticated:
        eff_user = p.user_id
    else:
        eff_user = user_id
    rows = list_projects(eff_user, include_archived=include_archived)
    return {"projects": [_project_dict(x) for x in rows]}


@router.post("", status_code=201)
def create_project_route(request: Request, body: CreateProjectBody) -> dict:
    _ensure_enabled()
    from backend.services.projects import create_project
    # Owner is the AUTHENTICATED identity (JWT) when present; body.user_id is
    # only the fallback for guest/legacy clients. An authenticated user can
    # never create a project owned by a different account.
    owner_uid = _owner_uid_for_create(request, body.user_id)
    p = create_project(
        owner_uid,
        name=body.name,
        description=body.description or "",
        metadata=body.metadata,
        project_id=body.project_id,
    )
    return _project_dict(p)


@router.get("/{project_id}")
def get_project_route(project_id: str, request: Request) -> dict:
    _ensure_enabled()
    p = _load_project_or_403(request, project_id)
    return _project_dict(p)


@router.patch("/{project_id}")
def update_project_route(project_id: str, body: UpdateProjectBody, request: Request) -> dict:
    _ensure_enabled()
    _load_project_or_403(request, project_id)   # ownership gate
    from backend.services.projects import update_project
    p = update_project(
        project_id,
        name=body.name,
        description=body.description,
        status=body.status,
        metadata=body.metadata,
    )
    if not p:
        raise HTTPException(status_code=404, detail={"error": "project_not_found"})
    return _project_dict(p)


@router.delete("/{project_id}", status_code=200)
def delete_project_route(project_id: str, request: Request) -> dict:
    _ensure_enabled()
    _load_project_or_403(request, project_id)   # ownership gate
    from backend.services.projects import delete_project
    ok = delete_project(project_id)
    if not ok:
        raise HTTPException(status_code=404, detail={"error": "project_not_found"})
    return {"deleted": True, "project_id": project_id}


# ── Project memory ─────────────────────────────────────────────────────────

@router.get("/{project_id}/memory")
def list_memory_route(
    request: Request,
    project_id: str,
    kind: Optional[str] = None,
    limit: int = 50,
    newest_first: bool = True,
) -> dict:
    _ensure_enabled()
    from backend.services.projects import list_memory
    _load_project_or_403(request, project_id)   # ownership gate
    rows = list_memory(project_id, kind=kind, limit=limit, newest_first=newest_first)
    return {"memory": [_memory_dict(m) for m in rows]}


@router.post("/{project_id}/memory", status_code=201)
def add_memory_route(project_id: str, body: AddMemoryBody, request: Request) -> dict:
    _ensure_enabled()
    _load_project_or_403(request, project_id)   # ownership gate
    from backend.services.projects import add_memory
    m = add_memory(
        project_id,
        content=body.content,
        kind=body.kind or "note",
        source=body.source or "user",
        metadata=body.metadata,
    )
    if not m:
        raise HTTPException(status_code=404, detail={"error": "project_not_found_or_empty_content"})
    return _memory_dict(m)


@router.delete("/{project_id}/memory/{memory_id}", status_code=200)
def delete_memory_route(project_id: str, memory_id: str, request: Request) -> dict:
    _ensure_enabled()
    _load_project_or_403(request, project_id)   # ownership gate
    from backend.services.projects import delete_memory
    ok = delete_memory(memory_id)
    return {"deleted": ok, "memory_id": memory_id}


# ── Project agents ─────────────────────────────────────────────────────────

@router.get("/{project_id}/agents")
def list_agents_route(project_id: str, request: Request) -> dict:
    _ensure_enabled()
    from backend.services.projects import list_agents
    _load_project_or_403(request, project_id)   # ownership gate
    rows = list_agents(project_id)
    return {"agents": [_agent_dict(a) for a in rows]}


@router.post("/{project_id}/agents", status_code=201)
def create_agent_route(project_id: str, body: CreateAgentBody, request: Request) -> dict:
    _ensure_enabled()
    _load_project_or_403(request, project_id)   # ownership gate
    from backend.services.projects import create_agent
    a = create_agent(
        project_id,
        name=body.name,
        role=body.role or "",
        system_prompt=body.system_prompt or "",
        model_hint=body.model_hint or "",
        color=body.color or "",
        icon=body.icon or "",
        metadata=body.metadata,
        agent_id=body.agent_id,
    )
    if not a:
        raise HTTPException(status_code=404, detail={"error": "project_not_found"})
    return _agent_dict(a)


@router.patch("/{project_id}/agents/{agent_id}")
def update_agent_route(project_id: str, agent_id: str, body: UpdateAgentBody, request: Request) -> dict:
    _ensure_enabled()
    _load_project_or_403(request, project_id)   # ownership gate
    from backend.services.projects import update_agent
    a = update_agent(
        agent_id,
        name=body.name, role=body.role, system_prompt=body.system_prompt,
        model_hint=body.model_hint, color=body.color, icon=body.icon,
        metadata=body.metadata,
    )
    if not a or a.project_id != project_id:
        raise HTTPException(status_code=404, detail={"error": "agent_not_found"})
    return _agent_dict(a)


@router.delete("/{project_id}/agents/{agent_id}", status_code=200)
def delete_agent_route(project_id: str, agent_id: str, request: Request) -> dict:
    _ensure_enabled()
    _load_project_or_403(request, project_id)   # ownership gate
    from backend.services.projects import delete_agent
    ok = delete_agent(agent_id)
    return {"deleted": ok, "agent_id": agent_id}


# ── Thread bindings ────────────────────────────────────────────────────────

@router.post("/{project_id}/threads", status_code=201)
def attach_thread_route(project_id: str, body: AttachThreadBody, request: Request) -> dict:
    _ensure_enabled()
    _load_project_or_403(request, project_id)   # ownership gate
    from backend.services.projects import attach_thread
    ok = attach_thread(project_id, body.thread_id)
    if not ok:
        raise HTTPException(status_code=404, detail={"error": "project_not_found"})
    return {"attached": True, "project_id": project_id, "thread_id": body.thread_id}


@router.delete("/{project_id}/threads/{thread_id}", status_code=200)
def detach_thread_route(project_id: str, thread_id: str, request: Request) -> dict:
    _ensure_enabled()
    _load_project_or_403(request, project_id)   # ownership gate
    from backend.services.projects import detach_thread
    ok = detach_thread(project_id, thread_id)
    return {"detached": ok, "project_id": project_id, "thread_id": thread_id}


@router.get("/{project_id}/threads")
def list_project_threads_route(project_id: str, request: Request) -> dict:
    _ensure_enabled()
    from backend.services.projects import list_project_threads
    _load_project_or_403(request, project_id)   # ownership gate
    rows = list_project_threads(project_id)
    return {
        "threads": [
            {"project_id": r.project_id, "thread_id": r.thread_id, "added_at": r.added_at}
            for r in rows
        ],
    }
