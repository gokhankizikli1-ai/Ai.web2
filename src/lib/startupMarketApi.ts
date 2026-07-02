/**
 * Startup Market Intelligence API client — Market Complaint Radar.
 *
 * Talks to POST /v2/startup/market-complaints (backend/routes/v2_startup.py).
 * Base URL resolution mirrors useChat.ts: VITE_API_URL when set on Vercel,
 * else the bundled Railway backend, so the radar always hits the same
 * backend chat already uses.
 */

const BUNDLED_BACKEND = 'https://worker-production-1345.up.railway.app';

function apiBase(): string {
  const envBase = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
  return envBase ? envBase.replace(/\/+$/, '') : BUNDLED_BACKEND;
}

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const tok = localStorage.getItem('korvix_access_token');
    if (tok) h['Authorization'] = `Bearer ${tok}`;
  } catch { /* localStorage may be disabled */ }
  return h;
}

/* ── Response types (mirror backend/services/startup_intelligence/types.py) ── */

export type RadarSource = 'web' | 'hackernews' | 'gdelt' | 'reddit' | 'producthunt';
export type SourceStatus = 'available' | 'unavailable' | 'skipped';

/**
 * User-facing source naming — internal provider keys stay unchanged, but
 * normal users see product language ("Founder forums", not "Hacker News").
 * Single source of truth for every startup component.
 */
export const SOURCE_DISPLAY: Record<RadarSource, { label: string; role: string }> = {
  web: { label: 'Web', role: 'Broad web evidence' },
  hackernews: { label: 'Founder forums', role: 'Founder/developer discussion signal' },
  gdelt: { label: 'News', role: 'News and trend signal' },
  reddit: { label: 'Communities', role: 'Community complaint signal' },
  producthunt: { label: 'Product launches', role: 'Launch and product signal' },
};

export function sourceLabel(source: string): string {
  return SOURCE_DISPLAY[source as RadarSource]?.label ?? source;
}

export interface SampleQuote {
  text: string;
  source: RadarSource;
  url: string;
}

export interface ComplaintCluster {
  id: string;
  label: string;
  pain_score: number;
  frequency: number;
  severity: number;
  urgency: number;
  recency: number;
  willingness_to_pay_signal: number;
  saturation_risk: number;
  source_mix: Record<string, number>;
  sample_quotes: SampleQuote[];
  evidence_urls: string[];
  /** Per-cluster quality telemetry (optional — see summary fields). */
  evidence_quality?: number;
  direct_complaints?: number;
}

export interface CompetitorWeakness {
  competitor: string;
  cluster_id: string;
  cluster_label: string;
  evidence_count: number;
}

export interface MarketSignals {
  competitors_mentioned: string[];
  trending_keywords: string[];
  underserved_segments: string[];
  common_workarounds: string[];
  /** Competitor → complaint-cluster association computed server-side from
   * full evidence text. Optional: absent on reports cached before this
   * field shipped. */
  competitor_weaknesses?: CompetitorWeakness[];
}

export interface RadarRecommendations {
  startup_angles: string[];
  mvp_wedge: string[];
  first_100_customers: string[];
  landing_page_angles: string[];
  risks: string[];
}

export interface RadarCitation {
  title: string;
  url: string;
  source: string;
  published_at?: string | null;
  /** How the item actually contributed (backend-observed, never guessed):
   * direct = first-person complaint · complaint = fed a cluster ·
   * broad = low-quality/SEO content · context = market context only.
   * Optional: absent on reports cached before this field shipped. */
  evidence_role?: 'direct' | 'complaint' | 'broad' | 'context';
}

export interface MarketComplaintReport {
  query: string;
  generated_at: string;
  timeframe_days: number;
  data_freshness: Record<RadarSource, SourceStatus>;
  summary: {
    top_complaint_area: string;
    opportunity_score: number;
    confidence: 'low' | 'medium' | 'high';
    total_sources: number;
    total_items_analyzed: number;
    /** Avg evidence quality 0-100 (discussion/forum content scores high,
     * SEO/blog/news low). Optional: absent on reports cached before this
     * field shipped. */
    evidence_quality?: number;
    /** Items with first-person complaint phrasing — the strongest
     * evidence class. Optional (same back-compat reason). */
    direct_complaints?: number;
  };
  complaint_clusters: ComplaintCluster[];
  market_signals: MarketSignals;
  recommendations: RadarRecommendations;
  citations: RadarCitation[];
  message: string;
  cached: boolean;
}

export interface MarketComplaintRequest {
  query: string;
  industry?: string;
  region?: string;
  timeframe_days?: number;
  sources?: RadarSource[];
  max_items?: number;
}

export interface RadarSourceHealth {
  enabled: boolean;
  sources: Record<RadarSource, { configured: boolean; requires_key: boolean }>;
}

/** Typed failure so the UI can render honest, specific states. */
export class RadarError extends Error {
  kind: 'disabled' | 'network' | 'server';
  constructor(kind: RadarError['kind'], message: string) {
    super(message);
    this.kind = kind;
  }
}

export async function fetchRadarHealth(): Promise<RadarSourceHealth | null> {
  try {
    const resp = await fetch(`${apiBase()}/v2/startup/market-complaints/health`, {
      headers: authHeaders(),
    });
    if (!resp.ok) return null;
    return (await resp.json()) as RadarSourceHealth;
  } catch {
    return null;
  }
}

export async function analyzeMarketComplaints(
  req: MarketComplaintRequest,
): Promise<MarketComplaintReport> {
  let resp: Response;
  try {
    resp = await fetch(`${apiBase()}/v2/startup/market-complaints`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(req),
    });
  } catch {
    throw new RadarError(
      'network',
      'Could not reach the Korvix backend. Check your connection and retry.',
    );
  }

  if (resp.status === 503) {
    throw new RadarError(
      'disabled',
      'Market Intelligence is not enabled on this deployment '
      + '(ENABLE_STARTUP_MARKET_INTEL is off).',
    );
  }
  if (!resp.ok) {
    throw new RadarError(
      'server',
      'Market complaint analysis failed on the server. Retry in a moment.',
    );
  }
  return (await resp.json()) as MarketComplaintReport;
}
