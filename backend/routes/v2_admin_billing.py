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

Consumer controls (PR 2 — engine + handler framework):

  POST /v2/admin/billing/process           Drain the reprocessable backlog
                                           (reclaims stale processing first).
                                           Body: {"limit": N?}.
  POST /v2/admin/billing/webhooks/{id}/retry
                                           Force-replay a single delivery
                                           (resets it to stored + attempts 0,
                                           then processes it immediately).

Subscription-state projection (PR 3 — read-only truth layer):

  GET  /v2/admin/billing/subscriptions      Projected subscriptions (owner-only,
                                            no-store). Query: ?limit=&offset=
                                            &status=&app_user_id=&customer_id=.
  GET  /v2/admin/billing/subscriptions/{id} One subscription's full projected
                                            state. Query: ?provider=.

Entitlements (PR 4 — read-only query surface):

  GET  /v2/admin/billing/plans              The loaded plan catalog +
                                            provider-id→plan mapping.
  GET  /v2/admin/billing/entitlements/{uid} Effective entitlements for a user
                                            (default plan when none). Optional
                                            ?feature=<key> adds an access
                                            decision.

Usage metering (PR 6 — read-only + owner maintenance):

  GET  /v2/admin/billing/usage/{uid}        Per-metric usage-vs-limit snapshot
                                            for the user's current periods.
  POST /v2/admin/billing/usage/{uid}/reset  Clear a user's counter for a
                                            ?metric= (all periods or ?period=).
  GET  /v2/admin/billing/checkouts          Recent checkout attempts (metadata
                                            only — no checkout URL / secrets).

The GET /stats response is extended with `processor` (config, registered
handlers, queue depth incl. dead-letter count), `subscriptions` (totals +
counts by normalized status), `entitlements` (config + loaded plans),
`feature_gating` (enforcement state + gated features), `usage` (metering
config + metered metrics) and `checkout` (config + variant selectors) blocks.

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
from pydantic import BaseModel, Field

from backend.core.deps import current_user, _extract_owner_token
from backend.core.responses import ok as envelope_ok
from backend.middleware.auth import User
from backend.services.admin import audit
from backend.services.admin.owner import is_owner_request
from backend.services.billing import store as billing_store
from backend.services.billing.processor import service as billing_processor
from backend.services.billing.subscriptions import store as subscription_store
from backend.services.billing.entitlements import service as entitlement_service
from backend.services.billing.entitlements import gating as entitlement_gating
from backend.services.billing.usage import service as usage_service
from backend.services.billing.checkout import service as checkout_service
from backend.services.billing.types import VALID_STATUSES
from backend.services.billing.subscriptions.types import VALID_SUBSCRIPTION_STATUSES

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v2/admin/billing", tags=["admin-billing"])

# Diagnostics data must never be cached by a shared proxy/browser.
_NO_STORE = {"Cache-Control": "no-store, no-cache, must-revalidate, private"}

# Inbox ids are uuid4 hex (32 lowercase hex chars). Anything else is a
# malformed request → 400, never a store hit.
_EVENT_ID_RE = re.compile(r"^[0-9a-f]{32}$")

# Provider subscription ids (Lemon Squeezy mints numeric strings). Bounded,
# conservative charset so a malformed id is 400, never a store hit.
_SUBSCRIPTION_ID_RE = re.compile(r"^[A-Za-z0-9_\-]{1,128}$")

