import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Gamepad2, Wand2, Copy, Check, Loader2, AlertTriangle, RotateCcw, Sparkles,
} from 'lucide-react';
import BuilderWorkspaceFrame from '@/components/builder/BuilderWorkspaceFrame';
import MarkdownMessage from '@/components/MarkdownMessage';
import { useLanguageStore } from '@/stores/languageStore';
import {
  GAME_ENGINES, BUILD_QUALITIES,
  generateGameBuild, parseBuildSections, GameBuildError,
  type GameBuildResult, type GameEngine, type BuildQuality,
} from '@/lib/gameBuilderApi';

// KorvixAI blue accent — same language as Chat / Tools / WorkspaceTabs.
const ACCENT = '#3B82F6';
const ACCENT_2 = '#60A5FA';

// Fixed internal defaults — the builder is prompt-first for the MVP, so the
// engine and build quality are pinned rather than exposed as pickers. The
// backend flow stays Roblox-compatible ('roblox' + the "Polished MVP" tier).
const FIXED_ENGINE: GameEngine = 'roblox';
const FIXED_QUALITY: BuildQuality = 'mvp';

type Phase = 'idle' | 'loading' | 'result' | 'error';

/* ─── Structured, tabbed result ────────────────────────────────────────── */

function BuildResult({
  result, onRegenerate, busy,
}: {
  result: GameBuildResult;
  onRegenerate: () => void;
  busy: boolean;
}) {
  const sections = useMemo(() => parseBuildSections(result.reply), [result.reply]);
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState(false);

  // New result → jump back to the first section.
  useEffect(() => setActive(0), [result.reply]);
  const activeIdx = Math.min(active, Math.max(0, sections.length - 1));

  const engineMeta = GAME_ENGINES[result.engine];
  const qualityMeta = BUILD_QUALITIES[result.quality];

  const handleCopyAll = async () => {
    try {
      await navigator.clipboard.writeText(result.reply);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — silently ignore */
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="flex h-6 w-6 items-center justify-center rounded-lg shrink-0"
            style={{ background: `${ACCENT}1a`, border: `1px solid ${ACCENT}33` }}
          >
            <Check className="h-3.5 w-3.5" style={{ color: ACCENT_2 }} strokeWidth={2.5} />
          </span>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-white leading-tight">Your build is ready</p>
            <p className="text-[11px] text-[#64748B] truncate">
              {engineMeta.label} · {qualityMeta.label} · copy-ready
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={handleCopyAll}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11.5px] font-medium text-slate-200 bg-white/[0.03] border border-white/[0.07] hover:bg-white/[0.06] transition-colors"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy all'}
          </button>
          <button
            onClick={onRegenerate}
            disabled={busy}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11.5px] font-medium text-slate-200 bg-white/[0.03] border border-white/[0.07] hover:bg-white/[0.06] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Regenerate
          </button>
        </div>
      </div>

      {sections.length > 0 ? (
        <>
          {/* Section tabs — horizontally scrollable */}
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-none border-b border-white/[0.06] mb-4 pb-px">
            {sections.map((s, i) => {
              const on = i === activeIdx;
              return (
                <button
                  key={`${s.title}-${i}`}
                  onClick={() => setActive(i)}
                  className={`relative whitespace-nowrap px-3 py-1.5 text-[12px] font-medium transition-colors ${
                    on ? 'text-white' : 'text-[#94A3B8] hover:text-[#CBD5E1]'
                  }`}
                >
                  {s.title}
                  {on && (
                    <motion.span
                      layoutId="gbTab"
                      className="absolute left-2 right-2 -bottom-px h-0.5 rounded-full"
                      style={{ background: `linear-gradient(90deg, ${ACCENT}, ${ACCENT_2})` }}
                      transition={{ type: 'spring', duration: 0.4, bounce: 0.15 }}
                    />
                  )}
                </button>
              );
            })}
          </div>

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
              {sections[activeIdx]?.body
                ? <MarkdownMessage content={sections[activeIdx].body} />
                : <p className="text-[13px] text-[#64748B]">Nothing in this section.</p>}
            </motion.div>
          </AnimatePresence>
        </>
      ) : (
        // Fallback — the reply had no parseable sections; render it whole.
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.012] p-5 sm:p-6">
          <MarkdownMessage content={result.reply} />
        </div>
      )}
    </div>
  );
}

/* ─── Page ─────────────────────────────────────────────────────────────── */

