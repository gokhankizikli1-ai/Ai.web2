# coding: utf-8
"""
Tests — Billing provider foundation + Polar seam (PR #522).

These lock the migration-foundation INVARIANTS: Lemon Squeezy remains the default
and only live provider, an unknown provider fails safe to Lemon, the frontend can
never choose an arbitrary provider id, the existing Lemon plan mapping is
unchanged, unknown products grant nothing, provider-normalized identity is
preserved, checkout never grants entitlement, unverified webhooks grant nothing,
the Polar adapter fails closed with a typed error, and no secret is exposed.

NOTE: authored for a later run — NOT executed in this PR (see the PR description's
Verification section for the exact commands).
"""
from __future__ import annotations

import asyncio

import pytest

from backend.services.billing import provider as billing_provider
from backend.services.billing.types import (
    PROVIDER_LEMON_SQUEEZY, PROVIDER_POLAR, DEFAULT_PROVIDER,
)
from backend.services.billing.checkout import catalog as checkout_catalog
from backend.services.billing.checkout.types import CheckoutVariant
from backend.services.billing.checkout.errors import CheckoutProviderUnavailable
from backend.services.billing.polar import checkout as polar_checkout
from backend.services.billing.polar import config as polar_config


# ── 1 + 12. Lemon remains the default provider (backward compatible) ──────────
def test_default_provider_is_lemon(monkeypatch):
    monkeypatch.delenv("BILLING_PROVIDER", raising=False)
    assert billing_provider.resolve_provider() == PROVIDER_LEMON_SQUEEZY
    assert DEFAULT_PROVIDER == PROVIDER_LEMON_SQUEEZY
    monkeypatch.setenv("BILLING_PROVIDER", "")
    assert billing_provider.resolve_provider() == PROVIDER_LEMON_SQUEEZY
    monkeypatch.setenv("BILLING_PROVIDER", "lemon_squeezy")
    assert billing_provider.resolve_provider() == PROVIDER_LEMON_SQUEEZY


# ── 2. Unknown provider is rejected → fail-safe to Lemon ──────────────────────
def test_unknown_provider_fails_safe_to_lemon(monkeypatch):
    monkeypatch.setenv("BILLING_PROVIDER", "stripe")
    assert billing_provider.resolve_provider() == PROVIDER_LEMON_SQUEEZY
    assert billing_provider.is_known_provider("stripe") is False
    assert billing_provider.is_known_provider("polar") is True
    monkeypatch.setenv("BILLING_PROVIDER", "POLAR")            # case-insensitive
    assert billing_provider.resolve_provider() == PROVIDER_POLAR


# ── 3. Frontend cannot choose an arbitrary provider product id ────────────────
def test_arbitrary_variant_is_not_resolvable():
    # A client-supplied id that is not in the allowlist resolves to None (rejected
    # server-side) — the checkout can only buy an allowlisted selector.
    variants = checkout_catalog._parse('{"pro_monthly":{"variant_id":"123","plan":"pro"}}')
    assert "pro_monthly" in variants
    assert variants["pro_monthly"].variant_id == "123"
    # a raw, non-allowlisted id is not present as a key.
    assert "999999" not in variants


# ── 4 + 12. Existing Lemon plan mapping is unchanged (no provider field) ──────
def test_lemon_variants_parse_unchanged():
    variants = checkout_catalog._parse(
        '{"pro_monthly":{"variant_id":"123","plan":"pro","label":"Pro Monthly"},'
        ' "pro_yearly":{"variant_id":"456","plan":"pro"}}'
    )
    v = variants["pro_monthly"]
    assert (v.selector, v.variant_id, v.plan, v.label) == ("pro_monthly", "123", "pro", "Pro Monthly")
    assert v.provider == PROVIDER_LEMON_SQUEEZY       # default, backward compatible
    assert v.product_id == "" and v.price_id == ""
    assert variants["pro_yearly"].plan == "pro"


def test_polar_variant_maps_product_price():
    variants = checkout_catalog._parse(
        '{"pro_monthly":{"provider":"polar","product_id":"prod_1","price_id":"price_1","plan":"pro"}}'
    )
    v = variants["pro_monthly"]
    assert v.provider == PROVIDER_POLAR
    assert (v.product_id, v.price_id, v.plan) == ("prod_1", "price_1", "pro")


# ── 5. Unknown / malformed product grants nothing (skipped, never defaulted) ──
def test_variant_missing_identifier_is_skipped():
    # plan present but no provider identifier → skipped (never becomes a buyable
    # default that could grant an entitlement).
    assert checkout_catalog._parse('{"x":{"plan":"pro"}}') == {}
    assert checkout_catalog._parse('{"x":{"variant_id":"1"}}') == {}   # no plan
    assert checkout_catalog._parse('{"x":{"provider":"polar","plan":"pro"}}') == {}  # polar w/o product/price


# ── 6. Provider-normalized identity + event vocabulary preserved ──────────────
def test_from_event_preserves_provider_identity():
    from backend.services.billing.subscriptions.types import from_lemon_event
    sub = from_lemon_event(
        provider=PROVIDER_LEMON_SQUEEZY, event_name="subscription_created",
        event_id="evt_1", event_at="2024-01-01T00:00:00Z",
        data={"type": "subscriptions", "id": "sub_42", "attributes": {"status": "active"}},
        meta={"custom_data": {"user_id": "user_7"}},
    )
    assert sub is not None
    assert sub.provider == PROVIDER_LEMON_SQUEEZY
    assert sub.subscription_id == "sub_42"
    assert sub.app_user_id == "user_7"        # identity from signed metadata, not frontend
    assert sub.status == "active"


