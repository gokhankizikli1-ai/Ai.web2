// ProjectRunCenter — Phase B/C UX fix — the PRIMARY project surface when
// the Project Orchestrator is enabled.
//
// Replaces "create an agent, then chat it" with "type what you want built".
// The main composer here IS the project-request composer:
//   * No active run → a prominent request box with an Auto default +
//     suggested templates + example prompts.
//   * Active run → live status + agent/task progress + a deliverables
//     grid with preview (reusing DeliverablePreviewModal).
//
// Mounted by ProjectWorkspace ONLY when orchestrator availability resolves
// to `available`; when the orchestrator is disabled (or the probe fails),
// ProjectWorkspace falls back to the normal agent chat — so this component
// never has to handle the disabled state.
//
// Shares the run-id localStorage key with the right-rail ProjectRunPanel so
// the two stay loosely in sync (the rail remains a secondary status view).
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Workflow, Play, Loader2, CheckCircle2, Circle, XCircle,
  MinusCircle, RotateCcw, Sparkles,
} from 'lucide-react';
import {
  projectOrchestratorClient,
  useProjectRun,
  isRunTerminal,
  type TemplateView,
  type DeliverableView,
  type DeliverableStatus,
} from '@/hooks/useProjectOrchestrator';
import DeliverablePreviewModal from '@/components/DeliverablePreviewModal';

function lastRunKey(projectId: string): string {
  return `korvix_project_run_${projectId}`;
}

function deliverableIcon(status: DeliverableStatus) {
  switch (status) {
    case 'completed':   return <CheckCircle2 className="h-4 w-4 text-emerald-400/80" />;
    case 'in_progress': return <Loader2 className="h-4 w-4 text-cyan-400/80 animate-spin" />;
    case 'failed':      return <XCircle className="h-4 w-4 text-red-400/70" />;
    case 'skipped':     return <MinusCircle className="h-4 w-4 text-white/25" />;
    default:            return <Circle className="h-4 w-4 text-white/25" />;
  }
}

