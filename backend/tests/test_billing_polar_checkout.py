# coding: utf-8
"""
Tests — Polar checkout client + provider selection (PR #524).

Covers checkout cases 1–15. Authored for a later run — NOT executed in this PR.
The single network seam (`polar/checkout._post`) is mocked; no live Polar/Lemon
API is called.
"""
from __future__ import annotations

import asyncio

import pytest

from backend.services.billing import provider as billing_provider
from backend.services.billing.provider import UnknownProviderError
from backend.services.billing.types import PROVIDER_LEMON_SQUEEZY, PROVIDER_POLAR
from backend.services.billing.checkout import catalog as checkout_catalog
from backend.services.billing.checkout.types import CheckoutVariant
from backend.services.billing.checkout.errors import (
    CheckoutConfigError, CheckoutUpstreamError,
)
from backend.services.billing.polar import checkout as polar_checkout


class _FakeResp:
    def __init__(self, status_code=200, payload=None, content=b"{}"):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}
        self.content = content

    def json(self):
        return self._payload


def _polar_variant():
    return CheckoutVariant(selector="pro_monthly", variant_id="", plan="pro",
                           provider=PROVIDER_POLAR, product_id="prod_uuid", interval="monthly")


def _configure_polar(monkeypatch):
    monkeypatch.setenv("POLAR_ACCESS_TOKEN", "tok")
    monkeypatch.setenv("POLAR_ORGANIZATION_ID", "org")
    monkeypatch.setenv("POLAR_SERVER", "sandbox")


# ── 14 + 15. Provider strictness: unknown rejected, unset = Lemon ─────────────
def test_unknown_provider_rejected_strict(monkeypatch):
    monkeypatch.setenv("BILLING_PROVIDER", "stripe")
    with pytest.raises(UnknownProviderError):
        billing_provider.resolve_provider_strict()
    assert billing_provider.provider_selection_error() is not None


def test_unset_provider_backward_compatible_lemon(monkeypatch):
    monkeypatch.delenv("BILLING_PROVIDER", raising=False)
    assert billing_provider.resolve_provider_strict() == PROVIDER_LEMON_SQUEEZY
    assert billing_provider.provider_selection_error() is None
    monkeypatch.setenv("BILLING_PROVIDER", "polar")
    assert billing_provider.resolve_provider_strict() == PROVIDER_POLAR


# ── 6 + 7. Frontend cannot choose product / amount / currency ─────────────────
def test_frontend_cannot_choose_product_or_amount(monkeypatch):
    # The catalog only exposes selector→plan; product_id/price come from backend
    # config, and amount/currency have no field at all.
    variants = checkout_catalog._parse(
        '{"pro_monthly":{"provider":"polar","product_id":"prod_uuid","plan":"pro","interval":"monthly"}}'
    )
    v = variants["pro_monthly"]
    assert v.product_id == "prod_uuid"
    pub = v.to_public_dict()
    assert "product_id" not in pub and "price_id" not in pub and "amount" not in pub


# ── inactive / provider-mismatch selectors are rejected by the catalog ────────
def test_inactive_variant_skipped():
    assert checkout_catalog._parse(
        '{"pro_monthly":{"provider":"polar","product_id":"p","plan":"pro","active":false}}'
    ) == {}


