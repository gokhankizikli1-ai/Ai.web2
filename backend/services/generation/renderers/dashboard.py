# coding: utf-8
# CRITICAL REBUILD — dashboard / app renderer.
#
# A real product dashboard: fixed left sidebar navigation + sticky top bar,
# then full pseudo-page panels that switch (overview with metric cards +
# chart mockups + activity feed + tabbed segment + a reveal detail panel;
# plus dedicated analytics / activity / settings / planner pages). No
# marketing hero.

from __future__ import annotations

import re

from backend.services.generation.renderers import base
from backend.services.generation.renderers.base import (
    avatar, bars, e, feature_items, icon, ring, spark,
)
from backend.services.generation.spec import ProductSpec

CSS = """
/* ── Dashboard app shell ── */
.db-shell { display:grid; grid-template-columns:248px 1fr; min-height:100vh; }
.db-sidebar { position:sticky; top:0; align-self:start; height:100vh; display:flex; flex-direction:column;
  gap:4px; padding:18px 14px; background:color-mix(in srgb,var(--surface) 80%, var(--bg));
  border-right:1px solid var(--border); overflow:auto; }
.db-brand { display:flex; align-items:center; gap:11px; font-weight:760; font-size:1.08rem; padding:6px 10px 16px; }
.db-brand .ds-nav-logo { width:30px; height:30px; border-radius:9px; background:var(--grad); box-shadow:var(--glow); }
.db-section-label { font-size:.7rem; font-weight:700; letter-spacing:.08em; text-transform:uppercase;
  color:var(--text-dim); padding:14px 12px 6px; }
.db-link { display:flex; align-items:center; gap:11px; padding:9px 12px; border-radius:10px; cursor:pointer;
  color:var(--text-muted); font-size:.92rem; font-weight:600; transition:all var(--t) var(--ease); }
.db-link .db-ic { width:20px; text-align:center; opacity:.85; }
.db-link:hover { background:var(--surface-2); color:var(--text); }
.db-link.is-active { background:color-mix(in srgb,var(--accent) 16%, var(--surface-2)); color:var(--text);
  box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--accent) 30%, transparent); }
.db-side-foot { margin-top:auto; display:flex; align-items:center; gap:10px; padding:12px 10px; border-top:1px solid var(--border); }
.db-side-foot .nm { font-size:.85rem; font-weight:650; } .db-side-foot .rl { font-size:.74rem; color:var(--text-dim); }
.db-main-col { display:flex; flex-direction:column; min-width:0; }
.ds-nav.db-topbar { gap:14px; }
.db-topbar .db-search { flex:1; max-width:420px; display:flex; align-items:center; gap:9px; padding:8px 13px;
  background:var(--surface-2); border:1px solid var(--border); border-radius:10px; color:var(--text-dim); font-size:.86rem; }
.db-topbar .db-spacer { flex:1; }
.db-iconbtn { width:36px; height:36px; border-radius:10px; display:grid; place-items:center; cursor:pointer;
  background:var(--surface-2); border:1px solid var(--border); color:var(--text-muted); }
.db-iconbtn:hover { color:var(--text); }
.db-page { padding:clamp(20px,3vw,34px); animation:ds-rise var(--t-slow) var(--ease) both; }
.db-page-head { display:flex; align-items:flex-end; justify-content:space-between; flex-wrap:wrap; gap:16px; margin-bottom:22px; }
.db-page-head h1 { font-size:clamp(1.6rem,3vw,2.1rem); }
.db-page-head p { margin-top:4px; }
.db-tabs { display:inline-flex; gap:4px; padding:4px; background:var(--surface-2); border:1px solid var(--border);
  border-radius:11px; margin-bottom:18px; }
.db-tab { padding:7px 15px; border-radius:8px; cursor:pointer; font-size:.85rem; font-weight:600; color:var(--text-muted); }
.db-tab.is-active { background:var(--surface); color:var(--text); box-shadow:var(--shadow-sm); }
.db-foot { margin-top:auto; padding:16px clamp(20px,3vw,34px); border-top:1px solid var(--border);
  display:flex; justify-content:space-between; flex-wrap:wrap; gap:10px; color:var(--text-dim); font-size:.82rem; }
.db-stat { display:flex; flex-direction:column; gap:6px; }
.db-stat .lbl { color:var(--text-dim); font-size:.82rem; }
.db-stat-top { display:flex; align-items:center; justify-content:space-between; }
@media (max-width:900px){
  .db-shell { grid-template-columns:1fr; }
  .db-sidebar { position:static; height:auto; flex-direction:row; flex-wrap:wrap; overflow:visible; }
  .db-side-foot { display:none; }
}
""".strip()

