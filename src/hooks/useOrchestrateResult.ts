// useOrchestrateResult — Sprint 1.6 — the thin "Plan → Run → Result" client.
//
// This is the ONLY frontend glue that walks the already-built backend spine:
//
//   prompt
//     │  POST /v2/intelligence/orchestrate  (Sprint 1.4 bridge, execute mode)
//     ▼  → run_id + result_route            (Product Intelligence → Blueprint
//     │                                       → Bridge → Orchestrator run)
//     ▼  GET  <result_route>                (Sprint 1.5 Deliverable Result API)
//     │  poll until the PreviewPayload status is terminal
//     ▼
//   PreviewPayload  (rendered by <PreviewResult/>)
//
// It contains NO orchestration logic — the backend decides what to build, runs
// the agents, and resolves the result. React only POSTs a prompt, polls a
// route, and surfaces the typed payload + a phase. Results are NEVER
// fabricated: every rendered byte originates from the resolver. Feature gates
// (503 / executed=false) degrade to a meaningful "disabled" phase, never a
// crash.
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  OrchestrateResponse, PreviewPayload, ResultResponse, ResultStatus,
} from '@/types/preview';
import { isResultTerminal } from '@/types/preview';

// ── Backend base + auth (same convention as useProjectOrchestrator) ────────
const BUNDLED_BACKEND = 'https://api.korvixai.com';

function resolveBase(): string {
  const envBase = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
  return envBase ? envBase.replace(/\/+$/, '') : BUNDLED_BACKEND;
}
const BASE = resolveBase();

function getToken(): string | null {
  try { return localStorage.getItem('korvix_access_token'); }
  catch { return null; }
}

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const tok = getToken();
  if (tok) h.Authorization = `Bearer ${tok}`;
  return h;
}

// ── Phases the UI shows (maps real backend signals → display state) ────────
//   idle       — nothing started ("waiting for planning")
//   planning   — POST /orchestrate in flight (intelligence → blueprint → run)
//   running    — polling; result status pending | running
//   rendering  — polling; result status partial (deliverables assembling)
//   completed  — terminal: a result payload is ready (may be no-artifact)
//   failed     — terminal: run errored
//   cancelled  — terminal: run cancelled
//   not_found  — terminal: run unknown / not visible to this user
//   disabled   — a backend feature gate is off (bridge/result API/prereqs)
//   error      — transport/parse error (still never crashes the page)
export type OrchestratePhase =
  | 'idle' | 'planning' | 'running' | 'rendering'
  | 'completed' | 'failed' | 'cancelled' | 'not_found'
  | 'disabled' | 'error';

const PHASE_LABELS: Record<OrchestratePhase, string> = {
  idle:      'Waiting for planning',
  planning:  'Planning',
  running:   'Running',
  rendering: 'Rendering',
  completed: 'Completed',
  failed:    'Failed',
  cancelled: 'Cancelled',
  not_found: 'Not found',
  disabled:  'Unavailable',
  error:     'Error',
};

export function orchestratePhaseLabel(p: OrchestratePhase): string {
  return PHASE_LABELS[p];
}

// Map a result-payload status onto a display phase. Exported so the Sprint 1.7
// run-result view can reuse the exact same mapping (no duplicated contract).
export function phaseForStatus(status: ResultStatus): OrchestratePhase {
  switch (status) {
    case 'pending':
    case 'running':            return 'running';
    case 'partial':            return 'rendering';
    case 'failed':             return 'failed';
    case 'cancelled':          return 'cancelled';
    case 'not_found':
    case 'no_run':             return 'not_found';
    // completed | completed_no_artifact | artifact_not_found → terminal
    default:                   return 'completed';
  }
}

const POLL_MS = 2000;          // gentle: no aggressive polling
const MAX_POLLS = 600;         // ~20 min hard ceiling, then stop (no infinite loop)

export interface UseOrchestrateResult {
  phase:                  OrchestratePhase;
  label:                  string;
  payload:                PreviewPayload | null;
  error:                  string | null;
  disabledReason:         string | null;
  disabledPrerequisites:  string[];
  runId:                  string | null;
  isBusy:                 boolean;          // planning | running | rendering
  run:                    (prompt: string, opts?: { projectId?: string }) => void;
  reset:                  () => void;
}

