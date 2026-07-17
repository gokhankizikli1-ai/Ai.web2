/**
 * Owner Cost Analytics API client.
 *
 * Thin, owner-authenticated client over the backend cost-tracking endpoints
 * (backend/routes/v2_admin_costs.py). Reuses the SAME configured backend base
 * URL and the SAME auth headers the owner-status probe uses (Bearer + owner
 * token + owner email + guest id) so the server's `owner_gate` recognises the
 * caller exactly as it does for `/v2/admin/status`. No Railway domain is
 * embedded here; the base comes from OWNER_API_BASE (VITE_API_URL or the
 * bundled default resolved once in useOwnerMode).
 *
 * Enforcement is entirely server-side: these calls return 401 (unauth), 403
 * (non-owner) or 404 (missing build). This module never decides owner status.
 */
import { OWNER_API_BASE } from '@/hooks/useOwnerMode';

/* ── Auth headers (mirror useOwnerMode's request) ─────────────────────────── */
function ownerHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const bearer = localStorage.getItem('korvix_access_token');
    if (bearer) h['Authorization'] = `Bearer ${bearer}`;
    const ownerToken = localStorage.getItem('korvix_owner_token');
    if (ownerToken) h['X-Korvix-Owner-Token'] = ownerToken;
    const guest = localStorage.getItem('korvix_user_id');
    if (guest) h['X-Korvix-Guest-Id'] = guest;
    const raw = localStorage.getItem('korvix-auth');
    if (raw) {
      const email = (JSON.parse(raw) as { state?: { user?: { email?: string } } })
        ?.state?.user?.email?.trim().toLowerCase();
      if (email) h['X-Korvix-Owner-Email'] = email;
    }
  } catch { /* localStorage may be disabled */ }
  return h;
}

/* ── Typed error the page can branch on ───────────────────────────────────── */
export class CostApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'CostApiError';
    this.status = status;
  }
}

async function getJson<T>(path: string): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  let resp: Response;
  try {
    resp = await fetch(`${OWNER_API_BASE}${path}`, {
      method: 'GET', headers: ownerHeaders(), signal: ctrl.signal,
    });
  } catch (e) {
    throw new CostApiError(0, e instanceof Error ? e.message : 'network error');
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) {
    // 401 unauth · 403 non-owner · 404 missing build · other → generic.
    throw new CostApiError(resp.status, `request failed (${resp.status})`);
  }
  const body = await resp.json();
  // Endpoints wrap data in the standard envelope { success, data, ... }.
  return (body && typeof body === 'object' && 'data' in body ? body.data : body) as T;
}

/* ── Response shapes (mirror backend cost_tracking) ───────────────────────── */
export interface CostBuildRef { build_id: string; total_build_cost_usd: number; }
export interface ModelUsageRow {
  model: string; calls: number; input_tokens: number; output_tokens: number;
  cached_tokens: number; reasoning_tokens: number; cost_usd: number;
}
export interface OperationCostRow { operation_type: string; calls: number; cost_usd: number; }
export interface RetryCosts { retry_calls: number; retry_cost_usd: number; total_cost_usd: number; }

export interface CostAnalytics {
  build_count: number;
  total_cost_usd: number;
  average_build_cost_usd: number;
  median_build_cost_usd: number;
  p90_build_cost_usd: number;
  p95_build_cost_usd: number;
  cheapest_build: CostBuildRef | null;
  most_expensive_build: CostBuildRef | null;
  token_usage_by_model: ModelUsageRow[];
  cost_by_operation_type: OperationCostRow[];
  retry_costs: RetryCosts;
}

export interface CostBuildSummary {
  build_id: string;
  user_id: string | null;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  label?: string | null;
  total_ai_calls: number;
  total_build_cost_usd: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cached_tokens: number;
  failed_calls: number;
  retry_calls: number;
  retry_cost_usd: number;
  build_duration_seconds: number;
}

export interface CostCall {
  call_id: string;
  build_id: string;
  provider: string;
  model: string;
  operation_type: string;
  request_started_at: string;
  request_completed_at: string | null;
  success: boolean | number;
  retry_number: number;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  cache_creation_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
  usage_missing: boolean | number;
  input_cost_usd: number;
  output_cost_usd: number;
  cache_cost_usd: number;
  additional_tool_cost_usd: number;
  total_call_cost_usd: number;
  error_code: string | null;
  error_kind: string | null;
  error_message: string | null;
  request_id: string | null;
  tool_key: string | null;
  tool_units: number;
  duration_ms: number;
}

export interface CostBuildDetail extends CostBuildSummary {
  build_duration_seconds: number;
  total_reasoning_tokens: number;
  usage_missing_calls: number;
  total_token_cost_usd: number;
  total_tool_cost_usd: number;
  calls: CostCall[];
}

/* ── Public API ───────────────────────────────────────────────────────────── */
export function getCostAnalytics(): Promise<CostAnalytics> {
  return getJson<CostAnalytics>('/v2/admin/costs/analytics');
}

export function listCostBuilds(limit = 100, offset = 0): Promise<{ builds: CostBuildSummary[]; count: number }> {
  return getJson<{ builds: CostBuildSummary[]; count: number }>(
    `/v2/admin/costs/builds?limit=${limit}&offset=${offset}`,
  );
}

export function getCostBuild(buildId: string): Promise<CostBuildDetail> {
  return getJson<CostBuildDetail>(`/v2/admin/costs/builds/${encodeURIComponent(buildId)}`);
}

/* ── Formatting helpers (shared by the page) ──────────────────────────────── */
/** USD: never round a nonzero cost to $0.00 — small costs keep 4 decimals. */
export function formatUsd(v: number | null | undefined): string {
  const n = Number(v || 0);
  if (n === 0) return '$0.00';
  if (Math.abs(n) < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

export function formatTokens(v: number | null | undefined): string {
  return Number(v || 0).toLocaleString();
}

/** Shorten a build id for dense display while keeping it copy-identifiable. */
export function shortBuildId(id: string | null | undefined): string {
  const s = String(id || '');
  return s.length > 16 ? `${s.slice(0, 10)}…${s.slice(-4)}` : s;
}