_NAV_ICONS = {
    "dashboard": "▦", "overview": "▦", "home": "▦", "workouts": "🏋", "nutrition": "🍎",
    "progress": "📈", "analytics": "📊", "reports": "🧾", "activity": "🕑", "profile": "👤",
    "settings": "⚙", "accounts": "🏦", "transactions": "💳", "investments": "📈", "cards": "💳",
    "portfolio": "🪙", "markets": "📉", "assets": "🗂", "alerts": "🔔", "chats": "💬",
    "models": "🧠", "library": "📚", "leaderboard": "🏆", "players": "🎮",
}


def _nav_icon(label: str) -> str:
    return _NAV_ICONS.get(label.strip().lower(), "•")


def _metric_grid(spec: ProductSpec) -> str:
    m = (spec.metrics or [])[:4]
    while len(m) < 4:
        m.append({"label": "Metric", "value": "—", "delta": ""})
    chart = f"""
  <div class="ds-card ds-col-4 ds-row-2 ds-rise">
    <div class="db-stat-top"><div class="db-stat"><span class="lbl">{e(m[0].get('label'))}</span>
      <span class="ds-stat-value">{e(m[0].get('value'))}</span>
      <span class="ds-stat-delta">{e(m[0].get('delta'))}</span></div>
      <span class="ds-badge"><span class="ds-badge-dot"></span>Live</span></div>
    {bars(16)}
  </div>"""
    cards = "".join(f"""
  <div class="ds-card ds-col-2 ds-rise"><div class="db-stat"><span class="lbl">{e(x.get('label'))}</span>
    <span class="ds-stat-value" style="font-size:1.55rem">{e(x.get('value'))}</span>
    <span class="ds-stat-delta">{e(x.get('delta'))}</span></div></div>""" for x in m[1:3])
    ringcard = f"""
  <div class="ds-card ds-col-2 ds-rise" style="display:flex;flex-direction:column;align-items:center;gap:12px;justify-content:center">
    {ring(74, m[3].get('label','Goal'))}</div>"""
    return f'<div class="ds-bento">{chart}{cards}{ringcard}</div>'


def _feed(spec: ProductSpec, title: str = "Recent activity") -> str:
    feats = feature_items(spec)[:5] or [{"icon": "✓", "title": "Updated", "body": "Just now"}]
    rows = "".join(f"""
    <div class="ds-feed-item"><span class="ds-feed-dot">{e(c.get('icon','●'))}</span>
      <div><div style="color:var(--text);font-weight:600;font-size:.92rem">{e(c.get('title'))}</div>
        <div style="color:var(--text-dim);font-size:.82rem">{e(c.get('body'))}</div></div>
      <span style="margin-left:auto;color:var(--text-dim);font-size:.76rem">just now</span></div>""" for c in feats)
    return f'<div class="ds-card ds-rise"><h3 style="margin-bottom:8px">{e(title)}</h3><div class="ds-feed">{rows}</div></div>'


