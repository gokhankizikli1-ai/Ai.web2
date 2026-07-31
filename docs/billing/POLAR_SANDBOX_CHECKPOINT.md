# Polar Sandbox Billing — Working Checkpoint

A snapshot of the **known-good** Polar sandbox billing flow so future debugging is
fast. This is documentation only — it changes no billing logic, config, or values.

**Contains names, paths and steps only. No secrets, tokens, product IDs, emails,
webhook payloads, or personal data.** All values live in Railway / Vercel / the
Polar dashboard, never in Git.

Related docs: `docs/billing/POLAR_MIGRATION.md` (architecture), `docs/billing/billing.env.example` (variable names + placeholders).

---

## 1. Working request flow (end to end)

```
Frontend pricing/upgrade CTA
  → POST /v2/billing/checkout            (authenticated; sends ONLY the Korvix plan selector)
  → Polar hosted checkout                (payment completes in Polar sandbox)
  → redirect back to Korvix              → /billing/return  (public, session-aware; grants nothing from the URL)
      └ the SPA bridges the path onto the HashRouter route and polls the authoritative snapshot

Polar → POST /v2/billing/webhooks/polar  (Standard-Webhooks signature verified over the RAW body, before parse)
  → HTTP 200: durably stored in the billing inbox (idempotent; dedup on sha256(raw body))
  → processor consumes the event  → billing_subscriptions projection row (provider="polar")
      └ app_user_id linked from signed customer.external_id / metadata.user_id
      └ product_id mapped to an internal plan key via BILLING_PLAN_MAP_JSON

Authoritative read:
  GET /v2/billing/me  → { plan, status, provider, active, source }
  → useBillingPlan (frontend) → badge / sidebar / pricing all show the resolved plan
```

Key invariant: **HTTP 200 on the webhook means "accepted + stored", not "projected".**
Projection happens in the processor step (see §6). Access is only ever granted from
the backend snapshot — never from checkout redirect, query params, or the browser.

---

## 2. Required Railway variable NAMES (backend) — values never in Git

Set these on the backend service (see `billing.env.example` for shapes/placeholders):

| Name | Purpose |
|---|---|
| `ENABLE_BILLING` | Master gate: accept + store webhook deliveries. |
| `ENABLE_BILLING_PROCESSOR` | Consume stored events → projection. **Must be true** or events stay `stored`. |
| `ENABLE_BILLING_SUBSCRIPTION_PROJECTION` | Registers the projection handler (defaults on). |
| `ENABLE_BILLING_ENTITLEMENTS` | Lets the resolver read subscriptions → plan. **Must be true** or everyone resolves to the default (Free). |
| `ENABLE_BILLING_CHECKOUT` | Gate for `POST /v2/billing/checkout`. |
| `BILLING_PROVIDER` | Active provider selector (`polar` to activate Polar; unset/`lemon_squeezy` keeps Lemon). |
| `POLAR_ACCESS_TOKEN` | **Secret.** Polar Organization Access Token (Bearer). |
| `POLAR_ORGANIZATION_ID` | Polar organization id. |
| `POLAR_WEBHOOK_SECRET` | **Secret.** Store the RAW dashboard secret exactly — no wrapping quotes. Sandbox ≠ production secret. |
| `POLAR_SERVER` | `sandbox` (default) or `production`. |
| `BILLING_CHECKOUT_VARIANTS_JSON` | Purchasable selectors → provider product ids (backend allowlist). |
| `BILLING_PLAN_MAP_JSON` | Provider id → internal plan key (see §5). |
| `BILLING_PLAN_CATALOG_JSON` | Optional plan overrides; built-in labeled plans cover the standard tiers. |
| `OWNER_EMAILS` (or `OWNER_EMAIL` / `OWNER_ID`) | Identity allow-list for the owner-only `/v2/admin/billing/*` diagnostics. |
| `ENABLE_ADMIN_MODE` | Must be on for the `/v2/admin/*` routes to exist. |

> Secret hygiene: `POLAR_ACCESS_TOKEN` and `POLAR_WEBHOOK_SECRET` are backend-only,
> never mirrored to a `VITE_` var, never logged. Store the webhook secret with **no
> surrounding quotes** (the accessor trims whitespace but not quotes).

## Required Vercel flag NAMES (frontend)

| Name | Purpose |
|---|---|
| `VITE_ENABLE_CHECKOUT` | Turns the wired checkout CTAs on (boolean; not a secret; no provider ids). |
| `VITE_API_URL` | Backend base URL the frontend calls. |

---

## 3. Sandbox webhook endpoint + selected events

- **Endpoint path:** `POST /v2/billing/webhooks/polar`
- **Signature:** Standard Webhooks (`webhook-id` / `webhook-timestamp` / `webhook-signature`);
  HMAC key = the **raw dashboard secret's UTF-8 bytes** (Polar base64-encodes the secret and
  the verifier decodes it back — net raw bytes). Verified over the RAW body, before JSON parse.
- **Subscribe these subscription events** (the projected lifecycle):
  - `subscription.created`
  - `subscription.updated`
  - `subscription.active`
  - `subscription.canceled`
  - `subscription.uncanceled`
  - `subscription.revoked`

`order.*` / `checkout.*` events are accepted and deduped but are **not** the source of
subscription truth. A duplicate delivery is idempotent (HTTP 200, no re-processing).

---

## 4. Internal plan keys vs user-facing labels

Internal keys are **stable** (renaming would break stored subscriptions / mappings);
only the display label differs.

| Internal key | Display label |
|---|---|
| `free` | Free |
| `basic` | Starter |
| `pro` | Pro |
| `ultra` | Max |
| `enterprise` | Enterprise |

