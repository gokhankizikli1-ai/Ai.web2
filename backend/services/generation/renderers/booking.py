# coding: utf-8
# CRITICAL REBUILD — booking renderer.
#
# A real booking flow: hero with a search bar (dates + a working guests
# stepper), a grid of detailed room cards that select into a sticky live
# booking summary, then a confirmation state.

from __future__ import annotations

from backend.services.generation.renderers import base
from backend.services.generation.renderers.base import e, feature_items, icon, slug
from backend.services.generation.spec import ProductSpec

CSS = """
/* ── Booking ── */
.bk-nav .bk-links { display:flex; gap:6px; }
.bk-nav .bk-links a { color:var(--text-muted); font-size:.9rem; font-weight:550; padding:8px 12px; border-radius:9px; cursor:pointer; }
.bk-nav .bk-links a:hover { background:var(--surface-2); color:var(--text); }
.bk-hero { padding:clamp(48px,7vw,104px) 0 0; text-align:center; }
.bk-hero h1 { font-size:clamp(2.2rem,5vw,3.6rem); letter-spacing:-.03em; max-width:18ch; margin:0 auto; }
.bk-hero p { font-size:1.14rem; margin:14px auto 0; max-width:52ch; }
.bk-searchbar { display:flex; flex-wrap:wrap; gap:6px; align-items:stretch; max-width:840px; margin:30px auto 0;
  padding:8px; background:var(--surface); border:1px solid var(--border-strong); border-radius:9999px; box-shadow:var(--shadow); }
.bk-field { flex:1; min-width:140px; text-align:left; padding:8px 18px; border-radius:9999px; cursor:pointer; }
.bk-field:hover { background:var(--surface-2); }
.bk-field .lbl { display:block; font-size:.72rem; font-weight:700; text-transform:uppercase; letter-spacing:.05em; color:var(--text-dim); }
.bk-field .val { font-size:.95rem; font-weight:600; color:var(--text); }
.bk-stepper { display:inline-flex; align-items:center; gap:12px; }
.bk-step { width:26px; height:26px; border-radius:9999px; border:1px solid var(--border-strong); background:var(--surface-2);
  color:var(--text); cursor:pointer; font-weight:700; display:grid; place-items:center; }
.bk-search-btn { border:0; border-radius:9999px; padding:0 26px; background:var(--grad); color:#fff; font-weight:700;
  cursor:pointer; box-shadow:var(--glow); }
.bk-layout { display:grid; grid-template-columns:1fr 340px; gap:26px; align-items:start; }
.bk-rooms { display:grid; gap:18px; }
.bk-room { display:grid; grid-template-columns:200px 1fr; gap:0; padding:0; overflow:hidden; cursor:pointer; }
.bk-room-art { background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 30%,var(--surface-2)),color-mix(in srgb,var(--accent-2) 22%,var(--surface))); }
.bk-room-body { padding:18px 20px; }
.bk-room.is-selected { box-shadow:0 0 0 2px var(--accent), var(--shadow); }
.bk-feats { display:flex; flex-wrap:wrap; gap:7px; margin-top:10px; }
.bk-feat { font-size:.76rem; padding:4px 10px; border-radius:9999px; background:var(--surface-2); border:1px solid var(--border); color:var(--text-muted); }
.bk-room-foot { display:flex; align-items:center; justify-content:space-between; margin-top:14px; }
.bk-summary { position:sticky; top:84px; }
.bk-sum-row { display:flex; align-items:center; justify-content:space-between; padding:11px 0; border-bottom:1px solid var(--border); }
.bk-sum-row:last-of-type { border-bottom:0; }
@media (max-width:860px){ .bk-layout { grid-template-columns:1fr; } .bk-room { grid-template-columns:1fr; } .bk-room-art { min-height:150px; } }
""".strip()


