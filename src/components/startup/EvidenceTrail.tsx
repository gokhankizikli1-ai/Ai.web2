import { ChevronRight, ExternalLink } from 'lucide-react';
import {
  SOURCE_DISPLAY, sourceLabel,
  type MarketComplaintReport, type RadarCitation,
} from '@/lib/startupMarketApi';
import { useLanguageStore } from '@/stores/languageStore';

// Backend-observed contribution → user label. "Opened" is the honest
// floor for anything without a role (old cached reports).
const ROLE_META: Record<string, { label: string; tone: string }> = {
  direct: { label: 'Direct complaint', tone: 'text-[#86A08F] border-[#4ADE80]/40 bg-[#4ADE80]/[0.12]' },
  complaint: { label: 'Extracted complaint', tone: 'text-[#60A5FA] border-[#3B82F6]/35 bg-[#3B82F6]/[0.1]' },
  broad: { label: 'Broad evidence', tone: 'text-[#CBD5E1] border-white/[0.08] bg-white/[0.03]' },
  context: { label: 'Used as citation', tone: 'text-slate-300 border-white/[0.08] bg-white/[0.03]' },
};

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0];
  }
}

interface Props {
  report: MarketComplaintReport;
  /** Open by default right after a fresh analysis; collapsed on restore. */
  defaultOpen?: boolean;
}

/**
 * The research trail: every page the radar ACTUALLY used, grouped by
 * source, each labeled with its backend-observed contribution. Nothing
 * here is invented — it is the citations list, made legible.
 */
export default function EvidenceTrail({ report, defaultOpen = false }: Props) {
  const { t } = useLanguageStore();
  if (report.citations.length === 0) return null;

  const bySource = new Map<string, RadarCitation[]>();
  for (const c of report.citations) {
    const list = bySource.get(c.source) ?? [];
    list.push(c);
    bySource.set(c.source, list);
  }
  // Stable display order matching SOURCE_DISPLAY.
  const ordered = Object.keys(SOURCE_DISPLAY).filter((s) => bySource.has(s));

  return (
    <details
      open={defaultOpen || undefined}
      className="rounded-xl border border-white/[0.05] bg-white/[0.01] p-4 group"
    >
      <summary className="flex items-center gap-2 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-3.5 w-3.5 text-[#94A3B8] transition-transform group-open:rotate-90" />
        <span className="text-[13px] font-semibold text-slate-100">{t('startupSourcesUsed')}</span>
        <span className="text-[11px] text-[#94A3B8]">
          {report.citations.length} page{report.citations.length === 1 ? '' : 's'} used
        </span>
      </summary>

      <div className="mt-3 space-y-3">
        {ordered.map((source) => (
          <div key={source}>
            <span className="block text-[10px] font-medium text-[#94A3B8] uppercase tracking-wider mb-1.5">
              {sourceLabel(source)}
            </span>
            <ul className="space-y-1">
              {(bySource.get(source) ?? []).map((c) => {
                const role = ROLE_META[c.evidence_role ?? 'context'] ?? ROLE_META.context;
                return (
                  <li key={c.url} className="flex items-center gap-2 min-w-0">
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 min-w-0 text-[12px] text-slate-300 hover:text-[#60A5FA] transition-colors"
                    >
                      <ExternalLink className="h-2.5 w-2.5 shrink-0 text-[#94A3B8]" />
                      <span className="font-medium shrink-0">{domainOf(c.url)}</span>
                      <span className="text-[#94A3B8] truncate">{c.title}</span>
                    </a>
                    <span className={`ml-auto shrink-0 px-1.5 py-0.5 rounded border text-[9px] ${role.tone}`}>
                      {role.label}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </details>
  );
}
