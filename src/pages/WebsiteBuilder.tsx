import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Layout, Loader2, ArrowUp, AlertTriangle, RotateCcw,
  Check, FolderOpen, Plus, X, ChevronLeft, FolderPlus,
} from 'lucide-react';
import { useSearchParams } from 'react-router';
import BuilderWorkspaceFrame from '@/components/builder/BuilderWorkspaceFrame';
import WebBuildConversation from '@/components/builder/WebBuildConversation';
import WebBuildWelcome from '@/components/builder/WebBuildWelcome';
import WebBuildSidebar from '@/components/builder/WebBuildSidebar';
import { useLanguageStore } from '@/stores/languageStore';
import {
  saveWebBuildSession, getWebBuildSession, getActiveWebBuildSession,
  setActiveWebBuildSession, clearActiveWebBuildSession, deriveWebBuildTitle,
} from '@/lib/webBuildSession';
import { upsertWebBuildChatSession } from '@/lib/webBuildChatSession';
import {
  generateWebBuild, WebBuildError, webBuildErrorKeyFor,
} from '@/lib/webBuildApi';
import {
  buildWebBuildPayload, type WebBuildPayload,
} from '@/lib/webBuildPayload';
import { saveWebBuildPayloadToProject } from '@/lib/webBuildProject';
import { stashPreview } from '@/lib/webBuildPreviewStash';
import { getProjects } from '@/stores/projectStore';

/** Persist the latest build's preview so the /preview/web-build/:runId route
 *  can always load it (even after navigating to a new tab or refreshing). */
function stashLatestPreview(p: WebBuildPayload, slug: string): void {
  const runId = p.steps[p.steps.length - 1]?.id;
  if (runId) stashPreview({ runId, sectionItems: p.sectionItems, brief: p.brief, slug, prompt: p.prompt });
}

const ACCENT = '#60A5FA';

function slugFromIdea(idea: string): string {
  const base = idea.trim().toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 18);
  return `${base || 'yoursite'}.korvix.build`;
}

