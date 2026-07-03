import { useEffect, useMemo, useState } from 'react';
import { Loader2, Check, FileCode, FileText } from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';
import { deriveExecutionOps, type WebBuildStep, type ExecOp } from '@/lib/webBuildPayload';

/**
 * A live-looking, line-by-line build execution log (Claude/Kimi style). Each
 * operation is its own row that reveals sequentially — running (⏳) → done (✓) →
 * the next row appears — instead of a post-hoc summary dumped all at once.
 *
 * The backend is non-streaming, so for the newest step (`animate`) we SIMULATE
 * the reveal on the frontend with realistic timing. Every row's content is real
 * build data (from `deriveExecutionOps`) — we never fabricate files. History
 * steps render fully done, no animation. File rows are clickable and open the
 * file drawer focused on that path.
 */
const ACCENT = '#60A5FA';

/** Per-op reveal duration (ms) for the simulated live run. */
function opDuration(op: ExecOp): number {
  return op.kind === 'file' ? 560 : 400;
}

function OpRow({
  op, state, onOpenFile,
}: {
  op: ExecOp;
  state: 'running' | 'done';
  onOpenFile: (path: string) => void;
}) {
  const { t } = useLanguageStore();
  const running = state === 'running';
  const label = t(running ? op.runKey : op.doneKey, op.params);
  const isFile = op.kind === 'file' && !!op.file;
  const Icon = op.fileStatus === 'read' ? FileText : FileCode;

  const icon = running
    ? <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: ACCENT }} />
    : <Check className="h-3.5 w-3.5" style={{ color: op.fileStatus === 'modified' ? ACCENT : '#86A08F' }} />;

  const body = (
    <>
      <span className="mt-[1px] flex h-4 w-4 shrink-0 items-center justify-center">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          {isFile && <Icon className="h-3 w-3 shrink-0 text-[#64748B]" />}
          <span className={`truncate text-[12.5px] leading-snug ${running ? 'text-[#94A3B8]' : 'text-[#CBD5E1]'}`}>
            {label}
          </span>
        </span>
        {op.detail && !running && (
          <span className="mt-0.5 block truncate pl-[calc(0.375rem+12px)] text-[11px] text-[#64748B] leading-snug">
            {op.detail}
          </span>
        )}
      </span>
      {(op.added || op.removed) ? (
        <span className="shrink-0 self-start pt-[1px] font-mono text-[10.5px]">
          <span className="text-[#86A08F]">+{op.added || 0}</span>{' '}
          <span className="text-[#C98A93]">−{op.removed || 0}</span>
        </span>
      ) : null}
    </>
  );

  if (isFile) {
    return (
      <button
        onClick={() => onOpenFile(op.file!)}
        className="group flex w-full items-start gap-2 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-white/[0.035]"
      >
        {body}
      </button>
    );
  }
  return <div className="flex items-start gap-2 px-1.5 py-1">{body}</div>;
}

export default function WebBuildExecutionLog({
  step, brief, animate, onOpenFile,
}: {
  step: WebBuildStep;
  brief: { type?: string; audience?: string; goal?: string; style?: string };
  /** Simulate the sequential reveal (only for the newest step). */
  animate: boolean;
  onOpenFile: (path: string) => void;
}) {
  const ops = useMemo(() => deriveExecutionOps(step, brief), [step, brief]);
  const total = ops.length;
  const [doneCount, setDoneCount] = useState(animate ? 0 : total);

  useEffect(() => {
    if (!animate) { setDoneCount(total); return; }
    setDoneCount(0);
    let acc = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 0; i < total; i++) {
      acc += opDuration(ops[i]);
      timers.push(setTimeout(() => setDoneCount(i + 1), acc));
    }
    return () => timers.forEach(clearTimeout);
  }, [ops, animate, total]);

  if (total === 0) return null;

  // The op at `doneCount` (if any) is currently running; earlier ops are done.
  const visible = Math.min(total, doneCount + 1);

  return (
    <div className="space-y-0.5">
      {ops.slice(0, visible).map((op, i) => (
        <OpRow
          key={op.id}
          op={op}
          state={i < doneCount ? 'done' : 'running'}
          onOpenFile={onOpenFile}
        />
      ))}
    </div>
  );
}
