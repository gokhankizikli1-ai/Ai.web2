import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  planSelector, isPurchasablePlan, isCheckoutEnabled,
  createCheckout, getMyBilling, getCustomerPortalUrl, BillingError,
} from '@/lib/billingApi';

/**
 * PR #525 — provider-neutral frontend billing client tests (authored, not part
 * of the run gate for this PR). Verifies the frontend sends ONLY the Korvix plan
 * selector, never grants client-side, and surfaces bounded errors.
 *
 * Frontend cases covered:
 *   1. planSelector builds "<plan>_<interval>"
 *   2. isPurchasablePlan gates free/enterprise out
 *   3. isCheckoutEnabled defaults OFF (flag unset)
 *   4. createCheckout POSTs ONLY { variant } — no provider/product/amount/return_url
 *   5. createCheckout throws BillingError with status/code on a non-2xx envelope
 *   6. getMyBilling returns the backend snapshot (authoritative truth) on 200
 *   7. getMyBilling returns null (never a client-side grant) on failure
 *   8. getCustomerPortalUrl returns the validated url on 200
 */

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  vi.stubGlobal('localStorage', {
    store: {} as Record<string, string>,
    getItem(k: string) { return this.store[k] ?? null; },
    setItem(k: string, v: string) { this.store[k] = v; },
    removeItem(k: string) { delete this.store[k]; },
  });
  localStorage.setItem('korvix_access_token', 'test-token');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('selectors', () => {
  it('builds a provider-neutral selector', () => {
    expect(planSelector('pro', 'monthly')).toBe('pro_monthly');
    expect(planSelector('ultra', 'yearly')).toBe('ultra_yearly');
    expect(planSelector('basic')).toBe('basic_monthly');
  });

  it('only treats basic/pro/ultra as purchasable', () => {
    expect(isPurchasablePlan('pro')).toBe(true);
    expect(isPurchasablePlan('ultra')).toBe(true);
    expect(isPurchasablePlan('basic')).toBe(true);
    expect(isPurchasablePlan('free')).toBe(false);
    expect(isPurchasablePlan('enterprise')).toBe(false);
  });
});

describe('isCheckoutEnabled', () => {
  it('defaults OFF when the flag is unset', () => {
    vi.stubEnv('VITE_ENABLE_CHECKOUT', '');
    expect(isCheckoutEnabled()).toBe(false);
  });
  it('is ON only for the exact string "true"', () => {
    vi.stubEnv('VITE_ENABLE_CHECKOUT', 'true');
    expect(isCheckoutEnabled()).toBe(true);
  });
});

describe('createCheckout', () => {
  it('sends ONLY the plan selector and returns the checkout url', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { success: true, data: { url: 'https://checkout.example/abc' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { url } = await createCheckout('pro_monthly');
    expect(url).toBe('https://checkout.example/abc');

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    // The ONLY field sent is the selector — no provider/product/amount/return_url/etc.
    expect(body).toEqual({ variant: 'pro_monthly' });
    expect(Object.keys(body)).toEqual(['variant']);
  });

  it('throws a BillingError carrying status + code on failure', async () => {
    // The real backend envelope: error is a string; the code rides metadata.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse(503, { success: false, error: 'checkout disabled', metadata: { code: 'CHECKOUT_DISABLED' } }),
    ));
    await expect(createCheckout('pro_monthly')).rejects.toMatchObject({
      name: 'BillingError', status: 503, code: 'CHECKOUT_DISABLED',
    });
  });
});

describe('getMyBilling (authoritative truth)', () => {
  it('returns the backend snapshot on 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse(200, { success: true, data: { plan: 'pro', status: 'active', provider: 'polar', active: true, source: 'subscription' } }),
    ));
    const snap = await getMyBilling();
    expect(snap).toMatchObject({ plan: 'pro', active: true, provider: 'polar' });
  });

  it('returns null on failure — never a client-side grant', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, { success: false })));
    expect(await getMyBilling()).toBeNull();
  });
});

describe('getCustomerPortalUrl', () => {
  it('returns a validated url on 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse(200, { success: true, data: { url: 'https://polar.sh/portal/x' } }),
    ));
    const { url } = await getCustomerPortalUrl();
    expect(url).toBe('https://polar.sh/portal/x');
  });

  it('throws BillingError on 404 (no portal / unmapped)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse(404, { success: false, error: 'no portal', metadata: { code: 'PORTAL_NOT_AVAILABLE' } }),
    ));
    await expect(getCustomerPortalUrl()).rejects.toBeInstanceOf(BillingError);
  });
});