export default function WebsiteBuilder() {
  const { t, lang } = useLanguageStore();

  const [input, setInput] = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  const [payload, setPayload] = useState<WebBuildPayload | null>(null);
  const [animateStepId, setAnimateStepId] = useState<string | undefined>(undefined);
  const [live, setLive] = useState<{ prompt: string; kind: 'build' | 'revision' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const [savedProjectId, setSavedProjectId] = useState<string | undefined>(undefined);
  const [savedName, setSavedName] = useState('');
  // Save flow: 'closed' (compact card) | 'prompt' (Create / Add / Not now) | 'picker'.
  const [saveStep, setSaveStep] = useState<'closed' | 'prompt' | 'picker'>('closed');

  const abortRef = useRef<AbortController | null>(null);
  const feedEndRef = useRef<HTMLDivElement | null>(null);
  const lastPromptRef = useRef('');
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  // Restore a persisted Web Build session on mount — a specific one from
  // ?session=<id> (e.g. clicked in the sidebar), else the last active session —
  // so leaving/returning or a refresh never loses the build. Runs once.
  useEffect(() => {
    const sid = searchParams.get('session');
    const restored = sid ? getWebBuildSession(sid) : getActiveWebBuildSession();
    if (restored) {
      setPayload(restored);
      setAnimateStepId(undefined); // restored history renders fully, no replay
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Persist the session + mirror it into the sidebar, and pin ?session=<id>
   *  so a refresh reopens exactly this build. */
  const persistSession = useCallback((p: WebBuildPayload) => {
    const id = saveWebBuildSession(p, lang);
    if (!id) return;
    upsertWebBuildChatSession(id, deriveWebBuildTitle(p.prompt, lang), p.prompt);
    setSearchParams({ session: id }, { replace: true });
  }, [lang, setSearchParams]);

  /** Reopen an existing Web Build session (from the left rail) — restore its
   *  feed/files/preview and make it active. */
  const openSession = useCallback((id: string) => {
    const restored = getWebBuildSession(id);
    if (!restored) return;
    abortRef.current?.abort();
    setPayload(restored);
    setActiveWebBuildSession(id);
    setAnimateStepId(undefined);
    setErrorMsg('');
    setInput('');
    setSaveStep('closed');
    setSavedProjectId(undefined);
    setSearchParams({ session: id }, { replace: true });
  }, [setSearchParams]);

  /** Start a brand-new build — clear the active session + URL, back to welcome. */
  const startNewBuild = useCallback(() => {
    abortRef.current?.abort();
    setPayload(null);
    setAnimateStepId(undefined);
    setErrorMsg('');
    setSavedProjectId(undefined);
    setSaveStep('closed');
    setInput('');
    clearActiveWebBuildSession();
    setSearchParams({}, { replace: true });
  }, [setSearchParams]);

  // Keep the newest message in view as the conversation grows.
  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [payload, live]);

  /** Show the live agent run: the Analyze/Plan phases run WHILE the backend
   *  call is in flight (the model really is analysing + generating here). */
  const startLive = useCallback((prompt: string, kind: 'build' | 'revision') => {
    setLive({ prompt, kind });
  }, []);

  const failLive = useCallback((err: unknown) => {
    setLive(null);
    const key = err instanceof WebBuildError ? webBuildErrorKeyFor(err.kind) : 'wbErrGeneric';
    setErrorMsg(t(key) || t('wbErrGeneric'));
  }, [t]);

  /* ── Fresh generation ─────────────────────────────────────────────── */
  const runFresh = useCallback(async (idea: string) => {
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
      const res = await generateWebBuild(trimmed, { signal: controller.signal });
      if (abortRef.current !== controller) return; // superseded
      const next = buildWebBuildPayload(trimmed, res, undefined, lang);
      setPayload(next);
      persistSession(next);
      stashLatestPreview(next, slugFromIdea(next.prompt));
      setAnimateStepId(next.steps[next.steps.length - 1]?.id);
      setLive(null);
    } catch (err) {
      if (controller.signal.aborted) return;
      failLive(err);
    } finally {
      if (abortRef.current === controller) setBusy(false);
    }
  }, [startLive, failLive, lang]);

  /* ── Revision (accumulates steps + diffs) ─────────────────────────── */
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
      const res = await generateWebBuild(trimmed, {
        revise: true,
        previousReply: payload.reply,
        signal: controller.signal,
      });
      if (abortRef.current !== controller) return; // superseded
      const next = buildWebBuildPayload(trimmed, res, payload, lang);
      setPayload(next);
      persistSession(next);
      stashLatestPreview(next, slugFromIdea(next.prompt));
      setAnimateStepId(next.steps[next.steps.length - 1]?.id);
      setLive(null);
    } catch (err) {
      if (controller.signal.aborted) return;
      failLive(err);
    } finally {
      if (abortRef.current === controller) setBusy(false);
    }
  }, [payload, startLive, failLive, lang]);

  /* ── Composer submit ──────────────────────────────────────────────── */
  const handleSubmit = useCallback(() => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    if (payload) runRevision(text);
    else runFresh(text);
  }, [input, busy, payload, runFresh, runRevision]);

  const handleRetry = useCallback(() => {
    setErrorMsg('');
    if (payload) {
      const last = payload.steps[payload.steps.length - 1]?.prompt || payload.prompt;
      runRevision(last);
    } else if (lastPromptRef.current) {
      runFresh(lastPromptRef.current);
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

  /* ── Save card (passed to the conversation as an extra attachment) ──── */
  const cardBase = 'w-full max-w-sm rounded-xl border border-white/[0.08] bg-white/[0.02]';
  const rowBtn = 'w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12.5px] text-[#CBD5E1] hover:bg-white/[0.05] hover:text-white transition-colors';

  const saveCard = savedProjectId ? (
    <div className={`${cardBase} flex items-center gap-3 px-3 py-2.5`}>
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
        style={{ background: `${ACCENT}1a` }}
      >
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
    <button
      onClick={() => setSaveStep('prompt')}
      className={`${cardBase} group flex items-center gap-3 px-3 py-2.5 text-left hover:bg-white/[0.04] transition-colors`}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: `${ACCENT}1a` }}>
        <FolderPlus className="h-4 w-4" style={{ color: ACCENT }} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-medium text-slate-100">{t('wbCardSaveToProject')}</div>
        <div className="text-[11px] text-[#94A3B8] truncate">{t('wbCardSaveSub')}</div>
      </div>
    </button>
  );

  const hasConversation = Boolean(payload || live);
  // Mascot reacts to the composer: working while generating, awake when the
  // input is focused, typing while there's text in it, else calm/idle.
  const mascotState = busy || live ? 'working' : inputFocused ? (input.trim() ? 'typing' : 'awake') : 'idle';
  const placeholder = payload ? t('wbComposerRevise') : t('wbComposerPlaceholder');

  return (
    <BuilderWorkspaceFrame
      icon={<Layout className="h-4 w-4" style={{ color: ACCENT }} />}
      title={t('webBuildTitle')}
      subtitle={t('webBuildSubtitle')}
      accent={ACCENT}
      maxWidth="max-w-6xl"
    >
      <div className="flex gap-6">
        <WebBuildSidebar
          activeSessionId={payload?.steps[0]?.id}
          onNewBuild={startNewBuild}
          onOpenSession={openSession}
        />
        <div className="flex min-w-0 flex-1 flex-col min-h-[calc(100vh-220px)] lg:mx-auto lg:max-w-3xl">
        {/* ── Conversation feed / idle state ─────────────────────────── */}
        <div className="flex-1">
          {/* Mobile New Build (desktop uses the left rail). */}
          <div className="mb-3 flex justify-end lg:hidden">
            <button
              onClick={startNewBuild}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] px-2.5 py-1.5 text-[12px] text-[#94A3B8] hover:text-white hover:border-white/[0.16] transition-colors disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" /> {t('wbNewBuild')}
            </button>
          </div>
          {hasConversation ? (
            <>
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
            </>
          ) : (
            <>
              <WebBuildWelcome onExample={(idea) => runFresh(idea)} mascotState={mascotState} />
              {errorMsg && (
                <div className="mx-auto mt-8 w-full max-w-md flex flex-wrap items-center gap-3 rounded-xl border border-rose-500/20 bg-rose-500/[0.04] px-4 py-3.5 text-left">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
                  <p className="text-[12.5px] text-[#CBD5E1] flex-1 min-w-0">{errorMsg}</p>
                  {lastPromptRef.current && (
                    <button
                      onClick={handleRetry}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium text-[#05060a] shrink-0 disabled:opacity-50"
                      style={{ background: ACCENT }}
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> {t('retry')}
                    </button>
                  )}
                </div>
              )}
            </>
          )}
          <div ref={feedEndRef} />
        </div>

        {/* ── Sticky bottom composer ─────────────────────────────────── */}
        <div className="sticky bottom-0 pt-4 pb-4 bg-gradient-to-t from-[#0a0a0a] via-[#0a0a0a] to-transparent">
          <div className="flex items-end gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-2 focus-within:border-white/[0.16] transition-colors">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
              }}
              placeholder={placeholder}
              rows={1}
              className="flex-1 resize-none bg-transparent px-2.5 py-2 text-[13.5px] text-slate-100 placeholder:text-[#64748B] outline-none max-h-40 scrollbar-thin"
            />
            <button
              onClick={handleSubmit}
              disabled={busy || !input.trim()}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[#05060a] transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: ACCENT }}
              aria-label={t('webBuildTitle')}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" strokeWidth={2.5} />}
            </button>
          </div>
        </div>
        </div>
      </div>
    </BuilderWorkspaceFrame>
  );
}
