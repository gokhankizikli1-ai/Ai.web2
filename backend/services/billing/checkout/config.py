# coding: utf-8
"""
Billing checkout — dynamic configuration (PR 7).

Read on every call so a Railway env flip is live without a restart (mirrors the
rest of billing). Canonical docs on backend.core.config.Config.

Secrets (LEMON_SQUEEZY_API_KEY) are returned by an accessor here but MUST NEVER
be logged. The checkout surface ships dormant (ENABLE_BILLING_CHECKOUT default
OFF) and fails closed (503) when the API key / store id are unset.
"""
from __future__ import annotations

import os
from typing import List
from urllib.parse import urlparse


_DEFAULT_API_BASE = "https://api.lemonsqueezy.com"
_DEFAULT_TIMEOUT = 15.0


def is_enabled() -> bool:
    """Master gate for the /v2/billing/checkout surface. Default OFF."""
    return os.getenv("ENABLE_BILLING_CHECKOUT", "false").strip().lower() == "true"


def api_key() -> str:
    """Lemon Squeezy API key (Bearer). Empty ⇒ checkout fails closed. NEVER log."""
    return (os.getenv("LEMON_SQUEEZY_API_KEY", "") or "").strip()


def store_id() -> str:
    """Lemon Squeezy store id the checkouts belong to. Empty ⇒ fails closed."""
    return (os.getenv("LEMON_SQUEEZY_STORE_ID", "") or "").strip()


def api_base() -> str:
    """Base URL for the Lemon Squeezy API (override for staging/tests)."""
    return (os.getenv("LEMON_SQUEEZY_API_BASE", _DEFAULT_API_BASE) or _DEFAULT_API_BASE).strip().rstrip("/")


def timeout_seconds() -> float:
    raw = os.getenv("BILLING_CHECKOUT_TIMEOUT_SEC", "")
    try:
        v = float(raw) if raw.strip() else _DEFAULT_TIMEOUT
    except (TypeError, ValueError):
        return _DEFAULT_TIMEOUT
    return v if v > 0 else _DEFAULT_TIMEOUT


def variants_json() -> str:
    """Raw JSON of purchasable variants (the centralized variant/plan config).
    Shape: {"pro_monthly": {"variant_id":"123","plan":"pro","label":"Pro Monthly"}}"""
    return os.getenv("BILLING_CHECKOUT_VARIANTS_JSON", "") or ""


def default_return_url() -> str:
    """Redirect used after a successful checkout when the request omits one."""
    return (os.getenv("BILLING_CHECKOUT_DEFAULT_RETURN_URL", "") or "").strip()


def _allowed_return_hosts_env() -> List[str]:
    raw = os.getenv("BILLING_CHECKOUT_ALLOWED_RETURN_HOSTS", "") or ""
    return [h.strip().lower() for h in raw.split(",") if h.strip()]


def allowed_return_hosts() -> List[str]:
    """Hostname allowlist for a client-supplied return_url (open-redirect
    guard). Union of the app's CORS ALLOWED_ORIGINS hosts and the dedicated
    BILLING_CHECKOUT_ALLOWED_RETURN_HOSTS env."""
    hosts = set(_allowed_return_hosts_env())
    try:
        from backend.core.config import settings
        for origin in getattr(settings, "ALLOWED_ORIGINS", []) or []:
            host = urlparse(origin).hostname
            if host:
                hosts.add(host.lower())
    except Exception:  # pragma: no cover — never let config import break checkout
        pass
    return sorted(hosts)


def strict_postgres() -> bool:
    return os.getenv("BILLING_POSTGRES_REQUIRED", "false").strip().lower() == "true"


__all__ = [
    "is_enabled", "api_key", "store_id", "api_base", "timeout_seconds",
    "variants_json", "default_return_url", "allowed_return_hosts",
    "strict_postgres",
]
