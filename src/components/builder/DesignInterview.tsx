// DesignInterview — the chat-native "Design Brief" step.
//
// Replaces the old DesignBriefPanel floating card entirely. This renders
// INLINE, as part of the conversation/content flow — never a fixed/
// positioned overlay. Korvix asks one short question at a time as an
// assistant message (avatar + bubble), with the answer options as inline
// chips. Picking a chip collapses that question into a compact
// assistant-asked / user-answered exchange and advances to the next one —
// exactly like a real back-and-forth with a product builder (Kimi/Cursor/
// Creo AI), not a bureaucratic form.
//
// State machine: idle → asking_visual_style → asking_color → asking_layout
// → asking_density → confirm → building. "idle" is simply "not mounted"
// (the host only renders this component once it has a prompt to ask
// about); "building" is the host un-mounting this component the instant
// onBuild() fires and the real run/turn takes over.
//
// onBuild still receives a single enhanced-prompt string — the DESIGN_BRIEF
// block folded into it is parsed back out for display by
// parseVisiblePrompt() wherever the prompt text is shown to the user.
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, Palette, Sparkles, Wand2, Zap } from 'lucide-react';
import {
  VISUAL_STYLES, COLOR_DIRECTIONS, LAYOUT_TYPES, DENSITIES,
  smartDefaultsFromPrompt, fillBriefDefaults, buildEnhancedPrompt, summarizeAnswers,
  type DesignBriefAnswers,
} from '@/lib/designBrief';

type CompactKey = 'visualStyle' | 'colorDirection' | 'layoutType' | 'density';
type CompactAnswers = Pick<DesignBriefAnswers, CompactKey>;

const STEPS: Array<{ key: CompactKey; question: string; assistant: string; options: readonly string[] }> = [
  {
    key: 'visualStyle', question: 'Visual style',
    assistant: "Before I build, let's lock the design direction. Which visual style fits best?",
    options: VISUAL_STYLES,
  },
  {
    key: 'colorDirection', question: 'Color direction',
    assistant: 'Nice. What color system should the prototype use?',
    options: COLOR_DIRECTIONS,
  },
  {
    key: 'layoutType', question: 'Layout',
    assistant: 'Should this be a landing page or a product dashboard?',
    options: LAYOUT_TYPES,
  },
  {
    key: 'density', question: 'Density',
    assistant: 'How dense should the interface feel?',
    options: DENSITIES,
  },
];

interface DesignInterviewProps {
  /** The user's original, untouched request — shown verbatim as the opening bubble. */
  prompt: string;
  onBuild: (enhancedPrompt: string) => void;
  /** Optional — lets the host dismiss the interview without building. */
  onCancel?: () => void;
  /** Hide the leading user-prompt bubble when the host already renders it. */
  showPromptBubble?: boolean;
  /** Fires after each step transition commits (question answered, back,
      jump-to-answer, confirm reached) so the host can keep the newest
      card anchored in its scroll viewport. */
  onAdvance?: (stepIndex: number) => void;
}

