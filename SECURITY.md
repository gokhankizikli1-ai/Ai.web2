# KorvixAI — Security Model

> Production security layer for a multi-tenant AI Operating System. Every
> request belongs to exactly one principal; every resource has explicit
> ownership; identity originates only from authenticated context — never
> from a request payload.

This document describes the authentication flow, the ownership and
permission model, how identity propagates (including through background
jobs and SSE streams), the current security assumptions, and the path to
OAuth providers. It reflects the state after Sprint 1.2.

---

## 1. Authentication flow

```
                      ┌─────────────────────────────────────────────┐
  Browser / client    │  Authorization: Bearer <JWT>   (logged in)  │
  sends ONE of:       │  X-Korvix-Guest-Id: <nonce>    (guest)      │
                      │  (nothing)                     (anonymous)  │
                      └───────────────────┬─────────────────────────┘
                                          │
                 ┌────────────────────────▼────────────────────────┐
                 │ AuthMiddleware (optional, ENABLE_AUTH_V2=true)   │
                 │  - verifies the JWT signature (HS256)            │
                 │  - sets request.state.user / request.state.user_id│
                 └────────────────────────┬────────────────────────┘
                                          │
                 ┌────────────────────────▼────────────────────────┐
                 │ backend.core.deps.resolve_uid_and_source         │
                 │  THE single identity resolver. Precedence:       │
                 │   1. request.state.user_id  (middleware)         │
                 │   2. verified Bearer `sub`  (inline HS256 verify)│
                 │   3. X-Korvix-Guest-Id nonce                     │
                 │   4. body.user_id  (legacy fallback ONLY)        │
                 │   5. "anonymous"                                 │
                 │  A bad/expired/forged token NEVER falls through  │
                 │  to body.user_id — it degrades to guest/anon.    │
                 └────────────────────────┬────────────────────────┘
                                          │
                 ┌────────────────────────▼────────────────────────┐
                 │ backend.core.principal.resolve_principal         │
                 │  Wraps the resolver + current_user + owner check │
                 │  → Principal{ user_id, kind, source, email }     │
                 └─────────────────────────────────────────────────┘
```

**Key invariant:** identity is established from cryptographically verified
material (a signed JWT) or a guest nonce. The legacy `body.user_id` is only
ever used when there is *no* auth signal at all, and a **verified** JWT
always overrides it — so an authenticated user cannot be impersonated by a
forged body field, and a forged/unsigned token cannot assume a victim's id.

### Token validation (`backend/services/auth/tokens.py`)
- **Algorithm pinned to HS256** — `alg=none` and algorithm-confusion are
  rejected.
- **Signature** verified with `JWT_SECRET_KEY` (≥32 bytes; refuses to
  issue/verify in production when empty — surfaced by the startup config
  self-check).
- **Claims checked:** `exp` (expiry, with no silent skew bypass), `iss`
  (issuer), `type` (access vs refresh — an access token can't be used as a
  refresh token or vice-versa), `sub` (subject).
- **Failure is never silent:** an invalid token is logged and the request
  degrades to the guest/anonymous path; it is never treated as the claimed
  user.

---

## 2. Permission model (explicit levels — no magic booleans)

Defined in `backend/core/principal.py` as `PrincipalKind`:

| Level | Meaning | Produced by |
|-------|---------|-------------|
| `GUEST` | Unauthenticated browser session (stable `X-Korvix-Guest-Id` nonce). First-class — the product supports guest usage. | `resolve_principal` |
| `USER` | Authenticated via a **verified** JWT. | `resolve_principal` |
| `OWNER` | A user (or token-unlock) matching `OWNER_EMAIL(S)`/`OWNER_ID`. Gated by `ENABLE_ADMIN_MODE`. | `resolve_principal` |
| `ADMIN` | Reserved for a future RBAC role; today owners are admins. | (reserved) |
| `INTERNAL` | System-initiated work with no end user (maintenance, schema bring-up). Full trust. | `system_principal()` factory only |
| `WORKER` | Background execution **on behalf of** a specific user. Scoped to that user; no owner powers. | `worker_principal(uid)` factory only |

`INTERNAL`/`WORKER` are **never** produced from an HTTP request, so a
network caller can never escalate to a system principal.

Predicates (instead of ad-hoc booleans): `is_guest`, `is_authenticated`,
`is_owner`, `is_admin`, `is_internal`, plus `effective_user_id`.

---

## 3. Ownership model

Every user-owned resource carries an owner id and is accessed through one
consistent decision:

- `Principal.owns_user(target_uid)` — owner/admin/internal ⇒ always;
  otherwise the principal's `effective_user_id` must equal `target_uid`.
- `Principal.may_access_scope(scope, …)` — for event/stream scopes
  (`user:<id>`, `project:<id>`, `run:<id>`, `*`).

### Route-level policy (consistent across the app)

| Caller | Read/modify another user's resource | Their own resource | Wildcard `*` scope |
|--------|--------------------------------------|--------------------|--------------------|
| `OWNER`/`ADMIN` | allowed | allowed | allowed |
| `USER` (verified) | **404 (existence-hidden)** | allowed | **403** |
| `GUEST`/anonymous | legacy contract (scoped by the id they present; a header-less call is permitted only where the current FE relies on it) | allowed | **403** |

