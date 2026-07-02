import { motion } from 'framer-motion';
import { ExternalLink, Quote } from 'lucide-react';
import { sourceLabel, type ComplaintCluster } from '@/lib/startupMarketApi';

function painTone(score: number): string {
  if (score >= 70) return 'text-rose-200 border-rose-500/30 bg-rose-500/[0.1]';
  if (score >= 40) return 'text-amber-200 border-amber-500/30 bg-amber-500/[0.1]';
  return 'text-slate-200 border-white/[0.1] bg-white/[0.04]';
}

/** One ranked complaint theme: pain score, sub-scores, source mix, evidence. */
export default function ComplaintClusterCard({
  cluster,
  rank,
}: {
  cluster: ComplaintCluster;
  rank: number;
}) {
  const subScores: { label: string; value: number }[] = [
    { label: 'Severity', value: cluster.severity },
    { label: 'Urgency', value: cluster.urgency },
    { label: 'Recency', value: cluster.recency },
    { label: 'Pays', value: cluster.willingness_to_pay_signal },
    { label: 'Saturation', value: cluster.saturation_risk },
  ];
  const mix = Object.entries(cluster.source_mix).filter(([, n]) => n > 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: rank * 0.05 }}
      className="rounded-xl border border-white/[0.05] bg-white/[0.01] p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-[11px] text-slate-500 shrink-0">#{rank + 1}</span>
          <h4 className="text-[13px] font-semibold text-slate-100 truncate">
            {cluster.label}
          </h4>
        </div>
        <span className={`shrink-0 px-2 py-0.5 rounded-md border text-[11px] font-semibold ${painTone(cluster.pain_score)}`}>
          pain {cluster.pain_score}/100
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[10px] text-slate-400">
        <span>{cluster.frequency} signal{cluster.frequency === 1 ? '' : 's'}</span>
        {typeof cluster.direct_complaints === 'number' && cluster.direct_complaints > 0 && (
          <span className="text-emerald-300/90 font-medium">
            {cluster.direct_complaints} direct complaint{cluster.direct_complaints === 1 ? '' : 's'}
          </span>
        )}
        {mix.map(([src, n]) => (
          <span key={src} className="text-slate-500">
            {sourceLabel(src)} × {n}
          </span>
        ))}
      </div>

      {/* Sub-score bars */}
      <div className="grid grid-cols-5 gap-2 mt-3">
        {subScores.map((s) => (
          <div key={s.label}>
            <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className={`h-full rounded-full ${s.label === 'Saturation' ? 'bg-rose-400/60' : 'bg-cyan-400/60'}`}
                style={{ width: `${Math.min(100, Math.max(0, s.value))}%` }}
              />
            </div>
            <span className="block mt-1 text-[9px] text-slate-500">{s.label}</span>
          </div>
        ))}
      </div>

      {/* Evidence quotes */}
      {cluster.sample_quotes.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {cluster.sample_quotes.slice(0, 2).map((q, i) => (
            <div key={i} className="flex items-start gap-2 rounded-lg bg-white/[0.015] border border-white/[0.04] px-2.5 py-2">
              <Quote className="h-3 w-3 text-slate-500 shrink-0 mt-0.5" />
              <p className="text-[12px] text-slate-300 leading-relaxed break-words min-w-0">
                “{q.text}”
                <span className="ml-1.5 text-[9px] text-slate-500">
                  — {sourceLabel(q.source)}
                </span>
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Evidence links */}
      {cluster.evidence_urls.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {cluster.evidence_urls.slice(0, 4).map((url) => (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] text-slate-400 border border-white/[0.06] hover:text-cyan-300 hover:border-cyan-500/25 transition-colors max-w-[220px]"
            >
              <ExternalLink className="h-2.5 w-2.5 shrink-0" />
              <span className="truncate">{url.replace(/^https?:\/\/(www\.)?/, '')}</span>
            </a>
          ))}
        </div>
      )}
    </motion.div>
  );
}
