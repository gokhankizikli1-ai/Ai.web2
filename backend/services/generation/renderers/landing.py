# coding: utf-8
# CRITICAL REBUILD — premium SaaS landing renderer.
#
# A funded-startup marketing page: sticky nav, large gradient hero with a
# product mockup, social-proof logo row, a bento feature grid, a product
# preview, pricing tiers, testimonials, an FAQ accordion, a CTA band and a
# rich footer. Nav smooth-scrolls / highlights.

from __future__ import annotations

from backend.services.generation import component_library as cl
from backend.services.generation.renderers import base
from backend.services.generation.renderers.base import avatar, bars, e, feature_items, icon, slug, spark
from backend.services.generation.spec import ProductSpec, Section

CSS = """
/* ── Landing extras ── */
.ds-mock { border:1px solid var(--border-strong); border-radius:var(--radius-lg); overflow:hidden;
  background:var(--bg-2); box-shadow:var(--shadow-lg); max-width:1000px; margin:0 auto; }
.ds-mock-bar { display:flex; gap:7px; align-items:center; padding:12px 16px; border-bottom:1px solid var(--border); background:var(--surface); }
.ds-mock-bar i { width:11px; height:11px; border-radius:9999px; background:var(--text-dim); opacity:.5; }
.ds-mock-body { padding:22px; }
.ds-logos { display:flex; flex-wrap:wrap; gap:14px 44px; align-items:center; justify-content:center; opacity:.7; }
.ds-logo { font-weight:750; font-size:1.1rem; letter-spacing:-.02em; color:var(--text-muted); }
.ld-plan-price { font-size:2.6rem; font-weight:780; letter-spacing:-.03em; }
.ld-faq { display:grid; gap:12px; max-width:780px; margin:0 auto; }
.ld-faq details { cursor:pointer; }
.ld-faq summary { font-weight:650; color:var(--text); list-style:none; display:flex; justify-content:space-between; align-items:center; }
.ld-faq summary::-webkit-details-marker { display:none; }
.ld-faq summary::after { content:'+'; color:var(--accent-2); font-size:1.3rem; font-weight:600; }
.ld-faq details[open] summary::after { content:'–'; }
.ld-testi-stars { color:var(--accent-2); font-size:1.05rem; letter-spacing:2px; }

/* ── Split hero (Sprint 2.3) ──
   Premium two-column hero: left-aligned copy, right visual with depth
   (glow + tilted mockup + floating stat chip). Collapses to a single
   centered column on narrow viewports. Scoped to landing only — new
   `ld-hero*` classes, no changes to the shared `.ds-hero*` rules other
   renderers reuse. */
.ld-hero { position:relative; overflow:hidden; padding:clamp(92px,13vw,156px) 0 clamp(64px,9vw,100px); }
.ld-hero::before { content:''; position:absolute; inset:-35% -10% auto 10%; height:640px; z-index:-1;
  background:radial-gradient(46% 60% at 70% 10%, color-mix(in srgb, var(--accent) 30%, transparent), transparent 72%); }
.ld-hero-grid { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1.08fr);
  gap:clamp(36px,6vw,84px); align-items:center; }
.ld-hero-copy { text-align:left; }
.ld-hero-copy h1 { margin:22px 0 18px; max-width:15ch; text-align:left; }
.ld-hero-copy .ds-lead { text-align:left; max-width:46ch; margin:0 0 34px; }
.ld-hero-actions { justify-content:flex-start; }
.ld-btn-arrow { display:inline-flex; align-items:center; gap:8px; }
.ld-btn-arrow svg { width:16px; height:16px; transition:transform var(--t) var(--ease); }
.ld-btn-arrow:hover svg { transform:translateX(3px); }
.ld-hero-proof { display:flex; align-items:center; gap:14px; margin-top:40px; color:var(--text-dim); font-size:.85rem; }
.ld-avatars { display:flex; flex:0 0 auto; }
.ld-avatars span { width:30px; height:30px; border-radius:9999px; margin-left:-9px; background:var(--grad);
  border:2px solid var(--bg); box-shadow:var(--shadow-sm); }
.ld-avatars span:first-child { margin-left:0; }
.ld-hero-visual { position:relative; }
.ld-hero-glow { position:absolute; inset:-18% -14%; z-index:-1; filter:blur(64px); opacity:.65;
  background:radial-gradient(60% 60% at 60% 30%, color-mix(in srgb, var(--accent) 40%, transparent), transparent 70%),
    radial-gradient(50% 50% at 20% 80%, color-mix(in srgb, var(--accent-2) 32%, transparent), transparent 70%); }
.ld-hero-mock { transform:perspective(1600px) rotateY(-7deg) rotateX(2deg); transform-origin:0% 50%; }
.ld-float-card { position:absolute; left:-8%; bottom:-28px; display:flex; align-items:center; gap:12px;
  padding:14px 18px; background:var(--surface); border:1px solid var(--border-strong); border-radius:var(--radius-lg);
  box-shadow:var(--shadow-lg); }
.ld-float-card .ds-stat-value { font-size:1.1rem; }
@media (max-width:960px) {
  .ld-hero-grid { grid-template-columns:1fr; text-align:center; }
  .ld-hero-copy, .ld-hero-copy h1, .ld-hero-copy .ds-lead { text-align:center; margin-left:auto; margin-right:auto; }
  .ld-hero-actions, .ld-hero-proof { justify-content:center; }
  .ld-hero-mock { transform:none; }
  .ld-float-card { display:none; }
}

/* ── Section rhythm (Sprint 1.10) ──
   Alternating full-bleed tinted bands between content sections so a
   generated page reads as a sequence of deliberate, distinct sections
   instead of one flat, repeating column — the "visual rhythm" gap
   flagged for the Website Builder. Purely additive: a new wrapper +
   modifier class, no change to the shared `.ds-section` other renderers
   use. */
.ld-section-band { padding:clamp(56px,9vw,112px) 0; }
.ld-tone-alt { background:color-mix(in srgb, var(--surface) 45%, transparent);
  border-top:1px solid var(--border); border-bottom:1px solid var(--border); }

/* ── Section eyebrow + footer responsiveness (Sprint 1.11) ──
   Every section head now pairs a small eyebrow label with its heading —
   the hero and CTA band already used this; sections were the flatter
   outlier. Purely typographic, reuses the existing `.ds-eyebrow` token. */
.ld-section-eyebrow { display:block; margin-bottom:10px; }
.ld-footer-grid { display:grid; grid-template-columns:1.4fr 1fr 1fr 1fr; gap:28px; }
@media (max-width:720px) { .ld-footer-grid { grid-template-columns:1fr 1fr; row-gap:32px; } }
@media (max-width:480px) { .ld-footer-grid { grid-template-columns:1fr; } }
""".strip()

