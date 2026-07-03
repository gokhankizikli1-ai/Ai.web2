import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Layout, Loader2, AlertTriangle, RotateCcw, Check, Sparkles, Wand2,
  Save, Star, DollarSign, Smartphone, Code2, FileCode,
  Plus, FolderOpen, X, ChevronLeft,
} from 'lucide-react';
import BuilderWorkspaceFrame from '@/components/builder/BuilderWorkspaceFrame';
import BuilderPromptCard from '@/components/builder/BuilderPromptCard';
import BrowserFrame from '@/components/builder/BrowserFrame';
import MarkdownMessage from '@/components/MarkdownMessage';
import WebBuildTimeline, {
  WEB_BUILD_STAGES, type StageStatus,
} from '@/components/builder/WebBuildTimeline';
import { useLanguageStore } from '@/stores/languageStore';
import {
  generateWebBuild, WebBuildError, webBuildErrorKeyFor,
  extractBrief, extractFiles, type WebBuildResult,
} from '@/lib/webBuildApi';
import { saveWebBuildToProject } from '@/lib/webBuildProject';
import { getProjects } from '@/stores/projectStore';

const ACCENT = '#60A5FA';

type Phase = 'idle' | 'loading' | 'result' | 'error';

const norm = (s: string) => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();

/** The 8 canonical stage ids, in order. */
const ALL_STAGE_IDS = WEB_BUILD_STAGES.map((s) => s.id);
/** The first 7 stages the timer walks through while the request is in flight
 *  (it stops at 'preview' — the real response completes 'ready'). */
const STAGE_FLOW = ['brief', 'type', 'plan', 'design', 'copy', 'code', 'preview'] as const;
const STAGE_TICK_MS = 850;

