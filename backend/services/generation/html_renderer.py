# coding: utf-8
# EPIC 2 / M2 — Premium HTML renderer with interactive prototype behavior.
#
# Turns a ProductSpec into ONE clean, semantic, responsive, dark-mode,
# premium HTML document that FEELS interactive (not just visual):
#   * marketing pages  — nav smooth-scrolls + active state, hero CTAs
#                        scroll to pricing/CTA, FAQ expand/collapse
#                        (native <details>), selectable feature cards.
#   * app/dashboards    — tab nav switches visible panels, primary CTA
#                        reveals a detail panel (e.g. "Start training" →
#                        today's workout), selectable cards.
#
# All behavior is wired by ONE tiny, sandbox-safe inline <script> driven
# by data-attributes. Strict CSP + no external resources (no fonts CDN,
# no scripts, no network, no eval) → instant, safe preview.

from __future__ import annotations

import html as _html
import re
from typing import List

from backend.services.generation.design_system import design_system_css
from backend.services.generation.spec import ProductSpec, Section


def _e(s: str) -> str:
    return _html.escape(str(s or ""), quote=True)


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (s or "section").lower()).strip("-") or "section"


# Content Security Policy: block ALL network (default-src 'none'),
# allow only inline CSS/JS + data: images. Belt-and-suspenders with the
# preview iframe's sandbox="allow-scripts" (no allow-same-origin).
_CSP = ("default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; "
        "img-src data:; font-src data:; base-uri 'none'; form-action 'none'")

# Generic, framework-free interaction layer. No eval, no network, no
# external deps. Wires data-nav / data-panel / data-reveal / data-scroll
# / data-select-group. Plain string (NOT an f-string) — no escaping.
_SCRIPT = """
(function(){
  function list(sel, root){ return [].slice.call((root||document).querySelectorAll(sel)); }
  var navs = list('[data-nav]');
  var panels = list('[data-panel]');
  function setActive(group, el){
    group.forEach(function(n){ n.classList.remove('is-active'); });
    if(el){ el.classList.add('is-active'); }
  }
  function showPanel(id){
    if(!panels.length){ return false; }
    var matched = false;
    panels.forEach(function(p){
      var on = p.getAttribute('data-panel') === id;
      p.classList.toggle('ds-hidden', !on);
      if(on){ matched = true; }
    });
    return matched;
  }
  navs.forEach(function(a){
    a.addEventListener('click', function(e){
      var id = a.getAttribute('data-nav');
      setActive(navs, a);
      var switched = showPanel(id);
      var target = document.getElementById(id);
      if(target && !switched){
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else if(switched){
        e.preventDefault();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
  });
  if(panels.length){
    var active = navs.filter(function(n){ return n.classList.contains('is-active'); })[0];
    showPanel((active && active.getAttribute('data-nav')) || panels[0].getAttribute('data-panel'));
    if(!active && navs[0]){ navs[0].classList.add('is-active'); }
  }
  list('[data-reveal]').forEach(function(b){
    b.addEventListener('click', function(){
      var t = document.getElementById(b.getAttribute('data-reveal'));
      if(t){ t.classList.remove('ds-hidden'); t.classList.add('ds-revealed');
        t.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    });
  });
  list('[data-scroll]').forEach(function(b){
    b.addEventListener('click', function(){
      var t = document.getElementById(b.getAttribute('data-scroll'));
      if(t){ t.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    });
  });
  list('[data-select-group]').forEach(function(g){
    var items = list('[data-select]', g);
    items.forEach(function(it){
      it.addEventListener('click', function(){
        items.forEach(function(x){ x.classList.remove('is-selected'); });
        it.classList.add('is-selected');
      });
    });
  });
})();
""".strip()


# ── Section renderers ─────────────────────────────────────────────────

def _feature_grid(items, selectable: bool = True) -> str:
    grp = ' data-select-group' if selectable else ''
    sel = ' ds-selectable' if selectable else ''
    attr = ' data-select' if selectable else ''
    cards = "".join(f"""
    <div class="ds-card{sel} ds-rise"{attr}>
      <div class="ds-icon">{_e(c.get('icon','●'))}</div>
      <h3>{_e(c.get('title'))}</h3>
      <p style="margin-top:8px">{_e(c.get('body'))}</p>
    </div>""" for c in items)
    return f'<div class="ds-grid"{grp}>{cards}</div>'


def _metric_grid(metrics) -> str:
    cards = "".join(f"""
    <div class="ds-card ds-stat ds-rise">
      <span style="color:var(--text-dim);font-size:.85rem">{_e(m.get('label'))}</span>
      <span class="ds-stat-value">{_e(m.get('value'))}</span>
      <span class="ds-stat-delta">{_e(m.get('delta'))}</span>
    </div>""" for m in metrics)
    return f'<div class="ds-grid">{cards}</div>'


