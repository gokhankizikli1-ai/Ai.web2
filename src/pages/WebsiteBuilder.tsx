import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Layout, Loader2, ArrowUp, AlertTriangle, RotateCcw,
  Check, FolderOpen, Plus, X, ChevronLeft, FolderPlus,
} from 'lucide-react';
import { useSearchParams } from 'react-router';
import BuilderWorkspaceFrame from '@/components/builder/BuilderWorkspaceFrame';
import WebBuildConversation from '@/components/builder/WebBuildConversation';
import WebBuildWelcome from '@/components/builder/WebBuildWelcome';
import { WebBuildModeChips, WebBuildModePill } from '@/components/builder/WebBuildModeSelector';
import WebBuildSidebar from '@/components/builder/WebBuildSidebar';
import type { BuilderMode } from '@/lib/builderMode';
import { useLanguageStore } from '@/stores/languageStore';
import {
  getWebBuildSession, getActiveWebBuildSession,
  setActiveWebBuildSession, clearActiveWebBuildSession,
  getPendingWebBuildRun, clearPendingWebBuildRun,
} from '@/lib/webBuildSession';
import {
  generateWebBuild, WebBuildError, webBuildErrorKeyFor,
} from '@/lib/webBuildApi';
import {
  buildWebBuildPayload, type WebBuildPayload,
} from '@/lib/webBuildPayload';
import { runFrontendBuilderQualityPipeline } from '@/lib/webBuildFrontendQuality';
import { runFrontendBuilderRevision } from '@/lib/webBuildFrontendRevision';
import { saveWebBuildPayloadToProject } from '@/lib/webBuildProject';
import { applyImageReplacement, type ImageReplacementInput } from '@/lib/webBuildImageReplace';
import { currentUserScope } from '@/lib/userScope';
import {
  useWebBuildRunStore, startWebBuildRun, resetWebBuildRun,
  getWebBuildRunForScope, persistCompletedRun, slugFromIdea,
  type WebBuildRunState,
} from '@/stores/webBuildRunStore';
import { getProjects } from '@/stores/projectStore';

const ACCENT = '#60A5FA';