export default function GameBuilder() {
  const { t } = useLanguageStore();
  const [idea, setIdea] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<GameBuildResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const lastIdeaRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const busy = phase === 'loading';

  // Prompt-first feature chips — clicking one fills the prompt input.
  const chips = useMemo(
    () => [
      t('gbCoinUi'), t('gbHealthBar'), t('gbShopSystem'), t('gbCheckpoint'),
      t('gbSprint'), t('gbEnemyAi'), t('gbQuestTracker'), t('gbDailyReward'),
    ],
    [t],
  );

  const run = useCallback(async (targetIdea: string) => {
    const trimmed = targetIdea.trim();
    if (!trimmed || busy) return;

    // Cancel a prior in-flight generation before starting a new one.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    lastIdeaRef.current = trimmed;
    setPhase('loading');
    setErrorMsg('');
    setResult(null);

    try {
      // Engine + quality are pinned internally for the MVP (Roblox-compatible).
      const res = await generateGameBuild(FIXED_ENGINE, FIXED_QUALITY, trimmed, controller.signal);
      if (abortRef.current !== controller) return; // superseded
      setResult(res);
      setPhase('result');
    } catch (err) {
      if (controller.signal.aborted) return;
      const message = err instanceof GameBuildError
        ? err.message
        : 'Something went wrong while generating. Please try again.';
      setErrorMsg(message);
      setPhase('error');
    }
  }, [busy]);

  const handleGenerate = () => run(idea);
  const handleRetry = () => run(lastIdeaRef.current ?? idea);

  const canGenerate = idea.trim().length > 0 && !busy;

  return (
    <BuilderWorkspaceFrame
      icon={<Gamepad2 className="h-4 w-4" style={{ color: ACCENT_2 }} />}
      title={t('gameBuildTitle')}
      subtitle={t('gameBuildSubtitle')}
      accent={ACCENT}
      maxWidth="max-w-3xl"
    >
      {/* Prompt composer */}
      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.018] focus-within:border-white/[0.14] transition-colors overflow-hidden">
        <textarea
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleGenerate();
          }}
          rows={5}
          placeholder={t('gameBuildPlaceholder')}
          disabled={busy}
          className="w-full resize-none bg-transparent px-4 py-3.5 text-[14px] leading-relaxed text-slate-100 placeholder:text-[#5B6472] outline-none disabled:opacity-60"
        />
        <div className="flex items-center justify-between gap-3 px-3 py-2.5 border-t border-white/[0.05]">
          <span className="text-[11px] text-[#5B6472] hidden sm:flex items-center gap-1.5">
            <Sparkles className="h-3 w-3" style={{ color: ACCENT_2 }} />
            Korvix infers genre, camera, systems &amp; scope from your prompt
          </span>
          <button
            onClick={handleGenerate}
            disabled={!canGenerate}
            className="ml-auto inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold text-white transition-all hover:scale-[1.015] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
            style={{ background: `linear-gradient(135deg, ${ACCENT}, ${ACCENT_2})` }}
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('gameBuildGenerating')}
              </>
            ) : (
              <>
                <Wand2 className="h-4 w-4" />
                {t('gameBuildGenerate')}
              </>
            )}
          </button>
        </div>
      </div>

      {/* Feature chips — click to fill the prompt */}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {chips.map((label) => (
          <button
            key={label}
            onClick={() => setIdea(label)}
            disabled={busy}
            className="max-w-full truncate px-2.5 py-1 rounded-full text-[11px] text-[#94A3B8] bg-white/[0.02] border border-white/[0.05] hover:bg-white/[0.04] hover:text-slate-200 hover:border-white/[0.1] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            title={label}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[10.5px] text-[#5B6472]">
        Copy/export-ready code &amp; exact placement steps — Korvix doesn&apos;t write into the editor.
      </p>

      {/* Output area */}
      <div className="mt-6">
        <AnimatePresence mode="wait">
          {phase === 'idle' && (
            <motion.p
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="py-8 text-center text-[12.5px] text-[#5B6472]"
            >
              Write a game idea to generate the build package.
            </motion.p>
          )}

          {phase === 'loading' && (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.012] px-4 py-3.5"
            >
              <Loader2 className="h-4 w-4 animate-spin shrink-0" style={{ color: ACCENT_2 }} />
              <p className="text-[12.5px] text-[#94A3B8]">
                Designing, architecting &amp; QA-passing your build…
              </p>
            </motion.div>
          )}

          {phase === 'error' && (
            <motion.div
              key="error"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-rose-500/20 bg-rose-500/[0.04] px-4 py-3.5"
            >
              <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
              <p className="text-[12.5px] text-[#CBD5E1] flex-1 min-w-0">{errorMsg}</p>
              <button
                onClick={handleRetry}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium text-white shrink-0"
                style={{ background: `linear-gradient(135deg, ${ACCENT}, ${ACCENT_2})` }}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Try again
              </button>
            </motion.div>
          )}

          {phase === 'result' && result && (
            <motion.div
              key="result"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <BuildResult result={result} onRegenerate={handleRetry} busy={busy} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </BuilderWorkspaceFrame>
  );
}
