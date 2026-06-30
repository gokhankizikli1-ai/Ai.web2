# KorvixAI — Sprint 1.3: Universal Product Intelligence

**Scope:** the intelligence layer that decides WHAT should be built, before
any renderer runs. Planning architecture only — no renderer/UI/builder
changes, no Startup/Ecommerce/Game implementation. Purely additive.

**Result:** natural language → `ProductIntent` → `ProductBlueprint` →
`ProductPlan`, via a registry/plugin architecture that every future module
consumes. No Website Builder dependency. New workspaces add with zero
changes to existing code.

---

## Architecture Summary

`backend/services/product_intelligence/` — a pure, side-effect-free planning
library:

- **`types.py`** — strongly-typed models + enums (`WorkspaceKind`,
  `ProductCategory`, `Complexity`, `GenerationMode`, `InteractionStyle`,
  `ProductIntent`, `WorkspaceClassification`, `AgentRecommendation`,
  `ProductBlueprint`, `ProductPlan`). All JSON-serializable.
- **`registry.py`** — `WorkspaceProfile` plugin contract + register/get/all.
  The Open/Closed seam.
- **`workspaces/`** — one profile module per vertical (website, startup,
  ecommerce, trading, research, game, productivity), each self-registering.
- **`classifier.py`** — confidence-based, multi-intent workspace
  classification (reads the registry).
- **`intent.py`** — text → `ProductIntent` (facet extraction).
- **`agents.py`** — `AGENT_CATALOG` + `plan_agents` (planning only).
- **`blueprint.py`** — `ProductIntent` → renderer-independent
  `ProductBlueprint`.
- **`engine.py`** — the public pipeline (`classify`/`understand`/`blueprint`/
  `plan_product`).
- **`routes/v2_intelligence.py`** — thin gated HTTP wrapper.

## New Models

`ProductIntent` (workspace, product category/type, industry, audience,
primary goal, complexity, generation mode, interaction style, business +
technical context, expected deliverables, confidence, classification) →
`ProductBlueprint` (purpose, audience, business goal, core features, screens,
information architecture, interaction model, data model, UX + visual
direction, recommended agents, recommended renderer, future expansion, risk
analysis, success metrics) → `ProductPlan` (intent + blueprint + schema
version + planner). Full reference in `PRODUCT_INTELLIGENCE.md`.

## Planning Pipeline

`plan_product(text)` → classify (multi-intent) → parse intent (facets) →
build blueprint (profile-seeded, renderer-independent) → plan agents
(catalog + context rules, never executed) → `ProductPlan`. Deterministic, no
LLM/network; the `planner` field is the seam for a future LLM-backed planner.

## Files Changed

**Added**
- `backend/services/product_intelligence/{__init__,types,registry,classifier,intent,agents,blueprint,engine}.py`
- `backend/services/product_intelligence/workspaces/{__init__,website,startup,ecommerce,trading,research,game,productivity}.py`
- `backend/routes/v2_intelligence.py`
- `backend/tests/test_sprint13_product_intelligence.py`
- `PRODUCT_INTELLIGENCE.md`, `SPRINT_1_3_PRODUCT_INTELLIGENCE.md`

**Modified**
- `backend/core/config.py` — added `ENABLE_PRODUCT_INTELLIGENCE` flag.
- `backend/api.py` — mounted the gated `v2_intelligence` router.

**Deleted** — none.

## Tests Added

`test_sprint13_product_intelligence.py` — **22 tests**: per-workspace
classification, all-workspaces-registered, unknown request, honest unknown
blueprint, multi-intent, audience/industry extraction, technical/business
context, complexity escalation, full blueprint sections, renderer
independence, agent planning (+ payments→security, complex→QA), JSON
serialization, **future-workspace extensibility (register a new workspace
with zero code changes)**, and the gated route (200 + 503).

## Documentation

`PRODUCT_INTELLIGENCE.md` — intent flow, classification, blueprint, planning
pipeline, builder independence, future extension points, HTTP surface.

