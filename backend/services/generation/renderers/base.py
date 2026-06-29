# coding: utf-8
# CRITICAL REBUILD — shared renderer base.
#
# Every product-specific renderer (editor / dashboard / ecommerce / booking
# / landing / portfolio) produces only its <body> markup + an optional CSS
# block. This module owns:
#   * the document shell (doctype, head, strict CSP, viewport, <style>),
#   * a single, shared, sandbox-safe inline interaction script,
#   * small premium HTML helpers (icons, chips, charts, avatars, chrome),
#   * the cross-renderer "shell" CSS (drawers, scrims, kbd, avatars …).
#
# Hard rules: NO external resources, NO network, NO eval. One inline
# <script>. Strict `default-src 'none'` CSP so the preview iframe is safe.

from __future__ import annotations

import html as _html
import re
from typing import List, Optional

from backend.services.generation.design_system import design_system_css
from backend.services.generation.spec import ProductSpec

# ── escaping / ids ────────────────────────────────────────────────────

def e(s) -> str:
    return _html.escape(str(s if s is not None else ""), quote=True)


def slug(s) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(s or "section").lower()).strip("-") or "section"


# ── strict, network-blocking CSP ──────────────────────────────────────

CSP = ("default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; "
       "img-src data:; font-src data:; base-uri 'none'; form-action 'none'")


# ── premium HTML widgets ──────────────────────────────────────────────

_BAR_H = [42, 66, 52, 80, 60, 88, 70, 94, 56, 76, 64, 84, 50, 72]


def icon(glyph: str, cls: str = "ds-icon") -> str:
    return f'<span class="{cls}" aria-hidden="true">{e(glyph or "●")}</span>'


def bars(n: int = 12, cls: str = "ds-bars") -> str:
    cells = "".join(f'<span style="height:{_BAR_H[i % len(_BAR_H)]}%"></span>' for i in range(n))
    return f'<div class="{cls}" aria-hidden="true">{cells}</div>'


def spark() -> str:
    pts = "0,30 10,22 20,26 30,14 40,18 50,8 60,16 70,6 80,12 90,4 100,9"
    return ('<svg class="ds-spark" viewBox="0 0 100 34" preserveAspectRatio="none" aria-hidden="true">'
            f'<polyline points="{pts}" fill="none" stroke="var(--accent-2)" stroke-width="2" '
            'vector-effect="non-scaling-stroke"/>'
            f'<polyline points="0,34 {pts} 100,34" fill="url(#g)" stroke="none" opacity=".18"/>'
            '<defs><linearGradient id="g" x1="0" x2="0" y1="0" y2="1">'
            '<stop offset="0" stop-color="var(--accent)"/><stop offset="1" stop-color="transparent"/>'
            '</linearGradient></defs></svg>')


def ring(pct: int = 72, label: str = "") -> str:
    return (f'<div class="ds-ring" style="--pct:{pct}%"><b>{pct}%</b></div>'
            + (f'<span class="ds-ring-label">{e(label)}</span>' if label else ""))


def avatar(name: str, cls: str = "ds-avatar") -> str:
    initials = "".join(w[0] for w in re.split(r"\s+", str(name or "U").strip())[:2]).upper() or "U"
    return f'<span class="{cls}" aria-hidden="true">{e(initials)}</span>'


def traffic_lights() -> str:
    return ('<span class="ds-traffic" aria-hidden="true">'
            '<i style="background:#ff5f57"></i><i style="background:#febc2e"></i>'
            '<i style="background:#28c840"></i></span>')


def kbd(*keys: str) -> str:
    return "".join(f'<kbd class="ds-kbd">{e(k)}</kbd>' for k in keys)


def feature_items(spec: ProductSpec) -> List[dict]:
    for s in spec.sections:
        if s.kind == "features" and s.items:
            return s.items
    return []


