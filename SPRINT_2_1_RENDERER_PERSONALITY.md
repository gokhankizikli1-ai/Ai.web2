# KorvixAI — Sprint 2.1: Renderer Personality & Premium Visual Quality Recovery

## Goal

Sprint 2.0 added a Universal Renderer Selector, a shared component
library, and renderer routing — but introduced a visible quality
regression: some outputs read as flat, gray, generic, and a class of
prompts (habit tracker, music player, …) never reached an interactive
prototype at all. This sprint is a pure recovery-and-exceed pass: no new
features, no backend API changes, no new dependencies.

---

## Regression analysis (the audit, before any code changed)

Two independent investigations were run before writing any code:

1. **The generation-layer (HTML output) audit** — direct rendering +
   structural diff of `renderers/mobile.py`/`dashboard.py`/
   `component_library.py` between the Sprint 1.9 baseline (`0f174aa`) and
   the Sprint 2.0 merge (`1c8ad9d`).
2. **A dedicated Explore-agent audit of `backend/services/orchestrator/
   templates/catalog.py`** — the layer ABOVE generation that decides which
   *workflow template* (and therefore which deliverable kinds) a project
   run produces.

### Root cause #1 — orchestrator template routing (the critical bug)

`choose_template()` in `orchestrator/templates/catalog.py` picks the
`app_prototype` template (the one that actually produces an
`app_prototype_html` deliverable) only when the request matches `_APP_HINT`
— a regex requiring the literal word **"app"** or a narrow synonym list
(dashboard/saas/crm/game/mobile/ui/…). **"Build a habit tracker" and
"Build a music player" contain none of those words**, so they fell through
to `_CREATION_HINT` → the **`generic_creation`** template, which only
produces markdown nodes (creative_brief / copy_draft / design_concept /
final_package) — **no interactive HTML prototype at all**. This predates
both Sprint 1.9 and Sprint 2.0 (confirmed via `git log -p` — neither sprint
touched `orchestrator/templates/`), but it's exactly the behavior the
Sprint 2.1 spec calls out, and it's the reason those two specific example
prompts "regressed" in the user's testing even though the generation
engine itself never saw them.

### Root cause #2 — flat, undifferentiated component CSS (the visual regression)

Sprint 2.0's `component_library.py` introduced new shared components
(table, calendar, music player, notifications) styled with **flat
`var(--surface-2)` fills** for their "inactive"/"empty" states:

- The habit-tracker streak `calendar_grid()` rendered **30 small square
  cells**, ~18 of them a flat solid gray fill — at mobile-frame width this
  reads exactly as "generic gray-box grid," the headline complaint.
- The admin-panel `table()` and dashboard metric cards used plain text
  pairs with no accent treatment, so a "premium" dashboard and a default
  HTML table looked nearly identical.
- Every renderer category (mobile_app, saas_dashboard, landing_page, …)
  composed the **same generic shape** regardless of product type —
  Sprint 2.0 delivered renderer *routing* but not renderer *personality*.

Mobile-shell quality itself was **not** regressed structurally — Sprint
2.0's mobile.py diff was purely additive (the music/calendar widgets were
added, nothing was removed from the Sprint 1.9 hero/metric/list/actions
composition). The "previous premium mobile prototype look was lost"
perception traces to the new widgets themselves looking flatter than the
rest of the shell, not to any deletion.

---

## What was improved

### 1. Orchestrator routing fix (`orchestrator/templates/catalog.py`)

A product NOUN (`tracker`/`player`/`planner`/`organizer`) paired with an
explicit BUILD verb (`build`/`create`/`design`/`make`/`generate`/`develop`/
`produce`) now routes to `app_prototype`, checked **after** the research
hint so a genuinely research-flavored ask ("research the best fitness
trackers") still goes to research, and a content-writing ask ("write a
journal entry") isn't hijacked (the noun-hint gate requires a *build* verb
specifically, not the broader creation-hint verb list that includes
"write"/"draft").

```
"Build a habit tracker"              → app_prototype   (was generic_creation)
"Build a music player"               → app_prototype   (was generic_creation)
"Build a workout planner"            → app_prototype   (was generic_creation)
"Build a crypto portfolio tracker"   → app_prototype   (was generic_creation)
"Research the best fitness trackers" → generic_research (unaffected)
"Write a journal entry about my day" → generic_creation (unaffected)
"Build a fitness app"                → app_prototype   (unaffected, already worked)
```

