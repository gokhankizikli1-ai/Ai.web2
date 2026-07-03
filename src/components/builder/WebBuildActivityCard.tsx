import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Loader2, AlertTriangle, Circle, ChevronDown, ListChecks } from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';
import type { WebBuildActivityRow, ActivityStatus } from '@/lib/webBuildPayload';

/**
 * Compact, collapsible "Build activity" card (Kimi/Claude style) shown inside
 * an assistant message. Rows read: <label> — <Status>, with a small detail.
 * Live during a build (rows advance), then a static log afterwards.
 */
const ACCENT = '#60A5FA';

function StatusIcon({ status }: { status: ActivityStatus }) {
  if (status === 'done') return <Check className="h-3 w-3" style={{ color: ACCENT }} />;
  if (status === 'running') return <Loader2 className="h-3 w-3 animate-spin" style={{ color: ACCENT }} />;
  if (status === 'failed') return <AlertTriangle className="h-3 w-3 text-[#F87171]" />;
  return <Circle className="h-2.5 w-2.5 text-[#475569]" />;
}

const STATUS_KEY: Record<ActivityStatus, string> = {
  waiting: 'wbActStatusWaiting', running: 'wbActStatusRunning', done: 'wbActStatusDone', failed: 'wbActStatusFailed',
};

interface WebBuildActivityCardProps {
  rows: WebBuildActivityRow[];
  /** Live builds start expanded; finished logs start collapsed. */
  defaultOpen?: boolean;
}

export default function WebBuildActivityCard({ rows, defaultOpen = false }: WebBuildActivityCardProps) {
  const { t } = useLanguageStore();
  const [open, setOpen] = useState(defaultOpen);
  const doneCount = rows.filter((r) => r.status === 'done').length;

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/[0.02] transition-colors"
      >
        <ListChecks className="h-3.5 w-3.5" style={{ color: ACCENT }} />
        <span className="text-[12px] font-medium text-slate-200">{t('wbBuildActivity')}</span>
        <span className="text-[11px] text-[#64748B]">{doneCount}/{rows.length}</span>
        <ChevronDown className={`ml-auto h-3.5 w-3.5 text-[#64748B] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="border-t border-white/[0.04]"
          >
            <div className="p-1.5 space-y-0.5">
              {rows.map((row) => (
                <div key={row.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg">
                  <StatusIcon status={row.status} />
                  <span className={`text-[12px] font-mono ${row.status === 'waiting' ? 'text-[#64748B]' : 'text-slate-200'}`}>
                    {t(row.labelKey, row.params)}
                  </span>
                  {row.detail && <span className="text-[11px] text-[#64748B] truncate">· {row.detail}</span>}
                  <span className="ml-auto text-[10px] text-[#64748B]">{t(STATUS_KEY[row.status])}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
