# KorvixAI — Sprint 2.0: Universal Renderer & Premium Web Builder

## Goal

Transform Korvix from a basic prototype generator into a premium AI
application builder, focused entirely on **output quality, renderer
intelligence, and user experience**. Pure generation + preview-reliability
work — the orchestrator pipeline, the blueprint bridge, and every backend
API contract are unchanged.

---

## Architecture before this sprint (the audit)

Sprint 1.9 already gave generation a real internal `ProductSpec`, a 12-mode
Design Diversity style engine, a comprehensive shared design system
(`design_system.py` — spacing/typography/radius/shadow/breakpoint/grid
tokens, already covering nearly all of "Premium Design System" before this
sprint started), and 7 dedicated renderer modules dispatched purely by
`spec.layout` (`app`/`editor`/`ecommerce`/`booking`/`landing`/`portfolio`/
`mobile`). What was missing:

1. **No product-facing renderer taxonomy.** `layout` is an internal
   *interface-shape* key — it has no notion of "Admin Panel" vs "SaaS
   Dashboard" vs "Analytics Dashboard" (all three rendered identically
   through `app`), or "Landing Page" vs "Marketing Website" (both `landing`).
2. **Large monolithic HTML generation.** `dashboard.py` and `landing.py`
   each hand-rolled their own pricing/FAQ/testimonials/settings/table-like
   blocks inline — no shared, independently-testable component functions for
   genuinely cross-renderer concerns (tables, timelines, calendars, a real
   music player, notifications, forms).
3. **Two confirmed preview-staleness bugs**, found via a dedicated frontend
   audit (see below): two `<iframe srcDoc={...}>` sites had no React `key`,
   so a switched run/deliverable mutated the same DOM node's `srcDoc`
   in-place instead of getting a guaranteed-fresh mount.

---

## What was improved

### 1. Universal Renderer Selector (`backend/services/generation/renderer_selector.py`, new)

A pure, deterministic `select_renderer()` that labels the *already-chosen*
`layout` with one of the **7 named renderer categories** from the spec —
`mobile_app`, `saas_dashboard`, `landing_page`, `admin_panel`,
`marketing_website`, `portfolio`, `analytics_dashboard` — and, for the two
layouts that fan out into more than one category (`app` → SaaS Dashboard /
Admin Panel / Analytics Dashboard, `landing` → Landing Page / Marketing
Website), an additional `variant` so the renderer module can adjust content
emphasis. Crucially, **this is a layer on top of `layout`, not a
replacement** — it never changes which renderer module actually renders the
page, so every Sprint 1.9-locked layout/test constraint is untouched.

```
expand(prompt) → intent.classify() + _route()  → spec.layout  (existing, untouched)
                                                ↓
                              renderer_selector.select_renderer(text, layout, ...)
                                                ↓
                         spec.renderer = category      (e.g. "admin_panel")
                         spec.data["variant"] = variant (e.g. "admin_panel")
```

`spec.renderer` is carried into artifact metadata as `renderer_category` and
into the (invisible) LLM prompt's spec block, so both the deterministic
fallback and the LLM path stay aligned on which product family they're
building.

Selected examples (all 9 of the spec's "Prompt Understanding" examples,
verified by test):

| Prompt | Category |
|---|---|
| Build a music player | `mobile_app` |
| Build a fitness tracking application | `saas_dashboard` |
| Build a banking application | `saas_dashboard` |
| Build a crypto portfolio dashboard | `saas_dashboard` |
| Build a restaurant website | `landing_page` |
| Build a travel booking website | `marketing_website` |
| Build a portfolio site for a designer | `portfolio` |
| Build an agency website | `marketing_website` |
| Build an analytics dashboard | `analytics_dashboard` |
| Build an admin panel for managing users | `admin_panel` |

A generic "landing page for an AI startup" deliberately stays
`landing_page` — only an explicit agency/marketing-site/brand-site signal
upgrades a landing-layout request to `marketing_website`, so the word
"startup" alone never causes a misclassification.

### 2. Shared component library (`backend/services/generation/component_library.py`, new)

Six pure, independently-testable component functions, closing the gaps the
existing `components.py` catalog only had *guidance text* for:

- `table(headers, rows)` — a real data table.
- `timeline(items)` — a vertical event timeline with icon dots.
- `calendar_grid(month_label, marked_days, today, ...)` — a real month grid
  with marked/streak days.
