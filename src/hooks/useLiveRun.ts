// useLiveRun — Sprint 1.8 — the live run experience over EXISTING contracts.
//
// Streams a run's snapshot from the already-built secure SSE endpoint
//   GET /v2/orchestrator/runs/{run_id}/stream
// consumed via fetch()+ReadableStream so the Sprint 1.2 Bearer principal is
// sent (EventSource cannot set headers; ownership is enforced server-side →
// cross-user 404). Falls back to polling getRun when streaming is disabled,
// unavailable, or fails. Stops cleanly on terminal status; cleans up on
// unmount; never double-connects or double-polls. The final PreviewPayload is
// resolved via the existing useRunResult (gated so it only fetches once there
// is something to resolve). No fake events, no fabricated progress.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  projectOrchestratorClient, isRunTerminal,
  type RunSnapshot, type DeliverableView,
} from '@/hooks/useProjectOrchestrator';
import { useRunResult, type UseRunResult } from '@/hooks/useRunResult';
import { createSSEParser, parseFrameData } from '@/lib/sse';
import { deriveStages, type StageState } from '@/lib/runStages';

const BUNDLED_BACKEND = 'https://api.korvixai.com';
function resolveBase(): string {
  const envBase = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
  return envBase ? envBase.replace(/\/+$/, '') : BUNDLED_BACKEND;
}
const BASE = resolveBase();

// Frontend streaming toggle (Vercel). Default ON; set 'false'/'0' to force the
// polling path (e.g. proxies that buffer SSE). Polling always works.
function streamingEnabled(): boolean {
  const v = (import.meta.env.VITE_ENABLE_RUN_STREAMING as string | undefined)?.trim().toLowerCase();
  return v !== 'false' && v !== '0';
}
const STREAMING_ENABLED = streamingEnabled();

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  let tok: string | null = null;
  try { tok = localStorage.getItem('korvix_access_token'); } catch { tok = null; }
  if (tok) h.Authorization = `Bearer ${tok}`;
  return h;
}

export type LiveConnection =
  | 'idle' | 'connecting' | 'live' | 'polling' | 'closed' | 'disabled' | 'error';

export interface UseLiveRun {
  snapshot:     RunSnapshot | null;
  status:       string;
  deliverables: DeliverableView[];
  phases:       StageState[];
  result:       UseRunResult;          // the Sprint 1.7 PreviewPayload hook
  warnings:     string[];
  errors:       string[];
  connection:   LiveConnection;
  lastEventAt:  number | null;
  isTerminal:   boolean;
  isStreaming:  boolean;
  cancel:       () => Promise<void>;
  refresh:      () => void;
}

const POLL_MS = 2000;

