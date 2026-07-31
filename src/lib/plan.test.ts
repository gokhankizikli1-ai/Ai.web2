import { describe, it, expect } from 'vitest';
import { resolveDisplayPlan, planLabel, isPaidPlan } from '@/lib/plan';

/**
 * Account-scoped plan-display resolver tests.
 *
 * `resolveDisplayPlan` is THE single source of truth every plan surface (top-right
 * badge, sidebar account card, credit display) consumes via useBillingPlan. It
 * trusts ONLY the backend snapshot (GET /v2/billing/me) — never localStorage,
 * credits, email, owner flag, a previous account, URL params, or optimistic
 * checkout state. These tests pin the isolation + fail-safe contract.
 *
 * (Test env is `node`, so this covers the pure resolver — the hook wires the same
 * function to the authenticated user id and clears state on logout/account switch.)
 */

describe('resolveDisplayPlan — authoritative, fail-safe, account-scoped', () => {
  const authed = { isAuthenticated: true, loading: false };

  it('1. unsubscribed authenticated user resolves to Free', () => {
    expect(resolveDisplayPlan({ ...authed, snapshot: { active: false, plan: 'free' } })).toBe('free');
  });

  it('2. active Pro resolves to Pro', () => {
    expect(resolveDisplayPlan({ ...authed, snapshot: { active: true, plan: 'pro' } })).toBe('pro');
  });

  it('3. active Ultra resolves to Ultra', () => {
    expect(resolveDisplayPlan({ ...authed, snapshot: { active: true, plan: 'ultra' } })).toBe('ultra');
  });

  it('4. missing billing response does NOT resolve to Pro (Free-safe)', () => {
    expect(resolveDisplayPlan({ ...authed, snapshot: null })).toBe('free');
  });

  it('5. API error (null snapshot, not loading) does NOT resolve to Pro', () => {
    expect(resolveDisplayPlan({ isAuthenticated: true, loading: false, snapshot: null })).toBe('free');
  });

  it('6/9. loading a new account shows neutral (null), never the old/other plan', () => {
    // No snapshot yet + still loading → neutral. A previous account's "pro" is not
    // an input here, so it can never surface for the next user.
    expect(resolveDisplayPlan({ isAuthenticated: true, loading: true, snapshot: null })).toBeNull();
  });

  it('7/8. logout / guest resolves to Free (no leaked paid state)', () => {
    expect(resolveDisplayPlan({ isAuthenticated: false, loading: false, snapshot: null })).toBe('free');
    // Even if a stale snapshot object were somehow present, a guest is Free.
    expect(resolveDisplayPlan({ isAuthenticated: false, loading: false, snapshot: { active: true, plan: 'pro' } })).toBe('free');
  });

  it('10. owner/admin is not an input — it can never imply a paid plan', () => {
    // There is no owner/email/credits parameter; only backend `active` matters.
    expect(resolveDisplayPlan({ ...authed, snapshot: { active: false } })).toBe('free');
  });

  it('13. no subscription record means Free', () => {
    expect(resolveDisplayPlan({ ...authed, snapshot: {} })).toBe('free');
  });

  it('14. an unknown/garbage plan label with active degrades to Free, never Pro', () => {
    expect(resolveDisplayPlan({ ...authed, snapshot: { active: true, plan: 'legendary' } })).toBe('free');
    expect(resolveDisplayPlan({ ...authed, snapshot: { active: true, plan: null } })).toBe('free');
  });
});

describe('plan label / paid helpers', () => {
  it('labels map correctly', () => {
    expect(planLabel('pro')).toBe('Pro');
    expect(planLabel('free')).toBe('Free');
    expect(planLabel('ultra')).toBe('Ultra');
  });
  it('paid detection', () => {
    expect(isPaidPlan('free')).toBe(false);
    expect(isPaidPlan('pro')).toBe(true);
    expect(isPaidPlan('ultra')).toBe(true);
  });
});