def _planner(spec: ProductSpec) -> str:
    items = feature_items(spec)[:4] or [{"icon": "▶", "title": "Get started", "body": "Begin now."}]
    rows = "".join(f"""
    <div class="ds-card ds-selectable ds-rise" data-select style="display:flex;align-items:center;gap:14px;padding:16px">
      {icon(c.get('icon'))}<div style="flex:1"><h3 style="font-size:1rem">{e(c.get('title'))}</h3>
        <p style="font-size:.86rem;margin-top:2px">{e(c.get('body'))}</p></div>
      <span class="ds-btn ds-btn-ghost ds-btn-sm">Open</span></div>""" for c in items)
    return f'<div style="display:grid;gap:12px" data-select-group>{rows}</div>'


def _settings(spec: ProductSpec) -> str:
    toggles = [("Email notifications", True), ("Weekly summary", True),
               ("Dark appearance", bool(spec.dark_mode)), ("Two-factor auth", False)]
    rows = "".join(f"""
    <div class="ds-row"><div><div style="color:var(--text);font-weight:600">{e(l)}</div>
      <div style="color:var(--text-dim);font-size:.82rem">Manage your {e(l.lower())}.</div></div>
      <div class="ds-switch{' is-on' if on else ''}" role="switch" tabindex="0"></div></div>""" for l, on in toggles)
    return f"""
    <div style="display:grid;grid-template-columns:1fr;gap:18px;max-width:640px">
      <div class="ds-card ds-rise" style="display:flex;align-items:center;gap:14px">
        {avatar(spec.name)}<div><h3>{e(spec.name)} workspace</h3>
        <p style="font-size:.86rem">{e(spec.audience)}</p></div></div>
      <div class="ds-card ds-rise">{rows}</div>
    </div>"""


def _reveal(spec: ProductSpec) -> str:
    return (f'<section class="ds-hidden ds-card ds-rise" id="reveal-detail" style="margin:18px 0 0">'
            f'<h3 style="margin-bottom:14px">{e(spec.cta_primary)} — recommended for you</h3>'
            f'{_planner(spec)}</section>')


def _overview(spec: ProductSpec, label: str) -> str:
    feats = feature_items(spec)[:3]
    cards = "".join(f"""
      <div class="ds-card ds-rise" style="padding:18px">{icon(c.get('icon'))}
        <h3 style="font-size:1.02rem;margin-top:6px">{e(c.get('title'))}</h3>
        <p style="font-size:.86rem;margin-top:4px">{e(c.get('body'))}</p></div>""" for c in feats)
    return f"""
  <div class="db-tabs" role="tablist">
    <span class="db-tab is-active" data-tab="seg-week" data-tab-group="ov">This week</span>
    <span class="db-tab" data-tab="seg-month" data-tab-group="ov">This month</span>
    <span class="db-tab" data-tab="seg-quarter" data-tab-group="ov">This quarter</span>
  </div>
  <div data-tabpanel="seg-week" data-tab-group="ov">{_metric_grid(spec)}</div>
  <div data-tabpanel="seg-month" data-tab-group="ov" class="ds-hidden">{_metric_grid(spec)}</div>
  <div data-tabpanel="seg-quarter" data-tab-group="ov" class="ds-hidden">{_metric_grid(spec)}</div>
  {_reveal(spec)}
  <h2 style="font-size:1.25rem;margin:26px 0 14px">Performance</h2>
  <div class="ds-bento">
    <div class="ds-card ds-col-4 ds-rise"><h3 style="margin-bottom:6px">Trend</h3>{spark()}{bars(18)}</div>
    <div class="ds-col-2">{_feed(spec)}</div>
  </div>
  <h2 style="font-size:1.25rem;margin:26px 0 14px">Quick actions</h2>
  <div class="ds-grid">{cards}</div>"""


