# KorvixAI — Sprint 1.7: Project Results UI & Run History

**Goal:** make the existing backend results **user-visible** inside the Project
UI. The pipeline (Prompt → Product Intelligence → Blueprint → Bridge →
Orchestrator → Deliverable Result) already works; this sprint exposes a
project's run history and each run's full result/deliverables — consuming only
**existing** backend contracts. No backend change, no new AI, no orchestration
change, no fabricated data, no Korvix redesign.

---

## 1. Architecture

A dedicated, **additive** page (`/projects/:projectId/runs`) that reuses the
existing orchestrator client and the Sprint 1.5/1.6 result contracts. It does
NOT touch or restyle `ProjectWorkspace`.

```
ProjectResults (page, /projects/:projectId/runs)
├── useProjectRuns(projectId)         GET /v2/orchestrator/runs?project_id=…   (history)
│      └── RunHistoryPanel            list of real runs · select · skeleton/empty/error/disabled
└── RunResultDetails(runId)
       ├── useProjectRun(runId)       GET /v2/orchestrator/runs/{id}           (snapshot + deliverables)
       ├── useRunResult(runId)        GET /v2/orchestrator/runs/{id}/result    (Sprint 1.5 PreviewPayload)
       ├── ExecutionTimeline          PI → Blueprint → Bridge → Orchestrator → Result (pure viz)
       ├── PreviewResult              Sprint 1.6 renderer-agnostic headline result
       ├── DeliverablesViewer         every deliverable, branch only on `preview` hint
       │      └── DeliverablePreviewModal   existing rich full-screen preview
       └── ExecutionMetadata          run metadata (workspace/renderer/agents/ids)
```

All status presentation flows through one helper (`lib/runStatus.ts`) so colours
/icons/wording never drift. No duplicated contracts: the result mapping reuses
the Sprint 1.6 `phaseForStatus`; the payload type is the Sprint 1.5 mirror.

---

## 2. Flow

```
open /projects/:id/runs
   → useProjectRuns lists the project's runs (newest first), light-polls
     only while a run is still active (stops when all terminal)
   → newest run auto-selected (derived during render, no effect)
select a run
   → useProjectRun polls the snapshot (1.5s, stops on terminal)
   → useRunResult fetches the PreviewPayload (polls 2.5s while non-terminal)
   → timeline + headline result + every deliverable + metadata render
backend feature gate off (503) or run not found
   → honest "disabled" / "not found" state, never a crash
```

---

## 3. Components & files

**Added**
- `src/lib/runStatus.ts` — `describeStatus()` → one descriptor (icon, colour,
  label, description, tone, terminal, **canRetry**, spin) for **every** run /
  result status (running, pending, completed, partial, failed, cancelled,
  completed_no_artifact, artifact_not_found, no_run, not_found + raw aliases
  finished/errored/queued). Unknown → neutral fallback, never throws.
- `src/lib/time.ts` — `formatRelativeTime`, `formatAbsolute`, `formatDuration`
  (dependency-free, null-tolerant). No fabricated timing.
- `src/hooks/useProjectRuns.ts` — run history over the existing `listRuns`;
  newest-first; light-polls only while a run is active; detects the
  orchestrator gate (503 → `disabled`).
- `src/hooks/useRunResult.ts` — the Sprint 1.5 PreviewPayload for one run
  (`GET …/runs/{id}/result`); polls while non-terminal; 503 → `disabled`;
  reuses the Sprint 1.6 status→phase mapping so `<PreviewResult/>` renders it.
- `src/components/results/RunHistoryPanel.tsx` — history list (status, prompt,
  template, relative time); skeleton / empty / error+retry / disabled states.
- `src/components/results/RunResultDetails.tsx` — prompt, workspace, status,
  created, duration, live indicator, cancel (running), timeline, result,
  deliverables, metadata; loading skeletons + not-found state.
- `src/components/results/DeliverablesViewer.tsx` — renders **every**
  deliverable, branching ONLY on the generic `preview` hint
  (iframe/code/markdown/file_tree → existing leaf renderers; unknown → markdown
  fallback). Per-deliverable Copy / Download / Open (full modal) / Expand /
  Collapse.
- `src/components/results/ExecutionTimeline.tsx` — pure pipeline visualization;
  stage states derived from the real run + result status (no fake timing).
- `src/pages/ProjectResults.tsx` — the two-pane page (history + details).

