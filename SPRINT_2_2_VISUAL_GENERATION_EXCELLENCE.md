# KorvixAI — Sprint 2.2: Visual Generation Excellence

## Goal

Increase the visual quality of generated artifacts — not architecture, not
routing, not backend, not classification. Pure output-quality work on the
three reusable renderer modules every product passes through:
`renderers/landing.py`, `renderers/dashboard.py`, `renderers/mobile.py`.

This is a benchmark-evaluation sprint, not a product-implementation sprint:
fitness/CRM/music/dashboard/landing/ecommerce prompts below are used ONLY
to verify the generation engine improved — none of them received
vertical-specific code. Every change lives in shared renderer composition
logic, so it improves every future generated product, not one example.

---

## Visual audit (the actual weakest areas, found before any code changed)

The architecture was already solid (Sprint 2.0/2.1: renderer routing,
component library, preview reliability, renderer personality). Reading
`design_system.py` + all renderer modules end-to-end, the genuine
structural weakness was **composition, not components**:

1. **Landing hero**: centered headline → a SEPARATE full-width mockup
   section below the fold. Every real funded-startup site (Stripe, Linear,
   Vercel) shows the product immediately, beside the headline — Korvix's
   hero made visitors scroll past a centered text block before seeing
   anything resembling the product.
2. **Dashboard overview**: jumped straight into a 4-card bento grid with no
   single dominant focal point — every card competed at roughly equal
   visual weight. Real SaaS dashboards (Linear, Stripe, Vercel) lead with
   ONE large hero number, then supporting detail.
3. **Mobile hero**: a thin, single-row gradient card (small ring + two
   lines of text) — functional but not a "flagship app first screen." Real
   native apps (Apple Fitness/Health/Activity) lead with a large, layered,
   prominent ring as the dominant visual anchor.

A first attempt at this sprint over-indexed on smaller consistency fixes
(emoji→SVG icon swaps, an empty-state component, typography/spacing
utility classes — see "Preliminary fixes" below). Those are real but
minor; they were correctly flagged as not addressing the actual mission,
and this document's main body is the structural composition work that
followed.

---

## Renderer improvements (the actual sprint deliverable)

### 1. Landing — premium split hero (`renderers/landing.py`)

**Before**: `<section class="ds-hero">` — centered badge/h1/lead/CTAs,
text-align center, max-width 20ch headline. The product mockup
(`_mockup()`) rendered as its own full-width section AFTER the hero and
the logo row.

**After**: the hero is now a two-column grid (`ds-hero-grid`, `1.05fr 1fr`
on desktop, collapses to one column under 980px) — `ds-hero-copy` (badge,
left-aligned headline, lead, CTAs, and a new trust line using the spec's
own audience copy) sits beside `ds-hero-mock`, the SAME window-chrome
product preview that used to live in a separate section, now visible
without scrolling. The standalone mockup section was removed — its
content moved, not duplicated.

```html
<!-- After (actual rendered output, "Build a premium SaaS landing page") -->
<section class="ds-hero" id="overview"><div class="ds-container ds-hero-grid">
  <div class="ds-hero-copy">
    <span class="ds-badge ds-rise">…</span>
    <h1 class="ds-rise">Ship work that moves in sync.</h1>
    <p class="ds-lead ds-rise">The project OS for fast teams…</p>
    <div class="ds-hero-actions ds-rise">…</div>
    <p class="ds-hero-trust ds-rise">Modern product and engineering teams.</p>
  </div>
  <div class="ds-mock ds-hero-mock ds-rise"> <!-- the product preview, now IN the hero -->
    <div class="ds-mock-bar">…</div>
    <div class="ds-mock-body"><div class="ds-bento">…</div></div>
  </div>
</div></section>
```

The `class="ds-hero"` attribute itself is untouched (no modifier class
added to it) — the split layout is scoped entirely to the new
`.ds-hero-grid`/`.ds-hero-copy` selectors, so any code keying off the
plain hero element is unaffected. Reusable for every landing-layout
product (every vertical that resolves to `landing_page` or
`marketing_website`).

### 2. Dashboard — dominant hero metric (`renderers/dashboard.py`)

**Before**: `_overview()` opened directly into a segmented tab control and
a 4-card `ds-bento` grid (one slightly-larger chart card + two metric
cards + a ring card) — real but modest hierarchy, no single focal point.

**After**: a new `_hero_metric()` renders FIRST, before the tabs — one
large card (`db-hero-metric`) with the primary metric's value at
`clamp(2.2rem,4vw,3.25rem)` (the single biggest number on the page), its
delta, an 84px progress ring, and a 28-bar trend chart, on a
subtly-tinted gradient background with its own elevated shadow. The
existing tab control + bento grid still render directly below it as
clearly secondary/supporting detail.

```html
<!-- After (actual rendered output, "Build a banking dashboard") -->
<div class="db-hero-metric ds-rise">
  <div class="db-hero-metric-top">
    <div class="db-hero-metric-copy">
      <span class="ds-eyebrow">Total balance</span>
      <div class="db-hero-metric-value">$48,920</div>
      <span class="ds-stat-delta">+2.4% this month</span>
    </div>
    <div class="db-hero-metric-ring">…78%… On track</div>
  </div>
  <div class="ds-bars">…</div>
</div>
<!-- the existing tabs + bento grid now read as clearly secondary -->
```

