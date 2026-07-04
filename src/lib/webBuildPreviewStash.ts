import type { WebBuildSectionItem } from '@/lib/webBuildPayload';

/**
 * Hand-off for the standalone preview route (/preview/web-build/:runId). We
 * can't pass the generated build data through the URL, so opening a preview
 * stashes it in localStorage (shared across tabs, unlike sessionStorage) keyed
 * by runId, and opens the route in a new tab which reads it back. A saved
 * project can also reopen its preview later by the same runId.
 */
export interface WebBuildPreviewData {
  runId: string;
  sectionItems: WebBuildSectionItem[];
  brief: { type?: string; audience?: string; goal?: string; style?: string };
  slug?: string;
  prompt?: string;
}

const PREFIX = 'korvix_web_preview:';

export function stashPreview(data: WebBuildPreviewData): void {
  try {
    localStorage.setItem(PREFIX + data.runId, JSON.stringify(data));
  } catch { /* ignore quota/serialization errors */ }
}

export function readPreview(runId: string): WebBuildPreviewData | null {
  try {
    const raw = localStorage.getItem(PREFIX + runId);
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
