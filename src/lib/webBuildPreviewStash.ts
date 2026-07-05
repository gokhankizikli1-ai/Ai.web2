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
}

const key = (runId: string) => scopedKey('webbuild', `preview:${runId}`);

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
  stashPreview(data);
  try {
    const base = window.location.href.split('#')[0];
    const url = `${base}#/preview/web-build/${encodeURIComponent(data.runId)}`;
    window.open(url, '_blank', 'noopener');
  } catch { /* ignore */ }
}
