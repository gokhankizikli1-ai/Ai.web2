// useJobs — Phase 7 frontend hook.
//
// Lightly polls /v2/jobs for the caller and returns the recent jobs +
// the count of "active" (queued + running) jobs. Used by the AI
// Activity feed in the chat dashboard so the "N active" badge reflects
// real backend state instead of demo data.
//
// Design rules:
//   * No-op when there's no JWT (guest) — returns an empty array.
//   * No-op when ENABLE_JOB_QUEUE is off (the route returns 503; we
//     swallow it and surface zero jobs).
//   * Polls every 4s by default. The Memory Plane diagnostic showed
//     SQLite reads are sub-millisecond, so this is cheap even at scale.
//   * Pauses when the document is hidden (visibilitychange) so we
//     don't drain mobile batteries.
//   * AbortController per fetch so unmounts don't leak requests.
import { useEffect, useRef, useState, useMemo } from 'react';

const BUNDLED_BACKEND = 'https://api.korvixai.com';

function resolveJobsUrl(): string {
  const envBase = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
  const base = envBase ? envBase.replace(/\/+$/, '') : BUNDLED_BACKEND;
  return `${base}/v2/jobs`;
}

const JOBS_URL: string = resolveJobsUrl();

// Polling interval in ms. Tuned for "live enough" without hammering
// the API. Bumped to 8s when the tab is in the background.
const POLL_INTERVAL_FOREGROUND = 4_000;
const POLL_INTERVAL_BACKGROUND = 20_000;

export interface JobSummary {
  id: string;
  kind: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'retrying';
  progress: number;
  progress_label?: string | null;
  created_at?: string;
  updated_at?: string;
  result?: Record<string, unknown> | null;
  error?: Record<string, unknown> | null;
}

export interface UseJobsResult {
  jobs:          JobSummary[];
  activeCount:   number;   // queued + running
  succeededCount: number;
  failedCount:   number;
  isAvailable:   boolean;  // false when /v2/jobs returned 503/401/network err
  lastUpdatedAt: number;
}

const EMPTY_RESULT: UseJobsResult = {
  jobs:           [],
  activeCount:    0,
  succeededCount: 0,
  failedCount:    0,
  isAvailable:    false,
  lastUpdatedAt:  0,
};

function getToken(): string | null {
  try {
    return localStorage.getItem('korvix_access_token');
  } catch {
    return null;
  }
}

export interface UseJobsOptions {
  /** When true, hit /v2/jobs/all (owner-only) instead of the per-caller
   *  /v2/jobs. Use this in admin/operator panels that need to see
   *  every job regardless of who created it (chat sessions might
   *  attribute jobs to a different user_id than the operator viewing
   *  the panel). Non-owners get 404 from /v2/jobs/all and the hook
   *  surfaces isAvailable=false silently. */
  allJobs?: boolean;
}

/**
 * Poll /v2/jobs (default) or /v2/jobs/all (owner-only) and return a
 * small summary.
 *
 * Pass `enabled=false` to disable polling entirely. Defaults to
 * enabled. Pass `options={allJobs: true}` for the owner panel path.
 */
