# Phase 1 — Authentication Audit & Implementation Plan

**Source of truth:** `claude/advanced-trading-intelligence-s81Jc @ fb83bdc` (re-verified against actual files)
**Date:** 2026-06-25 (REVISED)
**Status:** AUDIT — awaiting re-approval after correction
**Author:** Engineering — pre-implementation review

---

## ⚠️ Correction notice — supersedes earlier version of this doc

The prior version of this audit (commit `fb83bdc`) described an authentication system that **does not exist in this repository**. Specifically, it claimed:

- A "System A" of legacy routes (`/auth/signup`, `/auth/login`, `/auth/google`, `/auth/apple`, `/auth/me`, `/auth/logout`) — these routes **do not exist**. `backend/routes/auth.py` is a 7-line stub returning `{"authenticated": False}` for `GET /auth/status`.
- A `backend/services/auth/passwords.py` module with PBKDF2-200k hashing, a separate `auth_password_users` table, and a "timing-equalisation" path — **this file does not exist**. No email/password code exists anywhere in the backend.
- A "two-table identity split" (catalogued as **S2 🔴 CRITICAL**) — **does not exist**. There is only one identity table, `auth_users`.
- A `_resolve_user_id` function in `backend/routes/v2_chat_stream.py` that base64-decodes JWTs without signature verification (catalogued as **S1 🔴 CRITICAL**) — **this function does not exist**. `v2_chat_stream.py` has no per-user resolution at all; ownership of requests is handled by `AuthMiddleware` which uses `tokens.verify()` (full HS256 signature check).
- A 986-line `src/pages/AuthPage.tsx` with split-login-flow refactor pressure — **the file is 211 lines** and is a UI-only stub. `handleSubmit` runs a `setTimeout` and renders "Authentication backend not connected yet". No HTTP calls.
- A `src/stores/authStore.ts` Zustand store with `partialize`, `apiLogin`, `apiSignup`, `apiGoogle`, `apiLogout`, `apiMe`, cross-account artifact scrubbing — **this file does not exist**. There is no `src/stores/` directory.

The right inference from these corrections is **stronger**, not weaker: KorvixAI is exactly what your original brief said — a guest-only application. There is **no authenticated-user surface to refactor**. Phase 1 is not patch-and-tighten; Phase 1 is **build the production auth stack from scratch on top of the existing guest substrate**.

The existing guest substrate is well-built and worth keeping verbatim. The rest of this document re-grounds the analysis and re-issues the implementation plan.

---

## Approved decisions (locked 2026-06-25)

| # | Decision | Choice |
|---|---|---|
| 1 | Refresh-token storage | **httpOnly Secure SameSite=Lax cookie** |
| 2 | Password hashing | **Argon2id** (via `argon2-cffi`) |
| 3 | Migration strategy | **Zero-downtime silent migration** whenever possible |
| 4 | Transactional email provider | **Resend** (HTTP API, no SDK) |
| 5 | Apple Sign-In | **Defer** (post-Phase 1) |
| 6 | Magic Links | **Defer until core auth is stable** |
| 7 | **Guest Account Merge** | **First-class architectural pillar** (new — see §5) |

---

## Part I — Current authentication state, verified against files

### 1.1 Endpoints that exist

| Endpoint | Method | File | Purpose |
|---|---|---|---|
| `/v2/auth/guest` | POST | `routes/v2_auth.py:67` | Create / return guest user. Idempotent on `stable_nonce`. Issues access + refresh tokens. |
| `/v2/auth/refresh` | POST | `routes/v2_auth.py:92` | Rotate refresh-token pair. Theft detection: reuse-of-revoked → revoke whole family + 401. |
| `/v2/auth/me` | GET | `routes/v2_auth.py:115` | Return authenticated user. Guests get 401 via `require_auth`. |
| `/v2/auth/logout` | POST | `routes/v2_auth.py:126` | Revoke the refresh-token family. Idempotent. |
| `/auth/status` | GET | `routes/auth.py:5` | Returns `{"authenticated": False}`. Stub — appears unused. |

That is the complete authentication surface. No signup, no login, no OAuth callback, no password reset, no email verification.

### 1.2 Code that exists in `backend/services/auth/`