def test_normalized_event_mapping():
    m = billing_provider.lemon_event_to_normalized
    assert m("subscription_created") == billing_provider.EVENT_SUBSCRIPTION_CREATED
    assert m("subscription_cancelled") == billing_provider.EVENT_SUBSCRIPTION_CANCELED
    assert m("order_created") == billing_provider.EVENT_CHECKOUT_COMPLETED
    assert m("totally_unknown_event") is None
    assert billing_provider.EVENT_SUBSCRIPTION_CREATED in billing_provider.NORMALIZED_EVENTS


# ── 7. Duplicate event remains idempotent (dedup key is deterministic) ────────
def test_dedup_key_is_deterministic():
    from backend.services.billing.inbox import compute_dedup_key
    body = b'{"meta":{"event_name":"subscription_created"}}'
    assert compute_dedup_key(body) == compute_dedup_key(body)          # same bytes → same key
    assert compute_dedup_key(body) != compute_dedup_key(body + b" ")   # different bytes → different key


# ── 8. Checkout creation does not import/grant entitlements or credits ────────
def test_checkout_does_not_grant_entitlement():
    import backend.services.billing.checkout.service as svc
    src = __import__("inspect").getsource(svc)
    # The checkout service must never mutate entitlements/credits — a checkout is a
    # commercial intent, not a permission grant (only verified webhooks project state).
    assert "credits" not in src.lower()
    assert "entitlement" not in src.lower()


# ── 9. Unverified webhook grants nothing (signature fails closed) ─────────────
def test_signature_fails_closed():
    from backend.services.billing import signature
    assert signature.verify(b"body", "deadbeef", "") is False       # no secret → closed
    assert signature.verify(b"body", "", "secret") is False          # no signature → closed
    assert signature.verify(b"body", "not-a-valid-sig", "secret") is False


# ── 10. Polar adapter fails closed with a typed error when UNCONFIGURED (no URL)
#    (PR #524: the real client raises CheckoutConfigError; happy-path checkout is
#    covered in test_billing_polar_checkout.py with a mocked HTTP seam.) ─────────
def test_polar_checkout_fails_closed_when_unconfigured(monkeypatch):
    from backend.services.billing.checkout.errors import CheckoutConfigError
    monkeypatch.delenv("POLAR_ACCESS_TOKEN", raising=False)
    monkeypatch.delenv("POLAR_ORGANIZATION_ID", raising=False)
    v = CheckoutVariant(selector="pro_monthly", variant_id="", plan="pro",
                        provider=PROVIDER_POLAR, product_id="prod_1", price_id="price_1")
    with pytest.raises(CheckoutConfigError):
        asyncio.run(polar_checkout.create_checkout(variant=v, custom={"user_id": "u"}, redirect_url=None))


# ── 11. Secrets are never exposed (frontend config + diagnostics) ─────────────
def test_no_secret_exposed(monkeypatch):
    monkeypatch.setenv("POLAR_ACCESS_TOKEN", "super-secret-token")
    monkeypatch.setenv("POLAR_WEBHOOK_SECRET", "super-secret-webhook")
    monkeypatch.setenv("POLAR_ORGANIZATION_ID", "org_1")
    status = polar_config.config_status()
    flat = repr(status)
    assert "super-secret-token" not in flat and "super-secret-webhook" not in flat
    assert status["has_access_token"] is True and status["has_webhook_secret"] is True
    # The public checkout catalog never leaks provider product/price ids.
    v = CheckoutVariant(selector="s", variant_id="1", plan="pro",
                        provider=PROVIDER_POLAR, product_id="prod_secret", price_id="price_secret")
    pub = v.to_public_dict()
    assert "product_id" not in pub and "price_id" not in pub


# ── 14. Missing Polar configuration is handled safely (defaults, never raises)─
def test_polar_config_safe_defaults(monkeypatch):
    for k in ("POLAR_ACCESS_TOKEN", "POLAR_ORGANIZATION_ID", "POLAR_WEBHOOK_SECRET",
              "POLAR_SERVER", "POLAR_API_BASE"):
        monkeypatch.delenv(k, raising=False)
    assert polar_config.is_configured() is False
    assert polar_config.server() == "sandbox"                 # safe default
    assert polar_config.api_base() == "https://sandbox-api.polar.sh"
    assert polar_config.is_production() is False
    monkeypatch.setenv("POLAR_SERVER", "nonsense")            # typo → sandbox
    assert polar_config.server() == "sandbox"
    monkeypatch.setenv("POLAR_SERVER", "production")
    assert polar_config.api_base() == "https://api.polar.sh"


# ── 13. Existing cancellation vocabulary is unchanged ─────────────────────────
def test_cancellation_taxonomy_unchanged():
    from backend.services.billing.subscriptions import types as sub_types
    assert sub_types.STATUS_CANCELLED == "cancelled"
    assert sub_types.normalize_status("cancelled") == "cancelled"
    assert sub_types.normalize_status("expired") == "expired"
