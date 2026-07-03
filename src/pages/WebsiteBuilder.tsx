import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Layout, Loader2, AlertTriangle, RotateCcw, Check, Eye, FileText,
  Sparkles, Wand2, Save, Star, DollarSign, Smartphone, Code2,
  Plus, FolderOpen, X, ChevronLeft,
} from 'lucide-react';
import BuilderWorkspaceFrame from '@/components/builder/BuilderWorkspaceFrame';
import BuilderPromptCard from '@/components/builder/BuilderPromptCard';
import BuilderProgressCard from '@/components/builder/BuilderProgressCard';
import BrowserFrame from '@/components/builder/BrowserFrame';
import MarkdownMessage from '@/components/MarkdownMessage';
import { useLanguageStore } from '@/stores/languageStore';
import {
  generateWebBuild, WebBuildError, WEB_BUILD_SECTIONS, type WebBuildResult,
} from '@/lib/webBuildApi';
import { saveWebBuildToProject } from '@/lib/webBuildProject';
import { getProjects } from '@/stores/projectStore';
import type { BuildSection } from '@/lib/gameBuilderApi';

const ACCENT = '#60A5FA';

type Phase = 'idle' | 'loading' | 'result' | 'error';

const norm = (s: string) => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();

// Canonical section title (normalized) → i18n label key.
const SECTION_LABEL_KEY: Record<string, string> = {
  [norm('Build Plan')]: 'wbBuildPlan',
  [norm('Design Direction')]: 'wbDesignDirection',
  [norm('Page Sections')]: 'wbPageSections',
  [norm('Generated Copy')]: 'wbGeneratedCopy',
  [norm('Frontend Code')]: 'wbFrontendCode',
  [norm('Next Steps')]: 'wbNextSteps',
};

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
  const [view, setView] = useState<'build' | 'preview'>('build');

  const [savedProjectId, setSavedProjectId] = useState<string | undefined>(undefined);
  const [savedName, setSavedName] = useState('');
  const [savedFlash, setSavedFlash] = useState(false);
  // Save flow: 'closed' | prompt (Create / Add-to-existing / Not now) | picker.
  const [saveStep, setSaveStep] = useState<'closed' | 'prompt' | 'picker'>('closed');

  const abortRef = useRef<AbortController | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    abortRef.current?.abort();
    if (savedTimer.current) clearTimeout(savedTimer.current);
  }, []);

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

  // Sections in canonical order, keeping only those actually present.
  const orderedSections = useMemo<BuildSection[]>(() => {
    if (!result) return [];
    return WEB_BUILD_SECTIONS
      .map((canonical) => result.sections.find((s) => norm(s.title) === norm(canonical)))
      .filter((s): s is BuildSection => Boolean(s));
  }, [result]);

  const activeIdx = Math.min(active, Math.max(0, orderedSections.length - 1));
  const activeSection = orderedSections[activeIdx];

  const copySection = useMemo(
    () => orderedSections.find((s) => norm(s.title) === norm('Generated Copy')) ?? orderedSections[0],
    [orderedSections],
  );

  const labelFor = useCallback(
    (title: string) => {
      const key = SECTION_LABEL_KEY[norm(title)];
      return key ? t(key) : title;
    },
    [t],
  );

  /* ── Fresh generation ─────────────────────────────────────────────── */
  const runFresh = useCallback(async (idea: string) => {
    const trimmed = idea.trim();
    if (!trimmed) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setPhase('loading');
    setErrorMsg('');
    setResult(null);
    setActive(0);
    setView('build');
    setSavedProjectId(undefined);
    setSavedFlash(false);
    setLastIdea(trimmed);

    try {
      const res = await generateWebBuild(trimmed, { signal: controller.signal });
      if (abortRef.current !== controller) return; // superseded
      setResult(res);
      setPhase('result');
    } catch (err) {
      if (controller.signal.aborted) return;
      setErrorMsg(err instanceof WebBuildError ? err.message : t('webBuildError'));
      setPhase('error');
    }
  }, [t]);

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
      setErrorMsg(err instanceof WebBuildError ? err.message : t('webBuildError'));
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

  // Save button. Once this build already lives in a project, subsequent
  // saves append to it silently with a confirmation. Otherwise ask the user
  // how they want to save (new project / existing project / not now).
  const handleSaveClick = useCallback(() => {
    if (!result) return;
    if (savedProjectId) { commitSave(savedProjectId); return; }
    setSaveStep((s) => (s === 'closed' ? 'prompt' : 'closed'));
  }, [result, savedProjectId, commitSave]);

  const existingProjects = useMemo(() => (saveStep === 'picker' ? getProjects() : []), [saveStep]);

  const siteUrl = slugFromIdea(lastIdea);

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

        {/* Loading */}
        {phase === 'loading' && (
          <motion.div key="loading" {...fadeUp} exit={{ opacity: 0 }} className="max-w-2xl mx-auto">
            <BuilderProgressCard label={t('webBuildGenerating')} accent={ACCENT} accent2={ACCENT} />
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
            <p className="text-[12.5px] text-[#CBD5E1] flex-1 min-w-0">{errorMsg || t('webBuildError')}</p>
            <button
              onClick={handleRetry}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium text-[#05060a] shrink-0"
              style={{ background: `linear-gradient(135deg, ${ACCENT}, ${ACCENT})` }}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {t('webBuildGenerate')}
            </button>
          </motion.div>
        )}

        {/* Result */}
        {phase === 'result' && result && (
          <motion.div key="result" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {/* Header: status + view toggle + save */}
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="flex h-6 w-6 items-center justify-center rounded-lg shrink-0"
                  style={{ background: `${ACCENT}1a`, border: `1px solid ${ACCENT}33` }}
                >
                  {revising
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: ACCENT }} />
                    : <Check className="h-3.5 w-3.5" style={{ color: ACCENT }} strokeWidth={2.5} />}
                </span>
                <p className="text-[13px] font-semibold text-white leading-tight truncate">
                  {revising ? t('wbRevising') : t('webBuildTitle')}
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {/* View toggle */}
                <div className="flex items-center gap-0.5 rounded-lg bg-white/[0.02] border border-white/[0.04] p-0.5">
                  <button
                    onClick={() => setView('build')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
                      view === 'build' ? 'bg-white/[0.06] text-white' : 'text-[#94A3B8] hover:text-slate-300'
                    }`}
                  >
                    <FileText className="w-3 h-3" /> {t('webBuildOutput')}
                  </button>
                  <button
                    onClick={() => setView('preview')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
                      view === 'preview' ? 'bg-white/[0.06] text-white' : 'text-[#94A3B8] hover:text-slate-300'
                    }`}
                  >
                    <Eye className="w-3 h-3" /> {t('webBuildPreview')}
                  </button>
                </div>

                {/* Save to project — asks how to save on first save. */}
                <div className="relative">
                  <button
                    onClick={handleSaveClick}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11.5px] font-medium text-slate-200 bg-white/[0.03] border border-white/[0.07] hover:bg-white/[0.06] transition-colors"
                  >
                    {savedFlash ? <Check className="h-3.5 w-3.5" style={{ color: ACCENT }} /> : <Save className="h-3.5 w-3.5" />}
                    {savedFlash ? t('wbSavedToNamed', { name: savedName }) : t('wbSaveToProject')}
                  </button>

                  <AnimatePresence>
                    {saveStep !== 'closed' && (
                      <motion.div
                        initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.15 }}
                        className="absolute right-0 top-full mt-1.5 w-64 rounded-xl overflow-hidden z-50 p-1.5"
                        style={{ background: 'linear-gradient(180deg, #151C28, #171C24)', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 16px 40px rgba(0,0,0,0.45)' }}
                      >
                        {saveStep === 'prompt' ? (
                          <>
                            <p className="px-2.5 py-2 text-[12px] font-medium text-white">{t('wbSavePromptTitle')}</p>
                            <button
                              onClick={() => commitSave(undefined)}
                              className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] text-[#CBD5E1] hover:bg-white/[0.05] hover:text-white transition-colors"
                            >
                              <Plus className="h-3.5 w-3.5 shrink-0" style={{ color: ACCENT }} /> {t('wbCreateNewProject')}
                            </button>
                            <button
                              onClick={() => setSaveStep('picker')}
                              className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] text-[#CBD5E1] hover:bg-white/[0.05] hover:text-white transition-colors"
                            >
                              <FolderOpen className="h-3.5 w-3.5 shrink-0 text-[#94A3B8]" /> {t('wbAddToExisting')}
                            </button>
                            <button
                              onClick={() => setSaveStep('closed')}
                              className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] text-[#94A3B8] hover:bg-white/[0.05] hover:text-slate-300 transition-colors"
                            >
                              <X className="h-3.5 w-3.5 shrink-0" /> {t('wbNotNow')}
                            </button>
                          </>
                        ) : (
                          <>
                            <div className="flex items-center gap-2 px-2.5 py-2">
                              <button onClick={() => setSaveStep('prompt')} className="text-[#94A3B8] hover:text-white transition-colors">
                                <ChevronLeft className="h-3.5 w-3.5" />
                              </button>
                              <span className="text-[12px] font-medium text-white">{t('wbChooseProject')}</span>
                            </div>
                            <div className="max-h-56 overflow-y-auto scrollbar-thin">
                              {existingProjects.length === 0 ? (
                                <p className="px-2.5 py-3 text-[11.5px] text-[#64748B]">{t('wbNoProjectsYet')}</p>
                              ) : existingProjects.map((p) => (
                                <button
                                  key={p.id}
                                  onClick={() => commitSave(p.id)}
                                  className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] text-[#CBD5E1] hover:bg-white/[0.05] hover:text-white transition-colors"
                                >
                                  <FolderOpen className="h-3.5 w-3.5 shrink-0 text-[#94A3B8]" />
                                  <span className="truncate">{p.name}</span>
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>

            {view === 'build' ? (
              <>
                {/* Section tabs */}
                {orderedSections.length > 0 && (
                  <div className="flex items-center gap-1 overflow-x-auto scrollbar-none border-b border-white/[0.06] mb-4 pb-px">
                    {orderedSections.map((s, i) => {
                      const on = i === activeIdx;
                      return (
                        <button
                          key={`${s.title}-${i}`}
                          onClick={() => setActive(i)}
                          className={`relative whitespace-nowrap px-3 py-1.5 text-[12px] font-medium transition-colors ${
                            on ? 'text-white' : 'text-[#94A3B8] hover:text-[#CBD5E1]'
                          }`}
                        >
                          {labelFor(s.title)}
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
                )}

                {/* Active section body */}
                <AnimatePresence mode="wait">
                  <motion.div
                    key={activeIdx}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="rounded-2xl border border-white/[0.06] bg-white/[0.012] p-5 sm:p-6"
                  >
                    {activeSection?.body
                      ? <MarkdownMessage content={activeSection.body} />
                      : <MarkdownMessage content={result.reply} />}
                  </motion.div>
                </AnimatePresence>
              </>
            ) : (
              /* Preview — the generated copy rendered inside browser chrome */
              <BrowserFrame url={siteUrl} accentColor={ACCENT}>
                <div className="bg-[#0b0d12] p-6 sm:p-8 min-h-[320px]">
                  {copySection?.body
                    ? <MarkdownMessage content={copySection.body} />
                    : <p className="text-[13px] text-[#64748B]">{t('webBuildEmptyBody')}</p>}
                </div>
              </BrowserFrame>
            )}

            {/* Iteration chips */}
            <div className="mt-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-[#5B6472] inline-flex items-center gap-1.5 mr-0.5">
                  <Wand2 className="h-3 w-3" style={{ color: ACCENT }} />
                </span>
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
        )}
      </AnimatePresence>
    </BuilderWorkspaceFrame>
  );
}
