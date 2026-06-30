// RunResultDetails — Sprint 1.7 — everything about ONE selected run.
//
// Composes EXISTING contracts only:
//   * useProjectRun(runId)  → snapshot (run metadata + full deliverables)
//   * useRunResult(runId)   → the Sprint 1.5 PreviewPayload (headline result)
//   * <PreviewResult/>      → Sprint 1.6 renderer-agnostic result view
//   * <DeliverablesViewer/> → every deliverable
//   * <ExecutionTimeline/>  → pure pipeline visualization
// No new endpoints, no fabricated data. Every value shown comes from the
// backend snapshot or the result payload.
import { useCallback, useState } from 'react';
import { X, RotateCcw, Radio, ChevronDown, ChevronRight, Layers } from 'lucide-react';
import {
  projectOrchestratorClient, useProjectRun, isRunTerminal,
  type DeliverableView,
} from '@/hooks/useProjectOrchestrator';
import { useRunResult } from '@/hooks/useRunResult';
import PreviewResult from '@/components/PreviewResult';
import DeliverablesViewer from '@/components/results/DeliverablesViewer';
import ExecutionTimeline from '@/components/results/ExecutionTimeline';
import { describeStatus } from '@/lib/runStatus';
import { formatAbsolute, formatDuration } from '@/lib/time';

interface RunResultDetailsProps {
  runId:          string | null;
  promptFallback?: string;
}