### 2. Component library: gradient/pill accents replace flat fills (`component_library.py`)

- **`calendar_grid()`** rebuilt as a row of small premium **pills**, not
  squares: unmarked days are a thin outline (`background:transparent`),
  marked days get the brand gradient + glow, "today" gets an inset accent
  ring — plus an optional streak-count badge (`cl-streak-badge`) above the
  grid so the habit/wellness vertical leads with "12 day streak," not a
  bare grid.
- **`status_pill()`** (new) — a small colored positive/negative/warning
  chip, used everywhere a row used to show plain, undifferentiated text
  (table cells, watchlist gain/loss, metric-card deltas).
- **`premium_metric_card()`** (new) — a gradient-badge icon + bold value +
  colored delta pill, replacing the plain label/value/delta stack used by
  every dashboard's overview side cards.
- **`waveform()`** (new) — a static equalizer-style bar visual, the
  leading N bars rendered in the brand gradient (elapsed) — wired into
  `music_player()` so the media vertical feels media-first, not just
  another card.
- **`watchlist_row()` / `portfolio_card()`** (new) — ticker rows with a
  colored gain/loss pill, and a gradient allocation-bar card — the
  crypto/finance vertical's defining "analytical" personality.
- **`recipe_steps()` / `ingredient_chips()` / `food_panel()`** (new) — a
  CSS-gradient "food panel" hero (no external images), chip-style
  ingredients, numbered gradient-badge prep steps — the food vertical's
  warm/editorial personality (this vertical had no distinct visual
  treatment before this sprint).
- **`action_card()`** (new, `tone="calm"`) — a soft, rounded,
  gradient-tinted card used for the wellness vertical's breathing/session
  prompt.

All additive — `table()`/`timeline()`/`notifications_panel()`/
`form_fields()`/`music_player()` keep their existing call signatures
(`table()` gained an opt-in `escape_cells` flag; everything else
unchanged).

### 3. Renderer personality wired into the existing renderers

No new layouts, no new renderer modules — personality is composed INSIDE
the existing `mobile.py`/`dashboard.py` using `spec.product_type`, the same
pattern Sprint 2.0 used for the admin_panel/analytics_dashboard variants:

| Vertical | Layout | New personality |
|---|---|---|
| Wellness (habit/meditation) | `mobile` | Redesigned streak calendar + streak badge + a calm `action_card` "Start a session" prompt; `mb-personality-wellness` CSS (gentler radius, more breathing room) |
| Media (music player) | `mobile` | `music_player()` now includes a `waveform()` equalizer; `mb-personality-media` CSS (darker, dramatic hero gradient) |
| Food (recipe app) | `mobile` | Entirely new: CSS-gradient food panel + ingredient chips + numbered recipe steps, in place of a generic list; `mb-personality-food` CSS |
| Fitness | `app` (dashboard) | A "Training timeline" (`cl.timeline()`) appended to the Progress page; premium metric cards; `db-personality-fitness` CSS (gradient badge, ring glow) |
| Crypto/finance | `app` (dashboard) | A Watchlist (`watchlist_row()`) + Portfolio allocation (`portfolio_card()`) panel replaces a second generic activity feed in the Overview; `db-personality-finance` CSS |
| Every dashboard vertical | `app` | Overview side stat cards upgraded to `premium_metric_card()` (gradient icon badge + colored delta pill) |
| Admin Panel / Analytics Dashboard / Marketing Website | `app` / `landing` | Unchanged from Sprint 2.0 (table/timeline/contact-form variants) — already distinct, not part of this sprint's regression |

Every personality class is added to a NEW wrapping element (`mb-shell`
gets the personality class, `mb-frame`'s own `class="mb-frame"` attribute
is untouched; dashboard gets a new outer wrapper around `db-shell`) —
**no locked exact-match class assertion was touched.**

### 4. Preview reliability — untouched, re-verified

No frontend files were changed this sprint. The Sprint 2.0 `key`-prop
fixes (`PreviewResult.tsx`, `DeliverablesViewer.tsx`,
`DeliverablePreviewModal.tsx`) are still in place — verified by a new
regression-guard test that reads those three files and asserts the key
expressions are still present, so a future sprint can't silently revert
them.

---

## What was intentionally NOT changed

- The orchestrator pipeline beyond the two new regexes in
  `choose_template()` — no node/template structure changes, no new
  templates, no new deliverable kinds.
