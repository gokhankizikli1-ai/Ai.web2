import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';

/**
 * A minimal, chat-style inline execution line for the Web Build coding run —
 * NOT a card, table, or badge. It reads like a subtle line of tool text inside
 * the assistant message: a verb + optional file path, with the diff (+N −M)
 * quietly on the right. While running, the text has a soft shimmer sweep (no
 * spinner). When completed it becomes calm/static; completed file lines are
 * clickable and open the code drawer on that file. No emoji, no green ticks.
 *
 * Claude-style expansion: when the operation carries `details` (or an honest
 * `note`), a small chevron reveals a soft, collapsible panel with the real
 * specifics — file path + purpose, source titles/URLs, and a note clarifying
 * that generated files are virtual project files (not Korvix repo edits).
 */

/** Soft gradient shimmer sweeping across the label while a line is active. */
function Shimmer({ text }: { text: string }) {
  return (
    <motion.span
      className="bg-clip-text font-medium text-transparent"
      style={{
        backgroundImage: 'linear-gradient(90deg,#7C8698 0%,#7C8698 38%,#E8EDF5 50%,#7C8698 62%,#7C8698 100%)',
        backgroundSize: '220% 100%',
        WebkitBackgroundClip: 'text',
      }}
      animate={{ backgroundPositionX: ['160%', '-60%'] }}
      transition={{ duration: 1.15, repeat: Infinity, ease: 'linear' }}
    >
      {text}
    </motion.span>
  );
}

export default function WebBuildInlineExecutionLine({
  label, status, filePath, linesAdded = 0, linesRemoved = 0, summary, onClick, details, note,
}: {
  label: string;
  status: 'running' | 'completed' | 'failed';
  filePath?: string;
  linesAdded?: number;
  linesRemoved?: number;
  summary?: string;
  onClick?: () => void;
  /** Expandable operation detail lines (real data). */
  details?: string[];
  /** Honest, localized note shown inside the expanded panel. */
  note?: string;
}) {
  const { t } = useLanguageStore();
  const [open, setOpen] = useState(false);
  const running = status === 'running';
  const failed = status === 'failed';
  const hasDiff = linesAdded > 0 || linesRemoved > 0;
  const clickable = !!onClick && status === 'completed' && !!filePath;
  const expandable = !running && ((details?.length ?? 0) > 0 || !!note);

  const label_ = (
    <>
      <span className="min-w-0 truncate">
        {running ? (
          <Shimmer text={filePath ? `${label} ${filePath}` : label} />
        ) : (
          <>
            <span className={failed ? 'text-[#C98A93]' : 'text-[#94A3B8]'}>{label}</span>
            {filePath && (
              <span className="ml-1.5 font-mono text-[12px] text-[#CBD5E1] group-hover:text-white group-hover:underline decoration-white/20 underline-offset-2">
                {filePath}
              </span>
            )}
            {summary && !filePath && <span className="ml-1.5 text-[#64748B]">{summary}</span>}
          </>
        )}
      </span>
      <span className="flex-1" />
      {!running && hasDiff && (
        <span className="shrink-0 font-mono text-[11px]">
          <span className="text-[#86A08F]">+{linesAdded}</span>{' '}
          <span className="text-[#C98A93]">-{linesRemoved}</span>
        </span>
      )}
    </>
  );

  const rowCls = 'flex w-full items-baseline gap-1 py-[3px] text-[12.5px] leading-relaxed';

  return (
    <div>
      <div className="flex items-baseline gap-1">
        {clickable ? (
          <button onClick={onClick} className={`group ${rowCls} text-left transition-opacity hover:opacity-100`}>
            {label_}
          </button>
        ) : (
          <div className={`group ${rowCls}`}>{label_}</div>
        )}
        {expandable && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="mt-[1px] flex h-4 w-4 shrink-0 items-center justify-center rounded text-[#64748B] transition-colors hover:text-[#CBD5E1]"
            aria-label={t('wbOpToggleDetails')}
          >
            <motion.span animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.18 }}>
              <ChevronRight className="h-3.5 w-3.5" />
            </motion.span>
          </button>
        )}
      </div>
      <AnimatePresence initial={false}>
        {expandable && open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="ml-1 mt-1 space-y-1 border-l border-white/[0.08] pl-3 text-[11.5px] text-[#94A3B8]">
              {details?.map((d, i) => (
                <p key={i} className="break-words">{d}</p>
              ))}
              {note && <p className="text-[#64748B]">{note}</p>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
