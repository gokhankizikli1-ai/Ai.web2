// DesignBriefPanel — "Before I build, pick the design direction."
//
// A compact, step-by-step design-brief card (NOT a full desktop modal):
// one short question at a time (visual style → color → layout → density),
// auto-advancing on tap, with a final compact confirmation summary. Lives
// anchored near the composer — a transparent click-catcher behind it
// dismisses on outside click, but there's no dark full-screen backdrop, so
// it never feels like it's blocking the page.
//
// onConfirm still receives a single enhanced-prompt string (unchanged
// contract from callers) — the DESIGN_BRIEF block folded into it is
// parsed back out for display by parseVisiblePrompt() wherever the prompt
// text is shown to the user (see ProjectRunCenter's ConversationTurn).
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, Sparkles, Wand2, X, Zap } from 'lucide-react';
import {
  VISUAL_STYLES, COLOR_DIRECTIONS, LAYOUT_TYPES, DENSITIES,
  smartDefaultsFromPrompt, fillBriefDefaults, buildEnhancedPrompt, summarizeAnswers,
  type DesignBriefAnswers,
} from '@/lib/designBrief';

type CompactAnswers = Pick<DesignBriefAnswers, 'visualStyle' | 'colorDirection' | 'layoutType' | 'density'>;

const STEPS = [
  { key: 'visualStyle' as const, question: 'Visual style', options: VISUAL_STYLES },
  { key: 'colorDirection' as const, question: 'Color direction', options: COLOR_DIRECTIONS },
  { key: 'layoutType' as const, question: 'Layout', options: LAYOUT_TYPES },
  { key: 'density' as const, question: 'Density / detail', options: DENSITIES },
];

interface DesignBriefPanelProps {
  open: boolean;
  initialPrompt: string;
  onCancel: () => void;
  onConfirm: (enhancedPrompt: string) => void;
}

export default function DesignBriefPanel({ open, initialPrompt, onCancel, onConfirm }: DesignBriefPanelProps) {
  const [stepIndex, setStepIndex] = useState(0); // 0..STEPS.length-1, STEPS.length = confirm screen
  const [answers, setAnswers] = useState<CompactAnswers>(() => smartDefaultsFromPrompt(initialPrompt));

  useEffect(() => {
    if (open) {
      setAnswers(smartDefaultsFromPrompt(initialPrompt));
      setStepIndex(0);
    }
  }, [open, initialPrompt]);

  if (!open) return null;

  const finish = (compact: CompactAnswers) => {
    const full = fillBriefDefaults(compact, initialPrompt);
    onConfirm(buildEnhancedPrompt(initialPrompt, full));
  };

  const select = (key: typeof STEPS[number]['key'], value: string) => {
    const next = { ...answers, [key]: value };
    setAnswers(next);
    setStepIndex((i) => i + 1);
  };

  const back = () => setStepIndex((i) => Math.max(0, i - 1));
  const jumpTo = (key: typeof STEPS[number]['key']) => setStepIndex(STEPS.findIndex((s) => s.key === key));

  // Fast path — zero further taps, build immediately with smart defaults.
  const skipAndBuild = () => finish(smartDefaultsFromPrompt(initialPrompt));
  // Secondary path — fills smart defaults but still shows the compact
  // confirm screen, so the user gets one last look before building.
  const useSmartDefaults = () => {
    setAnswers(smartDefaultsFromPrompt(initialPrompt));
    setStepIndex(STEPS.length);
  };
  const confirm = () => finish(answers);

  const isConfirm = stepIndex >= STEPS.length;
  const current = STEPS[stepIndex];

  return (
    <>
      {/* Transparent click-catcher — dismisses on outside click, no dark
          backdrop, so the page never feels blocked. */}
      <div className="fixed inset-0 z-[99]" onClick={onCancel} />

      <AnimatePresence mode="wait">
        <motion.div
          key="design-brief-card"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          onClick={(e) => e.stopPropagation()}
          className="fixed z-[100] inset-x-0 bottom-0 rounded-t-2xl w-full sm:inset-x-auto sm:left-1/2 sm:bottom-24 sm:-translate-x-1/2 sm:w-[380px] sm:rounded-2xl overflow-hidden shadow-2xl shadow-black/50"
          style={{ background: 'rgba(15,15,20,0.98)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <Sparkles className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
              <p className="text-[12px] font-medium text-white truncate">
                {isConfirm ? 'Build with this direction' : 'Before I build, pick the design direction'}
              </p>
            </div>
            <button onClick={onCancel} aria-label="Close" className="p-1 rounded-md text-slate-500 hover:text-slate-300 hover:bg-white/[0.06] transition-colors shrink-0">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Progress dots */}
          <div className="flex items-center gap-1.5 px-4 mb-3">
            {STEPS.map((s, i) => (
              <button
                key={s.key}
                onClick={() => jumpTo(s.key)}
                aria-label={`Go to ${s.question}`}
                className={`h-1 rounded-full transition-all ${
                  i === stepIndex && !isConfirm ? 'w-6 bg-indigo-400' : i < stepIndex || isConfirm ? 'w-3 bg-indigo-400/50' : 'w-3 bg-white/[0.08]'
                }`}
              />
            ))}
          </div>

          <AnimatePresence mode="wait">
            {!isConfirm ? (
              <motion.div
                key={current.key}
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.16 }}
                className="px-4 pb-4"
              >
                <p className="text-[11px] text-slate-500 mb-2.5">{current.question}</p>
                <div className="flex flex-wrap gap-1.5">
                  {current.options.map((opt) => (
                    <button
                      key={opt}
                      onClick={() => select(current.key, opt)}
                      className={`px-3 py-1.5 rounded-lg text-[12px] border transition-all ${
                        answers[current.key] === opt
                          ? 'bg-gradient-to-r from-indigo-500/25 to-cyan-400/20 border-indigo-400/50 text-white'
                          : 'bg-white/[0.02] border-white/[0.07] text-slate-400 hover:border-white/[0.16] hover:text-slate-200'
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="confirm"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.16 }}
                className="px-4 pb-4"
              >
                <p className="text-[13px] text-white font-medium mb-3">{summarizeAnswers(fillBriefDefaults(answers, initialPrompt))}</p>
                <div className="flex flex-wrap gap-1.5 mb-3.5">
                  {STEPS.map((s) => (
                    <button
                      key={s.key}
                      onClick={() => jumpTo(s.key)}
                      title="Edit"
                      className="px-2.5 py-1 rounded-md text-[11px] bg-white/[0.04] border border-white/[0.07] text-slate-300 hover:border-indigo-400/40 transition-colors"
                    >
                      {answers[s.key]}
                    </button>
                  ))}
                </div>
                <button
                  onClick={confirm}
                  className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-cyan-400 text-black text-[13px] font-semibold hover:brightness-105 transition-all"
                >
                  <Wand2 className="w-4 h-4" /> Build with this direction
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Footer controls */}
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-white/[0.06] bg-white/[0.015]">
            <button
              onClick={back}
              disabled={stepIndex === 0}
              className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-300 disabled:opacity-0 transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" /> Back
            </button>
            <div className="flex items-center gap-3">
              <button onClick={useSmartDefaults} className="text-[11px] text-slate-400 hover:text-slate-200 transition-colors">
                Use smart defaults
              </button>
              <button onClick={skipAndBuild} className="flex items-center gap-1 text-[11px] text-cyan-400/80 hover:text-cyan-300 transition-colors">
                <Zap className="w-3 h-3" /> Skip &amp; build
              </button>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </>
  );
}
