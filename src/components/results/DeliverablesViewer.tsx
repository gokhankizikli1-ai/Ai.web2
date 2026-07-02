// DeliverablesViewer — Sprint 1.7 — renders EVERY deliverable of a run.
//
// Each deliverable's artifact carries a generic `preview` hint
// (iframe | code | markdown | file_tree). We branch ONLY on that hint and reuse
// the existing leaf renderers (MarkdownMessage, CodeBlock, sandboxed iframe) —
// never any website/vertical-specific code. Unsupported/unknown → generic
// markdown/text fallback. The existing DeliverablePreviewModal provides the
// rich full-screen "Open" view (device toolbar, download, etc.).
import { useState, useCallback } from 'react';
import { ChevronDown, ChevronRight, Copy, Check, Download, Maximize2, FileCode } from 'lucide-react';
import MarkdownMessage from '@/components/MarkdownMessage';
import CodeBlock from '@/components/CodeBlock';
import DeliverablePreviewModal from '@/components/DeliverablePreviewModal';
import { wrapWithPremiumCss } from '@/lib/previewHtml';
import type { DeliverableView, Artifact } from '@/hooks/useProjectOrchestrator';
import { describeStatus } from '@/lib/runStatus';

interface Resolved {
  preview:  string;
  body:     string;
  files:    Array<{ path: string; content: string; language: string }>;
  language: string;
  type:     string;
  filename: string;
  mime:     string;
  hasArtifact: boolean;
}

function resolve(d: DeliverableView): Resolved {
  const c = (d.content || {}) as Record<string, unknown>;
  const art = c.artifact as Artifact | undefined;
  if (art && typeof art.content === 'string') {
    return {
      preview: art.preview || 'markdown',
      body: art.content,
      files: art.files || [],
      language: art.language || 'text',
      type: art.type || d.kind,
      filename: art.download?.filename || `${d.node_id || d.kind}.txt`,
      mime: art.download?.mime || 'text/plain',
      hasArtifact: true,
    };
  }
  const text = typeof c.text === 'string' ? c.text : '';
  return {
    preview: 'markdown', body: text, files: [], language: 'text',
    type: d.kind, filename: `${d.node_id || d.kind}.txt`, mime: 'text/plain',
    hasArtifact: !!text,
  };
}

function humanAgent(id: string): string {
  const upcase = new Set(['ux', 'ui', 'api', 'qa', 'seo']);
  return (id || '').split('_').map(w => upcase.has(w) ? w.toUpperCase()
    : w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export default function DeliverablesViewer({ deliverables }: { deliverables: DeliverableView[] }) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (deliverables.length === 0) {
    return <p className="text-[12px] text-white/30 px-1 py-2">No deliverables for this run.</p>;
  }

  return (
    <div className="space-y-2">
      {deliverables.map((d, i) => (
        <DeliverableCard key={d.id} deliverable={d} defaultOpen={i === 0} onOpenModal={() => setOpenId(d.id)} />
      ))}
      <DeliverablePreviewModal
        deliverable={deliverables.find(d => d.id === openId) || null}
        onClose={() => setOpenId(null)}
      />
    </div>
  );
}

function DeliverableCard({
  deliverable, defaultOpen, onOpenModal,
}: {
  deliverable: DeliverableView;
  defaultOpen: boolean;
  onOpenModal: () => void;
}) {
  const r = resolve(deliverable);
  const status = describeStatus(deliverable.status);
  const previewable = deliverable.status === 'completed' && r.hasArtifact;
  const [open, setOpen] = useState(defaultOpen && previewable);
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(r.body);
      setCopied(true); setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  }, [r.body]);

  const download = useCallback(() => {
    const blob = new Blob([r.body], { type: r.mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = r.filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }, [r.body, r.mime, r.filename]);

  return (
    <div className="rounded-xl border border-white/[0.05] bg-white/[0.01] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          onClick={() => previewable && setOpen(o => !o)}
          disabled={!previewable}
          className="flex items-center gap-2 min-w-0 flex-1 text-left disabled:cursor-default"
        >
          {previewable
            ? (open ? <ChevronDown className="h-3.5 w-3.5 text-white/40 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-white/40 shrink-0" />)
            : <span className="w-3.5 shrink-0" />}
          <status.Icon className={`h-3.5 w-3.5 shrink-0 ${status.spin ? 'animate-spin' : ''}`} style={{ color: status.dot }} />
          <div className="min-w-0">
            <p className="text-[12px] text-white/75 truncate">{deliverable.title || deliverable.kind}</p>
            <p className="text-[9px] text-white/30">{humanAgent(deliverable.agent_id)} · {r.type}</p>
          </div>
        </button>
        {previewable && (
          <div className="flex items-center gap-1 shrink-0">
            <IconBtn title={copied ? 'Copied' : 'Copy'} onClick={copy}>
              {copied ? <Check className="h-3 w-3 text-[#4ADE80]" /> : <Copy className="h-3 w-3" />}
            </IconBtn>
            <IconBtn title="Download" onClick={download}><Download className="h-3 w-3" /></IconBtn>
            <IconBtn title="Open full preview" onClick={onOpenModal}><Maximize2 className="h-3 w-3" /></IconBtn>
          </div>
        )}
      </div>

      {/* Inline preview (branches only on the generic `preview` hint) */}
      {open && previewable && (
        <div className="px-3 pb-3 border-t border-white/[0.04] pt-2">
          <ArtifactInline resolved={r} title={deliverable.title || deliverable.kind} id={deliverable.id} />
        </div>
      )}

      {deliverable.status === 'failed' && deliverable.error && (
        <p className="px-3 pb-2 text-[10px] text-[#F87171]/70">{deliverable.error}</p>
      )}
    </div>
  );
}

function ArtifactInline({ resolved, title, id }: { resolved: Resolved; title: string; id: string }) {
  const preview = (resolved.preview || '').toLowerCase();
  if (preview === 'iframe' && resolved.body) {
    return (
      <iframe
        // Force a fresh DOM node (not just a srcDoc mutation) whenever the
        // deliverable identity OR its content changes, so a re-run never
        // leaves stale in-page JS state / scroll position behind.
        key={`${id}-${resolved.body.length}`}
        title={title}
        srcDoc={wrapWithPremiumCss(resolved.body)}
        sandbox="allow-scripts"
        className="w-full rounded-lg"
        style={{ height: '50vh', border: 'none', background: '#0b0b10' }}
      />
    );
  }
  if (preview === 'file_tree' && resolved.files.length > 0) {
    return (
      <div className="space-y-2">
        {resolved.files.map((f, i) => (
          <div key={`${f.path}-${i}`}>
            <p className="flex items-center gap-1.5 text-[11px] text-[#A78BFA]/80 mb-1">
              <FileCode className="h-3 w-3" /> {f.path}
            </p>
            <CodeBlock language={f.language || 'text'}>{f.content}</CodeBlock>
          </div>
        ))}
      </div>
    );
  }
  if (preview === 'code' && resolved.body) {
    return <CodeBlock language={resolved.language}>{resolved.body}</CodeBlock>;
  }
  // markdown | none | unknown future → safe readable default.
  return <MarkdownMessage content={resolved.body} />;
}

function IconBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="p-1 rounded-md text-white/40 hover:text-white/80 hover:bg-white/[0.05] transition-colors"
    >
      {children}
    </button>
  );
}
