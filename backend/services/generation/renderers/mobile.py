# coding: utf-8
# Sprint 1.9 — premium MOBILE APP SHELL renderer.
#
# The structural gap this fills: every "real app" request (fitness, a habit
# tracker, a music player, ...) used to dispatch to the SaaS sidebar+topbar
# dashboard shell (renderers/dashboard.py) regardless of whether the product
# is genuinely mobile-native. A phone app does not have a left sidebar — it
# has a centered, phone-width canvas, a top app-bar, a scrollable content
# column (profile/progress-ring hero, metric cards, a list panel, quick
# actions) and a STICKY BOTTOM TAB BAR. This module is that shell.
#
# Reuses the EXISTING sandbox-safe interaction script in `base.py` (the
# same data-nav/data-panel page switcher dashboard.py uses) — no new JS.
# Reuses `ring()` / `avatar()` / `bars()` / `spark()` / the design-system
# CSS tokens, so it is visually cohesive with every other renderer.

from __future__ import annotations

import re

from backend.services.generation import component_library as cl
from backend.services.generation.renderers import base
from backend.services.generation.renderers.base import (
    avatar, bars, e, feature_items, ring, spark, svg_icon,
)
from backend.services.generation.spec import ProductSpec

CSS = """
/* ── Mobile app shell ── */
.mb-shell { min-height:100vh; display:flex; justify-content:center;
  background:radial-gradient(80% 60% at 50% -10%, color-mix(in srgb,var(--accent) 10%, transparent), transparent),
             var(--bg); padding:clamp(0px,3vw,28px) 0; }
.mb-frame { width:100%; max-width:430px; min-height:100vh; display:flex; flex-direction:column;
  background:var(--bg); position:relative; overflow:hidden;
  border:1px solid var(--border); border-radius:30px; box-shadow:var(--shadow-lg); }
@media (max-width:480px){ .mb-frame { border:0; border-radius:0; box-shadow:none; } }

.mb-topbar { position:sticky; top:0; z-index:20; display:flex; align-items:center; gap:12px;
  padding:18px 18px 14px; background:color-mix(in srgb,var(--bg) 88%, transparent);
  backdrop-filter:blur(10px); border-bottom:1px solid var(--border); }
.mb-greeting { flex:1; min-width:0; }
.mb-greeting .hi { font-size:.78rem; color:var(--text-dim); }
.mb-greeting h1 { font-size:1.2rem; margin-top:2px; letter-spacing:-.02em; }
.mb-iconbtn { width:38px; height:38px; border-radius:12px; display:grid; place-items:center; cursor:pointer;
  background:var(--surface-2); border:1px solid var(--border); color:var(--text-muted); flex:0 0 auto; }
.mb-iconbtn:hover { color:var(--text); }

.mb-scroll { flex:1; overflow-y:auto; padding:18px 18px 110px; display:flex; flex-direction:column; gap:20px; }

.mb-hero { border-radius:var(--radius-lg); padding:22px; background:var(--grad); color:#fff;
  display:flex; align-items:center; gap:18px; box-shadow:var(--glow); position:relative; overflow:hidden; }
.mb-hero::after { content:''; position:absolute; inset:-40% -20% auto auto; width:60%; aspect-ratio:1;
  background:radial-gradient(closest-side, rgba(255,255,255,.18), transparent); }
.mb-hero-ring .ds-ring { background:conic-gradient(#fff var(--pct,72%), rgba(255,255,255,.25) 0); width:84px; height:84px; }
.mb-hero-ring .ds-ring::after { background:color-mix(in srgb, var(--accent) 78%, #000 10%); width:64px; height:64px; }
.mb-hero-ring .ds-ring b { color:#fff; font-size:.98rem; }
.mb-hero-copy h2 { font-size:1.15rem; color:#fff; margin-bottom:4px; }
.mb-hero-copy p { color:rgba(255,255,255,.82); font-size:.84rem; }

.mb-metric-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
.mb-metric-card { background:var(--surface); border:1px solid var(--border); border-radius:var(--radius);
  padding:14px; display:flex; flex-direction:column; gap:4px; }
.mb-metric-card .lbl { font-size:.74rem; color:var(--text-dim); }
.mb-metric-card .val { font-size:1.3rem; font-weight:740; letter-spacing:-.02em; }
.mb-metric-card .delta { font-size:.74rem; color:var(--accent-2); }

.mb-section h3 { font-size:1rem; margin-bottom:10px; }
.mb-section .sub { font-size:.82rem; color:var(--text-dim); margin:-6px 0 10px; }
.mb-list { display:flex; flex-direction:column; gap:8px; }
.mb-list-item { display:flex; align-items:center; gap:12px; padding:12px 14px; border-radius:var(--radius);
  background:var(--surface); border:1px solid var(--border); cursor:pointer; transition:all var(--t) var(--ease); }
.mb-list-item:hover { border-color:var(--border-strong); transform:translateY(-1px); }
.mb-list-ic { width:36px; height:36px; border-radius:11px; display:grid; place-items:center; flex:0 0 auto;
  background:color-mix(in srgb,var(--accent) 16%, var(--surface-2)); color:var(--accent); }
.mb-list-body { flex:1; min-width:0; }
.mb-list-body .t { font-size:.92rem; font-weight:620; color:var(--text); }
.mb-list-body .s { font-size:.78rem; color:var(--text-dim); margin-top:1px;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.mb-list-trail { font-size:.82rem; color:var(--text-muted); font-weight:650; flex:0 0 auto; }

.mb-actions { display:flex; gap:10px; flex-wrap:wrap; }
.mb-pill { display:inline-flex; align-items:center; gap:8px; padding:10px 16px; border-radius:9999px;
  font-size:.84rem; font-weight:650; cursor:pointer; border:1px solid var(--border-strong);
  background:var(--surface-2); color:var(--text); transition:all var(--t) var(--ease); }
.mb-pill.is-primary { background:var(--grad); color:#fff; border-color:transparent; box-shadow:var(--glow); }
.mb-pill:hover { transform:translateY(-1px); }

.mb-fab { position:absolute; right:18px; bottom:96px; width:54px; height:54px; border-radius:50%;
  background:var(--grad); color:#fff; display:grid; place-items:center; box-shadow:var(--glow), var(--shadow-lg);
  cursor:pointer; z-index:25; border:none; transition:transform var(--t) var(--ease); }
.mb-fab:hover { transform:scale(1.06) translateY(-1px); }
.mb-fab .ds-svg-icon { width:24px; height:24px; }

.mb-tabbar { position:sticky; bottom:0; z-index:20; display:flex; justify-content:space-around;
  padding:10px 6px calc(10px + env(safe-area-inset-bottom,0px)); background:color-mix(in srgb,var(--bg) 90%, transparent);
  backdrop-filter:blur(10px); border-top:1px solid var(--border); }
.mb-tab { display:flex; flex-direction:column; align-items:center; gap:3px; padding:4px 10px; border-radius:12px;
  color:var(--text-dim); cursor:pointer; transition:color var(--t) var(--ease); flex:1; }
.mb-tab .ds-svg-icon { width:21px; height:21px; }
.mb-tab span { font-size:.66rem; font-weight:650; }
.mb-tab.is-active { color:var(--accent); }

.mb-reveal { border:1px solid var(--border); border-radius:var(--radius-lg); padding:18px; background:var(--surface); }
""".strip()

