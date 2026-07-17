// useCoordinatorPlan — Phase 9 hook for the Coordinator's plan preview.
//
// Calls POST /v2/coordinator/plan with the current composer text + the
// MIMEs of any attached assets. Returns the structured plan (or null
// when the coordinator is disabled / unreachable / the prompt is
// empty). The hook is intentionally debounced and HTTP-only — no SSE,
// no LLM call, no DB read on the backend either (the coordinator is
// pure rule-based today). Safe to call on every keystroke.
//
// Gated by `VITE_ENABLE_COORDINATOR_PREVIEW=true`. When unset, the
// hook is a hard no-op so we don't burn the network round-trip for
// users who haven't opted in.
import { useEffect, useRef, useState, useCallback } from 'react';

const BUNDLED_BACKEND = 'https://api.korvixai.com';

function resolveUrl(): string {
  const envBase = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
  const base = envBase ? envBase.replace(/\/+$/, '') : BUNDLED_BACKEND;
  return `${base}/v2/coordinator/plan`;
}

const URL_ENDPOINT = resolveUrl();

const PREVIEW_ENABLED: boolean = (() => {
  const raw = (import.meta.env.VITE_ENABLE_COORDINATOR_PREVIEW as string | undefined)
    ?.trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes';
})();

function getToken(): string | null {
  try { return localStorage.getItem('korvix_access_token'); }
  catch { return null; }
}

export interface AgentInvocationView {
  agent_id:   string;
  reason:     string;
  depends_on: string[];
  inputs:     Record<string, unknown>;
}

export interface PlanView {
  intent:         string;
  routing_method: string;
  confidence:     number;
  agents:         AgentInvocationView[];
  notes:          string[];
}

export interface UseCoordinatorPlanResult {
  plan:       PlanView | null;
  loading:    boolean;
  unavailable: boolean;          // true when the FE flag is off OR backend returned 503
  refresh:    (message: string, assetMimeTypes?: string[], projectId?: string) => void;
  clear:      () => void;
}

// Debounce window — the rule-based classifier runs in O(microseconds),
// but we still don't want a 300 wpm typist firing 300 requests/sec.
const DEBOUNCE_MS = 350;

// Below this length we don't bother — short prompts almost always
// fall back to "no specialist signal" anyway and the UI clutter isn't
// worth it.
const MIN_MESSAGE_LEN = 12;


export function useCoordinatorPlan(): UseCoordinatorPlanResult {
  const [plan, setPlan]           = useState<PlanView | null>(null);
  const [loading, setLoading]     = useState(false);
  const [unavailable, setUnavailable] = useState<boolean>(!PREVIEW_ENABLED);
  const debounceRef = useRef<number | null>(null);
  const abortRef    = useRef<AbortController | null>(null);

  // Cancel any pending debounced fetch and any in-flight request.
  const cancel = useCallback(() => {
    if (debounceRef.current != null) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (abortRef.current) {
      try { abortRef.current.abort(); } catch { /* ignore */ }
      abortRef.current = null;
    }
  }, []);

  const clear = useCallback(() => {
    cancel();
    setPlan(null);
    setLoading(false);
  }, [cancel]);

  const refresh = useCallback(
    (message: string, assetMimeTypes: string[] = [], projectId?: string) => {
      if (!PREVIEW_ENABLED) return;
      const text = (message || '').trim();
      // No signal worth fetching — just clear and bail.
      if (text.length < MIN_MESSAGE_LEN && assetMimeTypes.length === 0) {
        cancel();
        setPlan(null);
        return;
      }
      cancel();
      debounceRef.current = window.setTimeout(async () => {
        const ac = new AbortController();
        abortRef.current = ac;
        setLoading(true);
        try {
          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          const tok = getToken();
          if (tok) headers['Authorization'] = `Bearer ${tok}`;
          const res = await fetch(URL_ENDPOINT, {
            method:  'POST',
            headers,
            signal:  ac.signal,
            body: JSON.stringify({
              message:           text,
              asset_mime_types:  assetMimeTypes,
              ...(projectId ? { project_id: projectId } : {}),
            }),
          });
          // 409 = coordinator not enabled (canonical disabled status; was 503).
          // 403 = not permitted. Both are PERSISTENT states → stop retrying and
          // hide the chip. 503 kept for backward-compat with older backends.
          if (res.status === 409 || res.status === 403 || res.status === 503 || res.status === 501) {
            setUnavailable(true);
            setPlan(null);
            return;
          }
          if (!res.ok) {
            setPlan(null);
            return;
          }
          const body = await res.json();
          const p = body?.data?.plan as PlanView | undefined;
          if (p && Array.isArray(p.agents)) {
            setPlan(p);
            setUnavailable(false);
          } else {
            setPlan(null);
          }
        } catch (err) {
          // Aborted is expected (typing → debounce restart). Anything
          // else: be quiet — the chip is non-essential.
          if (!(err instanceof DOMException && err.name === 'AbortError')) {
            // eslint-disable-next-line no-console
            console.debug('[useCoordinatorPlan] fetch error', err);
          }
        } finally {
          if (abortRef.current === ac) abortRef.current = null;
          setLoading(false);
        }
      }, DEBOUNCE_MS);
    },
    [cancel],
  );

  // Cleanup on unmount.
  useEffect(() => () => cancel(), [cancel]);

  return { plan, loading, unavailable, refresh, clear };
}

export default useCoordinatorPlan;
