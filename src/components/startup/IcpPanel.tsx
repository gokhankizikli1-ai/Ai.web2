import { Users } from 'lucide-react';
import type { MarketComplaintReport } from '@/lib/startupMarketApi';
import type { RadarIcp } from '@/lib/startupRadarInsights';
import { useLanguageStore } from '@/stores/languageStore';

/** "First customers to target" — the initial ICP derived from observed
 * segments + the top complaint cluster. Flagged as hypothesis when the
 * segment wasn't directly observed in evidence. */
export default function IcpPanel({
  icp,
  report,
}: {
  icp: RadarIcp | null;
  report: MarketComplaintReport;
}) {
  const { t } = useLanguageStore();
  return (
    <div className="rounded-xl border border-white/[0.05] bg-white/[0.01] p-4">
      <div className="flex items-center gap-2 mb-3">
        <Users className="h-3.5 w-3.5 text-[#60A5FA]" />
        <h3 className="text-[13px] font-semibold text-slate-100">{t('startupFirstCustomers')}</h3>
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
        <div className="space-y-3.5">
          {[
            { label: 'Best first customer', value: icp.segment },
            { label: 'Where to find them', value: icp.whereToFind },
            { label: 'What to say', value: icp.outreachAngle },
            { label: 'Why now', value: icp.whyNow },
          ].map((block) => (
            <div key={block.label}>
              <span className="block text-[10px] font-medium uppercase tracking-[0.06em] text-[#64748B] mb-1">{block.label}</span>
              <p className="text-[12.5px] text-slate-300 leading-relaxed">{block.value}</p>
            </div>
          ))}
          {report.recommendations.first_100_customers.length > 0 && (
            <div className="pt-3 border-t border-white/[0.04]">
              <span className="block text-[10px] font-medium uppercase tracking-[0.06em] text-[#64748B] mb-1.5">First 100 customers</span>
              <div className="space-y-1">
                {report.recommendations.first_100_customers.map((line, i) => (
                  <p key={i} className="text-[12px] text-slate-300 leading-relaxed pl-3 border-l border-white/[0.08]">
                    {line}
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
