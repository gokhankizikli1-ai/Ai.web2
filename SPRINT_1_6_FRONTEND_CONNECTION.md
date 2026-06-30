# KorvixAI — Sprint 1.6: First End-to-End Connection (Plan → Run → Result)

**Scope:** connect the already-built backend spine to the existing frontend
with the **thinnest possible** integration. NOT a frontend redesign, NOT a
vertical implementation (no Website Builder / Startup / Ecommerce / Game /
Research / Trading logic), NOT a backend change. One purpose only: let the
browser finally experience **prompt → plan → run → result** using the
contracts shipped in Sprints 1.3–1.5.

**Result:** the existing `App Builder` page (`/tools/app-builder`), previously
a pure placeholder (fake `setTimeout` + fabricated tech-stack/MVP data), now
sends the prompt through the real pipeline and renders the backend's
`PreviewPayload` — with no mocked data, no duplicated contracts, and no
vertical-specific code. The glue is renderer-agnostic, so the same wiring
serves every future module unchanged.

---

## 1. Architecture

The frontend walks the spine the previous sprints built. It owns **no**
orchestration logic — it POSTs a prompt, polls a route, and renders a typed
payload.

```
  AppBuilder page (host only — imposes no vertical)
        │  prompt
        ▼
  useOrchestrateResult (hook — the only glue)
        │  POST /v2/intelligence/orchestrate   (Sprint 1.4 bridge, execute)
        ▼  → run_id + result_route             (PI → Blueprint → Bridge → run)
        │
        ▼  GET <result_route>                  (Sprint 1.5 Deliverable Result)
        │  poll until PreviewPayload.status is terminal
        ▼
  PreviewResult (renderer-agnostic — branches only on `renderer`)
        │  iframe | code | markdown | file_tree | none | <future>
        ▼  reuses MarkdownMessage · CodeBlock · sandboxed <iframe>
  rendered output
```

**Module boundaries preserved.** React decides nothing about *what* to build:
Product Intelligence classifies the prompt server-side. The frontend never
imports or names a vertical; it renders `PreviewPayload` exactly as returned.
The backend was not touched (route count unchanged: **165**).

---

## 2. Files changed

**Added (frontend glue only):**
- `src/types/preview.ts` — a field-for-field **mirror** of the backend
  `PreviewPayload` / `ResultStatus` (Sprint 1.5) plus the orchestrate-response
  shape. Not a new model — the FE reuses the backend contract and never
  invents result fields.
- `src/hooks/useOrchestrateResult.ts` — the thin client: POST the prompt to
  the bridge (execute mode), then poll the returned `result_route` until
  terminal. Exposes a display **phase** + the typed payload. No orchestration
  logic; correct polling stop conditions; feature-gate handling.
- `src/components/PreviewResult.tsx` — renderer-**agnostic** result view. It
  branches only on the generic `renderer` string and reuses existing leaf
  renderers (`MarkdownMessage`, `CodeBlock`, the sandboxed-iframe pattern from
  `DeliverablePreviewModal`). Also renders loading / disabled / error states.

**Modified:**
- `src/pages/AppBuilder.tsx` — replaced the placeholder execution (`setTimeout`
  + static `TECH_STACKS` / `MVP_CHECKLIST` / `sections` mock data) with the
  real hook + `PreviewResult`. The page shell (nav, title, input, Plan button,
  empty state) is preserved; only the fabricated logic/data were removed (the
  sprint forbids mocked output).

**Deleted:** none. **Backend:** unchanged (no routes, no models, no config).

---

## 3. Flow diagram (user-visible states)

```
 [idle] ──run()──▶ [planning] ──POST /orchestrate──┐
                                                    │ executed + result_route
                                                    ▼
                                  ┌────────────▶ [running] ◀─poll (pending|running)
                                  │                  │
                                  │     status=partial│
                                  │                  ▼
                                  └─────────────[rendering] ◀─poll (partial)
                                                     │ terminal
            ┌───────────────┬──────────────┬─────────┴────────┐
            ▼               ▼              ▼                  ▼
        [completed]      [failed]      [cancelled]        [not_found]

 Feature gate off (503 / executed=false) ─────────────▶ [disabled]
 Transport/parse failure ─────────────────────────────▶ [error]
```

Required loading states covered: **Waiting for planning** (idle), **Planning**,
**Running**, **Rendering**, **Completed**, **Failed**, **Cancelled** — plus
**Unavailable** (feature gates) and **Error**, so the page never crashes.

---

## 4. API usage

| Step | Call | Notes |
|------|------|-------|
| Plan + start run | `POST /v2/intelligence/orchestrate` | Body `{ prompt, project_id?, dry_run:false, execute:true }`. Identity from the Sprint 1.2 principal (Bearer token). Returns `execution.run_id` + `result_route`. |
| Fetch result | `GET <result_route>` | e.g. `/v2/orchestrator/runs/{run_id}/result`. Returns `{ result: PreviewPayload, feature_flags }`. |

The frontend sends **only a prompt** — never a workspace/vertical. It reads
only the fields it needs (`execution`, `result_route`, `result`); the rest of
the orchestrate response (plan/blueprint/orchestration_request) is ignored
here.

---

## 5. Frontend integration

- **Base URL / auth:** same convention as `useProjectOrchestrator` —
  `VITE_API_URL` (falls back to the bundled backend), Bearer token from
  `localStorage.korvix_access_token`. No new env contract introduced.
