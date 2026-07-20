# coding: utf-8
"""
v2 admin — billing webhook diagnostics (PR 1: Webhook Foundation).

Owner-only, read-only visibility into the webhook inbox:

  GET  /v2/admin/billing/stats             Aggregate: totals, counts by
                                           lifecycle status, top event names,
                                           store backend + counters.
  GET  /v2/admin/billing/webhooks          Recent deliveries (metadata only —
                                           no payload). Query: ?limit=&offset=
                                           &status=&event_name=.
  GET  /v2/admin/billing/webhooks/{id}     One delivery's full detail INCLUDING
                                           the stored payload (no-store).

Mounted only when ENABLE_ADMIN_MODE is on (see backend/api.py), same as the
rest of /v2/admin/* — so the surface is undiscoverable (404) when admin mode
is off. Per-request owner gating via the shared owner predicate; a non-owner
gets 401/403, never a 404.

The list projection deliberately EXCLUDES the payload, which can carry
customer PII (emails, names). Only the single-delivery detail endpoint serves
the payload, and only to a verified owner, no-store.
"""
from __future__ import annotations

import logging
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse

from backend.core.deps import current_user, _extract_owner_token
from backend.core.responses import ok as envelope_ok
from backend.middleware.auth import User
from backend.services.admin import audit
from backend.services.admin.owner import is_owner_request
from backend.services.billing import store as billing_store
from backend.services.billing.types import VALID_STATUSES

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v2/admin/billing", tags=["admin-billing"])

# Diagnostics data must never be cached by a shared proxy/browser.
_NO_STORE = {"Cache-Control": "no-store, no-cache, must-revalidate, private"}

# Inbox ids are uuid4 hex (32 lowercase hex chars). Anything else is a
# malformed request → 400, never a store hit.
_EVENT_ID_RE = re.compile(r"^[0-9a-f]{32}$")


def owner_gate(request: Request) -> User:
    """Backend-authoritative owner gate with correct HTTP semantics.

    Reuses the EXISTING owner predicate (no second owner-auth system):
      • unauthenticated (guest, no owner token)   → 401
      • authenticated / tokened but NOT the owner  → 403
      • verified owner                             → the User
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
    try:
        audit.record(
            user_id=getattr(user, "id", None),
            action=action,
            status="ok",
            path=str(request.url.path) if request.url else None,
        )
    except Exception:
        pass


@router.get("/stats")
async def billing_stats(
    request: Request,
    user: User = Depends(owner_gate),
) -> JSONResponse:
    """Aggregate webhook-inbox stats. Owner-only."""
    _audit(user, "admin.billing.stats.view", request)
    data = billing_store.stats()
    data["store"] = billing_store.store_stats()
    return JSONResponse(content=envelope_ok(data), headers=_NO_STORE)


@router.get("/webhooks")
async def billing_webhooks(
    request: Request,
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    status: Optional[str] = Query(default=None, max_length=32),
    event_name: Optional[str] = Query(default=None, max_length=128),
    user: User = Depends(owner_gate),
) -> JSONResponse:
    """Recent webhook deliveries (metadata only, no payload). Owner-only.
    An unknown status filter is rejected 400 rather than silently returning
    nothing."""
    if status is not None and status not in VALID_STATUSES:
        raise HTTPException(status_code=400, detail="unknown status filter")
    _audit(user, "admin.billing.webhooks.view", request)
    events = billing_store.list_events(
        limit=limit, offset=offset, status=status, event_name=event_name,
    )
    items = [e.to_public_dict(include_payload=False) for e in events]
    return JSONResponse(
        content=envelope_ok({"webhooks": items, "count": len(items)}),
        headers=_NO_STORE,
    )


@router.get("/webhooks/{event_id}")
async def billing_webhook_detail(
    event_id: str,
    request: Request,
    user: User = Depends(owner_gate),
) -> JSONResponse:
    """One delivery's full detail incl. the stored payload. Owner-only.
    400 malformed id / 404 unknown delivery."""
    if not _EVENT_ID_RE.match(event_id or ""):
        raise HTTPException(status_code=400, detail="malformed event id")
    event = billing_store.get(event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="webhook event not found")
    _audit(user, "admin.billing.webhook.view", request)
    return JSONResponse(
        content=envelope_ok(event.to_public_dict(include_payload=True)),
        headers=_NO_STORE,
    )


__all__ = ["router"]
