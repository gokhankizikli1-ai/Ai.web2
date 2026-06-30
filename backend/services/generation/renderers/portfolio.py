# coding: utf-8
# Sprint 2.3 — premium portfolio renderer (asymmetric identity hero).
#
# An editorial personal/portfolio site: an asymmetric split hero — oversized
# headline beside a real featured-project preview (not just text on its
# own) — a project showcase where one piece leads at double width instead
# of a uniform equal-card grid, an about section, and a contact CTA.
# Distinct from the SaaS landing layout (no pricing/logos/feature-bento).

from __future__ import annotations

from backend.services.generation.renderers import base
from backend.services.generation.renderers.base import e, feature_items, slug, svg_icon
from backend.services.generation.spec import ProductSpec

CSS = """
/* ── Portfolio ── */
.pf-nav .pf-links { display:flex; gap:6px; }
.pf-nav .pf-links a { color:var(--text-muted); font-size:.9rem; font-weight:550; padding:8px 12px; border-radius:9px; cursor:pointer; }
.pf-nav .pf-links a:hover { background:var(--surface-2); color:var(--text); }

/* Asymmetric identity hero — headline beside a real featured-work
   preview, so the FIRST screen already tells a story instead of showing
   text alone (the "generic resume page" failure mode). */
.pf-hero { padding:clamp(56px,9vw,120px) 0 clamp(40px,6vw,80px); }
.pf-hero-grid { display:grid; grid-template-columns:1.1fr 1fr; gap:clamp(32px,5vw,64px); align-items:center; }
.pf-hero-copy .ds-eyebrow { font-size:.9rem; }
.pf-hero-copy h1 { font-size:clamp(2.4rem,5.6vw,4.4rem); line-height:1.04; letter-spacing:-.035em; margin-top:14px; }
.pf-hero-copy p { font-size:1.1rem; max-width:52ch; margin-top:20px; }
.pf-hero-actions { margin-top:30px; }
.pf-hero-feature { position:relative; border-radius:var(--radius-xl); overflow:hidden; aspect-ratio:4/5;
  box-shadow:var(--shadow-lg); cursor:pointer; transition:transform var(--t-slow) var(--ease); }
.pf-hero-feature:hover { transform:translateY(-4px); }
.pf-hero-feature-art { position:absolute; inset:0; }
.pf-hero-feature-body { position:absolute; left:0; right:0; bottom:0; padding:24px;
  background:linear-gradient(0deg, rgba(4,6,12,.82), rgba(4,6,12,.1) 75%, transparent); }
.pf-hero-feature-tag { display:inline-flex; padding:4px 11px; margin-bottom:12px; border-radius:9999px;
  background:rgba(255,255,255,.16); backdrop-filter:blur(6px); font-size:.74rem; font-weight:650; color:#fff; }
.pf-hero-feature-body h3 { color:#fff; font-size:1.3rem; letter-spacing:-.02em; }
.pf-hero-feature-body p { color:rgba(255,255,255,.82); font-size:.85rem; margin-top:5px; max-width:32ch; }
.pf-hero-feature-arrow { position:absolute; top:18px; right:18px; width:38px; height:38px; border-radius:9999px;
  background:rgba(255,255,255,.18); backdrop-filter:blur(6px); display:grid; place-items:center; color:#fff;
  transition:transform var(--t) var(--ease); }
.pf-hero-feature:hover .pf-hero-feature-arrow { transform:translate(3px,-3px); }
@media (max-width:860px) {
  .pf-hero-grid { grid-template-columns:1fr; }
  .pf-hero-feature { aspect-ratio:16/10; }
}

/* Asymmetric project showcase — the lead piece spans the full row at a
   wider aspect ratio, the rest sit in a supporting grid. Not four
   identical cards. */
.pf-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(min(100%,260px),1fr)); gap:18px; }
.pf-work { padding:0; overflow:hidden; cursor:pointer; }
.pf-work-art { aspect-ratio:4/3; position:relative; }
.pf-work-tag { position:absolute; top:14px; left:14px; padding:4px 11px; border-radius:9999px;
  background:rgba(8,10,16,.55); backdrop-filter:blur(6px); font-size:.72rem; font-weight:650; color:#fff; }
.pf-work-body { padding:18px 20px; display:flex; align-items:center; justify-content:space-between; gap:10px; }
.pf-work-body h3 { font-size:1.1rem; } .pf-work-arrow { color:var(--text-dim); font-size:1.2rem; transition:transform var(--t) var(--ease); }
.pf-work:hover .pf-work-arrow { transform:translate(3px,-3px); }
.pf-work.is-selected { box-shadow:0 0 0 2px var(--accent), var(--shadow); }
.pf-grid .pf-work:first-child { grid-column:1 / -1; }
.pf-grid .pf-work:first-child .pf-work-art { aspect-ratio:21/9; }
.pf-grid .pf-work:first-child .pf-work-body h3 { font-size:1.35rem; }

.pf-about { display:grid; grid-template-columns:1fr 1fr; gap:40px; align-items:center; }
.pf-about h2 { font-size:clamp(1.8rem,3.6vw,2.6rem); }
.pf-stats { display:flex; gap:30px; flex-wrap:wrap; margin-top:24px; }
.pf-stat .v { font-size:2rem; font-weight:760; letter-spacing:-.03em; } .pf-stat .l { color:var(--text-dim); font-size:.85rem; }
.pf-skills { display:flex; flex-wrap:wrap; gap:8px; margin-top:22px; }
@media (max-width:760px){ .pf-about { grid-template-columns:1fr; } }
""".strip()

_TAGS = ["Product", "Brand", "Web", "Visual", "Identity", "Campaign"]


