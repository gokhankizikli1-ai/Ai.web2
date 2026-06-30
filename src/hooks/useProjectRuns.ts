// useProjectRuns — Sprint 1.7 — a project's run history, read-only.
//
// Thin wrapper over the EXISTING projectOrchestratorClient.listRuns
// (GET /v2/orchestrator/runs?project_id=…). No new endpoint, no fake history.
// Returns runs newest-first and light-polls only while at least one run is
// still non-terminal (so a completed history fetches once and stops). Detects
// the orchestrator feature gate (503 → 'disabled') so the UI can show an
// honest state instead of crashing.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  projectOrchestratorClient, isRunTerminal, type RunTurn,
} from '@/hooks/useProjectOrchestrator';

export type RunsAvailability = 'unknown' | 'available' | 'disabled';

export interface UseProjectRuns {
  runs:         RunTurn[];
  loading:      boolean;
  error:        string | null;
  availability: RunsAvailability;
  refresh:      () => void;
}

const POLL_MS = 5000;   // gentle background refresh while a run is active

export function useProjectRuns(projectId: string | null | undefined): UseProjectRuns {
  const [runsState, setRunsState]       = useState<{ projectId: string | null; runs: RunTurn[] }>({
    projectId: null,
    runs: [],
  });
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [availability, setAvailability] = useState<RunsAvailability>('unknown');

  const seq    = useRef(0);
  const timer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abort  = useRef<AbortController | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  }, []);

  // `load` only defines + kicks an inner async `tick`, so (a) the recursion is
  // self-contained (no callback self-reference) and (b) no setState runs
  // synchronously in a tracked sync callback — every setState lives inside the
  // async tick, the same pattern the existing useProjectRun uses.
  const load = useCallback((mySeq: number) => {
    async function tick() {
      if (mySeq !== seq.current || !projectId) return;
      abort.current?.abort();
      const ctrl = new AbortController();
      abort.current = ctrl;
      setLoading(true);
      try {
        const list = await projectOrchestratorClient.listRuns(projectId, 50, ctrl.signal);
        if (mySeq !== seq.current) return;
        // Backend returns chronological (oldest→newest); show newest first.
        const ordered = [...list].reverse();
        setRunsState({ projectId, runs: ordered });
        setAvailability('available');
        setError(null);
        // Keep refreshing only while something is still running.
        const anyActive = ordered.some(r => !isRunTerminal(r.status));
        clearTimer();
        if (anyActive) timer.current = setTimeout(tick, POLL_MS);
      } catch (e: unknown) {
        if ((e as { name?: string })?.name === 'AbortError') return;
        if (mySeq !== seq.current) return;
        const code = (e as { code?: string })?.code;
        if (code === 'project_orchestrator_disabled') {
          setAvailability('disabled');
          setError(null);
        } else {
          setAvailability('available');
          setError((e as Error)?.message || 'failed to load runs');
        }
      } finally {
        if (mySeq === seq.current) setLoading(false);
      }
    }
    tick();
  }, [projectId, clearTimer]);

  const refresh = useCallback(() => {
    seq.current += 1;
    load(seq.current);
  }, [load]);

  useEffect(() => {
    seq.current += 1;
    clearTimer();
    abort.current?.abort();
    setRunsState({ projectId: projectId ?? null, runs: [] });
    setError(null);
    if (!projectId) {
      setLoading(false);
      setAvailability('unknown');
      return;
    }
    load(seq.current);
    return () => { seq.current += 1; clearTimer(); abort.current?.abort(); };
  }, [projectId, load, clearTimer]);

  const runs = runsState.projectId === (projectId ?? null) ? runsState.runs : [];

  return { runs, loading, error, availability, refresh };
}