# ── the single shared interaction script (sandbox-safe) ───────────────
# data-nav/panel, data-tab, data-reveal/scroll, data-select, switches,
# notes editor, folder filter, live search, new-note, ecommerce cart +
# filter + product drawer, booking room select + summary + confirm,
# formatting toolbar toggles, generic drawers and steppers.

SCRIPT = r"""
(function(){
  function L(sel, root){ return [].slice.call((root||document).querySelectorAll(sel)); }
  function byId(id){ return document.getElementById(id); }
  function setActive(group, el){ group.forEach(function(n){ n.classList.remove('is-active'); }); if(el){ el.classList.add('is-active'); } }

  // ── Primary nav: switch full panels, else smooth-scroll ──
  var navs = L('[data-nav]'), panels = L('[data-panel]');
  function showPanel(id){
    if(!panels.length){ return false; }
    var hit = false;
    panels.forEach(function(p){ var on = p.getAttribute('data-panel') === id; p.classList.toggle('ds-hidden', !on); if(on){ hit = true; } });
    return hit;
  }
  navs.forEach(function(a){
    a.addEventListener('click', function(ev){
      var id = a.getAttribute('data-nav'); setActive(navs, a);
      var switched = showPanel(id), target = byId(id);
      if(switched){ ev.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
      else if(target){ ev.preventDefault(); target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    });
  });
  if(panels.length){
    var act = navs.filter(function(n){ return n.classList.contains('is-active'); })[0];
    showPanel((act && act.getAttribute('data-nav')) || panels[0].getAttribute('data-panel'));
    if(!act && navs[0]){ navs[0].classList.add('is-active'); }
  }

  // ── Scoped tabs ──
  L('[data-tab]').forEach(function(t){
    t.addEventListener('click', function(ev){
      ev.preventDefault();
      var id = t.getAttribute('data-tab'), grp = t.getAttribute('data-tab-group') || '';
      L('[data-tab][data-tab-group="' + grp + '"]').forEach(function(x){ x.classList.remove('is-active'); });
      t.classList.add('is-active');
      L('[data-tabpanel][data-tab-group="' + grp + '"]').forEach(function(p){ p.classList.toggle('ds-hidden', p.getAttribute('data-tabpanel') !== id); });
    });
  });

  // ── Reveal / scroll ──
  L('[data-reveal]').forEach(function(b){ b.addEventListener('click', function(){ var t = byId(b.getAttribute('data-reveal')); if(t){ t.classList.remove('ds-hidden'); t.classList.add('ds-revealed'); t.scrollIntoView({ behavior: 'smooth', block: 'center' }); } }); });
  L('[data-scroll]').forEach(function(b){ b.addEventListener('click', function(){ var t = byId(b.getAttribute('data-scroll')); if(t){ t.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }); });

  // ── Selectable groups ──
  L('[data-select-group]').forEach(function(g){ var its = L('[data-select]', g); its.forEach(function(it){ it.addEventListener('click', function(){ its.forEach(function(x){ x.classList.remove('is-selected'); }); it.classList.add('is-selected'); }); }); });

  // ── Switches & formatting toolbar toggles ──
  L('.ds-switch').forEach(function(s){ s.addEventListener('click', function(){ s.classList.toggle('is-on'); }); });
  L('[data-format]').forEach(function(b){ b.addEventListener('click', function(ev){ ev.preventDefault(); b.classList.toggle('is-active'); }); });

  // ── Generic drawers / scrims ──
  function openDrawer(id){ var d = byId(id); if(!d){ return; } d.classList.add('is-open'); var sc = byId(d.getAttribute('data-scrim') || 'scrim'); if(sc){ sc.classList.add('is-open'); } }
  function closeDrawers(){ L('.ds-drawer.is-open').forEach(function(d){ d.classList.remove('is-open'); }); L('.ds-scrim.is-open').forEach(function(s){ s.classList.remove('is-open'); }); }
  L('[data-open]').forEach(function(b){ b.addEventListener('click', function(ev){ ev.preventDefault(); openDrawer(b.getAttribute('data-open')); }); });
  L('[data-close]').forEach(function(b){ b.addEventListener('click', function(ev){ ev.preventDefault(); closeDrawers(); }); });
  L('.ds-scrim').forEach(function(s){ s.addEventListener('click', closeDrawers); });

  // ── Numeric steppers (guests, qty) ──
  L('[data-step]').forEach(function(b){
    b.addEventListener('click', function(ev){
      ev.preventDefault();
      var t = byId(b.getAttribute('data-step-target')); if(!t){ return; }
      var d = parseInt(b.getAttribute('data-step'), 10) || 0;
      var v = (parseInt(t.getAttribute('data-val'), 10) || 0) + d;
      if(v < (parseInt(t.getAttribute('data-min'), 10) || 0)){ v = parseInt(t.getAttribute('data-min'), 10) || 0; }
      t.setAttribute('data-val', String(v)); t.textContent = String(v) + (t.getAttribute('data-suffix') || '');
      var mirror = byId(t.getAttribute('data-mirror')); if(mirror){ mirror.textContent = t.textContent; }
    });
  });

  // ── Notes / editor ──
  var eTitle = byId('note-title'), eBody = byId('note-body'), eMeta = byId('note-meta');
  function loadNote(n){ if(!n){ return; } if(eTitle){ eTitle.textContent = n.getAttribute('data-title') || ''; } if(eBody){ eBody.textContent = n.getAttribute('data-body') || ''; } if(eMeta){ eMeta.textContent = n.getAttribute('data-date') || ''; } }
  var notesList = byId('notes-list');
  if(notesList){
    notesList.addEventListener('click', function(ev){
      var n = ev.target.closest ? ev.target.closest('[data-note]') : null; if(!n){ return; }
      L('[data-note]', notesList).forEach(function(x){ x.classList.remove('is-selected'); });
      n.classList.add('is-selected'); loadNote(n);
    });
  }
  L('[data-folder]').forEach(function(f){
    f.addEventListener('click', function(){
      var key = f.getAttribute('data-folder');
      L('[data-folder]').forEach(function(x){ x.classList.remove('is-active'); }); f.classList.add('is-active');
      L('[data-note]').forEach(function(n){ var show = key === 'all' || n.getAttribute('data-in-folder') === key; n.classList.toggle('ds-hidden', !show); });
      var fl = byId('folder-label'); if(fl){ fl.textContent = f.getAttribute('data-folder-name') || f.textContent; }
    });
  });
  L('[data-new-note]').forEach(function(b){
    b.addEventListener('click', function(){
      if(!notesList){ return; }
      var n = document.createElement('div');
      n.className = 'ed-note is-selected'; n.setAttribute('data-note', '');
      n.setAttribute('data-in-folder', 'all'); n.setAttribute('data-searchable', 'untitled note new');
      n.setAttribute('data-title', 'Untitled note'); n.setAttribute('data-body', 'Start writing…'); n.setAttribute('data-date', 'Just now');
      n.innerHTML = '<div class="ed-note-row"><span class="ed-note-title">Untitled note</span><span class="ed-note-time">now</span></div><div class="ed-note-snippet">Start writing…</div>';
      L('[data-note]', notesList).forEach(function(x){ x.classList.remove('is-selected'); });
      notesList.insertBefore(n, notesList.firstChild); loadNote(n);
    });
  });

  // ── Live search (filter anything marked data-searchable) ──
  L('[data-search]').forEach(function(inp){
    inp.addEventListener('input', function(){
      var q = (inp.value || '').toLowerCase();
      L('[data-searchable]').forEach(function(it){ var hay = (it.getAttribute('data-searchable') || it.textContent || '').toLowerCase(); it.classList.toggle('ds-hidden', !!q && hay.indexOf(q) === -1); });
    });
  });

  // ── Ecommerce ──
  L('[data-filter]').forEach(function(f){
    f.addEventListener('click', function(){
      var key = f.getAttribute('data-filter');
      L('[data-filter]').forEach(function(x){ x.classList.remove('is-active'); }); f.classList.add('is-active');
      L('[data-category]').forEach(function(c){ var show = key === 'all' || c.getAttribute('data-category') === key; c.classList.toggle('ds-hidden', !show); });
    });
  });
  var cartCount = byId('cart-count'), cartItems = byId('cart-items'), cartEmpty = byId('cart-empty'), cartTotalEl = byId('cart-total');
  var cart = 0, total = 0;
  function money(n){ return '$' + n.toFixed(2); }
  L('[data-add-cart]').forEach(function(b){
    b.addEventListener('click', function(ev){
      ev.preventDefault(); ev.stopPropagation();
      cart += 1; var price = parseFloat(b.getAttribute('data-price') || '0') || 0; total += price;
      if(cartCount){ cartCount.textContent = String(cart); cartCount.classList.add('is-on'); }
      if(cartTotalEl){ cartTotalEl.textContent = money(total); }
      if(cartEmpty){ cartEmpty.classList.add('ds-hidden'); }
      if(cartItems){
        var name = b.getAttribute('data-name') || 'Item';
        var row = document.createElement('div'); row.className = 'sh-cart-row';
        row.innerHTML = '<span class="sh-cart-thumb"></span><span class="sh-cart-name">' + name + '</span><span class="sh-cart-price">' + money(price) + '</span>';
        cartItems.appendChild(row);
      }
      var label = b.getAttribute('data-label') || b.textContent; b.classList.add('is-added'); b.textContent = 'Added ✓';
      setTimeout(function(){ b.textContent = label; b.classList.remove('is-added'); }, 1100);
    });
  });
  L('[data-product]').forEach(function(p){
    p.addEventListener('click', function(ev){
      if(ev.target.closest && ev.target.closest('[data-add-cart]')){ return; }
      var nm = byId('detail-name'), pr = byId('detail-price'), bl = byId('detail-blurb'), cat = byId('detail-cat');
      if(nm){ nm.textContent = p.getAttribute('data-product') || ''; }
      if(pr){ pr.textContent = p.getAttribute('data-price-label') || ''; }
      if(bl){ bl.textContent = p.getAttribute('data-blurb') || ''; }
      if(cat){ cat.textContent = p.getAttribute('data-category') || ''; }
      var add = byId('detail-add'); if(add){ add.setAttribute('data-price', p.getAttribute('data-price') || '0'); add.setAttribute('data-name', p.getAttribute('data-product') || 'Item'); }
      openDrawer('product-detail');
    });
  });

  // ── Booking ──
  L('[data-room]').forEach(function(r){
    r.addEventListener('click', function(){
      L('[data-room]').forEach(function(x){ x.classList.remove('is-selected'); }); r.classList.add('is-selected');
      var sr = byId('summary-room'), sp = byId('summary-price'), st = byId('summary-total');
      if(sr){ sr.textContent = r.getAttribute('data-room') || ''; }
      if(sp){ sp.textContent = r.getAttribute('data-price') || ''; }
      if(st){ st.textContent = r.getAttribute('data-total') || r.getAttribute('data-price') || ''; }
      var sum = byId('booking-summary'); if(sum){ sum.classList.remove('ds-hidden'); }
      var bk = byId('book-btn'); if(bk){ bk.removeAttribute('disabled'); }
      var status = byId('book-status'); if(status){ status.classList.add('ds-hidden'); }
    });
  });
  L('[data-book]').forEach(function(b){ b.addEventListener('click', function(){ var st = byId('book-status'); if(st){ st.textContent = '✓ Booking confirmed — confirmation sent'; st.classList.remove('ds-hidden'); } }); });
})();
""".strip()


