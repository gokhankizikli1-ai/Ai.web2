# coding: utf-8
"""
v2 admin routes — Owner / Admin Mode.

Endpoints (all under /v2/admin/*, all require owner identity unless
noted otherwise):

  GET  /v2/admin/status         Owner detection probe. The frontend
                                calls this on first load to decide
                                whether to render the Admin badge and
                                Admin Panel. ALWAYS returns 200 — the
                                payload says is_owner=true|false.

  GET  /v2/admin/diagnostics    Deployment / provider / routing /
                                background-task snapshot. Owner-only.

  GET  /v2/admin/agents         List of internal/hidden agents the
                                owner can run. Today: returns the
                                public registry; reserved for the
                                future internal-agent registry.

  GET  /v2/admin/memory         Project memory inspector — recent
                                rows from the memory subsystem.

  GET  /v2/admin/tools/history  Recent tool calls (last N).

  GET  /v2/admin/prompts        Prompt / version inspector.

  GET  /v2/admin/audit          Recent admin audit log entries.

  POST /v2/admin/owner-agent    Owner Agent invocation. Body:
                                {"message": "...", "capability": "...",
                                 "history": [...]}.

The router is wired into the app at import time but only mounts if
`settings.ENABLE_ADMIN_MODE` is True at import time (see api.py).
That means:
  - flag off → import never happens → routes return 404 from FastAPI
    natively (zero footprint).
  - flag on  → routes mount; per-request owner gating happens in
    require_owner; non-owners get a 401/403 envelope (NEVER a 404).
"""
from __future__ import annotations

import logging
import os
import platform
import sys
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from backend.core.config import settings
from backend.core.deps import current_user, require_owner, _extract_owner_token
from backend.core.errors import ApiError, UnauthorizedError, ValidationError
from backend.core.responses import ok as envelope_ok
from backend.services.admin import audit, owner_agent
from backend.services.admin.owner import (
    detection_debug, is_owner, log_detection, match_owner_token,
    owner_capabilities,
)
from backend.services.auth.identity import User


logger = logging.getLogger(__name__)


router = APIRouter(prefix="/v2/admin", tags=["admin"])


# ── helpers ───────────────────────────────────────────────────────────────

def _client_ip(request: Request) -> Optional[str]:
    try:
        return request.client.host if request.client else None
    except Exception:
        return None


def _audit(
    user: User,
    action: str,
    request: Request,
    *,
    status: str = "ok",
    metadata: Optional[Dict[str, Any]] = None,
) -> None:
    """Best-effort audit emission. Never raises — the route layer must
    keep working even if the audit DB is unavailable."""
    try:
        # Pull email best-effort from the user model.
        email: Optional[str] = None
        if user.kind == "email" and user.external_id.startswith("email:"):
            email = user.external_id[len("email:"):]
        elif isinstance(getattr(user, "metadata", None), dict):
            v = user.metadata.get("email")
            if isinstance(v, str):
                email = v
        audit.record(
            user_id=user.id,
            user_email=email,
            action=action,
            status=status,
            path=str(request.url.path) if request.url else None,
            ip=_client_ip(request),
            metadata=metadata or {},
        )
    except Exception as exc:
        logger.warning("admin audit emit failed: %s", exc)


def _flag(name: str) -> bool:
    return os.getenv(name, "false").strip().lower() == "true"


# ── /v2/admin/status ───────────────────────────────────────────────────────