# Our user ids: uuid hex, "guest:<nonce>", "email:<addr>", numeric, etc.
# Bounded, conservative charset so a malformed id is 400.
_USER_ID_RE = re.compile(r"^[A-Za-z0-9:@._\-]{1,200}$")


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
    """Aggregate webhook-inbox stats + consumer view. Owner-only."""
    _audit(user, "admin.billing.stats.view", request)
    data = billing_store.stats()
    data["store"] = billing_store.store_stats()
    # PR 2 — processor view (config, registered handlers, queue depth). Never
    # let a processor-stats hiccup take down the inbox stats.
    try:
        data["processor"] = billing_processor.stats()
    except Exception as exc:  # pragma: no cover — diagnostics must stay up
        logger.warning("billing processor stats failed: %s", exc)
        data["processor"] = {"error": "unavailable"}
    # PR 3 — subscription-state projection view.
    try:
        subs = subscription_store.count_by_status()
        subs["store"] = subscription_store.store_stats()
        data["subscriptions"] = subs
    except Exception as exc:  # pragma: no cover — diagnostics must stay up
        logger.warning("billing subscription stats failed: %s", exc)
        data["subscriptions"] = {"error": "unavailable"}
    # PR 4 — entitlement-layer view (config + loaded plans).
    try:
        data["entitlements"] = entitlement_service.stats()
    except Exception as exc:  # pragma: no cover — diagnostics must stay up
        logger.warning("billing entitlement stats failed: %s", exc)
        data["entitlements"] = {"error": "unavailable"}
    # PR 5 — feature-gating enforcement view.
    try:
        data["feature_gating"] = entitlement_gating.stats()
    except Exception as exc:  # pragma: no cover — diagnostics must stay up
        logger.warning("billing feature-gating stats failed: %s", exc)
        data["feature_gating"] = {"error": "unavailable"}
    # PR 6 — usage metering view.
    try:
        data["usage"] = usage_service.stats()
    except Exception as exc:  # pragma: no cover — diagnostics must stay up
        logger.warning("billing usage stats failed: %s", exc)
        data["usage"] = {"error": "unavailable"}
    # PR 7 — checkout view (config + variant selectors; no secrets).
    try:
        data["checkout"] = checkout_service.stats()
    except Exception as exc:  # pragma: no cover — diagnostics must stay up
        logger.warning("billing checkout stats failed: %s", exc)
        data["checkout"] = {"error": "unavailable"}
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


# ── Consumer controls (PR 2) ─────────────────────────────────────────────────

class DrainBody(BaseModel):
    # Optional per-call override of the drain batch size; clamped server-side
    # to [1, 1000] by the processor. Omit to use BILLING_DRAIN_BATCH_LIMIT.
    limit: Optional[int] = Field(default=None, ge=1, le=1000)


@router.post("/process")
async def billing_process(
    request: Request,
    body: Optional[DrainBody] = None,
    user: User = Depends(owner_gate),
) -> JSONResponse:
    """Drain the reprocessable backlog (reclaims stale `processing` first).
    Owner-only. Returns a content-free summary. When the processor is disabled
    the response reports enabled=false and processes nothing (200, not an
    error — the operator can see why nothing happened)."""
    limit = body.limit if body else None
    _audit(user, "admin.billing.process.drain", request)
    summary = billing_processor.drain(limit=limit)
    return JSONResponse(content=envelope_ok(summary), headers=_NO_STORE)


@router.post("/webhooks/{event_id}/retry")
async def billing_webhook_retry(
    event_id: str,
    request: Request,
    user: User = Depends(owner_gate),
) -> JSONResponse:
    """Force-replay a single delivery (resets it to stored + attempts 0, then
    processes it immediately). Owner-only. 400 malformed id / 404 unknown
    delivery / 409 when the processor is disabled."""
    if not _EVENT_ID_RE.match(event_id or ""):
        raise HTTPException(status_code=400, detail="malformed event id")
    if billing_store.get(event_id) is None:
        raise HTTPException(status_code=404, detail="webhook event not found")
    _audit(user, "admin.billing.webhook.retry", request)
    result = billing_processor.retry_event(event_id)
    if result.outcome == billing_processor.OUTCOME_DISABLED:
        raise HTTPException(status_code=409, detail="billing processor is disabled")
    return JSONResponse(
        content=envelope_ok({
            "event_id": result.event_id,
            "outcome": result.outcome,
            "event_name": result.event_name,
            "error": result.error,
        }),
        headers=_NO_STORE,
    )


# ── Subscription-state projection (PR 3, read-only) ──────────────────────────

@router.get("/subscriptions")
async def billing_subscriptions(
    request: Request,
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    status: Optional[str] = Query(default=None, max_length=32),
    app_user_id: Optional[str] = Query(default=None, max_length=128),
    customer_id: Optional[str] = Query(default=None, max_length=128),
    user: User = Depends(owner_gate),
) -> JSONResponse:
    """List projected subscriptions (owner-only, no-store — rows may include
    customer PII). Filter by normalized status / our app_user_id / provider
    customer_id. An unknown status filter is rejected 400."""
    if status is not None and status not in VALID_SUBSCRIPTION_STATUSES:
        raise HTTPException(status_code=400, detail="unknown subscription status filter")
    _audit(user, "admin.billing.subscriptions.view", request)
    subs = subscription_store.list_subscriptions(
        limit=limit, offset=offset, status=status,
        app_user_id=app_user_id, customer_id=customer_id,
    )
    items = [s.to_dict() for s in subs]
    return JSONResponse(
        content=envelope_ok({"subscriptions": items, "count": len(items)}),
        headers=_NO_STORE,
    )


