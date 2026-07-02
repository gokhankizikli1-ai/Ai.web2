// PreviewResult — Sprint 1.6 — renders a Deliverable Result PreviewPayload.
//
// Renderer-AGNOSTIC: it branches ONLY on the generic `renderer` string hint
// (iframe / code / markdown / file_tree / none / <future>), never on a
// vertical. The exact same component therefore renders Website Builder,
// Startup, Research, Game, Trading and Ecommerce output with NO change. It
// reuses the existing leaf renderers (MarkdownMessage, CodeBlock, the
// sandboxed-iframe pattern from DeliverablePreviewModal) — minimal glue, no
// new rendering system. Nothing here is fabricated: it only shows what the
// resolver returned.
import { Loader2, AlertTriangle, Ban, FileCode, Inbox } from 'lucide-react';
import MarkdownMessage from './MarkdownMessage';
import CodeBlock from './CodeBlock';
import { wrapWithPremiumCss } from '@/lib/previewHtml';
import type { PreviewPayload } from '@/types/preview';
import type { OrchestratePhase } from '@/hooks/useOrchestrateResult';

interface PreviewResultProps {
  phase:                  OrchestratePhase;
  label:                  string;
  payload:                PreviewPayload | null;
  error?:                 string | null;
  disabledReason?:        string | null;
  disabledPrerequisites?: string[];
  onRetry?:               () => void;
}

// Pull the per-file list out of the renderer-agnostic structured_data blob.
function filesOf(payload: PreviewPayload): Array<{ path: string; content: string; language?: string }> {
  const sd = payload.structured_data as Record<string, unknown> | null;
  const files = sd && Array.isArray(sd.files) ? sd.files : [];
  return files.filter(
    (f): f is { path: string; content: string; language?: string } =>
      !!f && typeof f === 'object' && typeof (f as { content?: unknown }).content === 'string',
  );
}

function languageOf(payload: PreviewPayload): string {
  const sd = payload.structured_data as Record<string, unknown> | null;
  const lang = sd && typeof sd.language === 'string' ? sd.language : '';
  return lang || payload.artifact_type || 'text';
}

