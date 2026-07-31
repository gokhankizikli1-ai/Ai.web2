/**
 * Pricing display catalog — the single source of truth for what the marketing
 * pricing UI shows (labels, prices, feature copy) and how the CTA behaves.
 *
 * IMPORTANT boundaries:
 *  - This is the DISPLAY catalog. It is SEPARATE from the provider product
 *    mappings (BILLING_PLAN_MAP_JSON) and from the backend entitlement catalog
 *    that actually GRANTS access. Nothing here grants a feature.
 *  - PRICES ARE NOT LOCKED. Final prices and credit allocations are not decided,
 *    so NO concrete/final price is shown here — cards render a neutral
 *    "Pricing at launch" state (Enterprise is "Custom"). Do NOT hardcode or
 *    invent a production price. The Polar sandbox prices are never surfaced here.
 *  - FEATURES: only backend-verified/universally-available capabilities appear on
 *    a card. Everything not yet implemented + backend-enforced lives in
 *    PLANNED_CAPABILITIES (a "coming later" list OUTSIDE the purchasable features),
 *    never as a per-plan claim.
 *  - Internal keys are STABLE (free/basic/pro/ultra/enterprise) so stored
 *    subscriptions/mappings are never broken; only the label differs
 *    (basic → Starter, ultra → Max).
 */
import type { PlanKey } from '@/lib/plan';

export interface PricingPlan {
  /** Stable internal key (also the checkout selector base). */
  key: Extract<PlanKey, 'basic' | 'pro' | 'ultra' | 'enterprise'>;
  /** User-facing label (final plan structure). */
  label: string;
  /** Ordering for upgrade/downgrade comparisons (matches backend plan ranks). */
  rank: number;
  popular?: boolean;
  /** Short marketing description. */
  description: string;
  /** ONLY verified/available capabilities. Unimplemented capabilities are NOT
   *  listed here — they belong in PLANNED_CAPABILITIES. */
  features: string[];
}

/** Rank of any plan key (free is the implicit default tier). Matches the backend
 *  built-in catalog ranks so "higher plan" comparisons agree end-to-end. */
export function planRank(key: PlanKey | null | undefined): number {
  switch (key) {
    case 'basic': return 10;
    case 'pro': return 20;
    case 'ultra': return 30;
    case 'enterprise': return 40;
    default: return 0; // free / unknown / loading
  }
}

/**
 * The four purchasable/contact cards. Free is the default account tier and is
 * shown as a current-plan banner rather than a purchasable card.
 *
 * NO concrete prices — final prices/credits are not locked (see the header).
 * Card `features` list ONLY the verified capability available today: core AI
 * chat (available on every tier). Everything else that is planned but not yet
 * implemented + enforced is in PLANNED_CAPABILITIES below, clearly outside the
 * purchasable feature list.
 */
const VERIFIED_INCLUDED = 'Core AI chat';

export const PRICING_PLANS: PricingPlan[] = [
  {
    key: 'basic', label: 'Starter', rank: 10,
    description: 'For getting started',
    features: [VERIFIED_INCLUDED],
  },
  {
    key: 'pro', label: 'Pro', rank: 20, popular: true,
    description: 'For professionals who need more',
    features: [VERIFIED_INCLUDED],
  },
  {
    key: 'ultra', label: 'Max', rank: 30,
    description: 'For power users and teams',
    features: [VERIFIED_INCLUDED],
  },
  {
    key: 'enterprise', label: 'Enterprise', rank: 40,
    description: 'For organizations at scale',
    features: [VERIFIED_INCLUDED],
  },
];

/**
 * Planned capabilities — NOT yet implemented and backend-enforced, so they are
 * NOT shown as per-plan purchasable features. Rendered in a clearly-labeled
 * "coming later" section so we never imply a paid entitlement that isn't live.
 * Which tier each lands in is decided when prices/entitlements are finalized.
 */
export const PLANNED_CAPABILITIES: string[] = [
  'Higher monthly credit allocations',
  'Full Web Build access',
  'Deep Research',
  'Advanced file analysis',
  'Custom instructions',
  'AI agents',
  'Larger working context',
  'Priority processing & model access',
  'Advanced analytics',
  'SSO / SAML, team administration & audit controls (Enterprise)',
  'API access & dedicated infrastructure (Enterprise)',
];

/**
 * Whether purchasable YEARLY variants exist. There are none yet, so the yearly
 * selector is hidden. Flip via `hasYearlyVariants` once the checkout catalog
 * actually exposes `*_yearly` selectors.
 */
export const YEARLY_VARIANTS_AVAILABLE = false;

/** True when the provided checkout selectors include any yearly variant. */
export function hasYearlyVariants(selectors: readonly string[]): boolean {
  return selectors.some((s) => /_yearly$/i.test((s || '').trim()));
}

export type CtaKind = 'current' | 'upgrade' | 'contact' | 'included';

/**
 * The CTA a card should show given the user's CURRENT plan key.
 *  - Enterprise            → 'contact' (Contact Sales)
 *  - card === current plan → 'current' (Current plan; not purchasable)
 *  - card ranks HIGHER     → 'upgrade'
 *  - card ranks lower/equal→ 'included' (never a misleading "Upgrade")
 *
 * A null/loading current plan is treated as the Free default (rank 0), so paid
 * cards read as 'upgrade' — never 'current' (no false "you own this").
 */
export function ctaFor(currentKey: PlanKey | null | undefined, card: PricingPlan): CtaKind {
  if (card.key === 'enterprise') return 'contact';
  if (currentKey && card.key === currentKey) return 'current';
  return card.rank > planRank(currentKey) ? 'upgrade' : 'included';
}
