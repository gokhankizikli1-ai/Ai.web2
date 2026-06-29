# coding: utf-8
# CRITICAL REBUILD — portfolio website renderer.
#
# An editorial personal/portfolio site: oversized type hero, a selectable
# project grid that opens a project detail drawer, an about section, and a
# contact CTA. Distinct from the SaaS landing layout.

from __future__ import annotations

from backend.services.generation.renderers import base
from backend.services.generation.renderers.base import e, feature_items, slug
from backend.services.generation.spec import ProductSpec

CSS = """
/* ── Portfolio ── */
.pf-nav .pf-links { display:flex; gap:6px; }
.pf-nav .pf-links a { color:var(--text-muted); font-size:.9rem; font-weight:550; padding:8px 12px; border-radius:9px; cursor:pointer; }
.pf-nav .pf-links a:hover { background:var(--surface-2); color:var(--text); }
.pf-hero { padding:clamp(64px,12vw,160px) 0 clamp(30px,5vw,60px); }
.pf-hero .ds-eyebrow { font-size:.9rem; }
.pf-hero h1 { font-size:clamp(2.8rem,8vw,6rem); line-height:1.02; letter-spacing:-.04em; max-width:16ch; margin-top:14px; }
.pf-hero p { font-size:1.2rem; max-width:54ch; margin-top:22px; }
.pf-grid { grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr)); }
.pf-work { padding:0; overflow:hidden; cursor:pointer; }
.pf-work-art { aspect-ratio:4/3; }
.pf-work-body { padding:18px 20px; display:flex; align-items:center; justify-content:space-between; gap:10px; }
.pf-work-body h3 { font-size:1.1rem; } .pf-work-arrow { color:var(--text-dim); font-size:1.2rem; transition:transform var(--t) var(--ease); }
.pf-work:hover .pf-work-arrow { transform:translate(3px,-3px); }
.pf-work.is-selected { box-shadow:0 0 0 2px var(--accent), var(--shadow); }
.pf-about { display:grid; grid-template-columns:1fr 1fr; gap:40px; align-items:center; }
.pf-about h2 { font-size:clamp(1.8rem,3.6vw,2.6rem); }
.pf-stats { display:flex; gap:30px; flex-wrap:wrap; margin-top:24px; }
.pf-stat .v { font-size:2rem; font-weight:760; letter-spacing:-.03em; } .pf-stat .l { color:var(--text-dim); font-size:.85rem; }
@media (max-width:760px){ .pf-about { grid-template-columns:1fr; } }
""".strip()


def _art(i: int, ar: str = "4/3") -> str:
    return (f'<div class="pf-work-art" style="aspect-ratio:{ar};'
            f'background:linear-gradient(135deg,color-mix(in srgb,var(--accent) {24+10*(i%4)}%,var(--surface-2)),'
            f'color-mix(in srgb,var(--accent-2) {18+8*(i%3)}%,var(--surface)))"></div>')


def render(spec: ProductSpec) -> str:
    links = "".join(f'<a data-scroll="{slug(l)}">{e(l)}</a>' for l in spec.navigation)
    nav = f"""
<header class="ds-nav pf-nav">
  <div class="ds-nav-brand"><span class="ds-nav-logo"></span>{e(spec.name)}</div>
  <nav class="pf-links">{links}</nav>
  <button class="ds-btn ds-btn-primary ds-btn-sm" data-scroll="contact">{e(spec.cta_primary)}</button>
</header>"""
    hero = f"""
<section class="pf-hero ds-container">
  <span class="ds-eyebrow">{e(spec.audience)}</span>
  <h1>{e(spec.tagline)}</h1>
  <p class="ds-lead">{e(spec.description)}</p>
  <div class="ds-hero-actions" style="margin-top:28px">
    <button class="ds-btn ds-btn-primary" data-scroll="work">{e(spec.cta_secondary)}</button>
    <button class="ds-btn ds-btn-ghost" data-scroll="contact">{e(spec.cta_primary)}</button></div>
</section>"""
    gallery = next((s for s in spec.sections if s.kind == "gallery"), None)
    projects = (gallery.items if gallery and gallery.items else feature_items(spec)) or []
    work_cards = "".join(f"""
    <article class="ds-card ds-rise pf-work ds-selectable" data-select>
      {_art(i)}
      <div class="pf-work-body"><div><h3>{e(p.get('title'))}</h3>
        <p style="font-size:.85rem;margin-top:2px">{e(p.get('body'))}</p></div>
        <span class="pf-work-arrow">↗</span></div></article>""" for i, p in enumerate(projects))
    work = f"""
<section class="ds-section ds-container" id="work">
  <div class="db-page-head" style="margin-bottom:22px"><div><span class="ds-eyebrow">Selected work</span>
    <h2>Recent projects</h2></div></div>
  <div class="ds-grid pf-grid" data-select-group>{work_cards}</div>
</section>"""
    about = f"""
<section class="ds-section ds-container" id="about"><div class="pf-about">
  <div><span class="ds-eyebrow">About</span><h2>{e(spec.name)}</h2>
    <p class="ds-lead" style="margin-top:14px">{e(spec.description)}</p>
    <div class="pf-stats">
      <div class="pf-stat"><div class="v">8+ yrs</div><div class="l">Experience</div></div>
      <div class="pf-stat"><div class="v">40+</div><div class="l">Projects shipped</div></div>
      <div class="pf-stat"><div class="v">12</div><div class="l">Awards</div></div></div></div>
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
