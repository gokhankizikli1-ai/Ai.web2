// DesignBriefPanel — "Before I build this, let's shape the design
// direction." Shown before Korvix starts a generation run when the
// prompt doesn't already carry enough design detail. Confirming (either
// with hand-picked chips or "Use smart defaults") folds the answers into
// the SAME prompt string the caller already sends through the existing
// run/orchestrator — no new backend route, no new payload shape.
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Sparkles, Wand2, X } from 'lucide-react';
import {
  VISUAL_STYLES, COLOR_DIRECTIONS, LAYOUT_TYPES, BUTTON_STYLES,
  DENSITIES, TARGET_FEELS, SECTION_OPTIONS,
  smartDefaultsFromPrompt, buildEnhancedPrompt,
  type DesignBriefAnswers,
} from '@/lib/designBrief';

interface DesignBriefPanelProps {
  open: boolean;
  initialPrompt: string;
  onCancel: () => void;
  onConfirm: (enhancedPrompt: string) => void;
}

export default function DesignBriefPanel({ open, initialPrompt, onCancel, onConfirm }: DesignBriefPanelProps) {
  const [answers, setAnswers] = useState<DesignBriefAnswers>(() => smartDefaultsFromPrompt(initialPrompt));

  useEffect(() => {
    if (open) setAnswers(smartDefaultsFromPrompt(initialPrompt));
  }, [open, initialPrompt]);

  if (!open) return null;

  const set = <K extends keyof DesignBriefAnswers>(key: K, value: DesignBriefAnswers[K]) =>
    setAnswers((a) => ({ ...a, [key]: value }));

  const confirm = () => onConfirm(buildEnhancedPrompt(initialPrompt, answers));
  const useSmartDefaults = () => onConfirm(buildEnhancedPrompt(initialPrompt, smartDefaultsFromPrompt(initialPrompt)));

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-center justify-center p-4"
        style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)' }}
        onClick={onCancel}
      >
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-2xl max-h-[86vh] flex flex-col rounded-2xl overflow-hidden shadow-2xl shadow-black/50"
          style={{ background: 'rgba(13,13,18,0.98)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-3 px-6 py-5 border-b border-white/[0.06]">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="w-4 h-4 text-indigo-400 shrink-0" />
                <h2 className="text-[16px] font-semibold text-white truncate">Shape the design before build</h2>
              </div>
              <p className="text-[12px] text-slate-500">
                Before I build this, let's set the design direction — pick a few options or use smart defaults.
              </p>
            </div>
            <button
              onClick={onCancel}
              aria-label="Close"
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-white/[0.05] transition-colors shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            <ChipGroup label="Visual style" options={VISUAL_STYLES} value={answers.visualStyle} onChange={(v) => set('visualStyle', v)} />
            <ChipGroup label="Color direction" options={COLOR_DIRECTIONS} value={answers.colorDirection} onChange={(v) => set('colorDirection', v)} />
            <ChipGroup label="Layout type" options={LAYOUT_TYPES} value={answers.layoutType} onChange={(v) => set('layoutType', v)} />
            <ChipGroup label="Button style" options={BUTTON_STYLES} value={answers.buttonStyle} onChange={(v) => set('buttonStyle', v)} />
            <ChipGroup label="Density" options={DENSITIES} value={answers.density} onChange={(v) => set('density', v)} />
            <ChipGroup label="Target feel" options={TARGET_FEELS} value={answers.targetFeel} onChange={(v) => set('targetFeel', v)} />
            <ChipGroup
              label="Pages / sections (optional — pick any that apply)"
              options={SECTION_OPTIONS}
              value={answers.sections}
              onChange={(v) => set('sections', v)}
              multi
              last
            />
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-white/[0.06] bg-white/[0.015]">
            <button
              onClick={useSmartDefaults}
              className="text-[12px] text-slate-400 hover:text-slate-200 transition-colors"
            >
              Use smart defaults
            </button>
            <button
              onClick={confirm}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-cyan-400 text-black text-[13px] font-semibold hover:brightness-105 transition-all"
            >
              <Wand2 className="w-4 h-4" /> Build with this direction
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function ChipGroup<T extends string | string[]>({
  label, options, value, onChange, multi, last,
}: {
  label: string;
  options: readonly string[];
  value: T;
  onChange: (v: T) => void;
  multi?: boolean;
  last?: boolean;
}) {
  const isSelected = (opt: string) => (multi ? (value as unknown as string[]).includes(opt) : value === opt);
  const toggle = (opt: string) => {
    if (multi) {
      const arr = value as unknown as string[];
      const next = arr.includes(opt) ? arr.filter((o) => o !== opt) : [...arr, opt];
      onChange(next as unknown as T);
    } else {
      onChange(opt as unknown as T);
    }
  };
  return (
    <div className={last ? '' : 'mb-5'}>
      <p className="text-[11px] font-medium text-slate-400 mb-2">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const selected = isSelected(opt);
          return (
            <button
              key={opt}
              type="button"
              onClick={() => toggle(opt)}
              className={`px-3 py-1.5 rounded-lg text-[12px] border transition-all ${
                selected
                  ? 'bg-gradient-to-r from-indigo-500/25 to-cyan-400/20 border-indigo-400/50 text-white'
                  : 'bg-white/[0.02] border-white/[0.06] text-slate-400 hover:border-white/[0.15] hover:text-slate-200'
              }`}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}
