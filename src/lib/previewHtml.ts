// previewHtml — shared "premium base CSS" enhancement layer for every place
// that renders backend-generated HTML (iframe srcDoc, or a printed/opened
// tab). The backend may return a full <!DOCTYPE html> document or a bare
// fragment — this wraps either case with an injected <style> so simple,
// unstyled generated dashboards read as a modern dark SaaS surface instead
// of raw browser-default HTML.
//
// The injected rules are intentionally low-specificity (element selectors +
// single attribute/class substring selectors) and are always inserted FIRST
// in <head>, so any styling the generated document already ships overrides
// ours via normal cascade order — we only fill in what the artifact didn't
// style itself. Nothing here executes code or touches the sandbox: it is a
// pure string transform, one <style> tag, no scripts added or removed.
//
// `[class*="x" i]` substring selectors are a heuristic: generated dashboards
// don't share one design system, so we match on common naming patterns
// (sidebar/card/badge/tab/…) instead of requiring exact class names.
const PREMIUM_PREVIEW_CSS = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; min-height: 100%;
    background: radial-gradient(120% 100% at 50% 0%, #17151f 0%, #0b0b10 55%, #08080b 100%);
    color: #e5e7eb;
    font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
    line-height: 1.55;
  }
  h1, h2, h3, h4, h5, h6 { font-weight: 600; letter-spacing: -0.012em; color: #fff; margin: 0 0 0.5em; }
  p { color: #a1a1aa; margin: 0 0 1em; }
  a { color: #93c5fd; text-decoration: none; }
  a:hover { text-decoration: underline; }
  img, svg { max-width: 100%; }
  hr { border: none; border-top: 1px solid rgba(255,255,255,0.08); margin: 20px 0; }

  /* ── Layout containers — trim the huge empty margins simple templates
         tend to ship with, without fighting an explicit sidebar layout. */
  [class*="container" i]:not([class*="sidebar" i]):not([class*="card" i]),
  [class*="wrapper" i]:not([class*="sidebar" i]):not([class*="card" i]) {
    max-width: 1440px; margin-left: auto; margin-right: auto;
  }
  [class*="grid" i] { gap: 16px; }
  section, [class*="section" i] { padding: 20px 0; }

  /* ── Topbar / header ────────────────────────────────────────────────── */
  header, [class*="header" i], [class*="topbar" i], [class*="navbar" i] {
    background: rgba(255,255,255,0.035);
    backdrop-filter: blur(14px);
    border-bottom: 1px solid rgba(255,255,255,0.08);
    padding: 14px 22px;
    position: sticky; top: 0; z-index: 20;
  }
  [class*="search" i] input, input[type="search"] {
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 10px;
    padding: 8px 12px 8px 32px;
  }
  [class*="avatar" i] {
    border-radius: 999px; overflow: hidden;
    background: linear-gradient(135deg, #818cf8, #22d3ee);
    width: 32px; height: 32px; display: inline-flex;
    align-items: center; justify-content: center; color: #0a0a0a; font-weight: 600;
  }

  /* ── Sidebar ────────────────────────────────────────────────────────── */
  aside, [class*="sidebar" i], [class*="side-nav" i] {
    background: rgba(255,255,255,0.025);
    border-right: 1px solid rgba(255,255,255,0.07);
    width: clamp(216px, 20vw, 264px);
    padding: 18px 14px;
  }
  aside > *:first-child, [class*="sidebar" i] > *:first-child,
  [class*="sidebar-header" i], [class*="sidebar-logo" i], [class*="sidebar" i] [class*="logo" i] {
    padding-bottom: 16px; margin-bottom: 12px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    font-weight: 600; color: #fff;
  }
  aside > *:last-child, [class*="sidebar-footer" i] {
    margin-top: auto; padding-top: 14px;
    border-top: 1px solid rgba(255,255,255,0.06);
  }
  aside a, aside li, aside button,
  [class*="sidebar" i] a, [class*="sidebar" i] li, [class*="sidebar" i] button,
  [class*="side-nav" i] a, [class*="side-nav" i] li, [class*="side-nav" i] button {
    display: flex; align-items: center; gap: 10px;
    border-radius: 9px; padding: 9px 10px; margin: 2px 0;
    color: #9ca3af; list-style: none; font-size: 13px;
    border-left: 2px solid transparent;
  }
  aside a:hover, [class*="sidebar" i] a:hover, [class*="side-nav" i] a:hover {
    background: rgba(255,255,255,0.055); color: #fff; text-decoration: none;
  }
  aside [class*="active" i], aside [aria-current], aside [class*="selected" i],
  [class*="sidebar" i] [class*="active" i], [class*="sidebar" i] [aria-current], [class*="sidebar" i] [class*="selected" i] {
    background: linear-gradient(90deg, rgba(129,140,248,0.16), rgba(129,140,248,0.02));
    color: #fff; border-left: 2px solid #818cf8;
  }

  /* ── Icon glyphs — generated markup often drops raw emoji or icon-font
         placeholders inline; give them a consistent tile instead of a bare,
         oddly-sized glyph. Scoped to leaf icon tags, not wrapper/toolbar
         classes like "icon-bar" or "icons-row". */
  i[class*="icon" i], em[class*="icon" i],
  span[class*="icon" i]:not([class*="icons" i]):not([class*="icon-bar" i]) {
    display: inline-flex; align-items: center; justify-content: center;
    width: 24px; height: 24px; border-radius: 7px; flex-shrink: 0;
    background: rgba(255,255,255,0.06); font-size: 13px; line-height: 1;
    font-style: normal;
  }

  /* ── Cards / panels / stats ─────────────────────────────────────────── */
  [class*="card" i], [class*="panel" i], [class*="widget" i], [class*="stat" i] {
    background: linear-gradient(165deg, rgba(255,255,255,0.055), rgba(255,255,255,0.02));
    border: 1px solid rgba(255,255,255,0.09);
    border-radius: 14px;
    padding: 18px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.28);
    transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
  }
  a[class*="card" i]:hover, button[class*="card" i]:hover,
  [class*="card" i][class*="hover" i]:hover, [class*="card" i][role="button"]:hover {
    transform: translateY(-2px);
    border-color: rgba(255,255,255,0.16);
    box-shadow: 0 16px 40px rgba(0,0,0,0.36);
  }

  /* ── Buttons / forms ────────────────────────────────────────────────── */
  button, [class*="btn" i], input[type="submit"], input[type="button"] {
    font-family: inherit;
    border-radius: 10px;
    padding: 9px 16px;
    border: 1px solid rgba(255,255,255,0.1);
    background: linear-gradient(135deg, #818cf8, #22d3ee);
    color: #0a0a0a;
    font-weight: 600;
    font-size: 13px;
    cursor: pointer;
    transition: filter 0.15s ease, transform 0.1s ease;
  }
  button:hover, [class*="btn" i]:hover { filter: brightness(1.08); }
  button:active, [class*="btn" i]:active { transform: scale(0.98); }
  button[class*="secondary" i], [class*="btn-secondary" i], [class*="outline" i], [class*="ghost" i] {
    background: rgba(255,255,255,0.05); color: #e5e7eb; border: 1px solid rgba(255,255,255,0.12);
  }

  input, textarea, select {
    font-family: inherit;
    background: rgba(255,255,255,0.045);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 10px;
    padding: 9px 12px;
    color: #e5e7eb;
    font-size: 13px;
  }
  input::placeholder, textarea::placeholder { color: #6b7280; }
  input:focus, textarea:focus, select:focus { outline: none; border-color: rgba(129,140,248,0.5); }
  label { color: #9ca3af; font-size: 12px; }

  /* Toggles / switches — assume a track element with a class like
     "toggle"/"switch"; visual only, no behavior added. */
  [class*="toggle" i]:not(input), [class*="switch" i]:not(input) {
    position: relative; display: inline-block; width: 38px; height: 22px;
    border-radius: 999px; background: rgba(255,255,255,0.12);
    border: 1px solid rgba(255,255,255,0.1); vertical-align: middle;
  }
  [class*="toggle" i][class*="active" i]:not(input), [class*="toggle" i][class*="on" i]:not(input),
  [class*="switch" i][class*="active" i]:not(input), [class*="switch" i][class*="on" i]:not(input) {
    background: linear-gradient(135deg, #818cf8, #22d3ee);
  }

  /* Tabs */
  [class*="tab" i]:not([class*="table" i]) {
    display: inline-flex; align-items: center; padding: 7px 14px;
    border-radius: 8px; font-size: 12.5px; color: #9ca3af; cursor: pointer;
  }
  [class*="tab" i][class*="active" i], [class*="tab" i][aria-selected="true"] {
    background: rgba(255,255,255,0.07); color: #fff;
  }

  table { border-collapse: collapse; width: 100%; }
  th, td { padding: 10px 14px; border-bottom: 1px solid rgba(255,255,255,0.07); text-align: left; font-size: 13px; }
  th { color: #9ca3af; font-weight: 500; text-transform: uppercase; font-size: 11px; letter-spacing: 0.04em; }
  tbody tr:hover { background: rgba(255,255,255,0.025); }

  [class*="badge" i], [class*="tag" i], [class*="pill" i] {
    display: inline-flex; align-items: center; border-radius: 999px;
    padding: 3px 10px; font-size: 11px; font-weight: 500;
    background: rgba(129,140,248,0.15); color: #c7d2fe;
  }

  /* ── Charts — CSS-only refinement for common bar/progress patterns.
         Actual chart libraries (canvas/svg) render as-is; this only helps
         div-based bar/progress placeholders look intentional. */
  [class*="chart" i] { padding: 4px 0; }
  [class~="progress" i]:not([class*="progress-bar" i]):not([class*="progress-fill" i]),
  [class*="progress-track" i]:not([class*="progress-bar" i]):not([class*="progress-fill" i]) {
    background: rgba(255,255,255,0.08); border-radius: 999px; overflow: hidden; height: 8px;
  }
  [class*="progress-bar" i], [class*="progress-fill" i], [class*="bar-fill" i] {
    background: linear-gradient(90deg, #818cf8, #22d3ee); border-radius: 999px; height: 100%;
  }

  /* ── Activity / timeline feeds ──────────────────────────────────────── */
  [class*="timeline" i] li, [class*="activity" i] li, [class*="feed" i] li {
    position: relative; padding-left: 20px; padding-bottom: 16px;
    border-left: 1px solid rgba(255,255,255,0.09); margin-left: 4px;
  }
  [class*="timeline" i] li::before, [class*="activity" i] li::before, [class*="feed" i] li::before {
    content: ''; position: absolute; left: -4px; top: 4px;
    width: 7px; height: 7px; border-radius: 999px;
    background: #818cf8; box-shadow: 0 0 0 3px rgba(129,140,248,0.18);
  }

  /* ── Settings panels — label/control rows with quiet dividers ──────── */
  [class*="settings" i] [class*="row" i], [class*="settings" i] [class*="item" i] {
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
    padding: 14px 0; border-bottom: 1px solid rgba(255,255,255,0.06);
  }

  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 8px; }
  ::-webkit-scrollbar-track { background: transparent; }
`;

function styleTag(): string {
  return `<style id="korvix-premium-preview">${PREMIUM_PREVIEW_CSS}</style>`;
}

// Injects the premium base CSS into a full document (before any of its own
// <style>/<link> tags) or wraps a bare fragment in a minimal document shell.
export function wrapWithPremiumCss(html: string | null | undefined): string {
  const src = html ?? '';
  if (!src.trim()) return src;

  const headMatch = src.match(/<head[^>]*>/i);
  if (headMatch) {
    const idx = src.indexOf(headMatch[0]) + headMatch[0].length;
    return src.slice(0, idx) + styleTag() + src.slice(idx);
  }

  const htmlMatch = src.match(/<html[^>]*>/i);
  if (htmlMatch) {
    const idx = src.indexOf(htmlMatch[0]) + htmlMatch[0].length;
    return src.slice(0, idx) + `<head>${styleTag()}</head>` + src.slice(idx);
  }

  // Bare fragment — no <html>/<head> at all: wrap in a minimal document.
  return `<!DOCTYPE html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />${styleTag()}</head><body>${src}</body></html>`;
}
