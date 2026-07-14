import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2, ArrowUp, AlertTriangle, RotateCcw,
  Check, FolderOpen, Plus, X, ChevronLeft, FolderPlus,
} from 'lucide-react';
import WebBuildConversation from '@/components/builder/WebBuildConversation';
import type { BuilderMode } from '@/lib/builderMode';
import { useLanguageStore } from '@/stores/languageStore';
import {
  saveWebBuildSession, getWebBuildSession, sessionIdOf,
  setActiveWebBuildSession, deriveWebBuildTitle,
} from '@/lib/webBuildSession';
import {
  generateWebBuild, WebBuildError, webBuildErrorKeyFor,
} from '@/lib/webBuildApi';
import { buildWebBuildPayload, type WebBuildPayload } from '@/lib/webBuildPayload';
import { runFrontendBuilderQualityPipeline } from '@/lib/webBuildFrontendQuality';
import { runFrontendBuilderRevision } from '@/lib/webBuildFrontendRevision';
import { saveWebBuildPayloadToProject } from '@/lib/webBuildProject';
import { upsertWebBuildChatSession } from '@/lib/webBuildChatSession';
import { stashPreview } from '@/lib/webBuildPreviewStash';
import { getProjects } from '@/stores/projectStore';

/**
 * Embedded Web Build surface — the SAME generation pipeline as the standalone
 * /tools/website-builder page, rendered INSIDE the Chat content area so a
 * Website/App request from the Chat home never navigates away. Reuses
 * generateWebBuild / buildWebBuildPayload / stashPreview / WebBuildConversation
 * (no duplicated generation logic — only the local orchestration state). The
 * bottom composer is a revision input; the chat is locked into build mode
 * (normal chat is a New Chat).
 */
const ACCENT = '#60A5FA';

function slugFromIdea(idea: string): string {
  const base = idea.trim().toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 18);
  return `${base || 'yoursite'}.korvix.build`;
}

function stashLatestPreview(p: WebBuildPayload, slug: string, sessionId?: string): void {
  // The preview route is keyed by the LATEST step id; but restore needs the
  // PERSISTED Web Build session id (sessionIdOf = first step id, what
  // getWebBuildSession / restoreRunId use) and the owning chat session id — so
  // Back Build can reopen the exact embedded conversation, not a new chat.
  const previewRunId = p.steps[p.steps.length - 1]?.id;
  if (!previewRunId) return;
  // Never plant an EMPTY stash: it would out-rank (mask) the saved-session
  // fallback the standalone preview route uses. The session is already persisted
  // (persist() runs before this), so fromSession(runId) can resolve the route.
  if (!Array.isArray(p.sectionItems) || p.sectionItems.length === 0) return;
  const webBuildRunId = sessionIdOf(p);
  const chatSessionId = (sessionId && sessionId.trim()) || webBuildRunId;
  const returnTo = `#/chat?webBuildRunId=${encodeURIComponent(webBuildRunId)}&chatSessionId=${encodeURIComponent(chatSessionId)}`;
  stashPreview({
    runId: previewRunId, sectionItems: p.sectionItems, brief: p.brief, slug, prompt: p.prompt,
    returnTo, returnChatSessionId: chatSessionId, returnWebBuildRunId: webBuildRunId,
  });
}

interface ChatWebBuildProps {
  /** Start a fresh build from this prompt (Chat home handoff). */
  initialPrompt?: string;
  /** Build context (website / app). */
  initialMode?: BuilderMode | null;
  /** Reopen an existing persisted Web Build session by id (sidebar click). */
  restoreRunId?: string;
  /** The chat session this build OWNS — converted to web_build in place so a
   *  Website prompt keeps the chat it was written in (no duplicate session). */
  sessionId?: string;
  /** Convert `sessionId` into a web_build session pointing at `runId`. Provided
   *  by ChatDashboard's useChat (markSessionWebBuild). */
  onPersistSession?: (sessionId: string, runId: string, title: string) => void;
}

