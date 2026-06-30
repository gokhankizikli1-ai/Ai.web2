# coding: utf-8
# Sprint 2.0/2.1 — shared, reusable component library.
#
# Genuinely reusable building blocks used by more than one renderer module
# (or that close a real gap in the `components.py` catalog — Tables,
# Timeline, Calendar, Music Player, Notifications, Forms had guidance text
# but no actual implementation). Renderers ASSEMBLE pages from these
# instead of hand-rolling another copy of the same markup.
#
# Sprint 2.1 note: the original calendar/table treatments leaned on flat
# `var(--surface-2)` fills for "empty" states, which read as generic gray
# boxes at scale (the headline visual regression of Sprint 2.0). Every
# component below now favors gradient/tint/pill accents over flat fills —
# the empty/inactive state is a thin outline or a dim tint, never a solid
# gray block.
#
# Pure functions: small explicit data in, an HTML fragment out. No spec
# coupling beyond what's explicitly passed — independently testable, and
# every renderer that imports them stays visually consistent with every
# other renderer via the shared design-system tokens (CSS below only adds
# component-specific layout, never new colors/radii/shadows).

from __future__ import annotations

from typing import Any, Dict, List, Sequence

from backend.services.generation.renderers.base import e, svg_icon

CSS = """
/* ── Shared component library (Sprint 2.0/2.1) ── */
.cl-table-wrap { overflow-x:auto; border:1px solid var(--border); border-radius:var(--radius-lg); background:var(--surface); }
.cl-table { width:100%; border-collapse:collapse; font-size:.88rem; }
.cl-table th { text-align:left; padding:11px 14px; color:var(--text-dim); font-weight:650;
  font-size:.72rem; text-transform:uppercase; letter-spacing:.06em; border-bottom:1px solid var(--border); white-space:nowrap;
  background:linear-gradient(180deg, color-mix(in srgb, var(--accent) 5%, transparent), transparent); }
.cl-table td { padding:13px 14px; border-bottom:1px solid var(--border); color:var(--text); white-space:nowrap; }
.cl-table tr:last-child td { border-bottom:0; }
.cl-table tr { transition:background var(--t) var(--ease); }
.cl-table tr:hover td { background:color-mix(in srgb, var(--accent) 5%, var(--surface-2)); }

/* Status / delta pills — used by tables, watchlists, metric cards instead
   of plain colored text, so a row never reads as flat/undifferentiated. */
.cl-pill { display:inline-flex; align-items:center; gap:4px; padding:3px 10px; border-radius:9999px;
  font-size:.74rem; font-weight:650; line-height:1.5; white-space:nowrap; }
.cl-pill-positive { background:color-mix(in srgb, #22c55e 18%, transparent); color:#4ade80; }
.cl-pill-negative { background:color-mix(in srgb, #ef4444 18%, transparent); color:#f87171; }
.cl-pill-warning  { background:color-mix(in srgb, #f59e0b 18%, transparent); color:#fbbf24; }
.cl-pill-neutral  { background:var(--surface-2); color:var(--text-muted); }

.cl-timeline { display:flex; flex-direction:column; gap:0; }
.cl-timeline-item { display:flex; gap:14px; padding-bottom:22px; position:relative; }
.cl-timeline-item:last-child { padding-bottom:0; }
.cl-timeline-item::before { content:''; position:absolute; left:9px; top:22px; bottom:0; width:1px;
  background:linear-gradient(var(--border), transparent); }
.cl-timeline-item:last-child::before { display:none; }
.cl-timeline-dot { width:20px; height:20px; border-radius:9999px; flex:0 0 auto; z-index:1;
  background:color-mix(in srgb,var(--accent) 18%, var(--surface-2)); color:var(--accent); display:grid; place-items:center; }
.cl-timeline-dot .ds-svg-icon { width:12px; height:12px; }
.cl-timeline-body { flex:1; min-width:0; padding-top:1px; }
.cl-timeline-body .t { font-weight:650; font-size:.9rem; color:var(--text); }
.cl-timeline-body .s { font-size:.82rem; color:var(--text-dim); margin-top:2px; }
.cl-timeline-time { font-size:.74rem; color:var(--text-dim); white-space:nowrap; }

/* Calendar / streak grid — small premium pills, NOT flat gray squares.
   Unmarked days are a thin outline; marked days get the brand gradient +
   glow; "today" gets an inset accent ring. */
.cl-streak-badge { display:inline-flex; align-items:center; gap:7px; padding:6px 14px; margin-bottom:14px;
  border-radius:9999px; background:color-mix(in srgb, var(--accent) 14%, var(--surface)); font-size:.82rem;
  font-weight:650; color:var(--text); border:1px solid var(--border-strong); }
.cl-cal { display:grid; grid-template-columns:repeat(7,1fr); gap:7px; }
.cl-cal-dow { text-align:center; font-size:.68rem; color:var(--text-dim); font-weight:650; padding-bottom:4px; }
.cl-cal-day { aspect-ratio:1; display:grid; place-items:center; border-radius:9999px; font-size:.74rem;
  color:var(--text-dim); background:transparent; border:1px solid var(--border); transition:transform var(--t) var(--ease); }
.cl-cal-day.is-marked { background:var(--grad); color:#fff; font-weight:700; box-shadow:var(--glow); border-color:transparent; }
.cl-cal-day.is-today { box-shadow:inset 0 0 0 1.5px var(--accent); color:var(--text); border-color:transparent; }
.cl-cal-day.is-empty { border-color:transparent; visibility:hidden; }

.cl-player { display:flex; flex-direction:column; gap:14px; padding:18px; border-radius:var(--radius-lg);
  background:linear-gradient(160deg, color-mix(in srgb, var(--accent) 7%, var(--surface)), var(--surface));
  border:1px solid var(--border); }
.cl-player-art { width:100%; aspect-ratio:1; border-radius:var(--radius); background:var(--grad);
  box-shadow:var(--glow); position:relative; overflow:hidden; }
.cl-player-art::after { content:''; position:absolute; inset:-30% -10% auto auto; width:60%; aspect-ratio:1;
  background:radial-gradient(closest-side, rgba(255,255,255,.22), transparent); }
.cl-player-art::before { content:''; position:absolute; inset:auto auto -20% -10%; width:55%; aspect-ratio:1;
  background:radial-gradient(closest-side, rgba(0,0,0,.18), transparent); }
.cl-player-meta .t { font-weight:700; font-size:1.02rem; }
.cl-player-meta .s { font-size:.84rem; color:var(--text-dim); margin-top:2px; }
.cl-waveform { display:flex; align-items:flex-end; gap:3px; height:42px; }
.cl-waveform span { flex:1; min-width:2px; border-radius:3px; background:var(--surface-2); }
.cl-waveform span.is-active { background:var(--grad); }
.cl-player-progress { height:4px; border-radius:9999px; background:var(--surface-2); overflow:hidden; }
.cl-player-progress span { display:block; height:100%; width:var(--pct,38%); background:var(--grad); }
.cl-player-time { display:flex; justify-content:space-between; font-size:.72rem; color:var(--text-dim); }
.cl-player-controls { display:flex; align-items:center; justify-content:center; gap:18px; }
.cl-player-controls button { background:none; border:none; color:var(--text-muted); cursor:pointer; display:grid; place-items:center; padding:6px; }
.cl-player-controls button:hover { color:var(--text); }
.cl-player-play { width:52px; height:52px; border-radius:9999px !important; background:var(--grad); color:#fff !important; box-shadow:var(--glow); }
.cl-player-play .ds-svg-icon { width:22px; height:22px; }

.cl-notif-list { display:flex; flex-direction:column; gap:2px; }
.cl-notif { display:flex; gap:12px; padding:12px 6px; border-bottom:1px solid var(--border); position:relative; }
.cl-notif:last-child { border-bottom:0; }
.cl-notif-ic { width:34px; height:34px; border-radius:10px; display:grid; place-items:center; flex:0 0 auto;
  background:color-mix(in srgb,var(--accent) 16%, var(--surface-2)); color:var(--accent); }
.cl-notif-body { flex:1; min-width:0; }
.cl-notif-body .t { font-size:.88rem; font-weight:620; color:var(--text); }
.cl-notif-body .s { font-size:.8rem; color:var(--text-dim); margin-top:1px; }
.cl-notif-time { font-size:.72rem; color:var(--text-dim); white-space:nowrap; }
.cl-notif.is-unread::before { content:''; position:absolute; left:-2px; top:18px; width:6px; height:6px;
  border-radius:9999px; background:var(--accent-2); }

.cl-form { display:grid; gap:14px; }
.cl-field { display:flex; flex-direction:column; gap:6px; }
.cl-field label { font-size:.82rem; font-weight:600; color:var(--text-muted); }
.cl-field input, .cl-field textarea, .cl-field select { font:inherit; padding:10px 13px; border-radius:10px;
  background:var(--surface-2); border:1px solid var(--border); color:var(--text); }
.cl-field input:focus, .cl-field textarea:focus, .cl-field select:focus { outline:none; border-color:var(--accent); }
.cl-field textarea { resize:vertical; min-height:96px; }

/* Command/filter bar (Sprint 2.3) — search + filter chips for dense
   admin/productivity tables, wired into the shared data-search/
   data-filter interaction script (no new JS). */
.cl-toolbar { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:16px; }
.cl-toolbar-search { flex:1; min-width:160px; display:flex; align-items:center; gap:8px; padding:9px 13px;
  background:var(--surface-2); border:1px solid var(--border); border-radius:10px; }
.cl-toolbar-search .ds-svg-icon { width:15px; height:15px; opacity:.65; flex:0 0 auto; }
.cl-toolbar-search input { flex:1; min-width:0; font:inherit; font-size:.86rem; color:var(--text);
  background:transparent; border:0; outline:none; }
.cl-toolbar-filters { display:flex; gap:8px; flex-wrap:wrap; }
.cl-table-caption { font-size:.78rem; color:var(--text-dim); margin-bottom:10px; }

/* Empty state (Sprint 2.2) — a real, premium "nothing here yet" panel,
   used wherever a list/table has no data instead of a bare text row. */
.cl-empty { display:flex; flex-direction:column; align-items:center; text-align:center; gap:8px;
  padding:48px 24px; border-radius:var(--radius-lg); border:1px dashed var(--border-strong);
  background:color-mix(in srgb, var(--surface) 55%, transparent); }
.cl-empty-ic { width:48px; height:48px; border-radius:9999px; display:grid; place-items:center;
  background:color-mix(in srgb, var(--accent) 14%, var(--surface-2)); color:var(--accent); margin-bottom:6px; }
.cl-empty h3 { font-size:1rem; }
.cl-empty p { font-size:.86rem; max-width:38ch; }

/* Premium metric card — gradient-tinted icon badge + bold value, used in
   place of a plain stat block wherever a renderer wants extra punch. */
.cl-metric-card { display:flex; flex-direction:column; gap:10px; padding:18px; border-radius:var(--radius-lg);
  background:var(--surface); border:1px solid var(--border); }
.cl-metric-top { display:flex; align-items:center; justify-content:space-between; }
.cl-metric-ic { width:34px; height:34px; border-radius:10px; display:grid; place-items:center;
  background:var(--grad); color:#fff; box-shadow:var(--glow); }
.cl-metric-value { font-size:1.5rem; font-weight:760; letter-spacing:-.02em; }
.cl-metric-label { font-size:.8rem; color:var(--text-dim); }

/* Action / session card — soft, rounded, calm (wellness/meditation). */
.cl-action-card { display:flex; align-items:center; gap:14px; padding:18px; border-radius:var(--radius-xl);
  background:linear-gradient(135deg, color-mix(in srgb, var(--accent) 10%, var(--surface)), var(--surface));
  border:1px solid var(--border); }
.cl-action-ic { width:42px; height:42px; border-radius:9999px; display:grid; place-items:center; flex:0 0 auto;
  background:color-mix(in srgb, var(--accent) 18%, var(--surface-2)); color:var(--accent); }
.cl-action-body { flex:1; min-width:0; }
.cl-action-body .t { font-weight:680; font-size:.96rem; }
.cl-action-body .s { font-size:.82rem; color:var(--text-dim); margin-top:2px; }
.cl-action-calm { border-radius:var(--radius-xl); }
.cl-action-calm .cl-action-ic { background:color-mix(in srgb, var(--accent-2) 20%, var(--surface-2)); color:var(--accent-2); }

/* Watchlist row + portfolio allocation card — analytical, finance/crypto. */
.cl-watch-row { display:flex; align-items:center; gap:12px; padding:12px 4px; border-bottom:1px solid var(--border); }
.cl-watch-row:last-child { border-bottom:0; }
.cl-watch-id { display:flex; flex-direction:column; min-width:0; flex:1; }
.cl-watch-sym { font-weight:700; font-size:.92rem; letter-spacing:.01em; }
.cl-watch-name { font-size:.76rem; color:var(--text-dim); }
.cl-watch-price { font-weight:650; font-size:.92rem; font-variant-numeric:tabular-nums; }
.cl-portfolio-card { display:flex; flex-direction:column; gap:10px; padding:18px; border-radius:var(--radius-lg);
  background:var(--surface); border:1px solid var(--border); }
.cl-portfolio-top { display:flex; align-items:center; justify-content:space-between; }
.cl-portfolio-top .lbl { font-size:.82rem; color:var(--text-dim); }
.cl-portfolio-value { font-size:1.4rem; font-weight:740; letter-spacing:-.02em; font-variant-numeric:tabular-nums; }
.cl-portfolio-bar { height:6px; border-radius:9999px; background:var(--surface-2); overflow:hidden; }
.cl-portfolio-bar span { display:block; height:100%; background:var(--grad); }
.cl-portfolio-alloc { font-size:.74rem; color:var(--text-dim); }

/* Recipe steps + ingredient chips — warm, editorial (food vertical). */
.cl-steps { display:flex; flex-direction:column; gap:14px; }
.cl-step { display:flex; gap:12px; align-items:flex-start; }
.cl-step-n { width:26px; height:26px; border-radius:9999px; flex:0 0 auto; display:grid; place-items:center;
  background:var(--grad); color:#fff; font-size:.78rem; font-weight:700; box-shadow:var(--glow); }
.cl-step p { font-size:.88rem; color:var(--text); padding-top:3px; }
.cl-chips { display:flex; flex-wrap:wrap; gap:8px; }
.cl-chip { padding:7px 13px; border-radius:9999px; background:var(--surface-2); border:1px solid var(--border);
  font-size:.8rem; color:var(--text-muted); }
.cl-food-panel { aspect-ratio:16/9; border-radius:var(--radius-lg); position:relative; overflow:hidden;
  background:linear-gradient(135deg, color-mix(in srgb, var(--accent) 55%, transparent), color-mix(in srgb, var(--accent-2) 45%, transparent)),
             linear-gradient(45deg, var(--surface-2), var(--surface)); }
.cl-food-panel::after { content:''; position:absolute; inset:-30% -10% auto auto; width:60%; aspect-ratio:1;
  background:radial-gradient(closest-side, rgba(255,255,255,.25), transparent); }
""".strip()