export default function PreviewResult({
  phase, label, payload, error, disabledReason, disabledPrerequisites = [], onRetry,
}: PreviewResultProps) {
  // ── Non-terminal: planning / running / rendering ─────────────────────────
  if (phase === 'planning' || phase === 'running' || phase === 'rendering') {
    return (
      <StatusCard tone="busy" icon={<Loader2 className="w-4 h-4 animate-spin text-[#7EA6BF]" />} title={label}>
        <p className="text-[12px] text-[#7F8FA3]">
          {phase === 'planning' && 'Understanding the request and preparing the run…'}
          {phase === 'running' && 'Agents are working on the deliverables…'}
          {phase === 'rendering' && 'Assembling the result…'}
        </p>
        {payload?.summary && <p className="text-[12px] text-[#A9B7C6] mt-2">{payload.summary}</p>}
      </StatusCard>
    );
  }

  // ── Feature gate off (bridge / result API / prerequisites) ───────────────
  if (phase === 'disabled') {
    return (
      <StatusCard tone="muted" icon={<Ban className="w-4 h-4 text-[#C2A15A]" />} title="Execution unavailable">
        <p className="text-[12px] text-[#A9B7C6]">{disabledReason || 'This capability is disabled on the server.'}</p>
        {disabledPrerequisites.length > 0 && (
          <div className="mt-2">
            <p className="text-[11px] text-[#7F8FA3] mb-1">Disabled prerequisites:</p>
            <div className="flex flex-wrap gap-1.5">
              {disabledPrerequisites.map((p) => (
                <span key={p} className="px-1.5 py-0.5 rounded bg-white/[0.03] text-[10px] text-[#7F8FA3] font-mono">{p}</span>
              ))}
            </div>
          </div>
        )}
      </StatusCard>
    );
  }

  // ── Errors / not found ───────────────────────────────────────────────────
  if (phase === 'error' || phase === 'not_found' || phase === 'failed' || phase === 'cancelled') {
    const isFail = phase === 'failed';
    const title = phase === 'not_found' ? 'Run not found'
      : phase === 'cancelled' ? 'Run cancelled'
      : isFail ? 'Run failed' : 'Something went wrong';
    const errs = payload?.errors?.length ? payload.errors : (error ? [error] : []);
    return (
      <StatusCard tone="error" icon={<AlertTriangle className="w-4 h-4 text-[#C98282]" />} title={title}>
        {errs.length > 0 ? (
          <ul className="text-[12px] text-[#A9B7C6] list-disc list-inside space-y-0.5">
            {errs.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        ) : (
          <p className="text-[12px] text-[#7F8FA3]">No further detail was reported.</p>
        )}
        {onRetry && (
          <button onClick={onRetry} className="mt-3 px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.05] text-[12px] text-slate-300 hover:bg-white/[0.05] transition-colors">
            Try again
          </button>
        )}
      </StatusCard>
    );
  }

  // ── Completed (with or without an artifact) ──────────────────────────────
  if (phase === 'completed' && payload) {
    const status = payload.status;
    if (status === 'completed_no_artifact' || status === 'artifact_not_found') {
      return (
        <StatusCard tone="muted" icon={<Inbox className="w-4 h-4 text-[#A9B7C6]" />} title="Run finished — no preview">
          <p className="text-[12px] text-[#A9B7C6]">
            {payload.warnings?.[0] || 'The run completed but produced no previewable artifact.'}
          </p>
        </StatusCard>
      );
    }
    return <RenderedArtifact payload={payload} />;
  }

  // ── Idle ─────────────────────────────────────────────────────────────────
  return null;
}

// Renders the actual artifact body using the generic `renderer` hint.
function RenderedArtifact({ payload }: { payload: PreviewPayload }) {
  const renderer = (payload.renderer || '').toLowerCase();
  const body = payload.content ?? '';
  const html = payload.html_preview ?? body;
  const files = filesOf(payload);

  let view: React.ReactNode;
  if (renderer === 'iframe' && html) {
    // Same sandbox policy as DeliverablePreviewModal: allow-scripts WITHOUT
    // allow-same-origin → inline prototype JS runs in an opaque origin with no
    // access to parent, cookies or storage.
    view = (
      <iframe
        key={payload.artifact_id || payload.run_id || payload.title || 'preview'}
        title={payload.title || 'preview'}
        srcDoc={wrapWithPremiumCss(html)}
        sandbox="allow-scripts"
        className="w-full rounded-lg"
        style={{ height: '60vh', border: 'none', background: '#0b0b10' }}
      />
    );
  } else if (renderer === 'file_tree' && files.length > 0) {
    view = (
      <div className="space-y-3">
        {files.map((f, i) => (
          <div key={`${f.path}-${i}`}>
            <p className="flex items-center gap-1.5 text-[11px] text-[#9CBBD1]/80 mb-1">
              <FileCode className="h-3 w-3" /> {f.path}
            </p>
            <CodeBlock language={f.language || 'text'}>{f.content}</CodeBlock>
          </div>
        ))}
      </div>
    );
  } else if (renderer === 'code' && body) {
    view = <CodeBlock language={languageOf(payload)}>{body}</CodeBlock>;
  } else if (body) {
    // markdown | none | unknown-future renderer → safe, readable default.
    view = <MarkdownMessage content={body} />;
  } else {
    view = <p className="text-[12px] text-[#7F8FA3]">{payload.summary || 'No content was returned.'}</p>;
  }

  return (
    <div className="space-y-3">
      {(payload.title || payload.artifact_type) && (
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium text-white truncate">{payload.title || payload.artifact_type}</h3>
          {payload.artifact_type && (
            <span className="px-1.5 py-0.5 rounded bg-white/[0.03] text-[10px] text-[#7F8FA3] font-mono shrink-0">
              {payload.artifact_type}
            </span>
          )}
        </div>
      )}
      <div className="p-4 rounded-2xl border border-white/[0.03] bg-white/[0.01]">{view}</div>
      {payload.warnings.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {payload.warnings.map((w, i) => (
            <span key={i} className="px-1.5 py-0.5 rounded bg-[#C2A15A]/[0.06] text-[10px] text-[#C2A15A]/80">{w}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusCard({
  tone, icon, title, children,
}: {
  tone: 'busy' | 'muted' | 'error';
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  const border = tone === 'error' ? 'border-[#C98282]/15'
    : tone === 'busy' ? 'border-[#7EA6BF]/15' : 'border-white/[0.04]';
  return (
    <div className={`p-5 rounded-2xl border ${border} bg-white/[0.01]`}>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-[13px] font-medium text-white">{title}</span>
      </div>
      {children}
    </div>
  );
}
