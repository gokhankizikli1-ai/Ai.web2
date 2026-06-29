// DeliverablePreviewModal — Phase C — preview a completed orchestrator
// deliverable. HTML deliverables (the Landing Page vertical's
// `landing_page_html`) render in a sandboxed iframe with a client-side
// download; text deliverables (research brief, brand brief, copy
// variants, wireframe) render as formatted text. Copy-to-clipboard for
// both.
//
// Generic by design: it switches on the deliverable's shape, so it works
// for ANY orchestrator deliverable, not just landing pages. No backend
// calls — it renders the content already present in the run snapshot, so
// it is flag-agnostic and adds no new network surface.
import { useCallback, useMemo, useState } from 'react';
import { X, Download, Copy, Check, ExternalLink } from 'lucide-react';
import type { DeliverableView } from '@/hooks/useProjectOrchestrator';

function extractText(d: DeliverableView): string {
  const c = d.content as Record<string, unknown> | undefined;
  if (c && typeof c.text === 'string') return c.text;
  if (typeof d.content === 'string') return d.content as unknown as string;
  try { return JSON.stringify(d.content, null, 2); } catch { return ''; }
}

function looksLikeHtml(kind: string, text: string): boolean {
  if (kind === 'landing_page_html') return true;
  const head = text.trimStart().slice(0, 200).toLowerCase();
  return head.startsWith('<!doctype html') || head.startsWith('<html');
}

export default function DeliverablePreviewModal({
  deliverable, onClose,
}: {
  deliverable: DeliverableView | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const text = useMemo(() => deliverable ? extractText(deliverable) : '', [deliverable]);
  const isHtml = useMemo(
    () => deliverable ? looksLikeHtml(deliverable.kind, text) : false,
    [deliverable, text],
  );

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard may be blocked; ignore */ }
  }, [text]);

  const download = useCallback(() => {
    if (!deliverable) return;
    const blob = new Blob([text], { type: isHtml ? 'text/html' : 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${deliverable.node_id || deliverable.kind}${isHtml ? '.html' : '.txt'}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [deliverable, text, isHtml]);

  const openInTab = useCallback(() => {
    const w = window.open('', '_blank');
    if (w) { w.document.open(); w.document.write(text); w.document.close(); }
  }, [text]);

  if (!deliverable) return null;

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
            <p className="text-[10px] text-white/30">{deliverable.kind} · {deliverable.agent_id}</p>
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
              srcDoc={text}
              sandbox=""
              className="w-full h-[70vh] bg-white"
            />
          ) : (
            <pre className="text-[12px] text-white/75 whitespace-pre-wrap break-words px-4 py-3 leading-relaxed">{text}</pre>
          )}
        </div>
      </div>
    </div>
  );
}
