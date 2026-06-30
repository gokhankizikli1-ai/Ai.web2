# KorvixAI — Blueprint → Orchestrator Bridge

> The thin, typed connector that makes a **ProductBlueprint actionable** by
> the existing Project Orchestrator — turning "understand → plan" into
> "understand → plan → build" without either side knowing about the other.

Package: `backend/services/blueprint_bridge/`
Route: `POST /v2/intelligence/orchestrate` (gated by
`ENABLE_BLUEPRINT_ORCHESTRATOR_BRIDGE`)

---

## 1. Where this sits in the AI OS

```
  natural language
        │
        ▼
  product_intelligence            "what to build" (Sprint 1.3)
     → ProductPlan / ProductBlueprint
        │
        ▼
  blueprint_bridge   ◄── THIS package (the ONLY connector)
     → OrchestrationRequest
        │
        ▼
  orchestrator                    "how it runs" (Phase A.2, secured in 1.2)
     → run / workflow / deliverables / tasks
```

**Module separation is preserved.** The bridge imports both sides; **neither
side imports the other or the bridge.** `product_intelligence` stays
renderer/orchestrator-independent; the orchestrator never becomes product
intelligence, and verticals (website/game/ecommerce) are NOT hardcoded into
it. The only vertical-aware mapping (workspace → orchestrator template id)
lives in `blueprint_bridge/adapter.py` as data. (Enforced by tests.)

---

## 2. The adapter

`adapter.blueprint_to_request(blueprint, user_request, project_id, metadata)`
→ `OrchestrationRequest`. It **preserves**: the original prompt, workspace,
product category, audience, complexity, core features, recommended agents,
recommended deliverables, recommended renderer, risk analysis, and success
metrics. It maps the blueprint's workspace to an **existing** orchestrator
template (no new templates are created); when the preferred template is
gated off or the workspace is unknown, `suggested_template_id` is `None` and
the orchestrator chooses from the preserved prompt.

`OrchestrationRequest` maps 1:1 onto `orchestrator.start_project_run`'s
parameters (`user_request`, `template_id`, `project_id`, `metadata`), and its
`orchestrator_metadata()` attaches the blueprint summary (renderer hint,
agents, deliverables…) so the plan travels WITH the run.

---

## 3. Dry-run vs execution

### Dry-run (default — safe)
`bridge.dry_run(request) → DryRunResult`. **No jobs, no LLM, no run rows.**
It resolves which template the orchestrator *would* use via the
orchestrator's own **regex-only** `choose_template` (`plan=None`, so no
coordinator/LLM), and returns:

- `project_title`, `resolved_template_id`
- `proposed_agents`, `proposed_deliverables`
- `proposed_steps` (the template's DAG nodes — preview only)
- `recommended_renderer`, `estimated_complexity`
- `missing_prerequisites` (flags needed for a real run)

### Execution (gated)
`await bridge.execute(request, user_id) → ExecutionResult`. Calls the real
`start_project_run`. **Never silently mocks:** if any prerequisite flag is
off it returns `executed=False` with `disabled_prerequisites` listed. On
success it returns `run_id` / `project_id` / `workflow_id` / `status` from
the orchestrator snapshot. `user_id` MUST come from the authenticated
context (the route passes `principal.user_id`).

The route runs execution ONLY when the caller sets `execute=true` **and**
`dry_run=false` — safe by default.

---

## 4. Feature flags

| Flag | Default | Gates |
|------|---------|-------|
| `ENABLE_BLUEPRINT_ORCHESTRATOR_BRIDGE` | `false` | the `/v2/intelligence/orchestrate` route (503 when off). Dry-run works when on. |
| `ENABLE_PRODUCT_INTELLIGENCE` | `false` | execution prerequisite |
| `ENABLE_PROJECT_ORCHESTRATOR` | `false` | execution prerequisite (the conductor) |
| `ENABLE_WORKFLOWS` / `ENABLE_WORKFLOW_RUNNER` / `ENABLE_JOB_QUEUE` | `false` | execution prerequisites (agents only run when on) |

**When the bridge flag is `false`:** the route returns 503; nothing runs.
**When `true`:** dry-run works immediately; execution additionally requires
the flags above, and reports any that are missing instead of mocking.

---

## 5. API

`POST /v2/intelligence/orchestrate` — identity from the Sprint 1.2 principal
(never `body.user_id`); cross-user `project_id` access returns 404.

Request:
```json
{ "prompt": "build a landing page for a fintech startup",
  "project_id": null, "dry_run": true, "execute": false, "metadata": {} }
```

Response (always): `plan`, `blueprint`, `orchestration_request`,
`feature_flags`, `disabled_prerequisites`, `mode`, and either `dry_run` or
`execution`.

`GET /v2/intelligence/orchestrate/health` — always callable; reports the
bridge flag, all relevant feature flags, `execution_ready`, and
`missing_prerequisites`.

---

## 6. Future extension path — how each vertical consumes this later

The bridge is vertical-agnostic. Later sprints add a vertical by:

- **Website / App builder:** read `dry_run.recommended_renderer == "html"`
  and route the produced deliverable to the existing HTML renderer. No bridge
  change.
- **Game Development:** register a game-oriented orchestrator template (its
  own sprint) and, if desired, add one line to the adapter's
  `_WORKSPACE_TEMPLATE` map (`GAME → <new template>`). The bridge already
  classifies and plans game requests.
- **Startup / Ecommerce / Research / Trading:** same pattern — map the
  workspace to the appropriate (existing or future) template; everything else
  (agents, deliverables, metadata, identity, gating) is already handled.

No vertical needs to re-implement planning or orchestration: it consumes the
`ProductPlan` + `OrchestrationRequest` and reads `recommended_renderer` /
`recommended_agents`. The bridge stays thin; verticals stay out of the
orchestrator.
