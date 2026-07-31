import { describe, it, expect } from 'vitest';
import {
  PRICING_PLANS, PLANNED_CAPABILITIES, ctaFor, planRank, hasYearlyVariants, YEARLY_VARIANTS_AVAILABLE,
} from '@/lib/pricingPlans';

/**
 * Pricing-catalog + CTA-behavior tests (final plan structure).
 */

describe('pricing catalog structure', () => {
  it('exposes exactly Starter / Pro / Max / Enterprise with stable keys', () => {
    expect(PRICING_PLANS.map((p) => p.key)).toEqual(['basic', 'pro', 'ultra', 'enterprise']);
    expect(PRICING_PLANS.map((p) => p.label)).toEqual(['Starter', 'Pro', 'Max', 'Enterprise']);
  });

  it('basic internal key displays Starter; ultra internal key displays Max', () => {
    const byKey = Object.fromEntries(PRICING_PLANS.map((p) => [p.key, p.label]));
    expect(byKey.basic).toBe('Starter');
    expect(byKey.ultra).toBe('Max');
  });

  it('ranks are strictly increasing Starter<Pro<Max<Enterprise', () => {
    const ranks = PRICING_PLANS.map((p) => p.rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(new Set(ranks).size).toBe(ranks.length);
  });

  it('exposes NO concrete/final price (prices are not locked)', () => {
    for (const p of PRICING_PLANS) {
      // The field is removed from the model; nothing numeric leaks as a price.
      expect((p as unknown as Record<string, unknown>).priceMonthly).toBeUndefined();
    }
  });
});

describe('feature honesty — cards list only verified capabilities', () => {
  it('every card feature is the verified/available item only', () => {
    for (const p of PRICING_PLANS) {
      expect(p.features).toEqual(['Core AI chat']);
    }
  });

  it('unimplemented capabilities live OUTSIDE the cards, in PLANNED_CAPABILITIES', () => {
    expect(PLANNED_CAPABILITIES.length).toBeGreaterThan(0);
    const cardFeatures = new Set(PRICING_PLANS.flatMap((p) => p.features));
    // The planned list and the card features are disjoint (no double-claiming).
    for (const planned of PLANNED_CAPABILITIES) {
      expect(cardFeatures.has(planned)).toBe(false);
    }
    // Guard against re-introducing unverified paid claims on the cards.
    const banned = ['Deep Research', 'Web Build', 'agents', 'SSO', 'API access', 'credits'];
    for (const feat of cardFeatures) {
      for (const b of banned) expect(feat.toLowerCase()).not.toContain(b.toLowerCase());
    }
  });
});

describe('yearly selector gating', () => {
  it('is hidden by default (no yearly variants exist)', () => {
    expect(YEARLY_VARIANTS_AVAILABLE).toBe(false);
  });
  it('hasYearlyVariants detects *_yearly selectors only', () => {
    expect(hasYearlyVariants(['pro_monthly', 'ultra_monthly'])).toBe(false);
    expect(hasYearlyVariants(['pro_monthly', 'pro_yearly'])).toBe(true);
    expect(hasYearlyVariants([])).toBe(false);
  });
});

describe('ctaFor — current plan, upgrade-only, contact', () => {
  const pro = PRICING_PLANS.find((p) => p.key === 'pro')!;
  const max = PRICING_PLANS.find((p) => p.key === 'ultra')!;
  const starter = PRICING_PLANS.find((p) => p.key === 'basic')!;
  const enterprise = PRICING_PLANS.find((p) => p.key === 'enterprise')!;

  it('active plan shows Current plan (not purchasable)', () => {
    expect(ctaFor('pro', pro)).toBe('current');
    expect(ctaFor('ultra', max)).toBe('current');
  });

  it('a Pro user can upgrade to Max but not re-buy Pro', () => {
    expect(ctaFor('pro', max)).toBe('upgrade');   // higher tier → upgrade
    expect(ctaFor('pro', pro)).toBe('current');   // same tier → never a duplicate checkout
  });

  it('lower tiers are not misleadingly "Upgrade" for a higher-tier user', () => {
    expect(ctaFor('ultra', starter)).toBe('included'); // Max user, Starter card → included
    expect(ctaFor('ultra', pro)).toBe('included');
  });

  it('a Free user sees Upgrade on paid cards', () => {
    expect(ctaFor('free', starter)).toBe('upgrade');
    expect(ctaFor('free', pro)).toBe('upgrade');
    expect(ctaFor('free', max)).toBe('upgrade');
  });

  it('loading/unknown current plan never claims a paid plan (treated as Free)', () => {
    expect(ctaFor(null, pro)).toBe('upgrade');    // never 'current'
    expect(ctaFor(undefined, max)).toBe('upgrade');
  });

  it('Enterprise always shows Contact Sales (never a checkout)', () => {
    expect(ctaFor('free', enterprise)).toBe('contact');
    expect(ctaFor('pro', enterprise)).toBe('contact');
    expect(ctaFor('enterprise', enterprise)).toBe('contact');
  });
});

describe('planRank', () => {
  it('orders keys and treats unknown/null as Free', () => {
    expect(planRank('free')).toBe(0);
    expect(planRank(null)).toBe(0);
    expect(planRank('basic')).toBeLessThan(planRank('pro'));
    expect(planRank('pro')).toBeLessThan(planRank('ultra'));
    expect(planRank('ultra')).toBeLessThan(planRank('enterprise'));
  });
});