def _page_body(spec: ProductSpec, idx: int, label: str) -> str:
    if idx == 0:
        return _overview(spec, label)
    key = label.lower()
    if re.search(r"progress|analytic|report|insight|market|chart|stat", key):
        return (f'<div class="ds-bento"><div class="ds-card ds-col-4 ds-row-2 ds-rise"><h3>Trends</h3>{bars(20)}</div>'
                f'<div class="ds-card ds-col-2 ds-rise" style="display:flex;flex-direction:column;align-items:center;gap:10px;justify-content:center">{ring(68,"Goal")}</div>'
                f'<div class="ds-card ds-col-2 ds-rise"><h3 style="margin-bottom:6px">Momentum</h3>{spark()}</div>'
                f'<div class="ds-col-6">{_feed(spec, "Latest updates")}</div></div>')
    if re.search(r"setting|profile|account$|cards", key):
        return _settings(spec)
    if re.search(r"activit|transaction|asset|alert|notif|customer|order|history", key):
        return (f'<div class="ds-bento"><div class="ds-col-4">{_feed(spec, label)}</div>'
                f'<div class="ds-card ds-col-2 ds-rise"><h3 style="margin-bottom:8px">Summary</h3>'
                + "".join(f'<div class="db-stat" style="margin-bottom:12px"><span class="lbl">{e(m.get("label"))}</span>'
                          f'<span class="ds-stat-value" style="font-size:1.4rem">{e(m.get("value"))}</span>'
                          f'<span class="ds-stat-delta">{e(m.get("delta"))}</span></div>' for m in (spec.metrics or [])[:3])
                + '</div></div>')
    if re.search(r"workout|task|plan|library|model|chat|account", key):
        return _planner(spec)
    return _overview(spec, label)


def render(spec: ProductSpec) -> str:
    nav = spec.navigation or ["Overview", "Activity", "Reports", "Settings"]
    links = "".join(
        f'<a class="db-link{" is-active" if i == 0 else ""}" data-nav="page-{i}">'
        f'<span class="db-ic">{e(_nav_icon(l))}</span>{e(l)}</a>' for i, l in enumerate(nav))
    sidebar = f"""
  <aside class="db-sidebar">
    <div class="db-brand"><span class="ds-nav-logo"></span>{e(spec.name)}</div>
    <span class="db-section-label">Menu</span>
    {links}
    <div class="db-side-foot">{avatar(spec.name)}<div><div class="nm">{e(spec.name)}</div>
      <div class="rl">Pro workspace</div></div></div>
  </aside>"""
    topbar = f"""
    <header class="ds-nav db-topbar">
      <div class="db-search">🔍 Search {e(spec.name)}…</div>
      <span class="db-spacer"></span>
      <button class="db-iconbtn" title="Notifications">🔔</button>
      <button class="ds-btn ds-btn-primary ds-btn-sm" data-reveal="reveal-detail">{e(spec.cta_primary)}</button>
      {avatar(spec.name)}
    </header>"""
    pages = []
    for i, l in enumerate(nav):
        hidden = "" if i == 0 else " ds-hidden"
        head = (f'<div class="db-page-head"><div><span class="ds-eyebrow">{e(l)}</span>'
                f'<h1>{e(spec.tagline if i == 0 else l)}</h1>'
                f'<p>{e(spec.description if i == 0 else "Everything you need for " + l.lower() + ".")}</p></div>'
                + (f'<button class="ds-btn ds-btn-primary" data-reveal="reveal-detail">{e(spec.cta_primary)}</button>' if i == 0 else '')
                + '</div>')
        pages.append(f'<section class="db-page ds-page{hidden}" data-panel="page-{i}" id="page-{i}">{head}{_page_body(spec, i, l)}</section>')
    foot = (f'<footer class="ds-footer db-foot"><span>© {e(spec.name)} · all systems operational</span>'
            f'<span>Crafted with Korvix</span></footer>')
    return f'<div class="db-shell">{sidebar}<div class="db-main-col">{topbar}<main>{"".join(pages)}</main>{foot}</div></div>'


__all__ = ["CSS", "render"]