- `music_player(track_title, artist, progress_pct, ...)` — album-art block,
  progress bar, transport controls (prev/play/next).
- `notifications_panel(items)` — icon + title/body + time + unread dot.
- `form_fields(fields, submit_label)` — real labeled inputs/textarea/select
  + a submit button.

Each emits a `data-component="..."` attribute for detection/testing, and a
shared `cl.CSS` block (spacing/radius/color all drawn from the existing
design-system tokens — no new visual language). Every renderer that uses
these stays visually cohesive with every other renderer.

### 3. Renderer variants wired into the existing renderers (no new layouts)

- **`dashboard.py`** (the `app` layout): an `admin_panel` variant gets an
  extra **Records** nav page rendered with `table()` (sample data-rich
  records, not another stat-card grid); an `analytics_dashboard` variant
  gets an extra **Insights** nav page whose analytics page body is enriched
  with `timeline()`. The plain `saas_dashboard` variant (the default, and
  what every Sprint 1.9-locked vertical — fitness/banking/crypto/AI-chat —
  resolves to) is **byte-for-byte unaffected** by either addition. Every
  dashboard variant also gets a real, reachable **notifications panel**
  (bell icon → `notifications_panel()`), rendered as a top-level `<main>`
  sibling — not nested inside any per-tab `data-panel` section — so it's
  reachable regardless of which tab is active (the same structural pattern
  Sprint 1.9 used to fix the mobile shell's FAB reveal target).
- **`landing.py`** (the `landing` layout): a `marketing_website` variant
  (agency/brand sites) gets a real **contact form** section (`form_fields()`)
  before the footer — "tell us about your project" instead of a second
  pricing table. The plain `landing_page` variant is unaffected.
- **`mobile.py`** (the `mobile` layout): the **media** vertical (music
  player) now renders the real `music_player()` widget instead of only
  another list row; the **wellness** vertical (habit tracker / meditation)
  now renders a real **streak calendar** (`calendar_grid()`) alongside the
  existing progress ring. Other mobile verticals (food/recipe) are
  unaffected.

### 4. Preview reliability — the two confirmed staleness bugs, fixed

A dedicated frontend audit (every `<iframe srcDoc>` site, every run/
deliverable-switch reset path) found the run-switch and new-run *state*
resets were already correct (`useLiveRun`, `useOrchestrateResult`,
`useRunResult` all clear synchronously before fetching) — the actual bugs
were narrower:

- `src/components/PreviewResult.tsx` — the result iframe had no `key`, so
  switching to a different run/artifact mutated the same DOM node's
  `srcDoc` instead of mounting fresh. **Fixed**: `key={artifact_id ||
  run_id || title}`.
- `src/components/results/DeliverablesViewer.tsx`'s inline preview iframe —
  same issue, plus no signal at all for "this deliverable's content
  changed" (e.g. a re-run). **Fixed**: `key={deliverable.id}-{body.length}`.
- `src/components/DeliverablePreviewModal.tsx` — already keyed on
  `device`/`refreshKey`; added `deliverable.id` + content length as
  belt-and-suspenders so switching deliverables (not just device/refresh)
  also forces a fresh mount.

Every new project run already created a fresh run id and the result hooks
already reset state synchronously on id change — these `key` fixes close the
remaining gap where React could otherwise reuse an iframe DOM node across
two different generated apps.

### 5. Desktop + mobile responsiveness

Enforced by construction (the renderer selector never reassigns `layout`)
and verified by test across all 7 categories: every `saas_dashboard`/
`admin_panel`/`analytics_dashboard`/`landing_page`/`marketing_website`/
`portfolio` prompt never renders `.mb-frame`/`.mb-tabbar` (the phone shell),
and every `mobile_app` prompt never renders `.db-shell`/`.db-sidebar` (the
SaaS sidebar).

### 6. Visual quality — Arc Browser style mode (`styles.py`)

Added a 13th Design Diversity mode, `arc_browser` (warm purple/coral accent
pair, very rounded 22px radius, airy density, gradient background
treatment), explicitly covering the sprint's named reference set (Apple,
Linear, Stripe, Notion, **Arc Browser**, Vercel). Triggered by an explicit
"Arc Browser" keyword — additive, doesn't change any existing mode's
fallback.

### 7. Icon system expansion (`renderers/base.py`)

Six new inline SVG line icons (`prev`/`next`/`send`/`grid`/`music`/`clock`)
added to the existing zero-network icon set, needed by the new component
library (player transport controls, form submit, table/grid affordances).

