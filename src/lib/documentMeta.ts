/**
 * Document title / description helpers for the public marketing routes.
 *
 * The app is a HashRouter SPA, so there is exactly ONE document URL and the
 * static `<head>` in index.html owns the homepage canonical + Open Graph
 * defaults. What a per-route hook can legitimately improve is the *document
 * title* (what a browser tab, a bookmark, and the history entry show) and the
 * meta description / og:title / og:description that JS-executing crawlers and
 * some share previews read. That is exactly what this module does — no SEO
 * framework, no head manager dependency, no fabricated canonicals per hash
 * route.
 *
 * Pure string helpers live here so they can be unit-tested; the DOM writes are
 * intentionally guarded and never throw during SSR-less test runs.
 */

export const SITE_NAME = 'KorvixAI';

/** The homepage title — also the fallback restored when a page unmounts. */
export const DEFAULT_TITLE = 'KorvixAI — One workspace that understands your project';

export const DEFAULT_DESCRIPTION =
  'KorvixAI is a project-aware AI workspace. Chat, research, build websites and web apps, and connect the tools around your project so work keeps its context.';

/**
 * Compose a document title. A page title is suffixed with the site name; an
 * empty/blank page title yields the homepage title unchanged (never
 * "· KorvixAI" on its own, never "KorvixAI · KorvixAI").
 */
export function formatTitle(pageTitle?: string | null): string {
  const t = (pageTitle ?? '').trim();
  if (!t) return DEFAULT_TITLE;
  if (t === SITE_NAME) return DEFAULT_TITLE;
  return `${t} · ${SITE_NAME}`;
}

/** Write (or create) a `<meta name="...">` / `<meta property="...">` tag. */
function setMetaContent(selector: string, attr: 'name' | 'property', key: string, content: string): void {
  if (typeof document === 'undefined') return;
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

/**
 * Apply a page's title + description to the document. Returns nothing; the
 * caller restores defaults on unmount by calling this again with no arguments.
 */
export function applyDocumentMeta(title?: string | null, description?: string | null): void {
  if (typeof document === 'undefined') return;
  document.title = formatTitle(title);
  const desc = (description ?? '').trim() || DEFAULT_DESCRIPTION;
  setMetaContent('meta[name="description"]', 'name', 'description', desc);
  setMetaContent('meta[property="og:title"]', 'property', 'og:title', formatTitle(title));
  setMetaContent('meta[property="og:description"]', 'property', 'og:description', desc);
  setMetaContent('meta[name="twitter:title"]', 'name', 'twitter:title', formatTitle(title));
  setMetaContent('meta[name="twitter:description"]', 'name', 'twitter:description', desc);
}
