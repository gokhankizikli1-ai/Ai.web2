# coding: utf-8
# EPIC 2 — Premium HTML renderer.
#
# Turns a ProductSpec into ONE clean, semantic, responsive, dark-mode,
# premium HTML document assembled from reusable components + the design
# system. This is both the deterministic generator AND the
# guaranteed-quality fallback when LLM output is weak — which is what
# makes the six success-criteria prompts render as distinct, polished
# products without depending on a live model.

from __future__ import annotations

import html as _html
from typing import List

from backend.services.generation.design_system import design_system_css
from backend.services.generation.spec import ProductSpec, Section


def _e(s: str) -> str:
    return _html.escape(str(s or ""), quote=True)


def _nav(spec: ProductSpec) -> str:
    links = "".join(f'<a href="#{_slug(l)}">{_e(l)}</a>' for l in spec.navigation)
    return f"""
<header class="ds-nav">
  <div class="ds-nav-brand"><span class="ds-nav-logo"></span>{_e(spec.name)}</div>
  <nav class="ds-nav-links">{links}</nav>
  <button class="ds-btn ds-btn-primary">{_e(spec.cta_primary)}</button>
</header>"""


def _hero(spec: ProductSpec) -> str:
    return f"""
<section class="ds-hero ds-container" id="overview">
  <span class="ds-eyebrow ds-rise">{_e(spec.product_type.replace('_',' ').title())}</span>
  <h1 class="ds-rise">{_e(spec.tagline)}</h1>
  <p class="ds-rise">{_e(spec.description)}</p>
  <div class="ds-hero-actions ds-rise">
    <button class="ds-btn ds-btn-primary">{_e(spec.cta_primary)}</button>
    <button class="ds-btn ds-btn-ghost">{_e(spec.cta_secondary)}</button>
  </div>
</section>"""


def _metrics(spec: ProductSpec, sec: Section) -> str:
    cards = "".join(f"""
    <div class="ds-card ds-stat ds-rise">
      <span style="color:var(--text-dim);font-size:.85rem">{_e(m.get('label'))}</span>
      <span class="ds-stat-value">{_e(m.get('value'))}</span>
      <span class="ds-stat-delta">{_e(m.get('delta'))}</span>
    </div>""" for m in spec.metrics)
    return _wrap_section(sec, f'<div class="ds-grid">{cards}</div>')


def _features(sec: Section) -> str:
    cards = "".join(f"""
    <div class="ds-card ds-rise">
      <div class="ds-icon">{_e(c.get('icon','●'))}</div>
      <h3>{_e(c.get('title'))}</h3>
      <p style="margin-top:8px">{_e(c.get('body'))}</p>
    </div>""" for c in sec.items)
    return _wrap_section(sec, f'<div class="ds-grid">{cards}</div>')


def _pricing(sec: Section) -> str:
    cards = "".join(f"""
    <div class="ds-card ds-rise" style="text-align:center">
      <h3>{_e(c.get('title'))}</h3>
      <div class="ds-stat-value" style="margin:10px 0">{_e(c.get('body'))}</div>
      <p>{_e(c.get('icon'))}</p>
      <button class="ds-btn ds-btn-ghost" style="margin-top:16px;width:100%">Choose</button>
    </div>""" for c in sec.items)
    return _wrap_section(sec, f'<div class="ds-grid">{cards}</div>')


def _testimonials(sec: Section) -> str:
    cards = "".join(f"""
    <div class="ds-card ds-rise">
      <p style="color:var(--text);font-size:1.05rem">{_e(c.get('title'))}</p>
      <p style="margin-top:14px;font-size:.85rem">{_e(c.get('body'))}</p>
    </div>""" for c in sec.items)
    return _wrap_section(sec, f'<div class="ds-grid">{cards}</div>')


def _faq(sec: Section) -> str:
    items = "".join(f"""
    <details class="ds-card ds-rise" style="cursor:pointer">
      <summary style="font-weight:600;color:var(--text)">{_e(c.get('title'))}</summary>
      <p style="margin-top:10px">{_e(c.get('body'))}</p>
    </details>""" for c in sec.items)
    return _wrap_section(sec, f'<div style="display:grid;gap:12px;max-width:760px;margin:0 auto">{items}</div>')


def _gallery(sec: Section) -> str:
    tiles = "".join(
        f'<div class="ds-card ds-rise" style="aspect-ratio:4/3;'
        f'background:linear-gradient(135deg,color-mix(in srgb,var(--accent) {20+10*i}%,transparent),'
        f'color-mix(in srgb,var(--accent-2) {20+10*i}%,transparent))"></div>'
        for i in range(6))
    return _wrap_section(sec, f'<div class="ds-grid">{tiles}</div>')


