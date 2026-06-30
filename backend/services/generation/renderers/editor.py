# coding: utf-8
# CRITICAL REBUILD — notes / editor renderer.
#
# Produces a real macOS-style desktop NOTES app, not a website: window
# chrome (traffic lights) + title bar with search & New Note, a folders/
# tags sidebar, a middle notes list, and a right rich editor with a
# formatting toolbar and note metadata. No marketing hero / pricing /
# testimonials / footer.

from __future__ import annotations

from backend.services.generation.renderers import base
from backend.services.generation.renderers.base import e, svg_icon, traffic_lights
from backend.services.generation.spec import ProductSpec

CSS = """
/* ── Notes / editor app shell (macOS desktop) ── */
.ed-window { width:100%; max-width:1240px; margin:26px auto; height:min(840px, 86vh);
  display:flex; flex-direction:column; border-radius:16px; overflow:hidden;
  border:1px solid var(--border-strong); background:var(--surface); box-shadow:var(--shadow-lg); }
.ed-titlebar { display:flex; align-items:center; gap:16px; padding:0 16px; height:52px; flex:0 0 auto;
  background:linear-gradient(180deg, color-mix(in srgb,var(--surface-2) 70%,var(--surface)), var(--surface));
  border-bottom:1px solid var(--border); }
.ed-title-actions { display:flex; align-items:center; gap:10px; margin-left:8px; flex:1; }
.ed-tool { display:inline-flex; align-items:center; gap:7px; cursor:pointer; font:inherit; font-weight:600;
  font-size:.84rem; color:var(--accent); background:transparent; border:0; padding:6px 8px; border-radius:8px; }
.ed-tool:hover { background:var(--surface-2); }
.ed-tool .ds-svg-icon { width:15px; height:15px; }
.ed-search-wrap { position:relative; margin-left:auto; width:min(260px,40%); }
.ed-search-wrap .ds-svg-icon { position:absolute; left:10px; top:50%; transform:translateY(-50%);
  width:14px; height:14px; opacity:.55; pointer-events:none; }
.ed-search { width:100%; font:inherit; font-size:.84rem; color:var(--text);
  background:var(--surface-2); border:1px solid var(--border); border-radius:8px; padding:7px 12px 7px 30px; outline:none; }
.ed-search:focus { border-color:var(--accent); }
.ed-cols { flex:1; display:grid; grid-template-columns:228px 312px 1fr; min-height:0; }
.ed-sidebar { background:var(--surface-2); border-right:1px solid var(--border); padding:14px 10px; overflow:auto; }
.ed-side-label { display:block; font-size:.72rem; font-weight:700; letter-spacing:.06em; text-transform:uppercase;
  color:var(--text-dim); padding:10px 10px 6px; }
.ed-folder { display:flex; align-items:center; gap:10px; padding:8px 10px; border-radius:8px; cursor:pointer;
  color:var(--text-muted); font-size:.9rem; font-weight:550; transition:background var(--t) var(--ease); }
.ed-folder .ed-fi { width:18px; display:inline-flex; align-items:center; justify-content:center; opacity:.8; }
.ed-folder .ed-fi .ds-svg-icon { width:16px; height:16px; }
.ed-folder .ed-fc { margin-left:auto; font-size:.76rem; color:var(--text-dim); }
.ed-folder:hover { background:color-mix(in srgb,var(--accent) 10%, transparent); color:var(--text); }
.ed-folder.is-active { background:color-mix(in srgb,var(--accent) 18%, transparent); color:var(--text); font-weight:650; }
.ed-tags { display:flex; flex-wrap:wrap; gap:6px; padding:4px 8px; }
.ed-tag { font-size:.76rem; padding:4px 10px; border-radius:9999px; background:var(--surface);
  border:1px solid var(--border); color:var(--text-muted); }
.ed-list { border-right:1px solid var(--border); display:flex; flex-direction:column; min-height:0; background:var(--surface); }
.ed-list-head { display:flex; align-items:baseline; justify-content:space-between; padding:16px 18px 10px; }
.ed-list-title { font-size:1.15rem; font-weight:740; letter-spacing:-.02em; }
.ed-count { font-size:.8rem; color:var(--text-dim); }
#notes-list { overflow:auto; flex:1; }
.ed-note { padding:12px 18px; border-bottom:1px solid var(--border); cursor:pointer; transition:background var(--t) var(--ease); }
.ed-note:hover { background:var(--surface-2); }
.ed-note.is-selected { background:color-mix(in srgb,var(--accent) 16%, var(--surface-2)); box-shadow:inset 3px 0 0 var(--accent); }
.ed-note-row { display:flex; align-items:baseline; justify-content:space-between; gap:10px; }
.ed-note-title { font-weight:650; font-size:.95rem; color:var(--text); }
.ed-note-time { font-size:.74rem; color:var(--text-dim); flex:0 0 auto; }
.ed-note-snippet { font-size:.83rem; color:var(--text-dim); margin-top:3px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ed-main { display:flex; flex-direction:column; min-height:0; background:var(--surface); }
.ed-toolbar { display:flex; align-items:center; gap:4px; padding:9px 16px; border-bottom:1px solid var(--border);
  background:color-mix(in srgb,var(--surface-2) 50%, var(--surface)); flex-wrap:wrap; }
.ed-fmt { width:32px; height:30px; display:grid; place-items:center; cursor:pointer; border-radius:7px;
  background:transparent; border:1px solid transparent; color:var(--text-muted); font-size:.9rem; font-weight:650; }
.ed-fmt:hover { background:var(--surface-2); color:var(--text); }
.ed-fmt.is-active { background:color-mix(in srgb,var(--accent) 20%, transparent); color:var(--text); border-color:color-mix(in srgb,var(--accent) 40%, transparent); }
.ed-fmt-sep { width:1px; height:20px; background:var(--border); margin:0 6px; }
.ed-tool-spacer { flex:1; }
.ed-doc { overflow:auto; flex:1; padding:34px clamp(24px,6vw,64px); }
.ed-doc-inner { max-width:720px; margin:0 auto; }
.ed-meta { font-size:.8rem; color:var(--text-dim); margin-bottom:14px; }
.ed-title { font-size:2rem; font-weight:760; letter-spacing:-.025em; line-height:1.1; }
.ed-body { margin-top:18px; color:var(--text-muted); white-space:pre-wrap; line-height:1.78; font-size:1.04rem; }
@media (max-width:900px){
  .ed-window { height:auto; }
  .ed-cols { grid-template-columns:1fr; }
  .ed-sidebar, .ed-list { border-right:0; border-bottom:1px solid var(--border); max-height:280px; }
}
""".strip()

