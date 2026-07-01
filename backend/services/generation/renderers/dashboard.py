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
from typing import List, Tuple

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

_NAV_ICONS = {
    "dashboard": "▦", "overview": "▦", "home": "▦", "workouts": "🏋", "nutrition": "🍎",
    "progress": "📈", "analytics": "📊", "reports": "🧾", "activity": "🕑", "profile": "👤",
    "settings": "⚙", "accounts": "🏦", "transactions": "💳", "investments": "📈", "cards": "💳",
    "portfolio": "🪙", "markets": "📉", "assets": "🗂", "alerts": "🔔", "chats": "💬",
    "models": "🧠", "library": "📚", "leaderboard": "🏆", "players": "🎮",
    # Sprint 2.2 — diversified generic verticals (finance ops / ecommerce
    # ops / CRM / SaaS-AI / health / education) + the richer generic
    # fallback nav.
    "command center": "🎯", "command": "🎯", "signals": "📡", "risk": "🛡", "insights": "📊",
    "products": "📦", "orders": "🧾", "customers": "🧑", "campaigns": "📣",
    "pipeline": "🧭", "leads": "🎯", "tasks": "✅", "forecast": "📈",
    "workspace": "🗂", "automations": "⚡", "team": "🧑", "integrations": "🔌",
    "plans": "🗺", "coaching": "🎯", "courses": "🎓", "lessons": "📚", "community": "💬",
    "workflows": "🧭",
}


def _nav_icon(label: str) -> str:
    return _NAV_ICONS.get(label.strip().lower(), "•")


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
    # Sprint 2.2 — grouped settings sections (Account / Workspace / Security)
    # instead of one flat toggle list, so a Settings page has real hierarchy.
    groups = [
        ("Account", [("Email notifications", True), ("Weekly summary", True)]),
        ("Workspace", [("Dark appearance", bool(spec.dark_mode)), ("Compact density", False)]),
        ("Security", [("Two-factor auth", False), ("Login alerts", True)]),
    ]
    section_html = "".join(f"""
    <div class="ds-card ds-rise" style="margin-bottom:14px">
      <div class="db-section-label" style="padding:0 0 10px">{e(title)}</div>
      {"".join(f'''
      <div class="ds-row"><div><div style="color:var(--text);font-weight:600">{e(l)}</div>
        <div style="color:var(--text-dim);font-size:.82rem">Manage your {e(l.lower())}.</div></div>
        <div class="ds-switch{" is-on" if on else ""}" role="switch" tabindex="0"></div></div>''' for l, on in rows)}
    </div>""" for title, rows in groups)
    return f"""
    <div style="display:grid;grid-template-columns:1fr;gap:4px;max-width:640px">
      <div class="ds-card ds-rise" style="display:flex;align-items:center;gap:14px;margin-bottom:14px">
        {avatar(spec.name)}<div><h3>{e(spec.name)} workspace</h3>
        <p style="font-size:.86rem">{e(spec.audience)}</p></div></div>
      {section_html}
    </div>"""


# ── Sprint 2.2 — realistic table/card pages for the diversified generic
# verticals (ecommerce ops / CRM): Products, Orders, Campaigns, Pipeline,
# Leads, Forecast. Keyword-matched on the page LABEL, not the vertical, so
# it works for any nav that uses these words.

_TABLE_KIND_RULES: List[Tuple[re.Pattern, str]] = [
    (re.compile(r"product"), "products"),
    (re.compile(r"\borders?\b"), "orders"),
    (re.compile(r"campaign"), "campaigns"),
    (re.compile(r"pipeline|deal"), "pipeline"),
    (re.compile(r"lead"), "leads"),
    (re.compile(r"forecast"), "forecast"),
]

_TABLE_ADD_LABELS = {
    "products": "Product",
    "orders": "Order",
    "campaigns": "Campaign",
    "pipeline": "Deal",
    "leads": "Lead",
}


