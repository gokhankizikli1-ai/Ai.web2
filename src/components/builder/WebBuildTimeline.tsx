import { motion } from 'framer-motion';
import {
  Check, Loader2, AlertTriangle, FileSearch, LayoutGrid,
  Palette, PenLine, Code2, Monitor, Sparkles,
} from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';

/**
 * Active builder timeline for Web Build. The backend /chat call is a single
 * non-streaming request, so the page advances these stages on a timer while
 * the request is in flight, then completes them when the real result lands
 * (enriching stages with real detail — detected type, section list, …). It
 * makes the generation feel like an agent doing work rather than a spinner.
 */
export type StageStatus = 'waiting' | 'active' | 'done' | 'error';

export interface StageDef {
  id: string;
  labelKey: string;
  descKey: string;
  icon: typeof Check;
}

/** The canonical build stages, in order. */
export const WEB_BUILD_STAGES: StageDef[] = [
  { id: 'brief',   labelKey: 'wbStageBrief',   descKey: 'wbStageBriefDesc',   icon: FileSearch },
  { id: 'type',    labelKey: 'wbStageType',    descKey: 'wbStageTypeDesc',    icon: LayoutGrid },
  { id: 'plan',    labelKey: 'wbStagePlan',    descKey: 'wbStagePlanDesc',    icon: LayoutGrid },
  { id: 'design',  labelKey: 'wbStageDesign',  descKey: 'wbStageDesignDesc',  icon: Palette },
  { id: 'copy',    labelKey: 'wbStageCopy',    descKey: 'wbStageCopyDesc',    icon: PenLine },
  { id: 'code',    labelKey: 'wbStageCode',    descKey: 'wbStageCodeDesc',    icon: Code2 },
  { id: 'preview', labelKey: 'wbStagePreview', descKey: 'wbStagePreviewDesc', icon: Monitor },
  { id: 'ready',   labelKey: 'wbStageReady',   descKey: 'wbStageReadyDesc',   icon: Sparkles },
];

const ACCENT = '#60A5FA';

interface WebBuildTimelineProps {
  /** stage id → status. Missing ids default to 'waiting'. */
  statuses: Record<string, StageStatus>;
  /** stage id → real detail text that overrides the generic description. */
  details?: Record<string, string>;
}

export default function WebBuildTimeline({ statuses, details }: WebBuildTimelineProps) {
  const { t } = useLanguageStore();

  return (
    <div className="space-y-1">
      {WEB_BUILD_STAGES.map((stage, i) => {
        const status = statuses[stage.id] || 'waiting';
        const detail = details?.[stage.id] || t(stage.descKey);
        const done = status === 'done';
        const active = status === 'active';
        const error = status === 'error';

        return (
          <motion.div
            key={stage.id}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.03 }}
            className={`flex items-start gap-3 rounded-lg px-3 py-2 transition-colors ${
              active ? 'bg-white/[0.03]' : ''
            }`}
          >
            {/* Status icon */}
            <div className="mt-0.5 shrink-0">
              {done ? (
                <div className="flex h-5 w-5 items-center justify-center rounded-full" style={{ background: `${ACCENT}22` }}>
                  <Check className="h-3 w-3" style={{ color: ACCENT }} />
                </div>
              ) : active ? (
                <div className="flex h-5 w-5 items-center justify-center rounded-full" style={{ background: `${ACCENT}18` }}>
                  <Loader2 className="h-3 w-3 animate-spin" style={{ color: ACCENT }} />
                </div>
              ) : error ? (
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[#F87171]/15">
                  <AlertTriangle className="h-3 w-3 text-[#F87171]" />
                </div>
              ) : (
                <div className="flex h-5 w-5 items-center justify-center rounded-full border border-white/[0.08]">
                  <stage.icon className="h-2.5 w-2.5 text-[#64748B]" />
                </div>
              )}
            </div>

            {/* Label + detail */}
            <div className="min-w-0 flex-1">
              <div className={`text-[12px] font-medium leading-tight ${
                done || active ? 'text-slate-100' : error ? 'text-[#F87171]' : 'text-[#64748B]'
              }`}>
                {t(stage.labelKey)}
              </div>
              {(active || done) && (
                <div className="text-[11px] text-[#94A3B8] leading-snug mt-0.5">{detail}</div>
              )}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