**Modified**
- `src/App.tsx` — one additive route `/projects/:projectId/runs`.
- `src/components/ProjectRunPanel.tsx` — a small **"History"** link to the new
  page (discoverable entry point; no behaviour change).
- `src/hooks/useOrchestrateResult.ts` — `export` the existing `phaseForStatus`
  (reused by `useRunResult`; no behaviour change).

**Deleted / backend** — none. Route count unchanged (165).

---

## 4. Data flow (existing contracts only)

| Need | Source | Endpoint |
|------|--------|----------|
| Run history list | `projectOrchestratorClient.listRuns` | `GET /v2/orchestrator/runs?project_id=…` |
| Run snapshot + all deliverables | `useProjectRun` → `getRun` | `GET /v2/orchestrator/runs/{id}` |
| Headline result (PreviewPayload) | `useRunResult` | `GET /v2/orchestrator/runs/{id}/result` |
| Cancel a running run | `projectOrchestratorClient.cancelRun` | `POST /v2/orchestrator/runs/{id}/cancel` |

Identity rides the existing Bearer principal; ownership is enforced server-side
(cross-user → 404 → "not available"). Nothing is fabricated: the prompt,
workspace, status, timestamps, deliverables, renderer and sources all come from
the snapshot / payload.

---

## 5. Status, polling & error handling

- **Every backend status** has an icon + colour + description via
  `describeStatus`; failed/cancelled expose a retry affordance.
- **Polling**: history refreshes (5s) only while a run is active and stops when
  all runs are terminal; the snapshot poll (1.5s) and result poll (2.5s) stop on
  terminal status. Recursion uses an inner `tick` + a `seq` guard +
  `AbortController` → no overlapping or duplicate requests, no infinite loops.
- **Loading UX**: skeletons for history and details; a "Live · updating"
  indicator while running; a transient "reconnecting…" hint on a soft fetch
  error that still has a snapshot.
- **Error / gate states** (never crash): orchestrator disabled (503), result
  API disabled (503), run not found / cross-user (404), empty history, a run
  with no deliverables, no previewable artifact, and unknown renderers (generic
  fallback).

---

## 6. Deployment

- **Environment variables:** **No new environment variables required.** The
  page reuses the existing `VITE_API_URL`. The history/snapshot endpoints are
  gated by the already-existing `ENABLE_PROJECT_ORCHESTRATOR`, and the result
  endpoint by the already-existing `ENABLE_DELIVERABLE_RESULT_API`; when either
  is off the UI shows an honest disabled state. These are **not new**.
- **DB migration:** none. **Railway / Vercel / Docker:** no change (frontend
  only; standard `vite build`). **Breaking changes:** none — purely additive,
  one new route + one link. **Manual step:** none.

---

## 7. Rollback

Revert this commit (or delete `src/pages/ProjectResults.tsx`, `src/components/
results/*`, `src/hooks/useProjectRuns.ts`, `src/hooks/useRunResult.ts`,
`src/lib/runStatus.ts`, `src/lib/time.ts`, and undo the App route + the
ProjectRunPanel link + the one-line `phaseForStatus` export). No data, schema,
or backend state to undo; no env var to unset.

---

## 8. Verification

- `tsc -b` typecheck **clean**; `vite build` **succeeds**; eslint — new files
  **0 problems**, full-project count unchanged at 115 (the single error in a
  touched file is pre-existing on `main`).
- Backend suite unchanged (no backend edits); route count unchanged (165).
- Traced every `ResultStatus` and every renderer (iframe/code/markdown/
  file_tree/none/unknown), history switching, polling start/stop, disabled
  backends and failed/cancelled/not-found runs.

---

## 9. Recommended Next Sprint

**Sprint 1.8 — Live Run Streaming (SSE) & Inline Run Launch.**

*Why next:* the results UI now reads run history and results by polling. The
backend already exposes a secured live stream (`GET /v2/orchestrator/runs/{id}/
stream`, SSE). The natural next step is to (a) swap the details-view snapshot
poll for that stream when available (instant deliverable updates, graceful
fallback to polling), and (b) let a user start a new run directly from the
Results page (reusing the existing `startRun`), so history → run → result is a
single loop. No new backend capability; purely wiring the existing SSE endpoint
and `startRun`.

*Out of scope for 1.8:* artifact-quality changes, new verticals, new backend
endpoints, and any redesign — strictly SSE wiring + inline launch on top of the
1.7 surface.
