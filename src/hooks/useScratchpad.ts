// useScratchpad — Phase 9 hook for the shared per-project journal.
//
// Read-only surface today (writes happen server-side from agent runs
// + the coordinator). Polls /v2/projects/{id}/scratchpad every 8s
// foreground / 30s background. Gracefully degrades to empty when the
// backend returns 503 (ENABLE_SCRATCHPAD=false) — caller hides the
// panel rather than rendering an empty state.
//
// The polling cadence is intentionally slower than the orchestration
// feed (4s) — the scratchpad is meant for reflective notes, not the
// per-second activity stream.
import { useCallback, useEffect, useRef, useState } from 'react';

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

export interface ScratchpadEntryView {
  id:              string;
  project_id:      string;
  user_id:         string;
  agent_id:        string;
  kind:            string;
  content:         string;
  workflow_id:     string | null;
  job_id:          string | null;
  parent_id:       string | null;
  correlation_id:  string | null;
  metadata:        Record<string, unknown>;
  created_at:      string;
}

export interface UseScratchpadResult {
  entries:      ScratchpadEntryView[];
  total:        number;
  loading:      boolean;
  isAvailable:  boolean;             // false → backend flag off / no JWT / 503; UI hides panel
  lastUpdatedAt: number | null;
  refresh:      () => void;
}

const POLL_MS_FOREGROUND = 8000;
const POLL_MS_BACKGROUND = 30000;


export function useScratchpad(
  projectId: string | null | undefined,
  opts: { kind?: string; workflowId?: string; limit?: number } = {},
): UseScratchpadResult {
  const { kind, workflowId, limit = 50 } = opts;

  const [entries, setEntries]       = useState<ScratchpadEntryView[]>([]);
  const [total, setTotal]           = useState(0);
  const [loading, setLoading]       = useState(false);
  const [isAvailable, setAvailable] = useState(true);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchOnce = useCallback(async () => {
    if (!projectId) {
      setEntries([]); setTotal(0); setAvailable(false);
      return;
    }
    const tok = getToken();
    if (!tok) {
      // Guest — scratchpad endpoint requires identity. Stay quiet.
      setEntries([]); setTotal(0); setAvailable(false);
      return;
    }
    // Cancel any prior in-flight fetch so an earlier poll can't
    // overwrite a newer one with stale data.
    if (abortRef.current) {
      try { abortRef.current.abort(); } catch { /* ignore */ }
    }
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    try {
      const qs = new URLSearchParams({ limit: String(limit) });
      if (kind)       qs.set('kind', kind);
      if (workflowId) qs.set('workflow_id', workflowId);
      const res = await fetch(
        `${BASE}/v2/projects/${encodeURIComponent(projectId)}/scratchpad?${qs.toString()}`,
        {
          headers: { Authorization: `Bearer ${tok}` },
          signal:  ac.signal,
        },
      );
      if (res.status === 503) {
        setAvailable(false); setEntries([]); setTotal(0); return;
      }
      if (!res.ok) {
        // 401 / network — keep current entries (don't blank the panel
        // on a transient blip), just flag unavailable so the UI can
        // dim it.
        setAvailable(false);
        return;
      }
      const body = await res.json();
      const list = body?.data?.entries as ScratchpadEntryView[] | undefined;
      if (Array.isArray(list)) {
        setEntries(list);
        setTotal(typeof body?.metadata?.total === 'number' ? body.metadata.total : list.length);
        setAvailable(true);
        setLastUpdatedAt(Date.now());
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        // eslint-disable-next-line no-console
        console.debug('[useScratchpad] fetch error', err);
        setAvailable(false);
      }
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
      setLoading(false);
    }
  }, [projectId, kind, workflowId, limit]);

  // Tab-visibility-aware polling — same pattern as useOrchestrationFeed.
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    let timer: number | null = null;

    const tick = async () => {
      if (cancelled) return;
      await fetchOnce();
      if (cancelled) return;
      const next = document.hidden ? POLL_MS_BACKGROUND : POLL_MS_FOREGROUND;
      timer = window.setTimeout(tick, next);
    };

    tick();
    const onVis = () => {
      // On returning to foreground, refresh immediately so the panel
      // is fresh before the next scheduled tick.
      if (!document.hidden) fetchOnce();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVis);
      if (abortRef.current) {
        try { abortRef.current.abort(); } catch { /* ignore */ }
      }
    };
  }, [projectId, fetchOnce]);

  return {
    entries, total, loading, isAvailable, lastUpdatedAt,
    refresh: fetchOnce,
  };
}

export default useScratchpad;
