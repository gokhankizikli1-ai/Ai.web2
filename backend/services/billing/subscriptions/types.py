# coding: utf-8
"""
Billing — subscription-state projection types (PR 3).

The `Subscription` dataclass is the normalized, internal "truth layer" for a
customer's subscription, projected from processed Lemon Squeezy subscription
lifecycle webhooks. It is DELIBERATELY just state — no entitlements, credits,
usage limits or feature gating (those are a later PR that reads this table).

Shape conventions mirror the rest of billing / memory_plane:
  * TEXT primary key (uuid4 hex) + ISO-8601 timestamps, so the schema ports
    SQLite → Postgres unchanged.
  * One row per (provider, subscription_id) — UNIQUE. The store upserts with a
    monotonic ordering guard on `lemon_updated_at` so a reordered/stale
    webhook can never overwrite newer state.
  * `app_user_id` is the link to OUR user (from meta.custom_data.user_id set
    at checkout) — the join key a future entitlement system will use. It is
    frequently empty in PR 3 because checkout isn't built yet; that's fine.

Pure data + mapping helpers — no I/O, no framework imports.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


# ── Normalized status taxonomy ───────────────────────────────────────────────
# Our internal vocabulary, decoupled from Lemon's exact strings so downstream
# code never hard-codes a provider spelling. `status_raw` preserves the
# original for fidelity/debugging.
STATUS_TRIALING = "trialing"
STATUS_ACTIVE = "active"
STATUS_PAUSED = "paused"
STATUS_PAST_DUE = "past_due"
STATUS_UNPAID = "unpaid"
STATUS_CANCELLED = "cancelled"
STATUS_EXPIRED = "expired"
STATUS_UNKNOWN = "unknown"

VALID_SUBSCRIPTION_STATUSES = frozenset({
    STATUS_TRIALING, STATUS_ACTIVE, STATUS_PAUSED, STATUS_PAST_DUE,
    STATUS_UNPAID, STATUS_CANCELLED, STATUS_EXPIRED, STATUS_UNKNOWN,
})

# Lemon Squeezy subscription.status → our normalized status.
_LEMON_STATUS_MAP = {
    "on_trial": STATUS_TRIALING,
    "active": STATUS_ACTIVE,
    "paused": STATUS_PAUSED,
    "past_due": STATUS_PAST_DUE,
    "unpaid": STATUS_UNPAID,
    "cancelled": STATUS_CANCELLED,
    "expired": STATUS_EXPIRED,
}

# Polar subscription.status → our normalized status (PR #524). Polar distinguishes
# a scheduled cancellation (status stays `active` + cancel_at_period_end=true →
# still entitling until period end, preserving the existing grace rule) from
# `revoked` (access actually ended → not entitling). `incomplete*` are non-entitling.
_POLAR_STATUS_MAP = {
    "trialing": STATUS_TRIALING,
    "active": STATUS_ACTIVE,
    "past_due": STATUS_PAST_DUE,
    "unpaid": STATUS_UNPAID,
    "canceled": STATUS_CANCELLED,
    "cancelled": STATUS_CANCELLED,
    "revoked": STATUS_EXPIRED,
    "incomplete": STATUS_UNKNOWN,
    "incomplete_expired": STATUS_EXPIRED,
}

# Lemon subscription lifecycle events this projection consumes. All carry a
# full `subscriptions` object in data.attributes (unlike the payment events,
# which carry subscription-invoices and are intentionally NOT projected here).
SUBSCRIPTION_LIFECYCLE_EVENTS = (
    "subscription_created",
    "subscription_updated",
    "subscription_cancelled",
    "subscription_resumed",
    "subscription_expired",
    "subscription_paused",
    "subscription_unpaused",
    "subscription_plan_changed",
)

# The resource `data.type` a subscription lifecycle payload carries.
SUBSCRIPTION_RESOURCE_TYPE = "subscriptions"

# Polar subscription lifecycle event names this projection consumes (PR #524).
# `subscription.canceled` = scheduled cancellation (grace until period end);
# `subscription.revoked` = access ended (immediate). `order.*`/`checkout.*` are
# intentionally NOT projected here — subscription truth comes from these events.
POLAR_SUBSCRIPTION_LIFECYCLE_EVENTS = (
    "subscription.created",
    "subscription.updated",
    "subscription.active",
    "subscription.canceled",
    "subscription.uncanceled",
    "subscription.revoked",
)


def normalize_status(raw: Optional[str]) -> Optional[str]:
    """Map a Lemon status string to our vocabulary. Returns None for an empty
    input, STATUS_UNKNOWN for an unrecognised non-empty value (so a new Lemon
    status surfaces as 'unknown' rather than silently dropping the row)."""
    s = (str(raw).strip().lower() if raw is not None else "")
    if not s:
        return None
    return _LEMON_STATUS_MAP.get(s, STATUS_UNKNOWN)


def normalize_polar_status(raw: Optional[str]) -> Optional[str]:
    """Map a Polar status string to our vocabulary. None for empty input,
    STATUS_UNKNOWN for an unrecognised non-empty value."""
    s = (str(raw).strip().lower() if raw is not None else "")
    if not s:
        return None
    return _POLAR_STATUS_MAP.get(s, STATUS_UNKNOWN)


# Column order shared by both store backends so their SQL can never drift.
# (Excludes the store-managed id / created_at / updated_at and the identity
# keys provider / subscription_id, which are handled explicitly.)
DATA_COLUMNS = (
    "status", "status_raw",
    "store_id", "customer_id", "order_id", "product_id", "variant_id", "price_id",
    "product_name", "variant_name",
    "customer_email", "customer_name",
    "card_brand", "card_last_four",
    "app_user_id", "custom_data_json",
    "cancelled", "paused", "pause_mode", "resumes_at",
    "test_mode",
    "trial_ends_at", "renews_at", "ends_at", "billing_anchor",
    "lemon_created_at", "lemon_updated_at",
    "last_event_name", "last_event_id", "last_event_at",
)


def _s(v: Any) -> Optional[str]:
    """Coerce a scalar to a trimmed string, or None."""
    if v is None:
        return None
    s = str(v).strip()
    return s or None


@dataclass
class Subscription:
    """Normalized projection of one subscription's current state."""
    # Identity
    provider: str
    subscription_id: str
    # Status
    status: Optional[str] = None
    status_raw: Optional[str] = None
    # Lemon associations
    store_id: Optional[str] = None
    customer_id: Optional[str] = None
    order_id: Optional[str] = None
    product_id: Optional[str] = None
    variant_id: Optional[str] = None
    price_id: Optional[str] = None
    product_name: Optional[str] = None
    variant_name: Optional[str] = None
    # Customer (PII — owner-only surfaces)
    customer_email: Optional[str] = None
    customer_name: Optional[str] = None
    card_brand: Optional[str] = None
    card_last_four: Optional[str] = None
    # Link to our user + arbitrary checkout metadata
    app_user_id: Optional[str] = None
    custom_data: Dict[str, Any] = field(default_factory=dict)
    # Flags
    cancelled: bool = False
    paused: bool = False
    pause_mode: Optional[str] = None
    resumes_at: Optional[str] = None
    test_mode: bool = False
    # Dates (kept as Lemon-provided ISO strings)
    trial_ends_at: Optional[str] = None
    renews_at: Optional[str] = None
    ends_at: Optional[str] = None
    billing_anchor: Optional[str] = None
    lemon_created_at: Optional[str] = None
    lemon_updated_at: Optional[str] = None
    # Provenance — which webhook last updated this row
    last_event_name: Optional[str] = None
    last_event_id: Optional[str] = None
    last_event_at: Optional[str] = None
    # Store-managed
    id: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

    def data_values(self) -> List[Any]:
        """Values aligned to DATA_COLUMNS for an INSERT/UPSERT. Booleans are
        encoded as 0/1 integers (portable across SQLite/Postgres); custom_data
        is JSON-encoded."""
        return [
            self.status, self.status_raw,
            self.store_id, self.customer_id, self.order_id, self.product_id,
            self.variant_id, self.price_id,
            self.product_name, self.variant_name,
            self.customer_email, self.customer_name,
            self.card_brand, self.card_last_four,
            self.app_user_id, json.dumps(self.custom_data or {}),
            1 if self.cancelled else 0,
            1 if self.paused else 0,
            self.pause_mode, self.resumes_at,
            1 if self.test_mode else 0,
            self.trial_ends_at, self.renews_at, self.ends_at, self.billing_anchor,
            self.lemon_created_at, self.lemon_updated_at,
            self.last_event_name, self.last_event_id, self.last_event_at,
        ]

    @classmethod
    def from_row(cls, row: Any) -> "Subscription":
        """Build a Subscription from a DB row (sqlite3.Row or psycopg dict_row)."""
        def g(key: str) -> Any:
            try:
                return row[key]
            except (KeyError, IndexError, TypeError):
                return None

        raw_custom = g("custom_data_json")
        custom: Dict[str, Any] = {}
        if isinstance(raw_custom, dict):
            custom = raw_custom
        elif raw_custom:
            try:
                parsed = json.loads(raw_custom)
                custom = parsed if isinstance(parsed, dict) else {}
            except Exception:
                custom = {}

        return cls(
            provider=g("provider"),
            subscription_id=g("subscription_id"),
            status=g("status"),
            status_raw=g("status_raw"),
            store_id=g("store_id"),
            customer_id=g("customer_id"),
            order_id=g("order_id"),
            product_id=g("product_id"),
            variant_id=g("variant_id"),
            price_id=g("price_id"),
            product_name=g("product_name"),
            variant_name=g("variant_name"),
            customer_email=g("customer_email"),
            customer_name=g("customer_name"),
            card_brand=g("card_brand"),
            card_last_four=g("card_last_four"),
            app_user_id=g("app_user_id"),
            custom_data=custom,
            cancelled=bool(g("cancelled")),
            paused=bool(g("paused")),
            pause_mode=g("pause_mode"),
            resumes_at=g("resumes_at"),
            test_mode=bool(g("test_mode")),
            trial_ends_at=g("trial_ends_at"),
            renews_at=g("renews_at"),
            ends_at=g("ends_at"),
            billing_anchor=g("billing_anchor"),
            lemon_created_at=g("lemon_created_at"),
            lemon_updated_at=g("lemon_updated_at"),
            last_event_name=g("last_event_name"),
            last_event_id=g("last_event_id"),
            last_event_at=g("last_event_at"),
            id=g("id"),
            created_at=g("created_at"),
            updated_at=g("updated_at"),
        )

    def to_dict(self) -> Dict[str, Any]:
        """Full projection for owner diagnostics (owner-only surfaces — may
        include customer PII)."""
        return {
            "id": self.id,
            "provider": self.provider,
            "subscription_id": self.subscription_id,
            "status": self.status,
            "status_raw": self.status_raw,
            "store_id": self.store_id,
            "customer_id": self.customer_id,
            "order_id": self.order_id,
            "product_id": self.product_id,
            "variant_id": self.variant_id,
            "price_id": self.price_id,
            "product_name": self.product_name,
            "variant_name": self.variant_name,
            "customer_email": self.customer_email,
            "customer_name": self.customer_name,
            "card_brand": self.card_brand,
            "card_last_four": self.card_last_four,
            "app_user_id": self.app_user_id,
            "custom_data": self.custom_data,
            "cancelled": self.cancelled,
            "paused": self.paused,
            "pause_mode": self.pause_mode,
            "resumes_at": self.resumes_at,
            "test_mode": self.test_mode,
            "trial_ends_at": self.trial_ends_at,
            "renews_at": self.renews_at,
            "ends_at": self.ends_at,
            "billing_anchor": self.billing_anchor,
            "lemon_created_at": self.lemon_created_at,
            "lemon_updated_at": self.lemon_updated_at,
            "last_event_name": self.last_event_name,
            "last_event_id": self.last_event_id,
            "last_event_at": self.last_event_at,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


def from_lemon_event(
    *,
    provider: str,
    event_name: Optional[str],
    event_id: Optional[str],
    event_at: Optional[str],
    data: Dict[str, Any],
    meta: Dict[str, Any],
) -> Optional[Subscription]:
    """Map a Lemon Squeezy subscription lifecycle payload to a Subscription.

    Returns None when the payload does not carry a subscriptions object (wrong
    data.type) — the caller decides whether that is an error (a subscription
    event missing its id) or simply not-a-subscription (acknowledge & skip).
    """
    data = data if isinstance(data, dict) else {}
    meta = meta if isinstance(meta, dict) else {}

    if _s(data.get("type")) != SUBSCRIPTION_RESOURCE_TYPE:
        return None
    sub_id = _s(data.get("id"))
    if not sub_id:
        return None

    attrs = data.get("attributes")
    attrs = attrs if isinstance(attrs, dict) else {}
    custom = meta.get("custom_data")
    custom = custom if isinstance(custom, dict) else {}
    pause = attrs.get("pause")
    pause = pause if isinstance(pause, dict) else {}
    fsi = attrs.get("first_subscription_item")
    fsi = fsi if isinstance(fsi, dict) else {}

    raw_status = attrs.get("status")

    return Subscription(
        provider=provider,
        subscription_id=sub_id,
        status=normalize_status(raw_status),
        status_raw=_s(raw_status),
        store_id=_s(attrs.get("store_id")),
        customer_id=_s(attrs.get("customer_id")),
        order_id=_s(attrs.get("order_id")),
        product_id=_s(attrs.get("product_id")),
        variant_id=_s(attrs.get("variant_id")),
        price_id=_s(fsi.get("price_id")),
        product_name=_s(attrs.get("product_name")),
        variant_name=_s(attrs.get("variant_name")),
        customer_email=_s(attrs.get("user_email")),
        customer_name=_s(attrs.get("user_name")),
        card_brand=_s(attrs.get("card_brand")),
        card_last_four=_s(attrs.get("card_last_four")),
        app_user_id=_s(custom.get("user_id")),
        custom_data=custom,
        cancelled=bool(attrs.get("cancelled")),
        paused=bool(pause),
        pause_mode=_s(pause.get("mode")),
        resumes_at=_s(pause.get("resumes_at")),
        test_mode=bool(attrs.get("test_mode")),
        trial_ends_at=_s(attrs.get("trial_ends_at")),
        renews_at=_s(attrs.get("renews_at")),
        ends_at=_s(attrs.get("ends_at")),
        billing_anchor=_s(attrs.get("billing_anchor")),
        lemon_created_at=_s(attrs.get("created_at")),
        lemon_updated_at=_s(attrs.get("updated_at")),
        last_event_name=_s(event_name),
        last_event_id=_s(event_id),
        last_event_at=_s(event_at),
    )


# ── Polar identity reconciliation (PR #524) ──────────────────────────────────
def resolve_polar_identity(external_id: Optional[str], metadata_user_id: Optional[str]) -> Optional[str]:
    """Resolve the authoritative Korvix user id from SIGNED Polar webhook data.

    Preference: `customer.external_id` (set to the Korvix user id at checkout via
    external_customer_id), then signed checkout/subscription `metadata.user_id`.
    If BOTH are present and DISAGREE, returns None (no confident identity) — the
    caller must then grant NOTHING. Email is never used to reconcile identity.
    """
    ext = _s(external_id)
    meta_uid = _s(metadata_user_id)
    if ext and meta_uid:
        return ext if ext == meta_uid else None      # conflict → unresolved
    return ext or meta_uid or None


def _first_price_id(attrs: Dict[str, Any]) -> Optional[str]:
    """Polar price id across the shapes the API has used: `price_id`, `price.id`,
    or the first entry of `prices[]`."""
    pid = _s(attrs.get("price_id"))
    if pid:
        return pid
    price = attrs.get("price")
    if isinstance(price, dict) and _s(price.get("id")):
        return _s(price.get("id"))
    prices = attrs.get("prices")
    if isinstance(prices, list):
        for p in prices:
            if isinstance(p, dict) and _s(p.get("id")):
                return _s(p.get("id"))
    return None


def from_polar_event(
    *,
    event_name: Optional[str],
    event_id: Optional[str],
    event_at: Optional[str],
    data: Dict[str, Any],
    test_mode: bool = False,
) -> Optional[Subscription]:
    """Map a Polar subscription webhook payload's `data` object to a normalized
    Subscription (provider="polar"). Returns None when the subscription id is
    missing (malformed → the caller fails/ignores without mutating state).

    Reuses the SAME Subscription model + columns as Lemon. The Lemon-named
    timestamp columns are treated as GENERIC provider timestamps:
    `lemon_created_at`=Polar created_at, `lemon_updated_at`=Polar modified_at
    (the monotonic ordering guard keys on it). Identity comes only from SIGNED
    data (external_id / metadata.user_id); a conflict yields app_user_id=None so
    NOTHING is granted. Never raises.
    """
    from backend.services.billing.types import PROVIDER_POLAR

    data = data if isinstance(data, dict) else {}
    sub_id = _s(data.get("id"))
    if not sub_id:
        return None

    customer = data.get("customer")
    customer = customer if isinstance(customer, dict) else {}
    product = data.get("product")
    product = product if isinstance(product, dict) else {}
    metadata = data.get("metadata")
    metadata = metadata if isinstance(metadata, dict) else {}

    raw_status = data.get("status")
    status = normalize_polar_status(raw_status)
    cancel_at_period_end = bool(data.get("cancel_at_period_end"))
    # Scheduled cancellation OR an actually-ended subscription both set `cancelled`.
    ended = status in (STATUS_CANCELLED, STATUS_EXPIRED)
    cancelled = cancel_at_period_end or ended

    external_id = _s(customer.get("external_id")) or _s(data.get("customer_external_id"))
    meta_uid = _s(metadata.get("user_id"))
    app_user_id = resolve_polar_identity(external_id, meta_uid)

    # Period end drives the existing grace logic (renews_at ≈ current period end;
    # ends_at is the effective access-end used by the entitlement resolver).
    current_period_end = _s(data.get("current_period_end"))
    ended_at = _s(data.get("ended_at")) or _s(data.get("ends_at"))
    ends_at = ended_at or (current_period_end if cancelled else None)

    # Bounded diagnostic on an identity conflict (no PII); never grants anything.
    custom_data: Dict[str, Any] = dict(metadata) if metadata else {}
    if external_id and meta_uid and external_id != meta_uid:
        custom_data["_identity_conflict"] = True

    return Subscription(
        provider=PROVIDER_POLAR,
        subscription_id=sub_id,
        status=status,
        status_raw=_s(raw_status),
        customer_id=_s(data.get("customer_id")) or _s(customer.get("id")),
        product_id=_s(data.get("product_id")) or _s(product.get("id")),
        variant_id=None,                       # Polar has no variant concept
        price_id=_first_price_id(data),
        product_name=_s(product.get("name")) or _s(data.get("product_name")),
        customer_email=_s(customer.get("email")),
        customer_name=_s(customer.get("name")),
        app_user_id=app_user_id,
        custom_data=custom_data,
        cancelled=cancelled,
        test_mode=bool(test_mode),
        trial_ends_at=_s(data.get("trial_ends_at")) or _s(data.get("trial_end")),
        renews_at=current_period_end or None,
        ends_at=ends_at,
        # Generic provider timestamps (the ordering guard keys on lemon_updated_at).
        lemon_created_at=_s(data.get("created_at")),
        lemon_updated_at=_s(data.get("modified_at")) or _s(data.get("updated_at")),
        last_event_name=_s(event_name),
        last_event_id=_s(event_id),
        last_event_at=_s(event_at),
    )


__all__ = [
    "STATUS_TRIALING", "STATUS_ACTIVE", "STATUS_PAUSED", "STATUS_PAST_DUE",
    "STATUS_UNPAID", "STATUS_CANCELLED", "STATUS_EXPIRED", "STATUS_UNKNOWN",
    "VALID_SUBSCRIPTION_STATUSES", "SUBSCRIPTION_LIFECYCLE_EVENTS",
    "POLAR_SUBSCRIPTION_LIFECYCLE_EVENTS", "SUBSCRIPTION_RESOURCE_TYPE", "DATA_COLUMNS",
    "normalize_status", "normalize_polar_status", "resolve_polar_identity",
    "Subscription", "from_lemon_event", "from_polar_event",
]