# ── cross-renderer shell CSS (drawers, scrims, chrome, avatars …) ─────

SHELL_CSS = """
/* ── Shared premium shell primitives ── */
.ds-kbd { display:inline-grid; place-items:center; min-width:20px; height:20px; padding:0 6px;
  border-radius:6px; background:var(--surface-2); border:1px solid var(--border-strong);
  border-bottom-width:2px; font-size:.72rem; font-weight:600; color:var(--text-muted); }
.ds-avatar { display:inline-grid; place-items:center; width:34px; height:34px; border-radius:9999px;
  background:var(--grad); color:#fff; font-size:.78rem; font-weight:700; box-shadow:var(--shadow-sm); flex:0 0 auto; }
.ds-traffic { display:inline-flex; gap:8px; align-items:center; }
.ds-traffic i { width:12px; height:12px; border-radius:9999px; display:inline-block; }
.ds-ring { position:relative; width:104px; height:104px; border-radius:9999px;
  background:conic-gradient(var(--accent) var(--pct,72%), var(--surface-2) 0); display:grid; place-items:center; }
.ds-ring::after { content:''; position:absolute; width:78px; height:78px; border-radius:9999px; background:var(--surface); }
.ds-ring b { position:relative; z-index:1; font-size:1.15rem; font-weight:750; }
.ds-ring-label { color:var(--text-dim); font-size:.82rem; }
.ds-spark { width:100%; height:46px; display:block; }
.ds-divider { height:1px; background:var(--border); margin:14px 0; border:0; }

/* Drawers + scrim (product detail, cart) */
.ds-scrim { position:fixed; inset:0; background:rgba(2,4,10,.55); backdrop-filter:blur(2px);
  opacity:0; pointer-events:none; transition:opacity var(--t) var(--ease); z-index:80; }
.ds-scrim.is-open { opacity:1; pointer-events:auto; }
.ds-drawer { position:fixed; top:0; right:0; height:100%; width:min(440px,92vw); z-index:90;
  background:var(--surface); border-left:1px solid var(--border); box-shadow:var(--shadow-lg);
  transform:translateX(102%); transition:transform var(--t-slow) var(--ease); display:flex; flex-direction:column; }
.ds-drawer.is-open { transform:none; }
.ds-drawer-head { display:flex; align-items:center; justify-content:space-between; padding:18px 20px; border-bottom:1px solid var(--border); }
.ds-drawer-body { padding:20px; overflow:auto; flex:1; }
.ds-drawer-foot { padding:18px 20px; border-top:1px solid var(--border); }
.ds-x { width:32px; height:32px; border-radius:9px; display:grid; place-items:center; cursor:pointer;
  background:var(--surface-2); border:1px solid var(--border); color:var(--text-muted); }
.ds-x:hover { color:var(--text); }
""".strip()