CSS = CSS + "\n\n" + cl.CSS

_LOGOS = ["Vantage", "Lumio", "Northwind", "Mercura", "Cobalt", "Atlas"]


def _wrap(sec_id, title, subtitle, inner, tone=None, eyebrow=None) -> str:
    head = ""
    if title:
        eyebrow_html = f'<span class="ds-eyebrow ld-section-eyebrow">{e(eyebrow)}</span>' if eyebrow else ""
        head = (f'<div class="ds-center" style="margin-bottom:44px">{eyebrow_html}<h2>{e(title)}</h2>'
                + (f'<p class="ds-lead" style="margin-top:12px;max-width:50ch;margin-left:auto;margin-right:auto">{e(subtitle)}</p>' if subtitle else "")
                + "</div>")
    band_cls = "ld-section-band" + (" ld-tone-alt" if tone == "alt" else "")
    return f'<section class="{band_cls}" id="{sec_id}"><div class="ds-container">{head}{inner}</div></section>'


def _section_id(sec: Section) -> str:
    """The DOM id a section will render with. Centralised so every
    `_xxx()` renderer and the nav-link filter in `render()` agree on the
    same id — previously each function recomputed this inline, and the
    testimonials section's untitled fallback ("customers") silently
    collided with the always-rendered logos section's `id="customers"`,
    producing duplicate DOM ids. Fixed here once, for every future spec."""
    if sec.kind == "pricing":      return "pricing"
    if sec.kind == "testimonials": return slug(sec.title or "testimonials")
    if sec.kind == "faq":          return "faq"
    if sec.kind == "gallery":      return slug(sec.title or "gallery")
    if sec.kind == "panel":        return slug(sec.title or "preview")
    if sec.kind == "features":     return slug(sec.title or "features")
    if sec.kind == "metrics":      return "metrics"
    return slug(sec.title or "section")


