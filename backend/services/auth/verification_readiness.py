# coding: utf-8
"""
Email-verification production-readiness — a redacted, owner-facing report.

Answers one question unambiguously: "if ENABLE_EMAIL_VERIFICATION is on, is the
system actually able to deliver verification emails in production?" It NEVER
returns a secret — only booleans, a non-secret provider name, counts, and a
route list. The whole point is to make a misconfiguration (enforcement on but
still on the dev-safe `console` provider, or missing key/from/base-url)
unmistakable to an operator, while signup continues to fail safe.

No secret value, full email, token, or link is ever included here.
"""
from __future__ import annotations

from typing import Any, Dict, List

from backend.core.config import settings

# Providers that can actually deliver mail in production. `console` is dev-safe
# and NEVER counts as production-ready.
PRODUCTION_PROVIDERS = frozenset({"resend"})

# Costly execution routes that carry require_verified_identity today. Kept as a
# curated, reviewed list so the diagnostic reflects intent (dependency identity
# is not reliably introspectable across the mounted route tree). Update this
# together with any guard change.
GUARDED_COSTLY_ROUTES: List[str] = [
    "POST /v2/web-build/images/generate",
    "POST /v2/assets/{id}/analyze",
    "POST /v2/recreate",
    "POST /v2/workflows/{id}/run",
    "POST /v2/orchestrate",
    "POST /v2/orchestrator/run",
    "POST /v2/agent/execute",
    "POST /v2/startup/market-complaints",
    "POST /v2/chat/stream",
    "POST /v2/intelligence/orchestrate",
]

# Costly model paths NOT carrying a route-level require_verified_identity, each
# because an AUTHORITATIVE backend boundary already governs their spend:
#   * /chat gates every PROTECTED (paid Web-Build/redesign/edit) operation
#     in-handler via ai_guard.preflight, and meters ordinary chat with the
#     legacy free-message quota — casual chat is intentionally free.
# There are no costly routes left with NO authoritative boundary.
UNCOVERED_COSTLY_ROUTES: List[str] = []

# Costly paths deliberately governed by an in-handler boundary instead of the
# route guard (reported for transparency, not a gap).
COSTLY_ROUTES_GATED_IN_HANDLER: List[str] = [
    "POST /chat (paid ops gated by ai_guard.preflight; ordinary chat metered by the free-message quota; casual chat intentionally free)",
]

# Low-cost, rule-based routes intentionally left open (no LLM/provider spend):
INTENTIONALLY_FREE_ROUTES: List[str] = [
    "POST /v2/intelligence/classify", "POST /v2/intelligence/plan",
    "POST /v2/coordinator/plan", "POST /v2/coordinator/classify",
    "POST /v2/agents/{agent_id}/tasks (task CRUD; no execution)",
]


def _b(value: Any) -> bool:
    try:
        return bool(value)
    except Exception:  # pragma: no cover
        return False


def _is_production() -> bool:
    return str(getattr(settings, "ENVIRONMENT", "")).strip().lower() == "production"


def _base_url() -> str:
    return (
        (getattr(settings, "EMAIL_VERIFICATION_BASE_URL", "") or "").strip()
        or (getattr(settings, "PUBLIC_APP_URL", "") or "").strip()
    )


def _base_url_ok(base: str, is_prod: bool) -> bool:
    if not base:
        return False
    # In production the verification link must be HTTPS (tokens ride the URL
    # fragment; an http origin would be a downgrade). Non-prod may use http.
    if is_prod:
        return base.lower().startswith("https://")
    return base.lower().startswith(("http://", "https://"))


def _verification_route_registered() -> bool:
    try:
        from backend.routes.v2_email_verification import router
        return len(getattr(router, "routes", [])) >= 3
    except Exception:  # pragma: no cover
        return False


def evaluate() -> Dict[str, Any]:
    """Build the redacted readiness report."""
    is_prod = _is_production()
    enabled = _b(getattr(settings, "ENABLE_EMAIL_VERIFICATION", False))
    provider = str(getattr(settings, "EMAIL_PROVIDER", "console") or "console").strip().lower()

    key_configured = _b(getattr(settings, "RESEND_API_KEY", ""))
    from_configured = _b(getattr(settings, "EMAIL_FROM", ""))
    base = _base_url()
    base_ok = _base_url_ok(base, is_prod)

    provider_supported = provider in PRODUCTION_PROVIDERS
    provider_configured = provider_supported and key_configured and from_configured

    production_ready = bool(enabled and provider_configured and base_ok)

    # Enumerate exactly what's missing so the operator can fix it fast.
    missing: List[str] = []
    if enabled:
        if not provider_supported:
            missing.append("EMAIL_PROVIDER (must be a production provider, e.g. 'resend')")
        if not key_configured:
            missing.append("RESEND_API_KEY")
        if not from_configured:
            missing.append("EMAIL_FROM")
        if not base_ok:
            missing.append("EMAIL_VERIFICATION_BASE_URL/PUBLIC_APP_URL (valid HTTPS in production)")

    if not enabled:
        status = "dormant"          # feature off — not gating anything
    elif production_ready:
        status = "ready"
    else:
        status = "misconfigured"    # enforcement ON but cannot deliver → LOUD

    return {
        "emailVerificationEnabled": enabled,
        "providerName": provider,               # non-secret name only
        "providerSupported": provider_supported,
        "providerConfigured": provider_configured,
        "resendApiKeyConfigured": key_configured,
        "fromAddressConfigured": from_configured,
        "baseUrlConfigured": base_ok,
        "productionReady": production_ready,
        "status": status,
        "usingConsoleWhileEnforced": bool(enabled and provider == "console"),
        "missing": missing,
        "verificationRouteRegistered": _verification_route_registered(),
        "guardedRouteCount": len(GUARDED_COSTLY_ROUTES),
        "guardedRoutes": list(GUARDED_COSTLY_ROUTES),
        "uncoveredCostlyRoutes": list(UNCOVERED_COSTLY_ROUTES),
        "costlyRoutesGatedInHandler": list(COSTLY_ROUTES_GATED_IN_HANDLER),
        "intentionallyFreeRoutes": list(INTENTIONALLY_FREE_ROUTES),
        "rateLimitMode": "in_process",          # per-IP limiters reset on redeploy
        "environmentIsProduction": is_prod,
    }


__all__ = [
    "evaluate", "PRODUCTION_PROVIDERS",
    "GUARDED_COSTLY_ROUTES", "UNCOVERED_COSTLY_ROUTES",
    "COSTLY_ROUTES_GATED_IN_HANDLER", "INTENTIONALLY_FREE_ROUTES",
]
