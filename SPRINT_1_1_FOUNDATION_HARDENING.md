# KorvixAI — Sprint 1.1: Production Foundation Hardening

**Goal:** increase production readiness and reduce operational risk for the
existing platform **without adding features**. Driven by the Phase 0
Architecture Audit (`KORVIXAI_ARCHITECTURE_AUDIT.md`). Every assumption was
verified against the implementation before changing code.

**Result:** the two Critical audit findings (ephemeral persistence;
unauthenticated legacy IDOR routes) and one High finding (orchestration
identity derived from request payload) are addressed. All changes are
backward-compatible and default to byte-identical production behaviour
until an operator opts in.

---

## 1. Architecture Summary — what was inspected

- **Persistence layer:** every SQLite store. Two patterns found — function
  `_db_path()` (resolves at call time) and module-level `DB_PATH` (resolves
  at import). The root-level live DBs (`memory.py`, `db.py`,
  `usage_limits.py`) **hardcoded** `DB_PATH = "memory.db"` and didn't even
  read an env var — so live user memory/usage could never be redirected to
  a durable volume. Confirmed the test harness always sets an explicit
  `*_DB_PATH` per test (so an env-var-first resolver is safe).
- **Identity / auth:** `core/deps.py` (`current_user`, `require_auth`,
  `require_owner`), `routes/chat.py` (`_resolve_authoritative_uid` — the
  Phase-1 P0 anti-impersonation fix), `services/admin/owner.py`
  (`is_owner_request`).
- **Orchestration endpoints:** `/v2/orchestrate` (Phase 3.4) and its read
  routes; `/v2/orchestrator/*` (Phase A.2, already auth-bound).
- **Legacy routes:** `/memory`, `/profile`, `/stats` (unauthenticated);
  confirmed via `grep` that the **frontend never calls them** and **no test
  references them** — safe to harden.
- **Config + startup:** `core/config.py`, the `_startup` hook in
  `backend/api.py`, the feature-flag surface.

## 2. Production Risks — remaining after this sprint

| Sev | Risk | Status after sprint |
|-----|------|---------------------|
| **Critical** | Ephemeral SQLite data loss on Railway | **Mitigated** — one env var (`KORVIX_DATA_DIR`) now moves every DB onto a durable volume; startup logs a loud warning while volatile. *Requires the operator to actually mount a volume + set the var* (infra step, not code). |
| **High** | Legacy IDOR (`/memory` read/write/delete any user) | **Closed** — ownership-enforced; unauthenticated callers denied. |
| **High** | `/v2/orchestrate` trusted `body.user_id` for identity | **Closed** — identity from authenticated context; read routes scoped. |
| Medium | No true RBAC / org model | Unchanged — out of scope (feature work). |
| Medium | `v2_chat_stream` unverified JWT `sub` when AuthMiddleware off | Unchanged — flagged; recommended `ENABLE_AUTH_V2=true` (now surfaced by the startup self-check). |
| Medium | `v2_events` SSE scope authz | Unchanged — route is flag-off; tracked for the next security pass. |
| Low | In-memory queues/bus lose data on restart | Unchanged by design (best-effort, flag-off). |

**Top residual action (infra, not code):** mount a Railway volume and set
`KORVIX_DATA_DIR=/data` (or migrate `auth.db`+`memory.db` to Postgres). The
code now makes this a one-line ops change; until then the startup banner
says `Persistence | EPHEMERAL`.

## 3. Files Changed — what and **why**

**New**
- `backend/core/paths.py` — single source of truth for DB-file resolution.
  *Why:* eliminate ~15 independent `os.getenv(..., "x.db")` call-sites and
  give persistence one seam so a volume/Postgres move is config-only. Strict
  precedence: explicit env var → `KORVIX_DATA_DIR`/`RAILWAY_VOLUME_MOUNT_PATH`
  → legacy relative filename (so nothing changes until configured).
- `backend/tests/test_sprint11_foundation_hardening.py` — 20 regression
  tests covering all four changes.

**Persistence wiring** (`*_db_path()` / `DB_PATH` now call `resolve_db_path`)
- `backend/core/config.py` (DB path defaults), and the stores:
  `jobs`, `assets`, `vision`, `workflows`, `agent_tasks`, `panels`,
  `agent_messenger`, `scratchpad`, `sessions`, `projects`,
  `orchestrator/{runs,tasks,deliverables}_store`, `memory_plane/store_sqlite`,
  `tool_executions`, `admin/audit`.
  *Why:* every subsystem follows the configured data dir; explicit env vars
  still win, so tests and existing deploys are unchanged.