def document(spec: ProductSpec, body: str, extra_css: str = "") -> str:
    """Assemble the full HTML document for a renderer body."""
    style = spec.style or None
    accent = (spec.theme or {}).get("accent") or "#6366f1"
    accent2 = (spec.theme or {}).get("accent2") or "#22d3ee"
    css = design_system_css(accent, accent2, style)
    mode_class = "" if spec.dark_mode else "light"
    title = f"{e(spec.name)} — {e(spec.tagline)}" if spec.tagline else e(spec.name)
    return f"""<!DOCTYPE html>
<html lang="en" class="{mode_class}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="{CSP}">
<title>{title}</title>
<meta name="description" content="{e(spec.description)}">
<style>
{css}

{SHELL_CSS}

{extra_css}
</style>
</head>
<body>
{body}
<script>
{SCRIPT}
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
    meta = f'<meta http-equiv="Content-Security-Policy" content="{CSP}">'
    if "<head>" in h:
        return h.replace("<head>", "<head>\n" + meta, 1)
    if "<html" in h:
        return re.sub(r"(<html[^>]*>)", lambda mm: mm.group(1) + "\n" + meta, h, count=1)
    return meta + "\n" + h


__all__ = ["e", "slug", "CSP", "icon", "bars", "spark", "ring", "avatar",
           "traffic_lights", "kbd", "feature_items", "SCRIPT", "SHELL_CSS",
           "document", "ensure_viewport", "ensure_csp"]
