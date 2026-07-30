# Billing Migration — Lemon Squeezy → Polar

Status: **Checkout + verified webhook implemented (PR #524)** on top of the PR #523 foundation.
Production provider is still **Lemon Squeezy** (`BILLING_PROVIDER` default/unset = `lemon_squeezy`).
Polar is technically functional in **sandbox** but is **never selected by default** and requires an
explicit `BILLING_PROVIDER=polar` switch. No production cutover happens in this PR. **No new
production environment variable is required to deploy it** (Polar credentials are dormant until set).

This document is the authoritative plan for the migration. It contains **no secret values**.

### PR #524 — what became real
- **Checkout:** `billing/polar/checkout.py` creates a real Polar hosted checkout (`POST /v1/checkouts`)
  with `external_customer_id` + bounded `metadata` = the authoritative Korvix user id; success_url from
  the backend allowlist; typed errors; URL validation; fail-closed; no secret/full-response logging.
- **Webhook:** `POST /v2/billing/webhooks/polar` (`routes/v2_billing_polar.py`) verifies **Standard
  Webhooks** (`billing/polar/signature.py`, base64 HMAC-SHA256 + timestamp tolerance) BEFORE parse, then
  reuses the SAME inbox → processor → projection with `provider="polar"`.
- **Normalization:** `subscriptions/types.from_polar_event` + `_POLAR_STATUS_MAP` map Polar events into
  the existing normalized `Subscription` (no new table, no `polar_*` columns).
- **Provider strictness:** `resolve_provider_strict()` — empty/unset → lemon; an explicitly UNKNOWN value
  fails closed (checkout 503) instead of silently charging through Lemon.
- **No schema change was required** — Polar data fits the existing generic columns (`renews_at` = current
  period end, `ends_at` = access-end for grace, `cancelled`, `status`/`status_raw`; the `lemon_created_at`/
  `lemon_updated_at` columns are treated as GENERIC provider timestamps, and the ordering guard keys on
  `lemon_updated_at`). A future optional rename to `provider_created_at`/`provider_updated_at` is documented
  below but intentionally NOT executed.

---

## 1. Current Lemon Squeezy architecture (as-is)

The billing subsystem (`backend/services/billing/**`, built across PR 1–8) is already layered and,
in the places that matter for a migration, **provider-parameterised**. The end-to-end path:

```
frontend plan/upgrade UI ................ src/pages/PricingPage.tsx, UpgradeModal.tsx (PRESENTATIONAL ONLY today —
                                          no checkout request is wired; shows "payments coming soon")
  → POST /v2/billing/checkout ............ backend/routes/v2_billing_checkout.py  (auth via resolve_principal; body = {variant, return_url, idempotency_key})
    → checkout service ................... billing/checkout/service.py  (validates selector + return_url, idempotency replay)
      → provider selection (NEW #522) .... billing/provider.resolve_provider()  → lemon_squeezy (default)
      → Lemon API client ................. billing/checkout/client.py  → POST {LEMON_SQUEEZY_API_BASE}/v1/checkouts (Bearer LEMON_SQUEEZY_API_KEY, store LEMON_SQUEEZY_STORE_ID)
        → checkout_data.custom = {user_id} .. the identity linkage echoed back on webhooks
  → checkout URL returned to client ...... {url, plan, selector, idempotent}  (no secrets)

… buyer completes payment on the provider …

  → POST /v2/billing/webhooks/lemon-squeezy .. backend/routes/v2_billing.py  (raw body capped at LEMON_SQUEEZY_WEBHOOK_MAX_BYTES)
    → signature verification ............. billing/signature.py  (constant-time HMAC-SHA256 hex over raw body, header X-Signature, secret LEMON_SQUEEZY_WEBHOOK_SECRET; fails closed)
    → inbox idempotency .................. billing/inbox.py + store  (dedup_key = sha256(raw body); UNIQUE(provider, dedup_key); exactly-once)
    → processor dispatch ................. billing/processor/  (event_name → handler registry; at-most-one claim; retry to BILLING_MAX_PROCESSING_ATTEMPTS)
      → subscription projection .......... billing/subscriptions/  (from_lemon_event → normalized Subscription; UNIQUE(provider, subscription_id); monotonic ordering guard on lemon_updated_at)
      → app_user_id ...................... from meta.custom_data.user_id  (identity from signed provider metadata, NEVER frontend)
  → entitlement resolution ............... billing/entitlements/resolver.py  (subscriptions by app_user_id → plan via BILLING_PLAN_MAP_JSON (variant:/product:/price:) → highest-rank plan; cancelled-in-grace honoured)
  → feature gating / usage quotas ........ billing/entitlements/gating.py, billing/usage/  (consumed by product routes)
  → account/plan display ................. src/lib/plan.ts + PremiumBadge (client state today; no live entitlement fetch)

Cancellation / customer portal: **none exists** (no outbound cancel call, no portal URL). Cancellation is only
*observed* inbound via `subscription_cancelled` → projection sets `cancelled`/status/`ends_at`; entitlements honour the grace.
```

Everything ships **dormant** and **fails closed/safe**: webhook 503 when `ENABLE_BILLING` is off (Lemon retries; no
delivery lost); entitlements/usage/credits degrade to default/no-op when their flags are off.

### Authoritative sources (single owners)
| Concern | Owner |
|---|---|
| Plan definitions | `BILLING_PLAN_CATALOG_JSON` / `_PATH` (built-in `free` only in code) |
| Provider product/price → plan | `BILLING_PLAN_MAP_JSON` (`variant:` / `product:` / `price:` keys) |
| Purchasable catalog (checkout) | `BILLING_CHECKOUT_VARIANTS_JSON` (selector → variant/product/price + plan) |
| Subscription state | `billing_subscriptions` table, `UNIQUE(provider, subscription_id)` |
| Entitlement computation | `billing/entitlements/resolver.py` (authoritative; providers only report commercial state) |
| User ↔ customer mapping | `Subscription.app_user_id` from `meta.custom_data.user_id` |
| Billing period | `renews_at` / `ends_at` / `trial_ends_at` / `billing_anchor` (Lemon-named columns) |
| Idempotency ledger | `billing_webhook_events` inbox, `dedup_key = sha256(raw body)` |
| Cancellation state | `Subscription.cancelled` + status `cancelled` + `ends_at` grace |

### What is already provider-neutral (reuse — do NOT duplicate)
- `provider` column on the inbox **and** subscription tables (open string, part of every UNIQUE index).
- Normalized subscription **status taxonomy** (`normalize_status`, `status_raw` preserves the original).
- The **event → handler registry** dispatch seam.
- Config-driven **plan catalog + id-map** (data, not code).

### What is still Lemon-coupled (the real migration surface, for PR #524)
- `checkout/client.py` — Lemon `/v1/checkouts` JSON:API shape + Bearer auth.
- `subscriptions/types.py:from_lemon_event` + the `lemon_created_at` / `lemon_updated_at` columns and the
  ordering guard keyed on `lemon_updated_at`.
- `types.py:parse_event_fields` — assumes Lemon JSON:API (`meta.event_name`, `data.type`, `data.id`).
- `signature.py` — hex HMAC-SHA256 + `X-Signature`. **Polar uses a base64 Standard-Webhooks scheme** →
  needs a per-provider verification strategy.
- Lemon event-name spellings used directly as registry keys.
- The entirely-missing **cancellation + customer-portal** outbound flows.

---

## 2. Proposed Polar architecture (to-be)

Reuse every neutral piece above. Add, per provider, only the parametrised edges:

```
POST /v2/billing/checkout → service → resolve_provider()==polar → billing/polar/checkout.py
   → Polar POST {api_base}/v1/checkouts  (Bearer POLAR_ACCESS_TOKEN, org POLAR_ORGANIZATION_ID, product/price from the variant)
   → metadata = {user_id}  (echoed on Polar webhooks)

POST /v2/billing/webhooks/polar (NEW route, PR #524; disabled + fails closed until then)
   → verify Standard-Webhooks signature (POLAR_WEBHOOK_SECRET, base64)  [per-provider strategy]
   → SAME inbox (provider="polar") → SAME processor → from_polar_event → SAME Subscription table → SAME entitlement resolver
```

- **Provider selection** is `BILLING_PROVIDER` (backend-only). Default `lemon_squeezy`; unknown → `lemon_squeezy` (fail-safe).
- **Normalized event vocabulary** (`billing/provider.py`): `checkout.completed`, `subscription.created|updated|canceled|revoked`,
  `payment.succeeded|failed`, `refund.created`. Both providers map onto it (Lemon map already provided, dormant).
- **Entitlements stay authoritative.** A provider event → normalized subscription state → existing Korvix plan
  projection → existing entitlement/credit rules. No second entitlement engine. No grant from checkout creation,
  redirect success, unverified webhooks, unknown products, or malformed events.

### Schema change — NOT required by PR #524 (optional future cleanup only)
PR #524 needed **no schema change**: Polar data maps onto the existing generic columns
(`renews_at`=current period end, `ends_at`=access-end for grace, `cancelled`, `status`/`status_raw`,
`trial_ends_at`, `customer_id`/`subscription_id`/`product_id`/`price_id`, `test_mode`; the
`lemon_created_at`/`lemon_updated_at` columns hold the generic provider timestamps and the ordering guard
keys on `lemon_updated_at`). Fields Korvix does not consume for entitlement (`current_period_start`,
`canceled_at`) are intentionally not persisted (or ride `custom_data`).

An **optional, additive, backward-compatible** cleanup may later rename the Lemon-prefixed timestamp
columns to generic ones — do NOT execute it as part of the migration unless needed:
```
-- OPTIONAL future migration (not required for Polar to work):
ALTER TABLE billing_subscriptions ADD COLUMN provider_created_at TEXT;   -- = lemon_created_at
ALTER TABLE billing_subscriptions ADD COLUMN provider_updated_at TEXT;   -- = lemon_updated_at (re-key the guard)
-- backfill provider_* from lemon_*, then retire lemon_* after all readers move.
```

---

## 3. Provider boundary (what PR #522 added)

| Addition | File | Behaviour |
|---|---|---|
| `PROVIDER_POLAR`, `KNOWN_PROVIDERS` | `billing/types.py` | Declares Polar; no migration (open string column already accepts it). |
| `resolve_provider()`, `is_known_provider()` | `billing/provider.py` | Backend-only selector; default + fail-safe `lemon_squeezy`. |
| Normalized event vocabulary + Lemon map | `billing/provider.py` | Dormant; documents the lifecycle both providers target. |
| Polar config accessors | `billing/polar/config.py` | Dynamic, all default empty → unconfigured; sandbox default; secrets never logged. |
| Polar checkout adapter (fail-closed) | `billing/polar/checkout.py` | Raises `CheckoutProviderUnavailable` (503); never returns a URL; no fallback to Lemon. |
| `CheckoutProviderUnavailable` | `billing/checkout/errors.py` | Typed 503 for a selected-but-unimplemented provider. |
| Provider seam in checkout | `billing/checkout/service.py` | `polar → fail closed`, else Lemon (byte-for-byte PR-7 path). |
| Neutral variant fields | `billing/checkout/types.py`, `catalog.py` | Optional `provider`/`product_id`/`price_id` (default lemon); public dict unchanged. |
| Config docs + validation | `backend/core/config.py` | `BILLING_PROVIDER` + `POLAR_*` documented; validate warns if `polar` selected. |

---

## 4. Migration phases

1. **Foundation (this PR #522).** Provider seam + Polar stub, dormant. Lemon unchanged.
2. **Polar implementation (PR #524).** Real Polar checkout client, `from_polar_event`, Polar webhook route
   (Standard-Webhooks verification), optional schema columns. Behind `BILLING_PROVIDER=polar`, tested in Polar **sandbox**.
3. **Dual-provider validation.** Lemon live in production; Polar validated in sandbox with test events. Verify
   idempotency, identity mapping, plan projection, cancellation-at-period-end, refunds.
4. **Cutover.** Flip `BILLING_PROVIDER=polar` (production Polar creds set). Monitor.
5. **Lemon removal.** Only after cutover is proven: remove Lemon client/parse/signature code, then Lemon env vars.

---

## 5. Security rules
- All provider secrets are **backend-only** (`os.getenv` in `backend/**`); **never** a `VITE_*` var. (Audited: no billing secret is in any VITE var.)
- Webhook signature verification is **constant-time** over the **raw request body**, verified **before** JSON parse; missing secret → fail closed (503).
- No secret logging; no full webhook-payload logging; checkout URLs (which carry a token) are never logged.
- Strict **product/plan allowlist**; an unknown product/variant/price is skipped and grants nothing.
- Identity is resolved from **signed provider metadata** + the existing account mapping — never from a frontend-supplied id.
- Billing/entitlement mutations **fail closed** (never grant on error). Optional billing UI reads may fail soft.

## 6. Idempotency rules
- Dedup key = **sha256(raw body)** on `UNIQUE(provider, dedup_key)` → exactly-once ingestion; duplicate delivery → HTTP 200, no re-processing.
- Subscription upserts use a **monotonic ordering guard** so a reordered/stale webhook never regresses state.
- Polar reuses the SAME inbox + guard with `provider="polar"`.

## 7. Rollback
- Set (or keep) `BILLING_PROVIDER=lemon_squeezy` — instant, no restart, no data migration.
- Or revert PR #522. No schema change was made; nothing to undo in the DB.

## 8. Cutover readiness (definition)
Polar may become the production provider only when ALL hold:
- Polar checkout creates a real hosted checkout in **production** and links `user_id` via metadata.
- Polar webhook route verifies signatures (constant-time), is idempotent, and projects into the SAME subscription table.
- Entitlements resolve correctly from Polar subscriptions (plan map updated with Polar product/price ids).
- Cancellation-at-period-end, grace, trial, refund, and failed-payment states are verified in sandbox.
- Monitoring shows no duplicate grants, no stale state, no identity mismatch over a burn-in window.

## 9. Lemon removal readiness (definition)
Lemon code/vars may be removed only when ALL hold:
- `BILLING_PROVIDER=polar` has run in production without incident for the agreed monitoring window.
- Repository-wide search proves no active consumer of each Lemon var remains (see the env audit in the PR).
- No active Lemon subscription still needs its webhooks projected (or a reconciliation has migrated them).

---

## 10. Environment variable mapping (summary; full A–J audit in the PR description)

| Lemon (today) | Polar (later) | Kind |
|---|---|---|
| `LEMON_SQUEEZY_API_KEY` | `POLAR_ACCESS_TOKEN` | secret, semantic |
| `LEMON_SQUEEZY_STORE_ID` | `POLAR_ORGANIZATION_ID` | semantic (store→org model) |
| `LEMON_SQUEEZY_API_BASE` | `POLAR_API_BASE` / `POLAR_SERVER` | endpoint |
| `LEMON_SQUEEZY_WEBHOOK_SECRET` | `POLAR_WEBHOOK_SECRET` | secret, semantic (hex HMAC → base64 Standard-Webhooks) |
| `BILLING_CHECKOUT_VARIANTS_JSON` (variant_id) | same key, add `provider`/`product_id`/`price_id` | data-only remap |
| `BILLING_PLAN_MAP_JSON` (`variant:`) | same key, add `product:`/`price:` entries | data-only remap |
| _all other_ `BILLING_*` / `ENABLE_BILLING*` | **unchanged** (provider-neutral) | keep |

New selector: **`BILLING_PROVIDER`** (default `lemon_squeezy`). Not required to deploy this PR.

> **Correction to the PR #523 audit:** `LEMON_SQUEEZY_WEBHOOK_MAX_BYTES` is **not** an optional *final Polar*
> variable. It exists **only while the Lemon webhook route/config consumer exists** and is **removed after the
> Lemon webhook route is removed** (post-cutover), alongside the other `LEMON_SQUEEZY_*` vars. The Polar webhook
> route reuses the SAME `billing_config.max_body_bytes()` cap (currently backed by that same env), so a future
> generic rename (`BILLING_WEBHOOK_MAX_BYTES`) is the clean end-state; until then the cap stays Lemon-named.