- `memory.py`, `db.py`, `usage_limits.py` (root) — resolve `DB_PATH` via the
  helper with a defensive fallback. *Why:* this is the **live** user
  memory/usage store; it was hardcoded and unmovable — the single most
  important durability fix.

**Configuration / startup**
- `backend/core/config.py` — added `validate_runtime()` returning
  `(severity, message)` issues (ephemeral-persistence, missing/short JWT
  secret when auth on, weak owner config, orchestrator-without-auth) and the
  `ENABLE_LEGACY_USER_ROUTES` deprecation flag. *Why:* fail **safe, not
  hard** — surface insecure/volatile config loudly without ever blocking
  boot.
- `backend/api.py` `_startup` — logs a persistence banner (DURABLE vs
  EPHEMERAL) and the `validate_runtime()` findings. *Why:* operators see the
  risk in the deploy logs instead of discovering it via data loss.

**Identity hardening**
- `backend/core/deps.py` — added `resolve_authoritative_uid()` (the shared
  JWT→guest→body precedence, lifted from `chat.py`) and
  `authorize_user_scope()` (ownership check that never trusts the
  caller-supplied id). *Why:* one implementation used by `/chat` **and**
  `/v2/orchestrate` instead of two that can drift.
- `backend/routes/chat.py` — `_resolve_authoritative_uid` now delegates to
  the shared helper (behaviour + `CHAT` log prefix preserved). *Why:* remove
  duplication; the live chat path is unchanged.
- `backend/routes/v2_orchestrate.py` — POST derives identity from the
  authenticated context (not `body.user_id`); read routes (`/runs`,
  `/runs/{id}`, `/runs/{id}/tasks`, `/projects/{id}/tasks`) scope by identity
  (owner sees all; authenticated caller only their own → 404 otherwise;
  guests keep the legacy contract). *Why:* close impersonation +
  cross-tenant enumeration before the orchestrator is ever enabled.

**Legacy route hardening** (deprecation over deletion)
- `backend/routes/memory.py`, `profile.py` — ownership-enforced via
  `authorize_user_scope`; `410 Gone` when `ENABLE_LEGACY_USER_ROUTES=false`;
  routes marked `deprecated=True`. *Why:* close the worst IDOR while keeping
  the endpoints (and guest self-access) working.
- `backend/routes/stats.py` — marked deprecated, kill-switch added, dead
  unused `OWNER_ID` removed. *Why:* low-sensitivity; leave readable, tidy up.

**Drive-by cleanup**
- Removed the dead `OWNER_ID` import in `stats.py`. No other behavioural
  cleanup, to keep the diff reviewable and safe.

## 4. Security Improvements — exactly what became safer

1. **Legacy memory/profile IDOR closed.** Previously *anyone* could
   `GET/POST/DELETE` **any** user's memory by supplying a `user_id`. Now the
   caller's identity is resolved from the authenticated context only (an
   unauthenticated caller resolves to `"anonymous"` and is denied with 403);
   guests may access only their own nonce-scoped data; owners may access any.
   Verified by tests (unauth → 403, guest-self → 200, guest-cross → 403).
2. **Orchestration identity can no longer be spoofed.** A logged-in client
   sending `body.user_id` of another account is ignored — the run is created
   under the verified JWT subject. Verified by
   `test_orchestrate_body_user_id_cannot_impersonate`.
3. **Cross-tenant run/task enumeration closed** for authenticated callers on
   the orchestrate read routes (existence-hidden 404). Verified by
   `test_orchestrate_read_routes_scope_by_identity`.
4. **Insecure config is now visible at boot** (missing JWT secret when auth
   is on, weak owner setup) instead of silently accepted.
5. **One-switch retirement** of the whole legacy surface
   (`ENABLE_LEGACY_USER_ROUTES=false` → 410).

## 5. Persistence Improvements — production impact

- **All databases can now live on a durable volume** via a single env var.
  Set `KORVIX_DATA_DIR=/data` (or mount a Railway volume, which exports
  `RAILWAY_VOLUME_MOUNT_PATH`) and every SQLite file — including the live
  `memory.db`/`auth.db` — is written there and survives redeploys. No code
  change, no schema migration.
- **The live user-data store is no longer hardcoded.** `memory.py`/`db.py`/
  `usage_limits.py` previously pinned `"memory.db"` in the working dir; they
  now follow the configured data dir.
