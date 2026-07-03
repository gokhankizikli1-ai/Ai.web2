import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Layout, Loader2, AlertTriangle, RotateCcw, Check, Sparkles, Wand2,
  Star, DollarSign, Smartphone, Code2,
  Plus, FolderOpen, X, ChevronLeft,
} from 'lucide-react';
import BuilderWorkspaceFrame from '@/components/builder/BuilderWorkspaceFrame';
import BuilderPromptCard from '@/components/builder/BuilderPromptCard';
import WebBuildActivityTable from '@/components/builder/WebBuildActivityTable';
import WebBuildOutput from '@/components/builder/WebBuildOutput';
import { useLanguageStore } from '@/stores/languageStore';
import {
  generateWebBuild, WebBuildError, webBuildErrorKeyFor,
  type WebBuildResult,
} from '@/lib/webBuildApi';
import {
  viewFromResult, deriveBuildActivity, type WebBuildActivityRow,
} from '@/lib/webBuildPayload';
import { saveWebBuildToProject } from '@/lib/webBuildProject';
import { getProjects } from '@/stores/projectStore';

const ACCENT = '#60A5FA';

type Phase = 'idle' | 'loading' | 'result' | 'error';

/** i18n label key for each activity row id. */
const ACTIVITY_LABELS: Record<string, string> = {
  brief: 'wbStageBrief',
  type: 'wbStageType',
  plan: 'wbStagePlan',
  design: 'wbStageDesign',
  copy: 'wbStageCopy',
  code: 'wbStageCode',
  preview: 'wbStagePreview',
  save: 'wbActSave',
};
/** The 7 rows the timer walks while the request is in flight (it stops at
 *  'preview' — the real response replaces the whole table). */
const ACTIVITY_FLOW = ['brief', 'type', 'plan', 'design', 'copy', 'code', 'preview'] as const;
/** Full ordered set of live rows (the flow + the save row). */
const ACTIVITY_ORDER = [...ACTIVITY_FLOW, 'save'] as const;
/** Minimum visible duration per step so no step ever flashes past. */
const ACTIVITY_TICK_MS = 1100;

/** Fresh live table: everything 'waiting' except 'brief', which starts 'running'. */
function freshActivityRows(): WebBuildActivityRow[] {
  return ACTIVITY_ORDER.map((id) => ({
    id,
    labelKey: ACTIVITY_LABELS[id],
    status: id === 'brief' ? 'running' : 'waiting',
  }));
}

const fadeUp = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.4, ease: 'easeOut' as const },
};

function slugFromIdea(idea: string): string {
  const base = idea.trim().toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 18);
  return `${base || 'yoursite'}.korvix.build`;
}

