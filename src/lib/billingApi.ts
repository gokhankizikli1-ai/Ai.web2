/**
 * Billing — provider-neutral frontend client (PR #525).
 *
 * The frontend's ONLY billing surface. It talks to the provider-neutral backend
 * seam and knows NOTHING about which processor (Lemon Squeezy / Polar) is live:
 *
 *   • createCheckout(selector)   POST /v2/billing/checkout  — sends ONLY the Korvix
 *                                plan selector ("pro_monthly"). The backend maps that
 *                                to the active provider's product/price and returns a
 *                                hosted checkout URL. The browser NEVER sends a provider
 *                                name, product/variant id, amount, currency, org id,
 *                                customer id, quantity, or an arbitrary return URL.
 *   • getMyBilling()             GET  /v2/billing/me — the AUTHORITATIVE account snapshot
 *                                (plan / status / provider / active). The ONLY source of
 *                                subscription truth the UI trusts; query params never are.
 *   • getCustomerPortalUrl()     POST /v2/billing/customer-portal — a validated portal URL.
 *
 * Identity is the backend session (Bearer token) — never a body field. No Polar SDK,
 * no provider secret, no VITE billing id is used or read anywhere in this module.
 *
 * Feature flag: `isCheckoutEnabled()` reads VITE_ENABLE_CHECKOUT and defaults OFF, so
 * with the flag unset the wired CTAs keep their exact current behaviour (no new calls).
 */

const BUNDLED_BACKEND = 'https://worker-production-1345.up.railway.app';

/** Korvix plan keys the pricing UI knows about (real repo naming). */
export type BillingPlan = 'free' | 'basic' | 'pro' | 'ultra' | 'enterprise';
/** Billing interval selectors. */
export type BillingInterval = 'monthly' | 'yearly';

