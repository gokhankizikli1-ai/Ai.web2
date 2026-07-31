/**
 * Email verification — authenticated frontend client.
 *
 * Thin wrapper over /v2/auth/email-verification/* . Identity always comes from
 * the backend session (Bearer token) for send/status; confirm carries only the
 * single-use token from the email link. The client never fabricates state.
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
    const owner = localStorage.getItem('korvix_owner_token');
    if (owner) h['X-Korvix-Owner-Token'] = owner;
  } catch { /* localStorage may be disabled */ }
  return h;
}

function envelopeData<T>(body: unknown): T | null {
  if (body && typeof body === 'object' && 'data' in (body as object)) {
    const inner = (body as { data: T }).data;
    return inner ?? null;
  }
  return null;
}

export interface VerificationStatus {
  verified: boolean;
  verificationRequired: boolean;
  emailMasked: string | null;
  cooldownRemaining: number;
}

export interface SendResult {
  sent: boolean;
  cooldownRemaining: number;
  alreadyVerified: boolean;
}

/** Outcome of consuming a verification token from the email link. */
export type ConfirmStatus =
  | 'verified'
  | 'already_verified'
  | 'expired'
  | 'already_used'
  | 'invalid'
  | 'error';

/**
 * The authenticated caller's verification status, or null when the call fails /
 * the caller is a guest. Null → the UI leaves the gate untouched (neutral).
 */
export async function getVerificationStatus(
  opts?: { signal?: AbortSignal },
): Promise<VerificationStatus | null> {
  let resp: Response;
  try {
    resp = await fetch(`${apiBase()}/v2/auth/email-verification/status`, {
      method: 'GET',
      headers: authHeaders(),
      signal: opts?.signal,
    });
  } catch {
    return null;
  }
  if (!resp.ok) return null;
  let body: unknown = null;
  try { body = await resp.json(); } catch { return null; }
  const d = envelopeData<{
    verified?: boolean;
    verification_required?: boolean;
    email_masked?: string | null;
    cooldown_remaining?: number;
  }>(body);
  if (!d) return null;
  return {
    verified: !!d.verified,
    verificationRequired: !!d.verification_required,
    emailMasked: typeof d.email_masked === 'string' ? d.email_masked : null,
    cooldownRemaining: typeof d.cooldown_remaining === 'number' ? d.cooldown_remaining : 0,
  };
}

/** Resend the verification link for the current account. */
export async function resendVerification(): Promise<SendResult> {
  const fallback: SendResult = { sent: false, cooldownRemaining: 0, alreadyVerified: false };
  let resp: Response;
  try {
    resp = await fetch(`${apiBase()}/v2/auth/email-verification/send`, {
      method: 'POST',
      headers: authHeaders(),
    });
  } catch {
    return fallback;
  }
  if (!resp.ok) return fallback;
  let body: unknown = null;
  try { body = await resp.json(); } catch { return fallback; }
  const d = envelopeData<{
    sent?: boolean; cooldown_remaining?: number; already_verified?: boolean;
  }>(body);
  if (!d) return fallback;
  return {
    sent: !!d.sent,
    cooldownRemaining: typeof d.cooldown_remaining === 'number' ? d.cooldown_remaining : 0,
    alreadyVerified: !!d.already_verified,
  };
}

/**
 * Consume a verification token (from the email link). Public — no session
 * required. Returns the backend `status` the UI switches on.
 */
export async function confirmVerification(token: string): Promise<ConfirmStatus> {
  let resp: Response;
  try {
    resp = await fetch(`${apiBase()}/v2/auth/email-verification/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
  } catch {
    return 'error';
  }
  if (!resp.ok) return 'error';
  let body: unknown = null;
  try { body = await resp.json(); } catch { return 'error'; }
  const d = envelopeData<{ status?: string }>(body);
  const s = d?.status;
  if (
    s === 'verified' || s === 'already_verified' || s === 'expired' ||
    s === 'already_used' || s === 'invalid'
  ) {
    return s;
  }
  return 'error';
}
