import type { WebBuildSectionItem } from '@/lib/webBuildPayload';
import type { WebBuildBrief } from '@/lib/webBuildApi';
import { scopedKey } from '@/lib/userScope';

/**
 * Hand-off for the standalone preview route (/preview/web-build/:runId). We
 * can't pass the generated build data through the URL, so opening a preview
 * stashes it in localStorage (shared across tabs, unlike sessionStorage) keyed
 * by runId + the current user scope, and opens the route in a new tab which
 * reads it back. Scoping by user means one account can't read another's preview.
 */
export interface WebBuildPreviewData {
  runId: string;
  sectionItems: WebBuildSectionItem[];
  /** Full strategy brief — the layout plan reads the richer strategy fields
   *  (visual mood, layout logic, visual metaphor), so the standalone preview
   *  composes the SAME structure as the in-app preview and generated files. */
  brief: WebBuildBrief;
  slug?: string;
  prompt?: string;
  /** Same-origin internal app path to return to when the standalone preview's
   *  Back is pressed (e.g. '#/chat?tab=web-build'). Sanitized on write. */
  returnTo?: string;
  /** The chat sidebar session id that owns the embedded Web Build (so Back can
   *  reselect it). Plain id string, never a URL. */
  returnChatSessionId?: string;
  /** The PERSISTED Web Build session id (getWebBuildSession / ChatWebBuild
   *  restoreRunId) — NOT the latest preview step id. Plain id string. */
  returnWebBuildRunId?: string;
}

/** A stash id must be a plain, non-empty string (never a URL). */
function safeId(v?: string): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

const key = (runId: string) => scopedKey('webbuild', `preview:${runId}`);

/**
 * Accept ONLY a same-origin, internal app path as a return target (a hash route
 * like '#/chat' or a root-relative path like '/projects/x'). Rejects any URL
 * scheme (http:, javascript:, mailto:, tel:, data:…) and protocol-relative URLs,
 * so a stored returnTo can never drive an open redirect.
 */
export function sanitizeReturnTo(raw?: string): string | undefined {
  if (!raw) return undefined;
  const s = raw.trim();
  if (!s || s === '#') return undefined;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return undefined; // any explicit scheme → reject
  if (s.startsWith('//')) return undefined; // protocol-relative → cross-origin
  if (s.startsWith('#') || s.startsWith('/')) return s; // internal hash route or root-relative path
  return undefined;
}

/** The current in-app location as a safe return path, or undefined. */
export function currentReturnTo(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return sanitizeReturnTo(window.location.hash || `${window.location.pathname}${window.location.search}`);
}

export function stashPreview(data: WebBuildPreviewData): void {
  try {
    localStorage.setItem(key(data.runId), JSON.stringify(data));
  } catch { /* ignore quota/serialization errors */ }
}

export function readPreview(runId: string): WebBuildPreviewData | null {
  try {
    const raw = localStorage.getItem(key(runId));
    if (!raw) return null;
    const data = JSON.parse(raw) as WebBuildPreviewData;
    return Array.isArray(data.sectionItems) ? data : null;
  } catch {
    return null;
  }
}

/** Stash the build data and open the standalone preview in a new tab.
 *
 * The app runs under <HashRouter>, so the SPA route lives AFTER the `#`
 * (e.g. https://host/#/chat). Opening a bare `/preview/web-build/:id` path
 * hits the server, bypasses the SPA and renders a blank white page in
 * production. We therefore build a proper hash URL against the current
 * origin + path so the route resolves inside the app. */
export function openPreviewInNewTab(data: WebBuildPreviewData): void {
  // Preserve a safe return path + restore context. The embedded ChatWebBuild
  // pre-stashes the owning chat session / Web Build session ids (keyed by the same
  // preview runId); the panel's "Open preview" must NOT drop them, so we merge
  // with any existing stash for this runId. Caller-provided values win.
  const prev = readPreview(data.runId);
  const returnTo = sanitizeReturnTo(data.returnTo) || sanitizeReturnTo(prev?.returnTo) || currentReturnTo();
  const returnChatSessionId = safeId(data.returnChatSessionId) || safeId(prev?.returnChatSessionId);
  const returnWebBuildRunId = safeId(data.returnWebBuildRunId) || safeId(prev?.returnWebBuildRunId);
  stashPreview({ ...data, returnTo, returnChatSessionId, returnWebBuildRunId });
  try {
    const base = window.location.href.split('#')[0];
    const url = `${base}#/preview/web-build/${encodeURIComponent(data.runId)}`;
    window.open(url, '_blank', 'noopener');
  } catch { /* ignore */ }
}
