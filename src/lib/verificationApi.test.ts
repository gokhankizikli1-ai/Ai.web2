import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getVerificationStatus,
  resendVerification,
  confirmVerification,
} from '@/lib/verificationApi';

/**
 * Email-verification frontend client tests. The UI must render only backend
 * truth (null on failure — never a fabricated verified state), map the confirm
 * outcome, and surface the resend cooldown.
 */

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

beforeEach(() => {
  const storage: Record<string, string> = {};
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage[key] ?? null,
    setItem: (key: string, value: string) => { storage[key] = value; },
    removeItem: (key: string) => { delete storage[key]; },
    clear: () => { for (const key of Object.keys(storage)) delete storage[key]; },
    key: (index: number) => Object.keys(storage)[index] ?? null,
    get length() { return Object.keys(storage).length; },
  } satisfies Storage);
  localStorage.setItem('korvix_access_token', 'test-token');
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('getVerificationStatus', () => {
  it('parses the authoritative status on 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, {
      success: true,
      data: { verified: false, verification_required: true, email_masked: 'g***@gmail.com', cooldown_remaining: 42 },
    })));
    const s = await getVerificationStatus();
    expect(s).toEqual({
      verified: false, verificationRequired: true, emailMasked: 'g***@gmail.com', cooldownRemaining: 42,
    });
  });

  it('returns null on failure — never fabricates verified state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(500, { success: false })));
    expect(await getVerificationStatus()).toBeNull();
  });

  it('returns null on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await getVerificationStatus()).toBeNull();
  });
});

describe('resendVerification', () => {
  it('reports sent + cooldown from the backend', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, {
      success: true, data: { sent: true, cooldown_remaining: 60 },
    })));
    const r = await resendVerification();
    expect(r).toEqual({ sent: true, cooldownRemaining: 60, alreadyVerified: false });
  });

  it('surfaces already_verified', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, {
      success: true, data: { sent: false, already_verified: true, cooldown_remaining: 0 },
    })));
    const r = await resendVerification();
    expect(r.alreadyVerified).toBe(true);
    expect(r.sent).toBe(false);
  });

  it('degrades safely (not sent) on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(429, { success: false })));
    const r = await resendVerification();
    expect(r.sent).toBe(false);
  });
});

describe('confirmVerification', () => {
  it('maps a verified outcome', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, {
      success: true, data: { status: 'verified', verified: true },
    })));
    expect(await confirmVerification('tok')).toBe('verified');
  });

  it('maps expired / already_used / invalid outcomes', async () => {
    for (const status of ['expired', 'already_used', 'invalid'] as const) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, {
        success: true, data: { status, verified: false },
      })));
      expect(await confirmVerification('tok')).toBe(status);
    }
  });

  it('returns error on a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await confirmVerification('tok')).toBe('error');
  });
});
