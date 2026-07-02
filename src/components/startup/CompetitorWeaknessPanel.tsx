import { Swords } from 'lucide-react';
import type { MarketComplaintReport } from '@/lib/startupMarketApi';

/** Competitor weaknesses grounded in evidence: the backend associates a
 * mentioned competitor with the complaint cluster whose evidence text
 * actually contains the name. Competitors without a matched cluster are
 * still listed as bare mentions — nothing is inferred beyond that. */
export default function CompetitorWeaknessPanel({ report }: { report: MarketComplaintReport }) {
  const competitors = report.market_signals.competitors_mentioned;
  const weaknesses = report.market_signals.competitor_weaknesses ?? [];
  const weaknessByName = new Map(weaknesses.map((w) => [w.competitor, w]));

  return (
    <div className="rounded-xl border border-white/[0.05] bg-white/[0.01] p-4">
      <div className="flex items-center gap-2 mb-3">
        <Swords className="h-3.5 w-3.5 text-violet-300" />
        <h3 className="text-[13px] font-semibold text-slate-100">Competitor weaknesses found in evidence</h3>
      </div>

      {competitors.length === 0 ? (
        <p className="text-[12px] text-slate-400">No strong competitor mentions found in this run.</p>
      ) : (
        <div className="space-y-1.5">
          {competitors.map((name) => {
            const w = weaknessByName.get(name);
            return (
              <div
                key={name}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-white/[0.015] border border-white/[0.04] px-2.5 py-2"
              >
                <span className="text-[12px] font-semibold text-slate-100">{name}</span>
                {w ? (
                  <>
                    <span className="text-[12px] text-slate-300 min-w-0 flex-1">
                      Weakness signal: {w.cluster_label}
                    </span>
                    <span className="text-[10px] text-slate-500 shrink-0">
                      {w.evidence_count} evidence item{w.evidence_count === 1 ? '' : 's'}
                    </span>
                  </>
                ) : (
                  <span className="text-[11px] text-slate-400 min-w-0 flex-1">
                    Named while switching/comparing — mention context not captured in complaint clusters.
                  </span>
                )}
              </div>
            );
          })}
          <p className="text-[10px] text-slate-500 mt-1">
            Associations come only from evidence text that names the competitor — directional, not exhaustive.
          </p>
        </div>
      )}
    </div>
  );
}