def _pricing(sec: Section) -> str:
    cards = "".join(f"""
    <div class="ds-card ds-rise" style="text-align:center">
      <h3>{_e(c.get('title'))}</h3>
      <div class="ds-stat-value" style="margin:10px 0">{_e(c.get('body'))}</div>
      <p>{_e(c.get('icon'))}</p>
      <button class="ds-btn ds-btn-ghost" style="margin-top:16px;width:100%">Choose plan</button>
    </div>""" for c in sec.items)
    return _wrap_section(sec, f'<div class="ds-grid">{cards}</div>')


def _testimonials(sec: Section) -> str:
    cards = "".join(f"""
    <div class="ds-card ds-rise">
      <p style="color:var(--text);font-size:1.05rem">{_e(c.get('title'))}</p>
      <p style="margin-top:14px;font-size:.85rem">{_e(c.get('body'))}</p>
    </div>""" for c in sec.items)
    return _wrap_section(sec, f'<div class="ds-grid">{cards}</div>')


def _faq(sec: Section) -> str:
    items = "".join(f"""
    <details class="ds-card ds-rise" style="cursor:pointer">
      <summary style="font-weight:600;color:var(--text)">{_e(c.get('title'))}</summary>
      <p style="margin-top:10px">{_e(c.get('body'))}</p>
    </details>""" for c in sec.items)
    return _wrap_section(sec, f'<div style="display:grid;gap:12px;max-width:760px;margin:0 auto">{items}</div>')


def _gallery(sec: Section) -> str:
    tiles = "".join(
        f'<div class="ds-card ds-selectable ds-rise" data-select style="aspect-ratio:4/3;'
        f'background:linear-gradient(135deg,color-mix(in srgb,var(--accent) {20+10*i}%,transparent),'
        f'color-mix(in srgb,var(--accent-2) {20+10*i}%,transparent))"></div>'
        for i in range(6))
    return _wrap_section(sec, f'<div class="ds-grid" data-select-group>{tiles}</div>')


def _panel_rows(spec: ProductSpec) -> str:
    rows = "".join(f"""
      <div style="display:flex;justify-content:space-between;align-items:center;
        padding:14px 16px;border-bottom:1px solid var(--border)">
        <span style="color:var(--text)">{_e(m.get('label'))}</span>
        <span class="ds-stat-delta">{_e(m.get('delta'))}</span>
      </div>""" for m in (spec.metrics or [])[:4])
    return rows


def _wrap_section(sec: Section, inner: str, extra_attr: str = "") -> str:
    head = ""
    if sec.title:
        head = (f'<div style="margin-bottom:32px;text-align:center">'
                f'<h2>{_e(sec.title)}</h2>'
                + (f'<p style="margin-top:10px">{_e(sec.subtitle)}</p>' if sec.subtitle else "")
                + '</div>')
    return f'<section class="ds-section ds-container" id="{_slug(sec.title)}"{extra_attr}>{head}{inner}</section>'


def _footer(spec: ProductSpec) -> str:
    links = "".join(f'<a href="#{_slug(l)}" style="margin-right:20px">{_e(l)}</a>' for l in spec.navigation)
    return f"""
<footer class="ds-footer">
  <div class="ds-container" style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:16px">
    <div class="ds-nav-brand"><span class="ds-nav-logo"></span>{_e(spec.name)}</div>
    <div>{links}</div>
    <span>© {_e(spec.name)}. Crafted with Korvix.</span>
  </div>
</footer>"""


# ── Unified premium layout (PR #191 visual) + interactivity on top ────
#
# ONE premium layout for every spec — the rich PR #191 page (nav + hero
# + full sections + footer). Interactivity is layered ON TOP via
# data-attributes; it never replaces or simplifies the markup:
#   * marketing  → hero/nav CTAs smooth-scroll to the relevant section.
#   * app/dash   → the primary CTA reveals a hidden detail block (e.g.
#                  "Start training" → today's plan) — the rest of the
#                  premium page (hero, metrics, features, panels, cta)
#                  still renders in full.
# Nav items get active state + scroll; cards are selectable; FAQ uses
# native <details>.

def _premium_layout(spec: ProductSpec) -> str:
    links = "".join(
        f'<a data-nav="{_slug(l)}" href="#{_slug(l)}">{_e(l)}</a>' for l in spec.navigation
    )
    section_slugs = [_slug(s.title or s.kind) for s in spec.sections]
    has_pricing = any(s.kind == "pricing" for s in spec.sections)
    primary_target = "pricing" if has_pricing else ("get-started" if any(s.kind == "cta" for s in spec.sections) else (section_slugs[0] if section_slugs else "get-started"))
    secondary_target = next((_slug(s.title or s.kind) for s in spec.sections if s.kind == "features"), primary_target)

    # App/dashboards: primary CTA reveals a detail block; marketing: scroll.
    is_dash = spec.is_dashboard
    primary_attr = 'data-reveal="reveal-detail"' if is_dash else f'data-scroll="{primary_target}"'

    nav = f"""
<header class="ds-nav">
  <div class="ds-nav-brand"><span class="ds-nav-logo"></span>{_e(spec.name)}</div>
  <nav class="ds-nav-links">{links}</nav>
  <button class="ds-btn ds-btn-primary" {primary_attr}>{_e(spec.cta_primary)}</button>
</header>"""
    hero = f"""
<section class="ds-hero ds-container" id="overview">
  <span class="ds-eyebrow ds-rise">{_e(spec.product_type.replace('_',' ').title())}</span>
  <h1 class="ds-rise">{_e(spec.tagline)}</h1>
  <p class="ds-rise">{_e(spec.description)}</p>
  <div class="ds-hero-actions ds-rise">
    <button class="ds-btn ds-btn-primary" {primary_attr}>{_e(spec.cta_primary)}</button>
    <button class="ds-btn ds-btn-ghost" data-scroll="{secondary_target}">{_e(spec.cta_secondary)}</button>
  </div>
</section>"""
    parts = [nav, "<main>", hero]
    if is_dash:
        parts.append(_reveal_block(spec))
    for sec in spec.sections:
        parts.append(_render_section(spec, sec))
    parts += ["</main>", _footer(spec)]
    return "\n".join(parts)


