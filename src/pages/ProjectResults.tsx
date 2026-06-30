// ProjectResults — Sprint 1.7 — the Project Results & Run History surface.
//
// A dedicated, ADDITIVE page (route /projects/:projectId/runs) that exposes the
// already-working backend results inside the Project UI. It does NOT touch or
// redesign ProjectWorkspace. Left: run history (real backend runs). Right:
// the selected run's result, deliverables, timeline and metadata. Everything
// reads existing contracts (listRuns / getRun / PreviewPayload) — no new
// backend, no fake data.
import { useCallback, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import Navigation from '@/components/Navigation';
import RunHistoryPanel from '@/components/results/RunHistoryPanel';
import RunResultDetails from '@/components/results/RunResultDetails';
import { useProjectRuns } from '@/hooks/useProjectRuns';
import { getProject } from '@/stores/projectStore';

export default function ProjectResults() {
  const { projectId } = useParams<{ projectId: string }>();
  const pid = projectId || '';
  const { runs, loading, error, availability, refresh } = useProjectRuns(pid);
  // Derive the effective selection: an explicit pick for this project, else the newest run.
  // (Derived during render — no auto-select effect, no cascading setState.)
  const [picked, setPicked] = useState<{ projectId: string; runId: string } | null>(null);
  const pickedRunId = picked?.projectId === pid ? picked.runId : null;
  const selectedRunId = pickedRunId ?? runs[0]?.run_id ?? null;
  const selectRun = useCallback((runId: string) => setPicked({ projectId: pid, runId }), [pid]);

  const project = useMemo(() => (pid ? getProject(pid) : undefined), [pid]);

  const promptFallback = useMemo(
    () => runs.find(r => r.run_id === selectedRunId)?.user_request,
    [runs, selectedRunId],
  );

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-slate-300 flex flex-col">
      <Navigation />

      {/* Sub-header */}
      <div className="flex items-center gap-3 px-4 sm:px-6 py-3 border-b border-white/[0.05]">
        <Link
          to={pid ? `/projects/${pid}` : '/projects'}
          className="flex items-center gap-1.5 text-[12px] text-white/45 hover:text-white/80 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Workspace
        </Link>
        <span className="text-white/20">/</span>
        <div className="min-w-0">
          <h1 className="text-[14px] font-semibold text-white/85 truncate">
            {project?.name || 'Project'} — Results
          </h1>
        </div>
      </div>

      {/* Two-pane layout */}
      <div className="flex-1 min-h-0 flex flex-col md:flex-row">
        <aside className="w-full md:w-[320px] md:shrink-0 border-b md:border-b-0 md:border-r border-white/[0.05] md:h-[calc(100vh-110px)]">
          <RunHistoryPanel
            runs={runs}
            selectedRunId={selectedRunId}
            onSelect={selectRun}
            loading={loading}
            error={error}
            availability={availability}
            onRetry={refresh}
          />
        </aside>
        <main className="flex-1 min-w-0 md:h-[calc(100vh-110px)] overflow-hidden">
          <RunResultDetails runId={selectedRunId} promptFallback={promptFallback} />
        </main>
      </div>
    </div>
  );
}
