import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Layout, Loader2, ArrowUp, AlertTriangle, RotateCcw,
  Check, FolderOpen, Plus, X, ChevronLeft, FolderPlus,
} from 'lucide-react';
import BuilderWorkspaceFrame from '@/components/builder/BuilderWorkspaceFrame';
import WebBuildConversation from '@/components/builder/WebBuildConversation';
import { useLanguageStore } from '@/stores/languageStore';
import {
  generateWebBuild, WebBuildError, webBuildErrorKeyFor,
} from '@/lib/webBuildApi';
import {
  buildWebBuildPayload, type WebBuildPayload,
} from '@/lib/webBuildPayload';
import { saveWebBuildPayloadToProject } from '@/lib/webBuildProject';
import { getProjects } from '@/stores/projectStore';

const ACCENT = '#60A5FA';

function slugFromIdea(idea: string): string {
  const base = idea.trim().toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 18);
  return `${base || 'yoursite'}.korvix.build`;
}

/** Prefill chips for the idle state → seed the composer with a starter idea. */
const EXAMPLE_CHIPS: { label: string; idea: string }[] = [
  { label: 'SaaS', idea: 'A SaaS landing page for an AI analytics tool' },
  { label: 'Portfolio', idea: 'A portfolio site for a product designer' },
  { label: 'Agency', idea: 'A website for a creative branding agency' },
  { label: 'Restaurant', idea: 'A website for a modern neighbourhood restaurant' },
  { label: 'Ecommerce', idea: 'A storefront landing page for a skincare brand' },
  { label: 'Waitlist', idea: 'A waitlist landing page for a new productivity app' },
];

export default function WebsiteBuilder() {
  const { t } = useLanguageStore();

  const [input, setInput] = useState('');
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

  useEffect(() => () => { abortRef.current?.abort(); }, []);

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
      const next = buildWebBuildPayload(trimmed, res);
      setPayload(next);
      setAnimateStepId(next.steps[next.steps.length - 1]?.id);
      setLive(null);
    } catch (err) {
      if (controller.signal.aborted) return;
      failLive(err);
    } finally {
      if (abortRef.current === controller) setBusy(false);
    }
  }, [startLive, failLive]);

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
      const next = buildWebBuildPayload(trimmed, res, payload);
      setPayload(next);
      setAnimateStepId(next.steps[next.steps.length - 1]?.id);
      setLive(null);
    } catch (err) {
      if (controller.signal.aborted) return;
      failLive(err);
    } finally {
      if (abortRef.current === controller) setBusy(false);
    }
  }, [payload, startLive, failLive]);

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
  const placeholder = payload ? t('wbComposerRevise') : t('wbComposerPlaceholder');

  return (
    <BuilderWorkspaceFrame
      icon={<Layout className="h-4 w-4" style={{ color: ACCENT }} />}
      title={t('webBuildTitle')}
      subtitle={t('webBuildSubtitle')}
      accent={ACCENT}
      maxWidth="max-w-3xl"
    >
      <div className="flex flex-col min-h-[calc(100vh-220px)]">
        {/* ── Conversation feed / idle state ─────────────────────────── */}
        <div className="flex-1">
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
            <div className="flex flex-col items-center justify-center text-center py-16 sm:py-24">
              <h2 className="text-[20px] sm:text-[22px] font-semibold text-white tracking-tight mb-2.5">
                {t('webBuildEmptyTitle')}
              </h2>
              <p className="max-w-md text-[13px] text-[#94A3B8] leading-relaxed mb-6">
                {t('webBuildEmptyBody')}
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                {EXAMPLE_CHIPS.map((c) => (
                  <button
                    key={c.label}
                    onClick={() => setInput(c.idea)}
                    className="px-3 py-1.5 rounded-full bg-white/[0.02] border border-white/[0.06] text-[12px] text-[#94A3B8] hover:text-slate-100 hover:border-white/[0.14] transition-colors"
                  >
                    {c.label}
                  </button>
                ))}
              </div>

              {errorMsg && (
                <div className="mt-8 w-full max-w-md flex flex-wrap items-center gap-3 rounded-xl border border-rose-500/20 bg-rose-500/[0.04] px-4 py-3.5 text-left">
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
          <div className="flex items-end gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-2 focus-within:border-white/[0.16] transition-colors">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
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
    </BuilderWorkspaceFrame>
  );
}