def _reveal_block(spec: ProductSpec) -> str:
    """Hidden, premium detail block revealed by the primary CTA. Reuses
    the premium card/grid components + selectable cards."""
    feats = next((s.items for s in spec.sections if s.kind == "features"), []) or []
    items = feats[:3] or [{"title": "Get started", "body": "Begin now.", "icon": "▶"}]
    grid = _feature_grid(items, selectable=True)
    return f"""
<section class="ds-section ds-container ds-hidden" id="reveal-detail">
  <div style="margin-bottom:24px;text-align:center">
    <h2>{_e(spec.cta_primary)} — your plan</h2>
    <p style="margin-top:10px">Pick a focus to begin.</p>
  </div>
  {grid}
</section>"""


def _render_section(spec: ProductSpec, sec: Section) -> str:
    if sec.kind == "metrics":      return _wrap_section(sec, _metric_grid(spec.metrics))
    if sec.kind == "features":     return _wrap_section(sec, _feature_grid(sec.items))
    if sec.kind == "pricing":      return _pricing(sec)
    if sec.kind == "testimonials": return _testimonials(sec)
    if sec.kind == "faq":          return _faq(sec)
    if sec.kind == "gallery":      return _gallery(sec)
    if sec.kind == "panel":
        body = f"""<div class="ds-card ds-glass ds-rise" style="padding:0;overflow:hidden">
          <div style="padding:16px;border-bottom:1px solid var(--border);font-weight:600">{_e(sec.subtitle or sec.title)}</div>
          {_panel_rows(spec)}</div>"""
        return _wrap_section(sec, body)
    if sec.kind == "cta":
        return f"""
<section class="ds-section ds-container" id="get-started">
  <div class="ds-card ds-glass ds-rise" style="text-align:center;padding:56px 24px">
    <h2>{_e(sec.title or 'Get started today')}</h2>
    <p style="max-width:40ch;margin:14px auto 28px">{_e(spec.description)}</p>
    <button class="ds-btn ds-btn-primary" data-scroll="overview">{_e(spec.cta_primary)}</button>
  </div>
</section>"""
    return _wrap_section(sec, _feature_grid(sec.items))


# ── Document assembly ─────────────────────────────────────────────────

def render_premium_page(spec: ProductSpec) -> str:
    """Render the full premium, INTERACTIVE HTML document for a spec.
    ONE premium layout for every spec (PR #191 visual) with the
    interaction layer applied on top — never a simplified template."""
    body = _premium_layout(spec)
    css = design_system_css(spec.theme.get("accent", "#6366f1"),
                            spec.theme.get("accent2", "#22d3ee"))
    mode_class = "" if spec.dark_mode else "light"
    return f"""<!DOCTYPE html>
<html lang="en" class="{mode_class}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="{_CSP}">
<title>{_e(spec.name)} — {_e(spec.tagline)}</title>
<meta name="description" content="{_e(spec.description)}">
<style>
{css}
</style>
</head>
<body>
{body}
<script>
{_SCRIPT}
</script>
</body>
</html>"""


def ensure_viewport(html_doc: str) -> str:
    """Guarantee a responsive viewport meta on an otherwise-good LLM doc."""
    if "viewport" in (html_doc or "").lower():
        return html_doc
    return html_doc.replace(
        "<head>",
        '<head>\n<meta name="viewport" content="width=device-width, initial-scale=1">',
        1,
    ) if "<head>" in html_doc else html_doc


def ensure_csp(html_doc: str) -> str:
    """Guarantee the network-blocking CSP on ANY html artifact (incl.
    model-kept output), since the preview iframe runs scripts. No-op if a
    CSP is already present."""
    h = html_doc or ""
    if "Content-Security-Policy" in h:
        return h
    meta = f'<meta http-equiv="Content-Security-Policy" content="{_CSP}">'
    if "<head>" in h:
        return h.replace("<head>", "<head>\n" + meta, 1)
    if "<html" in h:  # insert right after the opening <html ...> tag
        return re.sub(r"(<html[^>]*>)", r"\1\n" + meta.replace("\\", "\\\\"), h, count=1)
    return meta + "\n" + h


__all__ = ["render_premium_page", "ensure_viewport", "ensure_csp"]