_FORMAT_BTNS = [
    ("B", "Bold", "style=font-weight:800"), ("i", "Italic", "style=font-style:italic;font-weight:700"),
    ("U", "Underline", "style=text-decoration:underline"), ("SEP", "", ""),
    ("H", "Heading", ""), ("•", "Bullet list", ""), ("☑", "Checklist", ""),
    ("“”", "Quote", ""), ("SEP", "", ""), ("⊞", "Table", ""), ("🔗", "Link", ""),
]


def _toolbar() -> str:
    out = []
    for glyph, title, st in _FORMAT_BTNS:
        if glyph == "SEP":
            out.append('<span class="ed-fmt-sep"></span>')
            continue
        out.append(f'<button class="ed-fmt" data-format title="{e(title)}" {st}>{e(glyph)}</button>')
    out.append('<span class="ed-tool-spacer"></span>')
    out.append('<button class="ed-fmt" data-format title="Share">⇪</button>')
    out.append('<button class="ed-fmt" data-format title="Note info">ⓘ</button>')
    return f'<div class="ed-toolbar">{"".join(out)}</div>'


def render(spec: ProductSpec) -> str:
    data = spec.data or {}
    folders = data.get("folders") or [{"name": "All Notes", "key": "all", "count": 0, "icon": "🗒"}]
    notes = data.get("notes") or [{"title": spec.name, "snippet": "", "body": "", "folder": "all", "date": ""}]
    tags = data.get("tags") or ["Important", "Work", "Ideas", "Later"]

    # Sprint 2.2 — folder icons resolved via the shared SVG icon system
    # (crisp, monochrome, consistent with every other renderer) instead of
    # emoji glyphs, regardless of any legacy emoji embedded in seed data.
    folder_icons = {"all": "book", "personal": "person", "work": "folder", "ideas": "idea", "archive": "archive"}
    folder_rows = "".join(
        f'<div class="ed-folder{" is-active" if i == 0 else ""}" data-folder="{e(f.get("key","all"))}" '
        f'data-folder-name="{e(f.get("name"))}">'
        f'<span class="ed-fi">{svg_icon(folder_icons.get(f.get("key"), "folder"))}</span>'
        f'<span>{e(f.get("name"))}</span><span class="ed-fc">{e(f.get("count",""))}</span></div>'
        for i, f in enumerate(folders))
    tag_chips = "".join(f'<span class="ed-tag"># {e(t)}</span>' for t in tags)

    note_rows = []
    for i, n in enumerate(notes):
        searchable = f'{n.get("title","")} {n.get("snippet","")} {n.get("body","")}'.lower()
        note_rows.append(
            f'<div class="ed-note{" is-selected" if i == 0 else ""}" data-note '
            f'data-in-folder="{e(n.get("folder","all"))}" data-searchable="{e(searchable)}" '
            f'data-title="{e(n.get("title"))}" data-body="{e(n.get("body"))}" data-date="{e(n.get("date",""))}">'
            f'<div class="ed-note-row"><span class="ed-note-title">{e(n.get("title"))}</span>'
            f'<span class="ed-note-time">{e(n.get("time", n.get("date","")))}</span></div>'
            f'<div class="ed-note-snippet">{e(n.get("snippet"))}</div></div>')
    first = notes[0]

    body = f"""
<main class="ed-window">
  <div class="ed-titlebar">
    {traffic_lights()}
    <div class="ed-title-actions">
      <button class="ed-tool" data-new-note title="New note">{svg_icon('plus')} New Note</button>
      <span class="ed-search-wrap">{svg_icon('search')}
        <input class="ed-search" type="text" placeholder="Search" data-search aria-label="Search notes">
      </span>
    </div>
  </div>
  <div class="ed-cols">
    <aside class="ed-sidebar" aria-label="Folders">
      <span class="ed-side-label">iCloud</span>
      {folder_rows}
      <span class="ed-side-label">Tags</span>
      <div class="ed-tags">{tag_chips}</div>
    </aside>
    <section class="ed-list" aria-label="Notes">
      <div class="ed-list-head"><h2 class="ed-list-title" id="folder-label">All Notes</h2>
        <span class="ed-count">{len(notes)} notes</span></div>
      <div id="notes-list">{"".join(note_rows)}</div>
    </section>
    <section class="ed-main" aria-label="Editor">
      {_toolbar()}
      <div class="ed-doc">
        <div class="ed-doc-inner">
          <div class="ed-meta" id="note-meta">{e(first.get("date",""))}</div>
          <h1 class="ed-title" id="note-title">{e(first.get("title"))}</h1>
          <div class="ed-body" id="note-body">{e(first.get("body"))}</div>
        </div>
      </div>
    </section>
  </div>
</main>"""
    return body


__all__ = ["CSS", "render"]