CSS = CSS + "\n\n" + cl.CSS

# nav label keyword → svg icon name (falls back to a generic dot, never errors).
_NAV_ICON_MAP = [
    (re.compile(r"home|dashboard|overview|today", re.I), "home"),
    (re.compile(r"progress|analytic|chart|stat|insight|portfolio|market", re.I), "chart"),
    (re.compile(r"workout|nutrition|plan|recipe|library|queue|playlist|activity|transaction|list|history|order", re.I), "list"),
    (re.compile(r"alert|notif|chat", re.I), "bell"),
    (re.compile(r"profile|account|setting", re.I), "person"),
    (re.compile(r"favorite|love|wellness|mood|sleep", re.I), "heart"),
    (re.compile(r"calendar|schedule|book", re.I), "calendar"),
    (re.compile(r"play|listen|music|podcast", re.I), "play"),
    (re.compile(r"shop|cart|store|market(?!s)", re.I), "bag"),
    (re.compile(r"discover|explore", re.I), "compass"),
]


def _nav_icon(label: str) -> str:
    for pattern, name in _NAV_ICON_MAP:
        if pattern.search(label or ""):
            return name
    return "dot"


def _progress_pct(spec: ProductSpec) -> int:
    for m in (spec.metrics or []):
        val = str(m.get("value") or "")
        match = re.search(r"(\d{1,3})\s*%", val)
        if match:
            return max(1, min(100, int(match.group(1))))
    return 72


def _panel_section(spec: ProductSpec):
    for s in spec.sections:
        if s.kind == "panel":
            return s
    return None


def _hero(spec: ProductSpec) -> str:
    pct = _progress_pct(spec)
    headline = (spec.metrics[0]["label"] if spec.metrics else spec.tagline)
    return f"""
  <div class="mb-hero">
    <div class="mb-hero-ring">{ring(pct)}</div>
    <div class="mb-hero-copy"><h2>{e(headline)}</h2><p>{e(spec.tagline)}</p></div>
  </div>"""


def _metric_grid(spec: ProductSpec) -> str:
    m = (spec.metrics or [])[:4]
    while len(m) < 4:
        m.append({"label": "Metric", "value": "—", "delta": ""})
    cards = "".join(f"""
    <div class="mb-metric-card"><span class="lbl">{e(x.get('label'))}</span>
      <span class="val">{e(x.get('value'))}</span>
      <span class="delta">{e(x.get('delta'))}</span></div>""" for x in m)
    return f'<div class="mb-metric-grid">{cards}</div>'