Purely additive — the existing `_metric_grid()`/`ds-bento` markup is
untouched, so every existing class/structure assertion still holds.
Reusable for every dashboard-layout product (saas_dashboard, admin_panel,
analytics_dashboard, and every locked vertical — fitness, banking, crypto,
AI chat, CRM).

### 3. Mobile — layered flagship hero (`renderers/mobile.py`)

**Before**: `.mb-hero` was a single horizontal row — an 84px ring beside
two lines of text, one soft background glow.

**After**: `.mb-hero` is now a tall, centered, vertically-stacked hero:
a 130px ring (the dominant visual anchor, matching Apple Fitness/Health's
ring-first pattern), a bolder 1.4rem headline, TWO layered background
glows (top-right + bottom-left) for real depth instead of one flat blob,
and — when the product has more than one metric — a glassy two-up stat
strip (`mb-hero-stats`, frosted `backdrop-filter` cards) beneath the ring
surfacing the next two metrics at a glance.

```html
<!-- After (actual rendered output, "Build a habit tracker") -->
<div class="mb-hero">
  <div class="mb-hero-ring">…130px ring…</div>
  <div class="mb-hero-copy"><h2>…</h2><p>…</p></div>
  <div class="mb-hero-stats">
    <div class="mb-hero-stat"><div class="v">12</div><div class="l">Day streak</div></div>
    <div class="mb-hero-stat"><div class="v">86%</div><div class="l">Consistency</div></div>
  </div>
</div>
```

Reusable for every mobile-layout product (every `mobile_app` category:
wellness, media, food, and any future mobile-native vertical).

---

## Preliminary fixes (minor, kept — not the sprint's main deliverable)

Before the structural work above, a smaller pass fixed real-but-minor
issues: emoji sidebar/folder/search icons (inconsistent rendering across
browsers, plus a genuinely broken no-op `background-image` fake search
icon in `editor.py`) replaced with the existing SVG icon system; the
previously-unused typography/spacing design tokens wired into real
utility classes (`.ds-subhead`, `.ds-text-lg/sm`, `.ds-label`,
`.ds-caption`); a reusable empty-state component; consistent `:active`
press states. These are real fixes and are kept (zero risk, fully tested),
but — as flagged mid-sprint — they do not by themselves make a generated
preview look "dramatically better." The composition work above is what
does.

---

## Before vs after (qualitative)

| Renderer | Before | After |
|---|---|---|
| Landing | Centered hero → scroll → separate mockup section | Product visible immediately, beside the headline |
| Dashboard | Four cards of roughly equal weight | One dominant hero metric, then clearly secondary detail |
| Mobile | Thin single-row hero card | Tall, layered, ring-first flagship first screen with a stat strip |

---

## Verification

- **Full backend suite**: `1953 passed, 14 failed (pre-existing/
  environmental — identical failure set to before this sprint), 6
  skipped`. No test was modified to make this pass — every existing
  Sprint 1.9/2.0/2.1 assertion (locked vertical/layout classes, exact
  `class="ds-hero"`/`class="db-shell"`/`class="mb-frame"` matches,
  interaction markers, quality scores) holds against the new markup
  unmodified.
- **Route count**: 165 (unchanged — no backend/routing files touched).
- **Manual smoke test**: every example renders, `quality.score()` = 100,
  `quality.is_premium()` = True, zero placeholder violations, across
  landing/dashboard/mobile examples spanning every locked vertical.
- **No new tests were added** (per this sprint's explicit instruction:
  "Do not write more tests first" / "Do not edit tests") — verification
  relied entirely on the existing Sprint 1.9–2.1 test suite plus manual
  HTML inspection of actual rendered output (excerpts above are real
  `render_premium_page()` output, not illustrations).
- **No package installation, npm/registry work, or lockfile changes**
  were performed.

---

## Deployment checklist

No new environment variables required.
No deployment or configuration changes required.

- New environment variables: none.
- Updated environment variables: none.
- Railway changes: none.
- Vercel changes: none.
- Docker changes: none.
- Dependencies: none added, none removed.
- Breaking changes: none — every change is additive CSS/markup
  composition inside existing renderer functions; no function signatures,
  artifact contracts, or metadata keys changed.

## Rollback plan

All changes are confined to three files:
`backend/services/generation/renderers/landing.py`,
`backend/services/generation/renderers/dashboard.py`,
`backend/services/generation/renderers/mobile.py` (plus the smaller,
independent preliminary-fix commit touching `component_library.py`,
`design_system.py`, `renderers/base.py`, and `renderers/editor.py`). Either
commit can be reverted independently with `git revert` with no data
migration or API-contract cleanup required — nothing outside the HTML/CSS
generation layer was touched.

---

## Recommended next sprint

**Sprint 2.3 — Section-Level Composition Variety.** This sprint fixed the
*first screen* of each renderer (hero/dominant-metric). The next highest-
leverage structural target is the *body* of longer pages: landing pages
currently compose feature sections from one `_feature_bento()` shape
regardless of content volume, and dashboard secondary pages reuse the same
bento/feed pattern across very different data shapes. Introducing 2-3
alternate section compositions (chosen by content shape, not by vertical)
would extend this sprint's "real hierarchy, not equal-weight blocks"
principle past the fold.