def status_pill(text: str, tone: str = "neutral") -> str:
    """A small colored status/delta chip (positive/negative/warning/
    neutral) — used wherever a table/row would otherwise show plain,
    undifferentiated text."""
    cls = {
        "positive": "cl-pill-positive", "negative": "cl-pill-negative",
        "warning": "cl-pill-warning",
    }.get(tone, "cl-pill-neutral")
    return f'<span class="cl-pill {cls}">{e(text)}</span>'


# ── Empty state ──────────────────────────────────────────────────────

def empty_state(icon: str, title: str, body: str = "", cta_label: str = "") -> str:
    """A real, premium empty state — icon badge + title + body + an
    optional action — used wherever a list/table has no data, instead of
    a bare "nothing here" text string or (worse) an empty container."""
    body_html = f'<p>{e(body)}</p>' if body else ""
    cta_html = (f'<button type="button" class="ds-btn ds-btn-ghost ds-btn-sm" data-select>{e(cta_label)}</button>'
                if cta_label else "")
    return (f'<div class="cl-empty" data-component="empty-state">'
            f'<span class="cl-empty-ic">{svg_icon(icon)}</span>'
            f'<h3>{e(title)}</h3>{body_html}{cta_html}</div>')


# ── Command / filter bar ─────────────────────────────────────────────

