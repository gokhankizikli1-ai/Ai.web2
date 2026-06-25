# Phase 1 — Authentication Audit & Implementation Plan

**Source of truth:** `main @ aef9eec` (with local edits noted)
**Date:** 2026-06-25
**Status:** AUDIT ONLY — no code changes until plan approved
**Author:** Engineering — pre-implementation review

---

## Part I — Current authentication architecture (verified against repo)

### 1.1 The actual surface — two parallel auth systems coexist

The repo has **two authentication subsystems** running side-by-side. Both work; neither has clearly retired the other. This is the single most important fact to internalise before touching anything.

| System | Routes | JWT lifetime | Owner of identity | Status |
|---|---|---|---|---|
| **System A — `routes/auth.py` (legacy single-token)** | `POST /auth/signup`, `POST /auth/login`, `POST /auth/google`, `POST /auth/apple`, `GET /auth/me`, `POST /auth/logout`, `GET /auth/status` | 24h **access only**, no refresh tokens | `services/auth/passwords.py` (table `auth_password_users`) AND `services/auth/storage.py` (table `auth_users`) | **Functional in production**; the FE talks to it (`authStore.ts:apiLogin`, `apiSignup`, `apiGoogle`, `apiLogout`, `apiMe`). |
| **System B — `routes/v2_auth.py` (refresh-token rotation)** | `POST /v2/auth/guest`, `POST /v2/auth/refresh`, `GET /v2/auth/me`, `POST /v2/auth/logout` | Configurable `ACCESS_TOKEN_TTL_MIN` (default 60min) + `REFRESH_TOKEN_TTL_DAYS` (default 30d) refresh with rotation | `services/auth/storage.py` only (table `auth_users` + `auth_refresh_tokens`) | **Functional** but only `/v2/auth/guest` is wired into the FE indirectly via `AuthMiddleware`. Refresh + rotation never exercised by the FE; `apiLogin`/`apiSignup` mint single access tokens via System A. |

The FE (`authStore.ts`) currently uses **System A** for sign-in / sign-up / Google / me / logout. **System B's refresh-token rotation is fully implemented but unused** in user flows.

### 1.2 Files and responsibilities

| Layer | File | Responsibility | Verdict |
|---|---|---|---|
| Identity dataclass | `services/auth/identity.py` | `User` (id/kind/external_id/display_name/created_at/last_seen_at/metadata). 5 valid `kind`s declared: guest, email, google, github, apple. | Clean. Reserved `kind`s for future are documented. |
| Token issue/verify | `services/auth/tokens.py` | Pure-stdlib HS256 JWT with HMAC-SHA256, algorithm pinning, alg=none rejection, exp/nbf/iat/iss/jti claims, `secrets.token_hex(16)` jti. `_secret()` reads `JWT_SECRET_KEY` dynamically and refuses to issue in non-`development` env. Dev fallback `b"insecure-dev-key-do-not-use-in-production"` with WARNING log. | **Production-quality** — best part of the system. Algorithm pinning + alg=none guard + timing-safe `hmac.compare_digest` are all correct. |
| Identity storage | `services/auth/storage.py` | SQLite `auth.db`. Tables: `auth_users(id, kind, external_id, display_name, created_at, last_seen_at, metadata_json)` with UNIQUE on `(kind, external_id)`; `auth_refresh_tokens(jti, user_id, family_id, created_at, expires_at, revoked_at)`. | Good schema. Race-safe `get_or_create_user`. CASCADE on user delete. |
| Password storage | `services/auth/passwords.py` | Separate table `auth_password_users(id, email, password_hash, display_name, created_at, last_login_at)` in **the same `auth.db`** but **not linked to `auth_users` via foreign key**. PBKDF2-HMAC-SHA256, 200k iterations, 16-byte salt, passlib-compatible string. **Timing-equalisation hash on email-not-found path.** | PBKDF2 is acceptable; **bcrypt/argon2id is the modern recommendation.** The split table is the biggest architectural flaw — see §1.4 below. |
| Auth service | `services/auth/service.py` | High-level operations: `create_guest`, `rotate_refresh` (with theft detection via family-wide revoke on reuse-of-revoked), `logout`, `identity_for_access_token`. | Refresh-token rotation pattern is **textbook-correct**. Wasted because the FE doesn't use it. |
| Errors | `services/auth/errors.py` | `MissingTokenError`, `InvalidTokenError`, `ExpiredTokenError`, `RevokedTokenError`. | Clean. |
| **AuthMiddleware** | `middleware/auth.py` | Reads `Authorization: Bearer <jwt>`; on miss mints a guest via `X-Korvix-Guest-Id` nonce. Sets `request.state.{user, is_guest, auth_kind, auth_token, user_id}`. **Opt-in via `ENABLE_AUTH_V2=true`**. | Sound. But gated behind a flag that may be off in production. |
| Placeholder middleware | `middleware/auth_placeholder.py` | "Phase-B" pre-existing middleware. Coexists with the real one — comments warn "do not enable both at once." | **Dead code in spirit.** Should be retired. |
| Auth dependencies | `core/deps.py` | `current_user()` resolution order: `request.state.user` (when middleware ran) → direct JWT decode from `Authorization` header → fallback guest. `require_auth()`, `require_owner()`. | `current_user` does its own JWT verify via `tokens.verify(...)` as a fallback when middleware is off. Correct + paranoid. |
| Settings | `core/config.py` | `OWNER_EMAIL`, `OWNER_EMAILS` (CSV), `OWNER_TOKEN`, `OWNER_ID`, `AUTH_DB_PATH`, `JWT_SECRET_KEY`, `JWT_ISSUER`, `ACCESS_TOKEN_TTL_MIN` (60), `REFRESH_TOKEN_TTL_DAYS` (30). | Comprehensive. Owner-detection has 4 stack-able signals — solid. |
| Owner detection | `services/admin/owner.py` | `is_owner(user)` with `ENABLE_ADMIN_MODE` kill-switch; `match_owner_token(provided)` via `hmac.compare_digest`. Identity-first precedence in `require_owner`. | Production-grade. |
| FE auth store | `src/stores/authStore.ts` | **Zustand + persist middleware** with `partialize` (persists only user, not token). Token in `localStorage['korvix_access_token']`. Persisted user blob in `localStorage['korvix-auth']`. Cross-account artifact scrubbing when email changes. | Solid foundation. Best-in-class for the current scope. Persists ONLY user (not the JWT) which is correct. |
| FE auth page | `src/pages/AuthPage.tsx` | 986 lines. Login + signup + Google flows. | **Large — needs a closer look** (see §1.8). |
| Owner mode hook | `src/hooks/useOwnerMode.ts` | Singleton subscriber model. Reads `korvix_access_token`, `korvix_owner_token`, `korvix_user_id` from localStorage. Sends Bearer + `X-Korvix-Owner-Token`. Listens for `korvix:owner-refresh` window event. | Production-shaped. |

