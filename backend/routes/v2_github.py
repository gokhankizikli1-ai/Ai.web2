# coding: utf-8
"""/v2/github — GitHub connector (read-only source of Business Brain observations).

Two surfaces, both gated behind `ENABLE_GITHUB_CONNECTOR` (503 when off, so the
route ships dormant and is turned on with a single env flip):

  Project-scoped (authenticated, ownership-enforced — a caller may only touch a
  project they own, resolved from `projects.get_project(...).owner_user_id`):
    POST   /v2/github/projects/{project_id}/connect   link a repo+installation
    GET    /v2/github/projects/{project_id}/connection read the connection
    DELETE /v2/github/projects/{project_id}/connection remove the connection
    POST   /v2/github/projects/{project_id}/sync       run the bounded backfill

  Public webhook (signature-authenticated, NOT user-authenticated):
    POST   /v2/github/webhooks/github                  ingest one delivery

The connector is READ-ONLY toward GitHub: none of these routes can push,
merge, comment, close, rerun, or deploy. Sync/webhook only READ GitHub and
WRITE normalized observations via the canonical ingestion seam.

HTTP contract for the webhook (mirrors the billing webhook):
  200 accepted (recorded / duplicate / ignored)   400 verified-but-bad JSON
  401 invalid signature                            413 payload too large
  503 disabled / not-configured
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Path, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from backend.core.deps import require_auth
from backend.core.responses import err as envelope_err, ok as envelope_ok
from backend.services.auth.identity import User
from backend.services.github import config as gh_config
from backend.services.github import store as gh_store
from backend.services.github import sync as gh_sync
from backend.services.github import webhook as gh_webhook
from backend.services.projects import store as projects_store

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v2/github", tags=["github-connector"])

_NO_STORE = {"Cache-Control": "no-store, no-cache, must-revalidate, private"}

# GitHub webhook delivery headers.
_SIG_HEADER = "X-Hub-Signature-256"
_EVENT_HEADER = "X-GitHub-Event"
_DELIVERY_HEADER = "X-GitHub-Delivery"


def _resp(status: int, body: dict) -> JSONResponse:
    return JSONResponse(status_code=status, content=body, headers=_NO_STORE)


def _ensure_enabled() -> None:
    if not gh_config.is_enabled():
        raise HTTPException(
            status_code=503,
            detail={
                "code": "GITHUB_CONNECTOR_DISABLED",
                "message": "GitHub connector is disabled. Set ENABLE_GITHUB_CONNECTOR=true.",
                "rollback": "Unset ENABLE_GITHUB_CONNECTOR to disable.",
            },
        )


def _require_owned_project(project_id: str, user: User):
    """Return the project IFF `user` owns it, else 404 (never reveal existence
    of another user's project). This is the cross-user isolation gate."""
    proj = projects_store.get_project(project_id)
    if proj is None or proj.owner_user_id != user.id:
        raise HTTPException(
            status_code=404,
            detail={"code": "PROJECT_NOT_FOUND", "message": "Project not found."},
        )
    return proj


# ── Project-scoped connection management ─────────────────────────────────────

class ConnectBody(BaseModel):
    repo_full_name: str = Field(..., min_length=3, max_length=140,
                                description='"owner/repo"')
    installation_id: Optional[str] = Field(
        default=None, max_length=40,
        description="GitHub App installation id. Falls back to "
                    "GITHUB_DEFAULT_INSTALLATION_ID when omitted (dev).")
    repo_id: Optional[str] = Field(default=None, max_length=40)


@router.post("/projects/{project_id}/connect")
def connect_project(
    project_id: str = Path(..., max_length=64),
    body: ConnectBody = ...,
    user: User = Depends(require_auth),
) -> Dict[str, Any]:
    """Link a project to a GitHub repo + installation. Ownership-enforced; the
    stored owner_user_id is the PROJECT's owner, never client-supplied."""
    _ensure_enabled()
    proj = _require_owned_project(project_id, user)

    installation_id = (body.installation_id or "").strip() or gh_config.default_installation_id()
    if not installation_id:
        raise HTTPException(
            status_code=400,
            detail={"code": "INSTALLATION_REQUIRED",
                    "message": "installation_id is required (no GITHUB_DEFAULT_INSTALLATION_ID set)."},
        )
    repo_full = (body.repo_full_name or "").strip().strip("/")
    if repo_full.count("/") != 1:
        raise HTTPException(
            status_code=400,
            detail={"code": "INVALID_REPO", "message": 'repo_full_name must be "owner/repo".'},
        )

    conn = gh_store.upsert_connection(
        project_id=proj.id,
        owner_user_id=proj.owner_user_id,   # authoritative — from the project
        installation_id=installation_id,
        repo_full_name=repo_full,
        repo_id=(body.repo_id or "").strip(),
    )
    if conn is None:
        # UNIQUE(installation_id, repo) already claimed by a different project.
        raise HTTPException(
            status_code=409,
            detail={"code": "REPO_ALREADY_CONNECTED",
                    "message": "This repo/installation is already connected to another project."},
        )
    return envelope_ok(data={"connection": _conn_public(conn)}, user_id=user.id)


@router.get("/projects/{project_id}/connection")
def get_project_connection(
    project_id: str = Path(..., max_length=64),
    user: User = Depends(require_auth),
) -> Dict[str, Any]:
    _ensure_enabled()
    _require_owned_project(project_id, user)
    conn = gh_store.get_connection(project_id)
    return envelope_ok(
        data={"connection": _conn_public(conn) if conn else None,
              "connected": conn is not None},
        user_id=user.id,
    )


@router.delete("/projects/{project_id}/connection")
def delete_project_connection(
    project_id: str = Path(..., max_length=64),
    user: User = Depends(require_auth),
) -> Dict[str, Any]:
    _ensure_enabled()
    _require_owned_project(project_id, user)
    removed = gh_store.delete_connection(project_id)
    return envelope_ok(data={"removed": removed}, user_id=user.id)


@router.post("/projects/{project_id}/sync")
def sync_project(
    project_id: str = Path(..., max_length=64),
    user: User = Depends(require_auth),
) -> Dict[str, Any]:
    """Run the bounded initial backfill for a connected project. Records
    observations only — never creates a task/decision/run, never calls a
    model. Partial provider failure is reported truthfully."""
    _ensure_enabled()
    _require_owned_project(project_id, user)
    conn = gh_store.get_connection(project_id)
    if conn is None:
        raise HTTPException(
            status_code=409,
            detail={"code": "NOT_CONNECTED",
                    "message": "Project is not connected to a GitHub repo. Call connect first."},
        )
    report = gh_sync.sync_connection(conn)
    return envelope_ok(data={"sync": report.as_dict()}, user_id=user.id)


def _conn_public(conn) -> Dict[str, Any]:
    """Frontend-safe projection — carries NO secret (there is none stored) and
    no token; just the mapping identity."""
    return {
        "project_id": conn.project_id,
        "installation_id": conn.installation_id,
        "repo_full_name": conn.repo_full_name,
        "repo_id": conn.repo_id,
        "created_at": conn.created_at,
        "updated_at": conn.updated_at,
    }


# ── Public webhook ───────────────────────────────────────────────────────────

async def _read_body_capped(request: Request, max_bytes: int) -> Tuple[Optional[bytes], bool]:
    """Read the body, refusing to buffer more than `max_bytes`. Content-Length
    fast-reject, then a streamed cap. Returns (body, too_large)."""
    declared = request.headers.get("content-length")
    if declared:
        try:
            if int(declared) > max_bytes:
                return None, True
        except (TypeError, ValueError):
            pass
    chunks = []
    total = 0
    async for chunk in request.stream():
        if not chunk:
            continue
        total += len(chunk)
        if total > max_bytes:
            return None, True
        chunks.append(chunk)
    return b"".join(chunks), False


@router.post("/webhooks/github")
async def github_webhook(request: Request) -> JSONResponse:
    """Ingest one GitHub webhook delivery. Signature-authenticated; fails
    closed on a missing secret or bad signature. See module docstring."""
    # 1. Feature gate.
    if not gh_config.is_enabled():
        return _resp(503, envelope_err("github connector disabled", code="GITHUB_CONNECTOR_DISABLED"))

    # 2. Webhook secret must be configured, else we cannot authenticate. Fail
    #    closed (transient) so GitHub retries once the operator sets it.
    secret = gh_config.webhook_secret()
    if not secret:
        logger.error("github webhook rejected: GITHUB_APP_WEBHOOK_SECRET not configured")
        return _resp(503, envelope_err("github webhook not configured", code="GITHUB_NOT_CONFIGURED"))

    # 3. Bounded body read.
    raw_body, too_large = await _read_body_capped(request, gh_config.webhook_max_bytes())
    if too_large:
        return _resp(413, envelope_err("payload too large", code="PAYLOAD_TOO_LARGE"))
    if raw_body is None:
        raw_body = b""

    # 4. Signature verification over RAW bytes (constant-time) — BEFORE parse.
    provided_sig = (request.headers.get(_SIG_HEADER) or "").strip()
    if not gh_webhook.verify_signature(raw_body, provided_sig, secret):
        logger.warning("github webhook rejected: invalid signature")
        return _resp(401, envelope_err("invalid signature", code="INVALID_SIGNATURE"))

    # 5. Only now trust the delivery metadata and hand off to the handler.
    event = (request.headers.get(_EVENT_HEADER) or "").strip()
    delivery_id = (request.headers.get(_DELIVERY_HEADER) or "").strip()
    result = gh_webhook.handle_delivery(raw_body=raw_body, event=event, delivery_id=delivery_id)

    if result.status == "rejected":
        # verified bytes but unparseable/invalid — permanent (400).
        return _resp(400, envelope_err(result.reason or "invalid payload", code="INVALID_PAYLOAD"))
    return _resp(200, envelope_ok(result.as_dict(), duplicate=(result.status == "duplicate")))


__all__ = ["router"]
