# KorvixAI — Sprint 1.4: Blueprint → Orchestrator Bridge

**Scope:** connect the Sprint 1.3 planning layer to the existing Project
Orchestrator. Not a UI/Builder/vertical-implementation sprint. The bridge is
thin and typed; nothing is rewritten.

**Result:** a `ProductBlueprint` becomes an orchestrator-ready
`OrchestrationRequest`; **dry-run** previews the run (no jobs/LLM);
**execution** is feature-flag gated and creates a real orchestrator run under
the authenticated identity. Module boundaries preserved; no renderer/builder
dependency introduced.

---

## Architecture Summary

A new, thin connector package `backend/services/blueprint_bridge/` imports
**both** `product_intelligence` and `orchestrator`; **neither imports the
other or the bridge** (verified by tests). Verticals are NOT hardcoded into
the orchestrator — the only workspace→template mapping lives in the bridge as
data.

- **`types.py`** — `OrchestrationRequest`, `DryRunResult`, `ProposedStep`,
  `ExecutionResult` (all `to_dict()`).
- **`adapter.py`** — `blueprint_to_request()` preserving prompt, workspace,
  category, audience, complexity, features, agents, deliverables, renderer,
  risks, metrics; maps workspace → an **existing** orchestrator template
  (falls back to `None` so the orchestrator chooses).
- **`bridge.py`** — `plan_to_orchestration()`, `dry_run()` (pure),
  `execute()` (gated), `execution_prerequisites()`.
- **`routes/v2_intelligence_orchestrate.py`** — `POST /v2/intelligence/orchestrate`
  + `/orchestrate/health`.

## Audit findings (verified before coding)

- **ProductBlueprint** (Sprint 1.3): workspace, product category/type,
  audience, complexity, core features, screens, IA, data model, UX/visual
  direction, recommended agents, recommended renderer, deliverables, risks,
  success metrics. No missing fields — Product Intelligence was NOT modified.
- **Orchestrator input contract:** `start_project_run(*, user_id,
  user_request, project_id=None, template_id=None, metadata=None)`; templates
  via `catalog.choose_template` (regex-only when `plan=None`) or explicit id;
  gated by `ENABLE_PROJECT_ORCHESTRATOR` (+ workflow/job flags for real agent
  runs). Route uses `current_user` + project ownership. The bridge maps onto
  this 1:1 — no orchestrator changes.

## Files Changed

**Added**
- `backend/services/blueprint_bridge/{__init__,types,adapter,bridge}.py`
- `backend/routes/v2_intelligence_orchestrate.py`
- `backend/tests/test_sprint14_blueprint_bridge.py`
- `BLUEPRINT_ORCHESTRATOR_BRIDGE.md`, `SPRINT_1_4_BLUEPRINT_BRIDGE.md`

**Modified**
- `backend/core/config.py` — added `ENABLE_BLUEPRINT_ORCHESTRATOR_BRIDGE`.
- `backend/api.py` — mounted the gated bridge router.

**Deleted** — none. Product Intelligence and the orchestrator were NOT
modified.

## Tests Added

`test_sprint14_blueprint_bridge.py` — **12 tests**: field preservation
(agents/deliverables/renderer/complexity/workspace/category/audience/features/
risks/metrics), per-workspace renderer, unknown-workspace safe request,
dry-run creates no runs, dry-run reports missing prerequisites, **module
separation** (PI has no orchestrator/builder import; orchestrator has no
PI/bridge/vertical import), route 503 when disabled, stable dry-run JSON,
execute-with-flags-off is not mocked, **gated execution creates a real run
under the authenticated identity** (agent runtime faked — no LLM), and
**cross-user project access blocked (404)**.

## Documentation

`BLUEPRINT_ORCHESTRATOR_BRIDGE.md` — where it sits in the AI OS, dry-run vs
execution, feature flags, the API, and how each vertical consumes it later.

---

## Deployment Checklist