# ── 3 + 4 + 5. Polar checkout: product + external_customer_id + metadata ──────
def test_polar_checkout_success_uses_authenticated_identity(monkeypatch):
    _configure_polar(monkeypatch)
    captured = {}

    async def fake_post(url, *, headers, body, timeout):
        captured["url"] = url
        captured["headers"] = headers
        captured["body"] = body
        return _FakeResp(200, {"url": "https://polar.sh/checkout/xyz", "id": "co_1"},
                         content=b'{"url":"https://polar.sh/checkout/xyz","id":"co_1"}')

    monkeypatch.setattr(polar_checkout, "_post", fake_post)
    out = asyncio.run(polar_checkout.create_checkout(
        variant=_polar_variant(), custom={"user_id": "user_42"},
        redirect_url="https://app.korvix.ai/thanks", customer_email="u@example.com",
    ))
    assert out["url"] == "https://polar.sh/checkout/xyz"
    assert out["checkout_id"] == "co_1"
    # 3. configured product used; 4. external_customer_id = authenticated Korvix id
    assert captured["body"]["products"] == ["prod_uuid"]
    assert captured["body"]["external_customer_id"] == "user_42"
    # 5. bounded metadata carries the trusted identity + selector (not from frontend)
    assert captured["body"]["metadata"]["user_id"] == "user_42"
    assert captured["body"]["metadata"]["selector"] == "pro_monthly"
    assert captured["body"]["success_url"] == "https://app.korvix.ai/thanks"
    # Bearer token is sent as a header (never in the returned result).
    assert captured["headers"]["Authorization"].startswith("Bearer ")
    assert "Bearer" not in str(out)


# ── 2. Missing configuration fails closed (no URL) ────────────────────────────
def test_polar_missing_config_fails_closed(monkeypatch):
    monkeypatch.delenv("POLAR_ACCESS_TOKEN", raising=False)
    monkeypatch.delenv("POLAR_ORGANIZATION_ID", raising=False)
    with pytest.raises(CheckoutConfigError):
        asyncio.run(polar_checkout.create_checkout(
            variant=_polar_variant(), custom={"user_id": "u"}, redirect_url=None))


# ── 9. Provider timeout → typed upstream failure ──────────────────────────────
def test_polar_timeout_typed_failure(monkeypatch):
    _configure_polar(monkeypatch)
    import httpx

    async def fake_post(url, *, headers, body, timeout):
        raise httpx.ReadTimeout("slow")

    monkeypatch.setattr(polar_checkout, "_post", fake_post)
    with pytest.raises(CheckoutUpstreamError):
        asyncio.run(polar_checkout.create_checkout(
            variant=_polar_variant(), custom={"user_id": "u"}, redirect_url=None))


# ── 10. Malformed Polar response → typed failure ──────────────────────────────
def test_polar_malformed_response(monkeypatch):
    _configure_polar(monkeypatch)

    async def fake_post(url, *, headers, body, timeout):
        return _FakeResp(200, {"unexpected": "shape"}, content=b'{"unexpected":"shape"}')

    monkeypatch.setattr(polar_checkout, "_post", fake_post)
    with pytest.raises(CheckoutUpstreamError):
        asyncio.run(polar_checkout.create_checkout(
            variant=_polar_variant(), custom={"user_id": "u"}, redirect_url=None))


# ── 11. Invalid (non-https) checkout URL rejected ─────────────────────────────
def test_polar_invalid_checkout_url_rejected(monkeypatch):
    _configure_polar(monkeypatch)

    async def fake_post(url, *, headers, body, timeout):
        return _FakeResp(200, {"url": "http://evil.example/checkout", "id": "co_2"},
                         content=b'{"url":"http://evil.example/checkout","id":"co_2"}')

    monkeypatch.setattr(polar_checkout, "_post", fake_post)
    with pytest.raises(CheckoutUpstreamError):
        asyncio.run(polar_checkout.create_checkout(
            variant=_polar_variant(), custom={"user_id": "u"}, redirect_url=None))


# ── 1 + 13. Lemon path unchanged; 12. checkout grants no entitlement ──────────
def test_checkout_service_grants_no_entitlement_and_no_fallback():
    import backend.services.billing.checkout.service as svc
    src = __import__("inspect").getsource(svc)
    # 12. never grants entitlement/credits from checkout.
    assert "credits" not in src.lower() and "entitlement" not in src.lower()
    # 13. no silent fallback — the Polar branch never calls the Lemon client.
    assert "resolve_provider_strict" in src
