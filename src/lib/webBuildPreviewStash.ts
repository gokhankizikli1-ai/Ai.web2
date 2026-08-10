import type { WebBuildSectionItem, WebBuildFile, WebBuildStep, WebBuildPayload } from '@/lib/webBuildPayload';
import type { WebBuildBrief } from '@/lib/webBuildApi';
import type { FrontendBuilderPreviewSource } from '@/lib/webBuildAgents';
import { deriveModelNativeCandidate, resolvePreviewMode, type WebBuildPreviewMode } from '@/lib/webBuildRuntimePreview';
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
  /** Phase 12D — the consumed model-native file set. Present ONLY for a model-native
   *  preview (previewSource === 'model-native-sandbox'); bounded by Phase 12C.
   *  Optional → legacy previews omit it and stay small. */
  files?: WebBuildFile[];
  /** Phase 12D — which renderer the standalone route should use for this run. */
  previewSource?: FrontendBuilderPreviewSource;
  /** Phase 13A — the EXPLICIT preview mode this handoff represents. 'owner-candidate' is
   *  the unapproved generated candidate and the standalone route renders it ONLY when the
   *  viewer is an owner; 'approved-model-native' and 'provisional-model-native' (a render-safe
   *  project pending final quality review) both render for everyone; 'safe-fallback' carries
   *  section data only. Optional → old stashes without it keep loading. */
  previewMode?: WebBuildPreviewMode;
  /** Provenance of this stash (Finding 1). 'explicit' = a user-triggered "Open preview" handoff that
   *  captures the renderer currently selected in the embedded panel — it must be honored exactly on
   *  restore (owner-candidate stays owner-gated at the route). 'automatic' = the latest-preview cache,
   *  a restore aid that must never stale-mask the authoritative persisted session/project. Absent is
   *  treated as 'automatic' (the conservative cache semantics), so legacy stashes never override
   *  current persisted state. */
  handoffKind?: PreviewHandoffKind;
}

/** How a preview stash came to exist — see WebBuildPreviewData.handoffKind. */
export type PreviewHandoffKind = 'explicit' | 'automatic';

/** Required entry files a model-native preview needs before it can run. */
const MODEL_NATIVE_ENTRY_PATHS = ['src/main.tsx', 'src/App.tsx', 'src/styles.css'];

/** True when `files` carries all three non-empty model-native entry files. */
export function hasModelNativeEntryFiles(files?: WebBuildFile[]): boolean {
  if (!Array.isArray(files) || files.length === 0) return false;
  const byPath = new Map(files.filter(Boolean).map((f) => [f.path, f]));
  return MODEL_NATIVE_ENTRY_PATHS.every((p) => {
    const f = byPath.get(p);
    return !!f && typeof f.content === 'string' && f.content.trim().length > 0;
  });
}

/**
 * A preview payload is USABLE when EITHER it is a model-native project whose files
 * include the required entry files, OR it has non-empty sectionItems for the legacy
 * renderer. A model-native preview must NOT require sectionItems.
 */
export function isUsablePreviewData(d: WebBuildPreviewData | null | undefined): d is WebBuildPreviewData {
  if (!d || typeof d !== 'object') return false;
  if (d.previewSource === 'model-native-sandbox' && hasModelNativeEntryFiles(d.files)) return true;
  return Array.isArray(d.sectionItems) && d.sectionItems.length > 0;
}

/* ── Preview AUTHORITY (Defect 1) ─────────────────────────────────────────────
 * The automatic latest-preview stash used to carry ONLY sectionItems, which made a
 * section-only Safe representation out-rank a healthier model-native saved session/project
 * on restore. These helpers derive and preserve the SAME render authority the real Preview
 * uses, and pick the highest-authority representation across sources for the same run — so a
 * poorer stash can never mask a model-native persisted build. All pure. */

/** Fields for a render-safe model-native latest step, or null for a Safe/legacy step.
 *  Uses the canonical deriveModelNativeCandidate + resolvePreviewMode as a NON-OWNER, so a cold
 *  restore never exposes owner-candidate — only approved/provisional model-native or Safe. */
export function modelNativePreviewFields(
  step: WebBuildStep | undefined,
  files: WebBuildFile[] | undefined,
): { files: WebBuildFile[]; previewSource: 'model-native-sandbox'; previewMode: WebBuildPreviewMode } | null {
  if (!step) return null;
  const candidate = deriveModelNativeCandidate(step, files);
  const mode = resolvePreviewMode(candidate, false, undefined);
  if ((mode === 'approved-model-native' || mode === 'provisional-model-native')
    && candidate.source === 'consumed-model-native'
    && hasModelNativeEntryFiles(files)) {
    return { files: files as WebBuildFile[], previewSource: 'model-native-sandbox', previewMode: mode };
  }
  return null;
}