def _panel(sec: Section) -> str:
    # A representative product surface (dashboard rows / conversation /
    # reservation form) — glass panel with mock rows.
    rows = "".join(f"""
      <div style="display:flex;justify-content:space-between;align-items:center;
        padding:14px 16px;border-bottom:1px solid var(--border)">
        <span style="color:var(--text)">{_e(label)}</span>
        <span style="color:var(--text-dim);font-size:.85rem">{_e(val)}</span>
      </div>""" for label, val in _panel_rows(sec))
    body = f"""
    <div class="ds-card ds-glass ds-rise" style="padding:0;overflow:hidden">
      <div style="padding:16px;border-bottom:1px solid var(--border);font-weight:600">{_e(sec.subtitle or sec.title)}</div>
      {rows}
    </div>"""
    return _wrap_section(sec, body)


def _panel_rows(sec: Section):
    return [("Overview", "Live"), ("Details", "Updated just now"),
            ("Status", "All systems normal"), ("Next", "Ready")]


def _cta(spec: ProductSpec, sec: Section) -> str:
    return f"""
<section class="ds-section ds-container" id="get-started">
  <div class="ds-card ds-glass ds-rise" style="text-align:center;padding:56px 24px">
    <h2>{_e(sec.title or 'Get started today')}</h2>
    <p style="max-width:40ch;margin:14px auto 28px">{_e(spec.description)}</p>
    <button class="ds-btn ds-btn-primary">{_e(spec.cta_primary)}</button>
  </div>
</section>"""


def _wrap_section(sec: Section, inner: str) -> str:
    head = ""
    if sec.title:
        head = (f'<div style="margin-bottom:32px;text-align:center">'
                f'<h2>{_e(sec.title)}</h2>'
                + (f'<p style="margin-top:10px">{_e(sec.subtitle)}</p>' if sec.subtitle else "")
                + '</div>')
    return f'<section class="ds-section ds-container" id="{_slug(sec.title)}">{head}{inner}</section>'


def _footer(spec: ProductSpec) -> str:
    links = "".join(f'<a href="#{_slug(l)}" style="margin-right:20px">{_e(l)}</a>' for l in spec.navigation)
    return f"""
<footer class="ds-footer">
  <div class="ds-container" style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:16px">
    <div class="ds-nav-brand"><span class="ds-nav-logo"></span>{_e(spec.name)}</div>
    <div>{links}</div>
    <span>© {_e(spec.name)}. Crafted with Korvix.</span>
  </div>
</footer>"""


def _slug(s: str) -> str:
    import re
    return re.sub(r"[^a-z0-9]+", "-", (s or "section").lower()).strip("-") or "section"


def render_premium_page(spec: ProductSpec) -> str:
    """Render the full premium HTML document for a ProductSpec."""
    body_parts: List[str] = [_nav(spec), '<main>', _hero(spec)]
    for sec in spec.sections:
        if sec.kind == "metrics":         body_parts.append(_metrics(spec, sec))
        elif sec.kind == "features":      body_parts.append(_features(sec))
        elif sec.kind == "pricing":       body_parts.append(_pricing(sec))
        elif sec.kind == "testimonials":  body_parts.append(_testimonials(sec))
        elif sec.kind == "faq":           body_parts.append(_faq(sec))
        elif sec.kind == "gallery":       body_parts.append(_gallery(sec))
        elif sec.kind == "panel":         body_parts.append(_panel(sec))
        elif sec.kind == "cta":           body_parts.append(_cta(spec, sec))
        else:                             body_parts.append(_features(sec))
    body_parts += ['</main>', _footer(spec)]
    body = "\n".join(body_parts)

    css = design_system_css(spec.theme.get("accent", "#6366f1"),
                            spec.theme.get("accent2", "#22d3ee"))
    mode_class = "" if spec.dark_mode else "light"
    return f"""<!DOCTYPE html>
<html lang="en" class="{mode_class}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{_e(spec.name)} — {_e(spec.tagline)}</title>
<meta name="description" content="{_e(spec.description)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
{css}
</style>
</head>
<body>
{body}
</body>
</html>"""


def ensure_viewport(html_doc: str) -> str:
    """Guarantee a responsive viewport meta on an otherwise-good LLM doc."""
    if "viewport" in (html_doc or "").lower():
        return html_doc
    return html_doc.replace(
        "<head>",
        '<head>\n<meta name="viewport" content="width=device-width, initial-scale=1">',
        1,
    ) if "<head>" in html_doc else html_doc


__all__ = ["render_premium_page", "ensure_viewport"]
