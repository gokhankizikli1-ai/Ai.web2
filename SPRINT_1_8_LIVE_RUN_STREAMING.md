# KorvixAI — Sprint 1.8: Live Run Streaming & Inline Launch

## Goal

Make a run feel **alive** without pretending to produce work it hasn't. Connect
the already-built secure streaming + result infrastructure to the Results UI so
a user can start a run and watch status, stages and deliverables update in real
time, ending on the same stable `PreviewPayload` / Results UI from Sprint 1.7.

Not a Website/Game/Ecommerce/Startup builder sprint, not a renderer-quality
sprint, not a redesign. Live orchestration UX over **existing** backend
contracts only. No fake events, no fake progress, no fabricated deliverables.

---

## Architecture

The run's live state streams from the **already-existing** secure SSE endpoint;
the frontend never invents data.

```
RunResultDetails / ProjectRunPanel
        │
        ▼  useLiveRun(runId)
        │     ├─ fetch()+ReadableStream  GET /v2/orchestrator/runs/{id}/stream   (preferred)
        │     │     events: snapshot · done · error · timeout
        │     ├─ fallback: poll getRun   GET /v2/orchestrator/runs/{id}          (always works)
        │     └─ useRunResult (gated)     GET /v2/orchestrator/runs/{id}/result   (final PreviewPayload)
        ▼
   { snapshot, status, deliverables, phases, result, connection, … }
        │
        ▼  ExecutionTimeline (live stages) · DeliverablesViewer (live) · PreviewResult (final)
```

**Why fetch()+ReadableStream and not EventSource:** the run-stream route is
authenticated via the Sprint 1.2 `current_user` (Authorization header), and
`EventSource` cannot attach headers. `fetch()` streaming sends the Bearer
principal; ownership is enforced server-side (cross-user → 404). **No backend
change** — the stream endpoint already existed.

---

## Data flow (streaming vs polling)

| Situation | Path | Connection state |
|-----------|------|------------------|
| Streaming enabled, run active | fetch-stream the SSE, apply each `snapshot` | `live` |
| `done` received / terminal | mark closed, resolve final result once | `closed` |
| Streaming flag off / stream connect fails / breaks mid-flight / server max-seconds `timeout` | poll `getRun` (2 s) until terminal | `polling` |
| Already-terminal run (from history) | single `getRun` (no stream) | `closed` |
| Orchestrator disabled (503) | stop, honest disabled state | `disabled` |
| Run not found / cross-user | stop, honest not-found state | `error` |

The poll loop and stream both **stop on terminal status**, use a `seq` guard +
`AbortController` (no overlap, no duplicates), and clean up on unmount. The
final `PreviewPayload` is fetched by `useRunResult` only once there is something
to resolve (gated `enabled`), and it stops when the result status is terminal —
no duplicate final fetches.

---

## Files changed

**Added**
- `src/lib/sse.ts` — pure SSE frame parser (`createSSEParser`, `parseFrameData`); framework-free, unit-tested.
- `src/lib/runStages.ts` — pure pipeline-stage derivation (`deriveStages`, `STAGE_META`) shared by the hook and the timeline.
- `src/hooks/useStartRun.ts` — the **single** run-creation hook (shared launch; no duplicated `startRun`).
- `src/hooks/useLiveRun.ts` — live run hook: SSE stream → polling fallback → terminal stop → final result; typed state (status, phases, deliverables, result, warnings, errors, connection, lastEventAt).
- `src/components/results/RunLauncher.tsx` — inline launcher on the Results page (uses `useStartRun`).
- `src/lib/sse.test.ts`, `src/lib/runStages.test.ts`, `src/lib/runStatus.test.ts` — deterministic unit tests.
- `vitest.config.ts`, this doc.

**Modified**
- `src/hooks/useRunResult.ts` — optional `{ enabled }` gate (backward compatible) so the live hook defers result fetching.
- `src/components/results/ExecutionTimeline.tsx` — accepts pre-derived `stages` (live), delegates derivation to `lib/runStages`.
- `src/components/results/RunResultDetails.tsx` — uses `useLiveRun`; live timeline + deliverables; a **connection indicator** (Live / Polling / Connecting); honest disabled/not-found states.
- `src/components/ProjectRunPanel.tsx` — `useLiveRun` (live updates) + `useStartRun` (shared launch).
- `src/pages/ProjectResults.tsx` — inline `RunLauncher`; passes `initialStatus` for the terminal-run optimization.
- `package.json` — `test` script + `vitest` devDependency.

**Deleted** — none. **Backend** — unchanged (route count 165).

---

## UI behavior