export default function RunResultDetails({ runId, promptFallback }: RunResultDetailsProps) {
  const { snapshot, loading, error, isTerminal, refresh } = useProjectRun(runId);
  const result = useRunResult(runId);

  const run = (snapshot?.run || undefined) as Record<string, unknown> | undefined;
  const meta = (run?.metadata || {}) as Record<string, unknown>;
  const deliverables: DeliverableView[] = snapshot?.deliverables || [];

  const prompt = String(meta.user_request || promptFallback || '') || 'Untitled run';
  const workspace = String(meta.workspace || '');
  const status = snapshot?.status || (runId ? 'pending' : '');
  const desc = describeStatus(status);
  const started = (run?.started_at as string) || (run?.created_at as string) || null;
  const finished = (run?.finished_at as string) || null;
  const running = !!runId && !isTerminal && !isRunTerminal(status);

  const cancel = useCallback(async () => {
    if (!runId) return;
    try { await projectOrchestratorClient.cancelRun(runId); refresh(); }
    catch { /* surfaced on next poll */ }
  }, [runId, refresh]);

  // ── No selection ─────────────────────────────────────────────────────────
  if (!runId) {
    return (
      <Center>
        <Layers className="h-6 w-6 text-white/20 mb-2" />
        <p className="text-[13px] text-white/50">Select a run</p>
        <p className="text-[11px] text-white/30 mt-1">Pick a run from the history to see its result and deliverables.</p>
      </Center>
    );
  }

  // ── Run not found (stale id / cross-user) ─────────────────────────────────
  if (!snapshot && error && /not.?found/i.test(error)) {
    return (
      <Center>
        <X className="h-6 w-6 text-white/25 mb-2" />
        <p className="text-[13px] text-white/55">Run not available</p>
        <p className="text-[11px] text-white/30 mt-1">This run could not be found or isn't accessible.</p>
      </Center>
    );
  }

  // ── Loading first snapshot ────────────────────────────────────────────────
  if (!snapshot && loading) {
    return (
      <div className="p-4 space-y-3">
        <div className="h-6 w-2/3 rounded bg-white/[0.03] animate-pulse" />
        <div className="h-4 w-1/3 rounded bg-white/[0.03] animate-pulse" />
        <div className="h-24 rounded-xl bg-white/[0.02] animate-pulse" />
        <div className="h-40 rounded-xl bg-white/[0.02] animate-pulse" />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full">
      {/* Header */}
      <div>
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-[15px] font-semibold text-white/90 leading-snug">{prompt}</h2>
          <span className="flex items-center gap-1.5 shrink-0 px-2 py-1 rounded-lg text-[11px]"
            style={{ background: 'rgba(255,255,255,0.03)', color: desc.dot }}>
            <desc.Icon className={`h-3.5 w-3.5 ${desc.spin ? 'animate-spin' : ''}`} />
            {desc.label}
          </span>
        </div>
        <p className="text-[11px] text-white/40 mt-1">{desc.description}</p>

        {/* Meta row */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-[11px] text-white/40">
          {workspace && <Meta k="Workspace" v={workspace} />}
          <Meta k="Created" v={formatAbsolute(started)} />
          <Meta k="Duration" v={formatDuration(started, finished)} />
          {running && (
            <span className="flex items-center gap-1 text-cyan-400/70">
              <Radio className="h-3 w-3 animate-pulse" /> Live · updating
            </span>
          )}
          {!!error && snapshot && (
            <span className="text-amber-400/70">reconnecting…</span>
          )}
          {running && (
            <button onClick={cancel} className="flex items-center gap-1 text-white/40 hover:text-red-300 transition-colors">
              <X className="h-3 w-3" /> Cancel
            </button>
          )}
        </div>
      </div>

      {/* Execution timeline */}
      <Section title="Execution">
        <ExecutionTimeline runStatus={status} resultStatus={result.payload?.status ?? null} />
      </Section>

      {/* Headline result (Sprint 1.6 PreviewResult) */}
      <Section title="Result"
        action={
          <button onClick={result.refresh} title="Refresh result"
            className="p-1 rounded-md text-white/35 hover:text-white/70 hover:bg-white/[0.04] transition-colors">
            <RotateCcw className="h-3 w-3" />
          </button>
        }>
        {result.loading && !result.payload ? (
          <div className="h-24 rounded-xl bg-white/[0.02] animate-pulse" />
        ) : (
          <PreviewResult
            phase={result.availability === 'disabled' ? 'disabled' : result.phase}
            label={result.label}
            payload={result.payload}
            error={result.error}
            disabledReason={result.availability === 'disabled'
              ? 'The Deliverable Result API is disabled on the server (ENABLE_DELIVERABLE_RESULT_API).'
              : null}
            onRetry={result.refresh}
          />
        )}
      </Section>

      {/* Every deliverable */}
      <Section title={`Deliverables (${deliverables.length})`}>
        <DeliverablesViewer deliverables={deliverables} />
      </Section>

      {/* Execution metadata */}
      <ExecutionMetadata
        runId={runId}
        meta={meta}
        templateId={snapshot?.template_id ?? null}
        workflowId={snapshot?.workflow?.id ?? null}
        renderer={result.payload?.renderer ?? (meta.recommended_renderer as string) ?? null}
        sourceCount={result.payload?.source_deliverables?.length ?? null}
      />
    </div>
  );
}

function ExecutionMetadata({
  runId, meta, templateId, workflowId, renderer, sourceCount,
}: {
  runId: string;
  meta: Record<string, unknown>;
  templateId: string | null;
  workflowId: string | null;
  renderer: string | null;
  sourceCount: number | null;
}) {
  const [open, setOpen] = useState(false);
  const agents = Array.isArray(meta.recommended_agents) ? (meta.recommended_agents as string[]) : [];
  return (
    <div className="rounded-xl border border-white/[0.05] bg-white/[0.01]">
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-2 w-full px-3 py-2 text-left">
        {open ? <ChevronDown className="h-3.5 w-3.5 text-white/40" /> : <ChevronRight className="h-3.5 w-3.5 text-white/40" />}
        <span className="text-[12px] font-medium text-white/60">Execution metadata</span>
      </button>
      {open && (
        <div className="px-3 pb-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
          <KV k="Run ID" v={runId} mono />
          {workflowId && <KV k="Workflow" v={workflowId} mono />}
          {templateId && <KV k="Template" v={templateId} mono />}
          {renderer && <KV k="Renderer" v={renderer} />}
          {meta.source ? <KV k="Source" v={String(meta.source)} /> : null}
          {meta.complexity ? <KV k="Complexity" v={String(meta.complexity)} /> : null}
          {sourceCount !== null && <KV k="Result sources" v={String(sourceCount)} />}
          {agents.length > 0 && (
            <div className="col-span-2">
              <p className="text-white/35 mb-1">Agents</p>
              <div className="flex flex-wrap gap-1">
                {agents.map(a => (
                  <span key={a} className="px-1.5 py-0.5 rounded bg-white/[0.03] text-[10px] text-white/45 font-mono">{a}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Small presentational helpers ───────────────────────────────────────────
function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[11px] font-semibold text-white/45 uppercase tracking-wider">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

function Meta({ k, v }: { k: string; v: string }) {
  return <span><span className="text-white/30">{k}:</span> <span className="text-white/55">{v}</span></span>;
}

function KV({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-white/35">{k}</p>
      <p className={`text-white/60 truncate ${mono ? 'font-mono text-[10px]' : ''}`}>{v}</p>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-6 py-16">
      {children}
    </div>
  );
}