/**
 * Build the automatic latest-preview stash for a completed Web Build, preserving the REAL preview
 * authority: a render-safe consumed model-native latest step is stashed WITH files + previewSource +
 * approved/provisional previewMode (so a standalone restore renders the model-native project, never
 * the legacy renderer); otherwise the section representation is stashed. Returns null when nothing
 * usable can be stashed (no latest step, and neither model-native entry files nor sectionItems) so the
 * caller never plants an empty stash that could mask a healthier saved session/project.
 */
export function buildLatestPreviewStash(
  payload: WebBuildPayload,
  opts?: { slug?: string; returnTo?: string; returnChatSessionId?: string; returnWebBuildRunId?: string },
): WebBuildPreviewData | null {
  const steps = Array.isArray(payload?.steps) ? payload.steps : [];
  const step = steps[steps.length - 1];
  const runId = step?.id;
  if (!runId) return null;
  const base: WebBuildPreviewData = {
    runId,
    sectionItems: Array.isArray(payload.sectionItems) ? payload.sectionItems : [],
    brief: payload.brief,
    slug: opts?.slug,
    prompt: payload.prompt,
    returnTo: opts?.returnTo,
    returnChatSessionId: opts?.returnChatSessionId,
    returnWebBuildRunId: opts?.returnWebBuildRunId,
    // This is the automatic latest-preview cache, not a user-chosen renderer handoff — so restore
    // treats it as a fallback that never overrides the authoritative persisted session/project.
    handoffKind: 'automatic',
  };
  const mn = modelNativePreviewFields(step, step.files);
  const data: WebBuildPreviewData = mn ? { ...base, ...mn } : base;
  return isUsablePreviewData(data) ? data : null;
}

/** Render-authority rank of a USABLE representation (higher = stronger). A render-safe model-native
 *  project (approved/provisional + entry files) outranks a section-only / Safe representation. */
export function previewAuthorityRank(d: WebBuildPreviewData | null | undefined): number {
  if (!isUsablePreviewData(d)) return 0;
  if (d.previewSource === 'model-native-sandbox'
    && (d.previewMode === 'approved-model-native' || d.previewMode === 'provisional-model-native')
    && hasModelNativeEntryFiles(d.files)) return 2;
  return 1;
}

/**
 * Pick the HIGHEST-authority usable representation among candidate sources. Strictly-greater
 * comparison keeps source order on ties (the first candidate wins an equal-authority tie). Null if
 * none are usable. This is the pure authority primitive; provenance-aware resolution across a
 * stash + persisted sources lives in resolvePreviewSources.
 */
export function pickHighestAuthorityPreview(
  candidates: Array<WebBuildPreviewData | null | undefined>,
): WebBuildPreviewData | null {
  let best: WebBuildPreviewData | null = null;
  let bestRank = 0;
  for (const c of candidates) {
    const r = previewAuthorityRank(c);
    if (r > bestRank) { best = c as WebBuildPreviewData; bestRank = r; }
  }
  return best;
}

/** A stash represents the user's active in-panel renderer choice (Finding 1). */
function isExplicitHandoff(d: WebBuildPreviewData | null | undefined): boolean {
  return isUsablePreviewData(d) && d.handoffKind === 'explicit';
}

/** Carry the NAVIGATION/context fields (return targets, slug, prompt) from the stash onto a chosen
 *  authoritative representation. These are navigation aids independent of render authority, so when the
 *  persisted session/project wins the render decision we must not lose the stash's fresher Back-context
 *  (returnTo / owning chat + web-build session ids). The authoritative render fields are untouched. */
function withStashContext(base: WebBuildPreviewData, ctx: WebBuildPreviewData | null | undefined): WebBuildPreviewData {
  if (!ctx || ctx === base) return base;
  const merged: WebBuildPreviewData = {
    ...base,
    returnTo: base.returnTo ?? ctx.returnTo,
    returnChatSessionId: base.returnChatSessionId ?? ctx.returnChatSessionId,
    returnWebBuildRunId: base.returnWebBuildRunId ?? ctx.returnWebBuildRunId,
    slug: base.slug ?? ctx.slug,
    prompt: base.prompt ?? ctx.prompt,
  };
  return merged;
}

