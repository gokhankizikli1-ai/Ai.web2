# KorvixAI — Sprint 1.5: Deliverable Rendering & Preview Return

**Scope:** add a typed, renderer-agnostic **result layer** that reads the
orchestrator's COMPLETED deliverables and returns a stable preview/result
payload. Not a UI/renderer/vertical-implementation sprint. Nothing is
rewritten; no second store is created; no output is ever fabricated.

**Result:** any finished (or partially finished) orchestrator run can be
resolved into a single `PreviewPayload` contract — `status`, `renderer`,
`artifact_type`, `content`, `html_preview`, `structured_data`,
`source_deliverables`, lifecycle metadata — that every future module
(Website Builder, Startup, Ecommerce, Game, Research, Trading) consumes
without knowing the internal deliverable schema. Module boundaries preserved;
no renderer/builder dependency introduced.

---

## Architecture Summary

A new read-only package `backend/services/deliverable_result/` resolves run
output. It **reuses** the orchestrator's existing `get_run_snapshot` (which
already enforces ownership and reconciles run status) and `list_runs` — it
does **not** create a second deliverable store, never executes anything, and
never mocks output.

```
ProductBlueprint (1.3) → blueprint_bridge (1.4) → orchestrator run
        → orchestrator deliverables (status + content + artifact)
        → deliverable_result (THIS, 1.5)  ── read-only resolver
        → PreviewPayload  ── consumed by future modules
```

- **`types.py`** — `ResultStatus` enum (the explicit lifecycle states),
  `NON_TERMINAL` set, `SourceDeliverable`, and the `PreviewPayload` dataclass
  (`to_dict()`); `renderer`/`artifact_type` are plain strings so future kinds
  need no contract change.
- **`resolver.py`** — `resolve_run_result()` and `resolve_project_result()`.
  Selects the best **product artifact** by preview tier
  (`iframe` > `file_tree` > `code` > `markdown`), newest within the tier.
- **`routes/v2_results.py`** — `GET /v2/orchestrator/runs/{run_id}/result`,
  `GET /v2/orchestrator/projects/{project_id}/result`, `/results/health`.

## Audit findings (verified before coding)

- **Deliverables store** (`services/orchestrator/deliverables_store.py`):
  statuses pending/in_progress/completed/failed/skipped; `list_for_run`,
  `list_for_project`; deliverable `content = {text, agent_id, node_id,
  artifact}`; artifact `= {type, title, language, content, files, preview,
  download}` (`preview ∈ iframe|code|markdown|file_tree`). **Reused as-is —
  not modified, not duplicated.**
- **`get_run_snapshot(run_id, *, user_id=None)`** already enforces ownership
  (cross-user/unknown → `None`), reconciles status, and embeds deliverables.
  The resolver builds directly on it — ownership is **not** re-implemented.
- **`list_runs(user_id, project_id, limit)`** is newest-first; the project
  resolver picks `rows[0]` (latest) — only the caller's own runs are listed.

## Files Changed

**Added**
- `backend/services/deliverable_result/{__init__,types,resolver}.py`
- `backend/routes/v2_results.py`
- `backend/tests/test_sprint15_deliverable_result.py`
- `DELIVERABLE_RESULT_API.md`, `SPRINT_1_5_DELIVERABLE_RESULT.md`

**Modified**
- `backend/core/config.py` — added `ENABLE_DELIVERABLE_RESULT_API`.
- `backend/api.py` — mounted the gated results router.
- `backend/routes/v2_intelligence_orchestrate.py` — the **execute** branch now
  returns a `result_route` string (where to fetch output later); no
  synchronous wait, no import of the resolver.

**Deleted** — none. The orchestrator, deliverables store, and Product
Intelligence were NOT modified.

## Tests Added

`test_sprint15_deliverable_result.py` — **18 tests**, deterministic (no LLM,
no network); seeds the real runs + deliverables stores and resolves through
the result layer:

- **Lifecycle:** unknown→`not_found`, running-no-deliverables→`running`,
  completed run returns the final (html iframe beats intermediate markdown),
  latest project result, no-run→`no_run`, failed→`failed` (errors surfaced,
  no fabricated content), partial requires `include_partial`,
  `artifact_type`/`renderer` hit→`completed` / miss→`artifact_not_found`,
  cross-user→`not_found`, future/unknown artifact type+renderer pass through
  (no crash), stable JSON schema (exact key set, serializable).
- **Module boundaries:** result layer imports no renderer/website_builder;
  Product Intelligence does not import `deliverable_result`.
- **HTTP route:** disabled→503 (health still 200), returns result + blocks
  cross-user (`not_found`, no leak), project route cross-user→404.
- **Bridge:** execute returns `result_route == /v2/orchestrator/runs/<id>/result`
  (no synchronous wait).

## Documentation

`DELIVERABLE_RESULT_API.md` — placement in the AI OS, the resolver,
the lifecycle-state table, the `PreviewPayload` contract, the API, the bridge
integration, SSE/events future-awareness (no new SSE built), what it does NOT
do, and how each future module consumes the same payload.

---

## Deployment Checklist

1. **New Environment Variables**
   - `ENABLE_DELIVERABLE_RESULT_API` — default `false` — **Optional** — gates
     `GET /v2/orchestrator/runs/{run_id}/result` and
     `/projects/{project_id}/result`. **Set in Railway only if you want the
     read API exposed.** When `false`: routes return 503. When `true`: the
     read-only result API is served (it surfaces only what runs already
     produced; it never executes anything).