def toolbar(filters: Sequence[Dict[str, str]], search_placeholder: str = "Search…") -> str:
    """A dense command/filter bar — a real search input + filter chips —
    used above tables/lists in admin & productivity-style surfaces
    instead of a bare unfiltered list. Wired into the shared
    data-search/data-filter interaction script already used by the
    ecommerce renderer, so chip/search behavior is free and consistent."""
    chips = "".join(
        f'<span class="ds-chip{" is-active" if i == 0 else ""}" data-filter="{e(f.get("key", ""))}">{e(f.get("label", ""))}</span>'
        for i, f in enumerate(filters)
    )
    return (f'<div class="cl-toolbar" data-component="toolbar">'
            f'<label class="cl-toolbar-search">{svg_icon("search")}'
            f'<input type="text" placeholder="{e(search_placeholder)}" data-search aria-label="{e(search_placeholder)}"></label>'
            f'<div class="cl-toolbar-filters">{chips}</div></div>')


# ── Table ────────────────────────────────────────────────────────────

def table(headers: Sequence[str], rows: Sequence[Sequence[Any]], escape_cells: bool = True,
         empty_title: str = "No records yet.", empty_body: str = "They'll show up here once you add some.",
         row_attrs=None) -> str:
    """A real data table — header row + body rows. `escape_cells=False`
    lets a caller pass pre-built safe HTML cells (e.g. `status_pill()`
    chips) — the caller is then responsible for escaping any raw text.
    No rows → a real empty state, not a bare text row.

    `row_attrs(index, row) -> str` optionally returns extra attributes
    (e.g. ` data-category="active"`) for a row — this is what lets a
    dense admin/productivity table wire into the shared filter-chip
    interaction script without any new JS."""
    if not rows:
        return empty_state("folder", empty_title, empty_body)
    head = "".join(f"<th>{e(h)}</th>" for h in headers)
    cell = (lambda c: e(c)) if escape_cells else (lambda c: str(c))
    attrs = row_attrs or (lambda i, row: "")
    body = "".join(
        f"<tr{attrs(i, row)}>" + "".join(f"<td>{cell(c)}</td>" for c in row) + "</tr>"
        for i, row in enumerate(rows)
    )
    return (f'<div class="cl-table-wrap" data-component="table">'
            f'<table class="cl-table"><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table></div>')


