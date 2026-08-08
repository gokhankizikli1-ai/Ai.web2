import { describe, it, expect } from 'vitest';
import {
  resolveDisplayPlan, planLabel, isPaidPlan, shouldShowUpgradeCta,
  type DisplayPlanInput,
} from '@/lib/plan';

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
  it('labels map to the final plan structure (basic→Starter, ultra→Max)', () => {
    expect(planLabel('pro')).toBe('Pro');
    expect(planLabel('free')).toBe('Free');
    expect(planLabel('basic')).toBe('Starter');
    expect(planLabel('ultra')).toBe('Max');
    expect(planLabel('enterprise')).toBe('Enterprise');
  });
  it('paid detection', () => {
    expect(isPaidPlan('free')).toBe(false);
    expect(isPaidPlan('pro')).toBe(true);
    expect(isPaidPlan('ultra')).toBe(true);
  });
});

/**
 * "Upgrade to Pro" CTA visibility (sidebar + account card) — must derive from the
 * SAME authoritative plan source as the plan badge so the two can NEVER contradict
 * (the reported bug: badge shows "Pro" while the CTA still shows "Upgrade to Pro").
 *
 * `ctaFor` reproduces exactly what the components do: resolveDisplayPlan (what the
 * badge shows) → isPaidPlan → shouldShowUpgradeCta. So a passing case proves the
 * badge and the CTA agree end-to-end.
 */
describe('shouldShowUpgradeCta — never contradicts the plan badge', () => {
  const authed = { isAuthenticated: true, loading: false };
  const ctaFor = (input: DisplayPlanInput, isOwner = false): boolean => {
    const planKey = resolveDisplayPlan(input);            // the SAME value the badge renders
    const isPaid = planKey ? isPaidPlan(planKey) : false;
    return shouldShowUpgradeCta({ planKey, isPaid, isOwner });
  };

  it('Free user → upgrade CTA VISIBLE', () => {
    expect(ctaFor({ ...authed, snapshot: { active: false, plan: 'free' } })).toBe(true);
  });

  it('Pro user → upgrade CTA HIDDEN (the reported contradiction)', () => {
    expect(ctaFor({ ...authed, snapshot: { active: true, plan: 'pro' } })).toBe(false);
  });

  it('higher paid tiers (Max / Enterprise) → HIDDEN', () => {
    expect(ctaFor({ ...authed, snapshot: { active: true, plan: 'ultra' } })).toBe(false);
    expect(ctaFor({ ...authed, snapshot: { active: true, plan: 'enterprise' } })).toBe(false);
  });

  it('Starter (any paid tier) → HIDDEN', () => {
    expect(ctaFor({ ...authed, snapshot: { active: true, plan: 'basic' } })).toBe(false);
  });

  it('paid owner → HIDDEN; free-plan owner → HIDDEN (effective entitlement)', () => {
    expect(ctaFor({ ...authed, snapshot: { active: true, plan: 'pro' } }, /* isOwner */ true)).toBe(false);
    expect(ctaFor({ ...authed, snapshot: { active: false, plan: 'free' } }, /* isOwner */ true)).toBe(false);
  });

  it('unknown/loading state → HIDDEN (no flash, no paid/free contradiction)', () => {
    // planKey === null while the first authoritative fetch is in flight.
    expect(ctaFor({ isAuthenticated: true, loading: true, snapshot: null })).toBe(false);
    // A paid user reloading never flashes the CTA: it stays hidden through load…
    expect(shouldShowUpgradeCta({ planKey: null, isPaid: false, isOwner: false })).toBe(false);
    // …and stays hidden once resolved to a paid tier.
    expect(ctaFor({ ...authed, snapshot: { active: true, plan: 'pro' } })).toBe(false);
  });

  it('guest resolves to Free → CTA VISIBLE', () => {
    expect(ctaFor({ isAuthenticated: false, loading: false, snapshot: null })).toBe(true);
  });

  it('plan refresh flips the CTA in lockstep with the badge (Free → Pro)', () => {
    const before = { ...authed, snapshot: { active: false, plan: 'free' } };
    const after = { ...authed, snapshot: { active: true, plan: 'pro' } };
    expect(resolveDisplayPlan(before)).toBe('free');
    expect(ctaFor(before)).toBe(true);      // Free: badge "Free", CTA shown
    expect(resolveDisplayPlan(after)).toBe('pro');
    expect(ctaFor(after)).toBe(false);      // after refresh: badge "Pro", CTA hidden
  });

  it('direct predicate matrix', () => {
    expect(shouldShowUpgradeCta({ planKey: 'free', isPaid: false, isOwner: false })).toBe(true);
    expect(shouldShowUpgradeCta({ planKey: 'pro', isPaid: true, isOwner: false })).toBe(false);
    expect(shouldShowUpgradeCta({ planKey: 'free', isPaid: false, isOwner: true })).toBe(false);
    expect(shouldShowUpgradeCta({ planKey: null, isPaid: false, isOwner: false })).toBe(false);
  });
});