- **Start → watch:** start a run from the right-rail `ProjectRunPanel` or the
  Results page launcher; the selected run streams live (status pulse, stage
  timeline, deliverables appearing as produced) and settles on the final
  `PreviewResult`.
- **Connection indicator:** "Live" (streaming), "Polling" (fallback —
  *Live updates unavailable, using polling*), "Connecting…", or nothing once
  settled.
- **Live timeline:** Product Intelligence → Blueprint → Bridge → Orchestrator →
  Deliverable Result, each pending / running / completed / failed / cancelled —
  derived from real status, never animated on a fake clock.
- **Live deliverables:** rendered via the existing `DeliverablesViewer`
  (markdown/code/iframe/file_tree); appear as the backend produces them. If
  deliverables only arrive at completion, that is shown honestly.

---

## Failure states (never crash)

| State | UI |
|-------|----|
| Orchestrator disabled (503) | "Orchestrator disabled — set `ENABLE_PROJECT_ORCHESTRATOR`" |
| Result API disabled (503) | `PreviewResult` shows the disabled result notice; deliverables still render from the snapshot |
| Run not found / cross-user (404) | "Run not available" |
| Stream connect/break | silent fall back to polling ("Polling" badge) |
| Server stream timeout | continue via polling |
| Failed run | failed status + errors, retry affordance |
| Cancelled run | cancelled status (amber) |
| Network blip while polling | bounded retry on cadence, stops at terminal |

---

## Feature flag behavior

`VITE_ENABLE_RUN_STREAMING` (frontend / Vercel build-time):
- **Default (unset / `true`):** the live hook prefers the SSE stream and falls
  back to polling automatically.
- **`false` / `0`:** the hook skips streaming and uses polling only (still fully
  live, just via `getRun` polling) — useful where a proxy buffers SSE.

There is **no backend streaming flag** — the run stream is part of the
orchestrator and is governed by the already-existing
`ENABLE_PROJECT_ORCHESTRATOR`. When that is off, the stream and poll both report
`disabled` and the UI shows the honest disabled state.

---

## Security

- The run stream and result requests use the existing Sprint 1.2 Bearer
  principal (`Authorization` header via `fetch`); the frontend never sends a
  `user_id`.
- Ownership is enforced server-side; a cross-user run id returns 404 → the UI
  shows "Run not available". No backend route was modified, so no server
  security surface changed.

---

## Tests

Deterministic, no network / no LLM / no DOM (`npm test`, Vitest, node env):
- **`sse.test.ts`** — single/multiple/partial(chunked)/CRLF frames, named
  events, multi-line data, keepalive-comment skipping, safe JSON parsing.
- **`runStages.test.ts`** — stage derivation for running / pending / completed /
  failed / cancelled / partial / no-result; always five stages.
- **`runStatus.test.ts`** — every result status descriptor, raw-alias
  normalisation, retry-only-on-failed/cancelled, terminal flags, unknown
  fallback; `isResultTerminal` / `isRunTerminal` (the stop-polling/streaming
  predicates).

These cover the trickiest behaviours that back the live experience (SSE
parsing, terminal-stop, fallback decisions, status mapping) at the pure-logic
level. Hook composition (connect/cleanup, no-duplicate-launch) is additionally
guaranteed by `tsc` + the `seq`/`AbortController` guards and was traced
manually; the repo has no DOM test harness and this sprint intentionally did not
add one.

### Test execution status (environment limitation)

> **The Vitest test runner could NOT be installed in this build sandbox** — the
> agent proxy blocks the npm package downloads required to add it (npmmirror-
> pinned transitive deps return 403, and a clean reinstall could not complete).
> The three test suites above are authored and committed and run with
> `npm test` (`vitest run`) in any normal environment, but **their execution was
> skipped here**. `vitest` is declared in `package.json` devDependencies + a
> `test` script so the suites run on the next install in a working environment.

---

## Deployment Checklist

1. **New Environment Variables**
   - `VITE_ENABLE_RUN_STREAMING`
     - **Default:** unset → treated as `true` (streaming on, polling fallback).
     - **Required or Optional:** Optional.
     - **Description:** frontend build-time toggle. `false`/`0` forces the
       polling path. **Railway:** not required (frontend var). **Vercel:**
       optional — only set it (`false`) if you want to disable SSE. **When
       false:** the UI uses `getRun` polling (still live). **When true/unset:**
       the UI streams via SSE and auto-falls-back to polling on failure.
