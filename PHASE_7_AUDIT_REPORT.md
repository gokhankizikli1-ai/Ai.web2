# Phase 7 — Audit Report

**Subsystem:** Job Queue + Async Execution Infrastructure
**Inspected against:** `main @ 55150ae`
**Source of truth:** `PROJECT_ROADMAP.md` (Phase 7 section), `PROJECT_ROADMAP_UPDATED.md`, Phase 7 spec from the implementation thread
**Test suite at audit time:** 1417 passing, 1 skipped
**Author:** Engineering — automated audit
**Date:** 2026-05-28

---

## Executive summary

| Metric | Value |
|---|---|
| **Phase 7 completion** | ~65% |
| **Backend infrastructure** | Complete (slices 1 + 2 merged) |
| **Production usage of infrastructure** | Not yet — no real handler has been ported to Celery |
| **Remaining PRs to close phase** | 3 |
| **Estimated work to v1.0 Phase 7 milestone** | ~1 week of focused engineering |

Phase 7's foundation (Redis client, CeleryJobRunner, dispatcher task, pub/sub fanout) is production-grade. The remaining gap is **adoption**: no real handler is queued through Celery yet, no DLQ, no FE consumer for live progress. Three additional PRs close the phase fully.

---

## 1. Completed items ✅

| # | Item | Source PR | Location |
|---|---|---|---|
| 1 | Redis client (sync + async, pool, env-driven) | Slice 1 (#148) | `backend/services/redis_client/` |
| 2 | `redis==5.0.4` + `celery==5.4.0` deps | Slice 1 | `requirements.txt` |
| 3 | Celery app factory with production config | Slice 1 | `backend/jobs/celery_app.py` |
| 4 | `task_acks_late=True`, `prefetch_multiplier=1`, `task_time_limit=900s`, 6 queues registered | Slice 1 | `backend/jobs/celery_app.py` |
| 5 | **CeleryJobRunner** (real implementation, replaces `NotImplementedError` stub) | Slice 1 | `backend/services/jobs/runner.py:344-440` |
| 6 | Worker dispatcher task `korvix.jobs.dispatch` (retry 3x w/ backoff, idempotent on terminal status) | Slice 1 | `backend/jobs/tasks.py` |
| 7 | Procfile worker entry binding all 6 queues | Slice 1 | `Procfile` |
| 8 | `/v2/db/health.redis` block (enabled, url, version, metrics) | Slice 1 | `backend/services/db/health.py` |
| 9 | Redis pub/sub fanout (cross-process job events) | Slice 2 (#149) | `backend/services/jobs/events_redis.py` |
| 10 | `RedisFanout` singleton + startup/shutdown lifecycle hooks | Slice 2 | `backend/services/jobs/events_redis.py`, `backend/api.py` |
| 11 | **Critical no-event-storm invariant** via `_publish_local` | Slice 2 | `backend/services/jobs/events.py`, test-locked |
| 12 | Jobs store + `JobRecord` + `idempotency_key` | pre-Phase 7 | `backend/services/jobs/store.py` |
| 13 | `POST /v2/jobs`, `GET /v2/jobs(/{id})` REST routes | pre-Phase 7 | `backend/routes/v2_jobs.py` |
| 14 | `GET /v2/jobs/{id}/stream` SSE route | pre-Phase 7 | `backend/routes/v2_jobs.py` |
| 15 | `@korvix_task` decorator + handler registry | pre-Phase 7 | `backend/services/jobs/decorators.py`, `registry.py` |
| 16 | FE `useJobs()` polling hook (list view) | pre-Phase 7 | `src/hooks/useJobs.ts` |

**Backend infrastructure is complete and production-ready.** The SSE route works cross-process thanks to slice 2; CeleryJobRunner publishes correctly when `JOB_QUEUE_MODE=celery`.

---

## 2. Partial items ⚠️

| Item | What works | What's missing |
|---|---|---|
| **Per-queue routing** | 6 queues defined in Celery config (`korvix.default`, `.research`, `.vision`, `.embeddings`, `.orchestration`, `.maintenance`) | `_queue_for_record()` always returns `korvix.default`. No kind → queue mapping logic. |
| **Failure recovery** | Auto-retry (`max_retries=3`, exponential backoff via `default_retry_delay=10s`) | No DLQ. Exhausted-retry jobs land in `STATUS_FAILED` but stay in the main queue. Cannot triage failed jobs separately. |
| **Cancellation through Celery** | Inline runner checks `is_cancelled` via DB read between phases. | Celery dispatcher hardcodes `is_cancelled=lambda: False` (`backend/jobs/tasks.py:109`). **Celery-run jobs cannot be cancelled mid-flight.** |
| **Worker monitoring** | Celery emits worker heartbeats internally; Railway shows worker service status | `/v2/db/health` does not surface "are any workers alive". Operator must check Railway dashboard manually. |
| **Queue observability** | Redis metrics track `publishes`, `commands_total`, `pings_total`, `last_error` | No `LLEN korvix.*` is reported. Backlog depth invisible. |

---

## 3. Missing items ❌

| # | Item | Impact |
|---|---|---|
| M1 | **Vision pipeline ported to a job kind** | Longest-running operation (gpt-4o-mini vision call, 10–30s) still runs inline through `services/vision/analyzer.py`. SSE bridge wired but nothing real flows through it. |
| M2 | **Web research deep mode ported to a job kind** | Multi-source synthesis still runs inline. Watchdog fires after 30s idle / 90s total — anything longer is silently truncated. |
| M3 | **Dead Letter Queue (`korvix.dlq`)** | Failed-after-3-retries jobs should route here for triage instead of staying in the main queue. |
| M4 | **Orphan reaper** | Worker crash mid-task leaves the row in `status=running` forever. Inline runner cancels on API shutdown; Celery has no equivalent sweep. |
| M5 | **`useJob(id)` SSE hook** (FE) | `useJobs()` polls the list; no per-job EventSource consumer exists for live progress on a single job. |
| M6 | **`<JobProgress>` chip in chat** (FE) | Roadmap explicitly calls for this to replace the static "Thinking…" spinner with live ticks. |
| M7 | **`<JobsDrawer>` owner UI** | Roadmap explicitly calls for: "see all running / queued / failed jobs across the system". |

---

## 4. Broken items 🔴

**None.** Phase 7 slices 1 + 2 are stable. The gaps above are unimplemented work, not regressions.

---

## 5. Remaining PRs to close Phase 7

Three PRs sized for safe one-at-a-time merge and Railway verification.

### Slice 3 — Backend: handler ports + per-kind routing + Celery cancellation

| Concern | Detail |
|---|---|
| Vision port | New `vision.analyze` job kind. Handler wraps `services/vision/analyzer` and emits `progress` events at key checkpoints. |
| Research port | New `research.deep` job kind for multi-source synthesis. Reports progress per source fetched. |
| Per-queue routing | Rewrite `_queue_for_record(record_id)` to look up the kind and route: `vision.*` → `korvix.vision`, `research.*` → `korvix.research`, `embeddings.*` → `korvix.embeddings`, etc. |
| Celery cancellation | Replace `is_cancelled=lambda: False` in `backend/jobs/tasks.py` with a real DB-polling check (read `record.status` between handler phases, return True when `cancelled`). |
| New env vars | `JOB_QUEUE_VISION=true`, `JOB_QUEUE_RESEARCH=true` (per-kind enable so a single bad handler can be rolled back without disabling all of Celery). |
| Tests | `test_phase7_slice3_handler_ports.py` — ~14 tests covering vision/research handlers, routing, cancellation round-trip. |
| Estimate | ~2 days |

### Slice 4 — DLQ + observability + orphan reaper

| Concern | Detail |
|---|---|
| DLQ routing | In the dispatcher's final retry failure, route to `korvix.dlq` queue + set `status=failed_dlq`. |
| Queue depth | Per-queue `LLEN` surfaced in `/v2/db/health.redis.queues = [{name, depth}, ...]`. |
| Worker liveness | Each worker writes `SETEX korvix.worker.<host> 60 alive` every 30s; health endpoint reads all keys and reports active workers. |
| Orphan reaper | Periodic Celery task (`maintenance.orphan_reaper`) that finds rows with `status=running` and `started_at` > `WORKER_HEARTBEAT_TIMEOUT_S` → mark `failed` with `error=orphan_reaped`. |
| New env vars | `WORKER_HEARTBEAT_TIMEOUT_S=900`, `ENABLE_ORPHAN_REAPER=true`. |
| Tests | `test_phase7_slice4_dlq_reaper.py` — ~10 tests covering DLQ routing, queue depth probe, reaper time-based logic. |
| Estimate | ~1-2 days |

### Slice 5 — Frontend: useJob hook + JobProgress chip + JobsDrawer

| Concern | Detail |
|---|---|
| `useJob(id)` hook | SSE-backed (`EventSource("/v2/jobs/${id}/stream")`) returning `{status, progress, label, result, error}`. Reconnect on disconnect. |
| `<JobProgress>` chip | Compact component consumed by the chat composer when a long tool call enqueues a job. Replaces the static "Thinking…" spinner. |
| `<JobsDrawer>` (owner) | Sidebar at `/admin/jobs` listing all jobs with filter by status + click-through to detail. Owner-only. |
| Tests | `useJob.test.ts`, `JobProgress.test.tsx`, `JobsDrawer.test.tsx` — ~12 tests covering reconnect, progress tick rendering, drawer filter, owner gate. |
| Estimate | ~2-3 days |

---

## 6. Recommended execution order

```
Slice 3 (backend handlers)
   │  Required: makes the infrastructure visibly useful end-to-end
   ▼
Slice 4 (DLQ + observability + reaper)
   │  Required: operational hardening once real handlers are flowing
   ▼
Slice 5 (frontend UI)
   │  Required: user-visible "premium AI workspace" feel
   ▼
Phase 7 closed
```

**Rationale:**
- Slice 4 is only meaningful once real handlers are flowing (slice 3 must land first).
- Slice 5 depends on slice 3 producing visible progress to render.
- Each slice is independently mergeable and Railway-verifiable.

---

## 7. Railway configuration checklist

### Already configured (slices 1–2)

- [x] `REDIS_URL` on API service
- [x] `REDIS_URL` on worker service
- [x] `ENABLE_REDIS=true` on API service
- [x] `ENABLE_REDIS=true` on worker service
- [x] `JOB_QUEUE_MODE=celery` on API service
- [x] `JOB_QUEUE_MODE=celery` on worker service
- [x] `ENABLE_JOB_QUEUE=true` on both services
- [x] Worker service deployed from `Procfile worker:` entry

### Required by Slice 3

- [ ] `JOB_QUEUE_VISION=true` on both services
- [ ] `JOB_QUEUE_RESEARCH=true` on both services

### Required by Slice 4

- [ ] `WORKER_HEARTBEAT_TIMEOUT_S=900` on both services (default 15min)
- [ ] `ENABLE_ORPHAN_REAPER=true` on worker service only

### Required by Slice 5

- [ ] No new env vars

---

## 8. Testing checklist

### Per-slice test plan

| Slice | Test file | Tests | Critical invariants |
|---|---|---|---|
| 3 | `test_phase7_slice3_handler_ports.py` | ~14 | Vision handler smoke through inline runner · vision routes to `korvix.vision` · research handler reports progress · cancellation flips `is_cancelled()` true on next poll · queue routing rejects unknown kind |
| 4 | `test_phase7_slice4_dlq_reaper.py` | ~10 | DLQ routing on max_retries · `LLEN` reported · stale heartbeat reports unhealthy · orphan reaper marks orphans without touching healthy rows |
| 5 | `useJob.test.ts`, `JobProgress.test.tsx`, `JobsDrawer.test.tsx` | ~12 | SSE reconnect after disconnect · progress tick rendering · drawer filter state preserved · owner-only gate enforced |

### Cross-slice regression

- [ ] After every slice merge: full backend suite must pass (currently 1417)
- [ ] After every slice merge: `npx tsc -b` clean, `npm run build` clean
- [ ] After slice 5 merge: FE bundle size delta < +50 KB gzip (lazy-load the drawer)

---

## 9. Deployment verification checklist

### After Slice 3 merges

- [ ] Railway: trigger a vision analyze via chat attachment. SSE stream emits `status: running` → `progress: 50` → `done`.
- [ ] Worker logs show `[JOB][WORKER] dispatch start record_id=… kind=vision.analyze`.
- [ ] `/v2/db/health.redis.metrics.publishes` increments per analyze.
- [ ] Submit a job + immediately cancel it. Worker observes `is_cancelled()=true` and writes `status=cancelled` before completion.

### After Slice 4 merges

- [ ] `/v2/db/health.redis.queues` returns `[{name: "korvix.default", depth: N}, ...]`.
- [ ] Kill a worker mid-task. After `WORKER_HEARTBEAT_TIMEOUT_S` the row flips to `status=failed, error="orphan_reaped"`.
- [ ] Force a handler to raise 3x in a row. Resulting row lands in DLQ + `status=failed_dlq`.
- [ ] `/v2/db/health.redis.workers` returns active worker hostnames within the heartbeat TTL.

### After Slice 5 merges

- [ ] Chat shows `<JobProgress>` chip ticking 0% → 100% on vision analyze.
- [ ] Owner navigates to `/admin/jobs`, sees the drawer with filter by status.
- [ ] SSE consumer reconnects automatically after a forced network drop.
- [ ] Mobile Safari verified — chip renders correctly, drawer scrolls.

---

## 10. Definition of Done for Phase 7

Phase 7 is **closed** when ALL of the following are true:

### Backend

- [ ] At least 2 real handlers (vision + research) are dispatched through Celery in production
- [ ] Per-kind queue routing maps every shipped kind to its dedicated queue
- [ ] Cancellation works end-to-end on Celery: user clicks "Cancel" → worker observes `is_cancelled=true` → row lands in `status=cancelled` within one handler checkpoint
- [ ] Dead Letter Queue routes max-retries-exceeded jobs to `korvix.dlq` with `status=failed_dlq`
- [ ] Orphan reaper runs periodically; worker-crashed rows land in `status=failed, error=orphan_reaped` within `WORKER_HEARTBEAT_TIMEOUT_S`
- [ ] Worker heartbeat ping visible in `/v2/db/health.redis.workers`
- [ ] Per-queue depth visible in `/v2/db/health.redis.queues`

### Frontend

- [ ] `useJob(id)` SSE hook reconnects automatically on disconnect
- [ ] `<JobProgress>` chip renders live progress in the chat composer for long tool calls
- [ ] `<JobsDrawer>` owner-only view at `/admin/jobs` lists all jobs with filter by status
- [ ] FE bundle size delta vs pre-Phase 7 < +50 KB gzip

### Operations

- [ ] Railway: API + worker services healthy, autoscale-compatible
- [ ] Railway: `/v2/db/health.redis.ok = true` with `subscribes >= 1` per API replica
- [ ] Railway: `metrics.publishes` increments under real chat traffic
- [ ] No silently lost jobs (every published task either succeeds, retries, lands in DLQ, or gets reaped)

### Tests

- [ ] Full backend suite: passing (baseline 1417 + ~24 new = ~1441 target)
- [ ] `npx tsc -b` clean
- [ ] `npm run build` clean
- [ ] Mobile Safari smoke test passes for the new FE components

### Documentation

- [ ] `PROJECT_ROADMAP_UPDATED.md` Phase 7 row marked READY
- [ ] `docs/runbooks/job-queue-debug.md` (NEW) documents:
  - How to inspect a stuck job
  - How to drain a queue
  - How to triage DLQ contents
  - How to scale workers per queue

---

## 11. Risks and mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Vision job pinning a worker for too long (gpt-4o-mini occasional 60s+ latency) | 🟡 | `task_time_limit=900s` already enforced. Slice 3 handler must checkpoint every ~5s for cancellation. |
| Upstash Redis quota exhaustion under heavy publish | 🟡 | Metrics counter surfaces; alert when `commands_failed > 0`. |
| Worker crash leaves rows orphaned forever | 🔴 → 🟢 | Slice 4's orphan reaper closes this. |
| Frontend renders stale progress after SSE drops | 🟡 | Slice 5's `useJob` must implement reconnect-with-snapshot (re-read current job state from REST on reconnect). |
| Adding new job kinds during the closure phase breaks routing | 🟢 | Per-kind enable flags (`JOB_QUEUE_VISION`, etc.) allow rolling individual handlers back. |

---

## 12. Out of scope for Phase 7

The following are **explicitly deferred** to later phases:

- Per-user job quotas + rate limiting (Phase 13)
- Job result caching / dedup beyond `idempotency_key` (Phase 11)
- Cross-region worker pools (Phase 14)
- Job scheduling / cron-style recurrence (Phase 7+ if needed; Celery beat exists but no kinds yet)
- Workflow chaining (`job_a → job_b → job_c` dependency graph) — possible Phase 9 multi-agent foundation

---

## Document lineage

- 2026-05-28 — Initial audit (this document)
- Update after each slice merges to reflect new completion state

---

*This document is a living engineering artifact. Update after each closure PR merges so the next reader sees current state, not historical.*
