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

from backend.services.generation import component_library as cl
from backend.services.generation.renderers import base
from backend.services.generation.renderers.base import (
    avatar, bars, e, feature_items, icon, ring, spark, svg_icon,
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
.db-link .db-ic { width:20px; display:inline-flex; align-items:center; justify-content:center; opacity:.85; }
.db-link .db-ic .ds-svg-icon { width:18px; height:18px; }
.db-search .ds-svg-icon { width:16px; height:16px; flex:0 0 auto; opacity:.8; }
.db-link:hover { background:var(--surface-2); color:var(--text); }
.db-link:active { transform:scale(.98); }
.db-link.is-active { background:color-mix(in srgb,var(--accent) 16%, var(--surface-2)); color:var(--text);
  box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--accent) 30%, transparent); }
.db-side-foot { margin-top:auto; display:flex; align-items:center; gap:10px; padding:12px 10px; border-top:1px solid var(--border); }
.db-side-foot .nm { font-size:.85rem; font-weight:650; } .db-side-foot .rl { font-size:.74rem; color:var(--text-dim); }
.db-main-col { display:flex; flex-direction:column; min-width:0; }
.ds-nav.db-topbar { gap:14px; }
.db-topbar .db-search { flex:1; max-width:420px; display:flex; align-items:center; gap:9px; padding:8px 13px;
  background:var(--surface-2); border:1px solid var(--border); border-radius:10px; color:var(--text-dim); font-size:.86rem; }
