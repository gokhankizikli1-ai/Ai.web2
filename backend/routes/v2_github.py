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
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel, Field

from backend.core.deps import require_auth
from backend.core.responses import err as envelope_err, ok as envelope_ok
from backend.services.auth.identity import User
from backend.services.github import app_api as gh_app
from backend.services.github import config as gh_config
from backend.services.github import setup_state as gh_setup
from backend.services.github import store as gh_store
from backend.services.github import sync as gh_sync
from backend.services.github import webhook as gh_webhook
from backend.services.github.errors import GitHubConfigError, GitHubError
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


def _ensure_install_configured() -> None:
    """Fail closed BEFORE starting the install flow if we cannot complete it: the
    App credentials + a slug (or a full install-URL override) must be present."""
    if not gh_config.install_configured():
        raise HTTPException(
            status_code=503,
            detail={"code": "GITHUB_APP_NOT_CONFIGURED",
                    "message": "GitHub App install flow is not configured "
                               "(GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY / GITHUB_APP_SLUG)."},
        )


def _result_redirect(**params: Any) -> RedirectResponse:
    """Redirect the browser to the FIXED frontend result page (never a URL from
    the request), so the setup callback can never be an open redirect. Outcome is
    conveyed via query params the SPA reads."""
    base = gh_config.frontend_result_base()
    path = gh_config.frontend_result_path()
    sep = "&" if "?" in path else "?"
    url = f"{base}{path}{sep}{urlencode({k: v for k, v in params.items() if v is not None})}"
    return RedirectResponse(url=url, status_code=302, headers=_NO_STORE)


# ── Install flow (real GitHub App installation UX) ───────────────────────────
#
# connect/start → GitHub App install screen → /setup/callback → repo list →
# connect/select. The frontend never supplies an installation id or a repo name;
# both come from the SERVER-VERIFIED pending installation.

@router.post("/projects/{project_id}/connect/start")
def connect_start(
    project_id: str = Path(..., max_length=64),
    user: User = Depends(require_auth),
) -> Dict[str, Any]:
    """Begin a GitHub App installation for a project the caller owns. Mints a
    one-time, ownership-bound state and returns the App install URL for the
    browser to navigate to. No installation id / repo is chosen client-side."""
    _ensure_enabled()
    _ensure_install_configured()
    proj = _require_owned_project(project_id, user)
    try:
        gh_setup.purge_expired()
    except Exception:  # pragma: no cover — never block connect on housekeeping
        pass
    state = gh_setup.create_state(owner_user_id=proj.owner_user_id, project_id=proj.id)
    return envelope_ok(
        data={"install_url": gh_config.install_url(state), "state": state},
        user_id=user.id,
    )


@router.get("/setup/callback")
def setup_callback(
    state: Optional[str] = Query(default=None, max_length=512),
    installation_id: Optional[str] = Query(default=None, max_length=40),
    setup_action: Optional[str] = Query(default=None, max_length=40),
) -> RedirectResponse:
    """GitHub App Setup URL target. GitHub redirects the browser here after an
    install with `?installation_id=&setup_action=&state=`. Identity/target come
    ONLY from the one-time state; the installation_id is VERIFIED server-side, not
    trusted. Redirects to a fixed frontend result page (no open redirect)."""
    if not gh_config.is_enabled():
        return _result_redirect(github="error", reason="disabled")

    # 1. Consume the one-time, owner+project-bound state FIRST.
    consumed = gh_setup.consume(state or "")
    if consumed is None:
        return _result_redirect(github="error", reason="invalid_state")
    project_id = consumed.project_id

    # 2. GitHub may redirect without an id (cancel / request) — nothing to do.
    inst = (installation_id or "").strip()
    if not inst:
        return _result_redirect(github="error", reason="missing_installation",
                                project_id=project_id)

    # 3. Re-validate project ownership (defence in depth against a project
    #    deleted/reassigned mid-flow).
    proj = projects_store.get_project(project_id)
    if proj is None or proj.owner_user_id != consumed.owner_user_id:
        return _result_redirect(github="error", reason="ownership_mismatch",
                                project_id=project_id)

    # 4. NEVER trust the installation_id blindly — prove it belongs to OUR App
    #    and is reachable (App-JWT GET /app/installations/{id}).
    try:
        gh_app.get_installation(inst)
    except GitHubError:
        return _result_redirect(github="error", reason="installation_unverified",
                                project_id=project_id)
    except Exception:  # pragma: no cover — defensive; never leak a stack to a redirect
        return _result_redirect(github="error", reason="server_error",
                                project_id=project_id)

    # 5. Store the VERIFIED pending installation (id only — never a token).
    pending = gh_setup.upsert_pending_installation(
        project_id=project_id, owner_user_id=consumed.owner_user_id, installation_id=inst)
    if pending is None:
        return _result_redirect(github="error", reason="store_failed", project_id=project_id)

    return _result_redirect(github="installed", project_id=project_id)


