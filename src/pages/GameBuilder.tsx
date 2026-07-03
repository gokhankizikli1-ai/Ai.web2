import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Gamepad2, Wand2, Copy, Check, Loader2, AlertTriangle, RotateCcw,
} from 'lucide-react';
import BuilderWorkspaceFrame from '@/components/builder/BuilderWorkspaceFrame';
import MarkdownMessage from '@/components/MarkdownMessage';
import {
  ENGINE_ORDER, EXAMPLE_PROMPTS, GAME_ENGINES, generateGameBuild, GameBuildError,
  type GameBuildResult, type GameEngine,
} from '@/lib/gameBuilderApi';

// KorvixAI blue accent — same language as Chat / Tools / WorkspaceTabs.
const ACCENT = '#3B82F6';
const ACCENT_2 = '#60A5FA';

type Phase = 'idle' | 'loading' | 'result' | 'error';

/* ─── Engine pills (two choices, prompt-first — no Auto-detect) ─────────── */

function EnginePill({
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
        'inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[12.5px] font-medium transition-all',
        disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer',
        selected
          ? 'text-white'
          : 'text-[#94A3B8] border-white/[0.07] bg-white/[0.015] hover:text-[#CBD5E1] hover:border-white/[0.12]',
      ].join(' ')}
      style={selected
        ? { background: 'rgba(59,130,246,0.12)', borderColor: 'rgba(59,130,246,0.4)' }
        : undefined}
    >
      <Gamepad2 className="h-3.5 w-3.5" style={{ color: selected ? ACCENT_2 : undefined }} />
      {meta.label}
      <span
        className="text-[10px] font-normal px-1.5 py-0.5 rounded-md"
        style={selected
          ? { background: 'rgba(96,165,250,0.15)', color: ACCENT_2 }
          : { background: 'rgba(255,255,255,0.04)', color: '#64748B' }}
      >
        {meta.stack}
      </span>
    </button>
  );
}

/* ─── Result toolbar (compact) ─────────────────────────────────────────── */

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
    <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
      <div className="flex items-center gap-2 min-w-0">
        <Gamepad2 className="h-3.5 w-3.5 shrink-0" style={{ color: ACCENT_2 }} />
        <p className="text-[12px] text-[#94A3B8] truncate">
          <span className="text-slate-200 font-medium">{engineMeta.label}</span> build · copy-ready
        </p>
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
  );
}

/* ─── Page ─────────────────────────────────────────────────────────────── */

export default function GameBuilder() {
  const [engine, setEngine] = useState<GameEngine>('roblox');
  const [idea, setIdea] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<GameBuildResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const lastRequestRef = useRef<{ engine: GameEngine; idea: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

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

  const handleGenerate = () => run(engine, idea);
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
      subtitle="Describe the game you want. Korvix turns it into an engine-ready build package."
      accent={ACCENT}
      maxWidth="max-w-3xl"
    >
      {/* Engine selector — two pills, prompt-first */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {ENGINE_ORDER.map((e) => (
          <EnginePill key={e} engine={e} selected={engine === e} onSelect={setEngine} disabled={busy} />
        ))}
      </div>

      {/* Prompt composer */}
      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.018] focus-within:border-white/[0.14] transition-colors overflow-hidden">
        <textarea
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleGenerate();
          }}
          rows={5}
          placeholder={
            engine === 'unreal'
              ? 'e.g. A UE5 third-person melee action prototype with a lock-on camera, health, enemy AI, and a basic HUD.'
              : 'e.g. A Roblox first-person horror where you explore an abandoned school with a flashlight, an AI enemy, quests, checkpoints, and jumpscares.'
          }
          disabled={busy}
          className="w-full resize-none bg-transparent px-4 py-3.5 text-[14px] leading-relaxed text-slate-100 placeholder:text-[#5B6472] outline-none disabled:opacity-60"
        />
        <div className="flex items-center justify-between gap-3 px-3 py-2.5 border-t border-white/[0.05]">
          <span className="text-[11px] text-[#5B6472] hidden sm:block">
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

      {/* Examples (max 2) + honesty note */}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-[#5B6472]">Try:</span>
        {examples.map((ex) => (
          <button
            key={ex}
            onClick={() => setIdea(ex)}
            disabled={busy}
            className="max-w-full truncate px-2.5 py-1 rounded-full text-[11px] text-[#94A3B8] bg-white/[0.02] border border-white/[0.05] hover:bg-white/[0.04] hover:text-slate-200 hover:border-white/[0.1] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            title={ex}
          >
            {ex}
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
                Reading your prompt and assembling the {GAME_ENGINES[lastRequestRef.current?.engine ?? engine].label} build package…
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
              <ResultToolbar result={result} onRegenerate={handleRetry} busy={busy} />
              <div className="rounded-2xl border border-white/[0.06] bg-white/[0.012] p-5 sm:p-6">
                <MarkdownMessage content={result.reply} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </BuilderWorkspaceFrame>
  );
}