def _hero(spec: ProductSpec, primary_target: str, secondary_target: str) -> str:
    metrics = spec.metrics or [{"label": "Active", "value": "12.4k"}, {"label": "Growth", "value": "+18%"}]
    chips = "".join(f"""
      <div class="ds-card ds-col-2" style="padding:16px"><span style="color:var(--text-dim);font-size:.78rem">{e(x.get('label'))}</span>
        <div class="ds-stat-value" style="font-size:1.4rem;margin-top:4px">{e(x.get('value'))}</div></div>"""
                    for x in metrics[:2])
    float_metric = metrics[0]
    # Design Brief "Product Showcase" layout — give the mockup itself more
    # prominence (a row of real product highlights under it) instead of
    # just the single floating metric chip every other landing hero gets.
    showcase = ""
    if (spec.data or {}).get("product_showcase"):
        highlights = feature_items(spec)[:3]
        if highlights:
            showcase_cells = "".join(f"""
      <div class="ds-card ds-col-2 ds-rise" style="padding:14px">{icon(c.get('icon'))}
        <p style="font-size:.86rem;margin-top:8px;color:var(--text)">{e(c.get('title'))}</p></div>""" for c in highlights)
            showcase = f'<div class="ds-bento" style="margin-top:14px">{showcase_cells}</div>'
    arrow = ('<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" '
             'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
             '<path d="M3 8h10"/><path d="M9 4l4 4-4 4"/></svg>')
    return f"""
<section class="ld-hero" id="overview"><div class="ds-container ld-hero-grid">
  <div class="ld-hero-copy">
    <span class="ds-badge ds-rise"><span class="ds-badge-dot"></span>{e(spec.product_type.replace('_',' ').title())}</span>
    <h1 class="ds-rise">{e(spec.tagline)}</h1>
    <p class="ds-lead ds-rise">{e(spec.description)}</p>
    <div class="ds-hero-actions ld-hero-actions ds-rise">
      <button class="ds-btn ds-btn-primary" data-scroll="{primary_target}">{e(spec.cta_primary)}</button>
      <button class="ds-btn ds-btn-ghost ld-btn-arrow" data-scroll="{secondary_target}">{e(spec.cta_secondary)}{arrow}</button>
    </div>
    <div class="ld-hero-proof ds-rise">
      <span class="ld-avatars">{avatar('A')}{avatar('B')}{avatar('C')}</span>
      <span>Trusted by fast-moving teams</span>
    </div>
  </div>
  <div class="ld-hero-visual ds-rise">
    <span class="ld-hero-glow" aria-hidden="true"></span>
    <div class="ds-mock ld-hero-mock">
      <div class="ds-mock-bar"><i></i><i></i><i></i>
        <span style="margin-left:10px;color:var(--text-dim);font-size:.8rem">{e(spec.name)} — preview</span></div>
      <div class="ds-mock-body"><div class="ds-bento">
        <div class="ds-card ds-col-4 ds-row-2"><span class="ds-eyebrow">Overview</span>
          <h3 style="margin-top:6px">{e(spec.tagline)}</h3>{bars(14)}</div>
        {chips}
        <div class="ds-card ds-col-2">{spark()}</div>
      </div></div>
    </div>
    {showcase}
    <div class="ld-float-card"><span class="ds-eyebrow" style="margin:0">{e(float_metric.get('label'))}</span>
      <div class="ds-stat-value">{e(float_metric.get('value'))}</div></div>
  </div>
</div></section>"""