@router.get("/status")
async def admin_status(
    request: Request,
    user: User = Depends(current_user),
) -> dict:
    """Frontend probe. Always 200. The payload tells the caller whether
    they're the owner (so the UI can decide to render the badge).

    Two unlock paths are checked:
      - identity-based (user from request.state.user)
      - token-based  (X-Korvix-Owner-Token header matches OWNER_TOKEN)

    Auth gating note: this endpoint deliberately does NOT use
    require_owner. A non-owner asking "am I the owner?" must be able
    to receive a clean `is_owner: false`, not a 401 — otherwise every
    page that wants the badge would have to handle the 401 path.

    Debug field:
      - Owners always get `data.debug` populated so a misconfigured
        env is immediately visible in the panel.
      - Non-owners get `data.debug` ONLY when ENABLE_ADMIN_DEBUG is
        set on the backend; otherwise the field is omitted (no leak).
        This lets an operator temporarily debug production without
        leaving the diagnostic surface permanently exposed.
    """
    owner_token = _extract_owner_token(request)
    token_present = bool(owner_token)
    token_matches = token_present and match_owner_token(owner_token)

    caps = owner_capabilities(user, owner_token=owner_token)

    log_detection(
        user, caps["is_owner"],
        token_present=token_present,
        token_match=token_matches,
    )

    # Audit BOTH success and failed unlock attempts. A failed token
    # attempt is a high-signal forensic event — someone is probing.
    # Successful attempts already had an audit row before this change;
    # the new "denied" row is the additive piece.
    if caps["is_owner"]:
        _audit(
            user, "admin.status.granted", request,
            metadata={"path": "token" if token_matches and not is_owner(user) else "identity"},
        )
    elif token_present:
        # Don't log the token value — only the fact that one was sent
        # and rejected. user.id reveals whether it came from a known
        # guest (browser-stable nonce) or anonymous.
        _audit(
            user, "admin.unlock.denied", request,
            status="denied",
            metadata={
                "token_length": len(owner_token),
                "reason": "token_mismatch_or_unset",
            },
        )

    # Debug payload — only exposed to confirmed owners, or to anyone
    # when ENABLE_ADMIN_DEBUG is set (defaults off).
    data: Dict[str, Any] = dict(caps)
    # A stable human-readable reason on EVERY response — owners and
    # non-owners both need this. For non-owners it's "ok" or the
    # specific failure ("ENABLE_ADMIN_MODE=false on backend", etc.)
    # so the modal can show a clear error. The detail-rich debug
    # object remains gated by the flag above.
    debug_full = detection_debug(
        user,
        owner_token_present=token_present,
        owner_token_matches=token_matches,
    )
    data["reason"] = (
        "owner_confirmed" if caps["is_owner"] else (debug_full.get("first_failure") or "not_owner")
    )
    if caps["is_owner"] or _flag("ENABLE_ADMIN_DEBUG"):
        data["debug"] = debug_full

    return envelope_ok(
        data=data,
        endpoint="/v2/admin/status",
        admin_mode_flag=_flag("ENABLE_ADMIN_MODE"),
    )


# ── /v2/admin/diagnostics ─────────────────────────────────────────────────

@router.get("/diagnostics")
async def admin_diagnostics(
    request: Request,
    user: User = Depends(require_owner),
) -> dict:
    """Deployment diagnostics. Owner-only."""
    _audit(user, "admin.diagnostics.view", request)

    # Provider / routing / background-task snapshots — best-effort.
    providers: List[Dict[str, Any]] = []
    routing: Dict[str, Any] = {}
    background_tasks: Dict[str, Any] = {}
    try:
        from backend.services.providers import provider_capabilities, describe_routing
        providers = provider_capabilities()
        routing = describe_routing()
    except Exception as exc:
        logger.debug("admin diagnostics provider snapshot failed: %s", exc)

    try:
        from backend.services.tasks import queue_stats
        s = queue_stats()
        background_tasks = {
            "enabled":          s.enabled,
            "worker_alive":     s.worker_alive,
            "queue_size":       s.queue_size,
            "submitted_total":  s.submitted_total,
            "processed_total":  s.processed_total,
            "failed_total":     s.failed_total,
        }
    except Exception as exc:
        logger.debug("admin diagnostics task snapshot failed: %s", exc)

    return envelope_ok(
        data={
            "service":        "korvixai-backend",
            "environment":    settings.ENVIRONMENT,
            "python_version": platform.python_version(),
            "platform":       sys.platform,
            "models": {
                "fast":      settings.MODEL_FAST,
                "strong":    settings.MODEL_STRONG,
                "gemini":    settings.MODEL_GEMINI,
                "anthropic": settings.MODEL_ANTHROPIC,
            },
            "providers":         providers,
            "routing":           routing,
            "background_tasks":  background_tasks,
            "flags": {
                "enable_admin_mode":     _flag("ENABLE_ADMIN_MODE"),
                "enable_auth_v2":        _flag("ENABLE_AUTH_V2"),
                "enable_sessions":       _flag("ENABLE_SESSIONS"),
                "enable_agent":          _flag("ENABLE_AGENT"),
                "enable_tools":          _flag("ENABLE_TOOLS"),
                "enable_web_research":   _flag("ENABLE_WEB_RESEARCH"),
                "enable_market_data":    _flag("ENABLE_MARKET_DATA"),
            },
            "deployment": {
                "commit_sha":  os.getenv("RAILWAY_GIT_COMMIT_SHA", "unknown"),
                "deployed_at": os.getenv("RAILWAY_DEPLOYMENT_CREATED_AT", "unknown"),
                "boot_at":     datetime.now(timezone.utc).isoformat(),
            },
        },
        endpoint="/v2/admin/diagnostics",
    )