export default function WebsiteBuilder() {
  const { t } = useLanguageStore();

  const [prompt, setPrompt] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<WebBuildResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [lastIdea, setLastIdea] = useState('');

  const [revising, setRevising] = useState(false);

  // Paced activity/task table (live during generation, real log afterwards).
  const [activityRows, setActivityRows] = useState<WebBuildActivityRow[]>(freshActivityRows);

  const [savedProjectId, setSavedProjectId] = useState<string | undefined>(undefined);
  const [savedName, setSavedName] = useState('');
  // Save flow: 'closed' | prompt (Create / Add-to-existing / Not now) | picker.
  const [saveStep, setSaveStep] = useState<'closed' | 'prompt' | 'picker'>('prompt');

  const abortRef = useRef<AbortController | null>(null);
  const activityTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const activityIdxRef = useRef(0);

  const clearActivityTimer = useCallback(() => {
    if (activityTimer.current) { clearInterval(activityTimer.current); activityTimer.current = null; }
  }, []);

  useEffect(() => () => {
    abortRef.current?.abort();
    clearActivityTimer();
  }, [clearActivityTimer]);

  const busy = phase === 'loading';

  const EXAMPLES = useMemo(() => [
    'Build a modern website for a fitness coach',
    'SaaS landing page for an AI analytics tool',
    'Portfolio site for a product designer',
    'Landing page for a coffee shop',
  ], []);

  // Localized iteration chips → the English instruction sent to the backend.
  const REVISIONS = useMemo(() => [
    { key: 'wbRefineDesign', icon: Sparkles, instruction: 'Refine the visual design and polish the layout.' },
    { key: 'wbMakePremium', icon: Star, instruction: 'Make the whole site feel more premium and high-end.' },
    { key: 'wbAddPricing', icon: DollarSign, instruction: 'Add a pricing section.' },
    { key: 'wbAddTestimonials', icon: Star, instruction: 'Add a testimonials / social-proof section.' },
    { key: 'wbImproveMobile', icon: Smartphone, instruction: 'Improve the mobile layout and responsiveness.' },
    { key: 'wbGenerateCode', icon: Code2, instruction: 'Expand the Frontend Code with the remaining section components.' },
  ], []);

  /* ── Fresh generation ─────────────────────────────────────────────── */
  const runFresh = useCallback(async (idea: string) => {
    const trimmed = idea.trim();
    if (!trimmed) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    clearActivityTimer();
    setPhase('loading');
    setErrorMsg('');
    setResult(null);
    setSaveStep('prompt');
    setSavedProjectId(undefined);
    setLastIdea(trimmed);
    setActivityRows(freshActivityRows());

    // Walk the first 7 rows on a paced timer so generation reads as real work.
    // Each tick marks the current row done + the next running; we stop at
    // 'preview' (left running) and never auto-complete 'save'. We only advance
    // on the timer — never claim a step finished based on nothing.
    activityIdxRef.current = 0;
    activityTimer.current = setInterval(() => {
      const i = activityIdxRef.current;
      if (i >= ACTIVITY_FLOW.length - 1) { clearActivityTimer(); return; }
      const cur = ACTIVITY_FLOW[i];
      const next = ACTIVITY_FLOW[i + 1];
      setActivityRows((prev) => prev.map((r) =>
        r.id === cur ? { ...r, status: 'done' }
          : r.id === next ? { ...r, status: 'running' }
          : r));
      activityIdxRef.current = i + 1;
    }, ACTIVITY_TICK_MS);

    try {
      const res = await generateWebBuild(trimmed, { signal: controller.signal });
      if (abortRef.current !== controller) return; // superseded
      clearActivityTimer();

      // Replace the live table with the REAL log — every row 'done', details
      // tied to actual returned data (type, section list, file count …). The
      // 'save' row stays 'waiting' until the build is saved.
      setActivityRows(deriveBuildActivity(res));
      setResult(res);
      setPhase('result');
    } catch (err) {
      if (controller.signal.aborted) return;
      clearActivityTimer();
      // Mark whichever row was mid-flight as failed.
      const errored = ACTIVITY_FLOW[Math.min(activityIdxRef.current, ACTIVITY_FLOW.length - 1)];
      setActivityRows((prev) => prev.map((r) => (r.id === errored ? { ...r, status: 'failed' } : r)));
      const key = err instanceof WebBuildError ? webBuildErrorKeyFor(err.kind) : 'wbErrGeneric';
      setErrorMsg(t(key) || t('wbErrGeneric'));
      setPhase('error');
    }
  }, [t, clearActivityTimer]);

  /* ── Revision ─────────────────────────────────────────────────────── */
  const runRevision = useCallback(async (instruction: string) => {
    if (!result || revising) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setRevising(true);
    try {
      const res = await generateWebBuild(instruction, {
        revise: true,
        previousReply: result.reply,
        signal: controller.signal,
      });
      if (abortRef.current !== controller) return; // superseded
      setResult(res);
    } catch (err) {
      if (controller.signal.aborted) return;
      const key = err instanceof WebBuildError ? webBuildErrorKeyFor(err.kind) : 'wbErrGeneric';
      setErrorMsg(t(key) || t('wbErrGeneric'));
      setPhase('error');
    } finally {
      if (abortRef.current === controller) setRevising(false);
    }
  }, [result, revising, t]);

  const handleGenerate = () => runFresh(prompt);
  const handleRetry = () => runFresh(lastIdea || prompt);

  // Persist to a project and show a "Saved to <name>" confirmation.
  const commitSave = useCallback((projectId?: string) => {
    if (!result) return;
    const project = saveWebBuildToProject(lastIdea, result, projectId);
    setSavedProjectId(project.id);
    setSavedName(project.name);
    setSaveStep('closed');
    // Reflect the save in the Activity tab.
    setActivityRows((prev) => prev.map((r) => (r.id === 'save' ? { ...r, status: 'done' } : r)));
  }, [result, lastIdea]);

  const existingProjects = useMemo(() => (saveStep === 'picker' ? getProjects() : []), [saveStep]);

  /* ── Save-to-project prompt (rendered as the extra "Save" output tab) ─ */
  const card = 'rounded-2xl border border-white/[0.06] bg-white/[0.012] p-5 sm:p-6';
  const saveNode = (
    <div className={`${card} max-w-md`}>
      {savedProjectId ? (
        <div className="flex items-start gap-3">
          <span
            className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full shrink-0"
            style={{ background: `${ACCENT}22` }}
          >
            <Check className="h-3.5 w-3.5" style={{ color: ACCENT }} strokeWidth={2.5} />
          </span>
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-white">{t('wbSavedToNamed', { name: savedName })}</p>
            <button
              onClick={() => setSaveStep('picker')}
              className="mt-2 text-[12px] text-[#94A3B8] hover:text-slate-200 transition-colors inline-flex items-center gap-1.5"
            >
              <FolderOpen className="h-3.5 w-3.5" /> {t('wbAddToExisting')}
            </button>
          </div>
        </div>
      ) : saveStep === 'picker' ? (
        <>
          <div className="flex items-center gap-2 mb-2">
            <button onClick={() => setSaveStep('prompt')} className="text-[#94A3B8] hover:text-white transition-colors">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-[13px] font-medium text-white">{t('wbChooseProject')}</span>
          </div>
          <div className="max-h-64 overflow-y-auto scrollbar-thin space-y-0.5">
            {existingProjects.length === 0 ? (
              <p className="px-1 py-3 text-[12px] text-[#64748B]">{t('wbNoProjectsYet')}</p>
            ) : existingProjects.map((p) => (
              <button
                key={p.id}
                onClick={() => commitSave(p.id)}
                className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12.5px] text-[#CBD5E1] hover:bg-white/[0.05] hover:text-white transition-colors"
              >
                <FolderOpen className="h-3.5 w-3.5 shrink-0 text-[#94A3B8]" />
                <span className="truncate">{p.name}</span>
              </button>
            ))}
          </div>
        </>
      ) : saveStep === 'closed' ? (
        <button
          onClick={() => setSaveStep('prompt')}
          className="inline-flex items-center gap-2 rounded-lg px-2.5 py-2 text-[12.5px] text-[#CBD5E1] hover:bg-white/[0.05] hover:text-white transition-colors"
        >
          <Plus className="h-3.5 w-3.5 shrink-0" style={{ color: ACCENT }} /> {t('wbSaveToProject')}
        </button>
      ) : (
        <>
          <p className="text-[13px] font-medium text-white mb-3">{t('wbSavePromptTitle')}</p>
          <div className="space-y-1">
            <button
              onClick={() => commitSave(undefined)}
              className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12.5px] text-[#CBD5E1] hover:bg-white/[0.05] hover:text-white transition-colors"
            >
              <Plus className="h-3.5 w-3.5 shrink-0" style={{ color: ACCENT }} /> {t('wbCreateNewProject')}
            </button>
            <button
              onClick={() => setSaveStep('picker')}
              className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12.5px] text-[#CBD5E1] hover:bg-white/[0.05] hover:text-white transition-colors"
            >
              <FolderOpen className="h-3.5 w-3.5 shrink-0 text-[#94A3B8]" /> {t('wbAddToExisting')}
            </button>
            <button
              onClick={() => setSaveStep('closed')}
              className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12.5px] text-[#94A3B8] hover:bg-white/[0.05] hover:text-slate-300 transition-colors"
            >
              <X className="h-3.5 w-3.5 shrink-0" /> {t('wbNotNow')}
            </button>
          </div>
        </>
      )}
    </div>
  );

  /* ── Result view via the shared WebBuildOutput ────────────────────── */
  const renderResult = () => {
    if (!result) return null;
    const view = viewFromResult(lastIdea, result, activityRows);

    return (
      <motion.div key="result" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
        {/* Build ready header */}
        <div className="flex flex-wrap items-center gap-2.5 mb-4">
          <span
            className="flex h-6 w-6 items-center justify-center rounded-lg shrink-0"
            style={{ background: `${ACCENT}1a`, border: `1px solid ${ACCENT}33` }}
          >
            {revising
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: ACCENT }} />
              : <Check className="h-3.5 w-3.5" style={{ color: ACCENT }} strokeWidth={2.5} />}
          </span>
          <p className="text-[14px] font-semibold text-white leading-tight">
            {revising ? t('wbRevising') : t('wbBuildReady')}
          </p>
          {result.partial && (
            <span className="text-[11px] text-amber-300/90 bg-amber-400/[0.08] border border-amber-400/20 rounded-full px-2.5 py-1">
              {t('wbPartialNote')}
            </span>
          )}
        </div>

        {/* Shared tabbed output (Overview / Sections / Design / Copy / Code /
            Preview / Activity + the Save tab). */}
        <WebBuildOutput
          view={view}
          slug={slugFromIdea(lastIdea)}
          extraTabs={[{ id: 'save', label: t('wbTabSave'), content: saveNode }]}
          initialTab="overview"
        />

        {/* Revision action chips */}
        <div className="mt-6">
          <p className="text-[11px] font-medium uppercase tracking-wide text-[#5B6472] mb-2.5 inline-flex items-center gap-1.5">
            <Wand2 className="h-3 w-3" style={{ color: ACCENT }} /> {t('wbActionsTitle')}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {REVISIONS.map(({ key, icon: Icon, instruction }) => (
              <button
                key={key}
                onClick={() => runRevision(instruction)}
                disabled={revising}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11.5px] font-medium text-[#94A3B8] bg-white/[0.02] border border-white/[0.05] hover:text-slate-200 hover:border-white/[0.1] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Icon className="h-3 w-3" />
                {t(key)}
              </button>
            ))}
          </div>
        </div>
      </motion.div>
    );
  };

  return (
    <BuilderWorkspaceFrame
      icon={<Layout className="h-4 w-4" style={{ color: ACCENT }} />}
      title={t('webBuildTitle')}
      subtitle={t('webBuildSubtitle')}
      accent={ACCENT}
      maxWidth="max-w-5xl"
    >
      {/* Prompt */}
      <motion.div {...fadeUp} className="mb-6">
        <BuilderPromptCard
          value={prompt}
          onChange={setPrompt}
          onSubmit={handleGenerate}
          placeholder={t('webBuildPlaceholder')}
          ctaLabel={t('webBuildGenerate')}
          busyLabel={t('webBuildGenerating')}
          busy={busy}
          accent={ACCENT}
          accent2={ACCENT}
          examples={EXAMPLES}
          onExampleSelect={setPrompt}
        />
      </motion.div>

      <AnimatePresence mode="wait">
        {/* Empty state */}
        {phase === 'idle' && (
          <motion.div
            key="empty"
            {...fadeUp}
            exit={{ opacity: 0 }}
            className="max-w-lg mx-auto text-center py-14"
          >
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[0.06] bg-white/[0.02]">
              <Sparkles className="w-6 h-6" style={{ color: `${ACCENT}b3` }} />
            </div>
            <h3 className="text-[15px] font-medium text-white mb-2">{t('webBuildEmptyTitle')}</h3>
            <p className="text-[12px] text-[#94A3B8] leading-relaxed mb-6">{t('webBuildEmptyBody')}</p>
            <div className="flex items-center justify-center gap-2 flex-wrap">
              {['SaaS', 'Portfolio', 'Agency', 'Restaurant', 'Ecommerce', 'Waitlist'].map((c) => (
                <span
                  key={c}
                  className="px-2.5 py-1 rounded-full bg-white/[0.02] border border-white/[0.05] text-[10px] text-[#94A3B8]"
                >
                  {c}
                </span>
              ))}
            </div>
          </motion.div>
        )}

        {/* Loading — paced activity/task table */}
        {phase === 'loading' && (
          <motion.div key="loading" {...fadeUp} exit={{ opacity: 0 }} className="max-w-2xl mx-auto">
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.012] p-5 sm:p-6">
              <div className="flex items-center gap-2.5 mb-4">
                <Loader2 className="h-4 w-4 animate-spin" style={{ color: ACCENT }} />
                <p className="text-[13.5px] font-semibold text-white">{t('wbBuildingTitle')}</p>
              </div>
              <WebBuildActivityTable rows={activityRows} />
            </div>
          </motion.div>
        )}

        {/* Error */}
        {phase === 'error' && (
          <motion.div
            key="error"
            {...fadeUp}
            exit={{ opacity: 0 }}
            className="max-w-2xl mx-auto flex flex-wrap items-center gap-3 rounded-xl border border-rose-500/20 bg-rose-500/[0.04] px-4 py-3.5"
          >
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
            <p className="text-[12.5px] text-[#CBD5E1] flex-1 min-w-0">{errorMsg || t('wbErrGeneric')}</p>
            <button
              onClick={handleRetry}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium text-[#05060a] shrink-0"
              style={{ background: `linear-gradient(135deg, ${ACCENT}, ${ACCENT})` }}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {t('retry')}
            </button>
          </motion.div>
        )}

        {/* Result */}
        {phase === 'result' && result && renderResult()}
      </AnimatePresence>
    </BuilderWorkspaceFrame>
  );
}
