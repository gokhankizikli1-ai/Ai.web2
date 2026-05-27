// useTools — Phase 10 hook for the public tool catalogue.
//
// One-time fetch of GET /v2/tools — the catalogue is stable enough
// that re-polling on a timer would be wasteful. Caller can call
// refresh() if a flag flip on the backend changes the set.
//
// Returns an empty list when:
//   - no JWT (route requires identity),
//   - ENABLE_TOOLS is off on the backend (route returns 200 with []).
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

export interface ToolDescriptor {
  id:               string;
  name:             string;
  description:      string;
  category:         string;      // "research" | "code" | "data" | "ecommerce" | "general" | …
  icon:             string;      // lucide-react icon name; FE maps the string
  requires_auth:    boolean;
  cost_estimate:    number;
  execution_mode:   string;      // "sync" | "async" | "streaming" | "background"
  supported_agents: string[];
  input_schema:     Record<string, unknown> | null;
  output_schema:    Record<string, unknown> | null;
  timeout_seconds:  number;
}

export interface UseToolsResult {
  tools:   ToolDescriptor[];
  loading: boolean;
  loaded:  boolean;
  refresh: () => void;
}


export function useTools(): UseToolsResult {
  const [tools, setTools]     = useState<ToolDescriptor[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded]   = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchOnce = useCallback(async () => {
    const tok = getToken();
    if (!tok) {
      setTools([]); setLoaded(true); return;
    }
    if (abortRef.current) {
      try { abortRef.current.abort(); } catch { /* ignore */ }
    }
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/v2/tools`, {
        headers: { Authorization: `Bearer ${tok}` },
        signal:  ac.signal,
      });
      if (!res.ok) { setTools([]); setLoaded(true); return; }
      const body = await res.json();
      const list = body?.data?.tools as ToolDescriptor[] | undefined;
      setTools(Array.isArray(list) ? list : []);
      setLoaded(true);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        // eslint-disable-next-line no-console
        console.debug('[useTools] fetch error', err);
      }
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOnce();
    return () => {
      if (abortRef.current) {
        try { abortRef.current.abort(); } catch { /* ignore */ }
      }
    };
  }, [fetchOnce]);

  return { tools, loading, loaded, refresh: fetchOnce };
}

export default useTools;