# ── /v2/admin/agents ──────────────────────────────────────────────────────

@router.get("/agents")
async def admin_agents(
    request: Request,
    user: User = Depends(require_owner),
) -> dict:
    """List internal / hidden agents the owner can run. Today this
    surfaces the existing public agent capabilities; the registry is
    a forward seam for marked-internal agents."""
    _audit(user, "admin.agents.list", request)
    # Best-effort: surface agent enablement + owner-agent capabilities.
    agent_enabled = _flag("ENABLE_AGENT")
    return envelope_ok(
        data={
            "agent_runtime_enabled": agent_enabled,
            "owner_agent": {
                "capabilities": owner_agent.valid_capabilities(),
            },
            "internal_agents": [
                # Reserved slot for the future internal-agent registry.
                # Today's owner-facing surface is owner_agent only.
            ],
        },
        endpoint="/v2/admin/agents",
    )


# ── /v2/admin/memory ──────────────────────────────────────────────────────

@router.get("/memory")
async def admin_memory(
    request: Request,
    user: User = Depends(require_owner),
    limit: int = 25,
) -> dict:
    """Project memory inspector. Owner-only. Returns recent rows from
    the memory subsystem if available; degrades to {available: false}
    when the legacy memory module isn't importable."""
    _audit(user, "admin.memory.view", request, metadata={"limit": limit})
    rows: List[Dict[str, Any]] = []
    available = False
    try:
        # Legacy memory module exposes get_recent (best-effort import).
        from memory import get_user_history  # type: ignore
        raw = get_user_history(user.id) or []
        rows = [{"role": r, "content": c} for r, c in raw[-max(1, min(limit, 200)):]]
        available = True
    except Exception as exc:
        logger.debug("admin memory inspector unavailable: %s", exc)
    return envelope_ok(
        data={"available": available, "rows": rows, "limit": limit},
        endpoint="/v2/admin/memory",
    )


# ── /v2/admin/tools/history ───────────────────────────────────────────────

@router.get("/tools/history")
async def admin_tool_history(
    request: Request,
    user: User = Depends(require_owner),
    limit: int = 25,
) -> dict:
    """Recent tool calls. Owner-only. Best-effort across whatever the
    tools subsystem exposes today; safe-empty when unavailable."""
    _audit(user, "admin.tools.history", request, metadata={"limit": limit})
    history: List[Dict[str, Any]] = []
    try:
        from backend.services.tools.tool_registry import recent_calls  # type: ignore
        history = list(recent_calls(limit=max(1, min(limit, 200))))
    except Exception as exc:
        logger.debug("admin tool history unavailable: %s", exc)
    return envelope_ok(
        data={"calls": history, "limit": limit},
        endpoint="/v2/admin/tools/history",
    )


# ── /v2/admin/prompts ─────────────────────────────────────────────────────

