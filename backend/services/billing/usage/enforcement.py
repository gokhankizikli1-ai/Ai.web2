# coding: utf-8
"""
Billing usage — quota enforcement (PR 6).

A FastAPI dependency that performs a CONCURRENCY-SAFE quota check BEFORE an
expensive operation: it atomically reserves one unit of a metric and rejects
the request with 429 when the user's plan quota for the period is exhausted.

SAFETY (mirrors the PR-5 feature gate):
  * Dormant by default — when ENABLE_BILLING_USAGE is off, the dependency is a
    NO-OP that allows the request and records nothing. Wiring it onto a route
    changes nothing until metering is enabled.
  * Owners/admins always bypass.
  * Fail-OPEN — any metering error allows the request (logged); a billing bug
    can never take a product feature offline.
  * Unlimited/undefined limit → always allowed (but still counted when
    metering is on, for observability).

Reservation model: this reserves on the ATTEMPT (before the operation). It
counts every attempt that passes the quota. A caller that wants to refund on
downstream failure can call `usage.refund(...)`; the reservation helpers here
expose the resolved user id to make that easy.
"""
from __future__ import annotations

import logging
from typing import Callable, Tuple

from fastapi import HTTPException, Request

from backend.services.billing.usage import config as usage_config
from backend.services.billing.usage import service as usage_service


logger = logging.getLogger(__name__)


def _resolve_uid_and_owner(request: Request) -> Tuple[str, bool]:
    """(effective_user_id, is_owner) via the app's authoritative resolver.
    Never raises."""
    try:
        from backend.core.principal import resolve_principal
        principal = resolve_principal(request)
        return principal.effective_user_id, bool(principal.is_owner)
    except Exception as exc:  # pragma: no cover — identity must not 500 a gate
        logger.warning("quota identity resolution failed: %s", exc)
        return "", False


def enforce_quota(request: Request, metric: str, amount: int = 1) -> None:
    """Reserve `amount` of `metric` for the caller; raise 429 when over quota.
    No-op when metering is dormant / caller is an owner. Fails open on error."""
    if not usage_config.is_enabled():
        return
    try:
        uid, is_owner = _resolve_uid_and_owner(request)
        if is_owner:
            return
        result = usage_service.consume(uid, metric, amount)
    except Exception as exc:  # pragma: no cover — fail open, never break a route
        logger.warning("quota enforcement error for %r: %s — allowing", metric, exc)
        return

    if result.allowed:
        return

    logger.info(
        "quota BLOCK | metric=%s period=%s used=%s limit=%s",
        metric, result.period, result.used, result.limit,
    )
    raise HTTPException(
        status_code=429,
        detail={
            "error": "You have reached your plan's usage limit for this feature.",
            "code": "QUOTA_EXCEEDED",
            "metric": metric,
            "period": result.period,
            "limit": result.limit,
            "used": result.used,
            "remaining": result.remaining,
            "upgrade_required": True,
        },
    )


def require_quota(metric: str, amount: int = 1) -> Callable[[Request], None]:
    """FastAPI dependency factory. Use on a route decorator, typically AFTER
    the feature gate so a non-entitled caller gets 402, not 429:

        @router.post("/run", dependencies=[
            Depends(gating.require_feature(gating.FEATURE_WORKFLOWS)),
            Depends(require_quota(usage.METRIC_WORKFLOW_RUNS)),
        ])
    """
    def _dep(request: Request) -> None:
        enforce_quota(request, metric, amount)
    return _dep


def stats() -> dict:
    return {"enabled": usage_config.is_enabled()}


__all__ = ["enforce_quota", "require_quota", "stats"]