def _list_panel(spec: ProductSpec) -> str:
    panel = _panel_section(spec)
    title = panel.title if panel else "Quick list"
    subtitle = panel.subtitle if panel else ""
    items = feature_items(spec)[:5] or [{"icon": "●", "title": "Get started", "body": "Tap to begin."}]
    rows = "".join(f"""
    <div class="mb-list-item" data-select data-searchable="{e(c.get('title'))}">
      <span class="mb-list-ic">{e(c.get('icon', '●'))}</span>
      <div class="mb-list-body"><div class="t">{e(c.get('title'))}</div>
        <div class="s">{e(c.get('body'))}</div></div>
      <span class="mb-list-trail">›</span>
    </div>""" for c in items)
    sub_html = f'<p class="sub">{e(subtitle)}</p>' if subtitle else ""
    return (f'<div class="mb-section"><h3>{e(title)}</h3>{sub_html}'
            f'<div class="mb-list" data-select-group>{rows}</div></div>')


def _actions(spec: ProductSpec) -> str:
    extra = [c.get("title", "") for c in feature_items(spec)[:2]]
    pills = [f'<button class="mb-pill is-primary" data-reveal="reveal-detail">{e(spec.cta_primary)}</button>']
    if spec.cta_secondary:
        pills.append(f'<button class="mb-pill" data-scroll="top">{e(spec.cta_secondary)}</button>')
    for t in extra:
        if t:
            pills.append(f'<button class="mb-pill">{e(t)}</button>')
    return f'<div class="mb-actions">{"".join(pills)}</div>'


def _reveal(spec: ProductSpec) -> str:
    items = feature_items(spec)[:3]
    rows = "".join(f'<p style="margin-top:8px;font-size:.86rem"><b>{e(c.get("title"))}</b> — {e(c.get("body"))}</p>'
                    for c in items)
    return (f'<section class="mb-reveal ds-hidden" id="reveal-detail">'
            f'<h3 style="margin-bottom:4px">{e(spec.cta_primary)}</h3>{rows}</section>')


def _music_widget(spec: ProductSpec) -> str:
    """Sprint 2.0 — a real player widget for the music/podcast vertical,
    not just another list row."""
    feats = feature_items(spec)
    track = feats[0]["title"] if feats else spec.tagline
    return cl.music_player(track, spec.name, progress_pct=42)


def _streak_calendar(spec: ProductSpec) -> str:
    """Sprint 2.0 — a real month grid for the habit/wellness vertical,
    visualising the streak instead of only a progress ring."""
    pct = _progress_pct(spec)
    marked_through = max(1, round(pct / 100 * 18))
    return cl.calendar_grid(f"{spec.name} streak", list(range(1, marked_through + 1)),
                            today=marked_through, days_in_month=30, start_weekday=2)


def _home_page(spec: ProductSpec) -> str:
    extra = ""
    if spec.product_type == "media":
        extra = f'<div class="mb-section">{_music_widget(spec)}</div>'
    elif spec.product_type == "wellness":
        extra = f'<div class="mb-section ds-card" style="padding:16px">{_streak_calendar(spec)}</div>'
    return (_hero(spec) + extra + _metric_grid(spec) + _list_panel(spec) + _actions(spec))


def _secondary_page(spec: ProductSpec, label: str) -> str:
    items = feature_items(spec)[:5] or [{"icon": "●", "title": label, "body": "Nothing here yet."}]
    rows = "".join(f"""
    <div class="mb-list-item"><span class="mb-list-ic">{e(c.get('icon', '●'))}</span>
      <div class="mb-list-body"><div class="t">{e(c.get('title'))}</div>
        <div class="s">{e(c.get('body'))}</div></div>
      <span class="mb-list-trail">›</span></div>""" for c in items)
    return (f'<div class="mb-section"><h3>{e(label)}</h3><p class="sub">{e(spec.description)}</p>'
            f'<div class="mb-list">{rows}</div></div>{_metric_grid(spec)}')


def render(spec: ProductSpec) -> str:
    nav = spec.navigation or ["Home", "Activity", "Profile"]
    tabs = "".join(
        f'<a class="mb-tab{" is-active" if i == 0 else ""}" data-nav="mpage-{i}">'
        f'{svg_icon(_nav_icon(l))}<span>{e(l)}</span></a>' for i, l in enumerate(nav))
    pages = []
    for i, l in enumerate(nav):
        hidden = "" if i == 0 else " ds-hidden"
        body = _home_page(spec) if i == 0 else _secondary_page(spec, l)
        pages.append(f'<section class="ds-page{hidden}" data-panel="mpage-{i}" id="mpage-{i}">{body}</section>')
    return f"""
<div class="mb-shell"><div class="mb-frame">
  <header class="mb-topbar">
    {avatar(spec.name)}
    <div class="mb-greeting"><div class="hi">Welcome back</div><h1>{e(spec.name)}</h1></div>
    <button class="mb-iconbtn" title="Notifications">{svg_icon('bell')}</button>
  </header>
  <main class="mb-scroll" id="top">{"".join(pages)}{_reveal(spec)}</main>
  <button class="mb-fab" data-reveal="reveal-detail" title="{e(spec.cta_primary)}">{svg_icon('plus')}</button>
  <nav class="mb-tabbar">{tabs}</nav>
</div></div>"""


__all__ = ["CSS", "render"]