2. **Database Migrations** — none. No new tables, no schema changes; the
   resolver reads the existing runs + deliverables stores.
3. **New Dependencies** — none. Standard library + existing FastAPI only.
4. **Config / Settings Changes** — one additive flag in `core/config.py`
   (`ENABLE_DELIVERABLE_RESULT_API`); no existing setting changed.
5. **New Routes Exposed** — 3, all under `ENABLE_DELIVERABLE_RESULT_API`:
   `GET /v2/orchestrator/runs/{run_id}/result`,
   `GET /v2/orchestrator/projects/{project_id}/result`,
   `GET /v2/orchestrator/results/health` (health is always 200 and reports the
   flag). Route count: **162 → 165**.
6. **Feature Flags** — `ENABLE_DELIVERABLE_RESULT_API` (default `false`).
   Independent of every other flag; turning it on does not run jobs/LLM.
7. **Background Jobs / Workers** — none added. The resolver is a synchronous,
   in-process read; it does **not** wait for async runs.
8. **External Services** — none. No network calls.
9. **Identity / Ownership** — uses the Sprint 1.2 principal
   (`resolve_principal`); never a query/body `user_id`. Run ownership enforced
   by `get_run_snapshot` (cross-user/unknown → `not_found`, existence-hidden);
   owned-project cross-user access → HTTP 404 (when `ENABLE_PROJECTS`).
10. **Data Exposure Review** — payload contains only the caller's own run
    deliverables; no cross-user data path. `not_found` is returned without
    revealing existence.
11. **Error Handling** — every normal lifecycle state is an explicit
    `ResultStatus` (never a generic 500): `not_found`, `no_run`, `pending`,
    `running`, `partial`, `completed`, `completed_no_artifact`,
    `artifact_not_found`, `failed`, `cancelled`. Resolver read failures are
    caught and degrade to `not_found` with an error note.
12. **Performance Impact** — negligible: one snapshot read (and, for projects,
    one `list_runs`) per call; pure in-memory selection. No writes.
13. **Logging / Observability** — warning-level logs only on a failed snapshot
    or `list_runs`; no PII logged.
14. **Authentication Changes** — none (reuses the Sprint 1.2 principal).
15. **CORS Changes** — none.
16. **Breaking Changes** — none. Purely additive (routes 162 → 165; new routes
    gated off by default). The bridge change only **adds** a `result_route`
    key to the execute response.
17. **Manual Deployment Steps** — none. Enable via the flag above if desired.
18. **Rollback Strategy** — unset `ENABLE_DELIVERABLE_RESULT_API` (or set
    `false`); the result routes return 503. The bridge's `result_route` key is
    harmless (a string reference) and needs no rollback. No data to migrate.

---

## Sprint Summary

- **Files Added:** 6 (3 result modules, 1 route, 1 test, 2 docs — counting
  `DELIVERABLE_RESULT_API.md` and this file).
- **Files Modified:** 3 (`config.py`, `api.py`,
  `v2_intelligence_orchestrate.py`).
- **Files Deleted:** 0.
- **Total Lines Added:** ~700. **Removed:** ~0 (additive; small inserts).
- **Tests Added:** 18. **Tests Updated:** 0.
- **Documentation Added:** `DELIVERABLE_RESULT_API.md` + this doc.
- **Technical Debt Reduced:** establishes the single, typed result contract so
  future verticals read run output through one payload instead of reaching
  into the deliverable schema; keeps rendering concerns out of the
  orchestrator.
- **Architectural Improvements:** one-way dependencies (result layer →
  orchestrator only; Product Intelligence and Website Builder do not import it,
  enforced by tests); explicit lifecycle states (no generic 500s); no second
  store; renderer-agnostic contract (unknown future types pass through).
- **Performance Impact:** negligible — one ownership-checked snapshot read per
  call; routes gated off by default → zero production impact.
- **Security Impact:** identity from the Sprint 1.2 principal (never body);
  cross-user run reads return `not_found`; owned-project cross-user → 404;
  never fabricates output.
- **Future Compatibility:** every vertical consumes the same `PreviewPayload`;
  adding a new artifact type/renderer needs no contract change. The contract
  is already compatible with a future SSE refresh model (run_id/workflow_id/
  updated_at present) without building new SSE this sprint.

---

## Recommended Next Sprint

**Sprint 1.6 — First Frontend Connection: "Plan → Run → Show Result".**

*Why next:* the full backend spine now exists end-to-end —
prompt → `ProductPlan`/`ProductBlueprint` (1.3) → orchestrator run via the
bridge (1.4) → a typed, identity-scoped `PreviewPayload` (1.5). The single
highest-impact next step is the **first thin frontend slice** that exercises
this spine: a minimal screen that takes a prompt, calls
`POST /v2/intelligence/orchestrate` (execute), follows the returned
`result_route` by polling `GET …/result`, and renders the `PreviewPayload`
using the `renderer` hint (`iframe` → iframe, `markdown` → markdown,
`code`/`file_tree` → code view). No new backend capability — purely wiring the
existing typed contracts to a real, visible user flow.

*New foundation this sprint created:* run output is now a stable, typed,
ownership-scoped payload with a fetch route the bridge already hands back —
the missing piece is a UI that consumes it.

*Measurable user-visible capability unlocked:* "type a prompt → watch the run
→ see the produced artifact" working in the browser against the real backend,
using only existing renderers.

*Out of scope for 1.6:* improving generated HTML/renderer quality, new
verticals, new backend endpoints, and any large frontend redesign — strictly
the minimal plan→run→result wiring with poll-based status (SSE wiring is a
later step).