# ── Timeline ─────────────────────────────────────────────────────────

def timeline(items: Sequence[Dict[str, Any]]) -> str:
    """A vertical event timeline — icon dot + title/body + timestamp."""
    rows = "".join(f"""
    <div class="cl-timeline-item"><span class="cl-timeline-dot">{svg_icon(it.get('icon', 'dot'))}</span>
      <div class="cl-timeline-body"><div class="t">{e(it.get('title'))}</div>
        <div class="s">{e(it.get('body'))}</div></div>
      <span class="cl-timeline-time">{e(it.get('time', ''))}</span></div>""" for it in items)
    return f'<div class="cl-timeline" data-component="timeline">{rows}</div>'


# ── Calendar / streak ───────────────────────────────────────────────

def calendar_grid(month_label: str, marked_days: Sequence[int], today: int = 0,
                  days_in_month: int = 30, start_weekday: int = 0, streak_label: str = "") -> str:
    """A real month grid (S-S header + numbered day cells), with marked
    (e.g. streak/booked) days rendered as filled gradient pills — never a
    flat gray block — plus an optional streak-count badge above it."""
    dow = "".join(f'<span class="cl-cal-dow">{d}</span>' for d in ("S", "M", "T", "W", "T", "F", "S"))
    marked = set(marked_days or [])
    start_weekday = max(0, min(6, int(start_weekday)))
    cells = ['<span class="cl-cal-day is-empty">·</span>' for _ in range(start_weekday)]
    for day in range(1, max(1, int(days_in_month)) + 1):
        cls = "cl-cal-day"
        if day == today:
            cls += " is-today"
        if day in marked:
            cls += " is-marked"
        cells.append(f'<span class="{cls}">{day}</span>')
    badge = (f'<div class="cl-streak-badge">{svg_icon("heart")} {e(streak_label)}</div>' if streak_label else "")
    return (f'<div data-component="calendar">{badge}'
            f'<div style="font-weight:650;margin-bottom:10px">{e(month_label)}</div>'
            f'<div class="cl-cal">{dow}{"".join(cells)}</div></div>')


