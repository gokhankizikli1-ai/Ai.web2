# KorvixAI — Sprint 1.2: Production Security Layer

**Scope:** authentication, authorization, ownership validation, and identity
propagation only. No features, no business-logic changes, no UI, no new AI,
no OAuth providers, no JWT replacement. Builds on the identity primitives
added in Sprint 1.1.

**Result:** identity resolution is centralized into one verified resolver +
an explicit permission model; the two known cross-tenant holes
(`/v2/chat/stream` unsigned-`sub`, `/v2/events` open SSE scope) are closed;
project and legacy-session resources are ownership-enforced; background
execution has an explicit, non-impersonating context. Backward compatible
(guest support preserved; route surface unchanged at 156).

---

## 1. Architecture Summary

**Inspected:** every identity-resolution implementation (`core/deps`,
`routes/chat`, `routes/v2_chat_stream`, middleware), every route's auth
dependency, all SSE/streaming endpoints, and how background jobs carry
identity. Findings:
- `core/deps` already held the canonical resolver (Sprint 1.1), but
  `v2_chat_stream` had a **separate** resolver that trusted an **unsigned**
  JWT `sub`.
- `/v2/events/stream` (SSE) had **no auth and no scope ownership** — `*`
  leaked every tenant's events.
- Legacy `/projects/*` and `/sessions/*` took identity from the payload with
  **no ownership** checks.
- `v2_jobs` already records the creator's `user_id` from `current_user` —
  the worker model was sound; it just lacked an explicit principal type.

## 2. Authentication Flow Diagram

See `SECURITY.md` §1 for the full diagram. Summary precedence (one resolver,
`resolve_uid_and_source`): `request.state.user_id` (middleware) → **verified**
Bearer `sub` → `X-Korvix-Guest-Id` nonce → `body.user_id` (legacy) →
`anonymous`. A forged/expired token never falls through to the body.

## 3. Authorization Model

Explicit `PrincipalKind`: `GUEST · USER · OWNER · ADMIN · INTERNAL ·
WORKER` (no magic booleans). Decisions: `Principal.owns_user(uid)` and
`Principal.may_access_scope(scope)`. Cross-user reads return **404**
(existence-hidden); wildcard `*` event scope is owner-only; guests are a
first-class lower-trust tier scoped to their own nonce. Full model in
`SECURITY.md` §2–3.

## 4. Files Changed (and why)

**New**
- `backend/core/principal.py` — the centralized identity + permission model
  (`Principal`, `PrincipalKind`, `resolve_principal`, `system_principal`,
  `worker_principal`, scope/ownership helpers). *Why:* one authoritative
  answer to "who is this and what may they touch", built on the audited
  deps primitives so there's no second identity implementation to drift.
- `backend/tests/test_sprint12_security_layer.py` — 17 security regression
  tests.
- `SECURITY.md` — authentication/ownership/permission/identity-propagation
  documentation + OAuth-readiness.

**Identity centralization**
- `backend/core/deps.py` — extracted `resolve_uid_and_source()` as the
  single `(uid, source)` implementation; `resolve_authoritative_uid` now
  wraps it. *Why:* `/chat`, `/v2/chat/stream`, `/v2/orchestrate` all share
  one verified contract.
- `backend/routes/v2_chat_stream.py` — `_resolve_user_id` now delegates to
  the shared **verified** resolver. *Why:* it previously base64-decoded the
  Bearer `sub` **without verifying the signature**, so a forged token could
  read/write another user's memory namespace; that hole is closed.

**SSE scope ownership**
- `backend/routes/v2_events.py` — `stream` now resolves the principal and
  authorizes the requested scope (`user:`/`project:`/`run:`/`*`) before
  subscribing; mechanics extracted to `_open_stream`. *Why:* close the
  cross-tenant event leak; `*` is owner-only.

**Resource ownership**
- `backend/routes/projects.py` — every project + sub-resource (memory,
  agents, threads) endpoint resolves the principal and enforces
  `owner_user_id`; create derives the owner from the verified identity, not
  the body. *Why:* close the unauthenticated/cross-user IDOR while preserving
  the header-less guest FE.
- `backend/routes/sessions.py` (legacy) — same ownership policy across
  workspaces → threads → messages (chained ownership). *Why:* the legacy
  copy of the secured `/v2/sessions` must not be able to leak across users
  if enabled.

**Test fixture adjustments**
- `backend/tests/test_phase35_events_stream.py` — drive `_open_stream`
  (mechanics) directly; HTTP authorization is covered by the new security
  tests.
- `backend/tests/test_memory_plane_stream_chat.py` — replaced the test that
  asserted the **insecure** unsigned-`sub` behaviour with two tests
  asserting the secure contract (verified JWT wins; forged token rejected).

## 5. Security Improvements (what became safer)

1. **`/v2/chat/stream` no longer trusts forged tokens.** Identity now
   requires a verified signature; a forged/unsigned `sub` degrades to the
   guest/body path and cannot assume a victim's memory namespace. (Test:
   `test_forged_jwt_is_rejected`.)
2. **SSE event streams are tenant-isolated.** A user can only subscribe to
   their own `user:`/`project:`/`run:` scopes; `*` is owner-only; anonymous
   is denied. (Tests: `test_sse_*`.)
3. **Projects are ownership-enforced.** An authenticated user cannot read,
   modify, or enumerate another user's projects, memory, or agents; create
   can't spoof the owner via the body. (Tests: `test_project_*`.)
4. **Legacy sessions are ownership-enforced** across the workspace → thread
   → message chain. (Tests: `test_session_*`.)
5. **Identity is centralized** — one verified resolver + one permission
   model; the duplicate stream resolver is gone.
6. **Background execution is explicitly non-impersonating** — `WORKER`
   principals are scoped to the job creator and carry no owner powers;
   `INTERNAL` is system-only and never request-derived.

## 6. Remaining Risks (Sprint 1.3 candidates)

- `ENABLE_AUTH_V2` is off by default — inline verify still holds the
  guarantee, but central middleware is recommended before scaling.
- No org/team RBAC yet (the `ADMIN` level is reserved).
- No rate limiting on `/v2/auth` endpoints.
See `SECURITY.md` §7.

## 7. Test Results

- New `test_sprint12_security_layer.py`: **17 passed** (principal model,
  forged/expired tokens, owner via identity + token, worker/system context,
  SSE deny paths, project + session cross-user blocking, guest preservation).
- Updated stream identity tests: verified-JWT-wins + forged-rejected pass.
- Existing suites that touch the changed routes (events, projects,
  orchestrate, sessions, chat) pass unchanged. Route surface unchanged (156).
- Pre-existing, unrelated failures (2 memory-plane date-directive assertions;
  1 `test_phaseA2` full-run ordering flake; `test_prompt_manager` needs the
  `google` SDK locally) are documented and not introduced by this sprint.

## 8. Documentation Updates

- `SECURITY.md` (new) — full security model.
- This deliverable.

## 9. Recommended Sprint 1.3

**Enable & centralize auth verification + minimal RBAC foundation.**

Turn `ENABLE_AUTH_V2=true` into the supported default (AuthMiddleware
validates every token centrally; the inline verify becomes the fallback),
add rate limiting to `/v2/auth`, and lay the first RBAC slice: promote the
reserved `ADMIN` level and add a project-membership table so `owns_user`
can grow into `can(action, resource)` without per-route changes. This
continues "make the security layer production-grade" and unblocks
multi-tenant team/org features — still no business-logic or UI changes.
