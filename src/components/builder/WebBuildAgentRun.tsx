import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useLanguageStore } from '@/stores/languageStore';
import WebBuildToolCallBlock from '@/components/builder/WebBuildToolCallBlock';
import type { RunRow, ToolType } from '@/lib/webBuildRun';

/**
 * Renders a Web Build coding-agent run: a short assistant message, a small
 * Thinking block, then the real work as file tool-call blocks (Create/Edit/Read
 * file · +N −M), then a preview block. No checklist, no planning rows, no table,
 * no tick waterfall, no emoji. File blocks are clickable → open the code drawer.
 *
 * `animate` (newest run) reveals blocks one by one and plays each tool block
 * running → completed, so it reads like the agent is writing files live — even
 * though the non-streaming backend returned them together. History renders done.
 */
type Brief = { type?: string; audience?: string; goal?: string; style?: string };

/** How long each tool block dwells in the running state before completing. */
const RUN_MS: Record<ToolType, number> = {
  think: 520, create_file: 560, edit_file: 600, read_file: 360, preview: 460,
};
const GAP_MS = 90;   // pause between a block completing and the next appearing
const MSG_MS = 240;  // pause after an assistant message before the next block

export default function WebBuildAgentRun({
  rows, animate, onOpenFile,
}: {
  rows: RunRow[];
  brief?: Brief;
  animate: boolean;
  onOpenFile: (path: string) => void;
}) {
  const total = rows.length;
  const [visible, setVisible] = useState(animate ? 0 : total);
  const [runningId, setRunningId] = useState<string | null>(null);

  useEffect(() => {
    if (!animate) { setVisible(total); setRunningId(null); return; }
    setVisible(0);
    setRunningId(null);
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    let i = 0;
    const advance = () => {
      if (cancelled || i >= total) { setRunningId(null); return; }
      const row = rows[i];
      setVisible(i + 1);
      if (row.kind === 'tool') {
        setRunningId(row.id);
        timers.push(setTimeout(() => {
          if (cancelled) return;
          setRunningId(null);
          i += 1;
          timers.push(setTimeout(advance, GAP_MS));
        }, RUN_MS[row.toolType] ?? 480));
      } else {
        i += 1;
        timers.push(setTimeout(advance, MSG_MS));
      }
    };
    advance();
    return () => { cancelled = true; timers.forEach(clearTimeout); };
  }, [rows, animate, total]);

  if (total === 0) return null;

  return (
    <div className="space-y-1.5">
      {rows.slice(0, visible).map((row) => {
        const status = animate ? (row.id === runningId ? 'running' : 'completed') : 'completed';
        return (
          <motion.div
            key={row.id}
            initial={animate ? { opacity: 0, y: 4 } : false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22 }}
          >
            {row.kind === 'message'
              ? <MessageRow row={row} />
              : <WebBuildToolCallBlock row={{ ...row, status }} onOpenFile={onOpenFile} />}
          </motion.div>
        );
      })}
    </div>
  );
}

function MessageRow({ row }: { row: Extract<RunRow, { kind: 'message' }> }) {
  const { t } = useLanguageStore();
  return <p className="text-[13px] leading-relaxed text-[#CBD5E1]">{t(row.messageKey, row.params)}</p>;
}
