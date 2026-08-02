# coding: utf-8
"""
v2 admin — build-task provider routing readiness (Phase 1).

Owner-only, READ-ONLY visibility into the build-task routing policy
(backend.services.build_routing):

  GET  /v2/admin/build-routing   Sanitized policy snapshot: active routing mode,
                                 policy version, per-task shadow targets
                                 (provider/model/reason), whether the Anthropic
                                 provider is configured (boolean only), the
                                 configured Claude model id, and bounded shadow
                                 decision counters.

Phase 1 is decision-only: this view NEVER triggers a provider call and mutates
nothing. It exposes NO secrets (the Anthropic API key is reported only as a
boolean), NO prompts, NO user content, NO PII.

Mounted only when ENABLE_ADMIN_MODE is on (see backend/api.py), same as the rest
of /v2/admin/* — so the surface is undiscoverable (404) when admin mode is off.
Per-request owner gating via the shared owner predicate; a non-owner gets
401/403, never a 404. This is NOT a public diagnostic endpoint.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse

from backend.core.deps import current_user, _extract_owner_token
from backend.core.responses import ok as envelope_ok
from backend.middleware.auth import User
from backend.services.admin import audit
from backend.services.admin.owner import is_owner_request

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v2/admin/build-routing", tags=["admin-build-routing"])

# Diagnostics must never be cached by a shared proxy/browser.
_NO_STORE = {"Cache-Control": "no-store, no-cache, must-revalidate, private"}


def owner_gate(request: Request) -> User:
    """Backend-authoritative owner gate with correct HTTP semantics. Reuses the
    EXISTING owner predicate (no second owner-auth system):

      • unauthenticated (guest, no owner token)   → 401
      • authenticated / tokened but NOT the owner  → 403
      • verified owner                             → the User

    Never trusts a client-sent owner flag/badge — identity comes from backend
    auth + the constant-time owner-token compare inside is_owner_request.
    """
    try:
        user = current_user(request)
    except Exception:
        raise HTTPException(status_code=401, detail="authentication required")
    token = _extract_owner_token(request)
    if is_owner_request(user, owner_token=token):
        return user
    presented_credential = bool(token) or (user is not None and not user.is_guest)
    if presented_credential:
        raise HTTPException(status_code=403, detail="owner privileges required")
    raise HTTPException(status_code=401, detail="authentication required")


def _audit(user: User, action: str, request: Request) -> None:
    """Best-effort audit emission — never raises into the route path."""
    try:
        audit.record(
            user_id=getattr(user, "id", None),
            action=action,
            status="ok",
            path=str(request.url.path) if request.url else None,
        )
    except Exception:
        pass


@router.get("")
async def build_routing_readiness(
    request: Request,
    user: User = Depends(owner_gate),
) -> JSONResponse:
    """Sanitized build-task routing policy snapshot. Owner-only, read-only.
    Never triggers a provider call; contains no secrets or PII."""
    _audit(user, "admin.build_routing.readiness.view", request)
    try:
        from backend.services import build_routing
        data = build_routing.describe_readiness()
    except Exception as exc:  # pragma: no cover — diagnostics must stay up
        logger.warning("build-routing readiness unavailable: %s", type(exc).__name__)
        data = {"error": "unavailable", "reason": type(exc).__name__}
    return JSONResponse(content=envelope_ok(data), headers=_NO_STORE)


__all__ = ["router"]