```
__init__.py        re-exports
identity.py        User dataclass; VALID_KINDS = {guest, email, google, github, apple}
                   (email/google/github/apple are RESERVED — no code consumes them yet)
tokens.py          Stdlib HS256 JWT. Algorithm-pinned. alg=none rejected.
                   Timing-safe hmac.compare_digest. Reads JWT_SECRET_KEY dynamically.
                   Refuses to issue in non-development if secret missing.
                   Dev fallback `b"insecure-dev-key-do-not-use-in-production"` (warning logged).
service.py         create_guest, rotate_refresh (theft detection),
                   logout, identity_for_access_token.
storage.py         SQLite auth.db.
                   auth_users(id, kind, external_id, display_name, created_at,
                              last_seen_at, metadata_json)
                              UNIQUE(kind, external_id).
                   auth_refresh_tokens(jti PK, user_id FK CASCADE,
                                       family_id, created_at, expires_at, revoked_at).
errors.py          MissingTokenError, InvalidTokenError, ExpiredTokenError,
                   RevokedTokenError.
```

`passwords.py` does **not** exist.

### 1.3 Middleware

`backend/middleware/auth.py` — `AuthMiddleware`:
- Reads `Authorization: Bearer <jwt>`.
- Verifies via `auth_service.identity_for_access_token()` → `tokens.verify()` (full signature check) → DB lookup.
- On miss, mints a guest tied to `X-Korvix-Guest-Id` (idempotent — same nonce → same user row).
- Opt-in via `ENABLE_AUTH_V2=true`.
- Sets `request.state.{user, is_guest, auth_kind, auth_token, user_id}`.
- **Does NOT** decode JWTs anywhere outside `tokens.verify()`. No base64 shortcuts.

### 1.4 FastAPI dependencies

`backend/core/deps.py`:
- `current_user(request)` — reads `request.state.user`, falls back to a synthetic guest. **No JWT decoding here.** (My prior audit was wrong on this point.)
- `require_auth(request)` — raises `MissingTokenError` if guest.
- `require_owner(request)` — `require_auth` + `is_owner` check.

### 1.5 Frontend state

`src/pages/AuthPage.tsx` (211 lines):
- UI shell for sign-in/sign-up + Google/Apple buttons + "Continue as Guest".
- `handleSubmit` and `handleSocial` are **stubs** — they show "Authentication backend not connected yet. Please continue as guest."
- No `fetch`, no API calls.

`src/stores/` does not exist. No Zustand auth store. No `apiLogin`/`apiSignup`.

`localStorage` keys referenced (read-only by `useOwnerMode.ts`, `useChat.ts`, `AdminPanel.tsx`):
- `korvix_access_token` — **never written by any FE code**. Used by `useOwnerMode` for owner-token bearer. Source unclear; likely manual dev-tools setting.
- `korvix_user_id` — `useChat.ts` uses as a per-browser identity key, but I found no write site in the searched FE either.

This means the **frontend has no working auth path at all today**. Users land on `AuthPage.tsx`, see the stub, click "Continue as Guest", navigate to `/chat`, and the chat flow uses whatever guest scheme the BE middleware applies.

### 1.6 Subsystems that consume identity

Every owner-bearing route uses `Depends(current_user)` and trusts `user.id` for ownership. Verified in:

- `routes/v2_memory.py` — `current_user`, with comment: "Auth-bound; user_id is derived from the JWT (via current_user), NEVER from the request body, so no caller can spoof another user."
- `routes/v2_sessions.py` — `current_user` on every route.
- `routes/v2_agent.py` — `current_user`.
- `routes/v2_admin.py` — `require_owner`.

So the identity-attribution layer is sound; what's missing is a way for a user to **become** anything other than a guest.

### 1.7 Owner mode

`backend/services/admin/owner.py` (per audit) — `is_owner(user)` with `ENABLE_ADMIN_MODE` kill-switch and `OWNER_TOKEN` fallback. Stays as-is. Phase 1 does not touch owner mode.

---

## Part II — Real security findings (re-issued)

The prior S1 + S2 critical findings were spurious. Re-graded against the actual code:

| ID | Severity | Real issue | File | Fix |
|---|---|---|---|---|
| **R1** | 🟡 Medium | `tokens.py:_secret()` falls back to `b"insecure-dev-key-do-not-use-in-production"` when `ENVIRONMENT="development"` **OR** `settings.DEBUG=True`. If a production Docker image has `DEBUG=True` (e.g. leftover from staging tag), JWTs get signed with the public dev key. | `services/auth/tokens.py:92-119` | Refuse fallback unless **both** `ENVIRONMENT="development"` **and** the process is not bound to a public network. Hard-fail otherwise. |
| **R2** | 🟡 Medium | No minimum length check on `JWT_SECRET_KEY`. A 1-char prod value would be accepted. | `services/auth/tokens.py:_secret()` | Reject keys < 32 bytes. |
| **R3** | 🟢 Low | `auth.db` is local SQLite. Acceptable for single-instance Railway. Will need a Postgres path before horizontal scaling (Phase 2). | `services/auth/storage.py` | Note — defer to Phase 2 architecture work. |
| **R4** | 🟢 Low | `routes/auth.py` is a 7-line stub but the `/auth` prefix is squatted. If we later want `/auth/login` to live elsewhere we'll trip over this. | `routes/auth.py` | Either retire and free the prefix, or use it as the home for the new email/password routes. |
| **R5** | 🟢 Low | `auth_users` lacks `kind=email` columns (email, password_hash, email_verified_at). Schema needs additive migration before signup/login can land. | `services/auth/storage.py` | Phase 1 PR #2 — additive `ADD COLUMN` migration. |
| **R6** | 🟢 Low | No rate limiting on `/v2/auth/refresh` or `/v2/auth/guest`. A hostile client can mint guests indefinitely. Tomorrow's signup/login routes will need the same protection. | `routes/v2_auth.py` | Phase 1 PR #9 — IP+user token bucket. |

The originally claimed S1 (JWT-sub spoof) and S2 (two-table split) are **withdrawn**.

---

## Part III — What Phase 1 must build (scope grounded in reality)

| Capability | Status | Phase 1 PR |
|---|---|---|
| HS256 JWT issue/verify | ✅ Exists, production-quality | — |
| Refresh-token rotation + theft detection | ✅ Exists, textbook-correct | — |
| AuthMiddleware (verify or guest fallback) | ✅ Exists | — |
| Guest creation (idempotent on browser nonce) | ✅ Exists | — |
| Single identity table `auth_users` | ✅ Exists | extended in PR #2 |
| Owner mode | ✅ Production-grade | — |
| `JWT_SECRET_KEY` prod hardening | ❌ Insecure dev fallback can leak | **PR #1** |
| Email + password sign-up + sign-in | ❌ Does not exist | **PR #3** |
| Argon2id password hashing | ❌ Does not exist | **PR #2** |
| Google OAuth | ❌ Does not exist | **PR #5** |
| Apple Sign-In | ❌ Deferred per decision #5 | post-Phase 1 |
| Magic Links | ❌ Deferred per decision #6 | post-Phase 1 |
| Email verification (Resend) | ❌ Does not exist | **PR #6** |
| Password reset (Resend) | ❌ Does not exist | **PR #6** |
| Refresh token in httpOnly cookie | ❌ Currently returned in JSON body | **PR #7** |
| Frontend auth wiring (api client + store) | ❌ Page is UI-only stub | **PR #8** |
| **Guest Account Merge** | ❌ Does not exist | **PR #4** (architectural foundation) |
| Rate limiting + audit log | ❌ Does not exist | **PR #9** |
| Runbook + ADRs | ❌ Does not exist | **PR #10** |

---

## Part IV — Future compatibility (designed in, not bolted on)

| Future feature | Phase 1 hooks |
|---|---|
| **Organizations / multi-tenancy** | `auth_users` keeps a singleton-tenant default; PR #2 adds `metadata_json.org_id = null` reservation. Tables that bind ownership use `(user_id, org_id)` composite keys ready to roll. No schema break later. |
| **RBAC** | PR #2 reserves `metadata_json.roles = []`. Owner-mode hook in PR #4's merge service centralises role grants. |
| **Stripe billing** | PR #2 reserves `metadata_json.stripe_customer_id = null`. Webhook handler is a Phase-2 add. |
| **API keys** | PR #2 reserves `metadata_json.api_keys_enabled = false`. Distinct table `api_keys(user_id, prefix, hash, ...)` lands in a later PR; identity stays unchanged. |
| **Enterprise SSO (OIDC / SAML)** | `kind` discriminator already supports new values. Storage requires no change to add `kind="oidc:<tenant>"`. |
| **MFA** | PR #3 reserves `metadata_json.mfa_factors = []`. PR #6's email path is the natural first factor (already wired). TOTP is post-Phase 1. |

