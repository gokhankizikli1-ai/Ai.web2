# KorvixAI — Universal Product Intelligence Engine

> KorvixAI is an AI Operating System, not a template generator. **Every
> generation begins by understanding the user's intent.** This engine turns
> natural language into a structured, renderer-independent **ProductPlan**
> that every future module consumes — so no module invents its own
> interpretation logic.

Package: `backend/services/product_intelligence/`
HTTP surface: `/v2/intelligence/*` (gated by `ENABLE_PRODUCT_INTELLIGENCE`)

---

## 1. Intent Flow

```
  natural language
        │
        ▼
  ┌───────────────┐   confidence-based, multi-intent
  │  classify()   │──────────────────────────────► WorkspaceClassification
  └───────┬───────┘
          ▼
  ┌───────────────┐   facets: category, industry, audience, goal,
  │  understand() │   complexity, generation mode, interaction style,
  └───────┬───────┘   business/technical context, deliverables
          ▼
     ProductIntent
          │
          ▼
  ┌───────────────┐   purpose, audience, features, screens, IA,
  │  blueprint()  │   data model, UX/visual direction, agents,
  └───────┬───────┘   renderer hint, risks, metrics, future expansion
          ▼
   ProductBlueprint
          │
          ▼
  ┌───────────────┐
  │ plan_product()│──────────────────────────────► ProductPlan
  └───────────────┘     (intent + blueprint — the universal artifact)
```

`plan_product(text)` runs the whole pipeline. It is **pure** (no LLM, no
network, no I/O, no renderer import) — deterministic, fast and fully
testable. The `planner` field on `ProductPlan` ("heuristic-v1") is the seam
for a future LLM-backed planner that implements the same contract.

---

## 2. Classification

`classifier.classify(text) → WorkspaceClassification`

- Scores the text against **every registered `WorkspaceProfile`** using
  keyword + regex signals, then normalises to a 0..1 distribution.
- **Confidence-based:** the primary workspace is the top score; below a
  floor it degrades to `GENERAL`; with no signal at all it is `UNKNOWN`.
- **Multi-intent:** `is_multi_intent()` is true when ≥2 workspaces score
  above threshold (e.g. "a website *and* a store"); `secondary` lists the
  others.

Supported workspaces (built-in): `website_app`, `startup`, `ecommerce`,
`trading`, `research`, `game`, `productivity`, plus `general` / `unknown`.

---

## 3. Blueprint

`blueprint.build_blueprint(intent) → ProductBlueprint` — a complete,
**renderer-independent** plan. Fields:

| Field | Meaning |
|-------|---------|
| `purpose` | What this product is, grounded in the request |
| `audience` | Who it's for (extracted/inferred) |
| `business_goal` | Primary goal + business context |
| `core_features` | Feature set seeded by the workspace profile |
| `screens` | Screen / view list |
| `information_architecture` | Structure / navigation |
| `interaction_model` | How users interact |
| `data_model` | High-level entities |
| `ux_direction` / `visual_direction` | Design guidance |
| `recommended_agents` | Planned agent panel (NOT executed) |
| `recommended_renderer` | String hint only (`html`/`dashboard`/`document`/`simulation`/`none`) |
| `future_expansion` | Where it grows next |
| `risk_analysis` | Key risks |
| `success_metrics` | How success is measured |
| `intent` | The embedded `ProductIntent` |

`recommended_renderer` is a **plain string** — the engine never imports or
calls a renderer, so the Website Builder, Game Dev, Startup, Research and
Trading modules all consume the same blueprint independently.

---

## 4. Planning Pipeline (agents)

`agents.plan_agents(intent) → list[AgentRecommendation]` — **planning only;
nothing is executed.** The roster lives in `AGENT_CATALOG` (data), and the
plan is the workspace's `base_agents` plus context-driven additions:

- auth/payments in technical context → `security_engineer`
- database/api in technical context → `backend_engineer`
- business context present → `product_strategist`
- complexity ≥ complex → `qa_engineer`

Each `AgentRecommendation` carries `agent_id`, `role`, `responsibility`,
`priority`, and a `reason`. A future orchestration layer (or the existing
`/v2/orchestrator`) can consume these to actually run agents.

---

## 5. Builder Independence

The blueprint has **no dependency on the Website Builder** (or any other
module). The dependency direction is one-way:

```
  product_intelligence  ──(consumed by)──►  website builder
                         ──(consumed by)──►  game dev
                         ──(consumed by)──►  startup / ecommerce / trading
                         ──(consumed by)──►  research / agents
```

`grep` confirms the package imports no renderer, provider, or builder. Any
module imports `plan_product` (or accepts a `ProductPlan`) and reads
`blueprint.recommended_renderer` / `blueprint.recommended_agents` to decide
what to do — they never re-interpret the raw text.

---

## 6. Future Extension Points (no existing code changes)

**Add a workspace** — drop a module under
`backend/services/product_intelligence/workspaces/` that calls
`register_workspace(WorkspaceProfile(...))`, and add its name to
`_BUILTIN_MODULES`. The classifier, intent parser, blueprint builder and
agent planner all read the registry, so nothing else changes (Open/Closed).

```python
from backend.services.product_intelligence import register_workspace, WorkspaceProfile, WorkspaceKind
register_workspace(WorkspaceProfile(kind=..., title=..., keywords={...}, ...))
```

**Swap the planner** — implement an LLM-backed `classify()` / `parse_intent()`
behind the same signatures; callers and the route are untouched.

**Consume the plan** — a module accepts a `ProductPlan` (or calls
`plan_product`) and branches on `blueprint.recommended_renderer` and
`blueprint.recommended_agents`. It never parses the user's text itself.

---

## 7. HTTP surface (optional)

Gated by `ENABLE_PRODUCT_INTELLIGENCE` (default off → 503). Guest-allowed
(planning is stateless and non-sensitive):

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/v2/intelligence/health` | flag state + registered workspaces (always callable) |
| GET | `/v2/intelligence/workspaces` | list registered workspaces |
| POST | `/v2/intelligence/classify` | `{text}` → classification |
| POST | `/v2/intelligence/plan` | `{text}` → full ProductPlan |

The engine is primarily a **library** (`from backend.services.product_intelligence
import plan_product`); the route is a thin convenience wrapper for the
frontend and external consumers.