.db-topbar .db-spacer { flex:1; }
.db-iconbtn { position:relative; width:36px; height:36px; border-radius:10px; display:grid; place-items:center; cursor:pointer;
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
/* Sprint 2.2 — dominant hero metric (real visual hierarchy: one big
   focal point before the supporting grid, not equal-weight cards). */
.db-hero-metric { padding:clamp(24px,3vw,38px); border-radius:var(--radius-xl); margin-bottom:28px;
  background:linear-gradient(155deg, color-mix(in srgb, var(--accent) 12%, var(--surface)), var(--surface) 60%);
  border:1px solid var(--border-strong); box-shadow:var(--shadow); }
.db-hero-metric-top { display:flex; align-items:center; justify-content:space-between; gap:28px; margin-bottom:20px; }
.db-hero-metric-value { font-size:clamp(2.2rem,4vw,3.25rem); font-weight:780; letter-spacing:-.03em; margin:8px 0 6px; }
.db-hero-metric-ring .ds-ring { width:84px; height:84px; }
.db-hero-metric .ds-bars { height:96px; }
@media (max-width:640px) { .db-hero-metric-ring { display:none; } }
@media (max-width:900px){
  .db-shell { grid-template-columns:1fr; }
  .db-sidebar { position:static; height:auto; flex-direction:row; flex-wrap:wrap; overflow:visible; }
  .db-side-foot { display:none; }
}
.db-notif-dot { position:absolute; top:6px; right:6px; width:7px; height:7px;
  border-radius:9999px; background:var(--accent-2); }

/* ── Sprint 2.1 — renderer personality per dashboard vertical ── */
.db-personality-fitness .ds-badge { background:linear-gradient(135deg, var(--accent), var(--accent-2)); color:#fff; border-color:transparent; }
.db-personality-fitness .ds-ring { box-shadow:var(--glow); }
.db-personality-finance .cl-watch-sym, .db-personality-finance .ds-stat-value { font-variant-numeric:tabular-nums; }
.db-personality-finance .db-sidebar { background:color-mix(in srgb, var(--surface) 70%, var(--bg)); }
""".strip()

CSS = CSS + "\n\n" + cl.CSS

_PERSONALITY_BY_TYPE = {"fitness": "db-personality-fitness", "crypto": "db-personality-finance",
                        "banking": "db-personality-finance"}

# Sprint 2.2 — sidebar nav icons resolved via the crisp inline-SVG icon
# system (base.svg_icon) instead of emoji glyphs, which render inconsistently
# across OS/browser and read as "generic template" next to the rest of the
# design system. Keyword-matched against the nav LABEL TEXT (reusable across
# every vertical's navigation, never hardcoded per product).
_NAV_ICON_MAP = [
    (re.compile(r"dashboard|overview|home", re.I), "home"),
    (re.compile(r"workout|exercise|train", re.I), "pulse"),
    (re.compile(r"nutrition|meal|diet", re.I), "apple"),
    (re.compile(r"setting", re.I), "gear"),
    (re.compile(r"report", re.I), "document"),
    (re.compile(r"progress|insight", re.I), "chart"),
    (re.compile(r"analytic|stat", re.I), "chart"),
    (re.compile(r"activity|history|log", re.I), "clock"),
    (re.compile(r"profile|account$|players?$", re.I), "person"),
    (re.compile(r"transaction|payment", re.I), "swap"),
    (re.compile(r"account|card", re.I), "card"),
    (re.compile(r"investment|portfolio|market", re.I), "coin"),
    (re.compile(r"asset|record", re.I), "folder"),
    (re.compile(r"alert|notif", re.I), "bell"),
    (re.compile(r"chat|message", re.I), "chat"),
    (re.compile(r"model|\bai\b", re.I), "cpu"),
    (re.compile(r"librar", re.I), "book"),
    (re.compile(r"leaderboard|rank", re.I), "trophy"),
]


def _nav_icon(label: str) -> str:
    for pattern, name in _NAV_ICON_MAP:
        if pattern.search(label or ""):
            return name
    return "dot"


_METRIC_ICON_MAP = [
    (re.compile(r"calor|heart|bpm|pulse", re.I), "heart"),
    (re.compile(r"progress|goal|streak", re.I), "chart"),
    (re.compile(r"balance|spend|revenue|profit|price|\$", re.I), "chart"),
    (re.compile(r"user|member|customer|player", re.I), "person"),
]


def _metric_icon(label: str) -> str:
    for pattern, name in _METRIC_ICON_MAP:
        if pattern.search(label or ""):
            return name
    return "dot"


# ── Sprint 2.2 — dominant hero metric: ONE clear focal point before the
# supporting grid, instead of every overview card competing at equal
# visual weight. Reusable across every dashboard-layout product. ───────

def _hero_metric(spec: ProductSpec) -> str:
    m = (spec.metrics or [{"label": "Overview", "value": "—", "delta": ""}])
    primary = m[0]
    return f"""
  <div class="db-hero-metric ds-rise">
    <div class="db-hero-metric-top">
      <div class="db-hero-metric-copy">
        <span class="ds-eyebrow">{e(primary.get('label', 'Overview'))}</span>
        <div class="db-hero-metric-value">{e(primary.get('value', ''))}</div>
        <span class="ds-stat-delta">{e(primary.get('delta', ''))}</span>
      </div>
      <div class="db-hero-metric-ring">{ring(78, "On track")}</div>
    </div>
    {bars(28)}
  </div>"""


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
    # Sprint 2.1 — the two side cards use the richer gradient-badge metric
    # card (premium_metric_card) instead of a plain label/value/delta
    # stack, so a dashboard's overview never reads as flat stat text.
    cards = "".join(
        f'<div class="ds-col-2">{cl.premium_metric_card(x.get("label", ""), x.get("value", ""), x.get("delta", ""), icon=_metric_icon(x.get("label", "")), trend_positive=not str(x.get("delta", "")).strip().startswith("-"))}</div>'
        for x in m[1:3]
    )
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


# ── Sprint 2.0 — Admin Panel variant: a dense records table page ───────

_SAMPLE_PEOPLE = [
    ("Ava Chen", "Owner", "Active"), ("Marcus Lee", "Editor", "Active"),
    ("Priya Nair", "Viewer", "Invited"), ("Diego Ramirez", "Editor", "Active"),
    ("Sofia Müller", "Viewer", "Suspended"), ("Noah Kim", "Editor", "Active"),
]


_STATUS_TONE = {"active": "positive", "invited": "warning", "suspended": "negative"}


def _records_page(spec: ProductSpec) -> str:
    """Sprint 2.3 — a dense, scannable admin records page: a real
    search+filter command bar (wired into the shared interaction script,
    no new JS) and colored status pills, not a plain unfiltered table."""
    headers = ["Name", "Role", "Status", "Last active"]
    statuses = list(dict.fromkeys(status for _, _, status in _SAMPLE_PEOPLE))
    filters = [{"key": "all", "label": "All"}] + [{"key": s.lower(), "label": s} for s in statuses]
    rows = [
        [e(name), e(role), cl.status_pill(status, _STATUS_TONE.get(status.lower(), "neutral")), e(f"{i + 1}h ago")]
        for i, (name, role, status) in enumerate(_SAMPLE_PEOPLE)
    ]

    def _row_attrs(i, _row):
        name, role, status = _SAMPLE_PEOPLE[i]
        return f' data-category="{e(status.lower())}" data-searchable="{e(f"{name} {role} {status}".lower())}"'

    return (f'<div class="ds-card ds-rise"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">'
            f'<h3>{e(spec.name)} records</h3>'
            f'<button class="ds-btn ds-btn-ghost ds-btn-sm" data-select>+ Add record</button></div>'
            f'{cl.toolbar(filters, "Search records…")}'
            f'<p class="cl-table-caption">{len(_SAMPLE_PEOPLE)} records</p>'
            f'{cl.table(headers, rows, escape_cells=False, row_attrs=_row_attrs)}</div>')


# ── Sprint 2.0 — Analytics Dashboard variant: an insights timeline ─────

def _insights_timeline(spec: ProductSpec) -> str:
    feats = feature_items(spec)[:4] or [{"icon": "chart", "title": "Traffic up", "body": "Steady week-over-week growth."}]
    items = [{"icon": "chart", "title": e_title, "body": e_body, "time": f"{i + 1}h"}
             for i, (e_title, e_body) in enumerate((c.get("title", ""), c.get("body", "")) for c in feats)]
    return f'<div class="ds-card ds-rise" style="margin-top:18px"><h3 style="margin-bottom:14px">Insight timeline</h3>{cl.timeline(items)}</div>'


# ── Sprint 2.1 — Fitness personality: energetic, performance-oriented ──

def _activity_timeline(spec: ProductSpec) -> str:
    feats = feature_items(spec)[:4] or [{"title": "Workout logged", "body": "Great session today."}]
    items = [{"icon": "heart", "title": c.get("title", ""), "body": c.get("body", ""), "time": f"{i + 1}d ago"}
             for i, c in enumerate(feats)]
    return f'<div class="ds-card ds-rise" style="margin-top:18px"><h3 style="margin-bottom:14px">Training timeline</h3>{cl.timeline(items)}</div>'


# ── Sprint 2.0 — shared notifications panel (every dashboard variant) ──

def _notifications(spec: ProductSpec) -> str:
    feats = feature_items(spec)[:4] or [{"icon": "bell", "title": "Welcome", "body": "Your workspace is ready."}]
    items = [{"icon": "bell", "title": c.get("title", ""), "body": c.get("body", ""),
              "time": f"{i + 1}h", "unread": i < 2} for i, c in enumerate(feats)]
    return (f'<section class="ds-hidden ds-card ds-rise" id="reveal-notifications" style="margin:18px 0 0">'
            f'<h3 style="margin-bottom:14px">Notifications</h3>{cl.notifications_panel(items)}</section>')


# ── Sprint 2.1 — Crypto/Trading personality: analytical, not flat text ──

_SAMPLE_TICKERS = [
    ("BTC", "Bitcoin", "$64,210.30", 3.4), ("ETH", "Ethereum", "$3,184.12", -1.2),
    ("SOL", "Solana", "$142.80", 6.7), ("USDC", "USD Coin", "$1.00", 0.0),
]


def _finance_panel(spec: ProductSpec) -> str:
    rows = "".join(cl.watchlist_row(sym, name, price, chg) for sym, name, price, chg in _SAMPLE_TICKERS)
    alloc = (spec.metrics or [])[:3] or [{"label": "Holdings", "value": "—"}]
    allocations = [46, 32, 18]
    cards = "".join(
        cl.portfolio_card(m.get("label", "Asset"), m.get("value", "—"),
                          allocation_pct=allocations[i % len(allocations)], trend_positive=i % 2 == 0)
        for i, m in enumerate(alloc)
    )
    return (f'<div class="ds-bento" style="margin-top:18px">'
            f'<div class="ds-card ds-col-3 ds-rise"><h3 style="margin-bottom:10px">Watchlist</h3>{rows}</div>'
            f'<div class="ds-col-3" style="display:grid;gap:14px">{cards}</div></div>')


def _overview(spec: ProductSpec, label: str) -> str:
    feats = feature_items(spec)[:3]
    cards = "".join(f"""
      <div class="ds-card ds-rise" style="padding:18px">{icon(c.get('icon'))}
        <h3 style="font-size:1.02rem;margin-top:6px">{e(c.get('title'))}</h3>
        <p style="font-size:.86rem;margin-top:4px">{e(c.get('body'))}</p></div>""" for c in feats)
    # Sprint 2.1 — crypto/trading gets an analytical watchlist + portfolio
    # allocation panel right in the overview (its defining personality),
    # in place of a second generic activity feed.
    finance = _finance_panel(spec) if spec.product_type == "crypto" else ""
    perf_secondary = finance or f'<div class="ds-col-2">{_feed(spec)}</div>'
    return f"""
  {_hero_metric(spec)}
  <div class="db-tabs" role="tablist">
    <span class="db-tab is-active" data-tab="seg-week" data-tab-group="ov">This week</span>
    <span class="db-tab" data-tab="seg-month" data-tab-group="ov">This month</span>
    <span class="db-tab" data-tab="seg-quarter" data-tab-group="ov">This quarter</span>
  </div>
  <div data-tabpanel="seg-week" data-tab-group="ov">{_metric_grid(spec)}</div>
  <div data-tabpanel="seg-month" data-tab-group="ov" class="ds-hidden">{_metric_grid(spec)}</div>
  <div data-tabpanel="seg-quarter" data-tab-group="ov" class="ds-hidden">{_metric_grid(spec)}</div>
  {_reveal(spec)}
  <h2 class="ds-subhead">Performance</h2>
  <div class="ds-bento">
    <div class="ds-card ds-col-4 ds-rise"><h3 style="margin-bottom:6px">Trend</h3>{spark()}{bars(18)}</div>
    {perf_secondary}
  </div>
  <h2 class="ds-subhead">Quick actions</h2>
  <div class="ds-grid">{cards}</div>"""


def _page_body(spec: ProductSpec, idx: int, label: str) -> str:
    if idx == 0:
        return _overview(spec, label)
    key = label.lower()
    if re.search(r"record", key):
        return _records_page(spec)
    if re.search(r"progress|analytic|report|insight|market|chart|stat", key):
        body = (f'<div class="ds-bento"><div class="ds-card ds-col-4 ds-row-2 ds-rise"><h3>Trends</h3>{bars(20)}</div>'
                f'<div class="ds-card ds-col-2 ds-rise" style="display:flex;flex-direction:column;align-items:center;gap:10px;justify-content:center">{ring(68,"Goal")}</div>'
                f'<div class="ds-card ds-col-2 ds-rise"><h3 style="margin-bottom:6px">Momentum</h3>{spark()}</div>'
                f'<div class="ds-col-6">{_feed(spec, "Latest updates")}</div></div>')
        if (spec.data or {}).get("variant") == "analytics_dashboard":
            body += _insights_timeline(spec)
        elif spec.product_type == "fitness":
            body += _activity_timeline(spec)
        return body
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
    nav = list(spec.navigation or ["Overview", "Activity", "Reports", "Settings"])
    variant = (spec.data or {}).get("variant", "saas_dashboard")
    if variant == "admin_panel" and not any("record" in n.lower() for n in nav):
        nav.append("Records")
    if variant == "analytics_dashboard" and not any("insight" in n.lower() for n in nav):
        nav.append("Insights")
    links = "".join(
        f'<a class="db-link{" is-active" if i == 0 else ""}" data-nav="page-{i}">'
        f'<span class="db-ic">{svg_icon(_nav_icon(l))}</span>{e(l)}</a>' for i, l in enumerate(nav))
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
      <div class="db-search">{svg_icon('search')} Search {e(spec.name)}…</div>
      <span class="db-spacer"></span>
      <button class="db-iconbtn db-notif-trigger" data-reveal="reveal-notifications" title="Notifications">{svg_icon('bell')}<span class="db-notif-dot"></span></button>
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
    # Notifications panel sits as a top-level <main> sibling (not nested in
    # any data-panel page) so its reveal target is reachable from any tab —
    # the same structural fix Sprint 1.9 applied to the mobile shell's FAB.
    personality = _PERSONALITY_BY_TYPE.get(spec.product_type, "")
    wrap_open = f'<div class="{personality}">' if personality else ""
    wrap_close = "</div>" if personality else ""
    return (f'{wrap_open}<div class="db-shell">{sidebar}<div class="db-main-col">{topbar}'
            f'<main>{"".join(pages)}<div class="db-page" style="padding-top:0">{_notifications(spec)}</div></main>{foot}</div></div>{wrap_close}')


__all__ = ["CSS", "render"]
