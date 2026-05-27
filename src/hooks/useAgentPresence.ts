// useAgentPresence — Phase 9 part 2 polling hook for live agent
// activity on a panel.
//
// Polls GET /v2/agents/presence?panel_id=... every 3 s foreground /
// 15 s background. SSE wiring (through the existing events/bus) is a
// follow-up PR; for now poll is fast enough because the snapshot is
// in-memory on the backend and the read is O(N) over a tiny dict.
//
// Gracefully degrades to an empty list when:
//   - VITE_API_URL isn't set,
//   - the user is a guest (no JWT) — presence is a panel-owner concept,
//   - the backend returns 503 (ENABLE_AGENT_PRESENCE=false),
//   - or the network drops.
//
// The hook is a no-op when `panelId` is null/empty so it's safe to
// always call from the workspace view; only an actual panel id starts
// the poll loop.
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

export interface AgentPresenceView {
  panel_id:        string;
  agent_id:        string;
  state:           string;      // idle | thinking | researching | coding | analyzing | waiting | blocked | completed | failed
  current_task:    string | null;
  progress:        number | null;
  detail:          string | null;
  metadata:        Record<string, unknown>;
  started_at_ms:   number;
  last_seen_at_ms: number;
}

export interface UseAgentPresenceResult {
  rows:          AgentPresenceView[];
  isAvailable:   boolean;        // false → backend flag off / no JWT / 503; UI hides the list
  lastUpdatedAt: number | null;
  refresh:       () => void;
}

const POLL_FOREGROUND_MS = 3000;
const POLL_BACKGROUND_MS = 15000;


export function useAgentPresence(
  panelId: string | null | undefined,
): UseAgentPresenceResult {
  const [rows, setRows]             = useState<AgentPresenceView[]>([]);
  const [isAvailable, setAvailable] = useState(true);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchOnce = useCallback(async () => {
    if (!panelId) {
      setRows([]); setAvailable(false); return;
    }
    const tok = getToken();
    if (!tok) {
      setRows([]); setAvailable(false); return;
    }
    // Cancel any in-flight fetch so a slow request can't overwrite a
    // fresher one.
    if (abortRef.current) {
      try { abortRef.current.abort(); } catch { /* ignore */ }
    }
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const url = `${BASE}/v2/agents/presence?panel_id=${encodeURIComponent(panelId)}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${tok}` },
        signal:  ac.signal,
      });
      if (res.status === 503) {
        setAvailable(false); setRows([]); return;
      }
      if (!res.ok) {
        // Transient 4xx/5xx — keep existing rows so the list doesn't
        // flicker empty, just flag unavailable.
        setAvailable(false);
        return;
      }
      const body = await res.json();
      const list = body?.data?.presence as AgentPresenceView[] | undefined;
      if (Array.isArray(list)) {
        setRows(list);
        setAvailable(true);
        setLastUpdatedAt(Date.now());
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        // eslint-disable-next-line no-console
        console.debug('[useAgentPresence] fetch error', err);
        setAvailable(false);
      }
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
    }
  }, [panelId]);

  useEffect(() => {
    if (!panelId) return;
    let cancelled = false;
    let timer: number | null = null;

    const tick = async () => {
      if (cancelled) return;
      await fetchOnce();
      if (cancelled) return;
      const next = document.hidden ? POLL_BACKGROUND_MS : POLL_FOREGROUND_MS;
      timer = window.setTimeout(tick, next);
    };

    tick();
    const onVis = () => { if (!document.hidden) fetchOnce(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVis);
      if (abortRef.current) {
        try { abortRef.current.abort(); } catch { /* ignore */ }
      }
    };
  }, [panelId, fetchOnce]);

  return { rows, isAvailable, lastUpdatedAt, refresh: fetchOnce };
}

export default useAgentPresence;
