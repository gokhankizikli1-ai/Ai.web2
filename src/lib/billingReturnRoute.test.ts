import { describe, it, expect } from 'vitest';
import {
  billingReturnHashRewrite, nextReturnState,
  BILLING_RETURN_HASH,
} from '@/lib/billingReturnRoute';

/**
 * Tests for the /billing/return blank-page fix.
 *
 * The app is a HashRouter app, so the external, path-based provider redirect
 * (`/billing/return`) must be bridged onto the hash route or the page never
 * mounts (blank white page). The test env is `node` (no jsdom), so these cover
 * the pure route bridge + the state contract rather than a full DOM render.
 */

describe('billingReturnHashRewrite (direct external-redirect route)', () => {
  it('bridges the bare path onto the hash route', () => {
    expect(billingReturnHashRewrite('/billing/return', '', '')).toBe(`/${BILLING_RETURN_HASH}`);
  });

  it('preserves the provider query string (moved into the hash)', () => {
    expect(billingReturnHashRewrite('/billing/return', '?status=success', ''))
      .toBe(`/${BILLING_RETURN_HASH}?status=success`);
  });

  it('tolerates a trailing slash', () => {
    expect(billingReturnHashRewrite('/billing/return/', '', '')).toBe(`/${BILLING_RETURN_HASH}`);
  });

  it('no-ops when already on the hash route (prevents a rewrite loop)', () => {
    expect(billingReturnHashRewrite('/', '', '#/billing/return')).toBeNull();
    expect(billingReturnHashRewrite('/', '', '#/billing/return?status=success')).toBeNull();
  });

  it('never touches unrelated paths', () => {
    expect(billingReturnHashRewrite('/chat', '', '')).toBeNull();
    expect(billingReturnHashRewrite('/billing/other', '', '')).toBeNull();
    expect(billingReturnHashRewrite('/', '', '')).toBeNull();
  });
});

describe('nextReturnState (state contract — no grant from the URL)', () => {
  it('shows activated ONLY on backend-confirmed active plan', () => {
    expect(nextReturnState({ snapshot: { active: true, plan: 'pro' }, hint: null, pollsExhausted: false }))
      .toBe('activated');
  });

  it('a success URL hint alone NEVER activates (no client-side grant)', () => {
    // Backend says not active, but the URL claims success → pending, never activated.
    expect(nextReturnState({ snapshot: { active: false }, hint: 'success', pollsExhausted: false }))
      .toBe('pending');
    expect(nextReturnState({ snapshot: null, hint: 'success', pollsExhausted: true }))
      .toBe('pending');
  });

  it('shows pending while polling after a success hint; checking otherwise', () => {
    expect(nextReturnState({ snapshot: null, hint: 'success', pollsExhausted: false })).toBe('pending');
    expect(nextReturnState({ snapshot: null, hint: null, pollsExhausted: false })).toBe('checking');
  });

  it('reflects terminal negative hints', () => {
    expect(nextReturnState({ snapshot: null, hint: 'canceled', pollsExhausted: false })).toBe('canceled');
    expect(nextReturnState({ snapshot: null, hint: 'failed', pollsExhausted: false })).toBe('failed');
  });

  it('an API failure (null snapshot) resolves to a safe state, never blank/activated', () => {
    // Exhausted polling with no snapshot + no hint → not-synced (safe, honest).
    expect(nextReturnState({ snapshot: null, hint: null, pollsExhausted: true })).toBe('not-synced');
  });
});
