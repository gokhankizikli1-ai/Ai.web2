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

/** Reduce any candidate to the MINIMAL preview payload the standalone route needs
 *  — never the full generated files/steps, so the stash stays small and is far
 *  less likely to hit the localStorage quota. */
function toMinimalPreview(data: WebBuildPreviewData): WebBuildPreviewData {
  return {
    runId: data.runId,
    sectionItems: Array.isArray(data.sectionItems) ? data.sectionItems : [],
    brief: data.brief || ({} as WebBuildBrief),
    slug: data.slug,
    prompt: data.prompt,
    returnTo: data.returnTo,
    returnChatSessionId: data.returnChatSessionId,
    returnWebBuildRunId: data.returnWebBuildRunId,
  };
}

/** True when the persisted stash for `runId` round-trips to USABLE preview data
 *  (same runId, a non-empty sectionItems array). This is what makes the write
 *  verifiable — a silently-dropped/quota-failed write reads back as unusable. */
function verifyStash(runId: string): boolean {
  const back = readPreview(runId);
  return !!back && back.runId === runId && Array.isArray(back.sectionItems) && back.sectionItems.length > 0;
}

/**
 * Remove preview stashes for the current user scope (optionally keeping one run),
 * to free localStorage before a retry. Only ever touches `…:preview:*` keys —
 * NEVER session/active keys — so saved builds are untouched. Returns how many
 * stale stashes were removed. Never throws.
 */
export function prunePreviewStashes(keepRunId?: string): number {
  let removed = 0;
  try {
    const prefix = key(''); // korvix:webbuild:<scope>:preview:
    const keepKey = keepRunId ? key(keepRunId) : '';
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix) && k !== keepKey) stale.push(k);
    }
    for (const k of stale) {
      try { localStorage.removeItem(k); removed++; } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  return removed;
}

/**
 * Persist minimal preview data for the standalone route and VERIFY it round-trips.
 * Returns `true` only when the stash was written AND reads back as usable preview
 * data — the old void version dropped quota/serialization failures silently, so
 * "Open preview" opened a route with no data ("No preview available yet"). On a
 * failed write we prune older preview stashes (keeping this run) to free space and
 * retry once. Never throws.
 */