export function useJobs(
  enabled: boolean = true,
  options: UseJobsOptions = {},
): UseJobsResult {
  const allJobs = !!options.allJobs;
  const [state, setState] = useState<UseJobsResult>(EMPTY_RESULT);
  // Track current document visibility — slow the poll when hidden.
  const hiddenRef = useRef<boolean>(
    typeof document !== 'undefined' && document.visibilityState === 'hidden',
  );

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let abort: AbortController | null = null;

    const tick = async () => {
      // Skip when there's no JWT — /v2/jobs requires auth.
      const tok = getToken();
      if (!tok) {
        if (!cancelled) setState(EMPTY_RESULT);
        return scheduleNext();
      }
      abort = new AbortController();
      try {
        // Owner panel uses /v2/jobs/all so chat-created jobs assigned
        // to a different user_id are visible. Non-owners get 404 ->
        // the isAvailable=false branch + silent degrade.
        const url = allJobs
          ? `${JOBS_URL}/all?limit=20`
          : `${JOBS_URL}?limit=20`;
        const r = await fetch(url, {
          method: 'GET',
          headers: { Authorization: `Bearer ${tok}` },
          signal: abort.signal,
        });
        if (!r.ok) {
          // 503 (queue disabled) or 401 (token expired). Treat as
          // unavailable; do NOT spam the console.
          if (!cancelled) setState((prev) => ({
            ...prev,
            isAvailable: false,
            lastUpdatedAt: Date.now(),
          }));
          return scheduleNext();
        }
        const body = await r.json();
        const arr: JobSummary[] = Array.isArray(body?.data?.jobs) ? body.data.jobs : [];
        if (cancelled) return;
        let active = 0, succeeded = 0, failed = 0;
        for (const j of arr) {
          if (j.status === 'queued' || j.status === 'running' || j.status === 'retrying') active++;
          else if (j.status === 'succeeded') succeeded++;
          else if (j.status === 'failed') failed++;
        }
        setState({
          jobs:           arr,
          activeCount:    active,
          succeededCount: succeeded,
          failedCount:    failed,
          isAvailable:    true,
          lastUpdatedAt:  Date.now(),
        });
      } catch (e: unknown) {
        // Network error or abort — silently degrade.
        if ((e as Error)?.name === 'AbortError') return;
        if (!cancelled) setState((prev) => ({ ...prev, isAvailable: false }));
      } finally {
        scheduleNext();
      }
    };

    const scheduleNext = () => {
      if (cancelled) return;
      const delay = hiddenRef.current ? POLL_INTERVAL_BACKGROUND : POLL_INTERVAL_FOREGROUND;
      timer = setTimeout(tick, delay);
    };

    const onVisibility = () => {
      hiddenRef.current = document.visibilityState === 'hidden';
      // Foreground transition → tick immediately so the badge wakes up.
      if (!hiddenRef.current) {
        if (timer) { clearTimeout(timer); timer = null; }
        tick();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    // Kick off the first poll.
    tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      abort?.abort();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled]);

  return state;
}

/**
 * Convert /v2/jobs rows into the AIActivity shape AIActivityFeed
 * already knows how to render. Memoise externally — this is a pure
 * pluggable formatter.
 *
 * Status mapping is constrained by the shared AIActivity type
 * (src/types/index.ts): only 'active' | 'completed' | 'queued' are
 * allowed. Backend job statuses map as follows:
 *   queued / running / retrying  → 'active'   (live progress)
 *   succeeded                    → 'completed' (terminal good)
 *   failed / cancelled           → 'queued'   (terminal but not
 *                                              successful — neutral
 *                                              clock icon; the row's
 *                                              `detail` carries
 *                                              "Cancelled" or the
 *                                              error message so the
 *                                              user sees what happened)
 */
export function jobsToActivities(jobs: JobSummary[]): Array<{
  id: string; status: 'active' | 'completed' | 'queued';
  message: string; detail?: string; progress?: number; timestamp: Date;
}> {
  return jobs.map((j) => {
    const isActive    = j.status === 'queued' || j.status === 'running' || j.status === 'retrying';
    const isCompleted = j.status === 'succeeded';
    return {
      id:        j.id,
      status:    isActive ? 'active' as const : isCompleted ? 'completed' as const : 'queued' as const,
      message:   prettyKind(j.kind),
      detail:    j.progress_label || statusDetail(j),
      progress:  isActive ? Math.max(0, Math.min(100, j.progress)) : undefined,
      timestamp: new Date(j.updated_at || j.created_at || Date.now()),
    };
  });
}

function prettyKind(kind: string): string {
  switch (kind) {
    case 'echo':                       return 'Echo task';
    case 'sleep_progress':             return 'Progress task';
    case 'memory_consolidation_stub':  return 'Memory review';
    default:                           return kind.replace(/_/g, ' ');
  }
}

function statusDetail(j: JobSummary): string | undefined {
  if (j.status === 'failed' && j.error?.message)   return String(j.error.message).slice(0, 60);
  if (j.status === 'cancelled')                    return 'Cancelled';
  if (j.status === 'succeeded')                    return 'Completed';
  return undefined;
}

/**
 * Hook + formatter combined — what most call sites want. Returns the
 * formatted activities ready for AIActivityFeed plus the live counts.
 */
export function useJobActivities(enabled: boolean = true): {
  activities: Array<{
    id: string; status: 'active' | 'completed' | 'queued';
    message: string; detail?: string; progress?: number; timestamp: Date;
  }>;
  activeCount: number;
  isAvailable: boolean;
} {
  const { jobs, activeCount, isAvailable } = useJobs(enabled);
  const activities = useMemo(() => jobsToActivities(jobs), [jobs]);
  return { activities, activeCount, isAvailable };
}

export default useJobs;
