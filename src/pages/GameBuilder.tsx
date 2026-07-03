import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Gamepad2, Sparkles, Wand2, Copy, Check, Loader2, AlertTriangle,
  Boxes, ArrowRight, Info, RotateCcw, Rocket, ShieldCheck,
} from 'lucide-react';
import BuilderWorkspaceFrame from '@/components/builder/BuilderWorkspaceFrame';
import MarkdownMessage from '@/components/MarkdownMessage';
import {
  ENGINE_ORDER, EXAMPLE_PROMPTS, GAME_ENGINES, generateGameBuild, GameBuildError,
  type GameBuildResult, type GameEngine,
} from '@/lib/gameBuilderApi';

const ACCENT = '#8B5CF6';
const ACCENT_2 = '#A78BFA';

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { delay, duration: 0.45, ease: 'easeOut' as const },
});

type Phase = 'idle' | 'loading' | 'result' | 'error';

/* ─── Engine selector ──────────────────────────────────────────────────── */

function EngineCard({
  engine, selected, onSelect, disabled,
}: {
  engine: GameEngine;
  selected: boolean;
  onSelect: (e: GameEngine) => void;
  disabled: boolean;
}) {
  const meta = GAME_ENGINES[engine];
  return (
    <button
      type="button"
      onClick={() => onSelect(engine)}
      disabled={disabled}
      aria-pressed={selected}
      className={[
        'group relative flex-1 min-w-[180px] text-left rounded-2xl border px-4 py-4 transition-all duration-200',
        disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer',
        selected
          ? 'bg-white/[0.04] border-transparent shadow-[0_0_0_1px_rgba(139,92,246,0.55),0_8px_30px_-12px_rgba(139,92,246,0.5)]'
          : 'bg-white/[0.015] border-white/[0.06] hover:bg-white/[0.03] hover:border-white/[0.1]',
      ].join(' ')}
      style={selected ? { background: `linear-gradient(180deg, ${ACCENT}14, transparent)` } : undefined}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className={`text-[14px] font-semibold ${selected ? 'text-white' : 'text-slate-200'}`}>
          {meta.label}
        </span>
        <span
          className="shrink-0 px-1.5 py-0.5 rounded-md text-[10px] font-medium tracking-wide"
          style={{ background: `${ACCENT}1a`, color: ACCENT_2 }}
        >
          {meta.stack}
        </span>
      </div>
      <p className="text-[12px] leading-relaxed text-[#94A3B8]">{meta.tagline}</p>
      {selected && (
        <span
          className="absolute top-3 right-3 flex h-4 w-4 items-center justify-center rounded-full"
          style={{ background: ACCENT }}
        >
          <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />
        </span>
      )}
    </button>
  );
}

/* ─── Result toolbar ───────────────────────────────────────────────────── */

function ResultToolbar({
  result, onRegenerate, busy,
}: {
  result: GameBuildResult;
  onRegenerate: () => void;
  busy: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const engineMeta = GAME_ENGINES[result.engine];

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
    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
      <div className="flex items-center gap-2 min-w-0">
        <span
          className="flex h-7 w-7 items-center justify-center rounded-lg shrink-0"
          style={{ background: `${ACCENT}1a`, border: `1px solid ${ACCENT}33` }}
        >
          <Boxes className="h-3.5 w-3.5" style={{ color: ACCENT_2 }} />
        </span>
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-white truncate">
            {engineMeta.label} build package
          </p>
          <p className="text-[11px] text-[#64748B] truncate">
            {result.engine === 'auto' ? 'Engine auto-detected · ' : ''}
            Copy/export-ready · {result.model}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={handleCopyAll}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium text-slate-200 bg-white/[0.03] border border-white/[0.07] hover:bg-white/[0.06] transition-colors"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copied' : 'Copy all'}
        </button>
        <button
          onClick={onRegenerate}
          disabled={busy}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium text-slate-200 bg-white/[0.03] border border-white/[0.07] hover:bg-white/[0.06] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Regenerate
        </button>
      </div>
    </div>
  );
}

/* ─── Loading state ────────────────────────────────────────────────────── */

const LOADING_STEPS = [
  'Reading your idea and locking the target engine…',
  'Designing the core gameplay loop and systems…',
  'Structuring services, folders, classes and components…',
  'Writing engine-ready code and placement instructions…',
  'Assembling the setup steps and upgrade pass…',
];