export function stashPreview(data: WebBuildPreviewData): boolean {
  const minimal = toMinimalPreview(data);
  const write = (): boolean => {
    try {
      localStorage.setItem(key(minimal.runId), JSON.stringify(minimal));
      return true;
    } catch {
      return false;
    }
  };
  if (write() && verifyStash(minimal.runId)) return true;
  // Quota/serialization failure (or a truncated write) — free space and retry once.
  prunePreviewStashes(minimal.runId);
  if (write() && verifyStash(minimal.runId)) return true;
  return false;
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

/* ── Storage-free handoff (BroadcastChannel) ─────────────────────────────────
 * localStorage is not the only handoff: when it is full/unavailable the opener
 * tab hands the MINIMAL preview payload to the standalone route directly, in
 * memory, over a same-origin BroadcastChannel. This never touches disk, so a full
 * localStorage can't block the full preview. Everything here is fully guarded:
 * when BroadcastChannel is unavailable it fails safely (no throw, no-op). */
export const PREVIEW_CHANNEL = 'korvix:webbuild:preview';

type PreviewChannelMessage =
  | { kind: 'request'; runId: string }
  | { kind: 'response'; runId: string; data: WebBuildPreviewData };

/** Open the preview BroadcastChannel, or null when the API is unavailable. */
function openPreviewChannel(): BroadcastChannel | null {
  try {
    if (typeof BroadcastChannel === 'undefined') return null;
    return new BroadcastChannel(PREVIEW_CHANNEL);
  } catch {
    return null;
  }
}

const usablePayload = (d: unknown): d is WebBuildPreviewData =>
  !!d && typeof d === 'object' && Array.isArray((d as WebBuildPreviewData).sectionItems)
  && (d as WebBuildPreviewData).sectionItems.length > 0;

/**
 * Opener side: keep answering preview-data requests for this run over the
 * BroadcastChannel for a short TTL, and publish once immediately (in case the
 * route is already listening). Minimal payload only — never files/steps. Returns
 * true when the channel is available and the responder was armed. Never throws.
 */
export function publishPreviewForRun(data: WebBuildPreviewData, ttlMs = 15000): boolean {
  const channel = openPreviewChannel();
  if (!channel) return false;
  const minimal = toMinimalPreview(data);
  const respond = () => {
    try {
      const msg: PreviewChannelMessage = { kind: 'response', runId: minimal.runId, data: minimal };
      channel.postMessage(msg);
    } catch { /* ignore */ }
  };
  channel.onmessage = (ev: MessageEvent) => {
    const msg = ev?.data as PreviewChannelMessage | undefined;
    if (msg && msg.kind === 'request' && msg.runId === minimal.runId) respond();
  };
  respond(); // publish once now; then answer requests until the TTL elapses
  try {
    setTimeout(() => { try { channel.close(); } catch { /* ignore */ } }, Math.max(1000, ttlMs));
  } catch {
    try { channel.close(); } catch { /* ignore */ }
  }
  return true;
}

/** Route side: ask any opener tab to (re)broadcast preview data for this run.
 *  No-op when BroadcastChannel is unavailable. Never throws. */
export function requestPreviewForRun(runId: string): void {
  const channel = openPreviewChannel();
  if (!channel) return;
  try {
    const msg: PreviewChannelMessage = { kind: 'request', runId };
    channel.postMessage(msg);
  } catch { /* ignore */ }
  // The response arrives on the subscriber channel (a channel never receives its
  // own posts), so close this short-lived request channel after the message flushes.
  try {
    setTimeout(() => { try { channel.close(); } catch { /* ignore */ } }, 1000);
  } catch {
    try { channel.close(); } catch { /* ignore */ }
  }
}

/** Route side: listen for a matching, USABLE preview-data response for `runId`.
 *  Returns an unsubscribe fn (also closes the channel). No-op unsubscribe when
 *  BroadcastChannel is unavailable. Never throws. */
export function subscribePreviewResponses(runId: string, callback: (data: WebBuildPreviewData) => void): () => void {
  const channel = openPreviewChannel();
  if (!channel) return () => {};
  channel.onmessage = (ev: MessageEvent) => {
    const msg = ev?.data as PreviewChannelMessage | undefined;
    if (msg && msg.kind === 'response' && msg.runId === runId && usablePayload(msg.data)) callback(msg.data);
  };
  return () => { try { channel.close(); } catch { /* ignore */ } };
}

/** Stash the build data and open the standalone preview in a new tab.
 *
 * The app runs under <HashRouter>, so the SPA route lives AFTER the `#`
 * (e.g. https://host/#/chat). Opening a bare `/preview/web-build/:id` path
 * hits the server, bypasses the SPA and renders a blank white page in
 * production. We therefore build a proper hash URL against the current
 * origin + path so the route resolves inside the app. */
export function openPreviewInNewTab(data: WebBuildPreviewData): boolean {
  // Preserve a safe return path + restore context. The embedded ChatWebBuild
  // pre-stashes the owning chat session / Web Build session ids (keyed by the same
  // preview runId); the panel's "Open preview" must NOT drop them, so we merge
  // with any existing stash for this runId. Caller-provided values win.
  const prev = readPreview(data.runId);
  const returnTo = sanitizeReturnTo(data.returnTo) || sanitizeReturnTo(prev?.returnTo) || currentReturnTo();
  const returnChatSessionId = safeId(data.returnChatSessionId) || safeId(prev?.returnChatSessionId);
  const returnWebBuildRunId = safeId(data.returnWebBuildRunId) || safeId(prev?.returnWebBuildRunId);
  const enriched: WebBuildPreviewData = { ...data, returnTo, returnChatSessionId, returnWebBuildRunId };

  // Primary handoff: a verified localStorage stash (survives a full page reload of
  // the standalone tab). If storage is full/unavailable, fall back to a
  // storage-free BroadcastChannel handoff so the full preview can STILL open — the
  // opener tab streams the minimal payload to the route on request for a short TTL.
  const stashed = stashPreview(enriched);
  const broadcasting = stashed ? false : publishPreviewForRun(enriched);
  // Open a route only when at least one handoff can deliver the data. When neither
  // is possible the caller surfaces the failure; the in-app drawer stays usable.
  if (!stashed && !broadcasting) return false;
  try {
    const base = window.location.href.split('#')[0];
    const url = `${base}#/preview/web-build/${encodeURIComponent(data.runId)}`;
    window.open(url, '_blank', 'noopener');
    return true;
  } catch {
    return false;
  }
}