### 1.3 Identity stores — verbatim schema

```sql
-- auth.db (SQLite)
CREATE TABLE auth_users (
    id            TEXT PRIMARY KEY,             -- uuid4 hex
    kind          TEXT NOT NULL,                -- guest | email | google | apple | github
    external_id   TEXT NOT NULL,                -- "guest:<nonce>" | "google:<sub>" | email
    display_name  TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL,                -- ISO-8601
    last_seen_at  TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX ix_auth_users_kind_extid ON auth_users(kind, external_id);

CREATE TABLE auth_refresh_tokens (
    jti          TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    family_id    TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    expires_at   TEXT NOT NULL,
    revoked_at   TEXT
);

-- Same auth.db, separate parallel system (passwords.py):
CREATE TABLE auth_password_users (
    id             TEXT PRIMARY KEY,            -- uuid4 hex (DIFFERENT namespace from auth_users.id)
    email          TEXT NOT NULL UNIQUE,
    password_hash  TEXT NOT NULL,               -- pbkdf2_sha256$200000$<salt_hex>$<hash_hex>
    display_name   TEXT NOT NULL DEFAULT '',
    created_at     TEXT NOT NULL,
    last_login_at  TEXT                         -- ⚠ no foreign key to auth_users
);
```

### 1.4 The two-table problem (THE main architectural issue)

`auth_password_users` is **completely disconnected** from `auth_users`. Same database file, no foreign key, no shared ID, no cross-references. The same person who signed up via email/password (in `auth_password_users`) and then later signed in with Google (in `auth_users`) becomes **two different user IDs in the system** — Memory Plane writes, Chat threads, Owner detection all key off whichever ID resolved on that request.

The fact that `core/deps.py:_user_from_bearer` resolves the JWT `sub` against **both tables in sequence** (identity first, then password) hides the bug from the FE — but the two user IDs still own different memory/threads/sessions. There is no "merge accounts" path. Once a user has rows under both IDs, they are stuck.

This is the single most important thing Phase 1 must fix.

### 1.5 Authentication flow today (per route surface)

**Sign-up flow (FE → `authStore.signup`):**
1. FE POST `/auth/signup` `{email, password, display_name}`
2. `routes/auth.py:signup` → `passwords.create_user(...)` → INSERT into `auth_password_users` with PBKDF2 hash
3. `_issue_access(user)` mints a 24h **access token only** (no refresh), kind=`email`
4. FE stores token in `localStorage['korvix_access_token']` + persists user blob via zustand
5. **No refresh token issued. After 24h, user is silently logged out.**

**Login flow:** same as above but `verify_credentials` instead of `create_user`. Constant-time email-not-found via dummy PBKDF2 — good.

