# coding: utf-8
"""
Tests — built-in entitlement catalog + active-subscription resolution.

Fix: an active Polar Pro subscription resolved to Free because the built-in
catalog contained only `free`, so a mapped `pro` subscription had no plan to
resolve to. The catalog now seeds stable-key, labeled built-in plans
(basic→Starter, pro→Pro, ultra→Max, enterprise→Enterprise), still overridable by
config and still gated by the operator's id-mapping (fail-closed).

Covers: built-in labels/ranks; mapped active subscription → correct plan;
Starter/Max labels; unmapped → Free; config override; layer disabled → Free.
The catalog cache + subscription store are reset per test; no live API is called.
"""
from __future__ import annotations

import pytest

from backend.services.billing.entitlements import catalog as ent_catalog
from backend.services.billing.entitlements import resolver as ent_resolver
from backend.services.billing.entitlements.types import SOURCE_SUBSCRIPTION, SOURCE_DEFAULT
from backend.services.billing.subscriptions import store as sub_store
from backend.services.billing.subscriptions.types import Subscription, STATUS_ACTIVE
from backend.services.billing.types import PROVIDER_POLAR


@pytest.fixture(autouse=True)
def _reset(monkeypatch):
    # Clean catalog cache + store before each test; entitlements layer ON.
    ent_catalog._reset_for_tests()
    sub_store._reset_for_tests()
    monkeypatch.setenv("ENABLE_BILLING_ENTITLEMENTS", "true")
    # No custom catalog by default — exercise the BUILT-IN plans.
    monkeypatch.delenv("BILLING_PLAN_CATALOG_JSON", raising=False)
    monkeypatch.delenv("BILLING_PLAN_CATALOG_PATH", raising=False)
    yield
    ent_catalog._reset_for_tests()
    sub_store._reset_for_tests()


def _polar_sub(uid: str, product_id: str, *, sub_id: str = "sub_1") -> Subscription:
    return Subscription(
        provider=PROVIDER_POLAR, subscription_id=sub_id,
        status=STATUS_ACTIVE, product_id=product_id, app_user_id=uid,
    )


# ── Built-in catalog: stable keys + final labels + ranks ──────────────────────
def test_builtin_catalog_labels_and_ranks(monkeypatch):
    monkeypatch.delenv("BILLING_PLAN_MAP_JSON", raising=False)
    cat = ent_catalog.get_catalog()
    assert cat.get_plan("free").name == "Free"
    assert cat.get_plan("basic").name == "Starter"
    assert cat.get_plan("pro").name == "Pro"
    assert cat.get_plan("ultra").name == "Max"
    assert cat.get_plan("enterprise").name == "Enterprise"
    # Ranks are strictly increasing so "highest plan wins" behaves.
    ranks = [cat.get_plan(k).rank for k in ("free", "basic", "pro", "ultra", "enterprise")]
    assert ranks == sorted(ranks) and len(set(ranks)) == 5
    # Built-ins carry NO features/limits (no fabricated entitlement).
    assert cat.get_plan("pro").features == frozenset()
    assert cat.get_plan("pro").limits == {}


# ── Active mapped Pro subscription → Pro (the reported bug) ────────────────────
def test_active_pro_resolves_to_pro(monkeypatch):
    monkeypatch.setenv("BILLING_PLAN_MAP_JSON", '{"product:polar_pro":"pro"}')
    sub_store.upsert(_polar_sub("user_1", "polar_pro"))
    ent = ent_resolver.resolve("user_1")
    assert ent.plan_key == "pro"
    assert ent.plan_name == "Pro"
    assert ent.source == SOURCE_SUBSCRIPTION
    assert not ent.is_default


def test_active_basic_resolves_to_starter(monkeypatch):
    monkeypatch.setenv("BILLING_PLAN_MAP_JSON", '{"product:polar_basic":"basic"}')
    sub_store.upsert(_polar_sub("user_2", "polar_basic"))
    ent = ent_resolver.resolve("user_2")
    assert ent.plan_key == "basic"
    assert ent.plan_name == "Starter"


def test_active_ultra_resolves_to_max(monkeypatch):
    monkeypatch.setenv("BILLING_PLAN_MAP_JSON", '{"product:polar_ultra":"ultra"}')
    sub_store.upsert(_polar_sub("user_3", "polar_ultra"))
    ent = ent_resolver.resolve("user_3")
    assert ent.plan_key == "ultra"
    assert ent.plan_name == "Max"


# ── Fail-closed: an UNMAPPED product grants nothing → Free ─────────────────────
def test_unmapped_product_resolves_to_free(monkeypatch):
    monkeypatch.setenv("BILLING_PLAN_MAP_JSON", '{"product:some_other":"pro"}')
    sub_store.upsert(_polar_sub("user_4", "polar_pro"))  # product not in the map
    ent = ent_resolver.resolve("user_4")
    assert ent.plan_key == "free"
    assert ent.source == SOURCE_DEFAULT


# ── Unsubscribed user → Free ──────────────────────────────────────────────────
def test_unsubscribed_user_resolves_to_free(monkeypatch):
    monkeypatch.setenv("BILLING_PLAN_MAP_JSON", '{"product:polar_pro":"pro"}')
    ent = ent_resolver.resolve("user_nobody")
    assert ent.plan_key == "free"
    assert ent.source == SOURCE_DEFAULT


# ── Config overrides the built-in (attach features / relabel) ─────────────────
def test_config_catalog_overrides_builtin(monkeypatch):
    monkeypatch.setenv("BILLING_PLAN_MAP_JSON", '{"product:polar_pro":"pro"}')
    monkeypatch.setenv(
        "BILLING_PLAN_CATALOG_JSON",
        '{"pro":{"name":"Pro Plus","rank":25,"features":["deep_research"],"limits":{"projects":100}}}',
    )
    sub_store.upsert(_polar_sub("user_5", "polar_pro"))
    ent = ent_resolver.resolve("user_5")
    assert ent.plan_key == "pro"
    assert ent.plan_name == "Pro Plus"          # config wins over the built-in label
    assert "deep_research" in ent.features


# ── Layer disabled → default plan for everyone (no subscription read) ─────────
def test_layer_disabled_resolves_to_free(monkeypatch):
    monkeypatch.setenv("ENABLE_BILLING_ENTITLEMENTS", "false")
    monkeypatch.setenv("BILLING_PLAN_MAP_JSON", '{"product:polar_pro":"pro"}')
    sub_store.upsert(_polar_sub("user_6", "polar_pro"))
    ent = ent_resolver.resolve("user_6")
    assert ent.plan_key == "free"
    assert ent.source == SOURCE_DEFAULT
