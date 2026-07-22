/**
 * Web Build RUN coordinator.
 *
 * The running generation/revision must OUTLIVE the WebsiteBuilder component. When
 * the user navigates to Projects (or any sidebar route) the page unmounts — if the
 * operation lived only in that component's refs/state it would be aborted and lost.
 * So the live operation lives HERE, in a module-scope singleton, decoupled from any
 * component lifecycle:
 *
 *   • the AbortController + operation identity are module-local (never serialized,
 *     never in localStorage);
 *   • a small zustand store publishes the serializable run snapshot so a mounted
 *     WebsiteBuilder can subscribe and mirror the running/completed/failed state;
 *   • completion persists the finished payload through the EXISTING webBuildSession
 *     APIs even when no component is mounted, so returning restores real work;
 *   • a superseding run (a genuinely new build/revision, New Build, or opening
 *     another session) is the ONLY thing that aborts the previous operation — plain
 *     internal navigation never does.
 *
 * Account scoping: every run records the identity scope that owns it. The store is
 * never adopted by a different account, and completion never writes into another
 * account's bucket — one user can never see another's pending or finished run.
 */
import { create } from 'zustand';
import type { WebBuildPayload } from '@/lib/webBuildPayload';
import {
  saveWebBuildSession, sessionIdOf, deriveWebBuildTitle,
  savePendingWebBuildRun, clearPendingWebBuildRun,
} from '@/lib/webBuildSession';
import { upsertWebBuildChatSession } from '@/lib/webBuildChatSession';
import { stashPreview } from '@/lib/webBuildPreviewStash';
import { currentUserScope } from '@/lib/userScope';

export type WebBuildRunStatus = 'idle' | 'running' | 'completed' | 'failed';
export type WebBuildRunKind = 'build' | 'revision';

export interface WebBuildRunState {
  /** Identity scope (account) that owns this run — never adopted cross-account. */
  scope: string;
  /** Stable session id once known (base id during a revision, result id once done). */
  runId: string | null;
  prompt: string;
  kind: WebBuildRunKind;
  status: WebBuildRunStatus;
  /** The payload to display: the base during a running revision, the result once done. */
  payload: WebBuildPayload | null;
  /** A revision's base payload, preserved so a failure never erases it. */
  basePayload: WebBuildPayload | null;
  /** Raw error — the view maps it to a localized message (keeps i18n in the page). */
  error: unknown;
  /** Monotonic operation identity — guards against a stale completion overwriting a newer run. */
  operationId: number;
}

const IDLE: WebBuildRunState = {
  scope: '', runId: null, prompt: '', kind: 'build',
  status: 'idle', payload: null, basePayload: null, error: null, operationId: 0,
};

export const useWebBuildRunStore = create<WebBuildRunState>()(() => ({ ...IDLE }));

// ── Module-local live handles (deliberately OUTSIDE the store + never persisted) ──
let currentController: AbortController | null = null;
let operationCounter = 0;

/** A short site slug from the idea/prompt (shared with the preview stash). */
export function slugFromIdea(idea: string): string {
  const base = (idea || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 18);
  return `${base || 'yoursite'}.korvix.build`;
}

/** Persist the latest preview so the standalone /preview route can always load it. */
function stashLatestPreview(p: WebBuildPayload): void {
  const runId = p.steps[p.steps.length - 1]?.id;
  if (runId) stashPreview({ runId, sectionItems: p.sectionItems, brief: p.brief, slug: slugFromIdea(p.prompt), prompt: p.prompt });
}

/**
 * Persist a COMPLETED run through the existing session APIs (session map + sidebar
 * companion + preview stash). Guarded by scope: if the active account changed while
 * the run was in flight, nothing is written — a background run never lands in another
 * user's bucket. Returns the session id (or '' when skipped).
 */
