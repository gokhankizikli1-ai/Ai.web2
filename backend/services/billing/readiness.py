# coding: utf-8
"""
Billing — Polar CONFIGURATION readiness (PR #525).

A backend-only, READ-ONLY evaluator that reports whether the Polar integration is
CONFIGURED and installed — it makes NO external call, so it is explicitly
*configuration readiness*, NOT provider health/connectivity. It exposes only
booleans + bounded counts + the (non-secret) server name; NEVER tokens, webhook
secrets, product ids or full JSON mappings.

Consumed by the owner-only `GET /v2/admin/billing/readiness` diagnostic. Pure +
fail-open (a check that errors is reported false, never raised).
"""
from __future__ import annotations

import json
import os
from typing import Any, Dict, List

from backend.services.billing import config as billing_config
from backend.services.billing.provider import resolve_provider, provider_selection_error
from backend.services.billing.polar import config as polar_config
from backend.services.billing.checkout import config as checkout_config
from backend.services.billing.checkout import catalog as checkout_catalog
from backend.services.billing.entitlements import config as ent_config
from backend.services.billing.types import PROVIDER_POLAR


def _b(fn) -> bool:
    try:
        return bool(fn())
    except Exception:
        return False


def _polar_variant_count() -> int:
    """Count configured ACTIVE Polar checkout variants that carry a product id.
    Returns a COUNT only — never the product ids."""
    try:
        return sum(
            1 for v in checkout_catalog.all_variants()
            if (v.provider or "").lower() == PROVIDER_POLAR and (v.product_id or "").strip()
        )
    except Exception:
        return 0


def _plan_map_has_polar_ids() -> bool:
    """True when BILLING_PLAN_MAP_JSON contains at least one product:/price: key
    (the Polar mapping shape). Never returns the ids themselves."""
    try:
        raw = ent_config.plan_map_json()
        if not raw.strip():
            return False
        parsed = json.loads(raw)
        if not isinstance(parsed, dict):
            return False
        return any(str(k).startswith("product:") or str(k).startswith("price:") for k in parsed.keys())
    except Exception:
        return False


def _webhook_route_registered() -> bool:
    """True when the Polar webhook route module is importable + exposes a router
    (the #524 code is installed). No network call."""
    try:
        from backend.routes import v2_billing_polar
        return hasattr(v2_billing_polar, "router")
    except Exception:
        return False


def _checkout_client_installed() -> bool:
    try:
        from backend.services.billing.polar import checkout as _c
        return hasattr(_c, "create_checkout")
    except Exception:
        return False


def polar_readiness() -> Dict[str, Any]:
    """Full readiness snapshot. Booleans + counts + server only — no secrets."""
    provider = resolve_provider()
    server = polar_config.server()

    checks: Dict[str, Any] = {
        "server": server,
        "codeInstalled": _webhook_route_registered() and _checkout_client_installed(),
        "billingEnabled": _b(billing_config.is_enabled),
        "checkoutEnabled": _b(checkout_config.is_enabled),
        "accessTokenConfigured": _b(polar_config.access_token),
        "organizationConfigured": _b(polar_config.organization_id),
        "webhookSecretConfigured": _b(polar_config.webhook_secret),
        "checkoutVariantsConfigured": _polar_variant_count() > 0,
        "polarVariantCount": _polar_variant_count(),
        "planMapConfigured": _plan_map_has_polar_ids(),
        "successUrlConfigured": bool((checkout_config.default_return_url() or "").strip())
            or len(checkout_config.allowed_return_hosts()) > 0,
        "webhookRouteRegistered": _webhook_route_registered(),
    }

    # The core configuration required for a Polar checkout → webhook → entitlement loop.
    _required = [
        "billingEnabled", "checkoutEnabled", "accessTokenConfigured",
        "organizationConfigured", "webhookSecretConfigured", "checkoutVariantsConfigured",
        "planMapConfigured", "successUrlConfigured", "webhookRouteRegistered",
    ]
    core_ready = all(bool(checks.get(k)) for k in _required)
    missing: List[str] = [k for k in _required if not bool(checks.get(k))]

    checks["readyForSandboxCheckout"] = core_ready and server == "sandbox"
    checks["readyForProductionCutover"] = core_ready and server == "production"
    checks["missing"] = missing

    out: Dict[str, Any] = {"provider": provider, "polar": checks}
    err = provider_selection_error()
    if err:
        out["providerSelectionError"] = err   # bounded, non-secret
    return out


__all__ = ["polar_readiness"]
