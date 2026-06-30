# KorvixAI — Sprint 1.9: Prototype Quality Upgrade

## Goal

Make generated app/website prototypes feel modern, premium, and
**product-specific** — without rewriting the orchestration pipeline, Product
Intelligence, or security/auth. Pure quality work on the existing generation
engine: where Korvix decides *what HTML to produce*.

**Not** a Website Builder, Game Studio, or Ecommerce sprint. **Not** a
redesign of the Korvix app shell. No new routes, no new dependencies, no
frontend changes.

---

## Where generation happens (the audit, before any code changed)

```
agent.run job (orchestrator/agent_run_kind.py)
  → backend.services.generation.build_prompt()        (engine.py)
       → prompt_expander.expand(user_request, blueprint)   (deterministic spec)
       → HtmlRenderer.build_prompt(spec)                   (LLM prompt, layout-aware)
  → agent runtime calls the LLM
  → backend.services.generation.finalize_artifact()   (engine.py)
       → quality.is_premium(llm_html)?
            yes → keep LLM output (ensure CSP/viewport)         source="model"
            no  → render_premium_page(spec)  (deterministic)    source="generated"
                     → renderers/{mobile,dashboard,landing,ecommerce,
                                  booking,editor,portfolio}.render(spec)
                     → renderers/base.document(spec, body)  (CSP, shared script)
  → typed artifact { type:"html", preview:"iframe", content, metadata }
```

**What the audit found (already strong):** a hybrid LLM + deterministic
system with a real internal "ProductSpec" (audience/goals/navigation/
sections/metrics/theme), a 12-mode "Design Diversity" style engine (Apple
Minimal, Linear Dark, Stripe Gradient, Notion Clean, …), 6 hand-built
showcase verticals (fitness, AI chat, banking, crypto, restaurant, SaaS) with
real distinct sample data, and dedicated renderers for editor/dashboard/
ecommerce/booking/landing/portfolio layouts — all wrapped in a strict,
network-blocking CSP with one shared sandbox-safe interaction script.

**What was missing (this sprint's two real gaps):**
1. **ProductBlueprint data was computed (Sprint 1.3) and stored on the
   orchestrator run (Sprint 1.4) — but never actually read by generation.**
   Every run re-derived everything from raw text via the same regex
   classifier, discarding the richer, already-computed blueprint.
2. **No mobile-native app shell existed.** Every "real app" request — fitness,
   a habit tracker, a music player — rendered through the SAME SaaS
   sidebar+topbar dashboard shell. A fitness app and a banking dashboard had
   different data and copy, but identical structural chrome.

---

## What was improved

### 1. A new "mobile" app-shell layout (`renderers/mobile.py`, new file)

A genuinely mobile-native renderer: a centered phone-width canvas (~430px,
full-bleed on real mobile widths), a sticky top app-bar, a scrollable content
column (hero card with a circular **progress ring**, a 2×2 **metric grid**, a
**list panel**, **quick-action pills**, a **profile/avatar header**), a
floating action button, and a **sticky bottom tab bar** with inline-SVG icons
— replacing the sidebar entirely. Reuses the existing sandbox-safe
data-nav/data-panel interaction script (no new JS), the existing `ring()` /
`avatar()` helpers, and the design-system CSS tokens, so it's visually
cohesive with every other renderer.

### 2. Inline SVG icon set (`renderers/base.py`)

A small, hand-authored set of stroke-style SVG icons (home/chart/list/bell/
person/heart/calendar/play/bag/plus/compass) — `svg_icon(name)`. Zero
network, zero icon-font dependency. Used by the mobile tab bar; the existing
emoji glyphs on decorative feature cards are untouched (they're already
network-free, just a different visual texture for content, not navigation
chrome).

### 3. Three new mobile-native vertical presets (`prompt_expander.py`)

`_habit_tracker()` (habit/meditation/mindfulness/sleep/mood), `_music_player()`
(music/podcast/audio player), `_recipe_app()` (recipe/cooking/meal plan) —
each with real, distinct sample data/copy/navigation/theme, matching the
quality bar of the existing six. **A previously-generic request — "Build a
meditation app" — now reroutes from the SaaS dashboard fallback to the mobile
shell**, while business/productivity tools (CRM, todo/task manager) are
explicitly verified to stay on the dashboard shell (they're genuinely
desktop/web-tool shaped). Existing verticals (fitness, banking, crypto, AI
chat, restaurant, SaaS) are **completely untouched** — same layout, same
renderer, same test guarantees as before this sprint.

### 4. ProductBlueprint data is now actually used (the architectural fix)

- `blueprint_bridge/types.py` — `orchestrator_metadata()` now also forwards
  `core_features` (it silently dropped this field before).
- `orchestrator/service.py` — a new `_blueprint_hint()` extracts a small,
  JSON-serializable subset (`workspace`, `product_category`, `audience`,
  `complexity`, `recommended_renderer`, `core_features`) from the run's
  metadata, attached to **every** workflow step's job payload as
  `"blueprint"`. The orchestrator stays decoupled — it recognises field
  *names*, not any specific upstream package (verified: the orchestrator
  package still contains zero references to `blueprint_bridge` or
  `product_intelligence`).
- `orchestrator/agent_run_kind.py` — reads `payload.get("blueprint")`,
  threads it into `build_prompt()` / `finalize_artifact()`.
- `generation/engine.py` / `prompt_expander.py` — `expand()` gained an
  **optional** `blueprint` parameter. When present, it (a) widens the text
  used for classification with the blueprint's own category/feature words
  — so a terse, already-classified prompt routes correctly — and (b)
  overrides the chosen spec's `audience` and appends up to 2 blueprint
  `core_features` into the features section. **An explicit keyword already
  in the user's own prompt always wins** over blueprint signal (verified by
  test: a stale/contradictory blueprint hint cannot hijack an unambiguous
  prompt). `blueprint=None` (the default, and the common direct-
  orchestrator-run path) is **byte-identical to pre-sprint behaviour**.