def _tag(i: int) -> str:
    return _TAGS[i % len(_TAGS)]


def _art(i: int) -> str:
    return (f'<div class="pf-work-art" style="background:linear-gradient(135deg,'
            f'color-mix(in srgb,var(--accent) {24+10*(i%4)}%,var(--surface-2)),'
            f'color-mix(in srgb,var(--accent-2) {18+8*(i%3)}%,var(--surface)))">'
            f'<span class="pf-work-tag">{e(_tag(i))}</span></div>')


def _hero(spec: ProductSpec, projects: list) -> str:
    lead = projects[0] if projects else None
    if lead:
        feature = f"""
  <article class="pf-hero-feature ds-rise" data-select>
    <div class="pf-hero-feature-art" style="background:linear-gradient(150deg,
      color-mix(in srgb,var(--accent) 38%,var(--surface-2)),
      color-mix(in srgb,var(--accent-2) 30%,var(--surface)))"></div>
    <span class="pf-hero-feature-arrow">{svg_icon('next')}</span>
    <div class="pf-hero-feature-body">
      <span class="pf-hero-feature-tag">{e(_tag(0))}</span>
      <h3>{e(lead.get('title'))}</h3>
      <p>{e(lead.get('body'))}</p>
    </div>
  </article>"""
    else:
        feature = ('<div class="ds-card ds-glass ds-rise pf-hero-feature" '
                   'style="display:grid;place-items:center"><span style="font-size:4rem;opacity:.4">◆</span></div>')
    return f"""
<section class="pf-hero ds-container"><div class="pf-hero-grid">
  <div class="pf-hero-copy">
    <span class="ds-eyebrow">{e(spec.audience)}</span>
    <h1>{e(spec.tagline)}</h1>
    <p>{e(spec.description)}</p>
    <div class="ds-hero-actions pf-hero-actions">
      <button class="ds-btn ds-btn-primary" data-scroll="work">{e(spec.cta_secondary)}</button>
      <button class="ds-btn ds-btn-ghost" data-scroll="contact">{e(spec.cta_primary)}</button>
    </div>
  </div>
  {feature}
</div></section>"""


def render(spec: ProductSpec) -> str:
    links = "".join(f'<a data-scroll="{slug(l)}">{e(l)}</a>' for l in spec.navigation)
    nav = f"""
<header class="ds-nav pf-nav">
  <div class="ds-nav-brand"><span class="ds-nav-logo"></span>{e(spec.name)}</div>
  <nav class="pf-links">{links}</nav>
  <button class="ds-btn ds-btn-primary ds-btn-sm" data-scroll="contact">{e(spec.cta_primary)}</button>
</header>"""
    gallery = next((s for s in spec.sections if s.kind == "gallery"), None)
    projects = (gallery.items if gallery and gallery.items else feature_items(spec)) or []
    hero = _hero(spec, projects)
    # The hero already showcases the lead project — the grid below shows
    # the rest, so nothing is shown twice.
    rest = projects[1:] or projects
    work_cards = "".join(f"""
    <article class="ds-card ds-rise pf-work ds-selectable" data-select>
      {_art(i + 1)}
      <div class="pf-work-body"><div><h3>{e(p.get('title'))}</h3>
        <p style="font-size:.85rem;margin-top:2px">{e(p.get('body'))}</p></div>
        <span class="pf-work-arrow">↗</span></div></article>""" for i, p in enumerate(rest))
    work = f"""
<section class="ds-section ds-container" id="work">
  <div class="db-page-head" style="margin-bottom:22px"><div><span class="ds-eyebrow">Selected work</span>
    <h2>Recent projects</h2></div></div>
  <div class="pf-grid" data-select-group>{work_cards}</div>
</section>"""
    about = f"""
<section class="ds-section ds-container" id="about"><div class="pf-about">
  <div><span class="ds-eyebrow">About</span><h2>{e(spec.name)}</h2>
    <p class="ds-lead" style="margin-top:14px">{e(spec.description)}</p>
    <div class="pf-stats">
      <div class="pf-stat"><div class="v">8+ yrs</div><div class="l">Experience</div></div>
      <div class="pf-stat"><div class="v">40+</div><div class="l">Projects shipped</div></div>
      <div class="pf-stat"><div class="v">12</div><div class="l">Awards</div></div></div>
    <div class="pf-skills">{"".join(f'<span class="ds-chip">{e(_tag(i))}</span>' for i in range(4))}</div>
  </div>
  <div class="ds-card ds-glass ds-rise" style="aspect-ratio:1;display:grid;place-items:center">
    <span style="font-size:4rem;opacity:.4">◆</span></div>
</div></section>"""
    contact = f"""
<section class="ds-section ds-container" id="contact">
  <div class="ds-card ds-glass ds-rise ds-center" style="padding:60px 28px">
    <span class="ds-eyebrow">Let's talk</span>
    <h2 style="margin:14px auto;max-width:18ch">Have a project in mind?</h2>
    <p class="ds-lead" style="max-width:42ch;margin:0 auto 26px">{e(spec.description)}</p>
    <button class="ds-btn ds-btn-primary" data-scroll="work">{e(spec.cta_primary)}</button>
  </div>
</section>"""
    footer = f"""
<footer class="ds-footer"><div class="ds-container" style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:14px;align-items:center">
  <div class="ds-nav-brand"><span class="ds-nav-logo"></span>{e(spec.name)}</div>
  <span>Available for select projects</span><span>Crafted with Korvix</span></div></footer>"""
    return "\n".join([nav, "<main>", hero, work, about, contact, "</main>", footer])


__all__ = ["CSS", "render"]