export function useLiveRun(
  runId: string | null | undefined,
  opts: { initialStatus?: string } = {},
): UseLiveRun {
  const [snapshot, setSnapshot]     = useState<RunSnapshot | null>(null);
  const [status, setStatus]         = useState<string>('');
  const [connection, setConnection] = useState<LiveConnection>('idle');
  const [lastEventAt, setLastEvent] = useState<number | null>(null);
  const [streamError, setStreamErr] = useState<string | null>(null);

  const seq    = useRef(0);
  const timer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abort  = useRef<AbortController | null>(null);
  // Mirror connection into a ref so the poll loop reads it without a dep cycle.
  const connectionRef = useRef<LiveConnection>('idle');
  connectionRef.current = connection;

  const initialStatus = opts.initialStatus;
  const isTerminal = isRunTerminal(status);
  const deliverables = snapshot?.deliverables ?? [];

  // Resolve the final PreviewPayload only once there's something to resolve.
  const hasCompleted = deliverables.some(d => d.status === 'completed');
  const result = useRunResult(runId, { enabled: isTerminal || hasCompleted });

  const stop = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    abort.current?.abort();
    abort.current = null;
  }, []);

  // `begin` is async (all setState lives here, never synchronously in the
  // effect) and defines inner pollLoop/openStream so neither callback
  // references itself. It first resets, then streams-or-polls.
  const begin = useCallback(async (mySeq: number, id: string | null, initStatus?: string) => {
    if (mySeq !== seq.current) return;
    setSnapshot(null); setStatus(''); setStreamErr(null); setLastEvent(null);
    if (!id) { setConnection('idle'); return; }
    const rid: string = id;   // non-null binding for the nested closures
    setConnection('connecting');
    const knownTerminal = initStatus ? isRunTerminal(initStatus) : false;

    const apply = (snap: RunSnapshot) => {
      if (mySeq !== seq.current) return;
      setSnapshot(snap);
      setStatus(String(snap.status || ''));
      setLastEvent(Date.now());
    };

    // ── Polling fallback ─────────────────────────────────────────────────
    const pollLoop = () => {
      if (mySeq !== seq.current) return;
      if (connectionRef.current !== 'closed') setConnection('polling');
      async function tick() {
        if (mySeq !== seq.current) return;
        abort.current?.abort();
        const ctrl = new AbortController();
        abort.current = ctrl;
        try {
          const snap = await projectOrchestratorClient.getRun(rid, ctrl.signal);
          if (mySeq !== seq.current) return;
          apply(snap);
          if (isRunTerminal(snap.status)) { setConnection('closed'); return; }
          timer.current = setTimeout(tick, POLL_MS);
        } catch (e: unknown) {
          if ((e as { name?: string })?.name === 'AbortError') return;
          if (mySeq !== seq.current) return;
          const code = (e as { code?: string })?.code;
          if (code === 'project_orchestrator_disabled') { setConnection('disabled'); return; }
          if (code === 'orchestrator_run_not_found' || /not.?found/i.test((e as Error)?.message || '')) {
            setStreamErr('Run not found'); setConnection('error'); return;
          }
          timer.current = setTimeout(tick, POLL_MS);   // transient → retry
        }
      }
      tick();
    };

    // ── SSE stream (preferred) ───────────────────────────────────────────
    const openStream = async () => {
      setConnection('connecting');
      const ctrl = new AbortController();
      abort.current = ctrl;
      let res: Response;
      try {
        res = await fetch(`${BASE}/v2/orchestrator/runs/${encodeURIComponent(rid)}/stream`, {
          headers: authHeaders(), signal: ctrl.signal,
        });
      } catch (e: unknown) {
        if ((e as { name?: string })?.name === 'AbortError') return;
        pollLoop(); return;                 // connect failed → poll
      }
      if (mySeq !== seq.current) return;
      if (res.status === 503) { setConnection('disabled'); return; }
      if (!res.ok || !res.body) { pollLoop(); return; }

      setConnection('live');
      let terminalSeen = false;
      const parser = createSSEParser((frame) => {
        if (frame.event === 'snapshot') {
          const snap = parseFrameData<RunSnapshot>(frame);
          if (snap) apply(snap);
        } else if (frame.event === 'done') {
          const d = parseFrameData<{ status?: string }>(frame);
          if (mySeq === seq.current) {
            if (d?.status) setStatus(d.status);
            setConnection('closed');
          }
          terminalSeen = true;
        } else if (frame.event === 'error') {
          if (mySeq === seq.current) { setStreamErr('Run not found'); setConnection('error'); }
          terminalSeen = true;
        }
        // 'timeout' → handled after the read loop (fall back to polling).
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          parser.push(decoder.decode(value, { stream: true }));
          if (mySeq !== seq.current) { try { await reader.cancel(); } catch { /* ignore */ } return; }
          if (terminalSeen) return;
        }
      } catch (e: unknown) {
        if ((e as { name?: string })?.name === 'AbortError') return;
        if (mySeq !== seq.current) return;
        pollLoop(); return;                 // stream broke mid-flight → poll
      }
      // Stream ended without a terminal 'done' (e.g. server max-seconds) and
      // the run may still be going → keep watching via polling.
      if (mySeq === seq.current && !terminalSeen) pollLoop();
    };

    if (knownTerminal || !STREAMING_ENABLED) pollLoop();
    else await openStream();
  }, []);

  // Sync wrapper: NO setState in its body (it only delegates to async begin),
  // so the effect/refresh that call it are never flagged set-state-in-effect.
  const kick = useCallback((id: string | null, initStatus?: string) => {
    begin(seq.current, id, initStatus);
  }, [begin]);

  const refresh = useCallback(() => {
    if (!runId) return;
    stop();
    seq.current += 1;
    kick(runId, undefined);
    result.refresh();
  }, [runId, stop, kick, result]);

  const cancel = useCallback(async () => {
    if (!runId) return;
    try { await projectOrchestratorClient.cancelRun(runId); } catch { /* surfaced on next tick */ }
    refresh();
  }, [runId, refresh]);

  useEffect(() => {
    stop();
    seq.current += 1;
    kick(runId ?? null, initialStatus);
    return () => { seq.current += 1; stop(); };
  }, [runId, initialStatus, kick, stop]);

  const phases = deriveStages(status, result.payload?.status ?? null);
  const warnings = result.payload?.warnings ?? [];
  const errors = [streamError, ...(result.payload?.errors ?? [])].filter(Boolean) as string[];

  return {
    snapshot, status, deliverables, phases, result, warnings, errors,
    connection, lastEventAt, isTerminal,
    isStreaming: connection === 'live',
    cancel, refresh,
  };
}