def _table_rows(kind: str, spec: ProductSpec):
    if kind == "products":
        return (["Product", "Price", "Stock", "Status"], [
            ["Runner Low", "$148", "42 in stock", "Active"],
            ["Trail Boot", "$220", "18 in stock", "Active"],
            ["Shell Jacket", "$320", "6 in stock", "Low stock"],
            ["Wool Overcoat", "$410", "0 in stock", "Out of stock"],
            ["Leather Tote", "$180", "27 in stock", "Active"],
        ])
    if kind == "orders":
        return (["Order", "Customer", "Total", "Status"], [
            ["#1048", "Ava Chen", "$148", "Fulfilled"],
            ["#1049", "Marcus Lee", "$220", "Packing"],
            ["#1050", "Priya Nair", "$388", "Paid"],
            ["#1051", "Diego Ramirez", "$68", "Processing"],
        ])
    if kind == "campaigns":
        return (["Campaign", "Channel", "Spend", "Conversions"], [
            ["Spring Launch", "Email", "$1,200", "312"],
            ["Retarget — Cart", "Paid Social", "$860", "148"],
            ["Search — Brand", "Search", "$540", "204"],
            ["Influencer Drop", "Social", "$2,100", "96"],
        ])
    if kind == "pipeline":
        return (["Deal", "Stage", "Value", "Owner"], [
            ["Northwind Logistics", "Negotiation", "$84,000", "Ava Chen"],
            ["Mercura Retail", "Proposal", "$52,000", "Marcus Lee"],
            ["Cobalt Finance", "Discovery", "$120,000", "Priya Nair"],
            ["Lumio Group", "Closed won", "$36,000", "Diego Ramirez"],
        ])
    if kind == "leads":
        return (["Lead", "Company", "Stage", "Value"], [
            ["Ava Chen", "Northwind", "Qualified", "$18,000"],
            ["Marcus Lee", "Mercura", "New", "$9,500"],
            ["Priya Nair", "Cobalt", "Contacted", "$42,000"],
            ["Diego Ramirez", "Lumio", "Qualified", "$27,000"],
        ])
    if kind == "forecast":
        return (["Period", "Target", "Forecast", "Variance"], [
            ["This month", "$120k", "$132k", "+10%"],
            ["Next month", "$130k", "$118k", "-9%"],
            ["Quarter", "$390k", "$402k", "+3%"],
        ])
    return (["Metric", "Value", "Change"],
            [[m.get("label", "—"), m.get("value", "—"), m.get("delta", "")] for m in (spec.metrics or [])[:5]])


def _data_table_page(spec: ProductSpec, label: str) -> str:
    kind = "generic"
    for pattern, name in _TABLE_KIND_RULES:
        if pattern.search(label.lower()):
            kind = name
            break
    headers, rows = _table_rows(kind, spec)
    stat_cards = "".join(
        f'<div class="ds-col-2"><div class="ds-card ds-rise db-stat">'
        f'<span class="lbl">{e(m.get("label"))}</span>'
        f'<span class="ds-stat-value" style="font-size:1.3rem">{e(m.get("value"))}</span>'
        f'<span class="ds-stat-delta">{e(m.get("delta"))}</span></div></div>'
        for m in (spec.metrics or [])[:3]
    )
    add_label = _TABLE_ADD_LABELS.get(kind, label)
    return (
        (f'<div class="ds-bento" style="margin-bottom:16px">{stat_cards}</div>' if stat_cards else "")
        + f'<div class="ds-card ds-rise"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">'
        f'<h3>{e(label)}</h3><button class="ds-btn ds-btn-ghost ds-btn-sm" data-select>+ Add {e(add_label)}</button></div>'
        f'{cl.table(headers, rows)}</div>'
    )


# ── Sprint 2.2 — integrations + team pages (SaaS/AI vertical) ──────────

_INTEGRATIONS = [
    ("Slack", "Team notifications and alerts", True),
    ("Google Drive", "Sync files and documents", True),
    ("Stripe", "Payments and billing", False),
    ("Zapier", "Connect thousands of apps", False),
    ("GitHub", "Link code and deployments", True),
    ("Notion", "Sync docs and wikis", False),
]


def _integrations_page(spec: ProductSpec) -> str:
    cards = "".join(f"""
    <div class="ds-card ds-rise" style="display:flex;align-items:center;gap:14px;padding:16px">
      {avatar(name)}
      <div style="flex:1"><h3 style="font-size:.98rem">{e(name)}</h3>
        <p style="font-size:.84rem;margin-top:2px">{e(desc)}</p></div>
      {cl.status_pill("Connected" if connected else "Connect", "positive" if connected else "neutral")}
    </div>""" for name, desc, connected in _INTEGRATIONS)
    return f'<div style="display:grid;gap:12px">{cards}</div>'


_TEAM_SAMPLE = [
    ("Ava Chen", "Product Lead", "Active"), ("Marcus Lee", "Engineering", "Active"),
    ("Priya Nair", "Design", "Away"), ("Diego Ramirez", "Growth", "Active"),
]


def _team_page(spec: ProductSpec) -> str:
    cards = "".join(f"""
    <div class="ds-card ds-rise" style="display:flex;align-items:center;gap:14px;padding:16px">
      {avatar(name)}
      <div style="flex:1"><h3 style="font-size:.98rem">{e(name)}</h3>
        <p style="font-size:.84rem;margin-top:2px">{e(role)}</p></div>
      {cl.status_pill(status, "positive" if status == "Active" else "neutral")}
    </div>""" for name, role, status in _TEAM_SAMPLE)
    return f'<div class="ds-grid">{cards}</div>'


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