@router.get("/projects/{project_id}/pending-installation/repositories")
def pending_repositories(
    project_id: str = Path(..., max_length=64),
    user: User = Depends(require_auth),
) -> Dict[str, Any]:
    """Repositories the VERIFIED pending installation for this project can access.
    Owner-only; returns bounded, token-free repo metadata for the connect picker."""
    _ensure_enabled()
    _require_owned_project(project_id, user)
    pending = gh_setup.get_pending_installation(project_id, owner_user_id=user.id)
    if pending is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "NO_PENDING_INSTALL",
                    "message": "No pending GitHub installation for this project. "
                               "Start the connect flow."},
        )
    try:
        repos = gh_app.list_repositories(pending.installation_id)
    except GitHubError:
        raise HTTPException(
            status_code=502,
            detail={"code": "GITHUB_UNAVAILABLE",
                    "message": "Could not list repositories for the installation."},
        )
    return envelope_ok(data={"repositories": repos, "count": len(repos)}, user_id=user.id)


class SelectRepoBody(BaseModel):
    repo_full_name: str = Field(..., min_length=3, max_length=140, description='"owner/repo"')


@router.post("/projects/{project_id}/connect/select")
def connect_select(
    project_id: str = Path(..., max_length=64),
    body: SelectRepoBody = ...,
    user: User = Depends(require_auth),
) -> Dict[str, Any]:
    """Finalize the connection: bind the chosen repo to the project via the
    EXISTING connection store. The installation id comes from the server-verified
    pending install (never the client), and the repo is re-validated server-side
    against the installation's accessible repos before it is stored."""
    _ensure_enabled()
    proj = _require_owned_project(project_id, user)
    pending = gh_setup.get_pending_installation(project_id, owner_user_id=user.id)
    if pending is None:
        raise HTTPException(
            status_code=409,
            detail={"code": "NO_PENDING_INSTALL",
                    "message": "No pending GitHub installation. Start the connect flow."},
        )
    # The selected repo MUST be accessible to the pending installation.
    try:
        repo = gh_app.installation_can_access(pending.installation_id, body.repo_full_name)
    except GitHubError:
        raise HTTPException(
            status_code=502,
            detail={"code": "GITHUB_UNAVAILABLE",
                    "message": "Could not verify the repository against the installation."},
        )
    if repo is None:
        raise HTTPException(
            status_code=400,
            detail={"code": "REPO_NOT_IN_INSTALLATION",
                    "message": "That repository is not accessible to the installation."},
        )
    conn = gh_store.upsert_connection(
        project_id=proj.id, owner_user_id=proj.owner_user_id,
        installation_id=pending.installation_id,
        repo_full_name=repo["full_name"], repo_id=str(repo.get("id") or ""),
    )
    if conn is None:
        # UNIQUE(installation_id, repo) already claimed by a different project.
        raise HTTPException(
            status_code=409,
            detail={"code": "REPO_ALREADY_CONNECTED",
                    "message": "This repo/installation is already connected to another project."},
        )
    gh_setup.delete_pending_installation(project_id)
    return envelope_ok(data={"connection": _conn_public(conn)}, user_id=user.id)


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
