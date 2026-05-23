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

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/projects", tags=["projects"])
logger = logging.getLogger(__name__)


def _enabled() -> bool:
    return os.getenv("ENABLE_PROJECTS", "false").strip().lower() == "true"


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
def list_projects_route(user_id: str, include_archived: bool = False) -> dict:
    _ensure_enabled()
    from backend.services.projects import list_projects
    rows = list_projects(user_id, include_archived=include_archived)
    return {"projects": [_project_dict(p) for p in rows]}


@router.post("", status_code=201)
def create_project_route(body: CreateProjectBody) -> dict:
    _ensure_enabled()
    from backend.services.projects import create_project
    p = create_project(
        body.user_id,
        name=body.name,
        description=body.description or "",
        metadata=body.metadata,
        project_id=body.project_id,
    )
    return _project_dict(p)


@router.get("/{project_id}")
def get_project_route(project_id: str) -> dict:
    _ensure_enabled()
    from backend.services.projects import get_project
    p = get_project(project_id)
    if not p:
        raise HTTPException(status_code=404, detail={"error": "project_not_found"})
    return _project_dict(p)


@router.patch("/{project_id}")
def update_project_route(project_id: str, body: UpdateProjectBody) -> dict:
    _ensure_enabled()
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
def delete_project_route(project_id: str) -> dict:
    _ensure_enabled()
    from backend.services.projects import delete_project
    ok = delete_project(project_id)
    if not ok:
        raise HTTPException(status_code=404, detail={"error": "project_not_found"})
    return {"deleted": True, "project_id": project_id}


# ── Project memory ─────────────────────────────────────────────────────────

@router.get("/{project_id}/memory")
def list_memory_route(
    project_id: str,
    kind: Optional[str] = None,
    limit: int = 50,
    newest_first: bool = True,
) -> dict:
    _ensure_enabled()
    from backend.services.projects import get_project, list_memory
    if not get_project(project_id):
        raise HTTPException(status_code=404, detail={"error": "project_not_found"})
    rows = list_memory(project_id, kind=kind, limit=limit, newest_first=newest_first)
    return {"memory": [_memory_dict(m) for m in rows]}


@router.post("/{project_id}/memory", status_code=201)
def add_memory_route(project_id: str, body: AddMemoryBody) -> dict:
    _ensure_enabled()
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
def delete_memory_route(project_id: str, memory_id: str) -> dict:
    _ensure_enabled()
    from backend.services.projects import delete_memory
    ok = delete_memory(memory_id)
    return {"deleted": ok, "memory_id": memory_id}


# ── Project agents ─────────────────────────────────────────────────────────

@router.get("/{project_id}/agents")
def list_agents_route(project_id: str) -> dict:
    _ensure_enabled()
    from backend.services.projects import get_project, list_agents
    if not get_project(project_id):
        raise HTTPException(status_code=404, detail={"error": "project_not_found"})
    rows = list_agents(project_id)
    return {"agents": [_agent_dict(a) for a in rows]}


@router.post("/{project_id}/agents", status_code=201)
def create_agent_route(project_id: str, body: CreateAgentBody) -> dict:
    _ensure_enabled()
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
def update_agent_route(project_id: str, agent_id: str, body: UpdateAgentBody) -> dict:
    _ensure_enabled()
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
def delete_agent_route(project_id: str, agent_id: str) -> dict:
    _ensure_enabled()
    from backend.services.projects import delete_agent
    ok = delete_agent(agent_id)
    return {"deleted": ok, "agent_id": agent_id}


# ── Thread bindings ────────────────────────────────────────────────────────

@router.post("/{project_id}/threads", status_code=201)
def attach_thread_route(project_id: str, body: AttachThreadBody) -> dict:
    _ensure_enabled()
    from backend.services.projects import attach_thread
    ok = attach_thread(project_id, body.thread_id)
    if not ok:
        raise HTTPException(status_code=404, detail={"error": "project_not_found"})
    return {"attached": True, "project_id": project_id, "thread_id": body.thread_id}


@router.delete("/{project_id}/threads/{thread_id}", status_code=200)
def detach_thread_route(project_id: str, thread_id: str) -> dict:
    _ensure_enabled()
    from backend.services.projects import detach_thread
    ok = detach_thread(project_id, thread_id)
    return {"detached": ok, "project_id": project_id, "thread_id": thread_id}


@router.get("/{project_id}/threads")
def list_project_threads_route(project_id: str) -> dict:
    _ensure_enabled()
    from backend.services.projects import get_project, list_project_threads
    if not get_project(project_id):
        raise HTTPException(status_code=404, detail={"error": "project_not_found"})
    rows = list_project_threads(project_id)
    return {
        "threads": [
            {"project_id": r.project_id, "thread_id": r.thread_id, "added_at": r.added_at}
            for r in rows
        ],
    }