- **Reused components:** `MarkdownMessage` (markdown), `CodeBlock` (syntax
  highlighting), sandboxed `<iframe sandbox="allow-scripts">` (html, same
  policy as `DeliverablePreviewModal`), per-file list (file_tree). No new
  rendering system.
- **No duplicated models:** `src/types/preview.ts` mirrors the backend
  contract; the page does not redefine `PreviewPayload`.

---

## 6. Polling behaviour

- Interval **2000 ms** (gentle; no aggressive polling).
- `setTimeout`-recursion (not `setInterval`) + a per-call `AbortController` →
  **no overlapping / duplicate requests**.
- A monotonic `runSeq` ref invalidates any in-flight loop when a new `run()`
  starts or the component unmounts.
- **Stops immediately** when the payload status is terminal:
  `completed` · `completed_no_artifact` · `artifact_not_found` · `failed` ·
  `cancelled` · `not_found`. Continues only on `pending` · `running` ·
  `partial`.
- Transient network errors retry on the same cadence, bounded by a hard
  `MAX_POLLS` ceiling (~20 min) so the loop can never run forever.

---

## 7. Result rendering

`PreviewResult` branches **only** on the generic `renderer` hint:

| `renderer` | Rendered with |
|------------|---------------|
| `iframe` | sandboxed `<iframe srcDoc={html_preview ?? content}>` |
| `code` | `CodeBlock` (language from `structured_data.language` / `artifact_type`) |
| `markdown` | `MarkdownMessage` |
| `file_tree` | per-file list (`structured_data.files`) via `CodeBlock` |
| `none` / unknown / future | `MarkdownMessage(content)` fallback, else `summary` |

An **unknown future renderer** (e.g. a not-yet-built vertical) degrades to the
markdown/text fallback — so new artifact types render without any change here.
`completed_no_artifact` / `artifact_not_found` show an honest "no preview"
message from the payload's own warnings — never fabricated content.

---

## 8. Deployment Checklist

1. **New environment variables** — **No new environment variables required.**
   The hook reuses the existing `VITE_API_URL` (already used across the app;
   falls back to the bundled backend host). No new Railway / Vercel / local
   variable, and no migration of any variable.
   - For the flow to actually execute end-to-end, the **already-existing**
     backend flags must be on (server-side, unchanged by this sprint):
     `ENABLE_BLUEPRINT_ORCHESTRATOR_BRIDGE`, `ENABLE_DELIVERABLE_RESULT_API`,
     and the orchestrator prerequisites (`ENABLE_PRODUCT_INTELLIGENCE`,
     `ENABLE_PROJECT_ORCHESTRATOR`, + workflow/job flags). When any are off the
     UI shows an "Unavailable" state — it never crashes. These are **not new**
     and are **not required** to deploy this frontend.
2. **DB migration?** — None. No backend or schema change.
3. **Railway changes?** — None. Backend untouched (route count unchanged: 165).
4. **Vercel changes?** — None. No new build step, no new env var; standard
   `vite build`.
5. **Docker changes?** — None.
6. **Breaking changes?** — None. Purely additive on the frontend; one
   placeholder page now does real work. No API/contract change.
7. **Manual deployment step?** — None. Deploy the frontend as usual. (To
   demo the live flow, flip the existing backend flags above on the server.)

---

## 9. Rollback steps

- **Revert the frontend commit** (or restore `src/pages/AppBuilder.tsx` and
  delete the three added files). The page returns to its prior placeholder
  behaviour. No data, schema, or backend state to undo.
- No environment variable to unset; no migration to reverse.

---

## 10. Sprint Summary

- **Files Added:** 3 (`types/preview.ts`, `hooks/useOrchestrateResult.ts`,
  `components/PreviewResult.tsx`).
- **Files Modified:** 1 (`pages/AppBuilder.tsx`).
- **Files Deleted:** 0. **Backend files touched:** 0.
- **Tests:** backend suite unchanged — **1808 passed**, same 14 pre-existing
  environmental failures as `main` (zero new). Route count unchanged (165).
  Frontend `build` + `tsc` typecheck + `eslint` clean.
- **Technical Debt Reduced:** removed a fabricated-data placeholder page and
  replaced it with the real pipeline; established the single reusable
  `prompt → result` frontend path.
- **Architectural Improvements:** renderer-agnostic result rendering (branches
  only on the generic hint), strict one-way dependency (page → hook →
  contract), no orchestration logic in React, no duplicated models.
- **Security Impact:** none new — identity rides the existing Sprint 1.2
  Bearer principal; the FE never trusts/echoes a vertical.
- **Future Compatibility:** the hook + `PreviewResult` render any
  `PreviewPayload` (any renderer / artifact type) with no change — Website
  Builder, Startup, Research, Game, Trading and Ecommerce can adopt the same
  two imports later without modifying them.

---

## 11. Recommended Next Sprint

**Sprint 1.7 — Run History & Result Persistence in the UI.**

*Why next:* the user can now run one prompt and watch its result, but a
refresh loses it and there is no list of prior runs. The natural, still-thin
next step is to surface the **already-existing** `GET /v2/orchestrator/runs?
project_id=…` history and the project result route
(`/v2/orchestrator/projects/{id}/result`) so a user can revisit past runs and
their previews — reusing `useProjectOrchestrator.listRuns` and the same
`PreviewResult` component. No new backend capability; purely wiring run
history + deep-linking a `run_id` to its `PreviewResult`.

*Out of scope for 1.7:* improving generated artifact quality, new verticals,
new backend endpoints, SSE push (polling stays), and any redesign — strictly
history listing + result deep-linking on top of the 1.6 path.
