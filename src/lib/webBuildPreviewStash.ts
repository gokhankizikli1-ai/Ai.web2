import type { WebBuildSectionItem } from '@/lib/webBuildPayload';

/**
 * Hand-off for the standalone preview route (/preview/web-build). We can't pass
 * the generated build data through the URL, so the "Open preview" action stashes
 * it in localStorage (shared across tabs, unlike sessionStorage) and opens the
 * route in a new tab, which reads it back. Keyed so a build can also be reopened
 * by its own id later if we persist it.
 */
export interface WebBuildPreviewData {
  sectionItems: WebBuildSectionItem[];
  brief: { type?: string; audience?: string; goal?: string; style?: string };
  slug?: string;
  prompt?: string;
}

const KEY = 'korvix_web_preview';

export function stashPreview(data: WebBuildPreviewData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch { /* ignore quota/serialization errors */ }
}

export function readPreview(): WebBuildPreviewData | null {
  try {
    const raw = localStorage.getItem(KEY);
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
    window.open('/preview/web-build', '_blank', 'noopener');
  } catch { /* ignore */ }
}
