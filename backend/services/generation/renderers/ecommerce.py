# coding: utf-8
# CRITICAL REBUILD — ecommerce / storefront renderer.
#
# A real store: sticky store header with a live cart, an editorial hero,
# a category-filterable product grid, a slide-in product detail drawer,
# and a slide-in cart panel with running total + checkout preview.

from __future__ import annotations

from backend.services.generation.renderers import base
from backend.services.generation.renderers.base import e, feature_items, icon, slug, svg_icon
from backend.services.generation.spec import ProductSpec

CSS = """
/* ── Storefront ── */
.sh-nav { gap:16px; }
.sh-nav .sh-links { display:flex; gap:6px; }
.sh-nav .sh-links a { color:var(--text-muted); font-size:.9rem; font-weight:550; padding:8px 12px; border-radius:9px; cursor:pointer; }
.sh-nav .sh-links a:hover { background:var(--surface-2); color:var(--text); }
.sh-cartbtn { display:inline-flex; align-items:center; gap:8px; cursor:pointer; font:inherit; font-weight:600;
  font-size:.88rem; padding:8px 14px; border-radius:10px; background:var(--surface-2); border:1px solid var(--border); color:var(--text); }
.sh-hero { padding:clamp(48px,7vw,96px) 0 clamp(24px,4vw,48px); }
.sh-hero-inner { display:grid; grid-template-columns:1.1fr .9fr; gap:36px; align-items:center; }
.sh-hero h1 { font-size:clamp(2.2rem,4.6vw,3.4rem); letter-spacing:-.03em; }
.sh-hero p { font-size:1.12rem; margin-top:14px; max-width:46ch; }
.sh-hero-art { aspect-ratio:4/3; border-radius:var(--radius-xl); position:relative; overflow:hidden;
  background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 32%,var(--surface-2)),color-mix(in srgb,var(--accent-2) 26%,var(--surface)));
  box-shadow:var(--shadow-lg); }
.sh-filters { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:26px; }
.sh-grid { grid-template-columns:repeat(auto-fill,minmax(min(100%,250px),1fr)); }
.sh-card { padding:0; overflow:hidden; cursor:pointer; }
.sh-thumb { aspect-ratio:1; position:relative; }
.sh-thumb .sh-tag { position:absolute; top:12px; left:12px; font-size:.72rem; font-weight:700; padding:4px 10px;
  border-radius:9999px; background:var(--surface); color:var(--text); box-shadow:var(--shadow-sm); }
.sh-card-body { padding:16px 18px 18px; }
.sh-card-body h3 { font-size:1rem; }
.sh-card-meta { display:flex; align-items:center; justify-content:space-between; margin-top:12px; gap:10px; }
.sh-add { font:inherit; font-weight:650; font-size:.82rem; padding:8px 14px; border-radius:9999px; cursor:pointer;
  background:var(--grad); color:#fff; border:0; box-shadow:var(--glow); transition:transform var(--t) var(--ease); }
.sh-add:hover { transform:translateY(-1px); } .sh-add.is-added { filter:saturate(1.3); }
/* drawers */
.sh-detail-art { aspect-ratio:4/3; border-radius:var(--radius-lg); margin-bottom:16px;
  background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 30%,var(--surface-2)),color-mix(in srgb,var(--accent-2) 22%,var(--surface))); }
.sh-cart-row { display:flex; align-items:center; gap:12px; padding:12px 0; border-bottom:1px solid var(--border); }
.sh-cart-thumb { width:46px; height:46px; border-radius:10px; flex:0 0 auto;
  background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 26%,var(--surface-2)),color-mix(in srgb,var(--accent-2) 20%,var(--surface))); }
.sh-cart-name { flex:1; font-weight:600; font-size:.9rem; } .sh-cart-price { font-weight:700; }
.sh-checkout-line { display:flex; justify-content:space-between; padding:7px 0; color:var(--text-muted); font-size:.9rem; }
.sh-checkout-total { display:flex; justify-content:space-between; padding:12px 0 4px; font-weight:750; font-size:1.05rem; color:var(--text); border-top:1px solid var(--border); margin-top:6px; }
@media (max-width:760px){ .sh-hero-inner { grid-template-columns:1fr; } }
""".strip()


def _thumb(i: int, tag: str = "") -> str:
    bg = (f"background:linear-gradient(135deg,color-mix(in srgb,var(--accent) {20+8*(i%4)}%,var(--surface-2)),"
          f"color-mix(in srgb,var(--accent-2) {16+7*(i%3)}%,var(--surface)))")
    t = f'<span class="sh-tag">{e(tag)}</span>' if tag else ""
    return f'<div class="sh-thumb" style="{bg}">{t}</div>'


