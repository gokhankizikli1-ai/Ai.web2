// useJob — Phase 7 slice 5 frontend hook.
//
// Subscribes to /v2/jobs/{id}/stream via EventSource and exposes a
// live {status, progress, label, result, error} state to React
// consumers. Wraps the existing per-job SSE endpoint shipped in
// earlier slices.
//
// Design rules:
//   * Single connection per id — multiple consumers of the same id
//     get their own EventSource (cheap; SSE is push-only). Use the
//     existing useJobs() polling hook if you need a whole list.
//   * Reconnects automatically on network drop with exponential
//     backoff (1s → 30s). The SSE bridge re-emits the current
//     `snapshot` frame on reconnect so the FE never loses state.
//   * Stops automatically when the job reaches a terminal status
//     (succeeded/failed/cancelled/failed_dlq) — no zombie streams.
//   * No-op when the caller passes an empty id (returns a stable
//     idle state). Useful for conditional rendering.
//   * Cleans up the EventSource + any pending timers on unmount.
//
// Frame protocol (matches backend/routes/v2_jobs.py event_stream):
//   event: snapshot   — full current JobRecord on connect
//   event: status     — status transition
//   event: progress   — {progress: number, label?: string}
//   event: heartbeat  — keep-alive every ~15s on idle (ignored here)
//   event: done       — terminal success {status, result}
//   event: error      — terminal failure {status, error}
import { useEffect, useRef, useState } from 'react';

const BUNDLED_BACKEND = 'https://api.korvixai.com';

function resolveBaseUrl(): string {
  const envBase = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
  const base = envBase ? envBase.replace(/\/+$/, '') : BUNDLED_BACKEND;
  return base;
}

const BASE_URL: string = resolveBaseUrl();

export type JobStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'retrying'
  | 'failed_dlq';

const TERMINAL: ReadonlySet<JobStatus> = new Set<JobStatus>([
  'succeeded', 'failed', 'cancelled', 'failed_dlq',
]);

export interface UseJobState {
  /** Job id this state belongs to (echoes input for convenience). */
  id: string;
  /** Most recent known status. Null until the snapshot frame lands. */
  status: JobStatus | null;
  /** 0..100. Null until the first progress frame OR snapshot.progress. */
  progress: number | null;
  /** Optional human-readable label that ships with progress frames. */
  label: string | null;
  /** Populated on terminal `done` frame. */
  result: Record<string, unknown> | null;
  /** Populated on terminal `error` frame OR mid-flight failed state. */
  error: Record<string, unknown> | null;
  /** Stream connectivity. False during reconnect backoff. */
  connected: boolean;
  /** Stream attempted at least once (vs idle/empty-id). */
  active: boolean;
}

const IDLE: UseJobState = {
  id: '', status: null, progress: null, label: null,
  result: null, error: null, connected: false, active: false,
};

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

interface SSEPayload {
  job?: Record<string, unknown>;
  status?: string;
  progress?: number;
  label?: string | null;
  result?: Record<string, unknown>;
  error?: Record<string, unknown>;
  ts?: string;
}

/**
 * Subscribe to live progress for one job by id.
 *
 * Passing an empty id returns a stable idle state and never opens a
 * connection. Useful for "submit a job, then watch it" flows where
 * the id is null until the POST returns.
 */
