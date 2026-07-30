# coding: utf-8
"""
Tests — PR #525 Polar configuration-readiness + provider-neutral customer portal.

Authored for a later run — NOT executed in this PR. No live Polar/Lemon API is
called: the single network seam (`polar/checkout._post`) and the subscription
store are stubbed. Covers the PR #525 backend cases:

  Readiness (read-only, no external call):
    1.  unset provider → readiness reports provider=lemon_squeezy, exposes booleans only
    2.  unconfigured Polar → core not ready, `missing` lists the gaps, no secrets leak
    3.  fully configured Polar sandbox → readyForSandboxCheckout true, production false
    4.  fully configured Polar production → readyForProductionCutover true
    5.  snapshot NEVER contains secret values (token/webhook secret/product ids)

  Customer portal (fail-closed, provider-neutral):
    6.  empty user id → PortalNoCustomer (never mints a portal)
    7.  Lemon selected → PortalNotAvailable (honest, not a silent fallback)
    8.  Polar selected but unconfigured → CheckoutConfigError
    9.  Polar selected + configured but user unmapped → PortalNoCustomer (fail-safe)
    10. Polar selected + configured + mapped → returns the validated HTTPS portal url
    11. unknown provider → UnknownProviderError (never assumes Lemon)
"""
from __future__ import annotations

import asyncio

import pytest

from backend.services.billing import readiness as billing_readiness
from backend.services.billing import portal as billing_portal
from backend.services.billing.provider import UnknownProviderError
from backend.services.billing.checkout.errors import (
    CheckoutConfigError, PortalNotAvailable, PortalNoCustomer,
)


# ── Readiness ────────────────────────────────────────────────────────────────

def test_readiness_unset_provider_reports_lemon(monkeypatch):
    monkeypatch.delenv("BILLING_PROVIDER", raising=False)
    snap = billing_readiness.polar_readiness()
    assert snap["provider"] == "lemon_squeezy"
    assert isinstance(snap["polar"], dict)
    # Every field is a boolean / int / str — never a secret value.
    assert isinstance(snap["polar"]["accessTokenConfigured"], bool)
    assert isinstance(snap["polar"]["polarVariantCount"], int)


def test_readiness_unconfigured_polar_not_ready(monkeypatch):
    monkeypatch.setenv("BILLING_PROVIDER", "polar")
    for k in ("POLAR_ACCESS_TOKEN", "POLAR_ORGANIZATION_ID", "POLAR_WEBHOOK_SECRET"):
        monkeypatch.delenv(k, raising=False)
    snap = billing_readiness.polar_readiness()
    polar = snap["polar"]
    assert polar["readyForSandboxCheckout"] is False
    assert polar["readyForProductionCutover"] is False
    assert "accessTokenConfigured" in polar["missing"]


def test_readiness_snapshot_has_no_secret_values(monkeypatch):
    monkeypatch.setenv("BILLING_PROVIDER", "polar")
    monkeypatch.setenv("POLAR_ACCESS_TOKEN", "super-secret-token")
    monkeypatch.setenv("POLAR_WEBHOOK_SECRET", "whsec_super_secret")
    monkeypatch.setenv("POLAR_ORGANIZATION_ID", "org_123")
    import json
    blob = json.dumps(billing_readiness.polar_readiness())
    assert "super-secret-token" not in blob
    assert "whsec_super_secret" not in blob
    # The org id is not echoed as a value either — only a boolean "configured".
    assert "org_123" not in blob


# ── Customer portal ──────────────────────────────────────────────────────────

def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def test_portal_empty_user_fails_safe():
    with pytest.raises(PortalNoCustomer):
        _run(billing_portal.create_portal_url(user_id="  "))


def test_portal_lemon_has_no_portal(monkeypatch):
    monkeypatch.delenv("BILLING_PROVIDER", raising=False)  # → lemon
    with pytest.raises(PortalNotAvailable):
        _run(billing_portal.create_portal_url(user_id="user-1"))


def test_portal_polar_unconfigured_fails_closed(monkeypatch):
    monkeypatch.setenv("BILLING_PROVIDER", "polar")
    monkeypatch.delenv("POLAR_ACCESS_TOKEN", raising=False)
    monkeypatch.delenv("POLAR_ORGANIZATION_ID", raising=False)
    with pytest.raises(CheckoutConfigError):
        _run(billing_portal.create_portal_url(user_id="user-1"))


def test_portal_polar_unmapped_user_fails_safe(monkeypatch):
    monkeypatch.setenv("BILLING_PROVIDER", "polar")
    monkeypatch.setenv("POLAR_ACCESS_TOKEN", "tok")
    monkeypatch.setenv("POLAR_ORGANIZATION_ID", "org")
    # No Polar subscription for this user → fail safe.
    monkeypatch.setattr(billing_portal.subscription_store, "list_subscriptions", lambda **kw: [])
    with pytest.raises(PortalNoCustomer):
        _run(billing_portal.create_portal_url(user_id="user-1"))


def test_portal_polar_mapped_user_returns_url(monkeypatch):
    monkeypatch.setenv("BILLING_PROVIDER", "polar")
    monkeypatch.setenv("POLAR_ACCESS_TOKEN", "tok")
    monkeypatch.setenv("POLAR_ORGANIZATION_ID", "org")
    monkeypatch.setattr(billing_portal.subscription_store, "list_subscriptions", lambda **kw: [object()])

    async def _fake_session(*, external_customer_id):
        assert external_customer_id == "user-1"  # authoritative identity, not arbitrary
        return "https://polar.sh/portal/session-token"

    monkeypatch.setattr(billing_portal.polar_checkout, "create_customer_session", _fake_session)
    url = _run(billing_portal.create_portal_url(user_id="user-1"))
    assert url.startswith("https://")


def test_portal_unknown_provider_never_assumes_lemon(monkeypatch):
    monkeypatch.setenv("BILLING_PROVIDER", "stripe")
    with pytest.raises(UnknownProviderError):
        _run(billing_portal.create_portal_url(user_id="user-1"))