`BILLING_PLAN_MAP_JSON` maps provider ids to the **internal keys** using the key
convention `product:<id>` / `price:<id>` / `variant:<id>` → `basic|pro|ultra|enterprise`
(precedence: variant → product → price). Never put live product ids in Git.

---

## 5. Plan mapping shape (names only)

`BILLING_PLAN_MAP_JSON` is a JSON object of `"<prefix>:<provider-id>": "<internal-key>"`,
e.g. `product:<polar-pro-product-id>` → `pro`. Configure it in Railway; the ids belong
in Railway/the Polar dashboard, not here.

The resolver picks the **highest-rank** entitling subscription (`active`/`trialing`, plus a
cancelled-in-grace subscription). An **unmapped** product grants nothing (fail-closed → Free).

---

## 6. Correct processor sequence (why 200 ≠ Pro)

Ingestion and consumption are **separate gates**:

1. `ENABLE_BILLING=true` → the webhook returns **200** and stores the event as `stored`.
2. `ENABLE_BILLING_PROCESSOR=true` → the event is **consumed** into a `billing_subscriptions` row.
   - With `BILLING_PROCESS_INLINE=true` (default) a **new** delivery is projected inline right
     after storage — no separate worker needed.
   - An **already-stored** event (ingested while the processor was off) needs one drain:
     owner-only `POST /v2/admin/billing/process`, or a Polar **redelivery** (processed inline).
3. `ENABLE_BILLING_ENTITLEMENTS=true` → the resolver reads the row → `GET /v2/billing/me`
   returns the plan.

> While `ENABLE_BILLING_PROCESSOR` is off, `POST /v2/admin/billing/process` and
> `/webhooks/{id}/retry` are **no-ops** (`enabled:false`). Enable the flag first, then process.

---

## 7. Owner-only diagnostics (read-only)

`/v2/admin/billing/*` requires owner authorization. The gate is **identity-first**: a signed-in
user with an email is owner **only** if that email is in `OWNER_EMAILS`/`OWNER_EMAIL` (or the id
in `OWNER_ID`) — the owner token is ignored on the identity path. To use the token path instead,
call the endpoint **without** an `Authorization` Bearer, sending only `X-Korvix-Owner-Token`.

Useful read-only endpoints:

| Endpoint | Shows |
|---|---|
| `GET /v2/admin/billing/readiness` | Config-readiness booleans + counts (no secrets). |
| `GET /v2/admin/billing/webhooks` | Recent deliveries (metadata; status/attempts, no payload). |
| `GET /v2/admin/billing/subscriptions?app_user_id=<uid>` | Projected rows for a user. |
| `GET /v2/admin/billing/plans` | Loaded catalog + plan_map. |
| `GET /v2/admin/billing/entitlements/<uid>` | Resolved plan + source for a user. |
| `POST /v2/admin/billing/process` | Drain stored events (owner-only; enabled only when the processor is on). |

---

## 8. Safe sandbox retest checklist

Read-only unless noted; no code or variable changes required.

1. Confirm the backend is running the intended commit (deploy status / `/v2/health` metadata).
2. `GET /v2/admin/billing/readiness` → `server: sandbox`, `readyForSandboxCheckout: true`, `missing: []`.
3. Start a checkout from the pricing UI → request body is **only** `{ "variant": "pro_monthly" }` → redirected to Polar.
4. Complete the sandbox payment → land on `/billing/return` (shows "confirming", never grants from the URL).
5. In Polar, **Resend** the `subscription.active` event (fresh timestamp) → endpoint returns **200**.
6. `GET /v2/admin/billing/webhooks` → the event status is **`processed`**.
7. `GET /v2/admin/billing/subscriptions?app_user_id=<uid>` → an `active` row with the mapped product.
8. `GET /v2/admin/billing/entitlements/<uid>` → `pro`.
9. `GET /v2/billing/me` → `{ plan: "pro", active: true, source: "subscription" }`; badge/sidebar show **Pro**.
10. Sign in with an unsubscribed account → resolves to **Free**; switching accounts never carries the plan.

---

## 9. Expected diagnostic results (known-good)

- Webhook delivery: HTTP **200**, inbox status **`processed`** (not `stored`/`failed`).
- Subscription row: exists, `provider = polar`, `app_user_id` = the purchasing Korvix user, a
  present `provider_customer_id` + `provider_subscription_id`, `product_id` mapped in `BILLING_PLAN_MAP_JSON`,
  normalized status **`active`**.
- Entitlements: `plan_key = pro`, `source = subscription`.
- `GET /v2/billing/me`: `{ plan: "pro", active: true, source: "subscription" }`.
- Frontend: top-right badge + sidebar + pricing show **Pro**; current plan is **not** re-purchasable.

If any step diverges: `stored` → processor off / not drained (§6); `failed` or `product not in map`
→ fix `BILLING_PLAN_MAP_JSON`; row with null `app_user_id` → subscription not linked to a Korvix
identity at checkout; `source: default` despite an active mapped row → resolver/read issue.

---

## 10. Rollback guidance

- **Disable Polar without data loss:** set `BILLING_PROVIDER=lemon_squeezy` (or unset) — instant,
  no restart, no data migration. Lemon remains the default and is not removed.
- **Pause consumption:** set `ENABLE_BILLING_PROCESSOR=false` — deliveries still return 200 and
  accumulate as `stored` (nothing lost); drain later once re-enabled.
- **Hide the frontend checkout:** unset `VITE_ENABLE_CHECKOUT` — CTAs revert to their prior behavior.
- No schema or data migration is involved in any of the above. Secrets are rotated only in the
  Polar dashboard + Railway, never in Git.