export default function ChatWebBuild({ initialPrompt, initialMode = null, restoreRunId, sessionId, onPersistSession }: ChatWebBuildProps) {
  const { t, lang } = useLanguageStore();

  const [input, setInput] = useState('');
  const [payload, setPayload] = useState<WebBuildPayload | null>(null);
  const [animateStepId, setAnimateStepId] = useState<string | undefined>(undefined);
  const [live, setLive] = useState<{ prompt: string; kind: 'build' | 'revision' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const [savedProjectId, setSavedProjectId] = useState<string | undefined>(undefined);
  const [savedName, setSavedName] = useState('');
  const [saveStep, setSaveStep] = useState<'closed' | 'prompt' | 'picker'>('closed');

  const abortRef = useRef<AbortController | null>(null);
  const feedEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lastPromptRef = useRef('');
  const modeRef = useRef<BuilderMode | null>(initialMode);
  const bootedRef = useRef(false);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const persist = useCallback((p: WebBuildPayload) => {
    const runId = saveWebBuildSession(p, lang);
    if (!runId) return;
    setActiveWebBuildSession(runId);
    // Title like "Website: Peyzaj Mimarlığı". Convert the CURRENT chat session
    // (sessionId) into this web_build in place — never a duplicate sibling.
    const label = lang === 'tr' ? 'Web Sitesi' : 'Website';
    const title = `${label}: ${deriveWebBuildTitle(p.prompt, lang)}`;
    // The owning chat session id and the Web Build run id are DISTINCT identities.
    const owningChatSessionId = sessionId ?? runId;
    // Phase 13D.1 — mirror the sidebar companion into durable localStorage IMMEDIATELY
    // (before the React state callback), so a refresh right after a build still finds a
    // web_build companion pointing at the real run id and restores the embedded build
    // instead of falling through to normal Chat. Id-stable (no duplicate).
    upsertWebBuildChatSession(owningChatSessionId, runId, title, p.prompt);
    onPersistSession?.(owningChatSessionId, runId, title);
  }, [lang, onPersistSession, sessionId]);

  const startLive = useCallback((prompt: string, kind: 'build' | 'revision') => {
    setLive({ prompt, kind });
  }, []);

  const failLive = useCallback((err: unknown) => {
    setLive(null);
    // The strict fresh-build gate rejects a frontend-fallback/partial reply rather
    // than showing a fake-success synthesized site. Surface an honest, specific
    // message inline (no locale key needed) so Preview/All Files stay hidden.
    if (err instanceof WebBuildError && err.kind === 'contract_failed') {
      setErrorMsg(lang === 'tr'
        ? "Korvix backend'den tam model-planlı bir build alamadı. Birazdan tekrar dene."
        : 'Korvix could not get a complete model-planned build from the backend. Try again in a moment.');
      return;
    }
    // Phase 13D — revision outcomes carry an already-localized, honest message (no fake
    // success): a rejected/failed revision preserved the current project; retry is allowed.
    if (err instanceof WebBuildError && (err.kind === 'revision_no_base' || err.kind === 'revision_failed' || err.kind === 'revision_rejected')) {
      setErrorMsg(err.message);
      return;
    }
    // Phase 13E / 13E.1 — planning provider-transport failures AND backend safety/quota
    // rejections carry an already-localized, honest message. None of these is a malformed
    // planning response: the request either never reached the model (safety), was refused
    // by the provider (quota / rate limit), or the transport failed (timeout / access /
    // incomplete). No fake planning step is created and the safety sentence is never
    // persisted as a build reply; the current build (if any) is preserved and Retry stays.
    if (err instanceof WebBuildError && (
      err.kind === 'planning_failed' || err.kind === 'planning_timeout' ||
      err.kind === 'planning_incomplete' || err.kind === 'planning_access' ||
      err.kind === 'planning_request_too_large' || err.kind === 'planning_request_rejected' ||
      err.kind === 'planning_throttled' || err.kind === 'planning_quota' ||
      err.kind === 'planning_rate_limited' ||
      // Phase 13E.2 — the client per-attempt planning deadline (distinct from a backend timeout).
      err.kind === 'planning_client_timeout' ||
      // Phase 13F — dedicated FRONTEND generation transport/provider failures. A fresh build
      // with zero model-native output is never shown as a deterministic-fallback success:
      // the throw happened before consumption, so no payload/preview was set. Retry stays.
      err.kind === 'frontend_generation_client_timeout' || err.kind === 'frontend_generation_timeout' ||
      err.kind === 'frontend_generation_failed' || err.kind === 'frontend_generation_incomplete' ||
      err.kind === 'frontend_generation_access' || err.kind === 'frontend_generation_quota' ||
      err.kind === 'frontend_generation_rate_limited'
    )) {
      setErrorMsg(err.message);
      return;
    }
    const key = err instanceof WebBuildError ? webBuildErrorKeyFor(err.kind) : 'wbErrGeneric';
    setErrorMsg(t(key) || t('wbErrGeneric'));
  }, [t, lang]);

  /* ── Fresh generation ─────────────────────────────────────────────── */
  const runFresh = useCallback(async (idea: string, mode: BuilderMode | null) => {
    const trimmed = idea.trim();
    if (!trimmed) return;
    lastPromptRef.current = trimmed;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setBusy(true);
    setErrorMsg('');
    setPayload(null);
    setSavedProjectId(undefined);
    setSaveStep('closed');
    startLive(trimmed, 'build');

    try {
      const res = await generateWebBuild(trimmed, { signal: controller.signal, mode });
      if (abortRef.current !== controller) return;
      const planned = buildWebBuildPayload(trimmed, res, undefined, lang);
      // Phase 12E — one centralized frontend quality pipeline: the dedicated builder
      // call + Phase 12C/12D consumption, then the static design review + at most one
      // bounded repair + final acceptance. Fails open (keeps the validated project);
      // only explicit caller cancellation throws.
      const next = await runFrontendBuilderQualityPipeline(planned, { signal: controller.signal });
      if (abortRef.current !== controller) return;
      setPayload(next);
      persist(next);
      stashLatestPreview(next, slugFromIdea(next.prompt), sessionId);
      setAnimateStepId(next.steps[next.steps.length - 1]?.id);
      setLive(null);
    } catch (err) {
      if (controller.signal.aborted) return;
      failLive(err);
    } finally {
      if (abortRef.current === controller) setBusy(false);
    }
  }, [startLive, failLive, lang, persist]);
  const runFreshRef = useRef(runFresh);
  runFreshRef.current = runFresh;

  /* ── Revision ─────────────────────────────────────────────────────── */
  const runRevision = useCallback(async (idea: string) => {
    const trimmed = idea.trim();
    if (!trimmed || !payload) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setBusy(true);
    setErrorMsg('');
    startLive(trimmed, 'revision');

    try {
      // Phase 13D — a REAL source-to-source model-native revision: exactly ONE
      // frontend_builder call edits the existing project's files. It reruns NO planning,
      // research, upstream agents or the Phase 12E quality pipeline, and NEVER lets a
      // deterministic fallback overwrite the good project. A failed/rejected/destructive
      // revision throws a bounded WebBuildError and leaves the current payload untouched.
      const next = await runFrontendBuilderRevision(payload, trimmed, { signal: controller.signal, uiLanguage: lang });
      if (abortRef.current !== controller) return;
      setPayload(next);
      persist(next);
      stashLatestPreview(next, slugFromIdea(next.prompt), sessionId);
      setAnimateStepId(next.steps[next.steps.length - 1]?.id);
      setLive(null);
    } catch (err) {
      if (controller.signal.aborted) return;
      failLive(err);
    } finally {
      if (abortRef.current === controller) setBusy(false);
    }
  }, [payload, startLive, failLive, lang, persist]);

  // Boot once: restore an existing session, else kick off the initial build.
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    if (restoreRunId) {
      const restored = getWebBuildSession(restoreRunId);
      if (restored) { setPayload(restored); setActiveWebBuildSession(restoreRunId); setAnimateStepId(undefined); }
      return;
    }
    if (initialPrompt && initialPrompt.trim()) {
      runFreshRef.current(initialPrompt, modeRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the newest message in view as the conversation grows.
  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [payload, live]);

  const handleSubmit = useCallback(() => {
    const text = input.trim();
    if (!text || busy || !payload) return; // revisions only, after the first build
    setInput('');
    runRevision(text);
  }, [input, busy, payload, runRevision]);

  const handleRetry = useCallback(() => {
    setErrorMsg('');
    if (payload) {
      const last = payload.steps[payload.steps.length - 1]?.prompt || payload.prompt;
      runRevision(last);
    } else if (lastPromptRef.current) {
      runFresh(lastPromptRef.current, modeRef.current);
    }
  }, [payload, runFresh, runRevision]);

  /* ── Save to project ──────────────────────────────────────────────── */
  const commitSave = useCallback((projectId?: string) => {
    if (!payload) return;
    const proj = saveWebBuildPayloadToProject(payload, projectId);
    setSavedProjectId(proj.id);
    setSavedName(proj.name);
    setSaveStep('closed');
  }, [payload]);

  const existingProjects = useMemo(() => (saveStep === 'picker' ? getProjects() : []), [saveStep]);

  const cardBase = 'w-full max-w-sm rounded-xl border border-white/[0.08] bg-white/[0.02]';
  const rowBtn = 'w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12.5px] text-[#CBD5E1] hover:bg-white/[0.05] hover:text-white transition-colors';

  const saveCard = savedProjectId ? (
    <div className={`${cardBase} flex items-center gap-3 px-3 py-2.5`}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: `${ACCENT}1a` }}>
        <Check className="h-4 w-4" style={{ color: ACCENT }} strokeWidth={2.5} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-medium text-slate-100">{t('wbCardSaved')}</div>
        <div className="text-[11px] text-[#94A3B8] truncate">{t('wbSavedToNamed', { name: savedName })}</div>
      </div>
    </div>
  ) : saveStep === 'picker' ? (
    <div className={`${cardBase} p-3`}>
      <div className="flex items-center gap-2 mb-2">
        <button onClick={() => setSaveStep('prompt')} className="text-[#94A3B8] hover:text-white transition-colors" aria-label={t('wbNotNow')}>
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-[13px] font-medium text-white">{t('wbChooseProject')}</span>
      </div>
      <div className="max-h-56 overflow-y-auto scrollbar-thin space-y-0.5">
        {existingProjects.length === 0 ? (
          <p className="px-1 py-3 text-[12px] text-[#64748B]">{t('wbNoProjectsYet')}</p>
        ) : existingProjects.map((p) => (
          <button key={p.id} onClick={() => commitSave(p.id)} className={rowBtn}>
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-[#94A3B8]" />
            <span className="truncate">{p.name}</span>
          </button>
        ))}
      </div>
    </div>
  ) : saveStep === 'prompt' ? (
    <div className={`${cardBase} p-3`}>
      <p className="text-[13px] font-medium text-white mb-2.5 px-0.5">{t('wbSavePromptTitle')}</p>
      <div className="space-y-1">
        <button onClick={() => commitSave(undefined)} className={rowBtn}>
          <Plus className="h-3.5 w-3.5 shrink-0" style={{ color: ACCENT }} /> {t('wbCreateNewProject')}
        </button>
        <button onClick={() => setSaveStep('picker')} className={rowBtn}>
          <FolderOpen className="h-3.5 w-3.5 shrink-0 text-[#94A3B8]" /> {t('wbAddToExisting')}
        </button>
        <button onClick={() => setSaveStep('closed')} className={`${rowBtn} text-[#94A3B8] hover:text-slate-300`}>
          <X className="h-3.5 w-3.5 shrink-0" /> {t('wbNotNow')}
        </button>
      </div>
    </div>
  ) : (
    <button onClick={() => setSaveStep('prompt')} className={`${cardBase} group flex items-center gap-3 px-3 py-2.5 text-left hover:bg-white/[0.04] transition-colors`}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: `${ACCENT}1a` }}>
        <FolderPlus className="h-4 w-4" style={{ color: ACCENT }} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-medium text-slate-100">{t('wbCardSaveToProject')}</div>
        <div className="text-[11px] text-[#94A3B8] truncate">{t('wbCardSaveSub')}</div>
      </div>
    </button>
  );

  const placeholder = lang === 'tr' ? 'Bu yapı için değişiklik iste…' : 'Ask for changes to this build…';

  return (
    <div className="flex flex-col h-full">
      {/* Build feed */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="max-w-3xl mx-auto px-4 py-6">
          <WebBuildConversation
            steps={payload?.steps ?? []}
            files={payload?.files ?? []}
            sectionItems={payload?.sectionItems ?? []}
            brief={payload?.brief ?? {}}
            live={live}
            extraCards={payload ? saveCard : undefined}
            slug={slugFromIdea(payload?.prompt ?? live?.prompt ?? '')}
            animateStepId={animateStepId}
            runId={payload?.steps[payload.steps.length - 1]?.id}
          />
          {errorMsg && (
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-rose-500/20 bg-rose-500/[0.04] px-4 py-3.5">
              <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
              <p className="text-[12.5px] text-[#CBD5E1] flex-1 min-w-0">{errorMsg}</p>
              <button
                onClick={handleRetry}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium text-[#05060a] shrink-0 disabled:opacity-50"
                style={{ background: ACCENT }}
              >
                <RotateCcw className="h-3.5 w-3.5" /> {t('retry')}
              </button>
            </div>
          )}
          <div ref={feedEndRef} className="h-2" />
        </div>
      </div>

      {/* Revision composer — locked to build edits. */}
      <div className="shrink-0 px-3 md:px-4 pb-3 md:pb-4 pt-1">
        <div className="max-w-3xl mx-auto flex items-end gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-2 focus-within:border-white/[0.16] transition-colors">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
            placeholder={placeholder}
            rows={1}
            disabled={busy && !payload}
            className="flex-1 resize-none bg-transparent px-2.5 py-2 text-[13.5px] text-slate-100 placeholder:text-[#64748B] outline-none max-h-40 scrollbar-thin disabled:opacity-50"
          />
          <button
            onClick={handleSubmit}
            disabled={busy || !input.trim() || !payload}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[#05060a] transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: ACCENT }}
            aria-label={placeholder}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" strokeWidth={2.5} />}
          </button>
        </div>
      </div>
    </div>
  );
}
