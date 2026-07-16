/**
 * Stock photo search client (Phase 14K.2).
 *
 * Talks ONLY to the Korvix backend (`/v2/web-build/images/stock/*`), which
 * proxies Pexels + Unsplash server-side. The browser never sees a provider key
 * and never talks to a provider directly. Results are the normalized shape the
 * backend returns — no raw Pexels/Unsplash payloads.
 */

const BUNDLED_BACKEND = 'https://worker-production-1345.up.railway.app';

function apiBase(): string {
  const envBase = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
  return envBase ? envBase.replace(/\/+$/, '') : BUNDLED_BACKEND;
}

function authHeaders(json = false): Record<string, string> {
  const h: Record<string, string> = {};
  if (json) h['Content-Type'] = 'application/json';
  try {
    const tok = localStorage.getItem('korvix_access_token');
    if (tok) h['Authorization'] = `Bearer ${tok}`;
    const owner = localStorage.getItem('korvix_owner_token');
    if (owner) h['X-Korvix-Owner-Token'] = owner;
  } catch { /* localStorage may be disabled */ }
  return h;
}

export type StockProvider = 'pexels' | 'unsplash';
export type StockProviderFilter = 'all' | StockProvider;
export type StockProviderStatus = 'ok' | 'unavailable' | 'error';

/** Normalized stock image (mirrors backend/services/web_build_images/stock.py). */
export interface StockImageResult {
  id: string;
  provider: StockProvider;
  providerImageId: string;
  thumbnailUrl: string;
  previewUrl: string;
  fullUrl: string;
  width?: number | null;
  height?: number | null;
  alt?: string | null;
  photographerName: string;
  photographerUrl?: string | null;
  providerPageUrl: string;
  attributionText: string;
  /** Unsplash only — the required download-event URL, fired on Apply. */
  downloadLocation?: string | null;
}

export interface StockImageSearchResponse {
  query: string;
  page: number;
  perPage: number;
  providers: { pexels: StockProviderStatus; unsplash: StockProviderStatus };
  results: StockImageResult[];
  hasMore: boolean;
  /** Present on validation / configuration errors (e.g. 'no_providers_configured'). */
  error?: string;
}

export interface StockSearchParams {
  q: string;
  provider?: StockProviderFilter;
  page?: number;
  perPage?: number;
  orientation?: 'landscape' | 'portrait' | 'square';
  signal?: AbortSignal;
}

/** GET the normalized search results. `signal` lets callers abort stale searches. */
export async function searchStockImages(params: StockSearchParams): Promise<StockImageSearchResponse> {
  const q = new URLSearchParams();
  q.set('q', params.q.trim().slice(0, 120));
  q.set('provider', params.provider || 'all');
  q.set('page', String(Math.max(1, params.page || 1)));
  q.set('per_page', String(Math.min(30, Math.max(1, params.perPage || 24))));
  if (params.orientation) q.set('orientation', params.orientation);

  const resp = await fetch(`${apiBase()}/v2/web-build/images/stock/search?${q.toString()}`, {
    method: 'GET',
    headers: authHeaders(),
    signal: params.signal,
  });
  if (!resp.ok) throw new Error(`stock search failed (${resp.status})`);
  return (await resp.json()) as StockImageSearchResponse;
}

/**
 * Fire the provider's required usage/download event when a photo is APPLIED.
 * No-op for Pexels; for Unsplash the backend GETs `download_location`. Best
 * effort — failures are swallowed (keepalive so it survives navigation).
 */
export async function trackStockDownload(result: StockImageResult): Promise<void> {
  if (result.provider !== 'unsplash' || !result.downloadLocation) return;
  try {
    await fetch(`${apiBase()}/v2/web-build/images/stock/track`, {
      method: 'POST',
      headers: authHeaders(true),
      body: JSON.stringify({ provider: result.provider, downloadLocation: result.downloadLocation }),
      keepalive: true,
    });
  } catch { /* attribution tracking is best-effort */ }
}