function humanAgent(id: string): string {
  const upcase = new Set(['ux', 'ui', 'api', 'qa', 'seo']);
  return id.split('_').map(w => upcase.has(w) ? w.toUpperCase()
    : w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

const STATUS_STYLE: Record<string, { label: string; color: string }> = {
  running:   { label: 'Running',   color: 'rgb(34,211,238)' },
  completed: { label: 'Completed', color: 'rgb(52,211,153)' },
  finished:  { label: 'Completed', color: 'rgb(52,211,153)' },
  failed:    { label: 'Failed',    color: 'rgb(248,113,113)' },
  errored:   { label: 'Failed',    color: 'rgb(248,113,113)' },
  cancelled: { label: 'Cancelled', color: 'rgb(251,191,36)' },
};

const EXAMPLES = [
  'Build me a Shopify landing page for a coffee subscription',
  'Make a research report on the EV charging market',
  'Design a brand and copy for a productivity app',
];

export default function ProjectRunCenter({ projectId }: { projectId: string }) {
  const [templates, setTemplates] = useState<TemplateView[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [request, setRequest] = useState('');
  const [templateId, setTemplateId] = useState<string>('');   // '' = Auto
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);

  const { snapshot, error } = useProjectRun(runId);

  useEffect(() => {
    let active = true;
    projectOrchestratorClient.listTemplates()
      .then(t => { if (active) setTemplates(t); })
      .catch(() => { /* availability handled by parent; ignore here */ });
    try {
      const saved = localStorage.getItem(lastRunKey(projectId));
      if (saved) setRunId(saved);
    } catch { /* ignore */ }
    return () => { active = false; };
  }, [projectId]);

  const persistRun = useCallback((id: string | null) => {
    try {
      if (id) localStorage.setItem(lastRunKey(projectId), id);
      else localStorage.removeItem(lastRunKey(projectId));
    } catch { /* ignore */ }
  }, [projectId]);

  const startRun = useCallback(async () => {
    const userRequest = request.trim();
    if (!userRequest || starting) return;
    setStarting(true);
    setStartError(null);
    try {
      let snap;
      try {
        snap = await projectOrchestratorClient.startRun({
          userRequest, projectId, templateId: templateId || undefined,
        });
      } catch (e: unknown) {
        if ((e as { code?: string })?.code === 'project_not_found') {
          snap = await projectOrchestratorClient.startRun({
            userRequest, templateId: templateId || undefined,
          });
        } else { throw e; }
      }
      setRunId(snap.run_id);
      persistRun(snap.run_id);
      setRequest('');
    } catch (e: unknown) {
      setStartError((e as Error)?.message || 'Failed to start run');
    } finally {
      setStarting(false);
    }
  }, [request, projectId, templateId, starting, persistRun]);

  const cancelRun = useCallback(async () => {
    if (!runId) return;
    try { await projectOrchestratorClient.cancelRun(runId); } catch { /* poll shows status */ }
  }, [runId]);

  const resetRun = useCallback(() => {
    setRunId(null); persistRun(null); setStartError(null);
  }, [persistRun]);

  const notFound = !!runId && !snapshot && /not.?found/i.test(error || '');

  const deliverables: DeliverableView[] = snapshot?.deliverables || [];
  const done = deliverables.filter(d => d.status === 'completed').length;
  const status = snapshot?.status || (runId ? 'running' : '');
  const style = STATUS_STYLE[status] || { label: status, color: 'rgb(148,163,184)' };
  const progress = snapshot?.workflow?.progress ?? (
    deliverables.length ? Math.round((done / deliverables.length) * 100) : 0
  );
  const running = !!runId && !isRunTerminal(status);
  const previewDeliverable = useMemo(
    () => deliverables.find(d => d.id === previewId) || null,
    [deliverables, previewId],
  );

  // ── No run (or stale run) → request composer ──────────────────────────
  if (!runId || notFound) {
    return (
      <div className="flex-1 overflow-y-auto flex items-center justify-center px-6 py-8 scrollbar-thin">
        <div className="w-full max-w-xl">
          <div className="flex items-center gap-2 mb-2">
            <Workflow className="h-5 w-5 text-cyan-400/70" />
            <h2 className="text-[18px] font-semibold text-white/85">What should the agents build?</h2>
          </div>
          <p className="text-[12px] text-white/35 mb-4">
            Describe a project in plain language — a team of specialist agents will plan and build it.
            {notFound && ' (Your previous run is no longer available.)'}
          </p>

          {/* Template chips — Auto default; Landing Page appears only when its backend flag is on */}
          <div className="flex flex-wrap gap-1.5 mb-3">
            <Chip active={templateId === ''} onClick={() => setTemplateId('')} label="Auto" icon />
            {templates.map(t => (
              <Chip key={t.id} active={templateId === t.id} onClick={() => setTemplateId(t.id)} label={t.name} />
            ))}
          </div>

          <textarea
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); startRun(); } }}
            placeholder="e.g. Build me a Shopify landing page for a coffee subscription"
            rows={3}
            className="w-full bg-transparent text-[13px] text-white/85 placeholder:text-white/20 outline-none resize-none rounded-xl px-3 py-2.5 mb-2"
            style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}
          />
          <button
            onClick={startRun}
            disabled={!request.trim() || starting}
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-[13px] font-medium text-cyan-200 disabled:opacity-40 transition-all"
            style={{ background: 'rgba(34,211,238,0.08)', border: '1px solid rgba(34,211,238,0.16)' }}>
            {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {starting ? 'Starting project…' : 'Start project'}
          </button>
          {startError && <p className="text-[10px] text-red-400/70 mt-2">{startError}</p>}

          <div className="mt-5">
            <p className="text-[9px] uppercase tracking-wider text-white/25 mb-1.5">Try</p>
            <div className="space-y-1.5">
              {EXAMPLES.map(ex => (
                <button key={ex} onClick={() => setRequest(ex)}
                  className="flex items-center gap-2 w-full text-left text-[11px] text-white/45 hover:text-white/70 rounded-lg px-2 py-1.5 transition-colors"
                  style={{ background: 'rgba(255,255,255,0.015)', border: '1px solid rgba(255,255,255,0.03)' }}>
                  <Sparkles className="h-3 w-3 text-cyan-400/40 shrink-0" /> {ex}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Active / finished run ─────────────────────────────────────────────
  return (
    <div className="flex-1 overflow-y-auto px-6 py-5 scrollbar-thin">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Workflow className="h-4 w-4 text-cyan-400/60" />
            <h2 className="text-[15px] font-semibold text-white/80">Project Run</h2>
            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px]"
              style={{ background: `${style.color}14`, color: style.color }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: style.color, boxShadow: running ? `0 0 5px ${style.color}` : 'none' }} />
              {style.label}
            </span>
          </div>
          {running ? (
            <button onClick={cancelRun} className="flex items-center gap-1 text-[11px] text-white/40 hover:text-red-300 transition-colors">
              <XCircle className="h-3.5 w-3.5" /> Cancel
            </button>
          ) : (
            <button onClick={resetRun} className="flex items-center gap-1 text-[11px] text-cyan-400/70 hover:text-cyan-300 transition-colors">
              <RotateCcw className="h-3.5 w-3.5" /> New run
            </button>
          )}
        </div>

        {/* Progress */}
        <div className="flex items-center justify-between mb-1 mt-3">
          <span className="text-[10px] text-white/35">{done}/{deliverables.length} deliverables complete</span>
          <span className="text-[10px] text-white/35">{progress}%</span>
        </div>
        <div className="h-1.5 rounded-full overflow-hidden mb-4" style={{ background: 'rgba(255,255,255,0.05)' }}>
          <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, background: style.color }} />
        </div>

        {/* Deliverables grid (each = an agent + its deliverable; click to preview) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {deliverables.map(d => {
            const previewable = d.status === 'completed';
            return (
              <button
                key={d.id}
                onClick={() => previewable && setPreviewId(d.id)}
                disabled={!previewable}
                className="flex items-start gap-2 text-left rounded-xl px-3 py-2.5 transition-colors disabled:cursor-default enabled:hover:bg-white/[0.03]"
                style={{ background: 'rgba(255,255,255,0.015)', border: '1px solid rgba(255,255,255,0.04)' }}>
                <span className="mt-0.5 shrink-0">{deliverableIcon(d.status)}</span>
                <div className="min-w-0">
                  <p className="text-[12px] text-white/75 truncate">{d.title || d.kind}</p>
                  <p className="text-[9px] text-white/30">
                    {humanAgent(d.agent_id)}
                    {d.status === 'in_progress' ? ' · working…' : ''}
                    {previewable ? ' · click to preview' : ''}
                  </p>
                  {d.status === 'failed' && d.error && (
                    <p className="text-[9px] text-red-400/60 mt-0.5 line-clamp-2">{d.error}</p>
                  )}
                </div>
              </button>
            );
          })}
          {deliverables.length === 0 && (
            <p className="text-[11px] text-white/25 py-2">Preparing run…</p>
          )}
        </div>
      </div>

      <DeliverablePreviewModal deliverable={previewDeliverable} onClose={() => setPreviewId(null)} />
    </div>
  );
}

function Chip({ label, active, onClick, icon }: { label: string; active: boolean; onClick: () => void; icon?: boolean }) {
  return (
    <button onClick={onClick}
      className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] transition-colors"
      style={{
        background: active ? 'rgba(34,211,238,0.12)' : 'rgba(255,255,255,0.02)',
        border: `1px solid ${active ? 'rgba(34,211,238,0.25)' : 'rgba(255,255,255,0.06)'}`,
        color: active ? 'rgb(103,232,249)' : 'rgba(255,255,255,0.5)',
      }}>
      {icon && <Sparkles className="h-3 w-3" />} {label}
    </button>
  );
}