The **404 (not 403)** on cross-user reads hides resource existence.

### Where ownership is enforced
- **`/v2/*` surface** — `Depends(current_user)` + `user_id`-scoped store
  reads (jobs, memory, sessions, assets, workflows, panels, scratchpad,
  agent-tasks, orchestrator, brain). Cross-user reads return 404.
- **`/v2/orchestrate`** (Sprint 1.1) — identity from authenticated context,
  not `body.user_id`; run/task reads scoped by identity.
- **`/v2/chat/stream`** (Sprint 1.2) — identity via the shared **verified**
  resolver (previously trusted an unsigned `sub`).
- **`/v2/events/stream`** (Sprint 1.2) — SSE scope authorized against the
  principal; `*` is owner-only; cross-tenant `user:`/`project:`/`run:`
  scopes are denied (403).
- **`/projects/*`, legacy `/sessions/*`** (Sprint 1.2) — owner-scoped;
  authenticated cross-user access → 404; guest/legacy preserved.
- **Legacy `/memory`, `/profile`** (Sprint 1.1) — ownership-enforced;
  unauthenticated cross-user → 403.

---

## 4. Identity propagation

### HTTP requests
One resolver (`resolve_uid_and_source` → `resolve_principal`) is used
everywhere. There is no second identity implementation to drift from — the
former bespoke resolvers in `routes/chat.py` and `routes/v2_chat_stream.py`
now delegate to it.

### SSE / long-lived streams
For `/v2/events/stream`, the principal is resolved **once at connect** from
the verified token / guest nonce, and the authorized scope is bound to that
subscription for the entire lifetime of the stream. A client cannot widen
its scope after connecting, and an unauthorized scope is rejected before any
event is delivered.

### Background jobs / workers (service-to-service)
- A job records the **creator's** `user_id` at enqueue time, derived from
  the authenticated request (`v2_jobs` uses `current_user.id`, never a body
  field).
- The worker executes that job and scopes all data access to the recorded
  `user_id`. It does **not** read identity from ambient request state and
  does **not** inherit owner/admin powers — model this with
  `worker_principal(on_behalf_of=<creator_uid>)`.
- System-initiated maintenance (schema bring-up, sweeps) uses
  `system_principal()` — full trust, no end user, never from a request.

This means internal execution **never impersonates a user**: it either acts
on behalf of a specific recorded user (worker) or as a clearly-labelled
system principal.

---

## 5. Security assumptions

1. **`JWT_SECRET_KEY` is set (≥32 bytes) in any environment that issues
   tokens.** Token issue/verify fail closed otherwise; the startup
   self-check logs a critical when auth is enabled without it.
2. **Guest identity = possession of the `X-Korvix-Guest-Id` nonce.** Guests
   are a first-class, lower-trust tier; a guest can act only within its own
   nonce-scoped data. Nonces are opaque random ids.
3. **The legacy `body.user_id` fallback is a backward-compat affordance,**
   used only when no auth signal exists. It can never override a verified
   identity. Pre-fix / header-less clients keep working; new clients should
   send a Bearer token or guest header.
4. **Owner mode is gated by `ENABLE_ADMIN_MODE`** and configured via
   `OWNER_EMAIL(S)`/`OWNER_ID` (identity-first) or a constant-time
   `OWNER_TOKEN` (guest/no-email unlock only). No owner secret is hardcoded.
5. **Several subsystems are flag-gated off by default.** Ownership is
   enforced regardless, so a subsystem is safe to enable without a separate
   security pass.
6. **`ENABLE_AUTH_V2=true` is recommended in multi-tenant production** so
   AuthMiddleware validates tokens centrally. Even with it off, the inline
   verify in the shared resolver upholds the signature guarantee.

---

## 6. Future OAuth compatibility

The model is provider-agnostic and ready for additional OAuth providers
without changing the authorization layer:

- Identity is keyed on the JWT `sub` (a stable per-user id). New providers
  (Apple, GitHub, magic-link) issue the same internal JWT after their own
  verification, so `resolve_principal` and every ownership check work
  unchanged.
- `PrincipalKind` already reserves `ADMIN` for a future RBAC role; adding
  org/team membership becomes a lookup inside `owns_user` /
  `may_access_scope` rather than a per-route change.
- Provider-specific token verification (e.g. Google `aud`/`iss`) lives in
  the auth service; the rest of the app only ever sees the internal,
  HS256-signed session token.

> This sprint deliberately did **not** add OAuth providers or replace JWT —
> it made the existing layer production-grade so those can be added safely
> later.

---

## 7. Known residual risks (tracked for Sprint 1.3)

- **AuthMiddleware off by default (`ENABLE_AUTH_V2=false`).** The shared
  resolver still verifies tokens inline, but enabling middleware centralizes
  it and is recommended before scaling multi-tenant. Surfaced by the startup
  self-check.
- **No org/team RBAC yet.** Ownership is per-user; the `ADMIN` level and
  shared-resource membership are reserved but unimplemented.
- **No rate limiting on auth endpoints** (`/v2/auth` login/register/guest) —
  brute-force throttling is deferred. The in-process limiter is per-replica.
- **Guest nonce is bearer-of-secret.** Acceptable for the guest tier; a
  guest with another guest's nonce is that guest. Not applicable to
  authenticated users (cryptographic identity).