export default function WebsiteBuilder() {
  const { t, lang } = useLanguageStore();

  const [input, setInput] = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  // Selected build mode (hidden context, ChatGPT/Kimi tool-style). Never
  // inserted into the composer text — only sent as generation context.
  const [selectedMode, setSelectedMode] = useState<BuilderMode | null>(null);
  const [payload, setPayload] = useState<WebBuildPayload | null>(null);
  const [animateStepId, setAnimateStepId] = useState<string | undefined>(undefined);
  const [live, setLive] = useState<{ prompt: string; kind: 'build' | 'revision' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const [savedProjectId, setSavedProjectId] = useState<string | undefined>(undefined);
  const [savedName, setSavedName] = useState('');
  // Save flow: 'closed' (compact card) | 'prompt' (Create / Add / Not now) | 'picker'.
  const [saveStep, setSaveStep] = useState<'closed' | 'prompt' | 'picker'>('closed');

  const feedEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lastPromptRef = useRef('');
  // Latest runFresh, so the mount effect can kick off a build from a ?prompt=
  // handoff without depending on callback declaration order.
  const runFreshRef = useRef<((idea: string, mode?: BuilderMode | null) => void) | null>(null);
  // Latest failLive, so the coordinator-sync effect can map a failure without
  // re-subscribing whenever the language (and thus failLive) changes.
  const failLiveRef = useRef<((err: unknown) => void) | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  // NOTE: there is deliberately NO unmount-abort effect. A running build/revision is
  // owned by the run coordinator (src/stores/webBuildRunStore), not by this component,
  // so leaving Web Build for another sidebar route must NOT cancel it. Only an explicit
  // action (New Build, opening another session, or starting a new run) supersedes it.

  // Mount restore / handoff — runs once:
  //   1. ?session=<id>  → reopen that exact Web Build (sidebar / refresh).
  //   2. ?prompt=…      → a handoff from the Chat builder home: start a fresh build.
  //   3. a live coordinator run for THIS account → adopt it (the sync effect mirrors it).
  //   4. an interrupted pending run (survived a refresh) → honest restore + retry.
  //   5. otherwise      → reopen the last active session.
  useEffect(() => {
    const sid = searchParams.get('session');
    if (sid) {
      const restored = getWebBuildSession(sid);
      if (restored) { setPayload(restored); setAnimateStepId(undefined); }
      return;
    }
    const promptParam = searchParams.get('prompt');
    if (promptParam && promptParam.trim()) {
      const raw = searchParams.get('mode');
      const m: BuilderMode | null =
        raw && ['website', 'app', 'game', 'landing', 'ecommerce'].includes(raw)
          ? (raw as BuilderMode) : null;
      // App/game handoffs still run through the web pipeline for now, but keep
      // their mode as context. Strip the params so a refresh doesn't re-run.
      setSelectedMode(m);
      setSearchParams({}, { replace: true });
      runFreshRef.current?.(promptParam, m);
      return;
    }
    // A run started in THIS tab is still live in the coordinator after SPA navigation
    // — adopt it via the sync effect below; never reload a stale session or restart.
    if (getWebBuildRunForScope(currentUserScope())) return;
    // A full refresh killed the in-memory fetch. If a pending pointer survived, restore
    // it honestly (prompt + the revision's base project) and let the user retry — we
    // never claim it finished.
    const pending = getPendingWebBuildRun();
    if (pending) {
      clearPendingWebBuildRun();
      lastPromptRef.current = pending.prompt;
      const base = pending.basePayloadId ? getWebBuildSession(pending.basePayloadId) : null;
      // Honest recovery: restore the base project (for a revision) and put the prompt
      // back in the composer so the user can resend with one click. We never fabricate
      // a completed result for a run the refresh interrupted.
      if (base) { setPayload(base); setAnimateStepId(undefined); }
      setInput(pending.prompt);
      return;
    }
    const restored = getActiveWebBuildSession();
    if (restored) { setPayload(restored); setAnimateStepId(undefined); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mirror the run coordinator into this view's local state, so returning to Web Build
  // during or after a background run restores the SAME live/busy/payload state without
  // re-triggering generation. Kept as a thin projection — all lifecycle lives in the
  // coordinator; this only reflects it into the existing render state.
  useEffect(() => {
    const sync = (s: WebBuildRunState) => {
      // Never surface another account's run in this account's view.
      if (s.scope && s.scope !== currentUserScope()) return;
      if (s.status === 'running') {
        setBusy(true);
        setErrorMsg('');
        setLive({ prompt: s.prompt, kind: s.kind });
        setPayload(s.kind === 'revision' ? (s.basePayload ?? null) : null);
      } else if (s.status === 'completed' && s.payload) {
        setBusy(false);
        setLive(null);
        setErrorMsg('');
        setPayload(s.payload);
        setAnimateStepId(s.payload.steps[s.payload.steps.length - 1]?.id);
        if (s.runId) setSearchParams({ session: s.runId }, { replace: true });
      } else if (s.status === 'failed') {
        setBusy(false);
        failLiveRef.current?.(s.error);
        if (s.payload) setPayload(s.payload);
      }
    };
    // Adopt the current snapshot immediately (covers a return mid/after a run), then
    // keep mirroring subsequent transitions.
    sync(useWebBuildRunStore.getState());
    const unsub = useWebBuildRunStore.subscribe(sync);
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setSearchParams]);

  /** Persist the session + mirror it into the sidebar, and pin ?session=<id>
   *  so a refresh reopens exactly this build. Reuses the coordinator's persistence
   *  (session map + sidebar companion + preview stash) so generation completion and
   *  this in-page save (e.g. a device-image replacement) stay in lockstep. */
  const persistSession = useCallback((p: WebBuildPayload) => {
    const id = persistCompletedRun(p, lang, currentUserScope());
    if (id) setSearchParams({ session: id }, { replace: true });
  }, [lang, setSearchParams]);

  // Phase 14K.6 — permanently apply a device-image replacement, then persist the
  // updated project via the existing session save. Commit only on a successful,
  // targeted apply (no regeneration, no model call).
  const handleImageReplace = useCallback(async (input: ImageReplacementInput) => {
    if (!payload) return { ok: false, error: 'no_payload' };
    const r = applyImageReplacement(payload, input);
    if (!r.ok || !r.payload) return { ok: false, error: r.error };
    setPayload(r.payload);
    persistSession(r.payload);
    return { ok: true };
  }, [payload, persistSession]);

  /** Reopen an existing Web Build session (from the left rail) — restore its
   *  feed/files/preview and make it active. */
  const openSession = useCallback((id: string) => {
    const restored = getWebBuildSession(id);
    if (!restored) return;
    // Switching to another session is an explicit action → supersede any running run.
    resetWebBuildRun();
    setPayload(restored);
    setActiveWebBuildSession(id);
    setAnimateStepId(undefined);
    setErrorMsg('');
    setInput('');
    setSaveStep('closed');
    setSavedProjectId(undefined);
    setSearchParams({ session: id }, { replace: true });
  }, [setSearchParams]);

  /** Start a brand-new build — clear the active run + session + URL, back to welcome.
   *  This is the ONE explicit action that discards the active build context. */
  const startNewBuild = useCallback(() => {
    resetWebBuildRun();
    setPayload(null);
    setAnimateStepId(undefined);
    setErrorMsg('');
    setSavedProjectId(undefined);
    setSaveStep('closed');
    setInput('');
    setSelectedMode(null);
    clearActiveWebBuildSession();
    setSearchParams({}, { replace: true });
  }, [setSearchParams]);

  // Keep the newest message in view as the conversation grows.
  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [payload, live]);

  const failLive = useCallback((err: unknown) => {
    setLive(null);
    // Phase 13D — revision outcomes carry an already-localized, honest message; a
    // rejected/failed revision preserved the current project and allows retry.
    if (err instanceof WebBuildError && (err.kind === 'revision_no_base' || err.kind === 'revision_failed' || err.kind === 'revision_rejected')) {
      setErrorMsg(err.message);
      return;
    }
    // Phase 13E / 13E.1 — planning provider-transport failures AND backend safety/quota
    // rejections carry an already-localized, honest message. None is a malformed planning
    // reply; no fake planning step is created and the safety sentence is never persisted.
    if (err instanceof WebBuildError && (
      err.kind === 'planning_failed' || err.kind === 'planning_timeout' ||
      err.kind === 'planning_incomplete' || err.kind === 'planning_access' ||
      err.kind === 'planning_request_too_large' || err.kind === 'planning_request_rejected' ||
      err.kind === 'planning_throttled' || err.kind === 'planning_quota' ||
      err.kind === 'planning_rate_limited' ||
      // Phase 13E.2 — the client per-attempt planning deadline (distinct from a backend timeout).
      err.kind === 'planning_client_timeout' ||
      // Phase 13F — dedicated FRONTEND generation transport/provider failures; a fresh build
      // with zero model-native output is never shown as a deterministic-fallback success.
      err.kind === 'frontend_generation_client_timeout' || err.kind === 'frontend_generation_timeout' ||
      err.kind === 'frontend_generation_failed' || err.kind === 'frontend_generation_incomplete' ||
      err.kind === 'frontend_generation_access' || err.kind === 'frontend_generation_quota' ||
      err.kind === 'frontend_generation_rate_limited' ||
      // Phase 13F.2 — output-budget exhaustion and background-store-unavailable (no model call).
      err.kind === 'frontend_generation_output_limit' ||
      err.kind === 'frontend_generation_background_unavailable'
    )) {
      setErrorMsg(err.message);
      return;
    }
    const key = err instanceof WebBuildError ? webBuildErrorKeyFor(err.kind) : 'wbErrGeneric';
    setErrorMsg(t(key) || t('wbErrGeneric'));
  }, [t]);
  failLiveRef.current = failLive;

  /* ── Fresh generation ─────────────────────────────────────────────── */
  // The operation is handed to the run coordinator so it survives navigation away
  // from Web Build. The coordinator owns the AbortController + supersede logic and
  // persists the result on completion (even if this page is unmounted); the sync
  // effect mirrors running/completed/failed back into this view. The generation work
  // itself — the SAME planning + quality pipeline — is unchanged.
  const runFresh = useCallback((idea: string, mode: BuilderMode | null = selectedMode) => {
    const trimmed = idea.trim();
    if (!trimmed) return;
    lastPromptRef.current = trimmed;
    setSavedProjectId(undefined);
    setSaveStep('closed');
    startWebBuildRun({
      kind: 'build',
      prompt: trimmed,
      lang,
      scope: currentUserScope(),
      basePayload: null,
      execute: async (signal) => {
        const res = await generateWebBuild(trimmed, { signal, mode });
        const planned = buildWebBuildPayload(trimmed, res, undefined, lang);
        // Phase 12E — one centralized frontend quality pipeline (unchanged): the
        // dedicated builder call + Phase 12C/12D consumption, then the static design
        // review + at most one bounded repair + final acceptance. Only cancellation throws.
        return runFrontendBuilderQualityPipeline(planned, { signal });
      },
    });
  }, [lang, selectedMode]);
  runFreshRef.current = runFresh;

  /* ── Revision (accumulates steps + diffs) ─────────────────────────── */
  const runRevision = useCallback((idea: string) => {
    const trimmed = idea.trim();
    if (!trimmed || !payload) return;
    // Capture the base payload NOW so the revision always edits the project it started
    // from, regardless of later navigation. A failed/rejected revision preserves it.
    const base = payload;
    startWebBuildRun({
      kind: 'revision',
      prompt: trimmed,
      lang,
      scope: currentUserScope(),
      basePayload: base,
      // Phase 13D — a REAL source-to-source model-native revision (shared with
      // ChatWebBuild via the single runFrontendBuilderRevision orchestrator): exactly ONE
      // frontend_builder call edits the existing project files. Unchanged.
      execute: (signal) => runFrontendBuilderRevision(base, trimmed, { signal, uiLanguage: lang }),
    });
  }, [payload, lang]);

  /* ── Composer submit ──────────────────────────────────────────────── */
  const handleSubmit = useCallback(() => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    if (payload) runRevision(text);
    else runFresh(text);
  }, [input, busy, payload, runFresh, runRevision]);

  /** A mode chip SELECTS a build mode (hidden context) and focuses the composer.
   *  It never inserts text — clicking the active mode again clears it. */
  const handleSelectMode = useCallback((mode: BuilderMode) => {
    setSelectedMode((prev) => (prev === mode ? null : mode));
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

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
        {/* The tall min-height only exists to vertically center the IDLE mascot.
            During a build/conversation it would just push the compact agent card to
            the top of a giant empty column, so drop it once there's content. */}
        <div className={`flex min-w-0 flex-1 flex-col lg:mx-auto lg:max-w-3xl ${hasConversation ? '' : 'min-h-[calc(100vh-220px)]'}`}>
        {/* ── Conversation feed / idle state ─────────────────────────── */}
        <div className="flex flex-1 flex-col">
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
                onImageReplace={handleImageReplace}
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
            // Empty state — hero centered in the free space; the chips + composer
            // sit below it, near the input, so the composer never has to jump.
            <div className="flex flex-1 flex-col items-center justify-center py-8">
              <WebBuildWelcome mascotState={mascotState} />
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
            </div>
          )}
          <div ref={feedEndRef} />
        </div>

        {/* ── Sticky bottom composer ─────────────────────────────────── */}
        <div className="sticky bottom-0 pt-4 pb-4 bg-gradient-to-t from-[#0a0a0a] via-[#0a0a0a] to-transparent">
          {/* Build-mode chips sit right above the composer (empty state only). */}
          {!hasConversation && <WebBuildModeChips selected={selectedMode} onSelect={handleSelectMode} />}
          <div className="flex flex-col gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-2 focus-within:border-white/[0.16] transition-colors">
            {/* Selected build mode — a small premium pill attached to the composer. */}
            {selectedMode && (
              <div className="px-1 pt-0.5">
                <WebBuildModePill mode={selectedMode} onRemove={() => setSelectedMode(null)} />
              </div>
            )}
            <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
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
      </div>
    </BuilderWorkspaceFrame>
  );
}