# ── Music player + waveform ─────────────────────────────────────────

_WAVE_H = [30, 55, 40, 70, 50, 85, 35, 95, 45, 65, 55, 80, 30, 60, 40, 75,
          50, 90, 35, 70, 45, 85, 40, 60, 55, 95, 30, 65, 50, 80, 40, 70]


def waveform(active_pct: int = 55) -> str:
    """A static equalizer-style waveform — the leading `active_pct` bars
    rendered in the brand gradient (elapsed), the rest dim (remaining)."""
    pct = max(0, min(100, int(active_pct)))
    n = len(_WAVE_H)
    active_n = round(n * pct / 100)
    bars = "".join(
        f'<span style="height:{h}%" class="{"is-active" if i < active_n else ""}"></span>'
        for i, h in enumerate(_WAVE_H)
    )
    return f'<div class="cl-waveform" data-component="waveform">{bars}</div>'


def music_player(track_title: str, artist: str, progress_pct: int = 38,
                 elapsed: str = "1:24", duration: str = "3:42") -> str:
    """A real player widget — album-art block, waveform, progress bar,
    transport controls. Used by the mobile renderer for the "media"
    vertical."""
    pct = max(0, min(100, int(progress_pct)))
    return f"""
    <div class="cl-player" data-component="music-player">
      <div class="cl-player-art"></div>
      <div class="cl-player-meta"><div class="t">{e(track_title)}</div><div class="s">{e(artist)}</div></div>
      {waveform(pct)}
      <div class="cl-player-progress" style="--pct:{pct}%"><span></span></div>
      <div class="cl-player-time"><span>{e(elapsed)}</span><span>{e(duration)}</span></div>
      <div class="cl-player-controls">
        <button type="button" data-select title="Previous">{svg_icon('prev')}</button>
        <button type="button" class="cl-player-play" data-select title="Play">{svg_icon('play')}</button>
        <button type="button" data-select title="Next">{svg_icon('next')}</button>
      </div>
    </div>"""


