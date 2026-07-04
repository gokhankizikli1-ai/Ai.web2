import { Loader2, Brain, FileText, FilePlus2, FilePenLine, Globe } from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';
import type { RunRow, ToolType } from '@/lib/webBuildRun';

/**
 * A Claude/Kimi-style tool-call block for the Web Build coding run. Compact,
 * dark, subtle. One block = one operation: Thinking, Read file, Create file,
 * Edit file, or Create/Update preview. Shows a running spinner while in
 * progress and a +N −M diff when completed (NO green-tick waterfall, no emoji,
 * no table). File blocks are clickable and open the code drawer on that file.
 */
const TOOL_ICON: Record<ToolType, typeof FileText> = {
  think: Brain,
  read_file: FileText,
  create_file: FilePlus2,
  edit_file: FilePenLine,
  preview: Globe,
};

export default function WebBuildToolCallBlock({
  row, onOpenFile,
}: {
  row: Extract<RunRow, { kind: 'tool' }>;
  onOpenFile: (path: string) => void;
}) {
  const { t } = useLanguageStore();
  const running = row.status === 'running';
  const Icon = TOOL_ICON[row.toolType];
  const summary = row.summary || (row.summaryKey ? t(row.summaryKey) : undefined);
  const hasDiff = (row.added || 0) > 0 || (row.removed || 0) > 0;
  const clickable = row.clickable && !!row.filePath && !running;

  const inner = (
    <>
      <span className="mt-[1px] flex h-4 w-4 shrink-0 items-center justify-center">
        {running
          ? <Loader2 className="h-3.5 w-3.5 animate-spin text-[#60A5FA]" />
          : <Icon className="h-3.5 w-3.5 text-[#64748B] group-hover:text-[#94A3B8]" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className={`text-[12px] font-medium ${running ? 'text-[#94A3B8]' : 'text-[#CBD5E1]'}`}>
            {t(row.titleKey)}
          </span>
          {row.filePath && (
            <span className="truncate font-mono text-[11.5px] text-slate-200">{row.filePath}</span>
          )}
        </span>
        {summary && <span className="mt-0.5 block truncate text-[11px] text-[#64748B]">{summary}</span>}
      </span>
      <span className="shrink-0 self-start pt-[1px]">
        {running
          ? <span className="text-[10.5px] text-[#64748B]">{t('wbToolRunning')}</span>
          : hasDiff
            ? (
              <span className="font-mono text-[10.5px]">
                <span className="text-[#86A08F]">+{row.added}</span>{' '}
                <span className="text-[#C98A93]">-{row.removed}</span>
              </span>
            )
            : null}
      </span>
    </>
  );

  const cls = 'group flex w-full items-start gap-2.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2 text-left transition-colors';

  if (clickable) {
    return (
      <button onClick={() => onOpenFile(row.filePath!)} className={`${cls} hover:border-white/[0.12] hover:bg-white/[0.04]`}>
        {inner}
      </button>
    );
  }
  return <div className={cls}>{inner}</div>;
}
