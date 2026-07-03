import { motion } from 'framer-motion';
import { Check, Loader2, AlertTriangle, Circle } from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';
import type { WebBuildActivityRow, ActivityStatus } from '@/lib/webBuildPayload';

/**
 * Kimi-style build activity/task table. Renders Task · Status · Details rows
 * with meaningful per-row status. Used live during generation (rows advance on
 * a paced timer with minimum visible durations) and afterwards as a static
 * "Build Activity" log (all rows resolved, details tied to real build data).
 */
const ACCENT = '#60A5FA';

const STATUS_META: Record<ActivityStatus, { key: string; className: string }> = {
  waiting: { key: 'wbActStatusWaiting', className: 'text-[#64748B] bg-white/[0.03] border-white/[0.06]' },
  running: { key: 'wbActStatusRunning', className: 'text-[#60A5FA] bg-[#3B82F6]/[0.08] border-[#3B82F6]/25' },
  done:    { key: 'wbActStatusDone',    className: 'text-[#86A08F] bg-[#4ADE80]/[0.08] border-[#4ADE80]/25' },
  failed:  { key: 'wbActStatusFailed',  className: 'text-[#F87171] bg-[#F87171]/[0.08] border-[#F87171]/25' },
};

function StatusIcon({ status }: { status: ActivityStatus }) {
  if (status === 'done') return <Check className="h-3 w-3" style={{ color: ACCENT }} />;
  if (status === 'running') return <Loader2 className="h-3 w-3 animate-spin" style={{ color: ACCENT }} />;
  if (status === 'failed') return <AlertTriangle className="h-3 w-3 text-[#F87171]" />;
  return <Circle className="h-2.5 w-2.5 text-[#475569]" />;
}

interface WebBuildActivityTableProps {
  rows: WebBuildActivityRow[];
  /** Optional per-row detail override (already localized). */
  detailFor?: (row: WebBuildActivityRow) => string | undefined;
}

export default function WebBuildActivityTable({ rows, detailFor }: WebBuildActivityTableProps) {
  const { t } = useLanguageStore();

  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.06]">
      {/* Header */}
      <div className="grid grid-cols-[1.3fr_0.7fr_1.6fr] gap-2 px-3 py-2 bg-white/[0.02] border-b border-white/[0.05]">
        <span className="text-[10px] font-semibold text-[#94A3B8] uppercase tracking-wider">{t('wbActTask')}</span>
        <span className="text-[10px] font-semibold text-[#94A3B8] uppercase tracking-wider">{t('wbActStatus')}</span>
        <span className="text-[10px] font-semibold text-[#94A3B8] uppercase tracking-wider">{t('wbActDetails')}</span>
      </div>

      {/* Rows */}
      <div className="divide-y divide-white/[0.03]">
        {rows.map((row, i) => {
          const meta = STATUS_META[row.status];
          const detail = detailFor?.(row) ?? row.detail;
          const dim = row.status === 'waiting';
          return (
            <motion.div
              key={row.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: i * 0.02 }}
              className={`grid grid-cols-[1.3fr_0.7fr_1.6fr] gap-2 px-3 py-2 items-center ${
                row.status === 'running' ? 'bg-white/[0.02]' : ''
              }`}
            >
              <div className={`flex items-center gap-2 text-[12px] ${dim ? 'text-[#64748B]' : 'text-slate-200'}`}>
                <StatusIcon status={row.status} />
                <span className="truncate">{t(row.labelKey)}</span>
              </div>
              <div>
                <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium border ${meta.className}`}>
                  {t(meta.key)}
                </span>
              </div>
              <div className="text-[11px] text-[#94A3B8] leading-snug truncate" title={detail || ''}>
                {detail || '—'}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
