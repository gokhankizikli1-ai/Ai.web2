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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Workflow, Play, Loader2, CheckCircle2, Circle, XCircle,
  MinusCircle, Sparkles, Eye, Monitor, Code2, FolderTree, Pencil,
  ArrowDown, ShieldAlert, RotateCw,
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
import {
  isBuildIntentPrompt, promptHasDesignDetail, parseVisiblePrompt,
  isRefineIntentPrompt, buildEnhancedPrompt, resolveBriefAnswers, summarizeAnswers,
} from '@/lib/designBrief';
import { CATEGORY_LABELS, detectCategory } from '@/components/builder/promptCategory';
import { unsupportedBuildReason } from '@/lib/contentPolicy';

function lastRunKey(projectId: string): string {
  return `korvix_project_run_${projectId}`;
}

function deliverableIcon(status: DeliverableStatus) {
  switch (status) {
    case 'completed':   return <CheckCircle2 className="h-4 w-4 text-[#86A88B]/80" />;
    case 'in_progress': return <Loader2 className="h-4 w-4 text-[#7EA6BF]/80 animate-spin" />;
    case 'failed':      return <XCircle className="h-4 w-4 text-[#C98282]/70" />;
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
  running:   { label: 'Running',   color: 'rgb(126, 166, 191)' },
  completed: { label: 'Completed', color: 'rgb(111,143,122)' },
  finished:  { label: 'Completed', color: 'rgb(111,143,122)' },
  failed:    { label: 'Failed',    color: 'rgb(183,110,121)' },
  errored:   { label: 'Failed',    color: 'rgb(183,110,121)' },
  cancelled: { label: 'Cancelled', color: 'rgb(166,138,91)' },
};

// Artifact preview kinds that get the prominent "Preview" card (vs the
// compact supporting-deliverable rows).
const ARTIFACT_PREVIEWS = new Set(['iframe', 'code', 'file_tree']);

// Within this distance of the bottom the viewport counts as "following" —
// new content auto-anchors. Further up, the user is inspecting history and
// updates surface as the "Jump to latest" control instead.
const FOLLOW_THRESHOLD_PX = 120;

// Conversation-restore fetches must always settle: on a cold backend a
// bare fetch can pend for minutes, and a refreshed project page would
// look permanently empty. Past this deadline the load flips to a
// visible, retryable error state instead.
const HISTORY_TIMEOUT_MS = 8000;

function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('request timed out')), ms);
    }),
  ]);
}

function artifactGlyph(preview?: string | null) {
  if (preview === 'iframe')    return <Monitor className="h-4 w-4 text-[#9CBBD1]" />;
  if (preview === 'code')      return <Code2 className="h-4 w-4 text-[#9CBBD1]" />;
  if (preview === 'file_tree') return <FolderTree className="h-4 w-4 text-[#9CBBD1]" />;
  return <Sparkles className="h-4 w-4 text-[#9CBBD1]" />;
}