def _records_page(spec: ProductSpec) -> str:
    headers = ["Name", "Role", "Status", "Last active"]
    rows = [[name, role, status, f"{i + 1}h ago"] for i, (name, role, status) in enumerate(_SAMPLE_PEOPLE)]
    return (f'<div class="ds-card ds-rise"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">'
            f'<h3>{e(spec.name)} records</h3>'
            f'<button class="ds-btn ds-btn-ghost ds-btn-sm" data-select>+ Add record</button></div>'
            f'{cl.table(headers, rows)}</div>')


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
    # Sprint 2.2 — a hero summary banner above the tabs: a one-line status
    # + a goal ring, so Overview reads as a command center, not just a
    # metric grid straight under the page head.
    top_metric = (spec.metrics or [{}])[0]
    hero = f"""
  <div class="ds-card ds-rise" style="margin-bottom:20px;padding:20px;display:flex;align-items:center;
    justify-content:space-between;gap:18px;background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 12%,var(--surface)),var(--surface))">
    <div><h2 style="font-size:1.05rem;margin-bottom:6px">{e(spec.primary_goals[0] if spec.primary_goals else "Everything is up to date.")}</h2>
      <p style="font-size:.86rem;margin:0">{e(top_metric.get('label', 'Status'))}: <strong style="color:var(--text)">{e(top_metric.get('value', '—'))}</strong>
        {("· " + e(top_metric.get("delta", ""))) if top_metric.get("delta") else ""}</p></div>
    {ring(78, "On track")}
  </div>"""
    return f"""
  {hero}
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
    {perf_secondary}
  </div>
  <h2 style="font-size:1.25rem;margin:26px 0 14px">Quick actions</h2>
  <div class="ds-grid">{cards}</div>"""


def _page_body(spec: ProductSpec, idx: int, label: str) -> str:
    if idx == 0:
        return _overview(spec, label)
    key = label.lower()
    if re.search(r"record", key):
        return _records_page(spec)
    if re.search(r"integrat", key):
        return _integrations_page(spec)
    if re.search(r"\bteam\b", key):
        return _team_page(spec)
    # Sprint 2.2 — realistic table/list pages for the ecommerce-ops/CRM
    # verticals (Products, Orders, Campaigns, Pipeline, Leads, Forecast). Placed
    # ahead of the analytics/activity buckets below so these words win.
    if re.search(r"product|\borders?\b|campaign|pipeline|lead|forecast|deal", key):
        return _data_table_page(spec, label)
    if re.search(r"progress|analytic|report|insight|market|chart|stat|signal|risk|invest", key):
        # Sprint 2.2 — a KPI/insight-card row on top of the existing chart
        # grid, so an analytics-ish page reads as data-dense, not just a
        # trend line + one feed.
        insight_cards = "".join(
            f'<div class="ds-col-2">{cl.premium_metric_card(m.get("label", ""), m.get("value", ""), m.get("delta", ""), icon=_metric_icon(m.get("label", "")), trend_positive=not str(m.get("delta", "")).strip().startswith("-"))}</div>'
            for m in (spec.metrics or [])[:3]
        )
        body = (f'<div class="ds-bento" style="margin-bottom:16px">{insight_cards}</div>' if insight_cards else "")
        body += (f'<div class="ds-bento"><div class="ds-card ds-col-4 ds-row-2 ds-rise"><h3>Trends</h3>{bars(20)}</div>'
                f'<div class="ds-card ds-col-2 ds-rise" style="display:flex;flex-direction:column;align-items:center;gap:10px;justify-content:center">{ring(68,"Goal")}</div>'
                f'<div class="ds-card ds-col-2 ds-rise"><h3 style="margin-bottom:6px">Momentum</h3>{spark()}</div>'
                f'<div class="ds-col-6">{_feed(spec, "Latest updates")}</div></div>')
        if re.search(r"report", key) and spec.metrics:
            body += (f'<div class="ds-card ds-rise" style="margin-top:16px"><h3 style="margin-bottom:10px">Report summary</h3>'
                    + cl.table(["Metric", "This period", "Change"],
                               [[m.get("label", "—"), m.get("value", "—"), m.get("delta", "")] for m in (spec.metrics or [])[:4]])
                    + '</div>')
        if (spec.data or {}).get("variant") == "analytics_dashboard":
            body += _insights_timeline(spec)
        elif spec.product_type == "fitness":
            body += _activity_timeline(spec)
        return body
    if re.search(r"setting|profile|account$|cards", key):
        return _settings(spec)
    if re.search(r"activit|transaction|asset|alert|notif|customer|order|history|communit", key):
        return (f'<div class="ds-bento"><div class="ds-col-4">{_feed(spec, label)}</div>'
                f'<div class="ds-card ds-col-2 ds-rise"><h3 style="margin-bottom:8px">Summary</h3>'
                + "".join(f'<div class="db-stat" style="margin-bottom:12px"><span class="lbl">{e(m.get("label"))}</span>'
                          f'<span class="ds-stat-value" style="font-size:1.4rem">{e(m.get("value"))}</span>'
                          f'<span class="ds-stat-delta">{e(m.get("delta"))}</span></div>' for m in (spec.metrics or [])[:3])
                + '</div></div>')
    if re.search(r"workout|task|plan|library|model|chat|account|nutrition|coach|course|lesson|workflow|automat", key):
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