def _impact_band(spec: ProductSpec) -> str:
    """A dedicated use-case / impact band between the social-proof logo row
    and the feature grid — real KPI numbers when the spec carries them
    (finance/analytics/ops verticals mostly do), otherwise a punchy 3-up
    "why teams switch" reel built from the spec's own primary goals, so a
    generated landing page never drops straight from logos into features
    with nothing to substantiate the pitch in between."""
    metrics = spec.metrics or []
    if len(metrics) >= 2:
        cards = "".join(f"""
    <div class="ds-card ds-rise ds-center" style="padding:30px 20px">
      <div class="ds-stat-value" style="font-size:2.4rem">{e(m.get('value'))}</div>
      <p style="font-size:.86rem;margin-top:8px;color:var(--text-dim)">{e(m.get('label'))}</p>
    </div>""" for m in metrics[:4])
        title, subtitle = "Real results, not vaporware", "The numbers teams see after switching."
    else:
        goals = (spec.primary_goals or [])[:3] or ["Move faster", "Ship with confidence", "Grow revenue"]
        cards = "".join(f"""
    <div class="ds-card ds-rise" style="text-align:center">{icon('check')}
      <p style="margin-top:10px;font-size:.95rem;color:var(--text)">{e(g)}</p>
    </div>""" for g in goals)
        audience_lead = (spec.audience or "your team").split(".")[0].strip() or "your team"
        title = f"Built for how {audience_lead.lower()} works"
        subtitle = "What changes the day you switch."
    return _wrap("impact", title, subtitle,
                 f'<div class="ds-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr))">{cards}</div>',
                 None, "Impact")


def _logos() -> str:
    logos = "".join(f'<span class="ds-logo">{e(n)}</span>' for n in _LOGOS)
    return f"""
<section class="ds-section ds-container ds-center" id="customers" style="padding-top:24px;padding-bottom:24px">
  <p style="color:var(--text-dim);font-size:.82rem;text-transform:uppercase;letter-spacing:.12em;margin-bottom:22px">Trusted by fast-moving teams</p>
  <div class="ds-logos">{logos}</div></section>"""


def _feature_bento(items) -> str:
    if not items:
        return ""
    lead = items[0]
    cells = [f"""
    <div class="ds-card ds-col-4 ds-row-2 ds-rise">{icon(lead.get('icon'))}
      <h3 style="font-size:1.5rem">{e(lead.get('title'))}</h3>
      <p style="margin-top:10px;max-width:46ch">{e(lead.get('body'))}</p>{bars(12)}</div>"""]
    for c in items[1:]:
        cells.append(f"""
    <div class="ds-card ds-col-2 ds-rise">{icon(c.get('icon'))}<h3>{e(c.get('title'))}</h3>
      <p style="margin-top:8px;font-size:.92rem">{e(c.get('body'))}</p></div>""")
    return f'<div class="ds-bento">{"".join(cells)}</div>'


def _pricing(sec: Section, tone=None) -> str:
    n = len(sec.items)
    cards = "".join(f"""
    <div class="ds-card ds-rise{' ds-plan-featured' if (n >= 2 and i == 1) else ''}" style="text-align:center">
      {'<span class="ds-badge" style="margin-bottom:12px">Most popular</span>' if (n >= 2 and i == 1) else ''}
      <h3>{e(c.get('title'))}</h3><div class="ld-plan-price" style="margin:12px 0">{e(c.get('body'))}</div>
      <p style="font-size:.88rem">{e(c.get('icon'))}</p>
      <button class="ds-btn {'ds-btn-primary' if (n >= 2 and i == 1) else 'ds-btn-ghost'}" data-scroll="get-started" style="margin-top:18px;width:100%">Choose plan</button>
    </div>""" for i, c in enumerate(sec.items))
    return _wrap(_section_id(sec), sec.title or "Simple, scalable pricing", sec.subtitle, f'<div class="ds-grid">{cards}</div>', tone, "Pricing")


def _testimonials(sec: Section, tone=None) -> str:
    cards = "".join(f"""
    <div class="ds-card ds-rise"><div class="ld-testi-stars">★★★★★</div>
      <p style="color:var(--text);font-size:1.05rem;margin-top:12px">{e(c.get('title'))}</p>
      <div style="display:flex;align-items:center;gap:10px;margin-top:16px">{avatar(c.get('body') or 'U')}
        <span style="font-size:.85rem;color:var(--text-dim)">{e(c.get('body'))}</span></div>
    </div>""" for c in sec.items)
    return _wrap(_section_id(sec), sec.title or "Loved by teams that ship", sec.subtitle, f'<div class="ds-grid">{cards}</div>', tone, "Testimonials")