# ── Notifications ────────────────────────────────────────────────────

def notifications_panel(items: Sequence[Dict[str, Any]]) -> str:
    """A real notifications list — icon, title/body, time, unread dot."""
    rows = "".join(f"""
    <div class="cl-notif{' is-unread' if it.get('unread') else ''}">
      <span class="cl-notif-ic">{svg_icon(it.get('icon', 'bell'))}</span>
      <div class="cl-notif-body"><div class="t">{e(it.get('title'))}</div><div class="s">{e(it.get('body'))}</div></div>
      <span class="cl-notif-time">{e(it.get('time', ''))}</span></div>""" for it in items)
    return f'<div class="cl-notif-list" data-component="notifications">{rows}</div>'


# ── Forms ────────────────────────────────────────────────────────────

def form_fields(fields: Sequence[Dict[str, str]], submit_label: str = "Submit") -> str:
    """A real form — labeled inputs/textarea/select + submit button.
    `fields`: [{name, label, type: text|email|textarea|select, options?}]."""
    rows = []
    for f in fields:
        kind = (f.get("type") or "text").lower()
        name = f.get("name") or "field"
        label = f.get("label") or name.title()
        if kind == "textarea":
            control = f'<textarea name="{e(name)}" placeholder="{e(f.get("placeholder", ""))}"></textarea>'
        elif kind == "select":
            opts = "".join(f'<option>{e(o)}</option>' for o in (f.get("options") or []))
            control = f'<select name="{e(name)}">{opts}</select>'
        else:
            control = f'<input type="{e(kind)}" name="{e(name)}" placeholder="{e(f.get("placeholder", ""))}">'
        rows.append(f'<div class="cl-field"><label for="{e(name)}">{e(label)}</label>{control}</div>')
    button = (f'<button type="button" class="ds-btn ds-btn-primary" data-form-submit>'
              f'{svg_icon("send")} {e(submit_label)}</button>')
    return f'<form class="cl-form" data-component="form" onsubmit="return false">{"".join(rows)}{button}</form>'


# ── Premium metric card ──────────────────────────────────────────────