---

## What was intentionally NOT changed

- The orchestrator pipeline, the blueprint bridge, and every backend route —
  **route count is unchanged at 165**.
- `spec.layout` dispatch and every existing renderer module's *locked*
  behavior — fitness/banking/crypto/AI-chat still render through the plain
  `saas_dashboard` variant of the `app` layout; CRM/todo still never route
  to `mobile`.
- The orchestrator package still never imports/mentions `blueprint_bridge`
  or `product_intelligence` (verified by the same module-boundary test).
- `blueprint=None` is still fully backward compatible — `expand()`'s
  renderer-category choice for an unblueprinted request is identical to a
  blueprinted one when the blueprint adds no new signal.

---

## Verification

- **New tests**: `backend/tests/test_sprint20_universal_renderer.py` — 62
  tests covering the renderer selector (all 9 spec example prompts + edge
  cases), the 6 component-library functions standalone, their wiring into
  the 3 new variants + 2 mobile verticals, desktop/mobile cross-
  contamination across all 7 categories, the Arc Browser style mode, the
  Sprint 1.9-locked vertical/layout guards, the module-boundary contract,
  and blueprint=None backward compatibility.
- **Full backend suite**: `1904 passed, 14 failed (pre-existing/
  environmental — unrelated to this sprint), 6 skipped` — the 14 failures
  are the same baseline documented since Sprint 1.6 (2× a date-injection
  assertion in `test_memory_plane_stream_chat`, 1× an unrelated route-
  scoping test in `test_phaseA2_project_orchestrator`, 11×
  `test_prompt_manager` failing on a missing `google` SDK in this sandbox).
  Confirmed identical failure set before and after this sprint's changes.
- **Route count**: 165 (unchanged from Sprint 1.9).
- **Frontend**: `npx tsc --noEmit -p .` — clean, no errors. `npx eslint`
  and `vite build` could not run in this sandbox (pre-existing npm/registry
  environment issue, documented since Sprint 1.6/1.8 — `vite` itself isn't
  installed in `node_modules/.bin`); the only frontend changes this sprint
  are three `key` prop additions to existing JSX, type-checked clean.
- **Manual smoke test**: every example prompt in the spec rendered, quality-
  scored (`quality.score()` = 100, `is_premium()` = True for all), and
  placeholder-checked across all 7 renderer categories plus every locked
  vertical.

---

## Deployment checklist

- No new environment variables.
- No database/schema migrations.
- No new dependencies (frontend or backend).
- No breaking changes — `ProductSpec.renderer` is a new field with a safe
  default (`""`), `spec.data["variant"]` is additive, and every existing
  artifact-metadata key is preserved (only `renderer_category` was added).
- No new backend routes (165, unchanged).
- Frontend changes are 3 `key`-prop-only diffs to existing components — no
  new components, no new props required from callers.

---

## Sprint summary

| Objective | Status |
|---|---|
| 1. Universal Renderer Selection | ✅ `renderer_selector.py`, 7 categories, verified against all 9 spec examples |
| 2. Premium Design System | ✅ Already mostly complete (Sprint 1.9); this sprint added the icon-set expansion + Arc Browser mode |
| 3. Component Library | ✅ `component_library.py` — Table/Timeline/Calendar/Music Player/Notifications/Forms, wired into 3 variants + 2 mobile verticals |
| 4. Preview Reliability | ✅ 2 confirmed iframe-staleness bugs fixed + 1 belt-and-suspenders hardening |
| 5. Desktop + Mobile Responsiveness | ✅ Verified by construction + explicit cross-category tests |
| 6. Prompt Understanding | ✅ All 9 example prompts route to the correct category |
| 7. Visual Quality Upgrade | ✅ Arc Browser style mode; existing design system already covered the rest |

---

## Recommended next sprint

**Sprint 2.1 — Multi-Page Project Generation.** Every renderer today still
produces a single self-contained HTML document (multiple in-page "panels"
switched by JS, not real navigable pages/routes). A natural next step is
letting the orchestrator's existing multi-file `file_tree` preview renderer
(already supported by `PreviewResult.tsx`/`DeliverablesViewer.tsx`, unused
by generation today) drive a real multi-page project output for the
`saas_dashboard`/`admin_panel`/`marketing_website` categories — without
touching the orchestrator pipeline or breaking the single-file path the
simpler categories (mobile_app/portfolio) can keep using.
