import { CalendarCheck } from 'lucide-react';
import type { SprintDay } from '@/lib/startupRadarInsights';

/** Deterministic 7-day validation sprint generated from the top complaint
 * cluster + ICP. Rendered only when cluster evidence exists. */
export default function ValidationSprintPanel({ sprint }: { sprint: SprintDay[] }) {
  return (
    <div className="rounded-xl border border-white/[0.04] bg-white/[0.008] p-4">
      <div className="flex items-center gap-2 mb-3">
        <CalendarCheck className="h-3.5 w-3.5 text-emerald-400/70" />
        <h3 className="text-[12px] font-medium text-white">7-day validation sprint</h3>
      </div>
      <div className="space-y-2">
        {sprint.map((d) => (
          <div key={d.day} className="flex items-start gap-2.5">
            <div className="flex h-5 w-9 items-center justify-center rounded-md bg-white/[0.03] border border-white/[0.05] shrink-0 mt-0.5">
              <span className="text-[9px] font-medium text-slate-400">Day {d.day}</span>
            </div>
            <div className="min-w-0">
              <p className="text-[12px] font-medium text-white">{d.title}</p>
              <p className="text-[11px] text-slate-500 leading-relaxed mt-0.5">{d.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