function LoadingState({ engine }: { engine: GameEngine }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep((s) => (s + 1) % LOADING_STEPS.length), 2200);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.012] p-8 sm:p-10">
      <div className="flex items-center gap-3 mb-5">
        <span
          className="flex h-9 w-9 items-center justify-center rounded-xl"
          style={{ background: `${ACCENT}18`, border: `1px solid ${ACCENT}30` }}
        >
          <Loader2 className="h-4.5 w-4.5 animate-spin" style={{ color: ACCENT_2 }} />
        </span>
        <div>
          <p className="text-[14px] font-semibold text-white">
            Building your {GAME_ENGINES[engine].label} package
          </p>
          <AnimatePresence mode="wait">
            <motion.p
              key={step}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.3 }}
              className="text-[12px] text-[#94A3B8]"
            >
              {LOADING_STEPS[step]}
            </motion.p>
          </AnimatePresence>
        </div>
      </div>
      <div className="space-y-2.5">
        {[92, 78, 85, 64, 88, 72].map((w, i) => (
          <div
            key={i}
            className="h-3 rounded-full bg-white/[0.04] overflow-hidden relative"
            style={{ width: `${w}%` }}
          >
            <motion.div
              className="absolute inset-0"
              style={{ background: `linear-gradient(90deg, transparent, ${ACCENT}22, transparent)` }}
              animate={{ x: ['-100%', '100%'] }}
              transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.12, ease: 'easeInOut' }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Error state ──────────────────────────────────────────────────────── */

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-2xl border border-rose-500/20 bg-rose-500/[0.04] p-8 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-500/10 border border-rose-500/20">
        <AlertTriangle className="h-5 w-5 text-rose-400" />
      </div>
      <h3 className="text-[15px] font-semibold text-white mb-1.5">Generation failed</h3>
      <p className="text-[12.5px] text-[#94A3B8] leading-relaxed max-w-md mx-auto mb-5">{message}</p>
      <button
        onClick={onRetry}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-medium text-white transition-transform hover:scale-[1.02]"
        style={{ background: `linear-gradient(135deg, ${ACCENT}, ${ACCENT_2})` }}
      >
        <RotateCcw className="h-4 w-4" />
        Try again
      </button>
    </div>
  );
}

/* ─── Empty state ──────────────────────────────────────────────────────── */

