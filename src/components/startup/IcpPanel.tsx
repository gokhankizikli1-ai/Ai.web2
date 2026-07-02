import { Users } from 'lucide-react';
import type { MarketComplaintReport } from '@/lib/startupMarketApi';
import type { RadarIcp } from '@/lib/startupRadarInsights';

/** "Who to sell to first" — the initial ICP derived from observed
 * segments + the top complaint cluster. Flagged as hypothesis when the
 * segment wasn't directly observed in evidence. */
export default function IcpPanel({
  icp,
  report,
}: {
  icp: RadarIcp | null;
  report: MarketComplaintReport;
}) {
  return (
    <div className="rounded-xl border border-white/[0.05] bg-white/[0.01] p-4">
      <div className="flex items-center gap-2 mb-3">
        <Users className="h-3.5 w-3.5 text-[#60A5FA]" />
        <h3 className="text-[13px] font-semibold text-slate-100">Who to sell to first</h3>
        {icp?.isHypothesis && (
          <span className="px-1.5 py-0.5 rounded text-[9px] bg-[#3B82F6]/[0.12] border border-[#3B82F6]/35 text-[#60A5FA]">
            hypothesis
          </span>
        )}
      </div>

      {!icp ? (
        <p className="text-[12px] text-[#CBD5E1]">
          Not enough evidence to name a first segment — no complaint clusters were found in this run.
        </p>
      ) : (
        <div className="space-y-2">
          {[
            { label: 'Best initial ICP', value: icp.segment },
            { label: 'Buying trigger', value: icp.buyingTrigger },
            { label: 'Outreach angle', value: icp.outreachAngle },
            { label: 'Where to find them', value: icp.whereToFind },
            { label: 'Why they care now', value: icp.whyNow },
          ].map((row) => (
            <div key={row.label} className="flex flex-col sm:flex-row sm:items-start gap-0.5 sm:gap-3">
              <span className="shrink-0 sm:w-32 text-[10px] text-[#94A3B8] sm:pt-0.5">{row.label}</span>
              <span className="text-[12px] text-slate-300 leading-relaxed min-w-0">{row.value}</span>
            </div>
          ))}
          {report.recommendations.first_100_customers.length > 0 && (
            <div className="pt-1.5 mt-1.5 border-t border-white/[0.04] space-y-1">
              {report.recommendations.first_100_customers.map((line, i) => (
                <p key={i} className="text-[12px] text-slate-300 leading-relaxed pl-3 border-l border-white/[0.08]">
                  {line}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