def _faq(sec: Section, tone=None) -> str:
    items = "".join(f"""
    <details class="ds-card ds-rise"><summary>{e(c.get('title'))}</summary>
      <p style="margin-top:12px">{e(c.get('body'))}</p></details>""" for c in sec.items)
    return _wrap(_section_id(sec), sec.title or "Frequently asked", sec.subtitle, f'<div class="ld-faq">{items}</div>', tone, "FAQ")


def _gallery(sec: Section, tone=None) -> str:
    items = sec.items or []
    if items:
        tiles = "".join(f"""
        <div class="ds-card ds-rise ds-selectable" data-select style="overflow:hidden;padding:0">
          <div style="aspect-ratio:4/3;background:linear-gradient(135deg,color-mix(in srgb,var(--accent) {20+9*i}%,var(--surface-2)),color-mix(in srgb,var(--accent-2) {16*i%40+12}%,var(--surface)))"></div>
          <div style="padding:14px 16px"><h3 style="font-size:1rem">{e(it.get('title'))}</h3>
            <p style="font-size:.84rem;margin-top:2px">{e(it.get('body'))}</p></div></div>""" for i, it in enumerate(items))
    else:
        tiles = "".join(
            f'<div class="ds-card ds-rise ds-selectable" data-select style="aspect-ratio:4/3;'
            f'background:linear-gradient(135deg,color-mix(in srgb,var(--accent) {18+11*i}%,transparent),'
            f'color-mix(in srgb,var(--accent-2) {18+11*i}%,transparent))"></div>' for i in range(6))
    return _wrap(_section_id(sec), sec.title or "Gallery", sec.subtitle, f'<div class="ds-grid" data-select-group>{tiles}</div>', tone, "Gallery")


def _panel(spec: ProductSpec, sec: Section, tone=None) -> str:
    return _wrap(_section_id(sec), sec.title or "Take a closer look", sec.subtitle,
                 '<div class="ds-mock ds-rise"><div class="ds-mock-bar"><i></i><i></i><i></i></div>'
                 f'<div class="ds-mock-body"><div class="ds-bento"><div class="ds-card ds-col-4 ds-row-2">{bars(12)}</div>'
                 f'<div class="ds-card ds-col-2">{spark()}</div>'
                 f'<div class="ds-card ds-col-2"><div class="ds-stat-value">{e(spec.cta_primary)}</div></div></div></div></div>', tone, "Preview")


def _contact(spec: ProductSpec) -> str:
    """Sprint 2.0 — Marketing Website variant: a real contact/inquiry form
    (agency/brand sites lead with "get in touch", not a pricing table)."""
    fields = [
        {"name": "name", "label": "Your name", "type": "text", "placeholder": "Jane Doe"},
        {"name": "email", "label": "Work email", "type": "email", "placeholder": "jane@company.com"},
        {"name": "project", "label": "Tell us about your project", "type": "textarea",
         "placeholder": f"What are you looking to build with {spec.name}?"},
    ]
    return _wrap("contact", "Let's work together", "Tell us about your project and we'll get back within a day.",
                 f'<div class="ds-card ds-rise" style="max-width:560px;margin:0 auto">{cl.form_fields(fields, "Send inquiry")}</div>')


def _cta(spec: ProductSpec, sec: Section, secondary_target: str = "features") -> str:
    return f"""
<section class="ds-section ds-container" id="get-started">
  <div class="ds-card ds-glass ds-rise ds-center" style="padding:64px 28px;overflow:hidden">
    <span class="ds-eyebrow">Ready when you are</span>
    <h2 style="margin:14px auto;max-width:18ch">{e(sec.title or 'Get started today')}</h2>
    <p class="ds-lead" style="max-width:44ch;margin:0 auto 28px">{e(spec.description)}</p>
    <div class="ds-hero-actions"><button class="ds-btn ds-btn-primary" data-scroll="overview">{e(spec.cta_primary)}</button>
      <button class="ds-btn ds-btn-ghost" data-scroll="{secondary_target}">{e(spec.cta_secondary)}</button></div>
  </div></section>"""


