// DeliverablePreviewModal — EPIC 1 / M2 — the central Artifact Preview area.
//
// Renders a completed deliverable's typed artifact prominently with
// Preview / Copy / Download / Open:
//   * html            → sandboxed iframe + "Open in new tab" + download .html
//   * react_component / project_file → code view + download
//   * file_tree       → file list + per-file code + download bundle
//   * markdown / text → formatted text
//
// Artifact-aware but backwards compatible: pre-M2 deliverables carry only
// `content.text` and still render as text. No backend calls — it renders
// content already present in the run snapshot.
import { useCallback, useMemo, useState } from 'react';
import { X, Download, Copy, Check, ExternalLink, FileCode } from 'lucide-react';
import type { DeliverableView, Artifact } from '@/hooks/useProjectOrchestrator';

interface Resolved {
  type:     string;
  preview:  'iframe' | 'code' | 'markdown' | 'file_tree';
  body:     string;
  files:    Array<{ path: string; content: string; language: string }>;
  filename: string;
  mime:     string;
}

function resolve(d: DeliverableView): Resolved {
  const c = (d.content || {}) as Record<string, unknown>;
  const art = c.artifact as Artifact | undefined;
  if (art && typeof art.content === 'string') {
    return {
      type: art.type,
      preview: art.preview,
      body: art.content,
      files: art.files || [],
      filename: art.download?.filename || `${d.node_id || d.kind}.txt`,
      mime: art.download?.mime || 'text/plain',
    };
  }
  // Legacy fallback — pre-M2 deliverables only have `content.text`.
  const text = typeof c.text === 'string' ? c.text
    : (typeof d.content === 'string' ? (d.content as unknown as string) : '');
  const head = text.trimStart().slice(0, 200).toLowerCase();
  const isHtml = d.kind === 'landing_page_html'
    || head.startsWith('<!doctype html') || head.startsWith('<html');
  return {
    type: isHtml ? 'html' : 'markdown',
    preview: isHtml ? 'iframe' : 'markdown',
    body: text,
    files: [],
    filename: `${d.node_id || d.kind}${isHtml ? '.html' : '.txt'}`,
    mime: isHtml ? 'text/html' : 'text/plain',
  };
}

export default function DeliverablePreviewModal({
  deliverable, onClose,
}: {
  deliverable: DeliverableView | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const r = useMemo(() => deliverable ? resolve(deliverable) : null, [deliverable]);

  const copy = useCallback(async () => {
    if (!r) return;
    try {
      await navigator.clipboard.writeText(r.body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard may be blocked; ignore */ }
  }, [r]);

  const download = useCallback(() => {
    if (!r) return;
    const blob = new Blob([r.body], { type: r.mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = r.filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }, [r]);

  const openInTab = useCallback(() => {
    if (!r) return;
    const w = window.open('', '_blank');
    if (w) { w.document.open(); w.document.write(r.body); w.document.close(); }
  }, [r]);

  if (!deliverable || !r) return null;
  const isHtml = r.preview === 'iframe';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}>
      <div
        className="w-full max-w-3xl max-h-[85vh] flex flex-col rounded-2xl overflow-hidden"
        style={{ background: 'rgba(17,21,28,0.98)', border: '1px solid rgba(255,255,255,0.08)' }}
        onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-white/80 truncate">{deliverable.title || deliverable.kind}</p>
            <p className="text-[10px] text-white/30">{r.type} · {deliverable.agent_id}</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button onClick={copy} title="Copy" className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] text-white/50 hover:text-white/80 transition-colors" style={{ background: 'rgba(255,255,255,0.03)' }}>
              {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />} {copied ? 'Copied' : 'Copy'}
            </button>
            {isHtml && (
              <button onClick={openInTab} title="Open in new tab" className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] text-white/50 hover:text-white/80 transition-colors" style={{ background: 'rgba(255,255,255,0.03)' }}>
                <ExternalLink className="h-3 w-3" /> Open
              </button>
            )}
            <button onClick={download} title="Download" className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] text-cyan-300 transition-colors" style={{ background: 'rgba(34,211,238,0.08)' }}>
              <Download className="h-3 w-3" /> Download
            </button>
            <button onClick={onClose} aria-label="Close" className="p-1 rounded-lg text-white/40 hover:text-white/80 transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto">
          {isHtml ? (
            <iframe
              title={`preview-${deliverable.id}`}
              srcDoc={r.body}
              sandbox=""
              className="w-full h-[70vh] bg-white"
            />
          ) : r.preview === 'file_tree' && r.files.length > 0 ? (
            <div className="px-4 py-3 space-y-3">
              {r.files.map((f, i) => (
                <div key={`${f.path}-${i}`}>
                  <p className="flex items-center gap-1.5 text-[11px] text-cyan-300/80 mb-1">
                    <FileCode className="h-3 w-3" /> {f.path}
                  </p>
                  <pre className="text-[11px] text-white/70 whitespace-pre-wrap break-words rounded-lg px-3 py-2"
                    style={{ background: 'rgba(255,255,255,0.02)' }}>{f.content}</pre>
                </div>
              ))}
            </div>
          ) : (
            <pre className="text-[12px] text-white/75 whitespace-pre-wrap break-words px-4 py-3 leading-relaxed">{r.body}</pre>
          )}
        </div>
      </div>
    </div>
  );
}
