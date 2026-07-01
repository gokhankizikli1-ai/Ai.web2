// ProjectRunCenter — EPIC 1 / Milestone 1 — the Universal Project Composer.
//
// The project IS the interaction model: the center of the workspace is a
// PERMANENT project conversation, not a per-agent chat. Users describe any
// task in natural language ("Build me a SaaS", "Research Tesla stock",
// "Generate a Roblox game"); the coordinator classifies it and picks (or
// dynamically composes) a workflow — no manual template selection required
// (Auto is the default). Each run APPENDS to the same conversation; the
// page is never recreated.
//
// Conversation persistence is backend-backed: turns are listed from
// /v2/orchestrator/runs (the orchestrator runs_store), so a reload restores
// the full transcript and resumes polling any in-flight run. No new tables.
//
// Mounted by ProjectWorkspace ONLY when orchestrator availability resolves
// to `available`; the disabled path keeps the classic agent chat fallback.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Workflow, Play, Loader2, CheckCircle2, Circle, XCircle,
  MinusCircle, Sparkles, Eye, Monitor, Code2, FolderTree,
} from 'lucide-react';
import {
  projectOrchestratorClient,
  useProjectRun,
  isRunTerminal,
  type TemplateView,
  type DeliverableView,
  type DeliverableStatus,
  type DeliverableSummary,
  type RunTurn,
} from '@/hooks/useProjectOrchestrator';
import DeliverablePreviewModal from '@/components/DeliverablePreviewModal';
import DesignInterview from '@/components/builder/DesignInterview';
import { isBuildIntentPrompt, promptHasDesignDetail, parseVisiblePrompt } from '@/lib/designBrief';

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

// Artifact preview kinds that get the prominent "Preview" card (vs the
// compact supporting-deliverable rows).
const ARTIFACT_PREVIEWS = new Set(['iframe', 'code', 'file_tree']);

function artifactGlyph(preview?: string | null) {
  if (preview === 'iframe')    return <Monitor className="h-4 w-4 text-cyan-300" />;
  if (preview === 'code')      return <Code2 className="h-4 w-4 text-cyan-300" />;
  if (preview === 'file_tree') return <FolderTree className="h-4 w-4 text-cyan-300" />;
  return <Sparkles className="h-4 w-4 text-cyan-300" />;
}

function artifactLabel(type?: string | null): string {
  switch (type) {
    case 'html':            return 'Live HTML preview';
    case 'react_component': return 'React component';
    case 'project_file':    return 'Project file';
    case 'file_tree':       return 'File tree';
    case 'zip_ready_bundle': return 'Bundle';
    default:                return 'Artifact';
  }
}

const EXAMPLES = [
  'Build me a Shopify landing page for a coffee subscription',
  'Research the EV charging market and summarise the opportunity',
  'Design a brand and landing copy for a productivity app',
  'Create an AI automation that triages support tickets',
];

function toSummary(d: DeliverableView): DeliverableSummary {
  const art = (d.content as Record<string, unknown> | undefined)?.artifact as
    { type?: string; preview?: string } | undefined;
  return {
    id: d.id, node_id: d.node_id, kind: d.kind, title: d.title,
    agent_id: d.agent_id, status: d.status, error: d.error,
    artifact_type: (art?.type as DeliverableSummary['artifact_type']) ?? null,
    artifact_preview: art?.preview ?? null,
  };
}

