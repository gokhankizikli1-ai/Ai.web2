# coding: utf-8
"""
Tests — Polar subscription projection + normalization (PR #524).

Covers projection cases 29–40. Authored for a later run — NOT executed in this
PR. Pure mapping tests need no DB; the store-backed ordering test uses a tmp db.
"""
from __future__ import annotations

from backend.services.billing.subscriptions import types as st
from backend.services.billing.types import PROVIDER_POLAR, PROVIDER_LEMON_SQUEEZY


def _sub_payload(**over):
    data = {
        "id": "sub_1", "status": "active",
        "current_period_start": "2024-01-01T00:00:00Z",
        "current_period_end": "2024-02-01T00:00:00Z",
        "cancel_at_period_end": False,
        "customer": {"id": "cus_1", "external_id": "user_9", "email": "u@example.com"},
        "product": {"id": "prod_1", "name": "Pro"},
        "product_id": "prod_1", "price_id": "price_1",
        "metadata": {"user_id": "user_9", "plan": "pro"},
        "created_at": "2024-01-01T00:00:00Z", "modified_at": "2024-01-01T00:00:00Z",
    }
    data.update(over)
    return data


# ── 29. Creation projects a normalized polar subscription ─────────────────────
def test_creation_maps_polar_subscription():
    sub = st.from_polar_event(event_name="subscription.created", event_id="e1",
                              event_at="2024-01-01T00:00:00Z", data=_sub_payload())
    assert sub is not None
    assert sub.provider == PROVIDER_POLAR
    assert sub.subscription_id == "sub_1"
    assert sub.status == st.STATUS_ACTIVE
    assert sub.product_id == "prod_1" and sub.price_id == "price_1"
    assert sub.renews_at == "2024-02-01T00:00:00Z"


# ── 24 + 30. Identity from signed external_id; update preserves it ────────────
def test_identity_from_external_id_and_preserved():
    sub = st.from_polar_event(event_name="subscription.updated", event_id="e2",
                              event_at="t", data=_sub_payload(status="active"))
    assert sub.app_user_id == "user_9"     # from customer.external_id (signed)


# ── 25. Metadata / external_id mismatch grants nothing ────────────────────────
def test_identity_conflict_grants_nothing():
    d = _sub_payload(customer={"id": "c", "external_id": "user_9"},
                     metadata={"user_id": "user_DIFFERENT"})
    sub = st.from_polar_event(event_name="subscription.updated", event_id="e", event_at="t", data=d)
    assert sub.app_user_id is None
    assert sub.custom_data.get("_identity_conflict") is True


# ── 26. Email alone never resolves identity ───────────────────────────────────
def test_email_alone_does_not_resolve_identity():
    d = _sub_payload(customer={"id": "c", "email": "u@example.com"}, metadata={})
    sub = st.from_polar_event(event_name="subscription.updated", event_id="e", event_at="t", data=d)
    assert sub.app_user_id is None
    assert st.resolve_polar_identity(None, None) is None


# ── 32. Cancellation-at-period-end preserved (grace via ends_at) ──────────────
def test_cancel_at_period_end_preserves_grace():
    d = _sub_payload(status="active", cancel_at_period_end=True)
    sub = st.from_polar_event(event_name="subscription.canceled", event_id="e", event_at="t", data=d)
    assert sub.status == st.STATUS_ACTIVE       # still entitling until period end
    assert sub.cancelled is True
    assert sub.ends_at == "2024-02-01T00:00:00Z"  # grace boundary = current period end


# ── 33. Revoked handled explicitly (immediate, not entitling) ─────────────────
def test_revoked_is_expired():
    sub = st.from_polar_event(event_name="subscription.revoked", event_id="e", event_at="t",
                              data=_sub_payload(status="revoked"))
    assert sub.status == st.STATUS_EXPIRED
    assert sub.cancelled is True


# ── 23. Malformed known event mutates nothing (no id → None) ──────────────────
def test_malformed_missing_id_returns_none():
    assert st.from_polar_event(event_name="subscription.updated", event_id="e",
                               event_at="t", data={"status": "active"}) is None


