import { useState } from 'react';
import { CalendarCheck, ChevronDown } from 'lucide-react';
import type { SprintDay } from '@/lib/startupRadarInsights';

const VISIBLE_BY_DEFAULT = 2;

/** Deterministic 7-day validation sprint generated from the top complaint
 * cluster + ICP. Days 1-2 show by default; the rest expands on demand. */
export default function ValidationSprintPanel({ sprint }: { sprint: SprintDay[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? sprint : sprint.slice(0, VISIBLE_BY_DEFAULT);

  return (
    <div className="rounded-xl border border-white/[0.05] bg-white/[0.01] p-4">
      <div className="flex items-center gap-2 mb-3">
        <CalendarCheck className="h-3.5 w-3.5 text-[#86A08F]" />
        <h3 className="text-[13px] font-semibold text-slate-100">7-day validation sprint</h3>
      </div>
      <div className="space-y-2.5">
        {visible.map((d) => (
          <div key={d.day} className="flex items-start gap-2.5">
            <div className="flex h-5 w-9 items-center justify-center rounded-md bg-white/[0.04] border border-white/[0.07] shrink-0 mt-0.5">
              <span className="text-[9px] font-medium text-slate-300">Day {d.day}</span>
            </div>
            <div className="min-w-0">
              <p className="text-[12px] font-semibold text-slate-100">{d.title}</p>
              <p className="text-[12px] text-slate-300 leading-relaxed mt-0.5">{d.detail}</p>
            </div>
          </div>
        ))}
      </div>
      {!expanded && sprint.length > VISIBLE_BY_DEFAULT && (
        <button
          onClick={() => setExpanded(true)}
          className="mt-3 flex items-center gap-1 text-[11px] text-[#637B90] hover:text-[#7890A3] transition-colors"
        >
          <ChevronDown className="h-3 w-3" />
          Show full sprint (Day 3–{sprint.length})
        </button>
      )}
    </div>
  );
}