### 5. Layout-aware LLM prompt guidance (`engine.py`)

The LLM prompt now includes a structural guidance block matched to
`spec.layout` — explicit "phone-width canvas + bottom tab bar, not a
sidebar" instructions for `mobile`, "sidebar + topbar" for `app`, and the
existing marketing-page structure for `landing` — so a good LLM reply gets
the right shape *without* needing the deterministic fallback to fix it. Also
added an explicit "inline SVG or CSS-only icons, never an external icon
font/CDN" requirement.

---

## Supported prototype patterns (after this sprint)

| Layout | Shell | Verticals using it |
|---|---|---|
| `mobile` (**new**) | Phone canvas, top app-bar, progress ring, metric grid, list panel, FAB, bottom tab bar | habit/meditation tracker, music player, recipe app, + any unmatched genuinely-personal app request |
| `app` (dashboard) | Sidebar + topbar, metric bento, charts, activity feed, settings panel | fitness, banking, crypto, AI chat, CRM/todo/admin/business tools |
| `editor` | 3-pane desktop app window | notes/journaling/writing apps |
| `landing` | Hero, social proof, feature grid, pricing, testimonials, FAQ, CTA, footer | SaaS landing, websites |
| `ecommerce` / `booking` / `portfolio` | Unchanged from before this sprint | (out of scope this sprint) |

---

## Limitations

- The 3 new mobile presets cover specific, named categories — the residual
  generic `application_ui` fallback (anything not matching a vertical/layout
  rule) still routes to the SaaS dashboard shell, not mobile. Broadening that
  further was deliberately left out of scope to keep this sprint's blast
  radius small and fully test-verified (see "Verification").
- `ecommerce` / `booking` / `portfolio` renderers were audited (already have
  real product/room/gallery data) but not touched this sprint — explicitly
  out of scope ("Do NOT build Ecommerce yet").
