# coding: utf-8
# EPIC 2 — Premium HTML renderer (demo-grade) with interactive behavior.
#
# Renders a ProductSpec into ONE clean, semantic, responsive, dark, premium
# HTML document that looks like a real funded product (Linear / Vercel /
# Stripe / Apple / Raycast vibe) and FEELS like an app:
#   * landing  → big hero + product mockup + social proof + feature bento
#                + product-preview mockup + pricing + testimonials + FAQ
#                accordion + CTA + footer. Nav smooth-scrolls + active.
#   * app/dash → tab nav switches between full RICH pseudo-pages (overview
#                with metric bento + chart blocks + activity feed; plus a
#                distinct page per nav item: charts / planner / feed /
#                settings). Primary CTA reveals a detail panel; cards
#                selectable.
#
# All behavior is wired by ONE tiny sandbox-safe inline <script> (data
# attributes; no eval, no network, no external deps). Strict CSP + no
# external resources → instant, safe preview.

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


_CSP = ("default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; "
        "img-src data:; font-src data:; base-uri 'none'; form-action 'none'")

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
      if(switched){ e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
      else if(target){ e.preventDefault(); target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
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
  list('.ds-switch').forEach(function(s){
    s.addEventListener('click', function(){ s.classList.toggle('is-on'); });
  });

  // ── Scoped tabs (sub-navigation that swaps tab panels) ──
  list('[data-tab]').forEach(function(t){
    t.addEventListener('click', function(e){
      e.preventDefault();
      var id = t.getAttribute('data-tab');
      var grp = t.getAttribute('data-tab-group') || '';
      list('[data-tab][data-tab-group="' + grp + '"]').forEach(function(x){ x.classList.remove('is-active'); });
      t.classList.add('is-active');
      list('[data-tabpanel][data-tab-group="' + grp + '"]').forEach(function(p){
        p.classList.toggle('ds-hidden', p.getAttribute('data-tabpanel') !== id);
      });
    });
  });

  // ── Notes / editor: click a note → load it into the editor ──
  var editorTitle = document.getElementById('note-title');
  var editorBody = document.getElementById('note-body');
  function loadNote(n){
    if(!n){ return; }
    if(editorTitle){ editorTitle.textContent = n.getAttribute('data-title') || ''; }
    if(editorBody){ editorBody.textContent = n.getAttribute('data-body') || ''; }
  }
  var notesList = document.getElementById('notes-list');
  if(notesList){
    notesList.addEventListener('click', function(e){
      var n = e.target.closest ? e.target.closest('[data-note]') : null;
      if(!n){ return; }
      list('[data-note]', notesList).forEach(function(x){ x.classList.remove('is-selected'); });
      n.classList.add('is-selected');
      loadNote(n);
    });
  }
  list('[data-folder]').forEach(function(f){
    f.addEventListener('click', function(){
      var key = f.getAttribute('data-folder');
      list('[data-folder]').forEach(function(x){ x.classList.remove('is-active'); });
      f.classList.add('is-active');
      list('[data-note]').forEach(function(n){
        var show = key === 'all' || n.getAttribute('data-in-folder') === key;
        n.classList.toggle('ds-hidden', !show);
      });
    });
  });
  var newCount = 0;
  list('[data-new-note]').forEach(function(b){
    b.addEventListener('click', function(){
      if(!notesList){ return; }
      newCount += 1;
      var n = document.createElement('div');
      n.className = 'ds-note-item ds-selectable';
      n.setAttribute('data-note', '');
      n.setAttribute('data-in-folder', 'all');
      n.setAttribute('data-searchable', 'untitled note new');
      n.setAttribute('data-title', 'Untitled note');
      n.setAttribute('data-body', 'Start writing…');
      n.innerHTML = '<div class="ds-note-title">Untitled note</div>'
        + '<div class="ds-note-snippet">Start writing…</div>';
      notesList.insertBefore(n, notesList.firstChild);
      list('[data-note]', notesList).forEach(function(x){ x.classList.remove('is-selected'); });
      n.classList.add('is-selected');
      loadNote(n);
    });
  });

  // ── Live search: filter anything marked data-searchable ──
  list('[data-search]').forEach(function(inp){
    inp.addEventListener('input', function(){
      var q = (inp.value || '').toLowerCase();
      list('[data-searchable]').forEach(function(it){
        var hay = (it.getAttribute('data-searchable') || it.textContent || '').toLowerCase();
        it.classList.toggle('ds-hidden', !!q && hay.indexOf(q) === -1);
      });
    });
  });

  // ── Ecommerce: category filter, add-to-cart counter, product detail ──
  list('[data-filter]').forEach(function(f){
    f.addEventListener('click', function(){
      var key = f.getAttribute('data-filter');
      list('[data-filter]').forEach(function(x){ x.classList.remove('is-active'); });
      f.classList.add('is-active');
      list('[data-category]').forEach(function(c){
        var show = key === 'all' || c.getAttribute('data-category') === key;
        c.classList.toggle('ds-hidden', !show);
      });
    });
  });
  var cartCount = document.getElementById('cart-count');
  var cart = 0;
  list('[data-add-cart]').forEach(function(b){
    b.addEventListener('click', function(e){
      e.preventDefault();
      cart += 1;
      if(cartCount){ cartCount.textContent = String(cart); cartCount.classList.add('is-on'); }
      var label = b.getAttribute('data-add-cart') || b.textContent;
      b.textContent = 'Added ✓';
      b.classList.add('is-selected');
      setTimeout(function(){ b.textContent = label; }, 1100);
    });
  });
  list('[data-product]').forEach(function(p){
    p.addEventListener('click', function(e){
      if(e.target.closest && e.target.closest('[data-add-cart]')){ return; }
      var detail = document.getElementById('product-detail');
      if(!detail){ return; }
      var nm = document.getElementById('detail-name');
      var pr = document.getElementById('detail-price');
      var bl = document.getElementById('detail-blurb');
      if(nm){ nm.textContent = p.getAttribute('data-product') || ''; }
      if(pr){ pr.textContent = p.getAttribute('data-price') || ''; }
      if(bl){ bl.textContent = p.getAttribute('data-blurb') || ''; }
      detail.classList.remove('ds-hidden');
      detail.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });

  // ── Booking: select a room → live summary; confirm booking ──
  list('[data-room]').forEach(function(r){
    r.addEventListener('click', function(){
      list('[data-room]').forEach(function(x){ x.classList.remove('is-selected'); });
      r.classList.add('is-selected');
      var sr = document.getElementById('summary-room');
      var sp = document.getElementById('summary-price');
      if(sr){ sr.textContent = r.getAttribute('data-room') || ''; }
      if(sp){ sp.textContent = r.getAttribute('data-price') || ''; }
      var sum = document.getElementById('booking-summary');
      if(sum){ sum.classList.remove('ds-hidden'); }
      var bk = document.getElementById('book-btn');
      if(bk){ bk.removeAttribute('disabled'); }
    });
  });
  list('[data-book]').forEach(function(b){
    b.addEventListener('click', function(){
      var st = document.getElementById('book-status');
      if(st){ st.textContent = 'Booking confirmed ✓'; st.classList.remove('ds-hidden'); }
    });
  });
})();
""".strip()

_BAR_HEIGHTS = [44, 68, 54, 82, 62, 90, 70, 96, 58, 78]
_LOGOS = ["Vantage", "Lumio", "Northwind", "Mercura", "Cobalt"]


# ── Reusable rich widgets ─────────────────────────────────────────────

def _bars(n: int = 8) -> str:
    bars = "".join(f'<span style="height:{_BAR_HEIGHTS[i % len(_BAR_HEIGHTS)]}%"></span>'
                   for i in range(n))
    return f'<div class="ds-bars" aria-hidden="true">{bars}</div>'


def _icon(ic: str) -> str:
    return f'<div class="ds-icon">{_e(ic or "●")}</div>'


def _feature_bento(items, selectable: bool = True) -> str:
    grp = ' data-select-group' if selectable else ''
    sel = ' ds-selectable' if selectable else ''
    at = ' data-select' if selectable else ''
    if not items:
        return ""
    lead = items[0]
    cells = [f"""
    <div class="ds-card{sel} ds-col-4 ds-row-2 ds-rise"{at}>
      {_icon(lead.get('icon'))}
      <h3 style="font-size:1.5rem">{_e(lead.get('title'))}</h3>
      <p style="margin-top:10px;max-width:46ch">{_e(lead.get('body'))}</p>
      {_bars(10)}
    </div>"""]
    for c in items[1:]:
        cells.append(f"""
    <div class="ds-card{sel} ds-col-2 ds-rise"{at}>
      {_icon(c.get('icon'))}
      <h3>{_e(c.get('title'))}</h3>
      <p style="margin-top:8px;font-size:.92rem">{_e(c.get('body'))}</p>
    </div>""")
    return f'<div class="ds-bento"{grp}>{"".join(cells)}</div>'


def _metric_bento(spec: ProductSpec) -> str:
    m = (spec.metrics or [])[:4]
    while len(m) < 4:
        m.append({"label": "Metric", "value": "—", "delta": ""})
    chart = f"""
    <div class="ds-card ds-col-4 ds-row-2 ds-rise">
      <div style="display:flex;justify-content:space-between;align-items:start">
        <div><span style="color:var(--text-dim);font-size:.85rem">{_e(m[0].get('label'))}</span>
        <div class="ds-stat-value">{_e(m[0].get('value'))}</div></div>
        <span class="ds-badge"><span class="ds-badge-dot"></span>Live</span>
      </div>
      {_bars(12)}
    </div>"""
    cards = "".join(f"""
    <div class="ds-card ds-col-2 ds-rise">
      <span style="color:var(--text-dim);font-size:.82rem">{_e(x.get('label'))}</span>
      <div class="ds-stat-value" style="font-size:1.6rem;margin-top:6px">{_e(x.get('value'))}</div>
      <span class="ds-stat-delta">{_e(x.get('delta'))}</span>
    </div>""" for x in m[1:])
    ring = """
    <div class="ds-card ds-col-2 ds-rise" style="align-items:center;text-align:center;display:flex;flex-direction:column;gap:10px">
      <div class="ds-ring" style="--pct:74%"></div>
      <span style="color:var(--text-dim);font-size:.82rem">Goal progress</span>
    </div>"""
    return f'<div class="ds-bento">{chart}{cards}{ring}</div>'


def _feed(spec: ProductSpec) -> str:
    items = [(c.get("icon", "●"), c.get("title"), c.get("body"))
             for c in (next((s.items for s in spec.sections if s.kind == "features"), []) or [])][:5]
    if not items:
        items = [("✓", "Updated", "Just now")]
    rows = "".join(f"""
    <div class="ds-feed-item">
      <div class="ds-feed-dot">{_e(ic)}</div>
      <div><div style="color:var(--text);font-weight:600;font-size:.92rem">{_e(t)}</div>
        <div style="color:var(--text-dim);font-size:.82rem">{_e(b)}</div></div>
    </div>""" for ic, t, b in items)
    return f'<div class="ds-card ds-rise"><h3 style="margin-bottom:6px">Recent activity</h3><div class="ds-feed">{rows}</div></div>'


def _planner(spec: ProductSpec, title: str) -> str:
    items = (next((s.items for s in spec.sections if s.kind == "features"), []) or [])[:4]
    rows = "".join(f"""
    <div class="ds-card ds-selectable ds-rise" data-select style="display:flex;align-items:center;gap:14px;padding:18px">
      {_icon(c.get('icon'))}
      <div style="flex:1"><h3 style="font-size:1.05rem">{_e(c.get('title'))}</h3>
        <p style="font-size:.88rem;margin-top:4px">{_e(c.get('body'))}</p></div>
      <span class="ds-btn ds-btn-ghost ds-btn-sm">Open</span>
    </div>""" for c in items)
    return f'<div style="display:grid;gap:14px" data-select-group>{rows}</div>'


def _settings_panel(spec: ProductSpec) -> str:
    toggles = [("Email notifications", True), ("Weekly summary", True),
               ("Dark appearance", True), ("Two-factor auth", False)]
    rows = "".join(f"""
    <div class="ds-row"><div><div style="color:var(--text);font-weight:600">{_e(label)}</div>
      <div style="color:var(--text-dim);font-size:.82rem">Manage your {_e(label.lower())}.</div></div>
      <div class="ds-switch{' is-on' if on else ''}" role="switch" tabindex="0"></div></div>""" for label, on in toggles)
    return f"""
    <div class="ds-card ds-rise" style="max-width:620px">
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:8px">
        <div class="ds-icon">◐</div>
        <div><h3>{_e(spec.name)} account</h3>
          <p style="font-size:.88rem">{_e(spec.audience)}</p></div>
      </div>
      {rows}
    </div>"""


def _mockup(spec: ProductSpec) -> str:
    chips = "".join(f"""
      <div class="ds-card ds-col-2" style="padding:16px">
        <span style="color:var(--text-dim);font-size:.78rem">{_e(x.get('label'))}</span>
        <div class="ds-stat-value" style="font-size:1.4rem;margin-top:4px">{_e(x.get('value'))}</div>
      </div>""" for x in (spec.metrics or [{"label": "Active", "value": "12.4k"},
                                           {"label": "Growth", "value": "+18%"}])[:2])
    return f"""
  <div class="ds-mock ds-rise" style="max-width:980px;margin:0 auto">
    <div class="ds-mock-bar"><i></i><i></i><i></i>
      <span style="margin-left:10px;color:var(--text-dim);font-size:.8rem">{_e(spec.name)} — preview</span></div>
    <div class="ds-mock-body">
      <div class="ds-bento">
        <div class="ds-card ds-col-4 ds-row-2">
          <span class="ds-eyebrow">Overview</span>
          <h3 style="margin-top:6px">{_e(spec.tagline)}</h3>
          {_bars(12)}
        </div>
        {chips}
        <div class="ds-card ds-col-2"><div class="ds-spark"></div></div>
      </div>
    </div>
  </div>"""


# ── Section renderers (landing) ───────────────────────────────────────

def _wrap(sec_id: str, title: str, subtitle: str, inner: str) -> str:
    head = ""
    if title:
        head = (f'<div class="ds-center" style="margin-bottom:40px">'
                f'<h2>{_e(title)}</h2>'
                + (f'<p class="ds-lead" style="margin-top:12px">{_e(subtitle)}</p>' if subtitle else "")
                + "</div>")
    return f'<section class="ds-section ds-container" id="{sec_id}">{head}{inner}</section>'


def _pricing(sec: Section) -> str:
    n = len(sec.items)
    cards = "".join(f"""
    <div class="ds-card ds-rise{' ds-plan-featured' if (n >= 2 and i == 1) else ''}" style="text-align:center">
      {'<span class="ds-badge" style="margin-bottom:12px">Most popular</span>' if (n >= 2 and i == 1) else ''}
      <h3>{_e(c.get('title'))}</h3>
      <div class="ds-stat-value" style="margin:12px 0">{_e(c.get('body'))}</div>
      <p style="font-size:.88rem">{_e(c.get('icon'))}</p>
      <button class="ds-btn {'ds-btn-primary' if (n >= 2 and i == 1) else 'ds-btn-ghost'}" style="margin-top:18px;width:100%">Choose plan</button>
    </div>""" for i, c in enumerate(sec.items))
    return _wrap("pricing", sec.title or "Pricing", sec.subtitle, f'<div class="ds-grid">{cards}</div>')


def _testimonials(sec: Section) -> str:
    cards = "".join(f"""
    <div class="ds-card ds-rise">
      <div style="color:var(--accent-2);font-size:1.1rem">★★★★★</div>
      <p style="color:var(--text);font-size:1.05rem;margin-top:12px">{_e(c.get('title'))}</p>
      <p style="margin-top:14px;font-size:.85rem">{_e(c.get('body'))}</p>
    </div>""" for c in sec.items)
    return _wrap(_slug(sec.title or "customers"), sec.title or "Loved by teams", sec.subtitle, f'<div class="ds-grid">{cards}</div>')


def _faq(sec: Section) -> str:
    items = "".join(f"""
    <details class="ds-card ds-rise" style="cursor:pointer">
      <summary style="font-weight:650;color:var(--text);list-style:none">{_e(c.get('title'))}</summary>
      <p style="margin-top:12px">{_e(c.get('body'))}</p>
    </details>""" for c in sec.items)
    return _wrap("faq", sec.title or "Frequently asked", sec.subtitle,
                 f'<div style="display:grid;gap:12px;max-width:780px;margin:0 auto">{items}</div>')


def _gallery(sec: Section) -> str:
    tiles = "".join(
        f'<div class="ds-card ds-selectable ds-rise" data-select style="aspect-ratio:4/3;'
        f'background:linear-gradient(135deg,color-mix(in srgb,var(--accent) {18+11*i}%,transparent),'
        f'color-mix(in srgb,var(--accent-2) {18+11*i}%,transparent))"></div>'
        for i in range(6))
    return _wrap(_slug(sec.title or "gallery"), sec.title or "Gallery", sec.subtitle,
                 f'<div class="ds-grid" data-select-group>{tiles}</div>')


def _cta(spec: ProductSpec, sec: Section) -> str:
    return f"""
<section class="ds-section ds-container" id="get-started">
  <div class="ds-card ds-glass ds-rise ds-center" style="padding:64px 28px;position:relative;overflow:hidden">
    <span class="ds-eyebrow">Ready when you are</span>
    <h2 style="margin:14px auto 14px;max-width:18ch">{_e(sec.title or 'Get started today')}</h2>
    <p class="ds-lead" style="max-width:44ch;margin:0 auto 28px">{_e(spec.description)}</p>
    <div class="ds-hero-actions"><button class="ds-btn ds-btn-primary" data-scroll="overview">{_e(spec.cta_primary)}</button>
      <button class="ds-btn ds-btn-ghost" data-scroll="features">{_e(spec.cta_secondary)}</button></div>
  </div>
</section>"""


def _landing_section(spec: ProductSpec, sec: Section) -> str:
    if sec.kind == "features":
        return _wrap(_slug(sec.title or "features"), sec.title or "Features", sec.subtitle, _feature_bento(sec.items))
    if sec.kind == "metrics":      return _wrap("metrics", sec.title or "By the numbers", sec.subtitle, _metric_bento(spec))
    if sec.kind == "pricing":      return _pricing(sec)
    if sec.kind == "testimonials": return _testimonials(sec)
    if sec.kind == "faq":          return _faq(sec)
    if sec.kind == "gallery":      return _gallery(sec)
    if sec.kind == "panel":        return _wrap(_slug(sec.title or "preview"), sec.title or "Product preview", sec.subtitle, _mockup(spec))
    if sec.kind == "cta":          return _cta(spec, sec)
    return _wrap(_slug(sec.title or "section"), sec.title, sec.subtitle, _feature_bento(sec.items))


# ── Layouts ───────────────────────────────────────────────────────────

def _logos_row() -> str:
    logos = "".join(f'<span class="ds-logo">{_e(n)}</span>' for n in _LOGOS)
    return f"""
<section class="ds-section ds-container ds-center" id="customers" style="padding-top:24px">
  <p style="color:var(--text-dim);font-size:.82rem;text-transform:uppercase;letter-spacing:.12em;margin-bottom:20px">Trusted by fast-moving teams</p>
  <div class="ds-logos">{logos}</div>
</section>"""


def _hero(spec: ProductSpec, primary_attr: str, secondary_target: str) -> str:
    return f"""
<section class="ds-hero" id="overview">
  <div class="ds-container">
    <span class="ds-badge ds-rise"><span class="ds-badge-dot"></span>{_e(spec.product_type.replace('_',' ').title())}</span>
    <h1 class="ds-rise">{_e(spec.tagline)}</h1>
    <p class="ds-lead ds-rise">{_e(spec.description)}</p>
    <div class="ds-hero-actions ds-rise">
      <button class="ds-btn ds-btn-primary" {primary_attr}>{_e(spec.cta_primary)}</button>
      <button class="ds-btn ds-btn-ghost" data-scroll="{secondary_target}">{_e(spec.cta_secondary)}</button>
    </div>
  </div>
</section>"""


def _marketing(spec: ProductSpec) -> str:
    links = "".join(f'<a data-nav="{_slug(l)}" href="#{_slug(l)}">{_e(l)}</a>' for l in spec.navigation)
    has_pricing = any(s.kind == "pricing" for s in spec.sections)
    primary_target = "pricing" if has_pricing else "get-started"
    secondary_target = next((_slug(s.title or "features") for s in spec.sections if s.kind == "features"), "overview")
    nav = f"""
<header class="ds-nav">
  <div class="ds-nav-brand"><span class="ds-nav-logo"></span>{_e(spec.name)}</div>
  <nav class="ds-nav-links">{links}</nav>
  <button class="ds-btn ds-btn-primary ds-btn-sm" data-scroll="{primary_target}">{_e(spec.cta_primary)}</button>
</header>"""
    parts = [nav, "<main>",
             _hero(spec, f'data-scroll="{primary_target}"', secondary_target),
             f'<section class="ds-section ds-container" style="padding-top:8px">{_mockup(spec)}</section>',
             _logos_row()]
    for sec in spec.sections:
        parts.append(_landing_section(spec, sec))
    parts += ["</main>", _footer(spec)]
    return "\n".join(parts)


def _app_page(spec: ProductSpec, idx: int, label: str) -> str:
    key = label.lower()
    hidden = "" if idx == 0 else " ds-hidden"
    head = f'<div style="margin-bottom:28px"><span class="ds-eyebrow">{_e(spec.name)}</span><h2 style="margin-top:6px">{_e(label)}</h2></div>'
    if idx == 0:
        body = (_metric_bento(spec)
                + f'<div style="margin-top:20px">{_reveal_block_inline(spec)}</div>'
                + f'<div class="ds-bento" style="margin-top:20px"><div class="ds-col-4">{_feature_bento(next((s.items for s in spec.sections if s.kind=="features"), []))}</div><div class="ds-col-2">{_feed(spec)}</div></div>')
        head = f'''<div style="display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:16px;margin-bottom:28px">
          <div><span class="ds-eyebrow">{_e(label)}</span><h1 style="margin-top:8px;font-size:clamp(2rem,4vw,2.75rem)">{_e(spec.tagline)}</h1></div>
          <button class="ds-btn ds-btn-primary" data-reveal="reveal-detail">{_e(spec.cta_primary)}</button></div>'''
    elif re.search(r"progress|analytic|report|insight|market|chart", key):
        body = f'<div class="ds-bento"><div class="ds-card ds-col-4 ds-row-2"><h3>Trends</h3>{_bars(14)}</div><div class="ds-card ds-col-2"><div class="ds-ring" style="--pct:68%"></div></div><div class="ds-card ds-col-2"><div class="ds-spark"></div></div></div>'
    elif re.search(r"profile|setting|account", key):
        body = _settings_panel(spec)
    elif re.search(r"nutrition|activity|transaction|asset|alert|notif|customer", key):
        body = f'<div class="ds-bento"><div class="ds-col-4">{_feed(spec)}</div><div class="ds-col-2">{_metric_card_stack(spec)}</div></div>'
    elif re.search(r"workout|task|chat|plan|library|model", key):
        body = _planner(spec, label)
    else:
        body = _feature_bento(next((s.items for s in spec.sections if s.kind == "features"), []))
    return f'<section class="ds-section ds-container ds-page{hidden}" data-panel="page-{idx}" id="page-{idx}">{head}{body}</section>'


def _metric_card_stack(spec: ProductSpec) -> str:
    return "".join(f"""<div class="ds-card ds-rise" style="margin-bottom:14px">
      <span style="color:var(--text-dim);font-size:.82rem">{_e(m.get('label'))}</span>
      <div class="ds-stat-value" style="font-size:1.5rem;margin-top:4px">{_e(m.get('value'))}</div>
      <span class="ds-stat-delta">{_e(m.get('delta'))}</span></div>""" for m in (spec.metrics or [])[:3])


def _reveal_block_inline(spec: ProductSpec) -> str:
    feats = (next((s.items for s in spec.sections if s.kind == "features"), []) or [])[:3]
    items = feats or [{"title": "Get started", "body": "Begin now.", "icon": "▶"}]
    return (f'<section class="ds-hidden" id="reveal-detail"><h3 style="margin-bottom:14px">{_e(spec.cta_primary)} — your plan</h3>'
            f'{_planner_items(items)}</section>')


def _planner_items(items) -> str:
    rows = "".join(f"""
    <div class="ds-card ds-selectable" data-select style="display:flex;align-items:center;gap:14px;padding:16px">
      {_icon(c.get('icon'))}<div style="flex:1"><h3 style="font-size:1rem">{_e(c.get('title'))}</h3>
      <p style="font-size:.85rem;margin-top:2px">{_e(c.get('body'))}</p></div>
      <span class="ds-btn ds-btn-ghost ds-btn-sm">Start</span></div>""" for c in items)
    return f'<div style="display:grid;gap:12px" data-select-group>{rows}</div>'


def _app(spec: ProductSpec) -> str:
    tabs = "".join(
        f'<a class="{"is-active" if i == 0 else ""}" data-nav="page-{i}">{_e(l)}</a>'
        for i, l in enumerate(spec.navigation)
    )
    nav = f"""
<header class="ds-nav">
  <div class="ds-nav-brand"><span class="ds-nav-logo"></span>{_e(spec.name)}</div>
  <nav class="ds-nav-links">{tabs}</nav>
  <button class="ds-btn ds-btn-primary ds-btn-sm" data-reveal="reveal-detail">{_e(spec.cta_primary)}</button>
</header>"""
    pages = "".join(_app_page(spec, i, l) for i, l in enumerate(spec.navigation))
    return "\n".join([nav, "<main>", pages, _footer(spec)])


def _tile_bg(i: int) -> str:
    return (f"background:linear-gradient(135deg,"
            f"color-mix(in srgb,var(--accent) {20+9*(i%4)}%,var(--surface-2)),"
            f"color-mix(in srgb,var(--accent-2) {16+8*(i%3)}%,var(--surface)))")


# ── Editor layout (notes / docs / writing apps) ───────────────────────

def _editor(spec: ProductSpec) -> str:
    data = spec.data or {}
    folders = data.get("folders") or [{"name": "All Notes", "key": "all", "count": 0}]
    notes = data.get("notes") or [{"title": spec.name, "snippet": "", "body": "", "folder": "all"}]
    folder_rows = "".join(
        f'<div class="ds-folder{" is-active" if i == 0 else ""}" data-folder="{_e(f.get("key","all"))}">'
        f'<span>{_e(f.get("name"))}</span>'
        f'<span class="ds-folder-count">{_e(f.get("count",""))}</span></div>'
        for i, f in enumerate(folders))
    note_items = "".join(
        f'<div class="ds-note-item ds-selectable{" is-selected" if i == 0 else ""}" data-note '
        f'data-in-folder="{_e(n.get("folder","all"))}" '
        f'data-searchable="{_e((str(n.get("title",""))+" "+str(n.get("snippet",""))).lower())}" '
        f'data-title="{_e(n.get("title"))}" data-body="{_e(n.get("body"))}">'
        f'<div class="ds-note-title">{_e(n.get("title"))}</div>'
        f'<div class="ds-note-snippet">{_e(n.get("snippet"))}</div></div>'
        for i, n in enumerate(notes))
    first = notes[0]
    nav = f"""
<header class="ds-nav">
  <div class="ds-nav-brand"><span class="ds-nav-logo"></span>{_e(spec.name)}</div>
  <input class="ds-input" type="text" placeholder="Search notes…" data-search aria-label="Search notes" style="max-width:300px">
  <button class="ds-btn ds-btn-primary ds-btn-sm" data-new-note>{_e(spec.cta_primary)}</button>
</header>"""
    shell = f"""
<div class="ds-container" style="padding-top:22px;padding-bottom:36px">
  <div class="ds-shell">
    <aside class="ds-pane ds-pane-pad" style="display:flex;flex-direction:column;gap:3px">
      <span class="ds-eyebrow" style="padding:4px 12px 8px">Folders</span>
      {folder_rows}
    </aside>
    <section class="ds-pane" aria-label="Notes">
      <div style="padding:14px 16px;border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--surface);z-index:1">
        <h2 style="font-size:1.05rem;letter-spacing:-.01em">All Notes</h2>
      </div>
      <div id="notes-list">{note_items}</div>
    </section>
    <section class="ds-pane" aria-label="Editor">
      <div class="ds-editor">
        <h1 class="ds-editor-title" id="note-title">{_e(first.get("title"))}</h1>
        <div class="ds-editor-body" id="note-body">{_e(first.get("body"))}</div>
      </div>
    </section>
  </div>
</div>"""
    return "\n".join([nav, "<main>", shell, "</main>", _footer(spec)])


# ── Ecommerce layout (storefront) ─────────────────────────────────────

def _ecommerce(spec: ProductSpec) -> str:
    data = spec.data or {}
    cats = data.get("categories") or [{"name": "All", "key": "all"}]
    products = data.get("products") or []
    links = "".join(f'<a data-scroll="{_slug(l)}" href="#{_slug(l)}">{_e(l)}</a>'
                    for l in spec.navigation if l.lower() != "cart")
    nav = f"""
<header class="ds-nav">
  <div class="ds-nav-brand"><span class="ds-nav-logo"></span>{_e(spec.name)}</div>
  <nav class="ds-nav-links">{links}</nav>
  <button class="ds-btn ds-btn-ghost ds-btn-sm" data-scroll="shop">Cart <span class="ds-cart-count" id="cart-count">0</span></button>
</header>"""
    chips = "".join(
        f'<button class="ds-chip{" is-active" if i == 0 else ""}" data-filter="{_e(c.get("key","all"))}">{_e(c.get("name"))}</button>'
        for i, c in enumerate(cats))
    cards = "".join(f"""
    <div class="ds-card ds-rise ds-selectable" data-product="{_e(p.get('name'))}" data-price="{_e(p.get('price'))}"
         data-blurb="{_e(p.get('blurb'))}" data-category="{_e(p.get('category','all'))}">
      <div style="aspect-ratio:4/3;border-radius:var(--radius);margin-bottom:14px;{_tile_bg(i)}"></div>
      <h3 style="font-size:1.05rem">{_e(p.get('name'))}</h3>
      <p style="font-size:.86rem;margin-top:4px">{_e(p.get('blurb'))}</p>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:14px">
        <span class="ds-price">{_e(p.get('price'))}</span>
        <button class="ds-btn ds-btn-primary ds-btn-sm" data-add-cart="Add to cart">Add to cart</button>
      </div>
    </div>""" for i, p in enumerate(products))
    detail = """
<section class="ds-section ds-container ds-hidden" id="product-detail">
  <div class="ds-card ds-glass ds-rise" style="display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:center">
    <div style="aspect-ratio:1;border-radius:var(--radius-lg);background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 26%,var(--surface-2)),color-mix(in srgb,var(--accent-2) 22%,var(--surface)))"></div>
    <div>
      <span class="ds-eyebrow">Product</span>
      <h2 id="detail-name" style="margin-top:6px">Select a product</h2>
      <div class="ds-price" id="detail-price" style="font-size:1.5rem;margin:10px 0">—</div>
      <p id="detail-blurb">Tap any product to see details here.</p>
      <button class="ds-btn ds-btn-primary" data-add-cart="Add to cart" style="margin-top:18px">Add to cart</button>
    </div>
  </div>
</section>"""
    shop = f"""
<section class="ds-section ds-container" id="shop">
  <div class="ds-center" style="margin-bottom:28px"><h2>{_e(spec.tagline)}</h2>
    <p class="ds-lead" style="margin-top:10px">{_e(spec.description)}</p></div>
  <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin-bottom:28px">{chips}</div>
  <div class="ds-grid">{cards}</div>
</section>"""
    hero = _hero(spec, 'data-scroll="shop"', "shop")
    feats = next((s for s in spec.sections if s.kind == "features"), None)
    feat_html = _wrap("collections", "Why shop with us", "", _feature_bento(feats.items, selectable=False)) if feats else ""
    return "\n".join([nav, "<main>", hero, shop, detail, feat_html, "</main>", _footer(spec)])


# ── Booking layout (stays / reservations) ─────────────────────────────

def _booking(spec: ProductSpec) -> str:
    data = spec.data or {}
    rooms = data.get("rooms") or []
    links = "".join(f'<a data-scroll="{_slug(l)}" href="#{_slug(l)}">{_e(l)}</a>'
                    for l in spec.navigation if l.lower() != "book")
    nav = f"""
<header class="ds-nav">
  <div class="ds-nav-brand"><span class="ds-nav-logo"></span>{_e(spec.name)}</div>
  <nav class="ds-nav-links">{links}</nav>
  <button class="ds-btn ds-btn-primary ds-btn-sm" data-scroll="rooms">{_e(spec.cta_primary)}</button>
</header>"""
    datebar = """
<div class="ds-card ds-rise" style="display:flex;gap:14px;flex-wrap:wrap;align-items:end;max-width:760px;margin:0 auto">
  <label style="flex:1;min-width:130px"><span style="font-size:.78rem;color:var(--text-dim)">Check-in</span>
    <input class="ds-input" type="text" value="Fri, 12 Sep" aria-label="Check-in"></label>
  <label style="flex:1;min-width:130px"><span style="font-size:.78rem;color:var(--text-dim)">Check-out</span>
    <input class="ds-input" type="text" value="Sun, 14 Sep" aria-label="Check-out"></label>
  <label style="flex:1;min-width:110px"><span style="font-size:.78rem;color:var(--text-dim)">Guests</span>
    <input class="ds-input" type="text" value="2 guests" aria-label="Guests"></label>
</div>"""
    cards = "".join(f"""
    <div class="ds-card ds-rise ds-selectable" data-room="{_e(r.get('name'))}" data-price="{_e(r.get('price'))} / {_e(r.get('per','night'))}">
      <div style="aspect-ratio:16/10;border-radius:var(--radius);margin-bottom:14px;{_tile_bg(i)}"></div>
      <div style="display:flex;justify-content:space-between;align-items:start;gap:10px">
        <h3 style="font-size:1.1rem">{_e(r.get('name'))}</h3>
        <span class="ds-price">{_e(r.get('price'))}<span style="color:var(--text-dim);font-weight:500;font-size:.8rem"> / {_e(r.get('per','night'))}</span></span>
      </div>
      <p style="font-size:.88rem;margin-top:6px">{_e(r.get('blurb'))}</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        {''.join(f'<span class="ds-chip" style="cursor:default">{_e(x)}</span>' for x in (r.get('features') or []))}
      </div>
      <span class="ds-btn ds-btn-ghost ds-btn-sm" style="margin-top:14px">Select room</span>
    </div>""" for i, r in enumerate(rooms))
    summary = """
<aside id="booking-summary" class="ds-card ds-glass ds-rise ds-hidden" style="position:sticky;top:84px">
  <span class="ds-eyebrow">Your stay</span>
  <h3 style="margin-top:8px">Booking summary</h3>
  <div class="ds-row"><span>Room</span><span class="ds-price" id="summary-room">—</span></div>
  <div class="ds-row"><span>Price</span><span class="ds-price" id="summary-price">—</span></div>
  <button class="ds-btn ds-btn-primary" id="book-btn" data-book style="width:100%;margin-top:16px">Confirm booking</button>
  <div id="book-status" class="ds-badge ds-hidden" style="margin-top:14px"></div>
</aside>"""
    rooms_section = f"""
<section class="ds-section ds-container" id="rooms">
  <div class="ds-center" style="margin-bottom:28px"><h2>Choose your room</h2>
    <p class="ds-lead" style="margin-top:10px">Select a room to see your live booking summary.</p></div>
  <div style="display:grid;grid-template-columns:1fr 320px;gap:24px;align-items:start">
    <div class="ds-grid" data-select-group>{cards}</div>
    {summary}
  </div>
</section>"""
    hero = _hero(spec, 'data-scroll="rooms"', "rooms")
    feats = next((s for s in spec.sections if s.kind == "features"), None)
    feat_html = _wrap("amenities", "What's included", "", _feature_bento(feats.items, selectable=False)) if feats else ""
    return "\n".join([nav, "<main>", hero,
                      f'<section class="ds-section ds-container" style="padding-bottom:0">{datebar}</section>',
                      rooms_section, feat_html, "</main>", _footer(spec)])


def _footer(spec: ProductSpec) -> str:
    links = "".join(f'<a href="#{_slug(l)}" style="margin-right:20px">{_e(l)}</a>' for l in spec.navigation)
    return f"""
<footer class="ds-footer">
  <div class="ds-container" style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:16px;align-items:center">
    <div class="ds-nav-brand"><span class="ds-nav-logo"></span>{_e(spec.name)}</div>
    <div>{links}</div>
    <span>© {_e(spec.name)} · Crafted with Korvix</span>
  </div>
</footer>"""


# ── Document assembly ─────────────────────────────────────────────────

# Layout → renderer. Portfolio reuses the (premium) marketing layout.
_LAYOUT_RENDERERS = {
    "landing":   _marketing,
    "portfolio": _marketing,
    "app":       _app,
    "editor":    _editor,
    "ecommerce": _ecommerce,
    "booking":   _booking,
}


def render_premium_page(spec: ProductSpec) -> str:
    """Render the full premium, interactive HTML document for a spec,
    dispatching by the classified interface layout (with a safe fallback
    to the legacy app/marketing split)."""
    layout = (spec.layout or "").lower() or ("app" if spec.is_dashboard else "landing")
    renderer = _LAYOUT_RENDERERS.get(layout) or (_app if spec.is_dashboard else _marketing)
    body = renderer(spec)
    style = spec.style or None
    accent = spec.theme.get("accent") or "#6366f1"
    accent2 = spec.theme.get("accent2") or "#22d3ee"
    css = design_system_css(accent, accent2, style)
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
    if "viewport" in (html_doc or "").lower():
        return html_doc
    return html_doc.replace(
        "<head>", '<head>\n<meta name="viewport" content="width=device-width, initial-scale=1">', 1,
    ) if "<head>" in html_doc else html_doc


def ensure_csp(html_doc: str) -> str:
    h = html_doc or ""
    if "Content-Security-Policy" in h:
        return h
    meta = f'<meta http-equiv="Content-Security-Policy" content="{_CSP}">'
    if "<head>" in h:
        return h.replace("<head>", "<head>\n" + meta, 1)
    if "<html" in h:
        return re.sub(r"(<html[^>]*>)", lambda mm: mm.group(1) + "\n" + meta, h, count=1)
    return meta + "\n" + h


__all__ = ["render_premium_page", "ensure_viewport", "ensure_csp"]
