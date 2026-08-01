/**
 * Credits — authenticated frontend client (Phase 1).
 *
 * The ONLY source of the user's credit balance for the UI. It reads the
 * server-authoritative snapshot (`GET /v2/billing/credits/me`) for the
 * authenticated caller — the frontend never fabricates or caches a balance, and
 * never sends a user id (identity is the backend session). Also exposes the
 * typed insufficient-credits contract so a spend UI can show a clear message.
 */

const BUNDLED_BACKEND = 'https://worker-production-1345.up.railway.app';

/** Authoritative credit snapshot from GET /v2/billing/credits/me. */
export interface CreditSummary {
  /** False when the ledger is disabled (dormant) — UI shows a neutral state. */
  enabled: boolean;
  /** Current spendable balance (never negative). */
  balance: number;
  /** Lifetime credits granted. */
  lifetimeGranted: number;
  /** Lifetime credits consumed. */
  lifetimeConsumed: number;
  /** True when the starter grant was withheld by abuse protection (enforcing).
   *  Drives a NEUTRAL "unavailable" message — never a fabricated balance. */
  starterDenied: boolean;
}

function apiBase(): string {
  const envBase = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
  return envBase ? envBase.replace(/\/+$/, '') : BUNDLED_BACKEND;
}

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const tok = localStorage.getItem('korvix_access_token');
    if (tok) h['Authorization'] = `Bearer ${tok}`;
    const owner = localStorage.getItem('korvix_owner_token');
    if (owner) h['X-Korvix-Owner-Token'] = owner;
  } catch { /* localStorage may be disabled */ }
  return h;
}

/** Typed error a spend flow surfaces when the backend reports insufficient credits. */
export class InsufficientCreditsError extends Error {
  required?: number;
  balance?: number;
  constructor(message = 'Not enough credits', required?: number, balance?: number) {
    super(message);
    this.name = 'InsufficientCreditsError';
    this.required = required;
    this.balance = balance;
  }
}

function envelopeData<T>(data: unknown): T | null {
  if (data && typeof data === 'object' && 'data' in (data as object)) {
    const inner = (data as { data: T }).data;
    return inner ?? null;
  }
  return null;
}

/**
 * The authenticated caller's authoritative credit snapshot, or null when billing
 * is disabled / the caller is a guest / the call fails. Returning null (never a
 * fabricated number) lets the UI render a neutral state rather than fake credits.
 */
export async function getMyCredits(opts?: { signal?: AbortSignal }): Promise<CreditSummary | null> {
  let resp: Response;
  try {
    resp = await fetch(`${apiBase()}/v2/billing/credits/me`, {
      method: 'GET',
      headers: authHeaders(),
      signal: opts?.signal,
    });
  } catch {
    return null;
  }
  if (!resp.ok) return null;
  let data: unknown = null;
  try { data = await resp.json(); } catch { return null; }
  const d = envelopeData<{
    enabled?: boolean; balance?: number;
    lifetime_granted?: number; lifetime_consumed?: number; starter_denied?: boolean;
  }>(data);
  if (!d) return null;
  return {
    enabled: !!d.enabled,
    balance: typeof d.balance === 'number' ? d.balance : 0,
    lifetimeGranted: typeof d.lifetime_granted === 'number' ? d.lifetime_granted : 0,
    lifetimeConsumed: typeof d.lifetime_consumed === 'number' ? d.lifetime_consumed : 0,
    starterDenied: d.starter_denied === true,
  };
}

/**
 * Map a spend response into the typed insufficient-credits contract. A spend
 * endpoint returns HTTP 402 with code `INSUFFICIENT_CREDITS` on overdraw; callers
 * use this to throw `InsufficientCreditsError` and show a clear message.
 */
export function throwIfInsufficient(status: number, body: unknown): void {
  if (status !== 402) return;
  let required: number | undefined;
  let balance: number | undefined;
  let code: string | undefined;
  if (body && typeof body === 'object') {
    const meta = (body as { metadata?: Record<string, unknown> }).metadata;
    if (meta) {
      code = typeof meta.code === 'string' ? meta.code : undefined;
      required = typeof meta.required === 'number' ? meta.required : undefined;
      balance = typeof meta.balance === 'number' ? meta.balance : undefined;
    }
  }
  if (status === 402 || code === 'INSUFFICIENT_CREDITS') {
    throw new InsufficientCreditsError('Not enough credits for this action', required, balance);
  }
}