function EmptyState() {
  const highlights = [
    { icon: Boxes, label: 'Architecture', desc: 'Services, folders, classes & components mapped out' },
    { icon: Wand2, label: 'Real code', desc: 'Luau or Blueprint/C++ you can paste straight in' },
    { icon: Rocket, label: 'Setup steps', desc: 'Exact placement, then a concrete upgrade pass' },
  ];
  return (
    <div className="rounded-2xl border border-white/[0.05] bg-white/[0.012] p-8 sm:p-10 text-center">
      <div
        className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl"
        style={{ background: `${ACCENT}14`, border: `1px solid ${ACCENT}2e` }}
      >
        <Gamepad2 className="h-6 w-6" style={{ color: ACCENT_2 }} />
      </div>
      <h3 className="text-[16px] font-semibold text-white mb-2">Describe the game you want to build</h3>
      <p className="text-[12.5px] text-[#94A3B8] leading-relaxed max-w-lg mx-auto mb-7">
        Pick an engine, write your idea, and Korvix returns a complete, structured build package —
        gameplay loop, architecture, engine-ready scripts, exact file placement, and a next upgrade pass.
      </p>
      <div className="grid sm:grid-cols-3 gap-3 max-w-2xl mx-auto text-left">
        {highlights.map(({ icon: Icon, label, desc }) => (
          <div key={label} className="rounded-xl border border-white/[0.05] bg-white/[0.015] p-4">
            <Icon className="h-4 w-4 mb-2" style={{ color: ACCENT_2 }} />
            <p className="text-[12.5px] font-semibold text-slate-200 mb-1">{label}</p>
            <p className="text-[11px] text-[#64748B] leading-relaxed">{desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Page ─────────────────────────────────────────────────────────────── */

export default function GameBuilder() {
  const [engine, setEngine] = useState<GameEngine>('auto');
  const [idea, setIdea] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<GameBuildResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  // Track the engine/idea the current result was generated for, so the
  // header/regenerate always reflect what was actually built.
  const lastRequestRef = useRef<{ engine: GameEngine; idea: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Abort any in-flight request on unmount.
  useEffect(() => () => abortRef.current?.abort(), []);

  const busy = phase === 'loading';
  const examples = useMemo(() => EXAMPLE_PROMPTS[engine], [engine]);

  const run = useCallback(async (targetEngine: GameEngine, targetIdea: string) => {
    const trimmed = targetIdea.trim();
    if (!trimmed || busy) return;

    // Cancel a prior in-flight generation before starting a new one.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    lastRequestRef.current = { engine: targetEngine, idea: trimmed };
    setPhase('loading');
    setErrorMsg('');
    setResult(null);

    try {
      const res = await generateGameBuild(targetEngine, trimmed, controller.signal);
      // Ignore a result whose request was superseded by a newer one.
      if (abortRef.current !== controller) return;
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

  const handleGenerate = () => run(engine, idea);
  const handleRegenerate = () => {
    const last = lastRequestRef.current;
    if (last) run(last.engine, last.idea);
  };
  const handleRetry = () => {
    const last = lastRequestRef.current;
    if (last) run(last.engine, last.idea);
    else run(engine, idea);
  };

  const canGenerate = idea.trim().length > 0 && !busy;

  return (
    <BuilderWorkspaceFrame
      icon={<Gamepad2 className="h-4 w-4" style={{ color: ACCENT_2 }} />}
      title="Game Development"
      subtitle="Describe a game idea, pick an engine, and Korvix generates an engine-ready build package for Roblox Studio or Unreal Engine 5"
      accent={ACCENT}
      maxWidth="max-w-5xl"
    >
      {/* Honesty banner — no fake editor automation. */}
      <motion.div
        {...fadeUp(0.04)}
        className="mb-6 flex items-start gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.015] px-4 py-3"
      >
        <Info className="h-4 w-4 mt-0.5 shrink-0" style={{ color: ACCENT_2 }} />
        <p className="text-[12px] text-[#94A3B8] leading-relaxed">
          Korvix generates <span className="text-slate-300 font-medium">copy/export-ready</span> code, scripts,
          architecture and exact placement instructions. It does <span className="text-slate-300 font-medium">not</span>{' '}
          connect to or write directly into Roblox Studio or Unreal Engine 5 — you paste the output into your editor.
          Direct editor integration is on the roadmap.
        </p>
      </motion.div>

      {/* Engine selector */}
      <motion.div {...fadeUp(0.08)} className="mb-5">
        <label className="text-[12px] font-medium text-[#94A3B8] mb-2.5 flex items-center gap-1.5">
          <Boxes className="h-3.5 w-3.5" style={{ color: ACCENT_2 }} />
          Target engine
        </label>
        <div className="flex flex-wrap gap-3">
          {ENGINE_ORDER.map((e) => (
            <EngineCard key={e} engine={e} selected={engine === e} onSelect={setEngine} disabled={busy} />
          ))}
        </div>
      </motion.div>

      {/* Prompt input */}
      <motion.div {...fadeUp(0.12)} className="mb-4">
        <label className="text-[12px] font-medium text-[#94A3B8] mb-2.5 flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5" style={{ color: ACCENT_2 }} />
          Your game idea
        </label>
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.018] focus-within:border-white/[0.14] transition-colors overflow-hidden">
          <textarea
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleGenerate();
            }}
            rows={4}
            placeholder={
              engine === 'unreal'
                ? 'e.g. Create a UE5 horror survival prototype with inventory, flashlight, AI enemy, and objective system.'
                : engine === 'roblox'
                  ? 'e.g. Create a Roblox tycoon game with pets, rebirths, upgrades, and monetization.'
                  : 'e.g. A co-op survival game where players gather resources, craft tools, and defend a base at night.'
            }
            disabled={busy}
            className="w-full resize-none bg-transparent px-4 py-3.5 text-[14px] text-slate-100 placeholder:text-[#5B6472] outline-none disabled:opacity-60"
          />
          <div className="flex items-center justify-between gap-3 px-3 py-2.5 border-t border-white/[0.05]">
            <span className="text-[11px] text-[#5B6472] hidden sm:block">
              ⌘/Ctrl + Enter to generate
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
                  Generating…
                </>
              ) : (
                <>
                  <Wand2 className="h-4 w-4" />
                  Generate build
                </>
              )}
            </button>
          </div>
        </div>
      </motion.div>

      {/* Example prompt chips */}
      <motion.div {...fadeUp(0.16)} className="mb-8">
        <p className="text-[11px] text-[#64748B] mb-2">Try an example</p>
        <div className="flex flex-wrap gap-2">
          {examples.map((ex) => (
            <button
              key={ex}
              onClick={() => setIdea(ex)}
              disabled={busy}
              className="group inline-flex items-center gap-1.5 max-w-full px-3 py-1.5 rounded-full text-[11.5px] text-[#94A3B8] bg-white/[0.02] border border-white/[0.05] hover:bg-white/[0.04] hover:text-slate-200 hover:border-white/[0.1] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="truncate">{ex}</span>
              <ArrowRight className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          ))}
        </div>
      </motion.div>

      {/* Output area */}
      <div className="min-h-[240px]">
        <AnimatePresence mode="wait">
          {phase === 'idle' && (
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <EmptyState />
            </motion.div>
          )}

          {phase === 'loading' && (
            <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <LoadingState engine={lastRequestRef.current?.engine ?? engine} />
            </motion.div>
          )}

          {phase === 'error' && (
            <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <ErrorState message={errorMsg} onRetry={handleRetry} />
            </motion.div>
          )}

          {phase === 'result' && result && (
            <motion.div
              key="result"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <ResultToolbar result={result} onRegenerate={handleRegenerate} busy={busy} />
              <div className="rounded-2xl border border-white/[0.06] bg-white/[0.012] p-5 sm:p-7">
                <MarkdownMessage content={result.reply} />
              </div>
              <div className="mt-4 flex items-center justify-center gap-2 text-[11px] text-[#5B6472]">
                <ShieldCheck className="h-3.5 w-3.5" style={{ color: ACCENT_2 }} />
                Server-authoritative patterns for Roblox · clean Blueprint/C++ split for UE5 · copy the code into your editor
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </BuilderWorkspaceFrame>
  );
}