---

## Deployment Checklist

1. **New Environment Variables**
   - `ENABLE_PRODUCT_INTELLIGENCE` — default `false` — **Optional** —
     exposes the `/v2/intelligence/*` HTTP surface. The engine library works
     regardless; this only gates the routes. Leave unset/false for
     byte-identical production behaviour.
2. **Updated Environment Variables** — none.
3. **Deprecated Environment Variables** — none.
4. **Database Migrations** — none (the engine is stateless; no tables).
5. **New Python Dependencies** — none (pure stdlib).
6. **New Frontend Dependencies** — none.
7. **Configuration Changes** — none required. Optionally set
   `ENABLE_PRODUCT_INTELLIGENCE=true` on Railway to expose the routes.
8. **Docker Changes** — none.
9. **Railway Changes** — none required (optional flag above).
10. **Vercel Changes** — none.
11. **Redis Changes** — none.
12. **Celery Changes** — none.
13. **Storage Changes** — none.
14. **Authentication Changes** — none (routes are guest-allowed; identity
    resolved via existing `current_user`).
15. **CORS Changes** — none.
16. **Breaking Changes** — none. Purely additive; existing routes unchanged
    (156 → 160 routes, all new ones gated off by default).
17. **Manual Deployment Steps** — none. To enable the API: set
    `ENABLE_PRODUCT_INTELLIGENCE=true` and redeploy.
18. **Rollback Strategy** — unset `ENABLE_PRODUCT_INTELLIGENCE` (or set
    `false`); the routes return 503 and the engine library is dormant. No
    data to migrate back.

---

## Sprint Summary

- **Files Added:** 20 (8 engine modules, 8 workspace profiles, 1 route, 1
  test file, 2 docs).
- **Files Modified:** 2 (`config.py`, `api.py`).
- **Files Deleted:** 0.
- **Total Lines Added:** ~1,450. **Removed:** ~0 (additive; 2 small inserts).
- **Tests Added:** 22. **Tests Updated:** 0.
- **Documentation Added:** `PRODUCT_INTELLIGENCE.md` + this sprint doc.
- **Technical Debt Reduced:** establishes the single planning layer so future
  modules stop inventing their own interpretation logic (prevents future
  duplication). No giant switch statements — registry/plugin architecture.
- **Architectural Improvements:** Open/Closed workspace registry; strong
  typing end-to-end; renderer-independent blueprint; planner seam for a
  future LLM backend; clean one-way dependency (modules → engine).
- **Performance Impact:** negligible — pure in-process heuristics, no LLM/
  network/DB; classification is O(profiles × signals). Routes gated off by
  default → zero production impact.
- **Future Compatibility:** every future vertical (website, game, startup,
  ecommerce, trading, research, agents) consumes the same `ProductPlan`; new
  verticals register a profile with no existing-code changes; the heuristic
  planner can be swapped for an LLM behind the same contract.

---

## Recommended Next Sprint

**Sprint 1.4 — Blueprint-Driven Orchestration Bridge.**

*Why next:* Sprint 1.3 produces a `ProductPlan` with `recommended_agents` and
a `recommended_renderer`, but nothing consumes it yet. The single
highest-impact continuation is to wire the blueprint into the **existing,
already-built** orchestrator (`/v2/orchestrator`, Phase A.2) — turning
`recommended_agents` into an actual agent run and routing the result to the
`recommended_renderer` — without modifying any renderer or building new AI.

*Foundation that now exists:* a stable, typed, renderer-independent plan
(this sprint); a secured, identity-aware orchestrator + workflow runner
(Sprints 1.1–1.2). The bridge is a thin, well-typed adapter between them.

*Measurable improvement unlocked:* one request → understood plan → a real
coordinated multi-agent run scoped to the planned panel, with the artifact
routed by the planned renderer. It makes the intelligence layer *actionable*
and exercises the whole spine end-to-end on durable, secure foundations —
the first time "understand → plan → build" runs as one path.
