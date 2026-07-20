# coding: utf-8
"""
Billing entitlements — feature gating (PR 5).

Connects the read-only entitlement truth layer (PR 4) to real product routes:
a FastAPI dependency that blocks a paid feature when the caller's plan does not
include it. Uses the existing `check_access` / `has_feature` query API — it
adds NO metering, credit consumption, quota counters, checkout or payment.

SAFETY — dormant by default, fail-open, never lock out production:

  Enforcement requires BOTH:
    * ENABLE_BILLING_ENTITLEMENTS=true  (the truth layer resolves real plans)
    * ENABLE_BILLING_FEATURE_GATING=true (this gate actually blocks)

  With either off, every gate is a NO-OP that ALLOWS the request — so wiring a
  gate onto a route changes nothing in production until an operator explicitly
  turns enforcement on. This is deliberate: if the gate blocked while the
  entitlement layer were dormant, every user (resolved to the default/free
  plan) would be locked out of the paid feature. We refuse to enforce without
  plan resolution.

  Additional fail-safes:
    * Owners/admins always bypass the gate.
    * Any unexpected error while evaluating the gate ALLOWS the request (logged)
      — a bug in billing must never take a product feature offline.
"""
from __future__ import annotations

import logging
import os
from typing import Callable, Tuple

from fastapi import HTTPException, Request

from backend.services.billing.entitlements import config as ent_config
from backend.services.billing.entitlements import service as entitlement_service


logger = logging.getLogger(__name__)


# ── Feature-key vocabulary ────────────────────────────────────────────────────
# The capability keys an operator lists in a plan's `features` to grant access
# to the gated product surfaces. Stable string constants so routes and plan
# config agree on one spelling.
FEATURE_WEB_BUILD_IMAGE_GENERATION = "web_build_image_generation"
FEATURE_WEBSITE_RECREATION = "website_recreation"
FEATURE_VISION_ANALYSIS = "vision_analysis"
FEATURE_WORKFLOWS = "workflows"

# The features currently wired to a route (for diagnostics only).
GATED_FEATURES = (
    FEATURE_WEB_BUILD_IMAGE_GENERATION,
    FEATURE_WEBSITE_RECREATION,
    FEATURE_VISION_ANALYSIS,
    FEATURE_WORKFLOWS,
)


def gating_enabled() -> bool:
    """The enforcement switch. Default OFF — gates are no-ops until flipped."""
    return os.getenv("ENABLE_BILLING_FEATURE_GATING", "false").strip().lower() == "true"


def is_enforcing() -> bool:
    """True only when gating should actually block. Requires the truth layer
    to be enabled too, otherwise plan resolution returns the default plan for
    everyone and enforcing would lock all users out."""
    if not gating_enabled():
        return False
    if not ent_config.is_enabled():
        logger.warning(
            "ENABLE_BILLING_FEATURE_GATING is on but ENABLE_BILLING_ENTITLEMENTS "
            "is off — feature gating stays a NO-OP (cannot enforce without plan "
            "resolution; would otherwise block every user on the default plan)."
        )
        return False
    return True


def _resolve_uid_and_owner(request: Request) -> Tuple[str, bool]:
    """Return (effective_user_id, is_owner) using the app's authoritative
    identity resolver. Never raises."""
    try:
        from backend.core.principal import resolve_principal
        principal = resolve_principal(request)
        return principal.effective_user_id, bool(principal.is_owner)
    except Exception as exc:  # pragma: no cover — identity must not 500 a gate
        logger.warning("feature gate identity resolution failed: %s", exc)
        return "", False


def evaluate(request: Request, feature: str) -> Tuple[bool, str, str]:
    """Evaluate a gate WITHOUT raising. Returns (allowed, plan_key, reason).

    Allowed when: enforcement is off (dormant), the caller is an owner, or the
    caller's plan includes `feature`. Fail-open on any unexpected error.
    """
    if not is_enforcing():
        return True, "", "gating_disabled"
    try:
        uid, is_owner = _resolve_uid_and_owner(request)
        if is_owner:
            return True, "owner", "owner_bypass"
        decision = entitlement_service.check_access(uid, feature)
        return decision.allowed, decision.plan_key, decision.reason
    except Exception as exc:  # pragma: no cover — fail open, never break a route
        logger.warning("feature gate evaluation error for %r: %s — allowing", feature, exc)
        return True, "", "gate_error_fail_open"


def enforce_feature(request: Request, feature: str) -> None:
    """Raise 402 when the caller's plan does not include `feature`. No-op when
    enforcement is dormant / the caller is entitled / an owner."""
    allowed, plan_key, reason = evaluate(request, feature)
    if allowed:
        return
    logger.info(
        "feature gate BLOCK | feature=%s plan=%s reason=%s", feature, plan_key, reason,
    )
    raise HTTPException(
        status_code=402,
        detail={
            "error": "This feature is not available on your current plan.",
            "code": "FEATURE_NOT_ENTITLED",
            "feature": feature,
            "plan": plan_key,
            "upgrade_required": True,
        },
    )


def require_feature(feature: str) -> Callable[[Request], None]:
    """FastAPI dependency factory. Use on a route decorator:

        @router.post("/generate", dependencies=[Depends(require_feature(
            gating.FEATURE_WEB_BUILD_IMAGE_GENERATION))])

    It injects Request and enforces the gate before the handler runs. It does
    not change the handler signature.
    """
    def _dep(request: Request) -> None:
        enforce_feature(request, feature)
    return _dep


def request_has_feature(request: Request, feature: str) -> bool:
    """Soft check for routes that conditionally include premium content rather
    than hard-block. Returns True when the feature is available to the caller
    OR when gating is dormant (i.e. the feature is not being restricted), so
    existing behaviour is preserved until enforcement is enabled."""
    allowed, _, _ = evaluate(request, feature)
    return allowed


def stats() -> dict:
    """Diagnostics: enforcement state + the wired feature vocabulary."""
    return {
        "enforcing": is_enforcing(),
        "gating_enabled": gating_enabled(),
        "entitlements_enabled": ent_config.is_enabled(),
        "gated_features": list(GATED_FEATURES),
    }


__all__ = [
    "FEATURE_WEB_BUILD_IMAGE_GENERATION", "FEATURE_WEBSITE_RECREATION",
    "FEATURE_VISION_ANALYSIS", "FEATURE_WORKFLOWS", "GATED_FEATURES",
    "gating_enabled", "is_enforcing", "evaluate", "enforce_feature",
    "require_feature", "request_has_feature", "stats",
]
