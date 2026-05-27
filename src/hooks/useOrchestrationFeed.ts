// useOrchestrationFeed — Phase 9 unified live activity hook.
//
// Polls /v2/orchestration/activity (the backend aggregator that
// merges jobs + workflows + agent_tasks) and exposes a single
// activity list ready for AIActivityFeed. The previous useJobs hook
// remains for any callers that want jobs-only; this hook gives the
// chat dashboard the "AI OS team is working" feel from REAL state.
//
// Falls back gracefully:
//   * no JWT          → returns isAvailable=false, AIActivityFeed
//                        shows its demo fallback (existing behaviour)
//   * 503/404/network → same — demo fallback
//   * 200 with empty  → isAvailable=true, activities=[] (the feed
//                        hides itself rather than fabricating rows)
import { useEffect, useRef, useState } from 'react';
import type { AIActivity } from '@/types';

const BUNDLED_BACKEND = 'https://api.korvixai.com';
function resolveUrl(): string {
  const envBase = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
  const base = envBase ? envBase.replace(/\/+$/, '') : BUNDLED_BACKEND;
  return `${base}/v2/orchestration/activity`;
}

const ACTIVITY_URL: string = resolveUrl();
const POLL_INTERVAL_FG_MS = 4_000;
const POLL_INTERVAL_BG_MS = 20_000;


export interface OrchestrationActivityRow extends AIActivity {
  source?: 'job' | 'workflow' | 'agent_task';
  raw_status?: string;
  agent_id?: string;
}


export interface UseOrchestrationFeedResult {
  activities:  OrchestrationActivityRow[];
  activeCount: number;
  queuedCount: number;
  sources:     { jobs: number; workflows: number; agent_tasks: number };
  isAvailable: boolean;
  lastUpdatedAt: number;
}


const EMPTY: UseOrchestrationFeedResult = {
  activities:    [],
  activeCount:   0,
  queuedCount:   0,
  sources:       { jobs: 0, workflows: 0, agent_tasks: 0 },
  isAvailable:   false,
  lastUpdatedAt: 0,
};


function getToken(): string | null {
  try { return localStorage.getItem('korvix_access_token'); }
  catch { return null; }
}


export function useOrchestrationFeed(
  enabled: boolean = true,
  projectId?: string,
): UseOrchestrationFeedResult {
  const [state, setState] = useState<UseOrchestrationFeedResult>(EMPTY);
  const hiddenRef = useRef<boolean>(
    typeof document !== 'undefined' && document.visibilityState === 'hidden',
  );

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let abort: AbortController | null = null;

    const tick = async () => {
      const tok = getToken();
      if (!tok) {
        if (!cancelled) setState(EMPTY);
        return scheduleNext();
      }
      abort = new AbortController();
      try {
        const qp = projectId ? `?project_id=${encodeURIComponent(projectId)}&limit=20` : '?limit=20';
        const r = await fetch(`${ACTIVITY_URL}${qp}`, {
          method:  'GET',
          headers: { Authorization: `Bearer ${tok}` },
          signal:  abort.signal,
        });
        if (!r.ok) {
          if (!cancelled) setState((prev) => ({ ...prev, isAvailable: false,
                                                lastUpdatedAt: Date.now() }));
          return scheduleNext();
        }
        const body = await r.json();
        const rows: OrchestrationActivityRow[] = Array.isArray(body?.data?.activity)
          ? body.data.activity.map((row: any) => ({
              id:        String(row.id || ''),
              status:    (row.status || 'queued') as AIActivity['status'],
              message:   String(row.message || ''),
              detail:    row.detail || undefined,
              progress:  typeof row.progress === 'number' ? row.progress : undefined,
              timestamp: row.timestamp ? new Date(row.timestamp) : new Date(),
              source:    row.source as ('job' | 'workflow' | 'agent_task' | undefined),
              raw_status: row.raw_status || undefined,
              agent_id:  row.agent_id || undefined,
            }))
          : [];
        const meta = body?.metadata || {};
        if (!cancelled) {
          setState({
            activities:    rows,
            activeCount:   Number(meta.active_count) || 0,
            queuedCount:   Number(meta.queued_count) || 0,
            sources:       {
              jobs:        Number(meta?.sources?.jobs)        || 0,
              workflows:   Number(meta?.sources?.workflows)   || 0,
              agent_tasks: Number(meta?.sources?.agent_tasks) || 0,
            },
            isAvailable:   true,
            lastUpdatedAt: Date.now(),
          });
        }
      } catch (e: unknown) {
        if ((e as Error)?.name === 'AbortError') return;
        if (!cancelled) setState((prev) => ({ ...prev, isAvailable: false }));
      } finally {
        scheduleNext();
      }
    };

    const scheduleNext = () => {
      if (cancelled) return;
      const delay = hiddenRef.current ? POLL_INTERVAL_BG_MS : POLL_INTERVAL_FG_MS;
      timer = setTimeout(tick, delay);
    };

    const onVisibility = () => {
      hiddenRef.current = document.visibilityState === 'hidden';
      if (!hiddenRef.current) {
        if (timer) { clearTimeout(timer); timer = null; }
        tick();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      abort?.abort();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, projectId]);

  return state;
}

export default useOrchestrationFeed;
