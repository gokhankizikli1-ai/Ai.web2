import { useEffect, useMemo, useState } from 'react';
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

/* Fresh build — the four upstream agents run, then the preview is composed. */
const BUILD_GROUPS: Group[] = [
  { id: 'research', nameKey: 'wbAgentResearch', stages: ['wbStageReadBrief', 'wbStageExtractGoal', 'wbStageResearch'] },
  { id: 'ui_art_director', nameKey: 'wbAgentArt', stages: ['wbStageVisualMood', 'wbStageTypography'] },
  { id: 'strategy', nameKey: 'wbAgentStrategy', stages: ['wbStageCta'] },
  { id: 'layout_architect', nameKey: 'wbAgentLayout', stages: ['wbStageBlueprint', 'wbStageHero', 'wbStageRhythm'] },
  { id: 'component_engineer', nameKey: 'wbAgentComponent', stages: ['wbStageComponents'] },
  { id: 'preview', nameKey: 'wbStagePreview', stages: ['wbStagePreview'] },
];

/* Revision — a targeted change, not a full re-plan. Honest, shorter sequence. */
const REVISE_GROUPS: Group[] = [
  { id: 'revise', nameKey: 'wbAgentRevise', stages: ['wbStageReadBrief', 'wbStageReviseApply'] },
  { id: 'preview', nameKey: 'wbStagePreview', stages: ['wbStagePreview'] },
];

const STEP_MS = 1100;

/** A small pulsing orb that sits right next to the "Think" label. */
const PulseOrb = () => (
  <motion.span
    aria-hidden
    className="inline-block h-2 w-2 shrink-0 rounded-full"
    style={{ background: 'var(--kx-accent, #6366f1)' }}
    animate={{ scale: [1, 1.35, 1], opacity: [0.55, 1, 0.55] }}
    transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
  />
);

const Check = () => (
  <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 text-emerald-400/80"><path d="M13 4.5 6.5 11 3 7.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

export default function WebBuildLiveProgress({ kind = 'build' }: { kind?: 'build' | 'revision' }) {
  const { t } = useLanguageStore();
  const [k, setK] = useState(0);

  const groups = kind === 'revision' ? REVISE_GROUPS : BUILD_GROUPS;
  const flat = useMemo(
    () => groups.flatMap((g, gi) => g.stages.map((stage) => ({ gi, stage }))),
    [groups],
  );

  useEffect(() => {
    setK(0);
    const id = setInterval(() => {
      setK((prev) => (prev < flat.length - 1 ? prev + 1 : prev));
    }, STEP_MS);
    return () => clearInterval(id);
  }, [flat.length]);

  const currentGroup = flat[Math.min(k, flat.length - 1)]?.gi ?? 0;
  const currentStage = flat[Math.min(k, flat.length - 1)]?.stage;

  // Compact, sequential progress: completed agents settle as ✓ lines; the ONE
  // active agent shows a pulsing orb + "Think" and its current action. Future
  // agents are NOT listed (no static checklist, no reserved blank area).
  return (
    <div className="space-y-1.5">
      {groups.map((g, gi) => {
        if (gi > currentGroup) return null; // future agents stay hidden
        if (gi < currentGroup) {
          return (
            <div key={g.id} className="flex items-center gap-2 text-[12.5px] text-[#64748B]">
              <Check />
              <span>{t(g.nameKey)} {t('wbAgentCompleted')}</span>
            </div>
          );
        }
        // Active agent — pulsing orb + "Think", then the current action beneath it.
        return (
          <div key={g.id} className="space-y-0.5">
            <div className="flex items-center gap-2 text-[13px]">
              <PulseOrb />
              <span className="font-medium text-[#CBD5E1]">{t('wbThinkLabel')}</span>
            </div>
            {currentStage && (
              <motion.div
                key={currentStage}
                initial={{ opacity: 0, y: 2 }}
                animate={{ opacity: 1, y: 0 }}
                className="pl-4 text-[12.5px] leading-relaxed text-[#64748B]"
              >
                {t(g.nameKey)} · {t(currentStage)}
              </motion.div>
            )}
          </div>
        );
      })}
    </div>
  );
}