@router.get("/subscriptions/{subscription_id}")
async def billing_subscription_detail(
    subscription_id: str,
    request: Request,
    provider: str = Query(default="lemon_squeezy", max_length=40),
    user: User = Depends(owner_gate),
) -> JSONResponse:
    """One subscription's full projected state (owner-only, no-store).
    400 malformed id / 404 unknown subscription."""
    if not _SUBSCRIPTION_ID_RE.match(subscription_id or ""):
        raise HTTPException(status_code=400, detail="malformed subscription id")
    sub = subscription_store.get(provider, subscription_id)
    if sub is None:
        raise HTTPException(status_code=404, detail="subscription not found")
    _audit(user, "admin.billing.subscription.view", request)
    return JSONResponse(content=envelope_ok(sub.to_dict()), headers=_NO_STORE)


# ── Entitlements (PR 4, read-only) ───────────────────────────────────────────

@router.get("/plans")
async def billing_plans(
    request: Request,
    user: User = Depends(owner_gate),
) -> JSONResponse:
    """The loaded plan catalog + provider-id→plan mapping (owner-only). Lets an
    operator verify the entitlement configuration without a deploy."""
    _audit(user, "admin.billing.plans.view", request)
    return JSONResponse(content=envelope_ok(entitlement_service.list_plans()), headers=_NO_STORE)


@router.get("/entitlements/{user_id}")
async def billing_entitlements(
    user_id: str,
    request: Request,
    feature: Optional[str] = Query(default=None, max_length=128),
    user: User = Depends(owner_gate),
) -> JSONResponse:
    """Resolve the effective entitlements for a user (owner-only). Optionally
    pass ?feature=<key> to also get the access decision for that feature.
    400 on a malformed user id. Never 404 — a user with no subscription simply
    resolves to the default plan."""
    if not _USER_ID_RE.match(user_id or ""):
        raise HTTPException(status_code=400, detail="malformed user id")
    _audit(user, "admin.billing.entitlements.view", request)
    payload = entitlement_service.get_entitlements(user_id).to_dict()
    if feature:
        payload["decision"] = entitlement_service.check_access(user_id, feature).to_dict()
    return JSONResponse(content=envelope_ok(payload), headers=_NO_STORE)


# ── Usage metering (PR 6) ────────────────────────────────────────────────────

@router.get("/usage/{user_id}")
async def billing_usage(
    user_id: str,
    request: Request,
    user: User = Depends(owner_gate),
) -> JSONResponse:
    """Per-metric usage-vs-limit snapshot for a user's current periods
    (owner-only, read-only). 400 on a malformed user id."""
    if not _USER_ID_RE.match(user_id or ""):
        raise HTTPException(status_code=400, detail="malformed user id")
    _audit(user, "admin.billing.usage.view", request)
    return JSONResponse(content=envelope_ok(usage_service.snapshot(user_id)), headers=_NO_STORE)


@router.post("/usage/{user_id}/reset")
async def billing_usage_reset(
    user_id: str,
    request: Request,
    metric: str = Query(..., min_length=1, max_length=64),
    period: Optional[str] = Query(default=None, max_length=16),
    user: User = Depends(owner_gate),
) -> JSONResponse:
    """Clear a user's counter for a metric (all periods, or one). Owner-only
    maintenance. 400 on a malformed user id."""
    if not _USER_ID_RE.match(user_id or ""):
        raise HTTPException(status_code=400, detail="malformed user id")
    _audit(user, "admin.billing.usage.reset", request)
    removed = usage_service.reset(user_id, metric, period)
    return JSONResponse(
        content=envelope_ok({"user_id": user_id, "metric": metric,
                             "period": period, "rows_removed": removed}),
        headers=_NO_STORE,
    )


# ── Checkout (PR 7, read-only bounded diagnostics) ───────────────────────────

@router.get("/checkouts")
async def billing_checkouts(
    request: Request,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    user_id: Optional[str] = Query(default=None, max_length=200),
    user: User = Depends(owner_gate),
) -> JSONResponse:
    """Recent checkout attempts (owner-only, no-store). Metadata only — the
    checkout URL (which carries a token) is deliberately EXCLUDED; no secrets."""
    if user_id is not None and not _USER_ID_RE.match(user_id):
        raise HTTPException(status_code=400, detail="malformed user id")
    _audit(user, "admin.billing.checkouts.view", request)
    records = checkout_service.list_recent(limit=limit, offset=offset, user_id=user_id)
    items = [r.to_public_dict(include_url=False) for r in records]
    return JSONResponse(
        content=envelope_ok({"checkouts": items, "count": len(items)}),
        headers=_NO_STORE,
    )


__all__ = ["router"]