/** The authoritative account snapshot returned by GET /v2/billing/me. */
export interface BillingAccount {
  /** Effective plan key resolved by the backend entitlement layer. */
  plan: string;
  /** Normalized subscription status (may be null when on the default plan). */
  status: string | null;
  /** Active billing provider for this account, when known (else null). */
  provider: string | null;
  /** TRUE only when the backend granted an entitling (non-default) plan.
   *  The ONLY signal the UI may treat as "subscription confirmed". */
  active: boolean;
  /** "subscription" | "default" — provenance of the snapshot. */
  source: string;
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

/**
 * Whether the frontend checkout CTAs are live. OFF by default: with
 * VITE_ENABLE_CHECKOUT unset, every wired CTA keeps its exact pre-#525 behaviour
 * (navigate/no-op) — this PR is non-breaking until the flag is flipped on.
 */
export function isCheckoutEnabled(): boolean {
  try {
    return (import.meta.env.VITE_ENABLE_CHECKOUT as string | undefined)?.trim() === 'true';
  } catch {
    return false;
  }
}

/**
 * Build the provider-neutral Korvix plan selector the backend expects, e.g.
 * `pro_monthly`. This is the ONLY billing token the frontend sends — it is NOT a
 * provider product id. The backend allowlist maps it to the active provider's
 * product/price; an unknown selector is rejected server-side (400), never guessed.
 */
export function planSelector(plan: BillingPlan, interval: BillingInterval = 'monthly'): string {
  return `${plan}_${interval}`;
}

/** A checkout selector that maps to a real purchasable plan (not free/enterprise). */
export function isPurchasablePlan(plan: string): plan is BillingPlan {
  return plan === 'basic' || plan === 'pro' || plan === 'ultra';
}

export class BillingError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'BillingError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Pull a human message + code out of the standard backend envelope
 * `{ success, data, error, metadata, timestamp }`, where `error` is a plain
 * string and the error code (if any) lives in `metadata.code`. Tolerates a
 * nested `error: { message, code }` too, so it stays robust to shape drift.
 */
function envelopeError(data: unknown, fallback: string): { message: string; code?: string } {
  if (data && typeof data === 'object') {
    const obj = data as { error?: unknown; metadata?: unknown };
    const meta = (obj.metadata && typeof obj.metadata === 'object') ? obj.metadata as { code?: unknown } : undefined;
    const metaCode = typeof meta?.code === 'string' ? meta.code : undefined;

    const err = obj.error;
    if (typeof err === 'string' && err) return { message: err, code: metaCode };
    if (err && typeof err === 'object') {
      const msg = (err as { message?: unknown }).message;
      const code = (err as { code?: unknown }).code;
      return {
        message: typeof msg === 'string' && msg ? msg : fallback,
        code: (typeof code === 'string' ? code : undefined) ?? metaCode,
      };
    }
    if (metaCode) return { message: fallback, code: metaCode };
  }
  return { message: fallback };
}

/** Extract the `data` payload from the `{ success, data, ... }` envelope. */
function envelopeData<T>(data: unknown): T | null {
  if (data && typeof data === 'object' && 'data' in (data as object)) {
    const inner = (data as { data: T }).data;
    return inner ?? null;
  }
  return null;
}

/**
 * Create a checkout for the AUTHENTICATED caller and return the hosted checkout URL.
 * Sends ONLY the plan selector (+ an optional idempotency key). Throws BillingError
 * on any non-2xx so callers can surface a bounded message and preserve their existing
 * loading/error/redirect behaviour. NEVER grants access — the URL is a redirect target.
 */
export async function createCheckout(
  selector: string,
  opts?: { idempotencyKey?: string; signal?: AbortSignal },
): Promise<{ url: string }> {
  const headers = authHeaders();
  if (opts?.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;

  let resp: Response;
  try {
    resp = await fetch(`${apiBase()}/v2/billing/checkout`, {
      method: 'POST',
      headers,
      // ONLY the Korvix selector. No provider, product id, amount, currency, org,
      // customer id, quantity or return_url — those are all backend-controlled.
      body: JSON.stringify({ variant: selector }),
      signal: opts?.signal,
    });
  } catch {
    throw new BillingError('Network error — please try again.', 0);
  }

  let data: unknown = null;
  try { data = await resp.json(); } catch { /* non-JSON body */ }

  if (!resp.ok) {
    const { message, code } = envelopeError(data, 'Could not start checkout.');
    throw new BillingError(message, resp.status, code);
  }

  const payload = envelopeData<{ url?: string }>(data) ?? (data as { url?: string });
  const url = payload?.url;
  if (!url || typeof url !== 'string') {
    throw new BillingError('Checkout did not return a valid URL.', 502);
  }
  return { url };
}

/**
 * The AUTHORITATIVE account snapshot. This is the ONLY subscription truth the UI
 * trusts (the return page refreshes it after a redirect; access is NEVER granted
 * from query params). Returns null when billing is disabled / the caller is a guest
 * / the call fails, so callers can render a neutral "not confirmed" state.
 */
export async function getMyBilling(opts?: { signal?: AbortSignal }): Promise<BillingAccount | null> {
  let resp: Response;
  try {
    resp = await fetch(`${apiBase()}/v2/billing/me`, {
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
  const snap = envelopeData<BillingAccount>(data);
  return snap ?? null;
}

/**
 * Mint a provider-neutral customer-portal URL for the authenticated caller.
 * Throws BillingError on any non-2xx (404 when the active provider has no portal
 * or the user is unmapped — the UI should hide the entry point rather than retry).
 */
export async function getCustomerPortalUrl(opts?: { signal?: AbortSignal }): Promise<{ url: string }> {
  let resp: Response;
  try {
    resp = await fetch(`${apiBase()}/v2/billing/customer-portal`, {
      method: 'POST',
      headers: authHeaders(),
      body: '{}',
      signal: opts?.signal,
    });
  } catch {
    throw new BillingError('Network error — please try again.', 0);
  }
  let data: unknown = null;
  try { data = await resp.json(); } catch { /* non-JSON body */ }
  if (!resp.ok) {
    const { message, code } = envelopeError(data, 'Customer portal is unavailable.');
    throw new BillingError(message, resp.status, code);
  }
  const payload = envelopeData<{ url?: string }>(data) ?? (data as { url?: string });
  const url = payload?.url;
  if (!url || typeof url !== 'string') {
    throw new BillingError('Portal did not return a valid URL.', 502);
  }
  return { url };
}