def render(spec: ProductSpec) -> str:
    data = spec.data or {}
    rooms = data.get("rooms") or []
    links = "".join(f'<a data-scroll="{slug(l)}">{e(l)}</a>'
                    for l in spec.navigation if l.lower() not in ("book",))
    nav = f"""
<header class="ds-nav bk-nav">
  <div class="ds-nav-brand"><span class="ds-nav-logo"></span>{e(spec.name)}</div>
  <nav class="bk-links">{links}</nav>
  <button class="ds-btn ds-btn-primary ds-btn-sm" data-scroll="rooms">{e(spec.cta_primary)}</button>
</header>"""
    searchbar = """
  <div class="bk-searchbar">
    <div class="bk-field"><span class="lbl">Check-in</span><span class="val">Fri, 12 Sep</span></div>
    <div class="bk-field"><span class="lbl">Check-out</span><span class="val">Sun, 14 Sep</span></div>
    <div class="bk-field"><span class="lbl">Guests</span>
      <span class="bk-stepper"><button class="bk-step" data-step="-1" data-step-target="guest-count" aria-label="Fewer guests">−</button>
      <span class="val" id="guest-count" data-val="2" data-min="1" data-suffix=" guests" data-mirror="summary-guests">2 guests</span>
      <button class="bk-step" data-step="1" data-step-target="guest-count" aria-label="More guests">+</button></span></div>
    <button class="bk-search-btn" data-scroll="rooms">Search</button>
  </div>"""
    hero = f"""
<section class="bk-hero ds-container">
  <span class="ds-eyebrow">{e(spec.product_type.replace('_',' ').title())}</span>
  <h1>{e(spec.tagline)}</h1><p class="ds-lead">{e(spec.description)}</p>
  {searchbar}
</section>"""
    room_cards = []
    for i, r in enumerate(rooms):
        feats = "".join(f'<span class="bk-feat">{e(x)}</span>' for x in (r.get("features") or []))
        price = r.get("price", "$0")
        per = r.get("per", "night")
        room_cards.append(f"""
    <article class="ds-card ds-rise bk-room" data-room="{e(r.get('name'))}"
      data-price="{e(price)} / {e(per)}" data-total="{e(r.get('total', price))} · 2 nights">
      <div class="bk-room-art"></div>
      <div class="bk-room-body"><h3 style="font-size:1.15rem">{e(r.get('name'))}</h3>
        <p style="font-size:.88rem;margin-top:5px">{e(r.get('blurb'))}</p>
        <div class="bk-feats">{feats}</div>
        <div class="bk-room-foot"><span class="ds-price">{e(price)}<span style="color:var(--text-dim);font-weight:500;font-size:.8rem"> / {e(per)}</span></span>
          <span class="ds-btn ds-btn-ghost ds-btn-sm">Select room</span></div></div>
    </article>""")
    summary = """
  <aside class="ds-card ds-glass ds-rise bk-summary" id="booking-summary" aria-label="Booking summary">
    <span class="ds-eyebrow">Your stay</span><h3 style="margin-top:8px">Booking summary</h3>
    <div class="bk-sum-row"><span>Dates</span><span>12–14 Sep · 2 nights</span></div>
    <div class="bk-sum-row"><span>Guests</span><span id="summary-guests">2 guests</span></div>
    <div class="bk-sum-row"><span>Room</span><span class="ds-price" id="summary-room">Select a room</span></div>
    <div class="bk-sum-row"><span>Rate</span><span class="ds-price" id="summary-price">—</span></div>
    <div class="bk-sum-row"><span>Total</span><span class="ds-price" id="summary-total">—</span></div>
    <button class="ds-btn ds-btn-primary" id="book-btn" data-book disabled style="width:100%;margin-top:14px">Confirm booking</button>
    <div id="book-status" class="ds-badge ds-hidden" style="margin-top:12px"></div>
  </aside>"""
    rooms_sec = f"""
<section class="ds-section ds-container" id="rooms">
  <div class="db-page-head" style="margin-bottom:20px"><div><span class="ds-eyebrow">Available rooms</span>
    <h2>Choose your room</h2><p>Select a room to build your live booking summary.</p></div></div>
  <div class="bk-layout"><div class="bk-rooms">{"".join(room_cards)}</div>{summary}</div>
</section>"""
    feats = feature_items(spec)
    feat_cards = "".join(f"""
    <div class="ds-card ds-rise" style="text-align:center">{icon(c.get('icon'))}
      <h3 style="font-size:1rem;margin-top:8px">{e(c.get('title'))}</h3>
      <p style="font-size:.86rem;margin-top:4px">{e(c.get('body'))}</p></div>""" for c in feats)
    feat_sec = (f'<section class="ds-section ds-container" id="amenities"><div class="db-page-head" style="margin-bottom:18px"><div><h2>What\'s included</h2></div></div><div class="ds-grid">{feat_cards}</div></section>'
                if feats else "")
    footer = f"""
<footer class="ds-footer"><div class="ds-container" style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:14px;align-items:center">
  <div class="ds-nav-brand"><span class="ds-nav-logo"></span>{e(spec.name)}</div>
  <span>Free cancellation · Best-price guarantee</span><span>Crafted with Korvix</span></div></footer>"""
    return "\n".join([nav, "<main>", hero, rooms_sec, feat_sec, "</main>", footer])


__all__ = ["CSS", "render"]