- The LLM-path prompt guidance cannot be observed end-to-end without a real
  OpenAI call — it was verified to be present and well-formed in the prompt
  text, not against live model output (would require network/API costs,
  which this sprint's verification rules forbid).
- Icons remain a mix of inline SVG (navigation chrome — new this sprint) and
  emoji glyphs (decorative feature-card icons — pre-existing, left as-is;
  zero network either way).

---

## Verification

**Backend (the only thing this sprint touches):**
- New `backend/tests/test_sprint19_prototype_quality.py` — 34 tests: mobile
  layout routing (3 new verticals + meditation reroute + business-tool
  exclusion), mobile renderer component presence (phone frame, top bar,
  bottom tab bar, progress ring, metric grid, list items, FAB, SVG icons,
  not-a-sidebar), sandbox safety + interactivity, the reveal panel reachable
  from every tab, existing-vertical non-regression, blueprint wiring
  (backward-compat, audience/feature override, classification-assist,
  explicit-prompt-wins, `service.py`'s `_blueprint_hint` extraction),
  layout-aware LLM prompt guidance, and the module-boundary guarantee
  (orchestrator still imports neither `blueprint_bridge` nor
  `product_intelligence`).
- One **justified, narrow** existing-test update:
  `test_generation_layouts.py::test_app_prompts_render_product_ui_not_marketing`
  — its assertion tuple now also accepts the new `"mobile"` layout (the
  test's actual intent — "a real app interface, not a marketing page" — is
  preserved; only the previously-closed set of valid layouts widened).
- Full backend suite: re-run after every change; the project's own
  generation/intent/artifact/bridge/orchestrator suites (221 tests) plus the
  full repository suite were run and pass with the same pre-existing,
  unrelated environmental failures as `main` (missing `google` SDK in this
  sandbox, 2 memory-plane date-directive tests, 1 known ordering flake) —
  zero new failures introduced by this sprint.
- **Route count unchanged: 165.** No route, no auth/security file, no
  database/migration touched.
- App imports and starts cleanly (`backend.api:app` boots, full ASGI mode).
- **Frontend:** zero files in `src/` touched this sprint — no frontend
  build/typecheck/lint was necessary or run.
- **No fake output:** every new code path was smoke-tested directly (not
  just unit-asserted) — the mobile renderer was rendered and visually
  reasoned about, the blueprint hint was traced end-to-end through a real
  `start_project_run()` call capturing the actual workflow step payload.

---

## Deployment Checklist

1. **New environment variables** — **No new environment variables required.**
2. **Updated environment variables** — none.
3. **Deprecated environment variables** — none.
4. **Railway changes** — none.
5. **Vercel changes** — none (no frontend files changed).
6. **Docker changes** — none.
7. **DB migrations** — none. No schema, no new table, no new column.
8. **New dependencies** — none (Python or frontend). No `requirements.txt` /
   `package.json` change.
9. **Breaking changes** — none. Purely additive: a new renderer module, three
   new vertical presets, an optional keyword-only `blueprint` parameter
   (default `None`, fully backward compatible) on two already-internal
   functions, and one additional dict key (`core_features`) appended to an
   existing metadata dict (no key removed, no existing consumer reads an
   exact-keys-only structure — verified, no test broke).
10. **Manual deployment steps** — none. This ships live the moment the
    existing `ENABLE_PROJECT_ORCHESTRATOR` (+ execution prerequisites) are
    on — no new flag to flip.
11. **Rollback plan** — revert this commit. `renderers/mobile.py` and
    `test_sprint19_prototype_quality.py` are net-new files (clean delete);
    every other change is additive within existing functions. No data,
    schema, or backend state to undo.

**No deployment or configuration changes required.**

---

## Sprint Summary

- **Files Added:** 2 — `backend/services/generation/renderers/mobile.py`,
  `backend/tests/test_sprint19_prototype_quality.py`.
- **Files Modified:** 8 — `renderers/__init__.py`, `renderers/base.py`,
  `generation/engine.py`, `generation/prompt_expander.py`,
  `blueprint_bridge/types.py`, `orchestrator/service.py`,
  `orchestrator/agent_run_kind.py`, `tests/test_generation_layouts.py` (one
  justified assertion widened).
- **Files Deleted:** 0.
- **Total Lines Added:** ~750. **Total Lines Removed:** ~15.
- **Tests Added:** 34 (new file). **Tests Updated:** 1 assertion (1 file).
- **Documentation Added:** this file.
- **User-Visible Impact:** generated app/website previews for mobile-native
  product ideas (fitness-adjacent wellness apps, music players, recipe apps,
  meditation/habit trackers, and any future similar request) now render a
  genuine phone-shaped app shell — progress ring, bottom tab bar, profile
  card, list panel — instead of a generic sidebar dashboard with swapped
  copy. Prompts that Product Intelligence has already classified now
  actually influence the generated audience/feature copy and help route
  ambiguous prompts correctly, instead of that classification being computed
  and discarded.
- **Test/Verification Status:** all new + existing relevant suites pass (255
  tests across the touched areas); full repository suite shows zero new
  failures; route count, app boot, and module boundaries all confirmed
  unchanged.
- **Known Limitations:** see "Limitations" above — generic-fallback breadth,
  ecommerce/booking/portfolio untouched, LLM-path guidance unverified against
  a live model call (text-only verification).

---

## Recommended Next Sprint

**Sprint 2.0 — Live Generation Visibility: Show the Quality Gate in the UI.**

*Why next:* this sprint upgraded *what* gets generated (mobile shell, blueprint-
aware copy, layout-aware LLM guidance) but the Sprint 1.8 live-run UI still
shows generation as an opaque "Orchestrator" stage. The natural next step —
purely additive, no architecture change — is to surface the **already-computed**
generation metadata (`source: "model"|"generated"`, `quality_score`,
`product_type`, `layout`, `style`) that `finalize_artifact()` already attaches
to every HTML deliverable, in the Sprint 1.7/1.8 Results UI: a small "Quality"
badge (e.g. "Premium · 96/100 · mobile · habit tracker") next to the rendered
preview, so a user can see at a glance whether their result is a fresh model
generation or the guaranteed-premium deterministic fallback, and what product
shape Korvix detected.

*New foundation this sprint created:* every HTML artifact's metadata now
honestly distinguishes `source` (LLM vs. deterministic) and carries a real
`quality_score`, `product_type`, and `layout` — previously computed but never
surfaced past the backend.

*Measurable user-visible capability unlocked:* a user can tell, without
opening dev tools, whether Korvix understood their product correctly and how
confident the quality gate is — building trust in a system that already does
real work but doesn't yet show its reasoning.

*Out of scope for 2.0:* any further generation-quality changes (this sprint's
job is done), new verticals, Website/Game/Ecommerce builders, and any backend
contract change — strictly surfacing existing metadata in the existing
Results UI.