**Google flow (FE → `authStore.loginWithGoogle(idToken)`):**
1. FE gets the Google `id_token` client-side (GIS button)
2. POST `/auth/google` with `id_token`
3. `routes/auth.py:_verify_google_id_token` does `urllib.urlopen("https://oauth2.googleapis.com/tokeninfo?id_token=...")` (sync — runs in FastAPI's thread pool)
4. Verifies `email_verified == "true"` and `aud == GOOGLE_CLIENT_ID`
5. `storage.get_or_create_user("google", email)` (note: uses email as `external_id`, NOT the Google `sub`)
6. `_issue_access` mints 24h access token

**Apple flow:** stub returning 503 unless `ENABLE_APPLE_AUTH=true`. Requires JWKS verification (not in stdlib). Marked as Phase 3c reserved.

**Guest flow (only via System B):**
1. AuthMiddleware on a request with no token mints a guest via `service.create_guest(nonce_from_X-Korvix-Guest-Id)`
2. Same nonce → same User row (idempotent across reloads)
3. Issues both access AND refresh tokens, records refresh in `auth_refresh_tokens`
4. **The FE does NOT explicitly call `/v2/auth/guest`** — guests are created implicitly by the middleware for any unauthenticated request.

**Logout (FE → `authStore.logout`):**
1. POST `/auth/logout` (System A) — stateless, returns OK
2. FE wipes: `korvix-auth`, `korvix_access_token`, `korvix_owner_token`, `korvix_owner_welcome_shown`, `korvix_owner_greeting_shown`, `korvix_oauth_response`
3. **System B refresh tokens are not revoked** — if a user had a guest refresh token, it stays valid until expiry. Logout is single-system.

### 1.6 What depends on authentication (verified)

| Subsystem | How it consumes auth | Risk if auth changes |
|---|---|---|
| `routes/v2_chat_stream.py:_resolve_user_id` | JWT → state.user → **direct base64 decode of JWT payload without signature verify** (sic) → body user_id → "anonymous" | **🔴 Security bug.** The unverified-JWT fallback at step 2 trusts any `sub` claim sent in a forged JWT. Anyone can spoof `user_id` for chat → reach another user's memory. |
| Memory Plane (`routes/v2_memory.py`) | `Depends(current_user)` then `list_for_user(user.id, ...)` | High — memories are user-scoped. A user_id mismatch (see §1.4) means memory is invisible after switching sign-in method. |
| Chat sessions (`routes/v2_sessions.py`) | Same | Same |
| Owner / Admin routes (`v2_admin.py`, `v2_db_health.py`, etc.) | `Depends(require_owner)` | Identity-first owner check covers; OWNER_TOKEN fallback path also active. |
| Memory extractor (`services/memory_plane/extractor.py`) | Reads `user_id` from chat ctx | Same as memory. |
| Tools that touch user-scoped data (`tool_executions`, `browser_tool`, `github_tool`, `ecommerce_research_tool`) | Authorization header forwarded | If header missing → tool runs as guest. |
| Jobs (`v2_jobs.py`) | `current_user()` for ownership filter on `/v2/jobs`; `require_owner()` on `/v2/jobs/all` | Standard. |

### 1.7 Owner Mode interaction with auth

Two valid unlocks per `services/admin/owner.py`:
- **Identity path** — authenticated user with email in `OWNER_EMAILS` (CSV, lowercase) or `OWNER_EMAIL` (singular). Requires `ENABLE_ADMIN_MODE=true`. Identity-first precedence in `require_owner`.
- **Token path** — `OWNER_TOKEN` env var, `hmac.compare_digest`-compared against `X-Korvix-Owner-Token` header. Treated equivalent to identity owner.

The FE clears `korvix_owner_token` when the email on the signed-in user changes (`authStore.ts:_clearStaleOwnerArtifactsOnAccountChange`). This is the right defence against shared-device leak.

### 1.8 Frontend `AuthPage.tsx` (986 lines)

Did not deep-read in this audit. Three quick observations from the surface:
- It's the single biggest auth FE file.
- It owns Google GIS button + email/password form + likely Apple stub UX.
- 986 lines suggests it's doing more than one screen's work — sign-in, sign-up, possibly forgot-password handoff, marketing copy.

→ Phase 1 should split this into `SignInPage.tsx` + `SignUpPage.tsx` + `ForgotPasswordPage.tsx` + shared `<AuthForm>` primitive.

---

## Part II — What exists / missing / should be removed / should be refactored

### 2.1 What already exists (do not rebuild)

1. ✅ Stdlib HS256 JWT — algorithm pinning, alg=none guard, timing-safe sig compare. Keep as-is.
2. ✅ Refresh-token rotation with theft detection (family-wide revoke on reuse-of-revoked). Wire it into the FE.
3. ✅ `auth_users` identity table with `(kind, external_id)` unique. Make this the **single source of truth**.
4. ✅ Zustand + persist auth store with partialize (no JWT in persisted blob). Keep.
5. ✅ Owner-token + owner-email detection. Cross-account artifact scrubbing on email change. Keep.
6. ✅ Google `id_token` verification via Google's `tokeninfo` endpoint with audience check + `email_verified` check. Keep, harden.
7. ✅ Password constant-time enumeration mitigation (dummy PBKDF2 on email-not-found).
8. ✅ Per-route `Depends(current_user)` / `Depends(require_auth)` / `Depends(require_owner)` pattern.
9. ✅ `JWT_SECRET_KEY` env enforcement (refuses to issue in non-development without one).
10. ✅ AuthMiddleware with stable per-browser guest via `X-Korvix-Guest-Id`.

### 2.2 What is missing

1. ❌ **Refresh tokens for email/password and Google logins.** System A mints access-only. After 24h the user is silently logged out. No silent refresh in the FE.
2. ❌ **A single user identity table.** Email/password users live in `auth_password_users`; Google/Apple/guest users live in `auth_users`. No cross-table foreign key, no merge path.
3. ❌ **Email verification.** Sign-up trusts whatever email the user types. No `email_verified_at`. No verification email sent.
4. ❌ **Password reset.** No "forgot password" flow.
5. ❌ **Magic link.** Not implemented.
6. ❌ **Apple Sign-In.** Stub returns 503.
7. ❌ **MFA / TOTP.** Not designed in. Schema doesn't carry `mfa_enabled` / `totp_secret`.
8. ❌ **Rate limiting on auth routes.** `/auth/login` will accept unlimited password attempts per IP.
9. ❌ **Audit log on auth events.** Sign-in / failed login / password change should hit `services/admin/audit.py`.
10. ❌ **Account-merge endpoint.** Two-table problem leaves users orphaned across providers.
11. ❌ **Future org_id column on user.** Phase 10 (Stripe + multi-tenant) blocked until this exists.
12. ❌ **CSRF protection for cookie-based auth.** Currently we use Bearer header only (no cookies); but Phase 1 may introduce httpOnly cookies — CSRF must be designed in.
13. ❌ **Secure-cookie option for refresh tokens.** They live in JSON responses today; storing in JS-accessible storage is XSS-risky.
14. ❌ **Bcrypt or Argon2id password hashing.** PBKDF2 at 200k is acceptable but not modern best-practice.
15. ❌ **OWASP-grade password policy.** No common-password blocklist, no breach-check (HIBP).
16. ❌ **Frontend sign-in / sign-up / forgot-password as discrete routes.** Currently 986-line `AuthPage.tsx`.

### 2.3 What should be removed (dead / dual / confusing)

1. 🗑 `middleware/auth_placeholder.py` — superseded by `middleware/auth.py`. Delete after a release of coexistence.
2. 🗑 `routes/auth.py:GET /auth/status` returning `{"authenticated": False}` unconditionally — useless. Delete or wire to real status.
3. 🗑 The DUPLICATE access-token plumbing in `routes/auth.py:_issue_access` vs `services/auth/service.py:issue` — the route bypasses the service. Either delete the route's local `_issue_access` and call `auth_service`, OR delete the service's guest path. (Keep service, refactor route.)
4. 🗑 The **direct base64 JWT decode without signature verify** in `v2_chat_stream.py:_resolve_user_id` step 2. **This is a security bug.** Replace with verified decode via `tokens.verify`. (See §1.5.)
5. 🗑 Once email/password is consolidated into `auth_users`, drop the `auth_password_users` table (or keep only the credential hash, with a FK to `auth_users.id`).

### 2.4 What should be refactored

1. 🔧 **Consolidate to single `auth_users` source-of-truth.** Add `auth_credentials(user_id PK FK, password_hash, mfa_secret, email_verified_at)`. Migrate `auth_password_users` rows: create matching `auth_users` (kind=email, external_id=email) + new `auth_credentials` rows for each. Delete `auth_password_users`.
2. 🔧 **Unify the two route files.** Move `routes/auth.py` endpoints into `routes/v2_auth.py` (or new `routes/v2_auth_credentials.py`). Keep legacy `/auth/*` paths as a forwarding shim for ONE release before deletion.
3. 🔧 **Wire System B refresh-token rotation into email/Google login.** `auth_service.login_email(...)` + `auth_service.login_google(...)` issue access + refresh + record refresh-jti; FE silently refreshes when access expires.
4. 🔧 **Add `email_verified_at` to `auth_users.metadata_json`** (no schema migration needed for the first release; promote to a real column when we port to Postgres in Phase 3).
5. 🔧 **Wrap legacy `auth.py` endpoints in `Depends(rate_limit_auth)`** when slowapi lands (Phase 7 prep, but plumb the dep slot in Phase 1).
6. 🔧 **Switch password hashing from PBKDF2 to argon2id.** Add `argon2-cffi` to requirements. Keep the existing PBKDF2 strings readable for migration — on next login, re-hash and store.

### 2.5 Potential security issues (catalogued, prioritised)

| ID | Severity | Issue | Where | Fix |
|---|---|---|---|---|
| S1 | 🔴 critical | Chat stream accepts unverified JWT `sub` claim as identity (any user can spoof user_id) | `routes/v2_chat_stream.py:_resolve_user_id` step 2 | Replace base64 decode with `tokens.verify(token, expected_type="access")`. **Fix in Phase 1 PR 1.** |
| S2 | 🔴 critical | Two-table identity split; same user across email + Google has two separate IDs | `auth_password_users` vs `auth_users` | Schema migration to single `auth_users` + `auth_credentials`. **Phase 1 PR 2.** |
| S3 | 🟡 high | No refresh tokens for email/Google logins → 24h hard logout | `routes/auth.py:_issue_access` | Issue refresh tokens via `auth_service`. **Phase 1 PR 3.** |
| S4 | 🟡 high | No rate limiting on `/auth/login` (brute-force) | n/a | slowapi or stub middleware. **Phase 1 PR 5.** |
| S5 | 🟡 high | No email verification — users can claim any email | `passwords.create_user` | Verification email + `email_verified_at`. **Phase 1 PR 4.** |
| S6 | 🟡 high | Apple Sign-In stub returns 503 — but FE may attempt it | `routes/auth.py:auth_apple` | Either ship JWKS verify or hide the FE button by env flag. **Deferred to Phase 1.X.** |
| S7 | 🟢 medium | PBKDF2 instead of argon2id | `passwords.hash_password` | Add argon2-cffi; lazy re-hash on login. **Phase 1 PR 2.** |
| S8 | 🟢 medium | Dev fallback JWT key (`b"insecure-dev-key..."`) — relies on `ENVIRONMENT != production` discipline | `tokens._secret()` | Refuse to boot in production without `JWT_SECRET_KEY`. Already partially in place; harden. **Phase 1 PR 1.** |
| S9 | 🟢 medium | No CSRF protection plumbing (relevant if we ever store JWT in cookie) | n/a | Define the cookie-vs-header decision in Phase 1. **PR 1 ADR.** |
| S10 | 🟢 medium | No timing-equalisation for `_user_from_bearer` lookup misses (sub claim → SQL miss is faster than sub → row found path); not as exploitable as password timing but worth noting | `core/deps.py:_user_from_bearer` | Low priority; can be addressed in PR 6. |
| S11 | 🟢 low | OAuth state / PKCE for Google — currently the FE sends `id_token` directly from GIS; CSRF + replay protections are Google's responsibility | `routes/auth.py:auth_google` | Acceptable as-is; document. |
| S12 | 🟢 low | Refresh tokens stored as plain `jti` in DB (no hash); a DB leak reveals all refresh tokens | `services/auth/storage.py` | Store hashed `jti` (SHA-256) in the table; compare on refresh. Phase 1 PR 3. |

### 2.6 Architecture issues

1. **Service-layer bypass.** `routes/auth.py` does its own `tokens.issue(...)` instead of going through `services/auth/service.py`. Two paths to mint an access token → schema drift risk.
2. **Mixed Pydantic + dict shapes.** `services/auth/passwords.py` returns dicts; `services/auth/storage.py` returns `User` dataclasses. The route handlers stitch them. Pick one.
3. **Lazy imports inside hot paths.** Every `core/deps.py:_user_from_bearer` call lazy-imports `tokens`, `storage`, `passwords`. Acceptable but profile when traffic grows.
4. **`request.state.user_id` back-compat alias** in `AuthMiddleware` is fine for now but is a rope to trip on.

### 2.7 Scalability concerns

1. **SQLite for auth.** Single-writer ceiling. Phase 3 puts auth on Postgres dispatcher; design Phase 1 schema accordingly (TEXT timestamps, `(kind, external_id)` index, ON DELETE CASCADE — all portable).
2. **Refresh-token table grows unbounded** unless we periodically purge expired rows. Add a sweep CLI in Phase 1.
3. **`auth_users.last_seen_at` UPDATE on every authenticated request** = SQLite write per request. Move to an in-memory throttle (touch at most once per N minutes per user).
4. **No pagination on owner-side `/v2/auth/users` list** (and there isn't one yet — design it before Phase 10).

---

## Part III — Phase 1 implementation plan

### 3.1 Goals (success criteria for Phase 1 as a whole)

- A new user can sign up with **email + password**, click a verification link sent via Resend, then sign in.
- A returning user can **sign in with Google** and reach the same identity row they'd reach via email login (one user, one ID).
- A signed-in user remains signed in past 24h via **silent refresh** (System B's rotation, wired into System A's flows).
- A user who forgets their password can request a **reset link** and choose a new one.
- **No legacy guest sessions are broken.** The `X-Korvix-Guest-Id` flow keeps working through the migration.
- Owner mode, AdminPanel, chat ownership, memory ownership, and audit log all see exactly one `user.id` per natural person regardless of provider.

### 3.2 Non-goals (deferred to later phases)

- Apple Sign-In wiring (Phase 1.X follow-up).
- MFA / TOTP (Phase 1 designs the schema; implementation Phase 7).
- Magic-link sign-in (Phase 1 wires the `email_outbound` plumbing; UX deferred to Phase 2 of auth).
- Multi-tenant orgs (Phase 10).
- API keys for programmatic access (Phase 10).

### 3.3 PR breakdown (8 incrementally-merge-able PRs)

Each PR is independently mergeable. Each ships green tests + tsc + vite build. Each leaves the system in a working state.

---

#### PR #1 — `fix(auth): close JWT-sub spoof in chat stream + lock JWT_SECRET_KEY in production`

**Objective:** stop accepting unverified JWT claims as identity; harden boot-time secret check.

**Files to modify**
- `backend/routes/v2_chat_stream.py:_resolve_user_id` — replace base64-decode-without-verify with `tokens.verify(token, expected_type="access")`. On any verify failure, fall through to body/anonymous.
- `backend/services/auth/tokens.py:_secret()` — already refuses non-dev without secret; tighten the dev-fallback to require `ENVIRONMENT=development` (not just `DEBUG=True`).
- `backend/tests/test_phase11_web_search_intent.py` and/or a new `test_phase1_chat_jwt_spoof_guard.py` — assertion: a request with a forged JWT (right `sub`, wrong signature) resolves to `anonymous`, not the spoofed id.

**Architecture changes:** none.

**Database changes:** none.

**API changes:** none — semantics tighten, contract unchanged.

**Frontend changes:** none.

**Security considerations:** closes S1, hardens S8.

**Testing requirements**
- New test: forged JWT → `user_id="anonymous"`.
- Existing chat-stream tests must still pass.
- New test: dev fallback secret cannot be used to issue tokens when `ENVIRONMENT=production`.

**Potential risks:** very low — change is restrictive, not permissive.

**Dependencies:** none. Ship first.

**Complexity:** **Low** (~1 day).

---

#### PR #2 — `feat(auth): unified user identity — single `auth_users` table + `auth_credentials` join`

**Objective:** kill the two-table problem. One person → one row in `auth_users` regardless of provider.

**Files to modify (BE)**
- NEW `backend/services/auth/credentials.py` — owns `auth_credentials` table (user_id PK FK → `auth_users.id`, `password_hash`, `password_hash_alg`, `mfa_secret` (null for now), `email_verified_at`).
- `backend/services/auth/storage.py` — add `get_user_by_email(email)`, `link_email_to_existing_user(user_id, email)`.
- `backend/services/auth/passwords.py` — rewrite to operate on `auth_users` + `auth_credentials` instead of the standalone `auth_password_users` table. Keep PBKDF2 verify-only for legacy hashes; rehash to argon2id on next successful login.
- NEW `backend/scripts/auth_migrate.py` CLI — `python -m backend.scripts.auth_migrate consolidate` copies `auth_password_users` rows into `auth_users` (kind=email, external_id=email) + `auth_credentials`. Idempotent via `ON CONFLICT DO NOTHING`. Dry-run flag.
- `requirements.txt` — add `argon2-cffi==23.1.0`.

**Files to modify (FE)** — none. The `core/deps.py:_user_from_bearer` change unifies sub→user resolution to a single table read.

**Architecture changes**
- One identity, one credential row, one MFA slot per user.
- `auth_users.kind` becomes "the primary provider" — a user can additionally have a credential row (email/password) even if their primary kind is `google`.

**Database changes**
```sql
CREATE TABLE auth_credentials (
    user_id            TEXT PRIMARY KEY REFERENCES auth_users(id) ON DELETE CASCADE,
    password_hash      TEXT,                              -- nullable for OAuth-only users
    password_hash_alg  TEXT NOT NULL DEFAULT 'argon2id',  -- argon2id | pbkdf2_sha256 (legacy)
    email_verified_at  TEXT,
    mfa_totp_secret    TEXT,                              -- reserved; Phase 1 leaves null
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL
);
-- auth_password_users is NOT dropped in PR #2 — left for one release as
-- "do not write, only read for fallback." Dropped in PR #6.
```

**API changes**
- `GET /auth/me` response gains `email_verified` boolean.
- `POST /auth/signup` and `/auth/login` now operate on the unified store. Response shape unchanged.

**Frontend changes:** none (response shape unchanged; new fields are additive).

**Security considerations**
- Argon2id at sensible cost (`time_cost=3, memory_cost=65536, parallelism=4` → ~50ms on Railway).
- Legacy PBKDF2 still verifiable; rehashed on next login.

**Testing requirements**
- Sign-up → login on argon2id end-to-end.
- Old PBKDF2 hash verifies; subsequent login rehashes.
- Account-merge: a user with both `auth_password_users` and `auth_users` (Google) ends up with one row after `auth_migrate consolidate`.
- Memory ownership intact post-migration (write before migration → read after migration returns the same row).

**Potential risks**
- 🟡 Migration could lose users if interrupted. Mitigation: dry-run first, idempotent re-runs, full backup of `auth.db` before running.

**Dependencies:** PR #1 merged.

**Complexity:** **High** (~5 days).

---

#### PR #3 — `feat(auth): refresh-token rotation for email + Google flows`

**Objective:** stop the 24h hard logout. Wire System B refresh rotation into login/signup/google.

**Files to modify (BE)**
- `backend/services/auth/service.py` — add `login_email(email, password)`, `signup_email(...)`, `login_google(id_token)` that all return `(user, access_token, refresh_token)`.
- `backend/routes/auth.py` — replace `_issue_access(user)` body with calls into `auth_service`. Same response shape, **with `refresh_token` added**.
- `backend/services/auth/storage.py:record_refresh_token` — store **SHA-256 hash of jti**, not the jti itself (S12 mitigation). Verify takes the raw jti, hashes, compares.

**Files to modify (FE)**
- `src/stores/authStore.ts` — store refresh token in **httpOnly cookie via a `/auth/refresh-cookie` endpoint** (preferred) OR `localStorage['korvix_refresh_token']` (acceptable interim). Add `apiRefresh()` helper.
- New: silent refresh interceptor — when any backend call returns 401, automatically POST `/auth/refresh` and retry once. Implement in a small `fetchWithAuth` wrapper.
- `apiLogin` / `apiSignup` / `apiGoogle` read `refresh_token` from response and persist.

**Architecture changes**
- `auth.py` route no longer owns token issuance. It delegates to `auth_service`. One mint path.

**Database changes**
- `auth_refresh_tokens.jti` column stays text, but the value stored is now `sha256(raw_jti).hex()`. Existing rows are left alone (any pre-existing guest refresh tokens just won't verify after this PR — operator should run a sweep CLI to invalidate. Acceptable hit for one deploy.)

**API changes**
- `/auth/login`, `/auth/signup`, `/auth/google` responses gain `refresh_token` and `refresh_expires_at`.
- NEW: `POST /auth/refresh` — same shape as `/v2/auth/refresh`, returns new access + refresh.
- NEW: `POST /auth/logout` revokes the refresh family (currently it's a no-op).

**Frontend changes**
- `fetchWithAuth(input, init)` wrapper — central place to attach Bearer and handle 401 → silent refresh → retry.
- Migrate `apiMe`, `apiLogout`, all `useOwnerMode` fetches to it.

**Security considerations**
- S3, S12 closed.
- Refresh-token family revoked on rotation reuse (already implemented in `auth_service.rotate_refresh`).
- Decision point for ADR: cookie vs localStorage for refresh token. **Recommendation: httpOnly Secure SameSite=Lax cookie** with separate refresh-only path. CSRF risk mitigated by SameSite + same-origin policy. **If we ship cookie, we MUST add CSRF token for state-changing routes.** Phase 1 ADR captures the decision.

**Testing requirements**
- Refresh roundtrip works.
- Reuse-of-revoked → 401 + whole family killed.
- Silent refresh on 401 happens at most once per failed request.
- `fetchWithAuth` doesn't infinite-loop if refresh itself returns 401.

**Potential risks**
- 🟡 Cookie-based refresh requires CORS adjustment (`credentials: 'include'`).
- 🟡 Existing access tokens issued before this PR continue to work until expiry (24h). No forced logout.

**Dependencies:** PR #2.

**Complexity:** **High** (~5 days).

---

#### PR #4 — `feat(auth): email verification flow + Resend transactional email`

**Objective:** sign-up sends a verification email; clicking the link sets `email_verified_at`.

**Files to modify (BE)**
- NEW `backend/services/auth/email_outbound.py` — Resend HTTP API client (single dep, single endpoint).
- NEW `backend/services/auth/verification.py` — issue verification tokens (short-lived `purpose=verify_email` JWTs), store nothing server-side. Verify consumes + sets `email_verified_at`.
- `backend/routes/auth.py` — `POST /auth/verify-email/request` (resend a verification email), `POST /auth/verify-email/confirm` (consume the token).
- `backend/services/auth/credentials.py` — `mark_email_verified(user_id)`.

**Files to modify (FE)**
- `src/pages/AuthPage.tsx` — splits begin here: post-signup screen "check your inbox" + resend button.
- NEW `src/pages/VerifyEmailLandingPage.tsx` — handles the `?token=...` link target.

**Architecture changes**
- A verification "token" is a JWT with `purpose=verify_email`, `sub=user_id`, `exp=now+24h`. Short-lived; no DB row.

**Database changes:** none beyond PR #2's `email_verified_at` column.

**API changes**
- `POST /auth/verify-email/request {email}` — always returns 200 (no enumeration). Sends email if user exists.
- `POST /auth/verify-email/confirm {token}` — sets `email_verified_at = now`, returns 200.

**Security considerations**
- Verification tokens are single-purpose (`purpose=verify_email` claim required at verify time).
- 24h TTL.
- Resend webhook signature verified.
- Email template includes the requesting IP + a "didn't request this" link.

**Testing requirements**
- Token mint + consume happy path.
- Wrong purpose (e.g. access token presented at /verify-email/confirm) rejected.
- Expired token rejected.
- Email enumeration check: `/verify-email/request` for unknown email returns 200 in the same time as known email.

**Potential risks**
- 🟢 Resend dep added (free tier covers up to 3k emails/month).
- 🟡 Email deliverability — needs SPF/DKIM on the sending domain. Documented in Railway runbook.

**Dependencies:** PR #2.

**Complexity:** **Medium** (~3 days).

---

#### PR #5 — `feat(auth): rate limiting + audit log on auth routes`

**Objective:** brute-force protection + observable auth events.

**Files to modify (BE)**
- NEW `backend/middleware/rate_limit.py` — minimal in-memory token-bucket. Per (IP, route) limits. Header-based opt-out for tests. Configurable thresholds via env. Replace with `slowapi` + Redis backend in Phase 7 prep.
- `backend/routes/auth.py` — `Depends(rate_limit_auth(per_minute=5))` on `/auth/login`, `/auth/signup`. `per_minute=2` on `/auth/verify-email/request`, `/auth/forgot-password`.
- `backend/services/admin/audit.py` — new entry types: `auth.signup`, `auth.login.success`, `auth.login.failure`, `auth.logout`, `auth.password_change`, `auth.email_verify`. Captures `user_id`, `ip`, `user_agent`.
- `backend/routes/auth.py` writes audit entries at each transition.

**Files to modify (FE)** — none (the limiter returns standard 429 envelopes; existing error handling surfaces them).

**Architecture changes:** none beyond the new middleware.

**Database changes:** none if audit log is already an append-only table; otherwise minor schema bump for new event kinds.

**API changes**
- 429 envelope on auth-route abuse with `Retry-After` header.

**Security considerations**
- S4 closed.
- Audit captures `ip` + `user_agent` for forensics.

**Testing requirements**
- 6 logins in 1 minute → 6th returns 429.
- Audit entries written for happy + sad paths.
- Reset-after-window works.

**Potential risks**
- 🟢 In-memory limiter is per-instance. Acceptable for one Railway instance; documented as future Redis swap.

**Dependencies:** PR #3 + PR #4 (rate limit the new routes too).

**Complexity:** **Medium** (~2 days).

---

#### PR #6 — `chore(auth): retire `auth_password_users` table + `auth_placeholder.py` middleware`

**Objective:** delete dead code once Phase 1 has been in production for ≥1 release.

**Files to modify (BE)**
- DELETE `backend/middleware/auth_placeholder.py`.
- DELETE `auth_password_users` table (via `auth_migrate drop-legacy --confirm`).
- DELETE `backend/services/auth/passwords.py` legacy table touches; keep only argon2 hash/verify utilities used by `credentials.py`.
- DELETE `routes/auth.py:_issue_access` helper (replaced by `auth_service` calls in PR #3).
- DELETE `routes/auth.py:GET /auth/status` stub.
- DELETE `routes/v2.py` and `routes/v2_auth.py:POST /v2/auth/guest` if no FE callers reference them — keep for now, verify in PR.

**Files to modify (FE)** — none, unless `apiGuest` calls exist (they don't today).

**Architecture changes:** clean-up only.

**Database changes:** `DROP TABLE auth_password_users` after verification that the migration in PR #2 copied all rows.

**API changes:** internal cleanup; FE-visible routes unchanged.

**Security considerations**
- One-time DROP must be gated by a `--confirm` flag in the CLI and require a backup file argument.

**Testing requirements**
- Smoke test: every existing test passes after deletion.

**Potential risks**
- 🟡 DROP TABLE is irreversible. Operator runs against a backup-confirmed prod first.

**Dependencies:** PR #2 has been in production for ≥1 release; usage metrics show zero reads of `auth_password_users`.

**Complexity:** **Low** (~1 day).

---

#### PR #7 — `feat(auth-fe): split AuthPage into SignIn / SignUp / ForgotPassword + shared <AuthForm>`

**Objective:** break the 986-line `AuthPage.tsx` into single-purpose pages. Enable lazy-loading (Phase 2 of FE roadmap depends on this).

**Files to modify (FE)**
- DELETE `src/pages/AuthPage.tsx` (or keep as a redirect shim for one release).
- NEW `src/pages/SignInPage.tsx` (~300 lines).
- NEW `src/pages/SignUpPage.tsx` (~300 lines).
- NEW `src/pages/ForgotPasswordPage.tsx` (~200 lines).
- NEW `src/components/auth/AuthForm.tsx` — shared form primitive: email + password fields, submit, error surface.
- NEW `src/components/auth/GoogleButton.tsx` — extracted GIS button.
- `src/App.tsx` — new routes `/auth/sign-in`, `/auth/sign-up`, `/auth/forgot-password`. Redirect `/auth` to `/auth/sign-in`. Use `React.lazy` on all three (alignment with Phase 2 FE).

**Files to modify (BE)** — none.

**Architecture changes:** FE-only refactor.

**Security considerations:** none beyond not regressing existing flows.

**Testing requirements**
- Visual smoke — three pages render.
- Sign-in / sign-up / Google buttons all still produce the expected POST.
- Bundle delta < +5 KB gzip (3 pages lazy-loaded).

**Potential risks:** 🟢 mechanical refactor.

**Dependencies:** PR #4 (verification screen referenced from sign-up).

**Complexity:** **Medium** (~3 days).

---

#### PR #8 — `docs(auth): runbook + ADR + Postgres-readiness audit`

**Objective:** capture decisions and prepare Phase 3 (Postgres) for a clean port.

**Files to modify**
- NEW `docs/runbooks/auth.md` — sign-in/up flows, refresh rotation, theft response, owner mode interaction, troubleshooting.
- NEW `docs/adr/0001-auth-token-storage.md` — decision: refresh token in httpOnly cookie OR localStorage, with the chosen mitigation list.
- NEW `docs/adr/0002-password-hashing.md` — argon2id at chosen cost params, rehash-on-login migration.
- NEW `docs/adr/0003-identity-unification.md` — single `auth_users` table, `auth_credentials` join, migration approach.
- `KORVIXAI_PRODUCTION_ROADMAP.md` — flip Phase 1 status to "in progress" / "complete".

**Security considerations:** documentation only.

**Testing requirements:** docs link-check.

**Dependencies:** all prior PRs.

**Complexity:** **Low** (~1 day).

---

### 3.4 Aggregate effort

| PR | Days | Risk | Blocker chain |
|---|---|---|---|
| 1 | 1 | 🟢 | — |
| 2 | 5 | 🟡 (migration) | 1 |
| 3 | 5 | 🟡 (cookie ADR) | 2 |
| 4 | 3 | 🟡 (Resend deliverability) | 2 |
| 5 | 2 | 🟢 | 3, 4 |
| 6 | 1 | 🟡 (DROP TABLE) | 2 (+ time in prod) |
| 7 | 3 | 🟢 | 4 |
| 8 | 1 | 🟢 | all |
| **Total** | **~21 days** | | |

Single-developer continuous work: ~3 weeks. With one PR-per-day merge cadence and Railway verification between each, this stretches to ~4–5 weeks elapsed.

### 3.5 Future compatibility (designed in but not implemented in Phase 1)

| Future feature | What Phase 1 prepares | Phase that activates |
|---|---|---|
| **Apple Sign-In** | `kind="apple"` reserved in `VALID_KINDS`; route stub already exists | 1.X follow-up |
| **Magic links** | `email_outbound.py` ships in PR #4; token issuance pattern reusable | 1.X follow-up |
| **MFA / TOTP** | `auth_credentials.mfa_totp_secret` column reserved (null in Phase 1) | Phase 7 |
| **Organizations** | `auth_users` design accepts an `org_memberships` join later; no `org_id` column on user table | Phase 10 |
| **RBAC** | Owner detection is the prototype; per-route `require_perm("memory:write")` decorator pattern designed but not implemented | Phase 10 |
| **Stripe billing** | `auth_users.id` is the canonical billing subject; no plan column yet | Phase 10 |
| **API keys** | Schema for `auth_api_keys(user_id, key_hash, scopes, created_at, last_used_at)` reserved in ADR | Phase 10 |
| **Enterprise SSO (SAML/OIDC)** | `kind` discriminator already supports adding `"saml"` / `"oidc"` as new values without schema change | Phase 11 |
| **Multi-tenancy** | All ownership writes go through `services/admin/owner.py` which is org-aware-ready (currently checks email; switching to membership is a one-method change) | Phase 10 |

### 3.6 ADRs Phase 1 must produce

1. **ADR-0001: Refresh-token storage** — httpOnly cookie vs localStorage. Recommendation: **httpOnly Secure SameSite=Lax cookie via dedicated `/auth/refresh` path, with explicit CSRF token on state-changing routes.** Alternative: localStorage with shorter refresh TTL (7d) and active-tab activity check.
2. **ADR-0002: Password hashing** — Argon2id with `time_cost=3, memory_cost=65536, parallelism=4`. Rehash on login for legacy PBKDF2.
3. **ADR-0003: Identity unification** — single `auth_users` table, separate `auth_credentials` for password + MFA. OAuth users have an `auth_users` row with no `auth_credentials` row (or one with null `password_hash`).

---

## Part IV — Open questions for sign-off

Before implementation begins, please confirm:

1. **Refresh token storage:** httpOnly cookie (recommended) OR localStorage? CSRF protection plan if cookie.
2. **Password hashing:** Argon2id (recommended), or stay PBKDF2 with `2_000_000` iterations? Argon2id adds one dep (`argon2-cffi`).
3. **Migration window:** can we tolerate any user being briefly logged out during the auth_password_users → auth_users consolidation? Or do we keep both readable until cutover (more code, zero downtime)?
4. **Email provider:** Resend (recommended for stdlib HTTP) vs Postmark vs SES? Resend's free tier suffices for early stage.
5. **Apple Sign-In timing:** ship in Phase 1.X or defer entirely until Phase 2? Recommend defer — Apple requires Mac-only key generation and adds friction.
6. **Magic link timing:** the plumbing lands in PR #4; do we ship the UX in PR #7 (alongside the AuthPage split) or defer to a separate small PR?

---

## Document lineage

- 2026-06-25 — initial audit, against `main @ aef9eec`. No implementation.
- Update after each PR merges to reflect new state.

---

**Awaiting approval to proceed to PR #1.**