- **Future Postgres path is unblocked.** A single resolution seam
  (`resolve_db_path`) plus the existing `ENABLE_POSTGRES_BACKEND` adapter in
  `memory_plane` means a per-store backend swap no longer touches call-sites.
- **Zero change when unconfigured:** with no data dir set, paths are the
  exact legacy relative filenames.

## 6. Configuration Improvements — startup behaviour

- `settings.validate_runtime()` runs in `_startup` and logs, at the
  appropriate level (`critical`/`warning`/`info`):
  - **Persistence durability** — `EPHEMERAL` warning (critical when a
    stateful subsystem is enabled in prod).
  - **JWT secret** — critical when auth verification is on but the key is
    empty/<32 bytes.
  - **Owner config** — warning when admin mode is on without owner email/token.
  - **Orchestrator without AuthMiddleware** — advisory.
- **Fail safe, never fail hard:** the check only logs; the process always
  boots so Railway's `/health` probe passes even with bad config.
- A persistence banner (`DURABLE`/`EPHEMERAL` + data dir) prints every boot.

## 7. Backward Compatibility — why existing systems keep working

- **Persistence:** `resolve_db_path` returns the *explicit env var first*,
  then the legacy relative filename when no data dir is set — byte-identical
  to before. The full test suite (which sets per-test `*_DB_PATH`) passes
  unchanged.
- **Chat:** `_resolve_authoritative_uid` delegates to the shared helper with
  the same precedence and log prefix — the live `/chat` path is unchanged
  (all chat/auth tests green).
- **Orchestrate:** unauthenticated/guest callers (how the existing tests and
  current FE behave) keep the legacy contract; only *authenticated*
  identity-spoofing and cross-tenant reads are newly blocked. All
  `test_phase34/42/51/A2` and owner-policy tests pass.
- **Legacy routes:** still mounted, still return their original shapes for
  the authorized caller; guest self-access preserved; the FE doesn't call
  them so nothing breaks. Off-switch defaults to on.
- **Route surface unchanged:** the app still exposes 156 routes; nothing was
  removed.

## 8. Testing

- **New:** `backend/tests/test_sprint11_foundation_hardening.py` — 20 tests:
  path resolution & precedence, `validate_runtime`, `resolve_authoritative_uid`
  (JWT/guest/body/bad-token), legacy IDOR (deny/allow/owner/410), and
  orchestrate identity + read-route scoping (integration).
- **Full suite:** **1738 passed**, 6 skipped (optional deps), with my changes.
- **Regression proof:** ran the full suite on **clean `main`** for comparison
  — the only non-environment failures there (2 `memory_plane_stream_chat`
  date-directive assertions + 1 `test_phaseA2` full-run ordering flake) are
  **identical and pre-existing**; this sprint introduces **zero** new
  failures. The 11 `test_prompt_manager` failures are an environment gap
  (`google-generativeai` not installed locally); they pass where the SDK is
  installed (CI/Railway).
- Verified: `py_compile` of all changed files, full-app import, startup hook
  execution, and that the route count is unchanged.

## 9. Documentation

- This document.
- New operational env vars (add to your Railway config / deploy template):
  - `KORVIX_DATA_DIR` — directory for all SQLite DBs (set to your mounted
    volume path, e.g. `/data`). Unset ⇒ ephemeral working dir (dev only).
  - `ENABLE_LEGACY_USER_ROUTES` (default `true`) — set `false` to retire the
    legacy `/memory` `/profile` `/stats` routes (return 410).
  - `RAILWAY_VOLUME_MOUNT_PATH` — honoured automatically when a Railway
    volume is mounted (no action needed beyond mounting).
- The audit's Recommended Refactor Order items #1 (persistence), #2 (legacy
  routes) and #3 (orchestrate identity) are now done.

## 10. Recommended Next Sprint (only one)

**Sprint 1.2 — Auth verification on + remaining v2 identity gaps.**

Why this and only this: the persistence + identity *foundation* is now in
place, but two known security gaps remain that are cheap to close and are
prerequisites for ever turning on the v2 write surfaces in multi-tenant prod:
(1) make `ENABLE_AUTH_V2=true` the supported default and verify AuthMiddleware
end-to-end (the startup check already nudges this); (2) fix the
`v2_chat_stream` unverified-JWT-`sub` path and add scope-ownership to the
`/v2/events` SSE stream. This continues the "make the live path trustworthy
before enabling more" theme without touching any feature code, and unblocks a
later sprint that actually flips the orchestrator on.