2. **Updated Environment Variables** — none.
3. **Deprecated Environment Variables** — none.
4. **Database Migrations** — none required; no migration files; no manual steps.
5. **New Python Dependencies** — none (backend untouched).
6. **New Frontend Dependencies** — `vitest` (devDependency, test-only; not in the production bundle).
7. **Configuration Changes** — added `vitest.config.ts` and a `test` script; no app/runtime config changed.
8. **Docker Changes** — none.
9. **Railway Changes** — none (backend unchanged; route count 165).
10. **Vercel Changes** — none required (optional `VITE_ENABLE_RUN_STREAMING`).
11. **Redis Changes** — none.
12. **Celery Changes** — none.
13. **Storage Changes** — none.
14. **Authentication Changes** — none (reuses the Sprint 1.2 Bearer principal).
15. **CORS Changes** — none. (Note: SSE via `fetch` is a normal same-config
    request; no new CORS needs beyond what existing `/v2` calls already use.)
16. **Breaking Changes** — none. Purely additive; `useRunResult`'s new option is
    backward compatible; `ProjectRunPanel` behaviour preserved.
17. **Manual Deployment Steps** — none. To see live runs end-to-end the
    already-existing `ENABLE_PROJECT_ORCHESTRATOR` (and the execution
    prerequisites) must be on; otherwise the UI shows the disabled state.
18. **Rollback Strategy** — revert this commit (delete the added files; restore
    `useRunResult` / `ExecutionTimeline` / `RunResultDetails` / `ProjectRunPanel`
    / `ProjectResults`). No data/schema/backend state to undo; no env var must be
    unset.

**Feature-flag summary:** `VITE_ENABLE_RUN_STREAMING` — default `true`,
Railway: no, Vercel: optional. `false` → polling only; `true`/unset → SSE with
polling fallback. To exercise live runs in a real deployment, the existing
`ENABLE_PROJECT_ORCHESTRATOR` must be enabled on the backend.

---

## Sprint Summary

- **Files Added:** 9 (`lib/sse.ts`, `lib/runStages.ts`, `hooks/useStartRun.ts`, `hooks/useLiveRun.ts`, `components/results/RunLauncher.tsx`, 3 test files, `vitest.config.ts`) + this doc.
- **Files Modified:** 6 (`useRunResult.ts`, `ExecutionTimeline.tsx`, `RunResultDetails.tsx`, `ProjectRunPanel.tsx`, `ProjectResults.tsx`, `package.json`).
- **Files Deleted:** 0.
- **Total Lines Added:** ~900. **Total Lines Removed:** ~70 (the duplicated `startRun` + old poll wiring).
- **Tests Added:** 3 suites (~35 assertions). **Tests Updated:** 0.
- **Documentation Added:** this file.
- **Technical Debt Reduced:** removed duplicated run-creation logic (single `useStartRun`); extracted stage derivation to a shared pure module; first frontend test harness + tests.
- **Architectural Improvements:** one live-run hook with a clean SSE→polling fallback; pure, testable SSE/stage modules; single-source contracts (no duplicated PreviewPayload/ResultStatus/poll/event logic).
- **Performance Impact:** SSE replaces interval polling while a run is active (fewer requests, sub-second updates); terminal/history runs do a single fetch; result polling is gated. Negligible cost; default-off backend means zero production impact until enabled.
- **Security Impact:** none new — Bearer principal over `fetch` streaming; ownership enforced server-side; no backend route touched.
- **User-Visible Impact:** runs now update live — status, pipeline stages and deliverables appear as produced, with an honest Live/Polling indicator — and can be launched inline, ending on the stable Results UI.
- **Future Compatibility:** the live hook + pure modules work for any run/renderer; richer per-stage telemetry (the existing `/v2/events` kinds) can layer on without changing the contract.

---

## Recommended Next Sprint

**Sprint 1.9 — Run History Surfacing & Result Layout Refinement.**

*Why next:* runs are now live and launchable, but (per the roadmap guardrails)
Run History is still tucked away and the result layout needs refinement. With
the live spine complete, the highest-value next step is making the run
experience **discoverable and legible**: surface Run History prominently in the
main flow (e.g. a persistent entry from `ProjectWorkspace`), and refine the
Results layout (clearer result-vs-deliverables hierarchy, empty/partial states)
— all on top of the existing live hook and renderer-agnostic `PreviewResult`.

*New foundation this sprint created:* a single live-run hook + inline launch, so
any surface can show a live run with two imports.

*Measurable user-visible capability unlocked:* a user can find prior runs and
read a run's result without hunting — the run lifecycle becomes a first-class,
legible part of the Project UI.

*Out of scope for 1.9:* interactive website/app preview, generated-output
quality, new verticals, and any orchestrator/renderer rewrite — strictly
discoverability + layout refinement over the live spine.