export function useJob(jobId: string | null | undefined): UseJobState {
  const id = (jobId || '').trim();
  const [state, setState] = useState<UseJobState>({ ...IDLE, id });

  // Reset state when the watched id changes — otherwise stale progress
  // would bleed from job-A into job-B.
  useEffect(() => {
    setState({ ...IDLE, id });
  }, [id]);

  // Refs that span re-renders; the cleanup function reads them.
  const esRef        = useRef<EventSource | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef   = useRef<number>(RECONNECT_MIN_MS);
  const stoppedRef   = useRef<boolean>(false);

  useEffect(() => {
    // Idle when no id.
    if (!id) {
      return () => undefined;
    }

    stoppedRef.current = false;

    function clearReconnect(): void {
      if (reconnectRef.current) {
        clearTimeout(reconnectRef.current);
        reconnectRef.current = null;
      }
    }

    function closeStream(): void {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    }

    function scheduleReconnect(): void {
      if (stoppedRef.current) return;
      clearReconnect();
      const wait = backoffRef.current;
      backoffRef.current = Math.min(wait * 2, RECONNECT_MAX_MS);
      reconnectRef.current = setTimeout(connect, wait);
    }

    function applySnapshot(job: Record<string, unknown>): void {
      // The snapshot frame carries the entire JobRecord. We project
      // the fields useJob cares about.
      const s = (job.status as JobStatus) || null;
      const p = typeof job.progress === 'number'
        ? Math.max(0, Math.min(100, job.progress))
        : null;
      setState((prev) => ({
        ...prev,
        status:   s,
        progress: p,
        label:    (job.progress_label as string | null) ?? prev.label,
        result:   (job.result as Record<string, unknown> | null) ?? null,
        error:    (job.error  as Record<string, unknown> | null) ?? null,
      }));
      // If the snapshot indicates terminal, close immediately —
      // matches the backend's same-frame done/error behaviour.
      if (s && TERMINAL.has(s)) {
        stoppedRef.current = true;
        clearReconnect();
        closeStream();
      }
    }

    function applyStatus(payload: SSEPayload): void {
      const s = payload.status as JobStatus | undefined;
      if (!s) return;
      setState((prev) => ({ ...prev, status: s }));
      if (TERMINAL.has(s)) {
        stoppedRef.current = true;
        clearReconnect();
        closeStream();
      }
    }

    function applyProgress(payload: SSEPayload): void {
      if (typeof payload.progress !== 'number') return;
      const p = Math.max(0, Math.min(100, payload.progress));
      setState((prev) => ({
        ...prev,
        progress: p,
        label:    payload.label ?? prev.label,
      }));
    }

    function applyDone(payload: SSEPayload): void {
      setState((prev) => ({
        ...prev,
        status:    (payload.status as JobStatus) || 'succeeded',
        progress:  100,
        result:    payload.result ?? null,
        error:     null,
        connected: false,
      }));
      stoppedRef.current = true;
      clearReconnect();
      closeStream();
    }

    function applyError(payload: SSEPayload): void {
      setState((prev) => ({
        ...prev,
        status:    (payload.status as JobStatus) || 'failed',
        error:     payload.error ?? prev.error,
        connected: false,
      }));
      stoppedRef.current = true;
      clearReconnect();
      closeStream();
    }

    function connect(): void {
      if (stoppedRef.current) return;
      closeStream();
      setState((prev) => ({ ...prev, active: true }));

      const url = `${BASE_URL}/v2/jobs/${encodeURIComponent(id)}/stream`;
      // withCredentials so cookie-based auth flows still work; bearer
      // auth callers should set the JWT on the EventSource polyfill
      // OR rely on the JWT being cookie-stored.
      const es = new EventSource(url, { withCredentials: true });
      esRef.current = es;

      es.onopen = (): void => {
        backoffRef.current = RECONNECT_MIN_MS;        // reset on success
        setState((prev) => ({ ...prev, connected: true }));
      };

      // Handle each named event type. EventSource fires onmessage for
      // events with no `event:` line; our stream always names them.
      es.addEventListener('snapshot', (e) => {
        try {
          const payload = JSON.parse((e as MessageEvent).data) as SSEPayload;
          if (payload.job) applySnapshot(payload.job);
        } catch { /* ignore malformed frame */ }
      });
      es.addEventListener('status', (e) => {
        try { applyStatus(JSON.parse((e as MessageEvent).data) as SSEPayload); }
        catch { /* ignore */ }
      });
      es.addEventListener('progress', (e) => {
        try { applyProgress(JSON.parse((e as MessageEvent).data) as SSEPayload); }
        catch { /* ignore */ }
      });
      es.addEventListener('done', (e) => {
        try { applyDone(JSON.parse((e as MessageEvent).data) as SSEPayload); }
        catch { /* ignore */ }
      });
      es.addEventListener('error', (e) => {
        try { applyError(JSON.parse((e as MessageEvent).data) as SSEPayload); }
        catch { /* ignore */ }
      });
      // heartbeat ignored — onopen already records connectivity

      // Native EventSource fires onerror on network drop / server
      // close. Reconnect with backoff unless we already saw terminal.
      es.onerror = (): void => {
        setState((prev) => ({ ...prev, connected: false }));
        if (stoppedRef.current) {
          closeStream();
          return;
        }
        scheduleReconnect();
      };
    }

    connect();

    return (): void => {
      stoppedRef.current = true;
      clearReconnect();
      closeStream();
    };
  }, [id]);

  return state;
}

export default useJob;