@router.get("/prompts")
async def admin_prompts(
    request: Request,
    user: User = Depends(require_owner),
) -> dict:
    """Prompt / version inspector. Surfaces the current system prompt
    bodies (by name) so the owner can confirm which version is
    deployed. Best-effort: silently skips a prompt that isn't
    importable.
    """
    _audit(user, "admin.prompts.view", request)
    prompts: Dict[str, str] = {}
    try:
        import prompts as _p
        names = [
            "CHAT_SYSTEM", "CHAT_RULES",
            "FINANCE_SYSTEM", "DROP_SYSTEM",
            "EDUCATION_SYSTEM", "ADVICE_SYSTEM",
            "EMOTIONAL_SYSTEM", "PERSONAL_SYSTEM",
            "EXECUTION_SYSTEM", "PRODUCTIVITY_SYSTEM",
            "CREATIVE_SYSTEM", "STARTUP_SYSTEM",
        ]
        for n in names:
            v = getattr(_p, n, None)
            if isinstance(v, str):
                prompts[n] = v
    except Exception as exc:
        logger.debug("admin prompts inspector unavailable: %s", exc)
    return envelope_ok(
        data={
            "prompts": prompts,
            "owner_agent_capabilities": owner_agent.valid_capabilities(),
        },
        endpoint="/v2/admin/prompts",
    )


# ── /v2/admin/audit ───────────────────────────────────────────────────────

@router.get("/audit")
async def admin_audit_tail(
    request: Request,
    user: User = Depends(require_owner),
    limit: int = 50,
    scope: str = "self",
) -> dict:
    """Recent audit-log entries. Owner-only.

    `scope=self`  → only the calling owner's actions (default).
    `scope=all`   → every owner's actions. With a single owner this is
                    equivalent to `self`, but it's the cleaner API
                    once multiple owners are configured.
    """
    _audit(user, "admin.audit.view", request, metadata={"scope": scope, "limit": limit})
    user_id = user.id if scope != "all" else None
    rows = audit.tail(limit=limit, user_id=user_id)
    return envelope_ok(
        data={"entries": rows, "limit": limit, "scope": scope, "total": audit.count(user_id)},
        endpoint="/v2/admin/audit",
    )


# ── /v2/admin/owner-agent ─────────────────────────────────────────────────

class OwnerAgentBody(BaseModel):
    message:    str = Field(..., min_length=1, max_length=16000)
    capability: str = Field(default="general", max_length=64)
    history:    List[Dict[str, str]] = Field(default_factory=list)
    model:      Optional[str] = Field(default=None, max_length=128)


@router.post("/owner-agent")
async def admin_owner_agent(
    body: OwnerAgentBody,
    request: Request,
    user: User = Depends(require_owner),
) -> dict:
    """Invoke the private Owner Agent. The safety classifier runs
    BEFORE the model is called; blocked requests are audited with
    status='blocked' and never reach the AI provider."""
    if not body.message.strip():
        raise ValidationError("message is required")

    # Truncate history at the route layer so a hostile body can't
    # exhaust memory before we hit the classifier.
    safe_history: List[Dict[str, str]] = []
    for item in (body.history or [])[-50:]:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role", ""))[:32]
        content = str(item.get("content", ""))[:8000]
        if role and content:
            safe_history.append({"role": role, "content": content})

    req = owner_agent.OwnerAgentRequest(
        message=body.message,
        capability=body.capability or "general",
        history=safe_history,
        model=body.model,
    )

    resp = await owner_agent.run(req)

    _audit(
        user,
        "admin.owner_agent.invoke",
        request,
        status=("blocked" if resp.blocked else "ok"),
        metadata={
            "capability":     resp.capability,
            "blocked":        resp.blocked,
            "block_category": resp.block_category or None,
            "safe_cyber":     resp.safe_cyber,
            "model":          resp.model,
            "message_len":    len(body.message),
        },
    )

    return envelope_ok(
        data={
            "reply":          resp.reply,
            "blocked":        resp.blocked,
            "block_category": resp.block_category or None,
            "safe_cyber":     resp.safe_cyber,
            "capability":     resp.capability,
            "model":          resp.model,
            "provider":       resp.provider,
            "metadata":       resp.metadata,
        },
        endpoint="/v2/admin/owner-agent",
    )


__all__ = ["router"]
