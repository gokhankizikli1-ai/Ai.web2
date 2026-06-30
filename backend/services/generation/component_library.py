# coding: utf-8
# Sprint 2.0 — shared, reusable component library.
#
# Genuinely reusable building blocks used by more than one renderer module
# (or that close a real gap in the `components.py` catalog — Tables,
# Timeline, Calendar, Music Player, Notifications, Forms had guidance text
# but no actual implementation). Renderers ASSEMBLE pages from these
# instead of hand-rolling another copy of the same markup.
#
# Pure functions: small explicit data in, an HTML fragment out. No spec
# coupling beyond what's explicitly passed — independently testable, and
# every renderer that imports them stays visually consistent with every
# other renderer via the shared design-system tokens (CSS below only adds
# component-specific layout, never new colors/radii/shadows).

from __future__ import annotations

from typing import Any, Dict, Sequence

from backend.services.generation.renderers.base import e, svg_icon

CSS = """
/* ── Shared component library (Sprint 2.0) ── */
.cl-table-wrap { overflow-x:auto; border:1px solid var(--border); border-radius:var(--radius-lg); background:var(--surface); }
.cl-table { width:100%; border-collapse:collapse; font-size:.88rem; }
.cl-table th { text-align:left; padding:10px 14px; color:var(--text-dim); font-weight:600;
  font-size:.74rem; text-transform:uppercase; letter-spacing:.04em; border-bottom:1px solid var(--border); white-space:nowrap; }
.cl-table td { padding:12px 14px; border-bottom:1px solid var(--border); color:var(--text); white-space:nowrap; }
.cl-table tr:last-child td { border-bottom:0; }
.cl-table tr:hover td { background:var(--surface-2); }

.cl-timeline { display:flex; flex-direction:column; gap:0; }
.cl-timeline-item { display:flex; gap:14px; padding-bottom:22px; position:relative; }
.cl-timeline-item:last-child { padding-bottom:0; }
.cl-timeline-item::before { content:''; position:absolute; left:9px; top:22px; bottom:0; width:1px; background:var(--border); }
.cl-timeline-item:last-child::before { display:none; }
.cl-timeline-dot { width:20px; height:20px; border-radius:9999px; flex:0 0 auto; z-index:1;
  background:color-mix(in srgb,var(--accent) 18%, var(--surface-2)); color:var(--accent); display:grid; place-items:center; }
.cl-timeline-dot .ds-svg-icon { width:12px; height:12px; }
.cl-timeline-body { flex:1; min-width:0; padding-top:1px; }
.cl-timeline-body .t { font-weight:650; font-size:.9rem; color:var(--text); }
.cl-timeline-body .s { font-size:.82rem; color:var(--text-dim); margin-top:2px; }
.cl-timeline-time { font-size:.74rem; color:var(--text-dim); white-space:nowrap; }

.cl-cal { display:grid; grid-template-columns:repeat(7,1fr); gap:6px; }
.cl-cal-dow { text-align:center; font-size:.7rem; color:var(--text-dim); font-weight:650; padding-bottom:4px; }
.cl-cal-day { aspect-ratio:1; display:grid; place-items:center; border-radius:9px; font-size:.82rem;
  color:var(--text-muted); background:var(--surface-2); }
.cl-cal-day.is-marked { background:var(--grad); color:#fff; font-weight:700; box-shadow:var(--glow); }
.cl-cal-day.is-today { box-shadow:inset 0 0 0 1.5px var(--accent); color:var(--text); }
.cl-cal-day.is-empty { background:transparent; }

.cl-player { display:flex; flex-direction:column; gap:14px; padding:18px; border-radius:var(--radius-lg);
  background:var(--surface); border:1px solid var(--border); }
.cl-player-art { width:100%; aspect-ratio:1; border-radius:var(--radius); background:var(--grad);
  box-shadow:var(--glow); position:relative; overflow:hidden; }
.cl-player-art::after { content:''; position:absolute; inset:-30% -10% auto auto; width:60%; aspect-ratio:1;
  background:radial-gradient(closest-side, rgba(255,255,255,.22), transparent); }
.cl-player-meta .t { font-weight:700; font-size:1.02rem; }
.cl-player-meta .s { font-size:.84rem; color:var(--text-dim); margin-top:2px; }
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
""".strip()


# ── Table ────────────────────────────────────────────────────────────

def table(headers: Sequence[str], rows: Sequence[Sequence[Any]]) -> str:
    """A real data table — header row + body rows. Used by the Admin
    Panel renderer variant for a dense records view."""
    head = "".join(f"<th>{e(h)}</th>" for h in headers)
    body = "".join(
        "<tr>" + "".join(f"<td>{e(c)}</td>" for c in row) + "</tr>" for row in rows
    ) or f'<tr><td colspan="{max(len(headers), 1)}" style="color:var(--text-dim)">No records yet.</td></tr>'
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


# ── Calendar ─────────────────────────────────────────────────────────

def calendar_grid(month_label: str, marked_days: Sequence[int], today: int = 0,
                  days_in_month: int = 30, start_weekday: int = 0) -> str:
    """A real month grid (S-S header + numbered day cells), with marked
    (e.g. streak/booked) days and an optional "today" ring."""
    dow = "".join(f'<span class="cl-cal-dow">{d}</span>' for d in ("S", "M", "T", "W", "T", "F", "S"))
    marked = set(marked_days or [])
    start_weekday = max(0, min(6, int(start_weekday)))
    cells = ['<span class="cl-cal-day is-empty"></span>' for _ in range(start_weekday)]
    for day in range(1, max(1, int(days_in_month)) + 1):
        cls = "cl-cal-day"
        if day == today:
            cls += " is-today"
        if day in marked:
            cls += " is-marked"
        cells.append(f'<span class="{cls}">{day}</span>')
    return (f'<div data-component="calendar"><div style="font-weight:650;margin-bottom:10px">{e(month_label)}</div>'
            f'<div class="cl-cal">{dow}{"".join(cells)}</div></div>')


# ── Music player ─────────────────────────────────────────────────────

def music_player(track_title: str, artist: str, progress_pct: int = 38,
                 elapsed: str = "1:24", duration: str = "3:42") -> str:
    """A real player widget — album-art block, progress bar, transport
    controls. Used by the mobile renderer for the "media" vertical."""
    pct = max(0, min(100, int(progress_pct)))
    return f"""
    <div class="cl-player" data-component="music-player">
      <div class="cl-player-art"></div>
      <div class="cl-player-meta"><div class="t">{e(track_title)}</div><div class="s">{e(artist)}</div></div>
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


__all__ = [
    "CSS", "table", "timeline", "calendar_grid", "music_player",
    "notifications_panel", "form_fields",
]
