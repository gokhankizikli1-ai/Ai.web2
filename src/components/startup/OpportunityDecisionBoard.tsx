import { AlertTriangle, ArrowRight, Compass, Hammer, Scale, XCircle } from 'lucide-react';
import type { RadarDecision, DecisionBucket } from '@/lib/startupRadarInsights';

const BUCKETS: { id: DecisionBucket; label: string; icon: typeof Hammer; activeTone: string }[] = [
  { id: 'build', label: 'Build now', icon: Hammer, activeTone: 'bg-emerald-500/[0.08] border-emerald-500/30 text-emerald-200' },
  { id: 'validate', label: 'Validate first', icon: Scale, activeTone: 'bg-amber-500/[0.08] border-amber-500/30 text-amber-200' },
  { id: 'avoid', label: 'Avoid / risky', icon: XCircle, activeTone: 'bg-rose-500/[0.08] border-rose-500/30 text-rose-200' },
];

/** Founder decision derived deterministically from the report's observed
 * scores/clusters (see deriveDecision) — the active bucket is highlighted,
 * with the reason, next action, and riskiest assumption spelled out. */
export default function OpportunityDecisionBoard({ decision }: { decision: RadarDecision }) {
  return (
    <div className="rounded-xl border border-white/[0.04] bg-white/[0.008] p-4">
      <div className="flex items-center gap-2 mb-3">
        <Compass className="h-3.5 w-3.5 text-amber-400/70" />
        <h3 className="text-[12px] font-medium text-white">Opportunity decision</h3>
      </div>

      {/* Buckets */}
      <div className="grid grid-cols-3 gap-2">
        {BUCKETS.map((b) => {
          const active = decision.bucket === b.id;
          return (
            <div
              key={b.id}
              className={`flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-[11px] font-medium transition-colors ${
                active ? b.activeTone : 'border-white/[0.03] bg-white/[0.005] text-slate-700'
              }`}
            >
              <b.icon className="h-3 w-3 shrink-0" />
              <span className="truncate">{b.label}</span>
            </div>
          );
        })}
      </div>

      {/* Detail */}
      <div className="mt-3 space-y-2">
        <p className="text-[12px] text-slate-400 leading-relaxed">{decision.reason}</p>
        <div className="flex items-start gap-2 rounded-lg bg-white/[0.01] border border-white/[0.03] px-2.5 py-2">
          <ArrowRight className="h-3 w-3 text-slate-500 shrink-0 mt-0.5" />
          <p className="text-[11px] text-slate-400 leading-relaxed">
            <span className="text-slate-300 font-medium">Next action: </span>
            {decision.nextAction}
          </p>
        </div>
        <div className="flex items-start gap-2 rounded-lg bg-white/[0.01] border border-white/[0.03] px-2.5 py-2">
          <AlertTriangle className="h-3 w-3 text-amber-400/60 shrink-0 mt-0.5" />
          <p className="text-[11px] text-slate-400 leading-relaxed">
            <span className="text-slate-300 font-medium">Riskiest assumption: </span>
            {decision.riskiestAssumption}
          </p>
        </div>
      </div>
    </div>
  );
}