# ── 27. Sandbox vs production isolation via test_mode ─────────────────────────
def test_test_mode_flag():
    sandbox = st.from_polar_event(event_name="subscription.created", event_id="e",
                                  event_at="t", data=_sub_payload(), test_mode=True)
    prod = st.from_polar_event(event_name="subscription.created", event_id="e",
                               event_at="t", data=_sub_payload(), test_mode=False)
    assert sandbox.test_mode is True and prod.test_mode is False


# ── 36. Checkout/order events are NOT projected as subscription truth ─────────
def test_order_checkout_events_not_subscription_lifecycle():
    for name in ("order.paid", "order.created", "checkout.updated", "checkout.created"):
        assert name not in st.POLAR_SUBSCRIPTION_LIFECYCLE_EVENTS


# ── 34 + 35. Product → plan via the EXISTING map (unknown grants no plan) ──────
def test_product_maps_through_existing_entitlement_catalog(monkeypatch):
    from backend.services.billing.entitlements import catalog as ent_catalog
    monkeypatch.setenv("BILLING_PLAN_MAP_JSON", '{"product:prod_1":"pro"}')
    mapped = st.from_polar_event(event_name="subscription.active", event_id="e", event_at="t",
                                 data=_sub_payload(product_id="prod_1"))
    unknown = st.from_polar_event(event_name="subscription.active", event_id="e", event_at="t",
                                  data=_sub_payload(product_id="prod_UNKNOWN"))
    assert ent_catalog.plan_key_for_subscription(mapped) == "pro"      # mapped → correct plan
    assert ent_catalog.plan_key_for_subscription(unknown) is None      # unknown → no plan


# ── 37 + 40. One handler + table for both providers (no second engine) ────────
def test_single_projection_engine_registers_both_providers():
    from backend.services.billing.subscriptions import projection
    from backend.services.billing.processor import registry
    n = projection.register_handlers()
    assert n == len(st.SUBSCRIPTION_LIFECYCLE_EVENTS) + len(st.POLAR_SUBSCRIPTION_LIFECYCLE_EVENTS)
    # both Lemon and Polar events dispatch to the SAME handler function.
    assert registry.get_handler("subscription_created") is projection.project_subscription_event
    assert registry.get_handler("subscription.created") is projection.project_subscription_event


# ── 39. Lemon projection remains backward compatible ──────────────────────────
def test_lemon_projection_unchanged():
    sub = st.from_lemon_event(
        provider=PROVIDER_LEMON_SQUEEZY, event_name="subscription_created", event_id="e",
        event_at="t", data={"type": "subscriptions", "id": "s", "attributes": {"status": "active"}},
        meta={"custom_data": {"user_id": "u"}})
    assert sub is not None and sub.provider == PROVIDER_LEMON_SQUEEZY and sub.app_user_id == "u"


# ── 38. Projection never touches the credit system ────────────────────────────
def test_projection_does_not_touch_credits():
    import inspect
    from backend.services.billing.subscriptions import projection
    assert "credits" not in inspect.getsource(projection).lower()


# ── 31. Stale update cannot overwrite newer state (store ordering guard) ──────
def test_stale_update_does_not_regress(monkeypatch, tmp_path):
    monkeypatch.setenv("BILLING_DB_PATH", str(tmp_path / "billing.db"))
    from backend.services.billing.subscriptions import store as sub_store
    sub_store._reset_for_tests()
    newer = st.from_polar_event(event_name="subscription.updated", event_id="e2", event_at="t2",
                                data=_sub_payload(status="active", modified_at="2024-03-01T00:00:00Z"))
    older = st.from_polar_event(event_name="subscription.updated", event_id="e1", event_at="t1",
                                data=_sub_payload(status="past_due", modified_at="2024-01-01T00:00:00Z"))
    applied_new, _ = sub_store.upsert(newer)
    applied_old, current = sub_store.upsert(older)
    assert applied_new is True
    assert applied_old is False                 # stale guard skipped the older event
    assert current.status == st.STATUS_ACTIVE   # newer state retained