---

## Part V — Guest Account Merge architecture (first-class pillar)

This is the architectural piece that determines whether a guest's accumulated state survives sign-up. The guarantee KorvixAI must provide: **a guest can sign up and seamlessly continue using the product without losing any existing data**.

### 5.1 Inventory of owner-bearing state to merge

Every store that records `user_id` (or `owner_id`) ownership must implement a merge protocol. Verified data domains as of `claude/advanced-trading-intelligence-s81Jc @ fb83bdc`:

| Domain | Service | Storage |
|---|---|---|
| Identity (the User row itself) | `services/auth` | `auth_users`, `auth_refresh_tokens` |
| Memory plane (memories, embeddings) | `services/memory_plane` | `memory_plane.db` (SQLite) **and** Postgres backend |
| Sessions (workspaces, threads, messages) | `services/sessions` | `sessions.db` |
| Background jobs | `services/jobs` | `jobs.db` |
| Assets (uploads + on-disk files) | `services/assets` | `assets.db` + `ASSETS_STORAGE_LOCAL_ROOT/<user_id>/...` |
| Vision pipeline | `services/vision` | `vision.db` |
| Workflows | `services/workflows` | `workflows.db` |
| Agent tasks | `services/agent_tasks` | `agent_tasks.db` |
| Scratchpad | `services/scratchpad` | `scratchpad.db` |
| Panels (real coordination) | `services/panels` | `panels.db` |
| Agent messenger | `services/agent_messenger` | `agent_messages.db` |
| Tool executions | `services/tool_executions` | `tool_executions.db` |
| Agent presence | `services/agent_presence` | in-memory snapshot only — N/A |
| Future workspaces / projects | TBD | per-service `(user_id, ...)` schemas reserved |
| User preferences / settings | not yet a dedicated service | covered by metadata_json + future prefs.db |

This list lives in `backend/services/auth/merge_registry.py` as data — see §5.3.

### 5.2 Design principles

1. **Registry pattern.** Each owner-bearing service exposes a tiny adapter:
   ```python
   class OwnerReassignAdapter(Protocol):
       domain: str                                                  # e.g. "memory_plane"
       def reassign_owner(self, from_user_id: str, to_user_id: str) -> int: ...  # rows
       def has_owned_data(self, user_id: str) -> bool: ...          # cheap conflict probe
   ```
   The auth/merge service holds a registry of adapters. Adding a new owner-bearing service to Phase 2+ is a one-line registration; no merge logic gets touched.

2. **Per-domain atomicity, cross-domain ordering.** Each adapter does its work in a single transaction inside its own DB. The merge service orders adapters deterministically and records partial completion in `auth_merge_events` so a crash leaves a re-runnable state.

3. **Idempotent.** Re-running merge on an already-merged pair is a no-op. The audit row keeps a checksum so partial retries converge.

4. **Theft-resistant.** Only the principal of the guest's current session can merge it. The merge endpoint requires:
   - A valid `Authorization: Bearer <access_token>` of the destination account.
   - An `X-Korvix-Guest-Id` header whose nonce was recently bound to an active guest session (within `GUEST_MERGE_BIND_TTL_MIN=60`, configurable). The merge service verifies via `auth_users` lookup, NOT just trusting the header.
   - Optional: a short-lived `guest_merge_token` issued at signup time. This closes the residual race where an attacker who races the signup endpoint with their own `X-Korvix-Guest-Id` could try to import a stranger's data. Argued for in PR #4 design doc.