function freshStageStatus(): Record<string, StageStatus> {
  const base: Record<string, StageStatus> = {};
  for (const id of ALL_STAGE_IDS) base[id] = 'waiting';
  base.brief = 'active';
  return base;
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
  const [active, setActive] = useState(0);

  // Active builder timeline.
  const [stageStatus, setStageStatus] = useState<Record<string, StageStatus>>(freshStageStatus);
  const [stageDetails, setStageDetails] = useState<Record<string, string>>({});

  const [savedProjectId, setSavedProjectId] = useState<string | undefined>(undefined);
  const [savedName, setSavedName] = useState('');
  const [savedFlash, setSavedFlash] = useState(false);
  // Save flow: 'closed' | prompt (Create / Add-to-existing / Not now) | picker.
  const [saveStep, setSaveStep] = useState<'closed' | 'prompt' | 'picker'>('prompt');

  const abortRef = useRef<AbortController | null>(null);
  const stageTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stageIdxRef = useRef(0);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearStageTimer = useCallback(() => {
    if (stageTimer.current) { clearInterval(stageTimer.current); stageTimer.current = null; }
  }, []);

  useEffect(() => () => {
    abortRef.current?.abort();
    clearStageTimer();
    if (savedTimer.current) clearTimeout(savedTimer.current);
  }, [clearStageTimer]);

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

    clearStageTimer();
    setPhase('loading');
    setErrorMsg('');
    setResult(null);
    setActive(0);
    setSaveStep('prompt');
    setSavedProjectId(undefined);
    setSavedFlash(false);
    setLastIdea(trimmed);
    setStageStatus(freshStageStatus());
    setStageDetails({});

    // Walk the first 7 stages on a timer so generation feels like real work.
    stageIdxRef.current = 0;
    stageTimer.current = setInterval(() => {
      const i = stageIdxRef.current;
      if (i >= STAGE_FLOW.length - 1) { clearStageTimer(); return; }
      const cur = STAGE_FLOW[i];
      const next = STAGE_FLOW[i + 1];
      setStageStatus((prev) => ({ ...prev, [cur]: 'done', [next]: 'active' }));
      stageIdxRef.current = i + 1;
    }, STAGE_TICK_MS);

    try {
      const res = await generateWebBuild(trimmed, { signal: controller.signal });
      if (abortRef.current !== controller) return; // superseded
      clearStageTimer();

      // Complete every stage, and enrich a few with real detail.
      const done: Record<string, StageStatus> = {};
      for (const id of ALL_STAGE_IDS) done[id] = 'done';
      setStageStatus(done);

      const brief = extractBrief(res.sections);
      const files = extractFiles(res.sections);
      const pageSections = res.sections.find((s) => /page\s*sections/i.test(s.title));
      const sectionCount = pageSections
        ? (pageSections.body.match(/^\s*(?:[-*]|\d+\.)\s+/gm) || []).length
        : 0;
      const details: Record<string, string> = {};
      if (brief.type) details.type = brief.type;
      if (brief.style) details.design = brief.style;
      if (sectionCount > 0) details.plan = `${sectionCount} sections`;
      if (files.length > 0) details.code = `${files.length} files`;
      setStageDetails(details);

      setResult(res);
      setPhase('result');
    } catch (err) {
      if (controller.signal.aborted) return;
      clearStageTimer();
      // Mark the stage that was mid-flight as errored.
      const errored = STAGE_FLOW[Math.min(stageIdxRef.current, STAGE_FLOW.length - 1)];
      setStageStatus((prev) => ({ ...prev, [errored]: 'error' }));
      const key = err instanceof WebBuildError ? webBuildErrorKeyFor(err.kind) : 'wbErrGeneric';
      setErrorMsg(t(key) || t('wbErrGeneric'));
      setPhase('error');
    }
  }, [t, clearStageTimer]);

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
      setActive(0);
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
    setSavedFlash(true);
    setSaveStep('closed');
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSavedFlash(false), 2600);
  }, [result, lastIdea]);

  const existingProjects = useMemo(() => (saveStep === 'picker' ? getProjects() : []), [saveStep]);

  /* ── Derived section content for the result tabs ──────────────────── */
  const brief = useMemo(() => (result ? extractBrief(result.sections) : {}), [result]);
  const files = useMemo(() => (result ? extractFiles(result.sections) : []), [result]);

  const bodyOf = useCallback((title: string): string | undefined => {
    const s = result?.sections.find((x) => norm(x.title) === norm(title));
    const body = s?.body?.trim();
    return body || undefined;
  }, [result]);

  const siteUrl = slugFromIdea(lastIdea);

  /* ── Result tabs (only rendered when we have a result) ────────────── */
  const renderResult = () => {
    if (!result) return null;

    const planBody = bodyOf('Build Plan');
    const sectionsBody = bodyOf('Page Sections');
    const designBody = bodyOf('Design Direction');
    const copyBody = bodyOf('Generated Copy');
    const codeBody = bodyOf('Frontend Code');

    const overviewRows = [
      { label: t('wbOverviewType'), value: brief.type },
      { label: t('wbOverviewAudience'), value: brief.audience },
      { label: t('wbOverviewGoal'), value: brief.goal },
      { label: t('wbOverviewStyle'), value: brief.style },
    ].filter((r) => Boolean(r.value));

    const card = 'rounded-2xl border border-white/[0.06] bg-white/[0.012] p-5 sm:p-6';

    const overviewNode = (
      <div className={`${card} space-y-3`}>
        {overviewRows.map((r) => (
          <div key={r.label} className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-4">
            <span className="text-[11px] font-medium uppercase tracking-wide text-[#64748B] sm:w-36 shrink-0">
              {r.label}
            </span>
            <span className="text-[13px] text-slate-200 leading-relaxed">{r.value}</span>
          </div>
        ))}
      </div>
    );

    const briefNode = (
      <div className="space-y-4">
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 sm:p-5">
          <p className="text-[13px] text-slate-200 leading-relaxed">{lastIdea}</p>
        </div>
        {planBody && (
          <div className={card}><MarkdownMessage content={planBody} /></div>
        )}
      </div>
    );

    const sectionsNode = (
      <div className={card}>
        <p className="text-[11px] font-medium uppercase tracking-wide text-[#64748B] mb-3">
          {t('wbSectionsTitle')}
        </p>
        {sectionsBody && <MarkdownMessage content={sectionsBody} />}
      </div>
    );

    const designNode = <div className={card}>{designBody && <MarkdownMessage content={designBody} />}</div>;
    const copyNode = <div className={card}>{copyBody && <MarkdownMessage content={copyBody} />}</div>;

    const codeNode = (
      <div className="space-y-4">
        {files.length > 0 && (
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 sm:p-5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-[#64748B] mb-3">
              {t('wbFilesTitle')}
            </p>
            <div className="space-y-1">
              {files.map((f) => (
                <div key={f} className="flex items-center gap-2 text-[12.5px] text-slate-300">
                  <FileCode className="h-3.5 w-3.5 shrink-0" style={{ color: ACCENT }} />
                  <span className="font-mono truncate">{f}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {codeBody && <div className={card}><MarkdownMessage content={codeBody} /></div>}
      </div>
    );

    const previewNode = (
      <div className="space-y-2.5">
        <BrowserFrame url={siteUrl} accentColor={ACCENT}>
          <div className="bg-[#0b0d12] p-6 sm:p-8 min-h-[320px]">
            {copyBody
              ? <MarkdownMessage content={copyBody} />
              : <p className="text-[13px] text-[#64748B]">{t('webBuildEmptyBody')}</p>}
          </div>
        </BrowserFrame>
        <p className="text-[11px] text-[#64748B] text-center">{t('wbStagePreviewDesc')}</p>
      </div>
    );

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
                onClick={() => setActive(0)}
                className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12.5px] text-[#94A3B8] hover:bg-white/[0.05] hover:text-slate-300 transition-colors"
              >
                <X className="h-3.5 w-3.5 shrink-0" /> {t('wbNotNow')}
              </button>
            </div>
          </>
        )}
      </div>
    );

    // Only show a tab when it has content. Brief + Save always available.
    const tabs = [
      overviewRows.length > 0 && { id: 'overview', label: t('wbTabOverview'), node: overviewNode },
      { id: 'brief', label: t('wbTabBrief'), node: briefNode },
      sectionsBody && { id: 'sections', label: t('wbTabSections'), node: sectionsNode },
      designBody && { id: 'design', label: t('wbTabDesign'), node: designNode },
      copyBody && { id: 'copy', label: t('wbTabCopy'), node: copyNode },
      (codeBody || files.length > 0) && { id: 'code', label: t('wbTabCode'), node: codeNode },
      copyBody && { id: 'preview', label: t('wbTabPreview'), node: previewNode },
      { id: 'save', label: t('wbTabSave'), node: saveNode },
    ].filter(Boolean) as { id: string; label: string; node: React.ReactNode }[];

    const activeIdx = Math.min(active, tabs.length - 1);
    const activeTab = tabs[activeIdx];
    const saveTabIdx = tabs.findIndex((tab) => tab.id === 'save');

    const jumpToSave = () => {
      if (!savedProjectId) setSaveStep('prompt');
      if (saveTabIdx >= 0) setActive(saveTabIdx);
    };

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

        {/* Tab row */}
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-none border-b border-white/[0.06] mb-4 pb-px">
          {tabs.map((tab, i) => {
            const on = i === activeIdx;
            return (
              <button
                key={tab.id}
                onClick={() => setActive(i)}
                className={`relative whitespace-nowrap px-3 py-1.5 text-[12px] font-medium transition-colors ${
                  on ? 'text-white' : 'text-[#94A3B8] hover:text-[#CBD5E1]'
                }`}
              >
                {tab.label}
                {on && (
                  <motion.span
                    layoutId="wbTab"
                    className="absolute left-2 right-2 -bottom-px h-0.5 rounded-full"
                    style={{ background: `linear-gradient(90deg, ${ACCENT}, ${ACCENT})` }}
                    transition={{ type: 'spring', duration: 0.4, bounce: 0.15 }}
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Active tab body */}
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab?.id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {activeTab?.node}
          </motion.div>
        </AnimatePresence>

        {/* Actions row */}
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
            <button
              onClick={jumpToSave}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11.5px] font-medium text-slate-200 bg-white/[0.03] border border-white/[0.08] hover:bg-white/[0.06] transition-all"
            >
              {savedFlash ? <Check className="h-3 w-3" style={{ color: ACCENT }} /> : <Save className="h-3 w-3" />}
              {savedFlash ? t('wbSavedToNamed', { name: savedName }) : t('wbSaveToProject')}
            </button>
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

        {/* Loading — active builder timeline */}
        {phase === 'loading' && (
          <motion.div key="loading" {...fadeUp} exit={{ opacity: 0 }} className="max-w-2xl mx-auto">
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.012] p-5 sm:p-6">
              <div className="flex items-center gap-2.5 mb-4">
                <Loader2 className="h-4 w-4 animate-spin" style={{ color: ACCENT }} />
                <p className="text-[13.5px] font-semibold text-white">{t('wbBuildingTitle')}</p>
              </div>
              <WebBuildTimeline statuses={stageStatus} details={stageDetails} />
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