export function persistCompletedRun(payload: WebBuildPayload, lang: string, ownerScope: string): string {
  if (ownerScope && ownerScope !== currentUserScope()) return '';
  const id = saveWebBuildSession(payload, lang);
  if (!id) return '';
  upsertWebBuildChatSession(id, deriveWebBuildTitle(payload.prompt, lang), payload.prompt);
  stashLatestPreview(payload);
  return id;
}

export interface StartWebBuildRunOptions {
  kind: WebBuildRunKind;
  prompt: string;
  lang: string;
  scope: string;
  /** The base payload for a revision (preserved on failure); null for a fresh build. */
  basePayload: WebBuildPayload | null;
  /** The real generation work. Runs under the coordinator's signal, returns the payload. */
  execute: (signal: AbortSignal) => Promise<WebBuildPayload>;
}

/**
 * Begin a build/revision. This SUPERSEDES any in-flight run (an explicit new
 * operation is allowed to abort the previous one). The returned promise settles
 * when this run finishes, but callers don't need it — they observe the store.
 */
export function startWebBuildRun(opts: StartWebBuildRunOptions): void {
  const { kind, prompt, lang, scope, basePayload, execute } = opts;

  // Supersede: abort the previous operation and invalidate its identity so a late
  // resolve/reject can never write over this newer run.
  currentController?.abort();
  const controller = new AbortController();
  currentController = controller;
  const operationId = ++operationCounter;

  // Serializable pending pointer — only for honest refresh recovery.
  savePendingWebBuildRun({
    prompt, kind,
    basePayloadId: basePayload ? sessionIdOf(basePayload) : null,
    startedAt: new Date().toISOString(),
  });

  useWebBuildRunStore.setState({
    scope,
    runId: basePayload ? sessionIdOf(basePayload) : null,
    prompt, kind, status: 'running',
    payload: kind === 'revision' ? basePayload : null,
    basePayload, error: null, operationId,
  });

  const isCurrent = () => operationId === operationCounter && !controller.signal.aborted;

  // Promise.resolve wrapper so a synchronous throw inside execute() is funneled into
  // the same rejection handling (never an unhandled error).
  Promise.resolve().then(() => execute(controller.signal)).then(
    (payload) => {
      if (!isCurrent()) return; // superseded or aborted — ignore this result entirely
      const id = persistCompletedRun(payload, lang, scope);
      clearPendingWebBuildRun();
      currentController = null;
      useWebBuildRunStore.setState({
        status: 'completed', payload, error: null,
        runId: id || sessionIdOf(payload) || useWebBuildRunStore.getState().runId,
      });
    },
    (err) => {
      // A superseded op that rejects (often via its own abort) must stay silent.
      if (operationId !== operationCounter) return;
      if (controller.signal.aborted) return;
      clearPendingWebBuildRun();
      currentController = null;
      // Preserve the last valid payload: a revision keeps its base, a fresh build
      // has none. Errors never erase existing work.
      useWebBuildRunStore.setState({
        status: 'failed', error: err,
        payload: kind === 'revision' ? basePayload : useWebBuildRunStore.getState().payload,
      });
    },
  );
}

/**
 * Explicitly clear the active run context (New Build / opening another session).
 * Aborts any in-flight operation — this is a deliberate user action, not navigation.
 */
export function resetWebBuildRun(): void {
  currentController?.abort();
  currentController = null;
  operationCounter += 1; // invalidate any in-flight completion
  clearPendingWebBuildRun();
  useWebBuildRunStore.setState({ ...IDLE, scope: currentUserScope() });
}

/**
 * The current run snapshot IF it belongs to the given account and is not idle —
 * used by the page on mount to decide whether to adopt an ongoing/finished run
 * instead of loading a stored session. Returns null otherwise (incl. cross-account).
 */
export function getWebBuildRunForScope(scope: string): WebBuildRunState | null {
  const s = useWebBuildRunStore.getState();
  if (s.status === 'idle') return null;
  if (s.scope && s.scope !== scope) return null;
  return s;
}

/** True when an operation is actually in flight in THIS tab's memory. */
export function hasLiveWebBuildOperation(): boolean {
  return currentController !== null;
}