export function artifactLabel(type?: string | null): string {
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

// ── Build overview — a compact projection of the conversation the host
// workspace renders in builder mode (left build sidebar + right Build
// Inspector). Computed here so this component stays the only owner of
// turn state; null means "no runs yet".
export interface BuildOverview {
  totalRuns: number;
  running: boolean;
  status: string | null;
  latestPrompt: string | null;
  categoryLabel: string | null;
  artifactTitle: string | null;
  artifactType: string | null;
  designSummary: string | null;
  briefSections: string[];
  assetCount: number;
  history: Array<{ runId: string; label: string; status: string }>;
}

function isBuildArtifact(d: DeliverableSummary): boolean {
  return d.status === 'completed' && ARTIFACT_PREVIEWS.has(d.artifact_preview || '');
}

function computeOverview(turns: RunTurn[]): BuildOverview | null {
  if (turns.length === 0) return null;
  const latest = turns[turns.length - 1];
  const latestBuild = [...turns].reverse().find(t => t.deliverables.some(isBuildArtifact)) || null;
  const artifact = latestBuild?.deliverables.find(isBuildArtifact) || null;
  const buildRequest = latestBuild?.user_request || '';
  const brief = buildRequest ? resolveBriefAnswers(buildRequest) : null;
  // Category detection runs on the clean visible prompt — brief field
  // values ("Target feel: Ecommerce conversion") must not skew it.
  const visibleBuild = parseVisiblePrompt(buildRequest).visible;
  return {
    totalRuns: turns.length,
    running: !isRunTerminal(latest.status),
    status: latest.status || null,
    latestPrompt: visibleBuild || parseVisiblePrompt(latest.user_request || '').visible || null,
    categoryLabel: visibleBuild ? CATEGORY_LABELS[detectCategory(visibleBuild)] : null,
    artifactTitle: artifact?.title || null,
    artifactType: artifact?.artifact_type ?? null,
    designSummary: brief ? summarizeAnswers(brief) : null,
    briefSections: brief ? brief.sections : [],
    assetCount: turns.reduce((acc, t) => acc + t.deliverables.filter(isBuildArtifact).length, 0),
    history: [...turns].reverse().slice(0, 5).map(t => ({
      runId: t.run_id,
      label: parseVisiblePrompt(t.user_request || '').visible.slice(0, 64) || 'Project run',
      status: t.status,
    })),
  };
}

export default function ProjectRunCenter({ projectId, onOverview }: {
  projectId: string;
  /** Builder-mode hosts subscribe to a compact build overview (left build
      sidebar / right Build Inspector render from it). Optional — omitting
      it changes nothing. */
  onOverview?: (overview: BuildOverview | null) => void;
}) {
  const [turns, setTurns] = useState<RunTurn[]>([]);
  const [templates, setTemplates] = useState<TemplateView[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [request, setRequest] = useState('');
  const [templateId, setTemplateId] = useState<string>('');   // '' = Auto
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [preview, setPreview] = useState<DeliverableView | null>(null);
  const [briefPrompt, setBriefPrompt] = useState<string | null>(null);
  // Unsupported-prompt notice — rendered as a polished assistant-style
  // card in the timeline (never a run, never a template). Cleared on the
  // next successful submission so the composer stays fully usable.
  const [unsupportedNotice, setUnsupportedNotice] = useState<string | null>(null);

  // ── Latest-content follow ────────────────────────────────────────────
  // The conversation has its OWN scroll container (never window scroll).
  // `atBottomRef` mirrors `atBottom` for effects that must read the live
  // value without re-subscribing; `hasFreshContent` drives the
  // "Jump to latest" affordance when updates arrive while the user is
  // inspecting older content further up.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const atBottomRef = useRef(true);
  const didInitialAnchor = useRef(false);
  // Timestamp (ms) until which onScroll ignores transient "not at bottom"
  // frames from a settling programmatic scroll. Time-boxed so it always
  // self-heals — a no-op scroll can never latch it on and swallow a real
  // user scroll.
  const programmaticUntilRef = useRef(0);
  const [atBottom, setAtBottom] = useState(true);
  const [hasFreshContent, setHasFreshContent] = useState(false);

  // Live polling of whichever run is currently in flight.
  const { snapshot } = useProjectRun(activeRunId);

  // ── Initial load: templates + the persisted conversation ──────────────
  // Restoring the conversation is what makes a refreshed project URL come
  // back with its build history, completed cards and preview actions — so
  // the load is finite (deadline-raced) and a failure is a VISIBLE,
  // retryable state instead of a silently empty timeline.
  const [historyState, setHistoryState] = useState<'loading' | 'ready' | 'error'>('loading');

  const loadConversation = useCallback(async (signal?: { active: boolean }) => {
    setHistoryState('loading');
    try {
      const rs = await withDeadline(projectOrchestratorClient.listRuns(projectId), HISTORY_TIMEOUT_MS);
      if (signal && !signal.active) return;
      setTurns(rs);
      // Resume polling the most recent in-flight run, if any.
      const live = [...rs].reverse().find(r => !isRunTerminal(r.status));
      if (live) setActiveRunId(live.run_id);
      setHistoryState('ready');
    } catch {
      if (signal && !signal.active) return;
      setHistoryState('error');  // composer stays usable; banner offers Retry
    }
  }, [projectId]);

  useEffect(() => {
    const signal = { active: true };
    projectOrchestratorClient.listTemplates()
      .then(t => { if (signal.active) setTemplates(t); })
      .catch(() => { /* availability handled by parent */ });
    loadConversation(signal);
    return () => { signal.active = false; };
  }, [loadConversation]);

  // ── Merge live snapshot into its conversation turn ────────────────────
  useEffect(() => {
    if (!snapshot) return;
    setTurns(prev => prev.map(t => t.run_id === snapshot.run_id
      ? { ...t, status: snapshot.status, deliverables: (snapshot.deliverables || []).map(toSummary) }
      : t));
  }, [snapshot]);

  // Latest turn with a completed, previewable artifact — the target a
  // chat-native edit instruction refines.
  const latestBuildTurn = useMemo(() =>
    [...turns].reverse().find(t => t.deliverables.some(isBuildArtifact)) || null,
  [turns]);

  // Live intent read of the draft: is the user editing the latest build or
  // describing a new one? Drives the contextual chip + the Build button label.
  const refineIntent = !!latestBuildTurn && isRefineIntentPrompt(request);

  // Surface the compact overview to the host workspace.
  useEffect(() => {
    onOverview?.(computeOverview(turns));
  }, [turns, onOverview]);

  const scrollToLatest = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const el = scrollRef.current;
    if (!el) return;
    // A programmatic smooth scroll fires many onScroll events on the way
    // down, each reading "not at bottom" mid-flight — which would flip the
    // follow state off and flash "Jump to latest". Suppress tracking for a
    // short settling window (also cleared early by handleScroll once it
    // lands). Instant ('auto') scrolls don't animate, so no window needed.
    programmaticUntilRef.current = behavior === 'smooth' ? Date.now() + 700 : 0;
    // rAF so the measurement sees the just-committed content height.
    requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior });
      atBottomRef.current = true;
      setAtBottom(true);
      setHasFreshContent(false);
    });
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_THRESHOLD_PX;
    // While a programmatic scroll is settling, only ACCEPT the "reached
    // bottom" signal (which ends suppression early); ignore the transient
    // "not yet at bottom" frames so the follow state never flaps.
    if (Date.now() < programmaticUntilRef.current) {
      if (near) programmaticUntilRef.current = 0;
      else return;
    }
    atBottomRef.current = near;
    setAtBottom(near);
    if (near) setHasFreshContent(false);
  }, []);

  // User-initiated growth — a turn was appended (new build, Build now,
  // edit/refine instruction) or the Design Interview opened/closed. The
  // user just acted, so always anchor to the newest content. 'auto' on
  // the very first anchor so restoring a long history doesn't animate
  // through the whole transcript.
  useEffect(() => {
    scrollToLatest(didInitialAnchor.current ? 'smooth' : 'auto');
    didInitialAnchor.current = true;
  }, [turns.length, briefPrompt, unsupportedNotice, scrollToLatest]);

  // Background growth — run status / deliverable changes arriving from
  // polling. Follow only when the user is already near the bottom;
  // otherwise surface "Jump to latest" instead of yanking them down.
  const turnsSignature = turns
    .map(t => `${t.run_id}:${t.status}:${t.deliverables.map(d => d.status).join(',')}`)
    .join('|');
  useEffect(() => {
    if (!turnsSignature) return;
    if (atBottomRef.current) scrollToLatest();
    else setHasFreshContent(true);
  }, [turnsSignature, scrollToLatest]);

  // Stable identity — the interview's step effect depends on this
  // callback, so an inline arrow would re-fire it (and force a scroll)
  // on every unrelated host re-render, e.g. while typing in the composer.
  const handleInterviewAdvance = useCallback(() => { scrollToLatest(); }, [scrollToLatest]);

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
      setUnsupportedNotice(null);
      setTurns(prev => [...prev, turn]);
      setActiveRunId(snap.run_id);
      persistRun(snap.run_id);
      setRequest('');
    } catch (e: unknown) {
      // The backend content-policy gate rejects out-of-scope prompts with
      // this typed code — surface it as the polished notice, not a run
      // error, and keep the composer usable (text preserved).
      if ((e as { code?: string })?.code === 'unsupported_request') {
        setUnsupportedNotice((e as Error)?.message
          || "Korvix can't build this — it's outside the supported builder scope.");
      } else {
        setStartError((e as Error)?.message || 'Failed to start run');
      }
    } finally {
      setStarting(false);
    }
  }, [projectId, templateId, starting, persistRun]);

  // Gate: general-purpose composer (not every request here is a build —
  // "research X" is valid too). Precedence:
  //   1. A completed build exists AND the message reads as an edit
  //      ("make the dashboard denser") → refine THAT build: preserve its
  //      original request + design brief, fold the instruction in, and
  //      re-run through the same flow — editing is just continuing the
  //      conversation, never a separate form. No interview re-ask.
  //   2. A build-intent prompt without design detail → Design Interview.
  //   3. Everything else runs as-is.
  const startRun = useCallback(() => {
    const userRequest = request.trim();
    if (!userRequest || starting) return;
    // Client-side scope pre-check — decline BEFORE opening the Design
    // Interview or spending a round-trip, so an unsupported prompt never
    // walks the user through four design questions first. The backend
    // gate is still authoritative for anything this narrow mirror misses.
    const scopeReason = unsupportedBuildReason(userRequest);
    if (scopeReason) {
      setBriefPrompt(null);
      setStartError(null);
      setUnsupportedNotice(
        `Korvix can't build this — ${scopeReason} is outside the supported ` +
        'builder scope. Try a product idea instead: a storefront, a SaaS ' +
        'dashboard, a portfolio, or a landing page.');
      return;
    }
    if (latestBuildTurn && isRefineIntentPrompt(userRequest)) {
      const base = latestBuildTurn.user_request || '';
      const { visible } = parseVisiblePrompt(base);
      runRequest(buildEnhancedPrompt(`${visible} ${userRequest}`.trim(), resolveBriefAnswers(base)));
      return;
    }
    if (isBuildIntentPrompt(userRequest) && !promptHasDesignDetail(userRequest)) {
      setUnsupportedNotice(null);
      setBriefPrompt(userRequest);
      return;
    }
    runRequest(userRequest);
  }, [request, starting, runRequest, latestBuildTurn]);

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

  // Refine — the modal hands back an enhanced prompt (original request +
  // design brief + edit instruction); re-running it through the SAME
  // runRequest() the composer uses appends a real new turn to this
  // conversation, so the refined build is never fabricated. The modal
  // stays open (with its own busy state) until the new run has started.
  const handleRefine = useCallback(async (enhancedPrompt: string) => {
    await runRequest(enhancedPrompt);
    setPreview(null);
  }, [runRequest]);

  // Starter mode chips (Auto / templates) are a fresh-project affordance:
  // once the first build request has been submitted (a turn exists, or the
  // Design Interview for it is open) the session IS the build conversation,
  // so the chips disappear and the composer reads as continuation. A brand
  // new empty project shows them again.
  const showStarterChips = turns.length === 0 && !briefPrompt;

  const composer = (
    <div className="shrink-0 px-4 py-3" style={{ borderTop: '1px solid rgba(255,255,255,0.05)', background: 'rgba(17, 24, 32,0.4)' }}>
      <div className="max-w-2xl mx-auto">
        {showStarterChips && (
          <div className="flex flex-wrap items-center gap-1.5 mb-2">
            <Chip active={templateId === ''} onClick={() => setTemplateId('')} label="Auto" icon />
            {templates.map(t => (
              <Chip key={t.id} active={templateId === t.id} onClick={() => setTemplateId(t.id)} label={t.name} />
            ))}
          </div>
        )}
        {/* Contextual intent chip — only once a completed build exists and
            a draft is being typed, so the composer stays quiet otherwise. */}
        {!showStarterChips && latestBuildTurn && request.trim() !== '' && (
          <div className="flex justify-end mb-2">
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium"
              style={{
                background: refineIntent ? 'rgba(134, 168, 139,0.08)' : 'rgba(126, 166, 191,0.06)',
                border: `1px solid ${refineIntent ? 'rgba(134, 168, 139,0.2)' : 'rgba(126, 166, 191,0.14)'}`,
                color: refineIntent ? 'rgb(111,143,122)' : 'rgb(156, 187, 209)',
              }}>
              {refineIntent ? <Pencil className="h-2.5 w-2.5" /> : <Sparkles className="h-2.5 w-2.5" />}
              {refineIntent ? 'Editing latest build' : 'New build'}
            </span>
          </div>
        )}
        <div className="flex items-end gap-2 rounded-xl px-3 py-2"
          style={{ background: 'rgba(27,34,48,0.5)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <textarea
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); startRun(); } }}
            placeholder={latestBuildTurn
              ? 'Ask Korvix to edit this build or describe the next change…'
              : showStarterChips
                ? 'Describe what you want Korvix to build…'
                : 'Describe the next step for this project…'}
            rows={1}
            className="flex-1 bg-transparent text-[13px] text-white/85 placeholder:text-white/20 outline-none resize-none py-1.5 max-h-[120px] scrollbar-thin"
          />
          <button
            onClick={startRun}
            disabled={!request.trim() || starting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium text-[#9CBBD1] disabled:opacity-40 transition-all shrink-0"
            style={{ background: 'rgba(126, 166, 191,0.1)', border: '1px solid rgba(126, 166, 191,0.18)' }}>
            {starting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            {starting ? 'Starting' : refineIntent ? 'Update' : 'Build'}
          </button>
        </div>
        {startError && <p className="text-[10px] text-[#C98282]/70 mt-1.5 max-w-2xl mx-auto">{startError}</p>}
      </div>
    </div>
  );

  return (
    // min-h-0 the whole way down so the scroll viewport below is bounded
    // by the column height and scrolls internally — without it the list
    // grows the page and the newest card slides behind the composer.
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      {/* The scroll viewport gets a relative wrapper so "Jump to latest"
          can float just above the composer without a second scroll system.
          pb-10 keeps the last card comfortably readable above the input. */}
      <div className="relative flex-1 min-h-0">
      <div ref={scrollRef} onScroll={handleScroll} className="h-full overflow-y-auto px-4 pt-5 pb-10 scrollbar-thin">
        {/* History restore failed (cold backend, network) — visible and
            retryable, never a silently empty conversation. */}
        {historyState === 'error' && (
          <div className="max-w-2xl mx-auto mb-3 flex items-center justify-between gap-3 rounded-lg px-3 py-2"
            style={{ background: 'rgba(194, 161, 90,0.05)', border: '1px solid rgba(194, 161, 90,0.14)' }}>
            <span className="text-[11px] text-[#C2A15A]/70">
              Couldn't load this project's build history — the backend may still be waking up.
            </span>
            <button onClick={() => loadConversation()}
              className="flex items-center gap-1 text-[11px] font-medium text-[#C2A15A] hover:text-[#C2A15A] transition-colors shrink-0">
              <RotateCw className="h-3 w-3" /> Retry
            </button>
          </div>
        )}
        {turns.length === 0 && !briefPrompt && !unsupportedNotice ? (
          // ── Empty state: invite a project, never "No agents yet" ────────
          <div className="h-full flex flex-col items-center justify-center text-center px-6">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl mb-4"
              style={{ background: 'linear-gradient(135deg, rgba(126, 166, 191,0.1), rgba(156, 187, 209,0.1))', border: '1px solid rgba(126, 166, 191,0.12)' }}>
              <Workflow className="h-6 w-6 text-[#7EA6BF]/60" />
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
                  <Sparkles className="h-3 w-3 text-[#7EA6BF]/40 shrink-0" /> {ex}
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
              <DesignInterview
                prompt={briefPrompt}
                onBuild={(enhanced) => { setBriefPrompt(null); runRequest(enhanced); }}
                onCancel={() => setBriefPrompt(null)}
                onAdvance={handleInterviewAdvance}
              />
            )}
            {unsupportedNotice && (
              <div className="flex items-start gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-full shrink-0 mt-0.5"
                  style={{ background: 'rgba(194, 161, 90,0.14)' }}>
                  <ShieldAlert className="h-3 w-3 text-[#C2A15A]" />
                </div>
                <div className="max-w-[86%] rounded-2xl rounded-tl-sm px-3.5 py-3"
                  style={{ background: 'rgba(194, 161, 90,0.06)', border: '1px solid rgba(194, 161, 90,0.16)' }}>
                  <p className="text-[11px] font-medium tracking-wide text-[#C2A15A]/80 uppercase mb-1">Can't build this</p>
                  <p className="text-[13px] text-white/80 leading-snug">{unsupportedNotice}</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      {/* Subtle latest-content affordance — only when updates arrived
          while the user was inspecting older content further up. */}
      {hasFreshContent && !atBottom && (
        <button
          onClick={() => scrollToLatest()}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium text-[#9CBBD1] transition-all hover:brightness-110"
          style={{ background: 'rgba(27,34,48,0.92)', border: '1px solid rgba(126, 166, 191,0.25)', boxShadow: '0 8px 24px rgba(0,0,0,0.45)', backdropFilter: 'blur(8px)' }}>
          <ArrowDown className="h-3 w-3" /> Jump to latest
        </button>
      )}
      </div>

      {composer}

      <DeliverablePreviewModal
        deliverable={preview}
        onClose={() => setPreview(null)}
        userRequest={preview ? turns.find(t => t.run_id === preview.run_id)?.user_request : undefined}
        onRefine={handleRefine}
        refining={starting}
      />
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
  const style = STATUS_STYLE[turn.status] || { label: turn.status, color: 'rgb(169, 183, 198)' };
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
          style={{ background: 'rgba(126, 166, 191,0.08)', border: '1px solid rgba(126, 166, 191,0.12)' }}>
          {visibleRequest || '(project run)'}
        </div>
        {designSummary && (
          <span className="flex items-center gap-1 px-2 py-1 rounded-full text-[10px] text-[#9CBBD1]/80"
            style={{ background: 'rgba(126, 166, 191,0.08)', border: '1px solid rgba(126, 166, 191,0.16)' }}>
            Design: {designSummary}
          </span>
        )}
      </div>

      {/* Run card */}
      <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.015)', border: '1px solid rgba(255,255,255,0.04)' }}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Workflow className="h-3.5 w-3.5 text-[#7EA6BF]/50" />
            <span className="text-[11px] font-semibold text-white/60">Project Run</span>
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px]"
              style={{ background: `${style.color}14`, color: style.color }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: style.color, boxShadow: running ? `0 0 4px ${style.color}` : 'none' }} />
              {style.label}
            </span>
          </div>
          {running && (
            <button onClick={onCancel} className="flex items-center gap-1 text-[10px] text-white/40 hover:text-[#C98282] transition-colors">
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
              style={{ background: 'linear-gradient(135deg, rgba(126, 166, 191,0.07), rgba(156, 187, 209,0.05))', border: '1px solid rgba(126, 166, 191,0.18)' }}>
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg shrink-0"
                  style={{ background: 'rgba(126, 166, 191,0.12)' }}>
                  {artifactGlyph(d.artifact_preview)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-semibold text-white/85 truncate">{d.title || d.kind}</p>
                  <p className="text-[9px] text-white/40">{artifactLabel(d.artifact_type)} · {humanAgent(d.agent_id)}</p>
                </div>
                <span className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-[#9CBBD1] shrink-0"
                  style={{ background: 'rgba(126, 166, 191,0.12)', border: '1px solid rgba(126, 166, 191,0.2)' }}>
                  <Eye className="h-3.5 w-3.5" /> Preview
                </span>
              </div>
              <p className="text-[8px] text-white/30 mt-1.5">Preview · Copy · Download · Open — or type an edit below</p>
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
                      <p className="text-[8px] text-[#C98282]/60 mt-0.5 line-clamp-2">{d.error}</p>
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
        background: active ? 'rgba(126, 166, 191,0.12)' : 'rgba(255,255,255,0.02)',
        border: `1px solid ${active ? 'rgba(126, 166, 191,0.25)' : 'rgba(255,255,255,0.06)'}`,
        color: active ? 'rgb(156, 187, 209)' : 'rgba(255,255,255,0.5)',
      }}>
      {icon && <Sparkles className="h-3 w-3" />} {label}
    </button>
  );
}
