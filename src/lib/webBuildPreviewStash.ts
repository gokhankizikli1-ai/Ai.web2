import type { WebBuildSectionItem } from '@/lib/webBuildPayload';
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
  brief: { type?: string; audience?: string; goal?: string; style?: string };
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

/** Stash the build data and open the standalone preview in a new tab. */
export function openPreviewInNewTab(data: WebBuildPreviewData): void {
  stashPreview(data);
  try {
    window.open(`/preview/web-build/${encodeURIComponent(data.runId)}`, '_blank', 'noopener');
  } catch { /* ignore */ }
}
