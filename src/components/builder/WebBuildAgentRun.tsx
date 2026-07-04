import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  FileCode, FilePlus2, FileText, ChevronRight,
  Search, ListTree, Globe, Loader2,
} from 'lucide-react';
import { useLanguageStore, LANGUAGES } from '@/stores/languageStore';
import type { RunRow, RunActionIcon } from '@/lib/webBuildRun';

/**
 * Renders a Web Build agent run as a Kimi/Claude-style execution feed: natural
 * assistant messages, compact collapsible action blocks (Analyze request / Plan
 * website structure), file tool rows (Create/Update/Read <path> · summary ·
 * +N −M), and a preview action. No checklist, no table, no tick waterfall, no
 * emoji. File rows are clickable and open the file drawer on that path.
 *
 * `animate` reveals rows progressively (finished step, newest run). Live
 * in-progress rows (during the backend call) are passed with animate=false and
 * shown with a running spinner — the phases really are running in that window.
 */
type Brief = { type?: string; audience?: string; goal?: string; style?: string };

const ACTION_ICON: Record<RunActionIcon, typeof Search> = {
  analyze: Search, plan: ListTree, preview: Globe, read: FileText, done: FileCode,
};
const OP_ICON = { create: FilePlus2, update: FileCode, read: FileText } as const;
const OP_KEY = { create: 'wbActionCreate', update: 'wbActionUpdate', read: 'wbActionRead' } as const;

function rowDelay(row: RunRow): number {
  if (row.kind === 'message') return 200;
  if (row.kind === 'file') return 320;
  return 280;
}

/* ── File tool row (clickable) ───────────────────────────────────────── */
function FileRow({ row, onOpenFile }: { row: Extract<RunRow, { kind: 'file' }>; onOpenFile: (p: string) => void }) {
  const { t } = useLanguageStore();
  const Icon = OP_ICON[row.op];
  return (
    <button
      onClick={() => onOpenFile(row.path)}
      className="group flex w-full items-start gap-2.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2 text-left transition-colors hover:border-white/[0.12] hover:bg-white/[0.04]"
    >
      <Icon className="mt-[1px] h-3.5 w-3.5 shrink-0 text-[#64748B] group-hover:text-[#94A3B8]" />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1.5">
          <span className="text-[12px] font-medium text-[#CBD5E1]">{t(OP_KEY[row.op])}</span>
          <span className="truncate font-mono text-[11.5px] text-slate-200">{row.path}</span>
        </span>
        {row.summary && <span className="mt-0.5 block truncate text-[11px] text-[#64748B]">{row.summary}</span>}
      </span>
      {(row.added > 0 || row.removed > 0) && (
        <span className="shrink-0 self-start pt-[1px] font-mono text-[10.5px]">
          <span className="text-[#86A08F]">+{row.added}</span>{' '}
          <span className="text-[#C98A93]">-{row.removed}</span>
        </span>
      )}
    </button>
  );
}

/* ── Action block (collapsible when it has details, else a status row) ── */
function ActionRow({ row, brief }: { row: Extract<RunRow, { kind: 'action' }>; brief: Brief }) {
  const { t, lang } = useLanguageStore();
  const [open, setOpen] = useState(false);
  const running = row.status === 'running';
  const Icon = ACTION_ICON[row.icon];

  const details = useMemo<{ label?: string; value: string }[]>(() => {
    if (row.detailsSource === 'brief') {
      const langLabel = LANGUAGES.find((l) => l.code === lang)?.label || lang;
      const rows: { label?: string; value: string }[] = [];
      if (brief.goal) rows.push({ label: t('wbAnalyzeGoal'), value: brief.goal });
      if (brief.audience) rows.push({ label: t('wbAnalyzeAudience'), value: brief.audience });
      rows.push({ label: t('wbAnalyzeLanguage'), value: langLabel });
      if (brief.style) rows.push({ label: t('wbAnalyzeStyle'), value: brief.style });
      return rows;
    }
    return (row.details || []).map((v) => ({ value: v }));
  }, [row.details, row.detailsSource, brief, lang, t]);

  const collapsible = !running && details.length > 0;

  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02]">
      <button
        onClick={() => collapsible && setOpen((v) => !v)}
        disabled={!collapsible}
        className={`flex w-full items-center gap-2 px-2.5 py-2 text-left ${collapsible ? '' : 'cursor-default'}`}
      >
        {running ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[#60A5FA]" />
        ) : collapsible ? (
          <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-[#64748B] transition-transform ${open ? 'rotate-90' : ''}`} />
        ) : (
          <Icon className="h-3.5 w-3.5 shrink-0 text-[#64748B]" />
        )}
        <span className={`text-[12px] font-medium ${running ? 'text-[#94A3B8]' : 'text-[#CBD5E1]'}`}>{t(row.titleKey)}</span>
        {!running && row.detail && !collapsible && (
          <span className="truncate text-[11px] text-[#64748B]">· {row.detail}</span>
        )}
      </button>
      {collapsible && open && (
        <div className="space-y-1 border-t border-white/[0.05] px-3 py-2.5 pl-[30px]">
          {row.detail && !details.some((d) => d.label) && (
            <div className="text-[11.5px] text-[#CBD5E1]">{row.detail}</div>
          )}
          {row.detailKey && <div className="text-[11.5px] text-[#94A3B8]">{t(row.detailKey)}</div>}
          {details.map((d, i) => (
            <div key={i} className="flex gap-2 text-[11.5px] leading-snug">
              {d.label && <span className="shrink-0 text-[#64748B]">{d.label}:</span>}
              <span className="text-[#CBD5E1]">{d.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function WebBuildAgentRun({
  rows, brief, animate, onOpenFile,
}: {
  rows: RunRow[];
  brief: Brief;
  animate: boolean;
  onOpenFile: (path: string) => void;
}) {
  const total = rows.length;
  const [revealed, setRevealed] = useState(animate ? 0 : total);

  useEffect(() => {
    if (!animate) { setRevealed(total); return; }
    setRevealed(0);
    let acc = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 0; i < total; i++) {
      acc += rowDelay(rows[i]);
      timers.push(setTimeout(() => setRevealed(i + 1), acc));
    }
    return () => timers.forEach(clearTimeout);
  }, [rows, animate, total]);

  if (total === 0) return null;

  return (
    <div className="space-y-1.5">
      {rows.slice(0, revealed).map((row) => (
        <motion.div
          key={row.id}
          initial={animate ? { opacity: 0, y: 4 } : false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22 }}
        >
          {row.kind === 'message' ? (
            <MessageRow row={row} />
          ) : row.kind === 'action' ? (
            <ActionRow row={row} brief={brief} />
          ) : (
            <FileRow row={row} onOpenFile={onOpenFile} />
          )}
        </motion.div>
      ))}
    </div>
  );
}

function MessageRow({ row }: { row: Extract<RunRow, { kind: 'message' }> }) {
  const { t } = useLanguageStore();
  return <p className="text-[13px] leading-relaxed text-[#CBD5E1]">{t(row.messageKey, row.params)}</p>;
}
