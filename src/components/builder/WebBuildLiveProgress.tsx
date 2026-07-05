import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useLanguageStore } from '@/stores/languageStore';

/**
 * Live agent progress shown WHILE the (non-streaming) backend call is in flight.
 *
 * Instead of a single static "Thinking…" line — which made users unsure whether
 * the build had stalled — this walks through the real upstream stages (reading
 * the brief, extracting the goal, synthesizing research, defining the visual
 * mood, planning the CTA hierarchy, creating the page blueprint, preparing the
 * preview). The current stage animates; finished stages settle with a check.
 *
 * These are honest LOCAL stage labels for work that genuinely happens (brief
 * parsing, strategy inference, design-system + layout-plan derivation). They do
 * NOT claim web research — the completed Research Agent row reports the real
 * research status once the build returns.
 */
interface Group { id: string; nameKey: string; stages: string[] }

const GROUPS: Group[] = [
  { id: 'research', nameKey: 'wbAgentResearch', stages: ['wbStageReadBrief', 'wbStageExtractGoal', 'wbStageResearch'] },
  { id: 'ui_art_director', nameKey: 'wbAgentArt', stages: ['wbStageVisualMood', 'wbStageTypography'] },
  { id: 'strategy', nameKey: 'wbAgentStrategy', stages: ['wbStageCta'] },
  { id: 'layout_architect', nameKey: 'wbAgentLayout', stages: ['wbStageBlueprint', 'wbStageHero', 'wbStageRhythm'] },
  { id: 'preview', nameKey: 'wbStagePreview', stages: ['wbStagePreview'] },
];

const FLAT = GROUPS.flatMap((g, gi) => g.stages.map((stage) => ({ gi, stage })));
const STEP_MS = 1100;

function Spinner() {
  return (
    <motion.span
      aria-hidden
      className="inline-block h-3.5 w-3.5 rounded-full border-[1.5px] border-white/15"
      style={{ borderTopColor: 'var(--kx-accent, #6366f1)' }}
      animate={{ rotate: 360 }}
      transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
    />
  );
}

const Check = () => (
  <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5 text-emerald-400/80"><path d="M13 4.5 6.5 11 3 7.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

const Dot = () => <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-white/20" />;

export default function WebBuildLiveProgress() {
  const { t } = useLanguageStore();
  const [k, setK] = useState(0);

  useEffect(() => {
    setK(0);
    const id = setInterval(() => {
      setK((prev) => (prev < FLAT.length - 1 ? prev + 1 : prev));
    }, STEP_MS);
    return () => clearInterval(id);
  }, []);

  const currentGroup = FLAT[Math.min(k, FLAT.length - 1)]?.gi ?? 0;
  const currentStage = FLAT[Math.min(k, FLAT.length - 1)]?.stage;

  return (
    <div className="space-y-2">
      {GROUPS.map((g, gi) => {
        const state = gi < currentGroup ? 'done' : gi === currentGroup ? 'running' : 'pending';
        return (
          <div key={g.id} className={`flex items-center gap-2.5 text-[13px] ${state === 'pending' ? 'opacity-45' : ''}`}>
            <span className="flex h-4 w-4 items-center justify-center">
              {state === 'done' ? <Check /> : state === 'running' ? <Spinner /> : <Dot />}
            </span>
            <span className={state === 'pending' ? 'text-[#64748B]' : 'text-[#CBD5E1]'}>{t(g.nameKey)}</span>
            {state === 'running' && currentStage && currentStage !== g.nameKey && (
              <motion.span
                key={currentStage}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                className="text-[#64748B]"
              >
                · {t(currentStage)}
              </motion.span>
            )}
          </div>
        );
      })}
    </div>
  );
}