export function useOrchestrateResult(): UseOrchestrateResult {
  const [phase, setPhase]                 = useState<OrchestratePhase>('idle');
  const [payload, setPayload]             = useState<PreviewPayload | null>(null);
  const [error, setError]                 = useState<string | null>(null);
  const [disabledReason, setDisabledReason] = useState<string | null>(null);
  const [disabledPrereqs, setDisabledPrereqs] = useState<string[]>([]);
  const [runId, setRunId]                 = useState<string | null>(null);

  // Run-lifecycle refs so an in-flight poll can never outlive a reset/unmount
  // or a newer run() (no duplicate / overlapping requests).
  const runSeq   = useRef(0);
  const timer    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const stopTimers = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const reset = useCallback(() => {
    runSeq.current += 1;        // invalidate any in-flight loop
    stopTimers();
    setPhase('idle'); setPayload(null); setError(null);
    setDisabledReason(null); setDisabledPrereqs([]); setRunId(null);
  }, [stopTimers]);

  // Poll a result route until the payload status is terminal. An inner
  // hoisted `tick` carries the recursion so the memoized callback never
  // references itself.
  const poll = useCallback((seq: number, route: string) => {
    const url = route.startsWith('http') ? route : `${BASE}${route}`;

    function tick(attempt: number) {
      if (seq !== runSeq.current) return;        // superseded
      if (attempt > MAX_POLLS) {
        setError('result polling timed out'); setPhase('error'); return;
      }
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      fetch(url, { headers: authHeaders(), signal: ctrl.signal })
        .then(async (res) => {
          if (seq !== runSeq.current) return;
          if (res.status === 503) {              // result API gated off
            setDisabledReason('The result API is disabled on the server (ENABLE_DELIVERABLE_RESULT_API).');
            setPhase('disabled');
            return;
          }
          const body = (await res.json().catch(() => ({}))) as Partial<ResultResponse>;
          const result = body?.result;
          if (!res.ok || !result) {
            setError(`result request failed (${res.status})`); setPhase('error');
            return;
          }
          if (seq !== runSeq.current) return;
          setPayload(result);
          setPhase(phaseForStatus(result.status));
          // Keep polling only while non-terminal.
          if (!isResultTerminal(result.status)) {
            timer.current = setTimeout(() => tick(attempt + 1), POLL_MS);
          }
        })
        .catch((e: unknown) => {
          if ((e as { name?: string })?.name === 'AbortError') return;
          if (seq !== runSeq.current) return;
          // Transient network error → retry on the same cadence (bounded).
          timer.current = setTimeout(() => tick(attempt + 1), POLL_MS);
        });
    }

    tick(0);
  }, []);

  const run = useCallback((prompt: string, opts: { projectId?: string } = {}) => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    // Start a fresh run: invalidate prior loop, clear state.
    runSeq.current += 1;
    const seq = runSeq.current;
    stopTimers();
    setPayload(null); setError(null);
    setDisabledReason(null); setDisabledPrereqs([]); setRunId(null);
    setPhase('planning');

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    fetch(`${BASE}/v2/intelligence/orchestrate`, {
      method: 'POST',
      headers: authHeaders(),
      signal: ctrl.signal,
      body: JSON.stringify({
        prompt: trimmed,
        project_id: opts.projectId,
        dry_run: false,
        execute: true,
      }),
    })
      .then(async (res) => {
        if (seq !== runSeq.current) return;
        if (res.status === 503) {                // bridge gated off
          setDisabledReason('AI execution is disabled on the server (ENABLE_BLUEPRINT_ORCHESTRATOR_BRIDGE).');
          setPhase('disabled');
          return;
        }
        const body = (await res.json().catch(() => ({}))) as OrchestrateResponse;
        if (!res.ok) {
          setError(`orchestrate failed (${res.status})`); setPhase('error');
          return;
        }
        const exec = body.execution;
        const route = body.result_route;
        const prereqs = exec?.disabled_prerequisites || body.disabled_prerequisites || [];
        // Execution prerequisites off → nothing actually ran. Be honest.
        if (!exec?.executed || !route) {
          setDisabledPrereqs(prereqs);
          setDisabledReason(
            prereqs.length
              ? 'Execution prerequisites are disabled on the server.'
              : 'The run did not start (execution is unavailable).',
          );
          setPhase('disabled');
          return;
        }
        setRunId(exec.run_id ?? null);
        setPhase('running');
        poll(seq, route);
      })
      .catch((e: unknown) => {
        if ((e as { name?: string })?.name === 'AbortError') return;
        if (seq !== runSeq.current) return;
        setError((e as Error)?.message || 'orchestrate request failed');
        setPhase('error');
      });
  }, [poll, stopTimers]);

  // Stop everything on unmount.
  useEffect(() => () => { runSeq.current += 1; stopTimers(); }, [stopTimers]);

  const isBusy = phase === 'planning' || phase === 'running' || phase === 'rendering';

  return {
    phase,
    label: PHASE_LABELS[phase],
    payload,
    error,
    disabledReason,
    disabledPrerequisites: disabledPrereqs,
    runId,
    isBusy,
    run,
    reset,
  };
}
