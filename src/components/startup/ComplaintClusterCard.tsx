import { motion } from 'framer-motion';
import { ChevronRight, ExternalLink, Quote } from 'lucide-react';
import { sourceLabel, type ComplaintCluster } from '@/lib/startupMarketApi';

function painTone(score: number): string {
  if (score >= 70) return 'text-[#D7A6AD] border-[#F87171]/40 bg-[#F87171]/[0.12]';
  if (score >= 40) return 'text-[#60A5FA] border-[#3B82F6]/40 bg-[#3B82F6]/[0.12]';
  return 'text-slate-200 border-white/[0.1] bg-white/[0.04]';
}

/** One ranked complaint theme, kept compact: title, pain score, direct
 * count, the single best quote — detail scores and citations live in a
 * collapsed section. */
export default function ComplaintClusterCard({
  cluster,
  rank,
}: {
  cluster: ComplaintCluster;
  rank: number;
}) {
  const quote = cluster.sample_quotes[0];
  const subScores: { label: string; value: number }[] = [
    { label: 'Severity', value: cluster.severity },
    { label: 'Urgency', value: cluster.urgency },
    { label: 'Recency', value: cluster.recency },
    { label: 'Pays', value: cluster.willingness_to_pay_signal },
    { label: 'Saturation', value: cluster.saturation_risk },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: rank * 0.05 }}
      className="rounded-xl border border-[#253142] bg-[#111722] p-4 transition-colors hover:border-[rgba(59, 130, 246,0.30)] hover:shadow-[0_0_0_1px_rgba(59, 130, 246,0.10)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-[11px] text-[#94A3B8] shrink-0">#{rank + 1}</span>
          <h4 className="text-[13px] font-semibold text-slate-100 truncate">
            {cluster.label}
          </h4>
        </div>
        <span className={`shrink-0 px-2 py-0.5 rounded-md border text-[11px] font-semibold ${painTone(cluster.pain_score)}`}>
          pain {cluster.pain_score}/100
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[10px] text-[#CBD5E1]">
        <span>{cluster.frequency} signal{cluster.frequency === 1 ? '' : 's'}</span>
        {typeof cluster.direct_complaints === 'number' && cluster.direct_complaints > 0 && (
          <span className="text-[#86A08F] font-medium">
            {cluster.direct_complaints} direct complaint{cluster.direct_complaints === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {/* The one best evidence quote */}
      {quote && (
        <div className="mt-2.5 flex items-start gap-2 rounded-lg bg-[#151C28] border border-[#253142] px-2.5 py-2">
          <Quote className="h-3 w-3 text-[#3B82F6] shrink-0 mt-0.5" />
          <p className="text-[12px] text-slate-300 leading-relaxed break-words min-w-0">
            “{quote.text}”
            <span className="ml-1.5 text-[9px] text-[#94A3B8]">— {sourceLabel(quote.source)}</span>
          </p>
        </div>
      )}

      {/* Detail scores + citations, collapsed by default */}
      <details className="mt-2 group/detail">
        <summary className="flex items-center gap-1 text-[10px] text-[#94A3B8] hover:text-slate-300 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden transition-colors">
          <ChevronRight className="h-3 w-3 transition-transform group-open/detail:rotate-90" />
          Details & citations
        </summary>
        <div className="grid grid-cols-5 gap-2 mt-2.5">
          {subScores.map((s) => (
            <div key={s.label}>
              <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
                <div
                  className={`h-full rounded-full ${s.label === 'Saturation' ? 'bg-[#F87171]/70' : 'bg-[#3B82F6]/60'}`}
                  style={{ width: `${Math.min(100, Math.max(0, s.value))}%` }}
                />
              </div>
              <span className="block mt-1 text-[9px] text-[#94A3B8]">{s.label}</span>
            </div>
          ))}
        </div>
        {cluster.evidence_urls.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            {cluster.evidence_urls.slice(0, 4).map((url) => (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] text-[#CBD5E1] border border-white/[0.06] hover:text-[#60A5FA] hover:border-[#3B82F6]/35 transition-colors max-w-[220px]"
              >
                <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                <span className="truncate">{url.replace(/^https?:\/\/(www\.)?/, '')}</span>
              </a>
            ))}
          </div>
        )}
      </details>
    </motion.div>
  );
}
