// useRunResult — Sprint 1.7 — the resolved PreviewPayload for ONE existing run.
//
// GET /v2/orchestrator/runs/{run_id}/result (Sprint 1.5 Deliverable Result API).
// Read-only; no orchestrate POST (that's useOrchestrateResult, for NEW runs).
// Reuses the exact Sprint 1.5 PreviewPayload contract and the Sprint 1.6
// status→phase mapping so the existing <PreviewResult/> renders it unchanged.
// Polls only while the payload status is non-terminal; 503 → 'disabled'.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PreviewPayload, ResultResponse } from '@/types/preview';
import { isResultTerminal } from '@/types/preview';
import {
  phaseForStatus, orchestratePhaseLabel, type OrchestratePhase,
} from '@/hooks/useOrchestrateResult';

const BUNDLED_BACKEND = 'https://api.korvixai.com';
function resolveBase(): string {
  const envBase = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
  return envBase ? envBase.replace(/\/+$/, '') : BUNDLED_BACKEND;
}
const BASE = resolveBase();

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  let tok: string | null = null;
  try { tok = localStorage.getItem('korvix_access_token'); } catch { tok = null; }
  if (tok) h.Authorization = `Bearer ${tok}`;
  return h;
}

export type RunResultAvailability = 'unknown' | 'available' | 'disabled';

export interface UseRunResult {
  payload:      PreviewPayload | null;
  phase:        OrchestratePhase;
  label:        string;
  loading:      boolean;
  error:        string | null;
  availability: RunResultAvailability;
  refresh:      () => void;
}

const POLL_MS = 2500;

export function useRunResult(
  runId: string | null | undefined,
  opts: { enabled?: boolean } = {},
): UseRunResult {
  // `enabled` lets a caller (e.g. useLiveRun) defer result fetching until there
  // is something to resolve, avoiding redundant polling during an early run.
  const enabled = opts.enabled ?? true;
  const [payload, setPayload]           = useState<PreviewPayload | null>(null);
  const [phase, setPhase]               = useState<OrchestratePhase>('idle');
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [availability, setAvailability] = useState<RunResultAvailability>('unknown');

  const seq   = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abort = useRef<AbortController | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  }, []);

  // `load` only defines + kicks an inner async `tick`: the recursion is
  // self-contained and every setState (including the fresh-run reset) lives
  // inside the async tick — no sync setState in a tracked callback or effect.
  const load = useCallback((mySeq: number, id: string | null) => {
    async function tick(attempt: number) {
      if (mySeq !== seq.current) return;
      if (attempt === 0) {
        // Fresh run selected → clear any stale result.
        setPayload(null); setError(null); setPhase('idle'); setAvailability('unknown');
      }
      if (!id) return;
      abort.current?.abort();
      const ctrl = new AbortController();
      abort.current = ctrl;
      setLoading(true);
      try {
        const url = `${BASE}/v2/orchestrator/runs/${encodeURIComponent(id)}/result`;
        const res = await fetch(url, { headers: authHeaders(), signal: ctrl.signal });
        if (mySeq !== seq.current) return;
        if (res.status === 503) {
          setAvailability('disabled');
          setError(null);
          return;
        }
        const body = (await res.json().catch(() => ({}))) as Partial<ResultResponse>;
        const result = body?.result;
        if (!res.ok || !result) {
          setError(`result request failed (${res.status})`);
          return;
        }
        if (mySeq !== seq.current) return;
        setAvailability('available');
        setPayload(result);
        setPhase(phaseForStatus(result.status));
        setError(null);
        clearTimer();
        if (!isResultTerminal(result.status)) {
          timer.current = setTimeout(() => tick(attempt + 1), POLL_MS);
        }
      } catch (e: unknown) {
        if ((e as { name?: string })?.name === 'AbortError') return;
        if (mySeq !== seq.current) return;
        setError((e as Error)?.message || 'failed to load result');
      } finally {
        if (mySeq === seq.current) setLoading(false);
      }
    }
    tick(0);
  }, [clearTimer]);

  const refresh = useCallback(() => {
    if (!runId || !enabled) return;
    seq.current += 1;
    load(seq.current, runId);
  }, [runId, enabled, load]);

  useEffect(() => {
    seq.current += 1;
    // When disabled, load(null) resets to idle and fetches nothing.
    load(seq.current, enabled ? (runId ?? null) : null);
    return () => { seq.current += 1; clearTimer(); abort.current?.abort(); };
  }, [runId, enabled, load, clearTimer]);

  return {
    payload, phase, label: orchestratePhaseLabel(phase),
    loading, error, availability, refresh,
  };
}
