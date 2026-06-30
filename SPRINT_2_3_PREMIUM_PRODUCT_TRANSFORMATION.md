# KorvixAI — Sprint 2.3: Premium Product Transformation

## Goal

Per `DESIGN_PHILOSOPHY.md` and `CLAUDE.md` (both read before this sprint):
dramatically increase the perceived quality of generated products through
composition, hierarchy, and product-specific personality — not icons,
tokens, or helper utilities. Sprint 2.2 already rebuilt the hero/first-
screen of landing, dashboard, and mobile. This sprint targets the two
renderer categories `DESIGN_PHILOSOPHY.md` calls out by name that those
prior sprints left untouched: **Portfolios** and **Admin / Productivity
Tools**.

---

## 1. Portfolio renderer — full hero + showcase rewrite (`renderers/portfolio.py`)

### What was wrong

The portfolio renderer hadn't been touched since its original Sprint
"CRITICAL REBUILD" baseline — none of Sprint 1.9/2.0/2.1/2.2's visual work
reached it. Against `DESIGN_PHILOSOPHY.md`'s explicit portfolio checklist
("strong hero identity," "project showcase," "visual storytelling," "avoid
generic resume pages"):

- The hero was **text only** — eyebrow, headline, lead, two buttons. No
  visual identity, no connection to actual work. A visitor saw a wall of
  text before any sense of what the person/studio actually makes.
- The project grid was **four equal-weight cards** — exactly the "equal-
  weight card grid" anti-pattern the philosophy doc calls out by name.

### What changed (full rewrite, not a patch)

**Asymmetric identity hero** — a two-column split: headline/lead/CTAs on
the left, a real **featured-project preview** on the right (full-bleed
gradient art, a tag chip, the project title/blurb, a hover-reveal arrow).
The hero now tells a story instead of showing isolated text — the first
thing a visitor sees IS the work, not a promise of it below the fold.

```html
<!-- Actual rendered output, "Build a portfolio site for a designer" -->
<section class="pf-hero ds-container"><div class="pf-hero-grid">
  <div class="pf-hero-copy">
    <span class="ds-eyebrow">Clients and collaborators evaluating recent work.</span>
    <h1>Design that earns attention.</h1>
    <p>A portfolio — selected work, a short story, and a clear way to get in touch.</p>
    <div class="ds-hero-actions pf-hero-actions">…</div>
  </div>
  <article class="pf-hero-feature ds-rise" data-select>
    <div class="pf-hero-feature-art" style="background:linear-gradient(…)"></div>
    <span class="pf-hero-feature-arrow">↗</span>
    <div class="pf-hero-feature-body">
      <span class="pf-hero-feature-tag">Product</span>
      <h3>Northwind</h3>
      <p>Brand &amp; product design for a logistics startup.</p>
    </div>
  </article>
</div></section>
```

**Asymmetric project showcase** — the grid below no longer repeats four
identical tiles. The lead remaining project spans the full row at a wide
21:9 aspect ratio with larger type; the rest sit in a normal supporting
grid (`.pf-grid .pf-work:first-child { grid-column:1/-1; }`). Every
project tile now also carries a category tag chip (Product/Brand/Web/
Visual/…) for real visual storytelling instead of bare gradient blocks.
The featured project shown in the hero is never repeated in the grid
(the grid renders `projects[1:]`).

The locked structural contract (`class="pf-hero` — prefix-matched,
confirmed in `test_renderers_rebuild.py`) is preserved exactly.

---

## 2. Admin / Productivity — dense, scannable, filterable (`renderers/dashboard.py` + `component_library.py`)

### What was wrong

`DESIGN_PHILOSOPHY.md` separates Admin/Productivity from generic
dashboards explicitly: "dense layouts, clear tables, filters, command
actions, status indicators... avoid oversized empty dashboards." The
Sprint 2.0 admin_panel variant was a single extra nav tab with a plain
table — no filters, no command bar, no status indicators (status was
plain text), nothing "dense" or "scannable" about it.

### What changed

A new reusable **`toolbar()` component** (`component_library.py`) — a
real search input + filter chips — wired into the interaction script that
**already existed** for the ecommerce renderer's `data-search`/
`data-filter`/`data-category` attributes. No new JavaScript was written;
this is the same shared script every renderer already loads, now reused
for a second, completely different surface. `table()` gained an optional
`row_attrs` callback so any caller can attach the `data-category`/
`data-searchable` attributes a filterable table needs — a genuinely
reusable extension, not a one-off hack for this page.

The admin records page now renders real color-coded `status_pill()` chips
(green/amber/red) instead of plain text, plus a row-count caption for
scanability:

```html
<!-- Actual rendered output, "Build an admin panel for managing users" -->
<div class="cl-toolbar" data-component="toolbar">
  <label class="cl-toolbar-search"><svg>…</svg>
    <input type="text" placeholder="Search records…" data-search></label>
  <div class="cl-toolbar-filters">
    <span class="ds-chip is-active" data-filter="all">All</span>
    <span class="ds-chip" data-filter="active">Active</span>
    <span class="ds-chip" data-filter="invited">Invited</span>
    <span class="ds-chip" data-filter="suspended">Suspended</span>
  </div>
</div>
<p class="cl-table-caption">6 records</p>
<table class="cl-table">…
  <tr data-category="active" data-searchable="ava chen owner active">
    <td>Ava Chen</td><td>Owner</td>
    <td><span class="cl-pill cl-pill-positive">Active</span></td>
    <td>1h ago</td>
  </tr>…
```

Typing in the search box or clicking a status chip **actually filters the
visible rows** in the rendered preview — this is functional, not
decorative, because it reuses the existing shared script's filter logic
verbatim.

---

## Why these are visibly better (not just technically changed)

- **Portfolio**: previously a visitor had to scroll past pure text to see
  any actual work. Now the work IS the hero — the single biggest
  "feels designed, not templated" signal this category can have. The
  showcase grid no longer reads as four interchangeable boxes.
- **Admin panel**: previously a bare table with plain-text status looked
  like an HTML `<table>` tutorial. Now it has the unmistakable shape of a
  real internal tool — search, filter chips, color-coded status, a record
  count — and the filtering actually works in the preview.
- Both changes are **reusable renderer/component logic**, not prompt-
  specific: every future portfolio-category generation gets the
  asymmetric hero+showcase; every future admin_panel-variant generation
  (any product whose request implies an admin/back-office tool) gets the
  toolbar+filtering+status-pill treatment automatically.

---

## Reusable improvements (affect every future generation in category)

- `component_library.toolbar()` — new, reusable wherever a dense
  list/table needs search+filter (not limited to admin panels).
- `component_library.table(..., row_attrs=...)` — extended, reusable by
  any future renderer needing a filterable table.
- `renderers/portfolio.py` — every portfolio-category generation now gets
  the asymmetric identity hero and showcase grid, regardless of the
  specific prompt.
- `renderers/dashboard.py` `_records_page()` — every admin_panel-variant
  generation gets the command bar + status pills.

---

## Renderer files changed

1. `backend/services/generation/renderers/portfolio.py` — hero + project
   showcase fully rewritten (130 lines changed).
2. `backend/services/generation/component_library.py` — new `toolbar()`
   component, `table()` extended with `row_attrs`.
3. `backend/services/generation/renderers/dashboard.py` — `_records_page()`
   rebuilt to use the new toolbar + status pills + row filtering.

No other renderer, no orchestrator, no backend route, no test was
modified.

---

## Verification

- **Full backend suite**: `1953 passed, 14 failed (pre-existing/
  environmental — identical failure set to every prior sprint), 6
  skipped`. Zero tests were modified to make this pass; the one locked
  portfolio structural assertion (`class="pf-hero` prefix match) holds
  against the rewritten markup unmodified.
- **Route count**: 165 (unchanged).
- **Manual rendered-HTML verification** (excerpts above are real
  `render_premium_page()` output, not illustrations): "Build a portfolio
  site for a designer" and "Build an admin panel for managing users" both
  inspected directly; quality score 100/100, zero placeholder violations
  on both.
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
- Breaking changes: none — `table()`'s new `row_attrs` parameter is
  optional and defaults to no-op; every other component/renderer function
  signature is unchanged.

## Rollback plan

All changes are confined to three files (`renderers/portfolio.py`,
`renderers/dashboard.py`, `component_library.py`). `git revert` of this
sprint's commit is sufficient — no data migration, no API-contract
cleanup, nothing outside the HTML/CSS generation layer was touched.

---

## Recommended next sprint

**Sprint 2.4 — Landing body composition.** Sprint 2.2's recommendation
still stands: the landing page's feature/body sections (`_feature_bento()`
and friends) compose the same shape regardless of content volume.
Combined with this sprint's portfolio/admin work, the remaining
DESIGN_PHILOSOPHY-named category not yet revisited end-to-end is the
**ecommerce/booking renderers** — worth a dedicated audit against the same
"composition over equal-weight grids" standard applied here.
