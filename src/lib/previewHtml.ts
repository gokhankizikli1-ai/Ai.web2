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
  h1, h2, h3, h4, h5, h6 { font-weight: 600; letter-spacing: -0.01em; color: #fff; margin: 0 0 0.5em; }
  p { color: #a1a1aa; margin: 0 0 1em; }
  a { color: #93c5fd; text-decoration: none; }
  a:hover { text-decoration: underline; }
  img, svg { max-width: 100%; }

  header, [class*="header" i], [class*="topbar" i], [class*="navbar" i] {
    background: rgba(255,255,255,0.03);
    backdrop-filter: blur(12px);
    border-bottom: 1px solid rgba(255,255,255,0.08);
    padding: 14px 20px;
  }

  aside, [class*="sidebar" i], [class*="side-nav" i] {
    background: rgba(255,255,255,0.02);
    border-right: 1px solid rgba(255,255,255,0.06);
    width: clamp(200px, 20vw, 260px);
    padding: 16px 12px;
  }
  aside a, aside li, [class*="sidebar" i] a, [class*="sidebar" i] li {
    display: block; border-radius: 8px; padding: 8px 10px; margin: 2px 0;
    color: #a1a1aa; list-style: none;
  }
  aside a:hover, [class*="sidebar" i] a:hover { background: rgba(255,255,255,0.05); color: #fff; text-decoration: none; }

  [class*="card" i], [class*="panel" i], [class*="stat" i], [class*="widget" i] {
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 14px;
    padding: 16px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.25);
  }

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
  }
  button:hover, [class*="btn" i]:hover { filter: brightness(1.08); }
  button[class*="secondary" i], [class*="btn-secondary" i], [class*="outline" i] {
    background: rgba(255,255,255,0.04); color: #e5e7eb; border: 1px solid rgba(255,255,255,0.12);
  }

  input, textarea, select {
    font-family: inherit;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 10px;
    padding: 9px 12px;
    color: #e5e7eb;
    font-size: 13px;
  }
  input::placeholder, textarea::placeholder { color: #6b7280; }
  input:focus, textarea:focus, select:focus { outline: none; border-color: rgba(129,140,248,0.5); }

  table { border-collapse: collapse; width: 100%; }
  th, td { padding: 10px 14px; border-bottom: 1px solid rgba(255,255,255,0.07); text-align: left; font-size: 13px; }
  th { color: #9ca3af; font-weight: 500; text-transform: uppercase; font-size: 11px; letter-spacing: 0.04em; }

  [class*="badge" i], [class*="tag" i], [class*="pill" i] {
    display: inline-flex; align-items: center; border-radius: 999px;
    padding: 3px 10px; font-size: 11px; font-weight: 500;
    background: rgba(129,140,248,0.15); color: #c7d2fe;
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