- The intent CLASSIFIER (`backend/services/generation/intent.py`) and its
  ecommerce/website disambiguation — `"shop"` still routes to the
  `ecommerce` layout ahead of `website`/`landing` (pre-existing, untouched;
  see Known Limitations).
- Every Sprint 1.9/2.0-locked vertical/layout constraint — fitness/
  banking/crypto/AI-chat still render through the plain dashboard shell;
  CRM/todo still never route to `mobile`; the orchestrator package still
  never imports/mentions `blueprint_bridge`/`product_intelligence`.
- No npm/package installation was attempted (per the sprint's explicit
  tooling rule) — no frontend files were touched, so no typecheck/build
  was needed this sprint.

---

## Benchmark prompts (Sprint 2.1 §8)

| # | Prompt | Renderer category | Layout (mobile/desktop) |
|---|---|---|---|
| 1 | Build a meditation app | `mobile_app` | mobile ✓ |
| 2 | Build a habit tracker | `mobile_app` | mobile ✓ |
| 3 | Build a music player | `mobile_app` | mobile ✓ |
| 4 | Build a recipe app | `mobile_app` | mobile ✓ |
| 5 | Build a fitness app | `saas_dashboard` | desktop ✓ |
| 6 | Build a CRM dashboard | `saas_dashboard` | desktop ✓ |
| 7 | Build a crypto trading dashboard | `saas_dashboard` | desktop ✓ |
| 8 | Build a finance analytics dashboard | `analytics_dashboard` | desktop ✓ |
| 9 | Build a landing page for an AI startup | `landing_page` | desktop ✓ |
| 10 | Build a website for a coffee shop | `marketing_website`* | desktop ✓ |

\* Prompt #10 classifies as the `ecommerce` *layout* (pre-existing
classifier behavior — "shop" is a strong ecommerce signal used by several
already-locked tests, e.g. "Build an online clothing store") which the
renderer-category mapping labels `marketing_website`. See Known
Limitations.

Every prompt: correct renderer category, an interactive prototype artifact
(verified via `choose_template()` → `app_prototype`/`landing_page`, never
`generic_creation`), product-specific components present, quality score
≥ 90 and placeholder-free, and the correct desktop/mobile shell (mobile
prompts never render `db-shell`; desktop prompts never render `mb-frame`).

---

## Before / after behavior

| Prompt | Before (Sprint 2.0) | After (Sprint 2.1) |
|---|---|---|
| "Build a habit tracker" | `generic_creation` — markdown brief only, **no interactive prototype** | `app_prototype` — phone-shell prototype with streak calendar + calm session card |
| "Build a music player" | `generic_creation` — markdown brief only | `app_prototype` — phone-shell prototype with waveform-driven player |
| Habit tracker streak grid | 30 flat gray squares | Pill-shaped grid, gradient-filled marked days, streak badge |
| Dashboard overview stat cards | Plain label/value/delta text | Gradient icon badge + colored delta pill (`premium_metric_card`) |
| Crypto dashboard | Generic activity feed, same shape as banking | Watchlist + portfolio allocation panel (analytical personality) |
| Recipe app | Generic list rows | Gradient food panel + ingredient chips + numbered steps |

---

## Verification

- **New tests**: `backend/tests/test_sprint21_renderer_personality.py` —
  49 tests covering the orchestrator routing fix (and its research/content
  false-positive guards), every vertical's personality components, the
  premium-metric-card upgrade across all dashboard verticals, the
  redesigned calendar's non-flat styling, all 9 testable benchmark
  prompts (renderer category + layout + quality + routing), the locked
  Sprint 1.9/2.0 vertical/layout/module-boundary contract, and a
  regression guard on the Sprint 2.0 preview-reliability `key` fixes.
- **Full backend suite**: `1953 passed, 14 failed (pre-existing/
  environmental — identical failure set to before this sprint), 6
  skipped`.
- **Route count**: 165 (unchanged — no backend routes touched).
- **Frontend**: no `.ts`/`.tsx` files changed this sprint — typecheck/
  build were not re-run (nothing to verify); the preview-reliability
  regression-guard test reads the files directly to confirm Sprint 2.0's
  fixes are intact.
- **Manual smoke test**: every benchmark prompt rendered, quality-scored
  (`quality.score()` = 100, `is_premium()` = True for all 10), and
  inspected structurally for the expected `data-component="..."` markers
  per vertical.
