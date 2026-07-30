# coding: utf-8
"""
Billing Polar — dynamic configuration (PR #522 migration foundation).

Mirrors the rest of billing: every accessor reads the environment on EVERY call
so a Railway env flip is live without a restart. All values default empty ⇒ the
adapter is UNCONFIGURED and fails closed. NONE of these are ever exposed to the
frontend (no VITE_* mirror) and the secrets (`POLAR_ACCESS_TOKEN`,
`POLAR_WEBHOOK_SECRET`) MUST NEVER be logged.

These variables are DORMANT in this PR — nothing consumes the token/secret yet.
They are declared so the operator can pre-provision Polar (in sandbox) ahead of
the PR #524 implementation without any code change.
"""
from __future__ import annotations

import os


# Polar has two isolated environments; sandbox is the safe default so an
# accidental enable can never touch production billing.
_SERVER_SANDBOX = "sandbox"
_SERVER_PRODUCTION = "production"
_API_BASE = {
    _SERVER_SANDBOX: "https://sandbox-api.polar.sh",
    _SERVER_PRODUCTION: "https://api.polar.sh",
}


def access_token() -> str:
    """Polar Organization Access Token (Bearer). Empty ⇒ unconfigured. NEVER log."""
    return (os.getenv("POLAR_ACCESS_TOKEN", "") or "").strip()


def organization_id() -> str:
    """Polar organization id the products/checkouts belong to. Empty ⇒ unconfigured."""
    return (os.getenv("POLAR_ORGANIZATION_ID", "") or "").strip()


def webhook_secret() -> str:
    """Polar webhook signing secret (Standard-Webhooks base64 scheme). Empty ⇒
    the future Polar webhook endpoint fails closed. NEVER log."""
    return (os.getenv("POLAR_WEBHOOK_SECRET", "") or "").strip()


def server() -> str:
    """`sandbox` (default) or `production`. Any other value falls back to sandbox
    so a typo can never point at the live Polar environment."""
    raw = (os.getenv("POLAR_SERVER", _SERVER_SANDBOX) or _SERVER_SANDBOX).strip().lower()
    return raw if raw in (_SERVER_SANDBOX, _SERVER_PRODUCTION) else _SERVER_SANDBOX


def api_base() -> str:
    """Resolved Polar API base for the selected server. An explicit
    `POLAR_API_BASE` override wins (staging/tests)."""
    override = (os.getenv("POLAR_API_BASE", "") or "").strip().rstrip("/")
    if override:
        return override
    return _API_BASE[server()]


def is_production() -> bool:
    return server() == _SERVER_PRODUCTION


def is_configured() -> bool:
    """True only when the minimum Polar credentials are present. Being configured
    does NOT enable Polar — `billing.provider.resolve_provider()` governs that."""
    return bool(access_token() and organization_id())


def config_status() -> dict:
    """Non-secret diagnostics for owner tooling. Reports ONLY booleans /
    non-secret fields — never the token or webhook secret value."""
    return {
        "configured": is_configured(),
        "server": server(),
        "has_access_token": bool(access_token()),
        "has_organization_id": bool(organization_id()),
        "has_webhook_secret": bool(webhook_secret()),
    }


__all__ = [
    "access_token", "organization_id", "webhook_secret", "server",
    "api_base", "is_production", "is_configured", "config_status",
]
