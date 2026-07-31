import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getMyCredits, throwIfInsufficient, InsufficientCreditsError } from '@/lib/creditsApi';

/**
 * Credits Phase 1 — frontend client tests. The UI must render only the
 * server-authoritative balance, show neutral state on loading/error (never a
 * fabricated number), and surface the typed insufficient-credit error.
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

describe('getMyCredits — real balance', () => {
  it('returns the authoritative snapshot on 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, {
      success: true,
      data: { enabled: true, balance: 20, lifetime_granted: 20, lifetime_consumed: 0 },
    })));
    const s = await getMyCredits();
    expect(s).toEqual({ enabled: true, balance: 20, lifetimeGranted: 20, lifetimeConsumed: 0 });
  });

  it('returns null on API failure — never a fabricated balance', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(500, { success: false })));
    expect(await getMyCredits()).toBeNull();
  });

  it('returns null on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await getMyCredits()).toBeNull();
  });

  it('reflects a disabled ledger as enabled:false (UI shows neutral)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, {
      success: true, data: { enabled: false, balance: 0, lifetime_granted: 0, lifetime_consumed: 0 },
    })));
    const s = await getMyCredits();
    expect(s?.enabled).toBe(false);
    expect(s?.balance).toBe(0);
  });
});

describe('throwIfInsufficient — typed insufficient-credit contract', () => {
  it('throws InsufficientCreditsError on a 402 with amounts', () => {
    const body = { success: false, error: 'insufficient credits', metadata: { code: 'INSUFFICIENT_CREDITS', required: 25, balance: 20 } };
    expect(() => throwIfInsufficient(402, body)).toThrow(InsufficientCreditsError);
    try {
      throwIfInsufficient(402, body);
    } catch (e) {
      const err = e as InsufficientCreditsError;
      expect(err.required).toBe(25);
      expect(err.balance).toBe(20);
    }
  });

  it('does nothing on a success status', () => {
    expect(() => throwIfInsufficient(200, { success: true })).not.toThrow();
  });
});
