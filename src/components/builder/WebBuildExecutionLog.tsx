import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { FileCode, FilePlus2, FileText, ChevronRight } from 'lucide-react';
import { useLanguageStore, LANGUAGES } from '@/stores/languageStore';
import { deriveExecutionFeed, type WebBuildStep, type FeedItem } from '@/lib/webBuildPayload';

/**
 * A Kimi/Claude-style build execution FEED — NOT a checklist. The assistant
 * writes short natural progress lines interleaved with compact tool action
 * rows (Create / Update / Read <path> · one-line summary · +N −M). No emojis,
 * no green-tick waterfall, no table. File rows are clickable and open the file
 * drawer on that path; the "Analyze request" block expands to show the brief.
 *
 * The backend is non-streaming, so for the newest step (`animate`) we reveal
 * items progressively (~250–400ms between rows) so it reads like an agent
 * performing actions. Every row is real build data — no fabricated files.
 * History steps render fully, no animation.
 */

/** Per-item reveal delay (ms) — text is quick, file rows are paced. */
function itemDelay(item: FeedItem): number {
  if (item.kind === 'text') return 220;
  if (item.kind === 'analyze') return 260;
  return 340;
}

const OP_ICON = { create: FilePlus2, update: FileCode, read: FileText } as const;
const OP_KEY = { create: 'wbActionCreate', update: 'wbActionUpdate', read: 'wbActionRead' } as const;

/* ── Compact tool action row (clickable file op) ─────────────────────── */
function FileRow({
  item, onOpenFile,
}: {
  item: Extract<FeedItem, { kind: 'file' }>;
  onOpenFile: (path: string) => void;
}) {
  const { t } = useLanguageStore();
  const Icon = OP_ICON[item.op];
  return (
    <button
      onClick={() => onOpenFile(item.path)}
      className="group flex w-full items-start gap-2.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2 text-left transition-colors hover:border-white/[0.12] hover:bg-white/[0.04]"
    >
      <Icon className="mt-[1px] h-3.5 w-3.5 shrink-0 text-[#64748B] group-hover:text-[#94A3B8]" />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1.5">
          <span className="text-[12px] font-medium text-[#CBD5E1]">{t(OP_KEY[item.op])}</span>
          <span className="truncate font-mono text-[11.5px] text-slate-200">{item.path}</span>
        </span>
        {item.summary && (
          <span className="mt-0.5 block truncate text-[11px] text-[#64748B]">{item.summary}</span>
        )}
      </span>
      {(item.added > 0 || item.removed > 0) && (
        <span className="shrink-0 self-start pt-[1px] font-mono text-[10.5px]">
          <span className="text-[#86A08F]">+{item.added}</span>{' '}
          <span className="text-[#C98A93]">-{item.removed}</span>
        </span>
      )}
    </button>
  );
}

/* ── "Analyze request" collapsible block (brief details) ─────────────── */
function AnalyzeRow({
  details,
}: {
  details: { label: string; value: string }[];
}) {
  const { t } = useLanguageStore();
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left"
      >
        <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-[#64748B] transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className="text-[12px] font-medium text-[#CBD5E1]">{t('wbActAnalyze')}</span>
      </button>
      {open && details.length > 0 && (
        <div className="space-y-1 border-t border-white/[0.05] px-3 py-2.5 pl-[30px]">
          {details.map((d) => (
            <div key={d.label} className="flex gap-2 text-[11.5px] leading-snug">
              <span className="shrink-0 text-[#64748B]">{d.label}:</span>
              <span className="text-[#CBD5E1]">{d.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function WebBuildExecutionLog({
  step, brief, animate, onOpenFile,
}: {
  step: WebBuildStep;
  brief: { type?: string; audience?: string; goal?: string; style?: string };
  /** Reveal items progressively (only for the newest step). */
  animate: boolean;
  onOpenFile: (path: string) => void;
}) {
  const { t, lang } = useLanguageStore();
  const feed = useMemo(() => deriveExecutionFeed(step, brief), [step, brief]);

  // Analyze details from the real brief + section names (localized labels).
  const analyzeDetails = useMemo(() => {
    const langLabel = LANGUAGES.find((l) => l.code === lang)?.label || lang;
    const rows: { label: string; value: string }[] = [];
    if (brief.goal) rows.push({ label: t('wbAnalyzeGoal'), value: brief.goal });
    if (brief.audience) rows.push({ label: t('wbAnalyzeAudience'), value: brief.audience });
    rows.push({ label: t('wbAnalyzeLanguage'), value: langLabel });
    if (brief.style) rows.push({ label: t('wbAnalyzeStyle'), value: brief.style });
    if (step.summary.sectionNames.length) rows.push({ label: t('wbAnalyzeSections'), value: step.summary.sectionNames.join(', ') });
    return rows;
  }, [brief, step.summary.sectionNames, lang, t]);

  const total = feed.length;
  const [revealed, setRevealed] = useState(animate ? 0 : total);

  useEffect(() => {
    if (!animate) { setRevealed(total); return; }
    setRevealed(0);
    let acc = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 0; i < total; i++) {
      acc += itemDelay(feed[i]);
      timers.push(setTimeout(() => setRevealed(i + 1), acc));
    }
    return () => timers.forEach(clearTimeout);
  }, [feed, animate, total]);

  if (total === 0) return null;

  return (
    <div className="space-y-1.5">
      {feed.slice(0, revealed).map((item) => (
        <motion.div
          key={item.id}
          initial={animate ? { opacity: 0, y: 4 } : false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22 }}
        >
          {item.kind === 'text' ? (
            <p className="text-[13px] leading-relaxed text-[#CBD5E1]">{t(item.key, item.params)}</p>
          ) : item.kind === 'analyze' ? (
            <AnalyzeRow details={analyzeDetails} />
          ) : (
            <FileRow item={item} onOpenFile={onOpenFile} />
          )}
        </motion.div>
      ))}
    </div>
  );
}