- **No package installation, npm/registry work, or lockfile changes** were
  performed, per the sprint's explicit tooling rule.

---

## Known limitations

- "Build a website for a coffee shop" classifies as the `ecommerce`
  *layout* (renderer category `marketing_website`) rather than the plain
  `landing` layout, because the existing intent classifier's `"shop"`
  keyword is checked before its `"website"` keyword — a pre-existing
  classifier ordering this sprint did not touch (re-ordering it risks
  several already-locked ecommerce tests, e.g. "Build an online clothing
  store"). The output is still a real, interactive, premium prototype —
  just with cart/storefront framing instead of a marketing page.
- CRM/SaaS Dashboard's "pipeline cards" (named in the spec's personality
  examples) were not added as a distinct new component this sprint — the
  generic `saas_dashboard` variant's existing sidebar/topbar/metrics/
  table/activity-feed composition (Sprint 2.0) plus this sprint's
  premium-metric-card upgrade was judged sufficient; no specific user
  complaint identified CRM/SaaS Dashboard as regressed.
- The `_APP_NOUN_HINT` keyword list (`tracker`/`player`/`planner`/
  `organizer`) is intentionally narrow to avoid false positives (e.g.
  "write a player profile"); broader natural-language build-intent
  detection is a candidate for a future sprint if more product nouns turn
  up missing app-prototype routing.

---

## Deployment checklist

No new environment variables required.
No deployment or configuration changes required.

1. New environment variables: none.
2. Updated environment variables: none.
3. Deprecated environment variables: none.
4. Railway changes: none.
5. Vercel changes: none.
6. Docker changes: none.
7. DB migrations: none.
8. New dependencies: none (no npm/pip packages added).
9. Breaking changes: none — `table()`'s new `escape_cells` parameter
   defaults to its prior (escaping) behavior; every other component
   function signature is either unchanged or newly added.
10. Manual deployment steps: none.
11. Rollback plan: revert this sprint's 4 modified files
    (`backend/services/generation/component_library.py`,
    `backend/services/generation/renderers/dashboard.py`,
    `backend/services/generation/renderers/mobile.py`,
    `backend/services/orchestrator/templates/catalog.py`) — all changes
    are additive/internal to the generation+orchestrator-routing layer,
    no data migrations or API contracts were touched, so a plain `git
    revert` of the merge commit is sufficient with no follow-up cleanup.

---

## Sprint summary

- **Files added**: 1 (`backend/tests/test_sprint21_renderer_personality.py`, 235 lines) + this doc.
- **Files modified**: 4 — `component_library.py`, `renderers/dashboard.py`,
  `renderers/mobile.py`, `orchestrator/templates/catalog.py`.
- **Files deleted**: 0.
- **Lines added/removed** (modified files): +377 / −43.
- **Tests added**: 49 (`test_sprint21_renderer_personality.py`).
- **Tests updated**: 0 (no existing test assertions changed — all 184
  generation tests + 45 orchestrator tests from Sprints 1.9/2.0 pass
  unmodified).
- **User-visible impact**: "Build a habit tracker" and "Build a music
  player" (and any product-noun + build-verb prompt) now produce a real,
  interactive prototype instead of a markdown brief. Every generated
  prototype — mobile and desktop — has a visibly richer, gradient/pill-
  accented component treatment instead of flat gray fills, and 5 verticals
  (wellness, media, food, fitness, crypto/finance) now have a distinct,
  product-appropriate visual personality.
- **Known limitations**: see above (coffee-shop website → ecommerce
  layout; CRM pipeline cards not added; narrow app-noun keyword list).
- **Quality benchmark results**: all 10 benchmark prompts score 100/100 on
  the internal quality heuristic, zero placeholder violations, correct
  renderer category and desktop/mobile mode for all 10.

---

## Recommended next sprint

**Sprint 2.2 — Multi-Page Project Generation** (carried over from Sprint
2.0's recommendation, still the natural next step): every renderer still
produces a single self-contained HTML document. Driving the orchestrator's
existing (currently unused by generation) multi-file `file_tree` preview
renderer for the `saas_dashboard`/`admin_panel`/`marketing_website`
categories would let those product types ship a real multi-page project
structure without touching the orchestrator pipeline or breaking the
single-file path the simpler categories (mobile_app/portfolio) can keep
using.