1. **New Environment Variables**
   - `ENABLE_BLUEPRINT_ORCHESTRATOR_BRIDGE` — default `false` — **Optional** —
     gates `POST /v2/intelligence/orchestrate`. **Must be set in Railway only
     if you want the endpoint exposed.** When `false`: route returns 503,
     nothing runs. When `true`: dry-run works (no jobs/LLM); execution
     additionally requires `ENABLE_PRODUCT_INTELLIGENCE` +
     `ENABLE_PROJECT_ORCHESTRATOR` (+ `ENABLE_WORKFLOWS` /
     `ENABLE_WORKFLOW_RUNNER` / `ENABLE_JOB_QUEUE`), and reports any that are
     missing instead of mocking.
2. **Updated Environment Variables** — none.
3. **Deprecated Environment Variables** — none.
4. **Database Migrations** — none. Required? No. Migration files? None.
   Manual steps? None. (The bridge creates no tables; execution reuses the
   orchestrator's existing stores.)
5. **New Python Dependencies** — none (pure stdlib).
6. **New Frontend Dependencies** — none.
7. **Configuration Changes** — none required. Optionally set the flag(s) above.
8. **Docker Changes** — none.
9. **Railway Changes** — none required. To enable: set
   `ENABLE_BLUEPRINT_ORCHESTRATOR_BRIDGE=true` (+ execution flags for real
   runs) and redeploy.
10. **Vercel Changes** — none.
11. **Redis Changes** — none (only relevant if you later run the Celery
    job backend; inline runner needs no Redis).
12. **Celery Changes** — none.
13. **Storage Changes** — none.
14. **Authentication Changes** — none (route uses the existing Sprint 1.2
    principal; identity from auth context).
15. **CORS Changes** — none.
16. **Breaking Changes** — none. Purely additive (routes 160 → 162; new
    routes gated off by default).
17. **Manual Deployment Steps** — none. Enable via the flag(s) above.
18. **Rollback Strategy** — unset `ENABLE_BLUEPRINT_ORCHESTRATOR_BRIDGE` (or
    set `false`); the route returns 503 and the bridge is dormant. No data to
    migrate back.

---

## Sprint Summary

- **Files Added:** 7 (4 bridge modules, 1 route, 1 test, 2 docs).
- **Files Modified:** 2 (`config.py`, `api.py`).
- **Files Deleted:** 0.
- **Total Lines Added:** ~750. **Removed:** ~0 (additive; 2 small inserts).
- **Tests Added:** 12. **Tests Updated:** 0.
- **Documentation Added:** `BLUEPRINT_ORCHESTRATOR_BRIDGE.md` + this doc.
- **Technical Debt Reduced:** establishes the single, typed connector so
  future verticals stop wiring planning→execution ad-hoc; keeps verticals out
  of the orchestrator.
- **Architectural Improvements:** clean one-way dependencies (bridge → both;
  neither side → bridge), enforced by tests; safe-by-default dry-run; honest
  gated execution (no silent mocks); blueprint metadata travels with the run.
- **Performance Impact:** negligible — dry-run is pure in-process planning
  (no LLM/jobs/DB writes); routes gated off by default → zero production
  impact.
- **Security Impact:** identity from the Sprint 1.2 principal (never body);
  cross-user project access blocked (404); execution behind explicit flags.
- **Future Compatibility:** every vertical consumes the same
  `OrchestrationRequest`; adding a vertical is a template + one adapter-map
  line, no bridge/orchestrator rewrite.

---

## Recommended Next Sprint

**Sprint 1.5 — Deliverable Rendering & Preview Return.**

*Why next:* the bridge now creates a real orchestrator run whose agents
produce typed deliverables, but the run result is not yet surfaced back to
the caller as a previewable artifact. The single highest-impact next step is
a thin, typed **result path** that reads the orchestrator's finished
deliverables and returns them via the `recommended_renderer` already in the
blueprint (e.g. HTML deliverable → existing iframe preview), plus an SSE
status stream reusing the secured `/v2/events` from Sprint 1.2.

*New foundation this sprint created:* a plan can now become a tracked,
identity-scoped run with blueprint metadata attached — the missing piece is
returning what the run produced.

*Measurable user-visible capability unlocked:* "type a prompt → watch a
multi-agent run → see the produced artifact" end-to-end, using only existing
renderers (no renderer changes).

*Out of scope for 1.5:* improving the generated HTML/renderers themselves,
new verticals, and any frontend redesign — strictly the typed result/preview
return path.
