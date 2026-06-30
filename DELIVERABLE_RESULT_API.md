# KorvixAI — Deliverable Result / Preview API

> The stable, renderer-agnostic layer that surfaces what an orchestrator run
> produced. Every future module reads the same `PreviewPayload` without
> knowing the internal deliverable schema.

Package: `backend/services/deliverable_result/`
Routes: `GET /v2/orchestrator/runs/{run_id}/result`,
`GET /v2/orchestrator/projects/{project_id}/result`
(gated by `ENABLE_DELIVERABLE_RESULT_API`)

---

## 1. Where this sits in the AI OS

```
  ProductBlueprint (1.3)
        │
        ▼  blueprint_bridge (1.4) → orchestrator run
        │
        ▼  orchestrator deliverables (status + content + artifact)
        │
        ▼  deliverable_result (THIS, 1.5)  ── read-only resolver
        │
        ▼  PreviewPayload  ── consumed by future modules
```

It **reuses** the orchestrator's existing `get_run_snapshot` (which already
enforces ownership and reconciles run status) and `list_runs`. It does **not**
create a second deliverable store, never executes anything, and never
fabricates output.

---

## 2. The result resolver

- `resolve_run_result(run_id, *, user_id, artifact_type=None, renderer=None, include_partial=False)`
- `resolve_project_result(project_id, *, user_id, latest=True, …)`

Both return a `PreviewPayload`. Ownership: `get_run_snapshot(run_id,
user_id=…)` returns `None` for an unknown run **or** another user's run
(existence-hiding) → `NOT_FOUND`. The project resolver lists only the
caller's own runs.

**Final-deliverable selection.** Among completed deliverables it picks the
best **product artifact** by preview tier (`iframe` > `file_tree` > `code` >
`markdown`), newest within the tier. A real product artifact resolves to
`COMPLETED` even before the whole run finishes; an intermediate
markdown-only result while the run is still going is `PARTIAL`.

---

## 3. Lifecycle states (explicit — normal states never 500)

| `status` | Meaning |
|----------|---------|
| `not_found` | unknown run or cross-user (existence-hidden) |
| `no_run` | the project has no run yet |
| `pending` | run queued; nothing produced |
| `running` | run in progress; no deliverables yet |
| `partial` | some deliverables ready, none final (or run still running) |
| `completed` | a final artifact was resolved |
| `completed_no_artifact` | run finished but produced no artifact |
| `artifact_not_found` | `artifact_type`/`renderer` filter matched nothing |
| `failed` | run errored (errors populated) |
| `cancelled` | run cancelled |

`PENDING`/`RUNNING`/`PARTIAL` are non-terminal — callers poll again later.

---

## 4. PreviewPayload contract (renderer-agnostic)

```jsonc
{
  "status": "completed",
  "project_id": "...", "run_id": "...", "workflow_id": "...",
  "artifact_id": "...",
  "artifact_type": "html",          // typed kind — future types slot in
  "renderer": "iframe",             // iframe | code | markdown | file_tree | none | <future>
  "title": "...", "summary": "...",
  "content": "<!doctype html>…",    // the artifact body (string)
  "html_preview": "<!doctype html>…", // set ONLY for iframe artifacts
  "structured_data": { "type": "html", "files": [...], "download": {...} },
  "source_deliverables": [ { "id", "node_id", "kind", "status", … } ],
  "warnings": [], "errors": [],
  "created_at": "...", "updated_at": "..."
}
```

`renderer`/`artifact_type` are **plain strings** — the contract is not
HTML-only. Future types (`research_report`, `startup_analysis`,
`ecommerce_store_plan`, `game_design_document`, `game_code`,
`trading_research`, `product_blueprint`, `react_component`) require **no
contract change**: an unknown type/renderer passes through untouched (tested).

---

## 5. API

Identity from the Sprint 1.2 principal (never a query/body `user_id`).
Gated by `ENABLE_DELIVERABLE_RESULT_API` (default off → 503).

`GET /v2/orchestrator/runs/{run_id}/result`
`GET /v2/orchestrator/projects/{project_id}/result`

Query params: `artifact_type`, `renderer`, `latest` (project only),
`include_partial`. Response: `{ "result": <PreviewPayload>, "feature_flags": {…} }`.
Cross-user run → `result.status == "not_found"`; cross-user owned project
(when `ENABLE_PROJECTS`) → HTTP `404`.

---

## 6. Blueprint Bridge integration

`POST /v2/intelligence/orchestrate` (Sprint 1.4):
- **dry-run** still returns only plan + proposed execution (no result).
- **execute** returns run identifiers **and** a `result_route` string (e.g.
  `/v2/orchestrator/runs/<run_id>/result`) — where to fetch the produced
  output later. The bridge does **not** block waiting for the async run, and
  does **not** import the result resolver (it composes a string).

---

## 7. SSE / events awareness (future)

This sprint does **not** build a new SSE system. The secured SSE stream from
Sprint 1.2 (`/v2/events/stream`, scope-authorized) can later push
result-update notifications: emit a `run:<run_id>` or `project:<id>` scoped
event when a deliverable completes, and the client re-fetches this result
endpoint. The `PreviewPayload` (with `run_id`/`workflow_id`/`updated_at`) is
already compatible with that polling/refresh model.

---

## 8. What it does NOT do yet

- It does **not** improve or render HTML — it returns the artifact body +
  renderer hint; the actual rendering stays in the existing renderers/FE.
- It does **not** stream live updates (poll the endpoint; SSE wiring is a
  future step).
- It does **not** implement any vertical (website/startup/ecommerce/game) —
  it only surfaces whatever the orchestrator already produced.
- It does **not** create or migrate any store.

---

## 9. How future modules consume it

```
Website Builder → result.renderer == "iframe" → html_preview into an iframe
Startup Hub     → result.artifact_type == "startup_analysis" → structured_data
Ecommerce       → structured_data (store plan)
Game Studio     → content / structured_data.files (design doc / code)
Research         → content / summary (report)
```

All read the same `PreviewPayload`; none needs the deliverable schema.