export default function ProjectRunCenter({ projectId }: { projectId: string }) {
  const [turns, setTurns] = useState<RunTurn[]>([]);
  const [templates, setTemplates] = useState<TemplateView[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [request, setRequest] = useState('');
  const [templateId, setTemplateId] = useState<string>('');   // '' = Auto
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [preview, setPreview] = useState<DeliverableView | null>(null);
  const [briefPrompt, setBriefPrompt] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const briefRef = useRef<HTMLDivElement | null>(null);

  // Live polling of whichever run is currently in flight.
  const { snapshot } = useProjectRun(activeRunId);

  // ── Initial load: templates + the persisted conversation ──────────────
  useEffect(() => {
    let active = true;
    projectOrchestratorClient.listTemplates()
      .then(t => { if (active) setTemplates(t); })
      .catch(() => { /* availability handled by parent */ });
    projectOrchestratorClient.listRuns(projectId)
      .then(rs => {
        if (!active) return;
        setTurns(rs);
        // Resume polling the most recent in-flight run, if any.
        const live = [...rs].reverse().find(r => !isRunTerminal(r.status));
        if (live) setActiveRunId(live.run_id);
      })
      .catch(() => { /* empty conversation / disabled — composer still shown */ });
    return () => { active = false; };
  }, [projectId]);

  // ── Merge live snapshot into its conversation turn ────────────────────
  useEffect(() => {
    if (!snapshot) return;
    setTurns(prev => prev.map(t => t.run_id === snapshot.run_id
      ? { ...t, status: snapshot.status, deliverables: (snapshot.deliverables || []).map(toSummary) }
      : t));
  }, [snapshot]);

  // Auto-scroll to the newest turn (or the design interview, once it opens).
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns.length, briefPrompt]);

  useEffect(() => {
    if (!briefPrompt || !briefRef.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    });
    observer.observe(briefRef.current);
    return () => observer.disconnect();
  }, [briefPrompt]);

  const persistRun = useCallback((id: string | null) => {
    try {
      if (id) localStorage.setItem(lastRunKey(projectId), id);
    } catch { /* ignore */ }
  }, [projectId]);

  // The actual run-launch — extracted so both the composer's "Build"
  // button (guarded by the design brief below) and the brief panel's
  // confirm/smart-defaults actions can trigger it with the final
  // (possibly design-brief-enhanced) request text.
  const runRequest = useCallback(async (userRequest: string) => {
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
        // ENABLE_PROJECTS on + a local-only project id → ownership 404.
        // Fall back to a project-less run so the request still works.
        if ((e as { code?: string })?.code === 'project_not_found') {
          snap = await projectOrchestratorClient.startRun({
            userRequest, templateId: templateId || undefined,
          });
        } else { throw e; }
      }
      const turn: RunTurn = {
        run_id: snap.run_id,
        status: snap.status,
        user_request: userRequest,
        template_id: snap.template_id ?? (templateId || null),
        created_at: null,
        deliverables: (snap.deliverables || []).map(toSummary),
        task_graph: snap.task_graph ? { tasks: snap.task_graph.tasks, total_count: snap.task_graph.total_count } : null,
      };
      setTurns(prev => [...prev, turn]);
      setActiveRunId(snap.run_id);
      persistRun(snap.run_id);
      setRequest('');
    } catch (e: unknown) {
      setStartError((e as Error)?.message || 'Failed to start run');
    } finally {
      setStarting(false);
    }
  }, [projectId, templateId, starting, persistRun]);

  // Gate: general-purpose composer (not every request here is a build —
  // "research X" is valid too), so only intercept build-intent prompts
  // that don't already carry enough explicit design detail.
  const startRun = useCallback(() => {
    const userRequest = request.trim();
    if (!userRequest || starting) return;
    if (isBuildIntentPrompt(userRequest) && !promptHasDesignDetail(userRequest)) {
      setBriefPrompt(userRequest);
      return;
    }
    runRequest(userRequest);
  }, [request, starting, runRequest]);

  const cancelRun = useCallback(async (runId: string) => {
    try { await projectOrchestratorClient.cancelRun(runId); } catch { /* poll reflects status */ }
  }, []);

  const openPreview = useCallback(async (runId: string, deliverableId: string) => {
    try {
      const snap = await projectOrchestratorClient.getRun(runId);
      const d = (snap.deliverables || []).find(x => x.id === deliverableId) || null;
      setPreview(d);
    } catch { /* ignore — preview is best-effort */ }
  }, []);

  const composer = (
    <div className="shrink-0 px-4 py-3" style={{ borderTop: '1px solid rgba(255,255,255,0.05)', background: 'rgba(17,21,28,0.4)' }}>
      <div className="max-w-2xl mx-auto">
        <div className="flex flex-wrap gap-1.5 mb-2">
          <Chip active={templateId === ''} onClick={() => setTemplateId('')} label="Auto" icon />
          {templates.map(t => (
            <Chip key={t.id} active={templateId === t.id} onClick={() => setTemplateId(t.id)} label={t.name} />
          ))}
        </div>
        <div className="flex items-end gap-2 rounded-xl px-3 py-2"
          style={{ background: 'rgba(27,34,48,0.5)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <textarea
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); startRun(); } }}
            placeholder="Describe what you want Korvix to build…"
            rows={1}
            className="flex-1 bg-transparent text-[13px] text-white/85 placeholder:text-white/20 outline-none resize-none py-1.5 max-h-[120px] scrollbar-thin"
          />
          <button
            onClick={startRun}
            disabled={!request.trim() || starting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium text-cyan-200 disabled:opacity-40 transition-all shrink-0"
            style={{ background: 'rgba(34,211,238,0.1)', border: '1px solid rgba(34,211,238,0.18)' }}>
            {starting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            {starting ? 'Starting' : 'Build'}
          </button>
        </div>
        {startError && <p className="text-[10px] text-red-400/70 mt-1.5 max-w-2xl mx-auto">{startError}</p>}
      </div>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="flex-1 overflow-y-auto px-4 py-5 scrollbar-thin">
        {turns.length === 0 && !briefPrompt ? (
          // ── Empty state: invite a project, never "No agents yet" ────────
          <div className="h-full flex flex-col items-center justify-center text-center px-6">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl mb-4"
              style={{ background: 'linear-gradient(135deg, rgba(34,211,238,0.1), rgba(59,130,246,0.1))', border: '1px solid rgba(34,211,238,0.12)' }}>
              <Workflow className="h-6 w-6 text-cyan-400/60" />
            </div>
            <h2 className="text-[18px] font-semibold text-white/85 mb-1.5">What would you like Korvix to build?</h2>
            <p className="text-[12px] text-white/35 max-w-md mb-5">
              Describe any project in plain language — a team of specialist agents will plan and build it. No setup required.
            </p>
            <div className="w-full max-w-md space-y-1.5">
              {EXAMPLES.map(ex => (
                <button key={ex} onClick={() => setRequest(ex)}
                  className="flex items-center gap-2 w-full text-left text-[11px] text-white/45 hover:text-white/70 rounded-lg px-2.5 py-2 transition-colors"
                  style={{ background: 'rgba(255,255,255,0.015)', border: '1px solid rgba(255,255,255,0.03)' }}>
                  <Sparkles className="h-3 w-3 text-cyan-400/40 shrink-0" /> {ex}
                </button>
              ))}
            </div>
          </div>
        ) : (
          // ── The permanent conversation ──────────────────────────────────
          // The Design Interview (when active) renders as the newest turn in
          // this same transcript — Korvix's questions are assistant messages
          // inline in the conversation, never a floating card over the page.
          <div className="max-w-2xl mx-auto space-y-5">
            {turns.map(turn => (
              <ConversationTurn
                key={turn.run_id}
                turn={turn}
                onCancel={() => cancelRun(turn.run_id)}
                onPreview={(dId) => openPreview(turn.run_id, dId)}
              />
            ))}
            {briefPrompt && (
              <div ref={briefRef}>
                <DesignInterview
                  prompt={briefPrompt}
                  onBuild={(enhanced) => { setBriefPrompt(null); runRequest(enhanced); }}
                  onCancel={() => setBriefPrompt(null)}
                />
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {composer}

      <DeliverablePreviewModal deliverable={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

// ── One conversation turn: the request + its run result ──────────────────
function ConversationTurn({
  turn, onCancel, onPreview,
}: {
  turn: RunTurn;
  onCancel: () => void;
  onPreview: (deliverableId: string) => void;
}) {
  const style = STATUS_STYLE[turn.status] || { label: turn.status, color: 'rgb(148,163,184)' };
  const done = turn.deliverables.filter(d => d.status === 'completed').length;
  const total = turn.deliverables.length;
  const progress = total ? Math.round((done / total) * 100) : 0;
  const running = !isRunTerminal(turn.status);
  // The persisted user_request IS the design-brief-enhanced prompt (no
  // separate backend field for the original) — parsed back apart here so
  // the bubble only ever shows the clean request the user actually typed,
  // with the design choices surfaced as a compact pill underneath.
  const { visible: visibleRequest, summary: designSummary } = parseVisiblePrompt(turn.user_request || '');

  return (
    <div>
      {/* Request bubble */}
      <div className="flex flex-col items-end gap-1 mb-2">
        <div className="max-w-[80%] rounded-2xl rounded-br-sm px-3 py-2 text-[13px] text-white/85"
          style={{ background: 'rgba(34,211,238,0.08)', border: '1px solid rgba(34,211,238,0.12)' }}>
          {visibleRequest || '(project run)'}
        </div>
        {designSummary && (
          <span className="flex items-center gap-1 px-2 py-1 rounded-full text-[10px] text-indigo-300/80"
            style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.16)' }}>
            Design: {designSummary}
          </span>
        )}
      </div>

      {/* Run card */}
      <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.015)', border: '1px solid rgba(255,255,255,0.04)' }}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Workflow className="h-3.5 w-3.5 text-cyan-400/50" />
            <span className="text-[11px] font-semibold text-white/60">Project Run</span>
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px]"
              style={{ background: `${style.color}14`, color: style.color }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: style.color, boxShadow: running ? `0 0 4px ${style.color}` : 'none' }} />
              {style.label}
            </span>
          </div>
          {running && (
            <button onClick={onCancel} className="flex items-center gap-1 text-[10px] text-white/40 hover:text-red-300 transition-colors">
              <XCircle className="h-3 w-3" /> Cancel
            </button>
          )}
        </div>

        {total > 0 && (
          <>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[9px] text-white/30">{done}/{total} deliverables</span>
              <span className="text-[9px] text-white/30">{progress}%</span>
            </div>
            <div className="h-1 rounded-full overflow-hidden mb-2.5" style={{ background: 'rgba(255,255,255,0.05)' }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, background: style.color }} />
            </div>
          </>
        )}

        {/* Prominent artifact(s) — the real, previewable outputs (html /
            react / file tree). Never hidden behind a tiny row (req #4). */}
        {turn.deliverables
          .filter(d => d.status === 'completed' && ARTIFACT_PREVIEWS.has(d.artifact_preview || ''))
          .map(d => (
            <button key={`art-${d.id}`} onClick={() => onPreview(d.id)}
              className="w-full text-left rounded-xl px-3 py-3 mb-1.5 transition-colors hover:bg-white/[0.04]"
              style={{ background: 'linear-gradient(135deg, rgba(34,211,238,0.07), rgba(59,130,246,0.05))', border: '1px solid rgba(34,211,238,0.18)' }}>
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg shrink-0"
                  style={{ background: 'rgba(34,211,238,0.12)' }}>
                  {artifactGlyph(d.artifact_preview)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-semibold text-white/85 truncate">{d.title || d.kind}</p>
                  <p className="text-[9px] text-white/40">{artifactLabel(d.artifact_type)} · {humanAgent(d.agent_id)}</p>
                </div>
                <span className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-cyan-200 shrink-0"
                  style={{ background: 'rgba(34,211,238,0.12)', border: '1px solid rgba(34,211,238,0.2)' }}>
                  <Eye className="h-3.5 w-3.5" /> Preview
                </span>
              </div>
              <p className="text-[8px] text-white/30 mt-1.5">Preview · Copy · Download · Open</p>
            </button>
          ))}

        {/* Supporting deliverables (plans, concepts) as compact rows. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {turn.deliverables
            .filter(d => !(d.status === 'completed' && ARTIFACT_PREVIEWS.has(d.artifact_preview || '')))
            .map(d => {
              const previewable = d.status === 'completed';
              return (
                <button key={d.id}
                  onClick={() => previewable && onPreview(d.id)}
                  disabled={!previewable}
                  className="flex items-start gap-1.5 text-left rounded-lg px-2 py-1.5 transition-colors disabled:cursor-default enabled:hover:bg-white/[0.03]"
                  style={{ background: 'rgba(255,255,255,0.015)', border: '1px solid rgba(255,255,255,0.03)' }}>
                  <span className="mt-0.5 shrink-0">{deliverableIcon(d.status)}</span>
                  <div className="min-w-0">
                    <p className="text-[11px] text-white/70 truncate">{d.title || d.kind}</p>
                    <p className="text-[8px] text-white/30">
                      {humanAgent(d.agent_id)}
                      {d.status === 'in_progress' ? ' · working…' : previewable ? ' · preview' : ''}
                    </p>
                    {d.status === 'failed' && d.error && (
                      <p className="text-[8px] text-red-400/60 mt-0.5 line-clamp-2">{d.error}</p>
                    )}
                  </div>
                </button>
              );
            })}
          {total === 0 && <p className="text-[10px] text-white/25 py-1">Preparing run…</p>}
        </div>
      </div>
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