/**
 * Resolve the preview representation for a run from its stash + the authoritative persisted sources
 * (saved session, saved project), honoring handoff PROVENANCE (Finding 1):
 *
 *  1. A valid EXPLICIT stash is the renderer the user opened from the panel — honored exactly, so an
 *     explicit Safe or owner-candidate handoff is never overridden by a persisted model-native build.
 *     (owner-candidate stays owner-gated at the route; a cold restore never produces one because the
 *     automatic stash and persisted derivation never yield owner-candidate.)
 *  2. Otherwise the AUTOMATIC stash is only a cache/restore aid: the persisted session/project is the
 *     authoritative CURRENT state and wins whenever it is usable — so neither a section-only automatic
 *     stash NOR a stale model-native automatic stash can mask persisted state (equal or otherwise).
 *  3. When no persisted source is usable (cross-tab handoff, cold cache), fall back to the automatic
 *     stash so the preview still loads.
 *
 * Returns null when nothing is usable.
 */
export function resolvePreviewSources(
  stash: WebBuildPreviewData | null | undefined,
  persisted: Array<WebBuildPreviewData | null | undefined>,
): WebBuildPreviewData | null {
  if (isExplicitHandoff(stash)) return stash as WebBuildPreviewData;
  const authoritative = pickHighestAuthorityPreview(persisted);
  // Persisted state wins the RENDER decision, but keep the automatic stash's fresher Back-context.
  if (authoritative) return withStashContext(authoritative, stash);
  return isUsablePreviewData(stash) ? (stash as WebBuildPreviewData) : null;
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
  const minimal: WebBuildPreviewData = {
    runId: data.runId,
    sectionItems: Array.isArray(data.sectionItems) ? data.sectionItems : [],
    brief: data.brief || ({} as WebBuildBrief),
    slug: data.slug,
    prompt: data.prompt,
    returnTo: data.returnTo,
    returnChatSessionId: data.returnChatSessionId,
    returnWebBuildRunId: data.returnWebBuildRunId,
  };
  // Phase 13A — carry the explicit preview mode so the standalone route renders EXACTLY the
  // selected mode (and gates 'owner-candidate' behind owner status). Bounded string only.
  // 'provisional-model-native' is a render-safe user preview pending final quality review — it
  // renders for everyone like 'approved-model-native' (see line 121: files travel for any
  // non-'safe-fallback' model-native mode).
  if (data.previewMode === 'approved-model-native' || data.previewMode === 'provisional-model-native' || data.previewMode === 'owner-candidate' || data.previewMode === 'safe-fallback') {
    minimal.previewMode = data.previewMode;
  }
  // Finding 1 — carry the handoff provenance (bounded enum) so restore can honor an explicit
  // user renderer choice while treating the automatic cache as a non-masking fallback.
  if (data.handoffKind === 'explicit' || data.handoffKind === 'automatic') {
    minimal.handoffKind = data.handoffKind;
  }
  // Phase 12D — for a model-native preview, carry ONLY the validated files + source
  // (already bounded by Phase 12C). Never the raw response, validation issues, full
  // artifacts, spec, agents, research, tokens, steps or provider metadata. A safe-fallback
  // handoff never carries candidate files.
  if (data.previewSource === 'model-native-sandbox' && data.previewMode !== 'safe-fallback' && Array.isArray(data.files) && data.files.length > 0) {
    minimal.files = data.files;
    minimal.previewSource = 'model-native-sandbox';
  }
  return minimal;
}

/** True when the persisted stash for `runId` round-trips to USABLE preview data
 *  (same runId, a non-empty sectionItems array). This is what makes the write
 *  verifiable — a silently-dropped/quota-failed write reads back as unusable. */
function verifyStash(runId: string): boolean {
  const back = readPreview(runId);
  return !!back && back.runId === runId && isUsablePreviewData(back);
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
    // A legacy stash carries sectionItems; a model-native stash may carry files
    // instead — accept either shape (usability is judged by isUsablePreviewData).
    return (Array.isArray(data.sectionItems) || Array.isArray(data.files)) ? data : null;
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
  isUsablePreviewData(d as WebBuildPreviewData | null);

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
  // "Open preview" captures the renderer currently active in the panel — an EXPLICIT handoff that
  // restore must honor exactly (Finding 1), never a cache to be overridden by persisted state.
  const enriched: WebBuildPreviewData = { ...data, returnTo, returnChatSessionId, returnWebBuildRunId, handoffKind: 'explicit' };

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