def premium_metric_card(label: str, value: str, delta: str = "", icon: str = "dot",
                        trend_positive: bool = True) -> str:
    """A gradient-badge metric card — used wherever a renderer wants more
    punch than a plain stat block (fitness/finance overviews)."""
    delta_html = status_pill(delta, "positive" if trend_positive else "negative") if delta else ""
    return f"""
    <div class="cl-metric-card" data-component="metric-card">
      <div class="cl-metric-top"><span class="cl-metric-ic">{svg_icon(icon)}</span>{delta_html}</div>
      <div class="cl-metric-value">{e(value)}</div>
      <div class="cl-metric-label">{e(label)}</div>
    </div>"""


# ── Action / session card (calm, wellness) ───────────────────────────

def action_card(icon: str, title: str, body: str, cta_label: str = "", tone: str = "default") -> str:
    """A soft, rounded action/session card — `tone="calm"` for the
    wellness/meditation vertical's breathing-session styling."""
    cta = (f'<button type="button" class="ds-btn ds-btn-ghost ds-btn-sm" data-select>{e(cta_label)}</button>'
           if cta_label else "")
    cls = "cl-action-card cl-action-calm" if tone == "calm" else "cl-action-card"
    return f"""
    <div class="{cls}" data-component="action-card">
      <span class="cl-action-ic">{svg_icon(icon)}</span>
      <div class="cl-action-body"><div class="t">{e(title)}</div><div class="s">{e(body)}</div></div>
      {cta}
    </div>"""


# ── Watchlist + portfolio allocation (finance/crypto) ────────────────

def watchlist_row(symbol: str, name: str, price: str, change_pct: float) -> str:
    """One ticker row — symbol/name, price, a colored gain/loss pill
    (never plain text) — used by the crypto/finance dashboard variant."""
    positive = change_pct >= 0
    arrow = "▲" if positive else "▼"
    return f"""
    <div class="cl-watch-row" data-component="watchlist-row">
      <div class="cl-watch-id"><span class="cl-watch-sym">{e(symbol)}</span><span class="cl-watch-name">{e(name)}</span></div>
      <div class="cl-watch-price">{e(price)}</div>
      {status_pill(f"{arrow} {abs(change_pct):.1f}%", "positive" if positive else "negative")}
    </div>"""


def portfolio_card(label: str, value: str, allocation_pct: int, trend_positive: bool = True) -> str:
    """An allocation card — value, a gradient allocation bar, a trend
    pill — used by the crypto/finance dashboard variant's overview."""
    pct = max(0, min(100, int(allocation_pct)))
    return f"""
    <div class="cl-portfolio-card" data-component="portfolio-card">
      <div class="cl-portfolio-top"><span class="lbl">{e(label)}</span>
        {status_pill(("▲ Up" if trend_positive else "▼ Down"), "positive" if trend_positive else "negative")}</div>
      <div class="cl-portfolio-value">{e(value)}</div>
      <div class="cl-portfolio-bar"><span style="width:{pct}%"></span></div>
      <div class="cl-portfolio-alloc">{pct}% of portfolio</div>
    </div>"""


# ── Recipe steps + ingredients (warm/editorial, food vertical) ───────

def recipe_steps(steps: Sequence[str]) -> str:
    """Numbered prep steps with a gradient step badge — not a plain
    bullet list."""
    rows = "".join(f"""
    <div class="cl-step"><span class="cl-step-n">{i + 1}</span><p>{e(s)}</p></div>""" for i, s in enumerate(steps))
    return f'<div class="cl-steps" data-component="recipe-steps">{rows}</div>'


def ingredient_chips(items: Sequence[str]) -> str:
    chips = "".join(f'<span class="cl-chip">{e(it)}</span>' for it in items)
    return f'<div class="cl-chips" data-component="ingredients">{chips}</div>'


def food_panel() -> str:
    """A warm, image-like food panel built entirely from CSS gradients
    (no external images) — the visual anchor of the recipe vertical."""
    return '<div class="cl-food-panel" data-component="food-panel"></div>'


__all__ = [
    "CSS", "status_pill", "empty_state", "toolbar", "table", "timeline", "calendar_grid", "waveform",
    "music_player", "notifications_panel", "form_fields", "premium_metric_card",
    "action_card", "watchlist_row", "portfolio_card", "recipe_steps",
    "ingredient_chips", "food_panel",
]
