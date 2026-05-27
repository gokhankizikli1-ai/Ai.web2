// useClassify — Phase 9 part 2 hook for the Coordinator's complexity
// probe. Used by the FE to decide whether to render the
// "spawn workspace panel" affordance.
//
// Separate from useCoordinatorPlan because the two have different
// uses: plan is for showing the agent chain preview; classify is for
// the binary "is this a panel-worthy request?" decision. Both endpoints
// share the same `ENABLE_COORDINATOR` flag on the backend.
import { useCallback, useRef, useState } from 'react';

const BUNDLED_BACKEND = 'https://api.korvixai.com';

function resolveUrl(): string {
  const envBase = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
  const base = envBase ? envBase.replace(/\/+$/, '') : BUNDLED_BACKEND;
  return `${base}/v2/coordinator/classify`;
}

const URL_ENDPOINT = resolveUrl();

function getToken(): string | null {
  try { return localStorage.getItem('korvix_access_token'); }
  catch { return null; }
}

export interface ClassificationView {
  complexity:         'low' | 'medium' | 'high';
  triggers:           string[];
  should_spawn_panel: boolean;
  reason:             string;
}

export interface UseClassifyResult {
  classification: ClassificationView | null;
  loading:        boolean;
  unavailable:    boolean;
  classify:       (message: string, assetMimeTypes?: string[]) => Promise<ClassificationView | null>;
  clear:          () => void;
}


export function useClassify(): UseClassifyResult {
  const [classification, setClassification] = useState<ClassificationView | null>(null);
  const [loading, setLoading]               = useState(false);
  const [unavailable, setUnavailable]       = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const clear = useCallback(() => {
    if (abortRef.current) {
      try { abortRef.current.abort(); } catch { /* ignore */ }
      abortRef.current = null;
    }
    setClassification(null);
    setLoading(false);
  }, []);

  const classify = useCallback(
    async (message: string, assetMimeTypes: string[] = []): Promise<ClassificationView | null> => {
      const text = (message || '').trim();
      if (!text && assetMimeTypes.length === 0) {
        clear();
        return null;
      }
      // Cancel any prior in-flight call.
      if (abortRef.current) {
        try { abortRef.current.abort(); } catch { /* ignore */ }
      }
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
            message: text,
            asset_mime_types: assetMimeTypes,
          }),
        });
        if (res.status === 503) {
          setUnavailable(true); setClassification(null); return null;
        }
        if (!res.ok) {
          setClassification(null); return null;
        }
        const body = await res.json();
        const c = body?.data?.classification as ClassificationView | undefined;
        if (c && typeof c.complexity === 'string') {
          setClassification(c);
          setUnavailable(false);
          return c;
        }
        setClassification(null);
        return null;
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          // eslint-disable-next-line no-console
          console.debug('[useClassify] fetch error', err);
        }
        return null;
      } finally {
        if (abortRef.current === ac) abortRef.current = null;
        setLoading(false);
      }
    },
    [clear],
  );

  return { classification, loading, unavailable, classify, clear };
}

export default useClassify;