5. **Conflict policy.** If the destination already has data in a domain (`has_owned_data(to_user_id) is True`), the merge service does **not** clobber. Three modes:
   - `mode="merge"` (default): adapter does best-effort co-existence (e.g. memory plane just changes ownership and lets both sets co-exist as the new user's memories).
   - `mode="skip_existing"`: adapter skips rows whose key would collide.
   - `mode="abort"`: adapter returns 0 and the merge service surfaces a 409 with `conflicts: [{domain, count}]` so the FE can prompt the user to choose.

6. **Async-job path.** Inline merge for cheap state (<10MB across adapters). Otherwise enqueue a `kind="auth.merge"` job and return `202 Accepted` with the job id. FE polls `/v2/jobs/{id}`.

7. **Audit trail.** `auth_merge_events(id, requested_at, completed_at, from_user_id, to_user_id, status, rows_per_domain_json, error_msg)`. Append-only.

8. **Compensating delete of the guest user.** After successful merge across all adapters, the guest's `auth_users` row is soft-deleted (`metadata_json.merged_into = <to_user_id>`). Refresh-token family of the guest is revoked. Future guests that arrive with the same nonce get a fresh row (the soft-delete prevents the old row from resurrecting).

### 5.3 Triggers

The merge runs in three places:

1. **Implicit on signup** (most common). When `POST /v2/auth/register` is called with `X-Korvix-Guest-Id` matching the current bearer's guest identity, the merge runs inline before the response. FE doesn't need to do anything special. PR #4 ships this default-on.

2. **Implicit on first sign-in** (returning user). When `POST /v2/auth/login` succeeds and the current request was guest-authenticated, the merge runs inline. The FE prompts before login ("You have unsaved data from this browser session. Move it into your account?") — confirmation goes through as a query flag `merge_guest_state=true|false`. Default: prompt. Decision is remembered in `localStorage.korvix_merge_pref` for the rest of the session.

3. **Explicit `POST /v2/auth/merge`** for after-the-fact / cross-device / support flows. Body: `{ source_guest_id: string, mode: "merge"|"skip_existing"|"abort" }`. Requires authenticated bearer + ownership proof (see §5.2.4). This is also how the support team can manually rescue a user who clicked "no" by accident — they reset the bind TTL via an admin endpoint and re-merge.

### 5.4 Failure modes covered

- **Crash mid-merge** → idempotent retry via job runner. `auth_merge_events.status` goes `pending → in_progress → completed/failed`. Resume reads per-adapter progress.
- **Adapter throws** → that adapter's transaction rolls back; merge service moves to next adapter; final status `partial` with details.
- **Destination already merged from a different guest** → 409 with `already_merged_from: <prior_guest_id>`. No silent overwrite.
- **Same guest tries to merge twice** → 409 `already_merged_into: <user_id>`.
- **Adapter unavailable (e.g. memory_plane.db locked)** → merge fails with `TRANSIENT`, FE retries with backoff. Owner-bearing reads from the destination user are still safe because adapter transactions roll back on failure.
- **Hostile X-Korvix-Guest-Id** (attacker tries to import a stranger's data) → §5.2.4 prevents this. Without prior bind in `GUEST_MERGE_BIND_TTL_MIN`, the merge returns 403 `guest_not_bound`.

### 5.5 What the FE will surface (designed alongside PR #8)

- On signup form submit, if `X-Korvix-Guest-Id` is present and current session is guest: a single confirmation row inline: *"You have N chats, M memories, K projects from this browser. Move them into your account? [Yes, keep my data] [No, start fresh]"*. Counts come from a cheap `GET /v2/auth/merge/preview` endpoint added in PR #4.
- On successful merge, a toast: *"Moved N items into your account."*
- On 409 conflict (rare), a modal listing per-domain conflicts and `merge` / `skip_existing` / `abort` choices.

---

## Part VI — Implementation plan (revised)

| PR | Scope | Effort | Depends on | Risk |
|---|---|---|---|---|
| **#1** | **Production-harden JWT_SECRET_KEY.** Refuse insecure fallback when `ENVIRONMENT` is anything other than literal `"development"` (don't trust `DEBUG=True`). Reject keys < 32 bytes. Add tests for both fail-closed paths. | 1d | — | Low |
| **#2** | **Argon2id + identity schema extension.** Add `argon2-cffi` to `requirements.txt`. Create `services/auth/passwords.py` with `hash_password` / `verify_password`. Additive migration on `auth_users`: `email TEXT`, `email_normalized TEXT UNIQUE`, `password_hash TEXT`, `email_verified_at TEXT`. Reserve `metadata_json` keys: `org_id`, `roles`, `stripe_customer_id`, `api_keys_enabled`, `mfa_factors`. | 2d | #1 | Low (additive only) |
| **#3** | **Email/password registration + login + me-with-password.** New routes: `POST /v2/auth/register`, `POST /v2/auth/login`. Input validation (email format, password strength). Email-not-found timing equaliser. Argon2id. Issues access + refresh tokens. Tests including timing-equaliser. Does **not** yet wire merge — that's #4. | 3d | #2 | Medium |
| **#4** | **Guest Account Merge — the architectural pillar.** `services/auth/merge.py` + adapter registry. `OwnerReassignAdapter` Protocol. Adapters for: `memory_plane`, `sessions`, `jobs`, `assets`, `vision`, `workflows`, `agent_tasks`, `scratchpad`, `panels`, `agent_messenger`, `tool_executions`. `auth_merge_events` table. `POST /v2/auth/merge` + implicit merge in `register` / `login`. `GET /v2/auth/merge/preview` for FE counts. Async-job path via existing `services/jobs`. Theft-resistant bind via guest session lookup. Conflict modes. Tests across all adapters including partial-failure. **This is the largest PR — non-negotiable scope.** | 6d | #3 | High (touches every owner-bearing store; mitigated by adapter pattern keeping each touch tiny) |
| **#5** | **Google OAuth.** `POST /v2/auth/google` — verify ID token via `oauth2.googleapis.com/tokeninfo`. `get_or_create_user("google", external_id="google:<sub>")`. Inline guest merge per #4 protocol. Apple route stub: returns 503 with `feature_disabled` envelope unless `ENABLE_APPLE_AUTH=true`. Tests. | 2d | #4 | Low |
| **#6** | **Resend email integration.** `services/email/resend.py` HTTP client (no SDK). Verification flow: `POST /v2/auth/email/verify/request`, `GET /v2/auth/email/verify/confirm?token=...`. Password reset: `POST /v2/auth/password/reset/request`, `POST /v2/auth/password/reset/confirm`. Token storage via short-TTL JWT (no DB schema needed). Resend HTTP failures are surfaced but do NOT block the auth response (queue retry). Tests against a Resend mock. | 3d | #2 | Low |
| **#7** | **Refresh-token cookie pivot.** `v2_auth` routes set refresh cookie (`Set-Cookie: __Host-korvix_refresh=...; HttpOnly; Secure; SameSite=Lax; Path=/v2/auth/refresh; Max-Age=...`). Body no longer contains `refresh_token`. CSRF mitigation: SameSite=Lax + double-submit token on state-changing routes. Cookie cleared on logout. **Backward compat:** the body-shape refresh path stays read-only-deprecated for one release so any external integrations don't break in a window. Tests verify cookie attrs + CSRF. | 2d | #3 | Medium (touches every refresh consumer) |
| **#8** | **Frontend integration.** `src/services/auth.ts` API client (signup, login, google, refresh, me, logout, merge, merge/preview). `src/stores/authStore.ts` Zustand store with `persist` + `partialize` (persists user, NOT tokens). Wire `AuthPage.tsx`. Add refresh-token rotation via fetch interceptor (calls `/v2/auth/refresh` on 401, retries once). Surface guest-merge prompt on signup. Implement counts UI. Error states. Password strength meter. Tests via Vitest. Add `zustand` to `package.json` if not already present. | 5d | #4, #7 | Medium |
| **#9** | **Rate limiting + audit log + metrics.** IP+user token bucket on `/v2/auth/{register,login,refresh,password/reset/request,google,merge}`. Append-only `auth_events` table with categorical `event_type`. Metrics: `auth_signup_total`, `auth_login_failures_total`, `auth_refresh_revoked_total`, `auth_merge_total`, `auth_merge_failed_total`. Surfaced via `/internal/metrics` if `ENABLE_METRICS=true`. Tests verify rate-limit headers + audit rows. | 2d | #3, #4, #5, #6 | Low |
| **#10** | **Runbook + ADRs.** `docs/auth/runbook.md`: incident response (JWT_SECRET_KEY rotation, mass logout, suspected breach drill), customer-support flows (manual merge, account recovery, password reset escalation). ADRs: ADR-001 refresh-token cookie storage, ADR-002 Argon2id, ADR-003 Guest Merge as core pillar, ADR-004 single identity table with kind discriminator, ADR-005 ENABLE_AUTH_V2 flag retirement schedule. No code changes. | 1d | all prior | None |

### 6.1 Aggregate effort

| | Days |
|---|---|
| Single-developer end-to-end | **27** |
| Elapsed (assuming 1 dev, parallelisable QA) | **5–6 weeks** |

The corrected plan is meaningfully larger than my prior (fabricated) ~21-day plan, because the prior plan assumed most of the system already existed. Phase 1 is in fact **green-field on top of a sound guest substrate**.

### 6.2 Out of scope for Phase 1 (deferred)

- Postgres migration of `auth.db` (Phase 2 — multi-instance scale-out).
- Organizations / RBAC (Phase 2).
- Stripe billing wiring (Phase 2).
- Apple Sign-In (deferred per decision).
- Magic links (deferred per decision).
- MFA / TOTP (Phase 2).
- API key issuance (Phase 2).
- Enterprise SSO (Phase 3).
- Mass-bulk-import of guest data older than `GUEST_MERGE_BIND_TTL_MIN` from a different browser (cross-device guest merge — not a Phase 1 requirement; magic link or social sign-in covers that path).

### 6.3 Sequencing notes

- PR #1 is shippable in isolation today.
- PR #2 is a pure additive migration — back-compat by construction.
- PR #4 (merge) is the longest PR and gates the FE work in PR #8. Strongly recommend tackling it before #5/#6 to lock the merge contract early.
- PR #7 (cookie pivot) and PR #8 (FE wiring) can land in either order from a code standpoint, but UX-wise we want #7 first so the FE never has to handle a refresh token in JS.
- PR #10 runbook lags everything else by definition.

---

## Part VII — Open questions for re-approval

The 6 questions in the prior audit are now decided (§Approved decisions). The questions I have **after this correction** are:

1. **Guest Merge bind-TTL.** I've proposed `GUEST_MERGE_BIND_TTL_MIN=60` (one hour from last guest session activity). Acceptable? Or shorter (10 min, hostile-environment posture)?

2. **PR #1 shippability before plan re-approval.** PR #1 (`JWT_SECRET_KEY` hardening) is a small, isolated security improvement that's correct regardless of the broader plan. May I ship it as soon as you approve **this** corrected audit, in parallel with you deciding on the rest?

3. **PR ordering.** I've put merge (#4) before OAuth (#5) and email (#6). Alternative: ship Google OAuth first (it's small, unblocks more user testing). Trade-off: if merge isn't designed first, Google OAuth's guest-merge behaviour has to be retro-fitted. My recommendation is the order above. Override?

4. **Backwards-compat window for body-shape refresh tokens** (PR #7). I've proposed one release of dual-shape read. Acceptable, or cleaner break?

5. **Retiring `routes/auth.py` stub.** Two options: (a) delete it and free the `/auth` prefix, (b) reclaim it as the home of email/password routes (so `POST /auth/login` is the canonical, not `/v2/auth/login`). I lean (b) — the `/v2` prefix exists for the streaming chat API contract; auth has no v1 to differentiate from. Override?

---

## Appendix A — Files actually read during this audit

```
backend/api.py                              (router wiring confirmed)
backend/core/deps.py                        (no JWT decode anywhere; reads request.state)
backend/middleware/auth.py                  (production-quality)
backend/routes/auth.py                      (7-line stub)
backend/routes/v2_auth.py                   (guest, refresh, me, logout — only routes)
backend/routes/v2_chat_stream.py            (no per-user resolution; relies on middleware)
backend/routes/v2_memory.py                 (current_user, ownership-bound)
backend/routes/v2_sessions.py               (current_user, ownership-bound)
backend/services/auth/__init__.py           (re-exports)
backend/services/auth/identity.py           (User, VALID_KINDS)
backend/services/auth/service.py            (create_guest, rotate_refresh, logout, identity_for_access_token)
backend/services/auth/storage.py            (auth_users, auth_refresh_tokens — single table for identity)
backend/services/auth/tokens.py             (HS256, algorithm-pinned)
backend/tests/conftest.py                   (per-service tmp DB fixtures — confirms ownership model)
requirements.txt                            (no argon2 dep yet; no jwt dep; matches stdlib JWT story)
src/pages/AuthPage.tsx                      (211 lines, UI-only stub)
src/hooks/useOwnerMode.ts                   (reads korvix_access_token + korvix_user_id from localStorage)
src/hooks/useChat.ts                        (uses korvix_user_id)
src/components/AdminPanel.tsx               (reads korvix_access_token + korvix_user_id)
```

`backend/services/auth/passwords.py` — **searched, does not exist**.
`src/stores/` — **directory does not exist**.

---

**End of corrected audit. Awaiting re-approval before PR #1.**