def render(spec: ProductSpec) -> str:
    data = spec.data or {}
    cats = data.get("categories") or [{"name": "All", "key": "all"}]
    products = data.get("products") or []
    links = "".join(f'<a data-scroll="{slug(l)}">{e(l)}</a>'
                    for l in spec.navigation if l.lower() not in ("cart",))
    nav = f"""
<header class="ds-nav sh-nav">
  <div class="ds-nav-brand"><span class="ds-nav-logo"></span>{e(spec.name)}</div>
  <nav class="sh-links">{links}</nav>
  <button class="sh-cartbtn" data-open="cart">{svg_icon('bag')} Cart <span class="ds-cart-count" id="cart-count">0</span></button>
</header>"""
    hero = f"""
<section class="sh-hero ds-container"><div class="sh-hero-inner">
  <div><span class="ds-eyebrow">New season</span>
    <h1>{e(spec.tagline)}</h1><p class="ds-lead">{e(spec.description)}</p>
    <div class="ds-hero-actions" style="margin-top:24px">
      <button class="ds-btn ds-btn-primary" data-scroll="shop">{e(spec.cta_primary)}</button>
      <button class="ds-btn ds-btn-ghost" data-open="cart">View cart</button></div></div>
  <div class="sh-hero-art"></div>
</div></section>"""
    chips = "".join(
        f'<button class="ds-chip{" is-active" if i == 0 else ""}" data-filter="{e(c.get("key","all"))}">{e(c.get("name"))}</button>'
        for i, c in enumerate(cats))
    cards = []
    for i, p in enumerate(products):
        price = p.get("price", "$0")
        pnum = "".join(ch for ch in str(price) if ch.isdigit() or ch == ".") or "0"
        cards.append(f"""
    <article class="ds-card ds-rise sh-card" data-product="{e(p.get('name'))}" data-category="{e(p.get('category','all'))}"
      data-price="{e(pnum)}" data-price-label="{e(price)}" data-blurb="{e(p.get('blurb'))}">
      {_thumb(i, p.get('tag',''))}
      <div class="sh-card-body"><h3>{e(p.get('name'))}</h3>
        <p style="font-size:.83rem;margin-top:3px">{e(p.get('blurb'))}</p>
        <div class="sh-card-meta"><span class="ds-price">{e(price)}</span>
          <button class="sh-add" data-add-cart data-price="{e(pnum)}" data-name="{e(p.get('name'))}" data-label="Add">Add</button></div>
      </div></article>""")
    shop = f"""
<section class="ds-section ds-container" id="shop">
  <div class="db-page-head" style="margin-bottom:20px"><div><span class="ds-eyebrow">Shop</span>
    <h2>The collection</h2></div></div>
  <div class="sh-filters">{chips}</div>
  <div class="ds-grid sh-grid">{"".join(cards)}</div>
</section>"""
    feats = feature_items(spec)
    feat_cards = "".join(f"""
    <div class="ds-card ds-rise" style="text-align:center">{icon(c.get('icon'))}
      <h3 style="font-size:1rem;margin-top:8px">{e(c.get('title'))}</h3>
      <p style="font-size:.86rem;margin-top:4px">{e(c.get('body'))}</p></div>""" for c in feats)
    feat_sec = (f'<section class="ds-section ds-container" id="collections"><div class="ds-grid">{feat_cards}</div></section>'
                if feats else "")
    footer = f"""
<footer class="ds-footer"><div class="ds-container" style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:14px;align-items:center">
  <div class="ds-nav-brand"><span class="ds-nav-logo"></span>{e(spec.name)}</div>
  <span>Free shipping over $75 · 30-day returns</span><span>Crafted with Korvix</span></div></footer>"""
    # drawers
    product_drawer = f"""
<aside class="ds-drawer" id="product-detail" data-scrim="scrim">
  <div class="ds-drawer-head"><strong>Product details</strong><span class="ds-x" data-close>{svg_icon('close')}</span></div>
  <div class="ds-drawer-body">
    <div class="sh-detail-art"></div>
    <span class="ds-eyebrow" id="detail-cat">Category</span>
    <h2 id="detail-name" style="margin-top:6px">Select a product</h2>
    <div class="ds-price" id="detail-price" style="font-size:1.5rem;margin:10px 0">—</div>
    <p id="detail-blurb">Tap any product to preview it here.</p>
  </div>
  <div class="ds-drawer-foot">
    <button class="ds-btn ds-btn-primary" id="detail-add" data-add-cart data-price="0" data-name="Item" data-label="Add to cart" style="width:100%">Add to cart</button>
  </div>
</aside>"""
    cart_drawer = f"""
<aside class="ds-drawer" id="cart" data-scrim="scrim">
  <div class="ds-drawer-head"><strong>Your cart</strong><span class="ds-x" data-close>{svg_icon('close')}</span></div>
  <div class="ds-drawer-body">
    <p id="cart-empty" style="color:var(--text-dim)">Your cart is empty — add something you love.</p>
    <div id="cart-items"></div>
  </div>
  <div class="ds-drawer-foot">
    <div class="sh-checkout-line"><span>Subtotal</span><span id="cart-total">$0.00</span></div>
    <div class="sh-checkout-line"><span>Shipping</span><span>Free</span></div>
    <div class="sh-checkout-total"><span>Total</span><span>at checkout</span></div>
    <button class="ds-btn ds-btn-primary" data-reveal="checkout-status" style="width:100%;margin-top:12px">Checkout</button>
    <div id="checkout-status" class="ds-badge ds-hidden" style="margin-top:12px;display:inline-flex;align-items:center;gap:6px">{svg_icon('check')} Order placed — confirmation sent</div>
  </div>
</aside>"""
    return "\n".join([nav, "<main>", hero, shop, feat_sec, "</main>", footer,
                      '<div class="ds-scrim" id="scrim"></div>', product_drawer, cart_drawer])


__all__ = ["CSS", "render"]
