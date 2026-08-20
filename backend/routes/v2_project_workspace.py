# coding: utf-8
"""/v2/projects/{id}/… — the Project Workspace WRITE surface.

WHAT LIVES HERE
---------------
The Project page is read through ONE bounded snapshot
(`GET /v2/projects/{id}/workspace`, in `v2_brain.py`). This module is its
mutating counterpart, and nothing else:

    tasks       GET / POST / PATCH / DELETE   the user's own project tasks
    knowledge   GET / POST / DELETE           durable decisions + knowledge
    seen        POST                          "I have looked at this project"
    feed prefs  GET / PUT                     how THIS user wants THIS project's
                                              activity feed presented

The two GETs exist only for the dedicated Tasks and Knowledge views, which the
user opens deliberately; the Overview still mounts with a single request and
never fans out.

WHAT THESE ROUTES CANNOT DO
---------------------------
Nothing here starts a run, records a candidate action, requests an approval,
calls a provider or spends a model token. A project task is ORGANIZATIONAL
STATE — a note about intent — and creating one is not permission to execute
anything. The Business Brain lifecycle (observation → candidate → prioritization
→ plan → approval → execution) is untouched, and none of these handlers is an
entrance to it.

IDENTITY AND OWNERSHIP
----------------------
The caller is whoever server auth says they are (`Depends(current_user)`); a
`user_id` in a body, query string or header is never read and never trusted.
Every handler re-resolves the project through the SAME canonical gate the
workspace read uses (`project_workspace.owned_project`) on every request — a
project that does not exist and a project belonging to someone else produce the
IDENTICAL 404, so existence is never revealed. Beyond that gate, each store
filters on `owner_user_id` (tasks) or on `project_id` (knowledge) again, so a
row from another account or another project cannot be read, edited or removed
even through a project the caller does own.

Deliberately NOT gated on `ENABLE_PROJECT_BRAIN`, for the same reason the
workspace read is not: a project's own tasks and decisions exist whether or not
the Project Brain is switched on.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from pydantic import BaseModel, Field, constr

from backend.core.deps import current_user
from backend.core.responses import ok as envelope_ok
from backend.services.auth.identity import User
from backend.services.project_brain import workspace as project_workspace
from backend.services.projects import feed_prefs_store
from backend.services.projects import knowledge as knowledge_mod
from backend.services.projects import tasks_store, views_store

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v2/projects", tags=["project-workspace-v2"])

#: The one answer for "not yours" and "not there". Never say which.
_NOT_FOUND = {"code": "PROJECT_NOT_FOUND", "message": "Project not found."}
_TASK_NOT_FOUND = {"code": "TASK_NOT_FOUND", "message": "Task not found."}
_KNOWLEDGE_NOT_FOUND = {"code": "KNOWLEDGE_NOT_FOUND",
                        "message": "Knowledge item not found."}


def _gate(user: User, project_id: str) -> None:
    """Resolve the project through the canonical record, or 404. Called at the
    top of EVERY handler — never cached, never inferred from a previous call."""
    if project_workspace.owned_project(str(user.id), str(project_id)) is None:
        raise HTTPException(status_code=404, detail=_NOT_FOUND)


# ══════════════════════════════════════════════════════════════════════════
# Tasks
# ══════════════════════════════════════════════════════════════════════════

class CreateTaskBody(BaseModel):
    title: str = Field(..., min_length=1, max_length=tasks_store.MAX_TITLE)
    details: str = Field("", max_length=tasks_store.MAX_DETAILS)
    status: str = Field(tasks_store.STATUS_TODO, max_length=20)
    priority: Optional[int] = Field(None, ge=1, le=3)
    #: Provenance only. It records WHERE the user captured the task from; it
    #: never grants the task any behaviour.
    source: str = Field(tasks_store.SOURCE_USER, max_length=20)
    origin_ref: str = Field("", max_length=tasks_store.MAX_ORIGIN_REF)


class UpdateTaskBody(BaseModel):
    """Every field optional — an omitted field is left exactly as it was."""
    title: Optional[str] = Field(None, min_length=1, max_length=tasks_store.MAX_TITLE)
    details: Optional[str] = Field(None, max_length=tasks_store.MAX_DETAILS)
    status: Optional[str] = Field(None, max_length=20)
    priority: Optional[int] = Field(None, ge=1, le=3)


@router.get("/{project_id}/tasks")
def list_tasks(
    project_id: str = Path(..., max_length=64),
    status: str = Query("", max_length=20,
                        description="Optional single status filter."),
    limit: int = Query(tasks_store.MAX_LIMIT, ge=1, le=tasks_store.MAX_LIMIT),
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    """This project's tasks for THIS user, in the store's canonical order
    (doing → todo → waiting → done, then priority, then oldest first). Bounded
    by construction — `limit` is clamped in the store as well as here."""
    _gate(user, project_id)
    statuses: Optional[List[str]] = [status] if status.strip() else None
    items = tasks_store.list_tasks(project_id, owner_user_id=str(user.id),
                                   statuses=statuses, limit=limit)
    return envelope_ok(
        data={"tasks": items,
              "counts": tasks_store.count_by_status(project_id,
                                                    owner_user_id=str(user.id))},
        endpoint=f"/v2/projects/{project_id}/tasks", user_id=user.id,
    )


@router.post("/{project_id}/tasks", status_code=201)
def create_task(
    project_id: str = Path(..., max_length=64),
    body: CreateTaskBody = ...,
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    """Create ONE project task. This is an explicit user action and nothing
    else: it starts no run, proposes no candidate action and asks for no
    approval. The owner is taken from server auth, never from the body."""
    _gate(user, project_id)
    task = tasks_store.create_task(
        project_id=project_id, owner_user_id=str(user.id), title=body.title,
        details=body.details, status=body.status,
        priority=(tasks_store.PRIORITY_NORMAL if body.priority is None
                  else body.priority),
        source=body.source, origin_ref=body.origin_ref,
    )
    if task is None:
        raise HTTPException(
            status_code=400,
            detail={"code": "TASK_INVALID", "message": "A task needs a title."})
    return envelope_ok(data={"task": task},
                       endpoint=f"/v2/projects/{project_id}/tasks",
                       user_id=user.id)


@router.patch("/{project_id}/tasks/{task_id}")
def update_task(
    project_id: str = Path(..., max_length=64),
    task_id: str = Path(..., max_length=64),
    body: UpdateTaskBody = ...,
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    """Rename a task, edit its detail, move it between the four states, or
    change its priority. `completed_at` is maintained by the store from the
    status, never accepted from the client, so the two can never disagree.

    A task that is not in THIS project and owned by THIS user is 404 — the same
    answer a nonexistent id gets."""
    _gate(user, project_id)
    if all(v is None for v in (body.title, body.details, body.status, body.priority)):
        # Nothing to change — return current state rather than touching
        # `updated_at`, which would make an empty PATCH look like activity.
        current = tasks_store.get_task(task_id, project_id=project_id,
                                       owner_user_id=str(user.id))
        if current is None:
            raise HTTPException(status_code=404, detail=_TASK_NOT_FOUND)
        return envelope_ok(data={"task": current},
                           endpoint=f"/v2/projects/{project_id}/tasks/{task_id}",
                           user_id=user.id)
    task = tasks_store.update_task(
        task_id, project_id=project_id, owner_user_id=str(user.id),
        title=body.title, details=body.details, status=body.status,
        priority=body.priority,
    )
    if task is None:
        raise HTTPException(status_code=404, detail=_TASK_NOT_FOUND)
    return envelope_ok(data={"task": task},
                       endpoint=f"/v2/projects/{project_id}/tasks/{task_id}",
                       user_id=user.id)


@router.delete("/{project_id}/tasks/{task_id}")
def delete_task(
    project_id: str = Path(..., max_length=64),
    task_id: str = Path(..., max_length=64),
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    """Remove a task from the user's view. Implemented as a soft archive in the
    store — the row stops being returned by every read, which is the whole of
    the user-visible effect."""
    _gate(user, project_id)
    if not tasks_store.archive_task(task_id, project_id=project_id,
                                    owner_user_id=str(user.id)):
        raise HTTPException(status_code=404, detail=_TASK_NOT_FOUND)
    return envelope_ok(data={"deleted": True, "task_id": task_id},
                       endpoint=f"/v2/projects/{project_id}/tasks/{task_id}",
                       user_id=user.id)


# ══════════════════════════════════════════════════════════════════════════
# Knowledge
# ══════════════════════════════════════════════════════════════════════════

class AddKnowledgeBody(BaseModel):
    kind: str = Field(..., max_length=20)
    text: str = Field(..., min_length=1, max_length=knowledge_mod.MAX_TEXT)


@router.get("/{project_id}/knowledge")
def list_knowledge(
    project_id: str = Path(..., max_length=64),
    kind: str = Query("", max_length=20,
                      description="Optional single kind filter."),
    limit: int = Query(knowledge_mod.MAX_LIMIT, ge=1,
                       le=knowledge_mod.MAX_LIMIT),
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    """Durable project knowledge, newest first — a PROJECTION over the existing
    decision and project-memory authorities. Reading it promotes nothing and
    writes nothing."""
    _gate(user, project_id)
    # ONE row read of both authorities serves the (optionally filtered, always
    # bounded) list; the counts are a separate EXACT aggregate, so a project
    # past the cap reports what it really holds instead of the cap.
    everything = knowledge_mod.list_knowledge(project_id,
                                              limit=knowledge_mod.MAX_LIMIT)
    wanted = knowledge_mod.normalize_kind(kind) if kind.strip() else ""
    items = [i for i in everything if not wanted or i["kind"] == wanted][:limit]
    return envelope_ok(
        data={"knowledge": items,
              "counts": knowledge_mod.count_by_kind(project_id)},
        endpoint=f"/v2/projects/{project_id}/knowledge", user_id=user.id,
    )


@router.post("/{project_id}/knowledge", status_code=201)
def add_knowledge(
    project_id: str = Path(..., max_length=64),
    body: AddKnowledgeBody = ...,
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    """Record ONE knowledge item — an explicit user action, always. A decision
    lands in the canonical decision authority (so a later build receives it); a
    requirement / constraint / fact / note lands in the project's own curated
    memory. Nothing is ever extracted from a conversation automatically."""
    _gate(user, project_id)
    item = knowledge_mod.add_knowledge(project_id=project_id,
                                       user_id=str(user.id), kind=body.kind,
                                       text=body.text)
    if item is None:
        raise HTTPException(
            status_code=400,
            detail={"code": "KNOWLEDGE_INVALID",
                    "message": "A knowledge item needs a known kind and text."})
    return envelope_ok(data={"item": item},
                       endpoint=f"/v2/projects/{project_id}/knowledge",
                       user_id=user.id)


@router.delete("/{project_id}/knowledge/{knowledge_id}")
def remove_knowledge(
    project_id: str = Path(..., max_length=64),
    knowledge_id: str = Path(..., max_length=120),
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    """Remove a knowledge item the CALLER recorded. An item authored by a build,
    research capability, agent or the system is not the user's to remove here
    and answers 404 — the same answer an unknown id, or an id from another
    project, gets."""
    _gate(user, project_id)
    if not knowledge_mod.remove_knowledge(project_id=project_id,
                                          user_id=str(user.id),
                                          knowledge_id=knowledge_id):
        raise HTTPException(status_code=404, detail=_KNOWLEDGE_NOT_FOUND)
    return envelope_ok(
        data={"deleted": True, "knowledge_id": knowledge_id},
        endpoint=f"/v2/projects/{project_id}/knowledge/{knowledge_id}",
        user_id=user.id,
    )


# ══════════════════════════════════════════════════════════════════════════
# "I have seen this" — the ONLY thing that moves the last-visit marker
# ══════════════════════════════════════════════════════════════════════════

class SeenBody(BaseModel):
    """`seen_through` is the `freshness.generated_at` of the snapshot the user
    actually saw. Sending it means the marker lands exactly where the rendered
    list was computed, so a change that arrived between the read and this
    acknowledgement is still new next time. It is a HINT: the store clamps it to
    the previously stored marker on one side and to server `now` on the other,
    so a client can neither rewind the marker nor push it into the future."""
    seen_through: str = Field("", max_length=64)


@router.post("/{project_id}/workspace/seen")
def mark_workspace_seen(
    project_id: str = Path(..., max_length=64),
    body: SeenBody = SeenBody(),
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    """Record that this user has looked at this project.

    This is VIEWING METADATA and nothing else: it writes one row in one table
    that only this feature reads. It creates no observation, no activity row and
    no project state, so how often a project is opened can never be mistaken for
    what the project IS."""
    _gate(user, project_id)
    marker = views_store.mark_viewed(str(user.id), project_id,
                                     seen_through=body.seen_through)
    return envelope_ok(
        data={"last_viewed_at": marker},
        endpoint=f"/v2/projects/{project_id}/workspace/seen", user_id=user.id,
    )


# ══════════════════════════════════════════════════════════════════════════
# Feed presentation preferences
#
# PRESENTATION ONLY. These two routes read and write ONE thing: which sources
# this user wants prominent, ordinary or absent in THIS project's activity feed.
#
# They cannot delete an observation, change what a connector ingests, or reach
# Project Intelligence, candidate synthesis, the action prioritizer, the
# Business Brain, execution policy, approvals or durable memory — none of which
# read the preference store at all (see its module docstring). A user who hides
# Vercel and then has a production outage still sees that outage in Needs
# Attention, and the Brain still prioritizes it, because the ranking is computed
# from the observations and never from this.
# ══════════════════════════════════════════════════════════════════════════

class FeedPreferencesBody(BaseModel):
    """The WHOLE map, replaced atomically. A partial patch would let two
    Customize panels open in two tabs interleave into a state neither user
    chose; a replace makes the last Save the answer, and makes pressing Save
    twice a no-op.

    Unknown sources are dropped and unknown values read as `normal`, so a stale
    client cannot blank somebody's feed with a typo.

    Both the KEY and the VALUE are length-bounded here, and the store refuses to
    walk more than `MAX_INPUT_ENTRIES` of them, so a request that is cheap to
    send stays cheap to process."""
    preferences: Dict[
        constr(max_length=feed_prefs_store.MAX_SOURCE),
        constr(max_length=32),
    ] = Field(default_factory=dict,
              max_length=feed_prefs_store.MAX_INPUT_ENTRIES)


def _feed_prefs_payload(user: User, project_id: str,
                        preferences: Dict[str, str]) -> Dict[str, Any]:
    """What both routes return: the stored choices, plus the vocabulary and the
    source list the panel renders from — so the frontend never hardcodes a
    provider list that would go stale the day a sixth connector ships."""
    return {
        "preferences": preferences,
        "sources":     list(feed_prefs_store.known_sources()),
        "values":      list(feed_prefs_store.PREFERENCES),
        "default":     feed_prefs_store.PREF_NORMAL,
    }


@router.get("/{project_id}/feed-preferences")
def get_feed_preferences(
    project_id: str = Path(..., max_length=64),
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    """This user's feed preferences for this project. A user who has never
    customised anything gets an empty map — the truthful "everything is on the
    default" state, not a fabricated row per source."""
    _gate(user, project_id)
    return envelope_ok(
        data=_feed_prefs_payload(
            user, project_id,
            feed_prefs_store.get_preferences(str(user.id), str(project_id))),
        endpoint=f"/v2/projects/{project_id}/feed-preferences", user_id=user.id,
    )


@router.put("/{project_id}/feed-preferences")
def set_feed_preferences(
    project_id: str = Path(..., max_length=64),
    body: FeedPreferencesBody = ...,
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    """Replace this user's feed preferences for this project.

    The owner is server auth, always: a `user_id` in the body is neither read
    nor trusted, so one account can never write another's view preference even
    for a project they both somehow named."""
    _gate(user, project_id)
    stored = feed_prefs_store.set_preferences(str(user.id), str(project_id),
                                              body.preferences or {})
    return envelope_ok(
        data=_feed_prefs_payload(user, project_id, stored),
        endpoint=f"/v2/projects/{project_id}/feed-preferences", user_id=user.id,
    )


__all__ = ["router"]
