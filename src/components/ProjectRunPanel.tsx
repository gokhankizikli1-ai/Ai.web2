// ProjectRunPanel — Phase B (AI_OS_ROADMAP) — wires ProjectWorkspace to the
// Project Orchestrator shipped in PR #182.
//
// Self-contained right-rail card. Lets a user kick off a multi-agent project
// run, then shows live status + a deliverables checklist + per-agent/task
// progress, polling the run snapshot via the existing useProjectOrchestrator
// hook. No backend changes; reuses PR #182's /v2/orchestrator/* surface.
//
// Frontend-safe by design:
//   * Orchestrator flag OFF (503)         → quiet "disabled" empty state.
//   * No run yet                          → compact start form.
//   * Stale/foreign run id (404)          → reset affordance.
// Nothing here can break the existing chat/agents/memory panels — it is an
// additive card with its own state + its own localStorage key.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  Workflow, Play, Loader2, CheckCircle2, Circle, XCircle,
  MinusCircle, RotateCcw, X, Eye, History,
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

type Availability = 'unknown' | 'available' | 'disabled';

function lastRunKey(projectId: string): string {
  return `korvix_project_run_${projectId}`;
}

// ── Deliverable status presentation ───────────────────────────────────
function deliverableIcon(status: DeliverableStatus) {
  switch (status) {
    case 'completed':   return <CheckCircle2 className="h-3 w-3 text-emerald-400/80" />;
    case 'in_progress': return <Loader2 className="h-3 w-3 text-cyan-400/80 animate-spin" />;
    case 'failed':      return <XCircle className="h-3 w-3 text-red-400/70" />;
    case 'skipped':     return <MinusCircle className="h-3 w-3 text-white/25" />;
    default:            return <Circle className="h-3 w-3 text-white/25" />;
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

export default function ProjectRunPanel({ projectId }: { projectId: string }) {
  const [availability, setAvailability] = useState<Availability>('unknown');
  const [templates, setTemplates] = useState<TemplateView[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [request, setRequest] = useState('');
  const [templateId, setTemplateId] = useState<string>('');   // '' = let coordinator choose
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);

  const { snapshot, error, isTerminal, refresh } = useProjectRun(runId);

  // Probe availability + load templates once; re-attach a persisted run.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const t = await projectOrchestratorClient.listTemplates();
        if (!active) return;
        setTemplates(t);
        setAvailability('available');
      } catch (e: unknown) {
        if (!active) return;
        const code = (e as { code?: string })?.code;
        setAvailability(code === 'project_orchestrator_disabled' ? 'disabled' : 'available');
      }
    })();
    try {
      const saved = localStorage.getItem(lastRunKey(projectId));
      if (saved) setRunId(saved);
    } catch { /* ignore storage errors */ }
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
        // If ENABLE_PROJECTS is on and this is a local-only project id, the
        // route 404s on ownership. Fall back to a project-less run so the
        // orchestration still works end-to-end.
        if ((e as { code?: string })?.code === 'project_not_found') {
          snap = await projectOrchestratorClient.startRun({
            userRequest, templateId: templateId || undefined,
          });
        } else {
          throw e;
        }
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
    try { await projectOrchestratorClient.cancelRun(runId); refresh(); }
    catch { /* surfaced via snapshot status on next poll */ }
  }, [runId, refresh]);

  const resetRun = useCallback(() => {
    setRunId(null);
    persistRun(null);
    setStartError(null);
  }, [persistRun]);

  // ── Disabled: quiet, honest empty state ──────────────────────────────
  if (availability === 'disabled') {
    return (
      <Card>
        <Header projectId={projectId} />
        <p className="text-[10px] text-white/30 leading-snug">
          Project Orchestrator is off. Multi-agent runs activate when
          <span className="text-white/45"> ENABLE_PROJECT_ORCHESTRATOR </span>
          is enabled on the backend.
        </p>
      </Card>
    );
  }

  // ── Stale / foreign run id ────────────────────────────────────────────
  const notFound = !!runId && !snapshot && /not.?found/i.test(error || '');
  if (notFound) {
    return (
      <Card>
        <Header projectId={projectId} />
        <p className="text-[10px] text-white/30 mb-2">This run is no longer available.</p>
        <button onClick={resetRun} className="flex items-center gap-1 text-[10px] text-cyan-400/70 hover:text-cyan-300">
          <RotateCcw className="h-3 w-3" /> Start a new run
        </button>
      </Card>
    );
  }

  // ── No run yet: compact start form ────────────────────────────────────
  if (!runId) {
    return (
      <Card>
        <Header projectId={projectId} />
        <textarea
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          placeholder="Describe a project for the agents to build…"
          rows={2}
          className="w-full bg-transparent text-[11px] text-white/80 placeholder:text-white/20 outline-none resize-none rounded-lg px-2 py-1.5 mb-2"
          style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}
        />
        {templates.length > 0 && (
          <select
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            className="w-full bg-transparent text-[10px] text-white/60 outline-none rounded-lg px-2 py-1.5 mb-2"
            style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <option value="" className="bg-[#11151c]">Auto (coordinator picks)</option>
            {templates.map(t => (
              <option key={t.id} value={t.id} className="bg-[#11151c]">{t.name}</option>
            ))}
          </select>
        )}
        <button
          onClick={startRun}
          disabled={!request.trim() || starting}
          className="flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg text-[11px] font-medium text-cyan-300 disabled:opacity-40 transition-all"
          style={{ background: 'rgba(34,211,238,0.06)', border: '1px solid rgba(34,211,238,0.12)' }}>
          {starting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
          {starting ? 'Starting…' : 'Start project run'}
        </button>
        {startError && <p className="text-[9px] text-red-400/70 mt-1.5">{startError}</p>}
      </Card>
    );
  }

  // ── Active / finished run ─────────────────────────────────────────────
  const status = snapshot?.status || 'running';
  const style = STATUS_STYLE[status] || { label: status, color: 'rgb(148,163,184)' };
  const deliverables: DeliverableView[] = snapshot?.deliverables || [];
  const done = deliverables.filter(d => d.status === 'completed').length;
  const progress = snapshot?.workflow?.progress ?? (
    deliverables.length ? Math.round((done / deliverables.length) * 100) : 0
  );
  const running = !isTerminal && !isRunTerminal(status);

  return (
    <Card>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Workflow className="h-3.5 w-3.5 text-cyan-400/50" />
          <span className="text-[11px] font-semibold text-white/60">Project Run</span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to={`/projects/${projectId}/runs`}
            title="View run history & results"
            className="flex items-center gap-1 text-[9px] text-white/35 hover:text-cyan-300 transition-colors"
          >
            <History className="h-3 w-3" /> History
          </Link>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full"
              style={{ background: style.color, boxShadow: running ? `0 0 4px ${style.color}` : 'none' }} />
            <span className="text-[9px]" style={{ color: style.color }}>{style.label}</span>
          </div>
        </div>
      </div>

      {/* Progress bar + counts */}
      <div className="mb-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[9px] text-white/30">{done}/{deliverables.length} deliverables</span>
          <span className="text-[9px] text-white/30">{progress}%</span>
        </div>
        <div className="h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
          <div className="h-full rounded-full transition-all"
            style={{ width: `${progress}%`, background: style.color }} />
        </div>
      </div>

      {/* Deliverables checklist (each row = an agent + its deliverable) */}
      <div className="space-y-1.5 mb-2">
        {deliverables.map((d) => {
          const previewable = d.status === 'completed';
          const Row = (
            <>
              <span className="mt-0.5 shrink-0">{deliverableIcon(d.status)}</span>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] text-white/60 truncate">{d.title || d.kind}</p>
                <p className="text-[8px] text-white/25">
                  {humanAgent(d.agent_id)}{d.status === 'in_progress' ? ' · working…' : ''}
                </p>
              </div>
              {previewable && <Eye className="h-3 w-3 text-white/25 shrink-0 mt-0.5" />}
            </>
          );
          return previewable ? (
            <button
              key={d.id}
              onClick={() => setPreviewId(d.id)}
              title="Preview deliverable"
              className="flex items-start gap-1.5 w-full text-left rounded-md px-1 -mx-1 py-0.5 hover:bg-white/[0.03] transition-colors">
              {Row}
            </button>
          ) : (
            <div key={d.id} className="flex items-start gap-1.5 px-1 -mx-1 py-0.5">
              {Row}
            </div>
          );
        })}
        {deliverables.length === 0 && (
          <p className="text-[10px] text-white/20 py-1">Preparing run…</p>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
        {running ? (
          <button onClick={cancelRun} className="flex items-center gap-1 text-[10px] text-white/40 hover:text-red-300 transition-colors">
            <X className="h-3 w-3" /> Cancel
          </button>
        ) : (
          <button onClick={resetRun} className="flex items-center gap-1 text-[10px] text-cyan-400/70 hover:text-cyan-300 transition-colors">
            <RotateCcw className="h-3 w-3" /> New run
          </button>
        )}
      </div>

      <DeliverablePreviewModal
        deliverable={deliverables.find(d => d.id === previewId) || null}
        onClose={() => setPreviewId(null)}
      />
    </Card>
  );
}

// ── Local presentational helpers (match the right-rail card style) ─────
function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.015)', border: '1px solid rgba(255,255,255,0.04)' }}>
      {children}
    </div>
  );
}

function Header({ projectId }: { projectId?: string }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        <Workflow className="h-3.5 w-3.5 text-cyan-400/50" />
        <span className="text-[11px] font-semibold text-white/60">Project Run</span>
      </div>
      {projectId && (
        <Link
          to={`/projects/${projectId}/runs`}
          title="View run history & results"
          className="flex items-center gap-1 text-[9px] text-white/35 hover:text-cyan-300 transition-colors"
        >
          <History className="h-3 w-3" /> History
        </Link>
      )}
    </div>
  );
}