def _section(spec: ProductSpec, sec: Section, tone=None, secondary_target: str = "features") -> str:
    if sec.kind == "features":     return _wrap(_section_id(sec), sec.title or "Features", sec.subtitle, _feature_bento(sec.items), tone, "Features")
    if sec.kind == "pricing":      return _pricing(sec, tone)
    if sec.kind == "testimonials": return _testimonials(sec, tone)
    if sec.kind == "faq":          return _faq(sec, tone)
    if sec.kind == "gallery":      return _gallery(sec, tone)
    if sec.kind == "panel":        return _panel(spec, sec, tone)
    if sec.kind == "cta":          return _cta(spec, sec, secondary_target)
    if sec.kind == "metrics":      return _wrap(_section_id(sec), sec.title or "By the numbers", sec.subtitle, _feature_bento(sec.items), tone, "Metrics")
    return _wrap(_section_id(sec), sec.title, sec.subtitle, _feature_bento(sec.items), tone, sec.kind.replace("_", " ").title() or None)


def _footer(spec: ProductSpec) -> str:
    cols = {
        "Product": ["Overview", "Features", "Pricing", "Changelog"],
        "Company": ["About", "Careers", "Blog", "Contact"],
        "Resources": ["Docs", "Guides", "Support", "Status"],
    }
    colhtml = "".join(
        f'<div><div style="color:var(--text);font-weight:650;margin-bottom:10px">{e(h)}</div>'
        + "".join(f'<a href="#" style="display:block;color:var(--text-dim);font-size:.88rem;padding:4px 0">{e(x)}</a>' for x in items)
        + "</div>" for h, items in cols.items())
    return f"""
<footer class="ds-footer"><div class="ds-container">
  <div class="ld-footer-grid">
    <div><div class="ds-nav-brand"><span class="ds-nav-logo"></span>{e(spec.name)}</div>
      <p style="font-size:.88rem;margin-top:12px;max-width:32ch">{e(spec.tagline)}</p></div>
    {colhtml}
  </div>
  <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-top:30px;padding-top:20px;border-top:1px solid var(--border)">
    <span>© {e(spec.name)} · Crafted with Korvix</span><span>Privacy · Terms</span></div>
</div></footer>"""


def render(spec: ProductSpec) -> str:
    is_marketing = (spec.data or {}).get("variant") == "marketing_website"
    content_sections = [s for s in spec.sections if s.kind != "metrics"]

    links = "".join(f'<a data-nav="{slug(l)}" data-scroll="{slug(l)}">{e(l)}</a>' for l in spec.navigation)

    has_pricing = any(s.kind == "pricing" for s in spec.sections)
    primary_target = "pricing" if has_pricing else "get-started"
    # Fall back to "customers" (the always-rendered logos section), not the
    # literal string "features" — a spec with no features section would
    # otherwise point the hero's own secondary CTA at a nonexistent anchor.
    secondary_target = next((_section_id(s) for s in spec.sections if s.kind == "features"), "customers")
    nav = f"""
<header class="ds-nav">
  <div class="ds-nav-brand"><span class="ds-nav-logo"></span>{e(spec.name)}</div>
  <nav class="ds-nav-links">{links}</nav>
  <button class="ds-btn ds-btn-primary ds-btn-sm" data-scroll="{primary_target}">{e(spec.cta_primary)}</button>
</header>"""
    parts = [nav, "<main>", _hero(spec, primary_target, secondary_target), _logos(), _impact_band(spec)]
    # Alternating tinted bands (skipping `cta`, which already has its own
    # glass-card treatment) give the page a deliberate section rhythm
    # instead of one flat, repeating column.
    band_i = 0
    for sec in content_sections:
        if sec.kind == "cta":
            parts.append(_section(spec, sec, secondary_target=secondary_target))
            continue
        parts.append(_section(spec, sec, tone="alt" if band_i % 2 == 0 else None))
        band_i += 1
    if not any(s.kind == "cta" for s in spec.sections):
        parts.append(_cta(spec, Section(kind="cta", title="Get started today"), secondary_target))
    if is_marketing:
        parts.append(_contact(spec))
    parts += ["</main>", _footer(spec)]
    return "\n".join(parts)


__all__ = ["CSS", "render"]
