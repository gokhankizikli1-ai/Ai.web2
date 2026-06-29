# Phase A.2 — Project Orchestrator (the conductor)

**Roadmap:** `AI_OS_ROADMAP.md` → Part III Phase A → **PR #2 (Project Orchestrator service)**
**Status:** Implemented, behind `ENABLE_PROJECT_ORCHESTRATOR` (default `false`)
**Depends on:** PR #1 Workflow DAG Runner (`#181`, shipped), the Job Queue (Phase 7),
the agent runtime (Phase 3.x), Panels + Coordinator (Phase 9).
**Date:** 2026-06-29

---

## What shipped

The "conductor" the roadmap (§2.1) says was the real gap: a single service that takes
**one user request → a tracked multi-agent project run**. It composes existing
subsystems; it does **not** re-implement any of them.

```
POST /v2/orchestrator/run  {user_request, project_id?, template_id?}
  → coordinator plan (or explicit template_id)
  → ProjectTemplate (built-in or ad-hoc)
  → instantiate:  1 panel
                + N deliverables   (registry, status pending)
                + N task-graph rows (Phase 5.1 execution graph)
                + 1 workflow        (job steps, kind `agent.run`)
  → kick the Phase-A.1 DAG runner
  → returns a composite snapshot {run, workflow, deliverables, task_graph}
```

### Why execution flows through the Job Queue
The DAG runner can dispatch a step to a **job** or an **agent_task**. Only the
job path has a real executor (the Phase-7 `InlineJobRunner` runs handlers to a
terminal state and the runner already polls jobs); `agent_tasks` is
observability-only and nothing completes its rows. So the orchestrator builds
`job` steps using one new internal job kind, **`agent.run`**, which runs the
assigned specialist via the existing `run_agent` runtime and writes the produced
content back into the deliverable. This reuses the proven Phase-7 path
end-to-end instead of building a second execution engine.

---

## New code (all additive)

| File | Purpose |
|---|---|
| `backend/services/orchestrator/deliverables_store.py` | **NEW** `deliverables` table + CRUD (the registry). |
| `backend/services/orchestrator/templates/base.py` | `ProjectTemplate` / `TemplateNode` model + DAG validation. |
| `backend/services/orchestrator/templates/builtins.py` | Two starter templates: `generic_research` (serial), `generic_creation` (parallel fan-out). |
| `backend/services/orchestrator/templates/catalog.py` | Template registry + ad-hoc-from-coordinator-plan builder + `choose_template`. |
| `backend/services/orchestrator/agent_run_kind.py` | The `agent.run` job kind (runs one specialist, updates deliverable + task). |
| `backend/services/orchestrator/service.py` | The conductor: `start_project_run` / `get_run_snapshot` / `cancel_run`. |
| `backend/routes/v2_orchestrator.py` | `/v2/orchestrator/*` HTTP surface (run / runs / stream / cancel / templates / health). |
| `src/hooks/useProjectOrchestrator.ts` | Typed FE client + poll-based `useProjectRun` hook (consumed by PR #3). |

Modified (minimal): `backend/services/orchestrator/__init__.py` (re-export new
symbols), `backend/api.py` (register the route).

**Not touched:** the agent runtime, `delegate.py`, the DAG runner, the job
queue, panels, coordinator — all reused as-is.

---

## Data model (migrations)

Additive only — one new table, created idempotently via
`init_deliverables_table()` (`CREATE TABLE IF NOT EXISTS`). Lives in the same
`projects.db` as `runs` (Phase 3.4) and `tasks` (Phase 5.1), so a future
project-delete cascade can sweep all three together.

```
deliverables(
  id, run_id, project_id, agent_id, node_id, kind, title,
  status,            -- pending | in_progress | completed | failed | skipped
  content_json,      -- opaque JSON (no schema lock-in)
  version, error, metadata_json, created_at, updated_at
)
```

No `ALTER TABLE`, no backfill, no changes to existing tables.

---

## API

| Method | Path | Notes |
|---|---|---|
| `POST` | `/v2/orchestrator/run` | Start a project run. Body `{user_request, project_id?, template_id?}`. |
| `GET`  | `/v2/orchestrator/runs/{run_id}` | Composite snapshot. |
| `GET`  | `/v2/orchestrator/runs/{run_id}/stream` | SSE (poll-based) until terminal. |
| `POST` | `/v2/orchestrator/runs/{run_id}/cancel` | Cancel; cascades to the workflow + in-flight jobs. |
| `GET`  | `/v2/orchestrator/templates` | List built-in templates. |
| `GET`  | `/v2/orchestrator/health` | Always 200; reports flag state + dependent-flag matrix + stats. |

All routes JWT-scoped via `current_user`; cross-user runs are existence-hidden
(404). Responses use the standard v2 envelope.

---

## Feature flags

| Flag | Default | Controls |
|---|---|---|
| `ENABLE_PROJECT_ORCHESTRATOR` | `false` | The whole `/v2/orchestrator/*` surface. |

A run only **executes** when its dependencies are also on:
`ENABLE_WORKFLOWS`, `ENABLE_WORKFLOW_RUNNER`, `ENABLE_JOB_QUEUE`
(plus `ENABLE_REAL_COORDINATION` for the panel). With the orchestrator on but a
dependency off, the scaffold is still created and `GET /health` +
`runner_error` in the run response explain exactly what's missing — no silent
"stuck running". Rollback = flip `ENABLE_PROJECT_ORCHESTRATOR` to `false`.

Optional tuning: `ORCHESTRATOR_SSE_POLL_INTERVAL_SEC` (default 1.0),
`ORCHESTRATOR_SSE_MAX_SECONDS` (default 300).

---

## Tests

`backend/tests/test_phaseA2_project_orchestrator.py` — **20 tests**, all green:

- Templates / catalog (6): built-in validity, parallel fan-out shape, cycle /
  unknown-dep rejection, ad-hoc build from a plan, selection heuristics.
- Deliverable registry (3): create/read/list, status transitions, content +
  version bump.
- Service + end-to-end (5): scaffold composition (run + workflow + N
  deliverables + N tasks + panel, correct `user_id`); linear run drives to
  completion with produced content; parallel run completes; agent failure fails
  the workflow + fails the running deliverable + skips downstream + errors the
  run; cancel skips open deliverables + hides cross-user.
- HTTP routes (6): health always-200, disabled→503, templates list,
  unknown-run→404, unknown-template→404, full run→snapshot→cancel.

The agent runtime is faked (`agent_run_kind.run_agent` monkeypatched); every
other subsystem in the e2e tests is real (workflows store + DAG runner + inline
job queue + deliverables + tasks + panels).

**Full backend suite:** 1578 passed, 1 skipped (optional `google-generativeai`).
Two failures in `test_memory_plane_stream_chat.py` are **pre-existing** on the
base branch (a chat-path date-injection assertion, commits #178–180) and are
unrelated to this work — verified by re-running them with this PR's changes
stashed.

---

## Follow-ups (not in this PR — per roadmap)

- **PR #3 / Phase B+C:** wire `ProjectWorkspace.tsx` to these routes (the
  `useProjectOrchestrator` hook is the entry point), add the
  `DeliverableChecklist` / `TaskGraphView` components, and ship the
  landing-page template on top of this scaffold.
- Postgres parity for the new `deliverables` table (Phase D) — follows the
  memory-plane dual-backend pattern.
