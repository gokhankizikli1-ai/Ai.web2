import { motion } from 'framer-motion';

/**
 * A minimal, chat-style inline execution line for the Web Build coding run —
 * NOT a card, table, or badge. It reads like a subtle line of tool text inside
 * the assistant message: a verb + optional file path, with the diff (+N −M)
 * quietly on the right. While running, the text has a soft shimmer sweep (no
 * spinner). When completed it becomes calm/static; completed file lines are
 * clickable and open the code drawer on that file. No emoji, no green ticks.
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
  label, status, filePath, linesAdded = 0, linesRemoved = 0, summary, onClick,
}: {
  label: string;
  status: 'running' | 'completed' | 'failed';
  filePath?: string;
  linesAdded?: number;
  linesRemoved?: number;
  summary?: string;
  onClick?: () => void;
}) {
  const running = status === 'running';
  const failed = status === 'failed';
  const hasDiff = linesAdded > 0 || linesRemoved > 0;
  const clickable = !!onClick && status === 'completed' && !!filePath;

  const body = (
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

  const cls = 'flex w-full items-baseline gap-1 py-[3px] text-[12.5px] leading-relaxed';
  if (clickable) {
    return (
      <button onClick={onClick} className={`group ${cls} text-left transition-opacity hover:opacity-100`}>
        {body}
      </button>
    );
  }
  return <div className={`group ${cls}`}>{body}</div>;
}
