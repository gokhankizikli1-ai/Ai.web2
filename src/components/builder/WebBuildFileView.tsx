import { useMemo, useState } from 'react';
import { FileCode, Copy, Check } from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';
import type { WebBuildFile } from '@/lib/webBuildPayload';

/**
 * Claude/Kimi-style "All files" view: a file list (path · status · +N −M) on
 * the left, and the selected file's code on the right with a copy button.
 * Line counts and created/modified come from real parsed code + diffs; we do
 * not invent removed lines when nothing was modified.
 */
const ACCENT = '#60A5FA';

const STATUS_KEY: Record<WebBuildFile['status'], string> = {
  created: 'wbFileCreated', modified: 'wbFileModified', unchanged: 'wbFileUnchanged',
};
const STATUS_TONE: Record<WebBuildFile['status'], string> = {
  created: 'text-[#86A08F] bg-[#4ADE80]/[0.08] border-[#4ADE80]/25',
  modified: 'text-[#60A5FA] bg-[#3B82F6]/[0.08] border-[#3B82F6]/25',
  unchanged: 'text-[#64748B] bg-white/[0.03] border-white/[0.06]',
};

function CopyButton({ text }: { text: string }) {
  const { t } = useLanguageStore();
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* ignore */ } }}
      className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.07] bg-white/[0.03] px-2.5 py-1 text-[11px] text-slate-200 hover:bg-white/[0.06] transition-colors"
    >
      {copied ? <Check className="h-3 w-3" style={{ color: ACCENT }} /> : <Copy className="h-3 w-3" />}
      {copied ? t('copied') : t('copy')}
    </button>
  );
}

export default function WebBuildFileView({ files }: { files: WebBuildFile[] }) {
  const { t } = useLanguageStore();
  const ordered = useMemo(
    () => [...files].sort((a, b) => a.path.localeCompare(b.path)),
    [files],
  );
  const [active, setActive] = useState(0);
  const file = ordered[Math.min(active, ordered.length - 1)];

  if (ordered.length === 0) {
    return <div className="rounded-xl border border-dashed border-white/[0.08] px-4 py-8 text-center text-[12px] text-[#64748B]">{t('wbNoCode')}</div>;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-[minmax(200px,240px)_1fr] gap-3 min-h-0">
      {/* File list */}
      <div className="space-y-0.5 md:max-h-[60vh] md:overflow-y-auto scrollbar-thin">
        {ordered.map((f, i) => {
          const on = i === Math.min(active, ordered.length - 1);
          return (
            <button
              key={f.path}
              onClick={() => setActive(i)}
              className={`w-full text-left rounded-lg px-2.5 py-2 transition-colors ${on ? 'bg-white/[0.05]' : 'hover:bg-white/[0.025]'}`}
            >
              <div className="flex items-center gap-1.5">
                <FileCode className="h-3 w-3 shrink-0 text-[#64748B]" />
                <span className="text-[12px] font-mono text-slate-200 truncate">{f.path}</span>
              </div>
              <div className="mt-1 flex items-center gap-1.5 pl-[18px]">
                <span className={`inline-flex items-center rounded px-1.5 py-[1px] text-[9.5px] font-medium border ${STATUS_TONE[f.status]}`}>
                  {t(STATUS_KEY[f.status])}
                </span>
                {(f.added > 0 || f.removed > 0) && (
                  <span className="text-[10px] font-mono">
                    <span className="text-[#86A08F]">+{f.added}</span>{' '}
                    <span className="text-[#C98A93]">−{f.removed}</span>
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Code panel */}
      <div className="min-w-0 rounded-xl border border-white/[0.06] bg-[#0D1117] overflow-hidden">
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-white/[0.05]">
          <span className="text-[11.5px] font-mono text-slate-300 truncate">{file.path}</span>
          {file.content && <CopyButton text={file.content} />}
        </div>
        {file.content ? (
          <pre className="p-3 text-[11.5px] leading-relaxed text-[#CBD5E1] font-mono overflow-x-auto md:max-h-[54vh] md:overflow-y-auto scrollbar-thin">
            <code>{file.content}</code>
          </pre>
        ) : (
          <div className="px-4 py-8 text-center text-[12px] text-[#64748B]">{t('wbNoCode')}</div>
        )}
      </div>
    </div>
  );
}