export default function DesignInterview({ prompt, onBuild, onCancel, showPromptBubble = true, onAdvance }: DesignInterviewProps) {
  const [stepIndex, setStepIndex] = useState(0); // 0..STEPS.length-1 = asking, STEPS.length = confirm
  const [answers, setAnswers] = useState<CompactAnswers>(() => smartDefaultsFromPrompt(prompt));

  useEffect(() => {
    setAnswers(smartDefaultsFromPrompt(prompt));
    setStepIndex(0);
  }, [prompt]);

  // Post-commit so the host measures the freshly-rendered step's height.
  useEffect(() => { onAdvance?.(stepIndex); }, [stepIndex, onAdvance]);

  const finish = (compact: CompactAnswers) => {
    const full = fillBriefDefaults(compact, prompt);
    onBuild(buildEnhancedPrompt(prompt, full));
  };

  const select = (key: CompactKey, value: string) => {
    setAnswers((prev) => ({ ...prev, [key]: value }));
    setStepIndex((i) => i + 1);
  };

  const back = () => setStepIndex((i) => Math.max(0, i - 1));
  const jumpTo = (key: CompactKey) => setStepIndex(STEPS.findIndex((s) => s.key === key));
  const skipAndBuild = () => finish(smartDefaultsFromPrompt(prompt));
  const useSmartDefaults = () => { setAnswers(smartDefaultsFromPrompt(prompt)); setStepIndex(STEPS.length); };
  const confirmBuild = () => finish(answers);

  const isConfirm = stepIndex >= STEPS.length;
  const answered = STEPS.slice(0, Math.min(stepIndex, STEPS.length));

  return (
    <div className="space-y-3.5">
      <div className="flex items-center gap-2 pb-1">
        <div className="flex h-6 w-6 items-center justify-center rounded-lg shrink-0" style={{ background: 'rgba(139, 92, 246,0.14)' }}>
          <Palette className="h-3 w-3 text-[#A78BFA]" />
        </div>
        <p className="text-[11px] font-medium tracking-wide text-white/45 uppercase">Design Brief</p>
        {!isConfirm && (
          <span className="ml-auto text-[10px] text-white/25">{stepIndex + 1} of {STEPS.length}</span>
        )}
      </div>

      {showPromptBubble && (
        <div className="flex justify-end">
          <div className="max-w-[80%] rounded-2xl rounded-br-sm px-3 py-2 text-[13px] text-white/85"
            style={{ background: 'rgba(139, 92, 246,0.08)', border: '1px solid rgba(139, 92, 246,0.12)' }}>
            {prompt}
          </div>
        </div>
      )}

      {answered.map((s) => (
        <AnsweredExchange key={s.key} question={s.assistant} answer={answers[s.key]} onEdit={() => jumpTo(s.key)} />
      ))}

      <AnimatePresence mode="wait">
        {!isConfirm ? (
          <motion.div
            key={STEPS[stepIndex].key}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            <AssistantBubble>
              <p className="text-[13px] text-white/85 leading-snug mb-2.5">{STEPS[stepIndex].assistant}</p>
              <div className="flex flex-wrap gap-1.5">
                {STEPS[stepIndex].options.map((opt) => (
                  <button
                    key={opt}
                    onClick={() => select(STEPS[stepIndex].key, opt)}
                    className="px-3 py-1.5 rounded-lg text-[12px] border transition-all bg-white/[0.02] border-white/[0.08] text-slate-300 hover:border-[#8B5CF6]/50 hover:text-white hover:bg-gradient-to-r hover:from-[#8B5CF6]/[0.15] hover:to-[#A78BFA]/[0.1]"
                  >
                    {opt}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3 mt-3 pt-2.5 border-t border-white/[0.05]">
                {stepIndex > 0 && (
                  <button onClick={back} className="flex items-center gap-1 text-[11px] text-[#858B99] hover:text-slate-300 transition-colors">
                    <ChevronLeft className="w-3 h-3" /> Back
                  </button>
                )}
                <button onClick={useSmartDefaults} className="text-[11px] text-[#B6BBC6] hover:text-slate-200 transition-colors">
                  Use smart defaults
                </button>
                <button onClick={skipAndBuild} className="flex items-center gap-1 text-[11px] text-[#A78BFA]/80 hover:text-[#A78BFA] transition-colors ml-auto">
                  <Zap className="w-3 h-3" /> Skip and build
                </button>
              </div>
            </AssistantBubble>
          </motion.div>
        ) : (
          <motion.div
            key="confirm"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            <AssistantBubble>
              <p className="text-[13px] text-white/85 mb-1">Perfect. I'll build it with this direction.</p>
              <p className="text-[12px] text-white/50 mb-3">
                Design direction locked: <span className="text-white/80 font-medium">{summarizeAnswers(fillBriefDefaults(answers, prompt))}</span>
              </p>
              <div className="flex flex-wrap gap-1.5 mb-3.5">
                {STEPS.map((s) => (
                  <button
                    key={s.key}
                    onClick={() => jumpTo(s.key)}
                    title={`Edit ${s.question.toLowerCase()}`}
                    className="px-2.5 py-1 rounded-md text-[11px] bg-white/[0.04] border border-white/[0.07] text-slate-300 hover:border-[#8B5CF6]/40 transition-colors"
                  >
                    {answers[s.key]}
                  </button>
                ))}
              </div>
              <button
                onClick={confirmBuild}
                className="flex items-center justify-center gap-2 w-full px-4 py-3 rounded-xl bg-gradient-to-r from-[#8B5CF6] to-[#A78BFA] text-black text-[13px] font-semibold hover:brightness-105 hover:-translate-y-px transition-all"
                style={{ boxShadow: '0 14px 34px -16px rgba(139, 92, 246,0.55)' }}
              >
                <Wand2 className="w-4 h-4" /> Build now
              </button>
              <button onClick={back} className="flex items-center gap-1 mx-auto mt-2 text-[11px] text-[#858B99] hover:text-slate-300 transition-colors">
                <ChevronLeft className="w-3 h-3" /> Edit answers
              </button>
            </AssistantBubble>
          </motion.div>
        )}
      </AnimatePresence>

      {onCancel && (
        <div className="flex justify-center">
          <button onClick={onCancel} className="text-[10px] text-white/25 hover:text-white/45 transition-colors">
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

function AssistantBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <div className="flex h-6 w-6 items-center justify-center rounded-full shrink-0 mt-0.5"
        style={{ background: 'linear-gradient(135deg, rgba(139, 92, 246,0.28), rgba(156, 187, 209,0.22))' }}>
        <Sparkles className="h-3 w-3 text-[#A78BFA]" />
      </div>
      <div className="max-w-[86%] rounded-2xl rounded-tl-sm px-3.5 py-3 flex-1"
        style={{ background: 'rgba(139, 92, 246,0.06)', border: '1px solid rgba(139, 92, 246,0.14)' }}>
        {children}
      </div>
    </div>
  );
}

function AnsweredExchange({ question, answer, onEdit }: { question: string; answer: string; onEdit: () => void }) {
  return (
    <div className="space-y-1.5">
      <AssistantBubble>
        <p className="text-[12px] text-white/45">{question}</p>
      </AssistantBubble>
      <div className="flex justify-end">
        <button
          onClick={onEdit}
          title="Edit this answer"
          className="max-w-[80%] rounded-2xl rounded-br-sm px-3 py-1.5 text-[12px] text-white/80 border transition-colors hover:border-[#8B5CF6]/40"
          style={{ background: 'rgba(139, 92, 246,0.08)', borderColor: 'rgba(139, 92, 246,0.14)' }}
        >
          {answer}
        </button>
      </div>
    </div>
  );
}
