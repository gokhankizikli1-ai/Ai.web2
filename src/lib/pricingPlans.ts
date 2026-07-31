/**
 * Pricing display catalog — the single source of truth for what the marketing
 * pricing UI shows (labels, prices, feature copy) and how the CTA behaves.
 *
 * IMPORTANT boundaries:
 *  - This is the DISPLAY catalog. It is SEPARATE from the provider product
 *    mappings (BILLING_PLAN_MAP_JSON) and from the backend entitlement catalog
 *    that actually GRANTS access. Nothing here grants a feature.
 *  - Prices are the current configured marketing prices, kept in ONE place so the
 *    pricing page, upgrade modal and account UI can't disagree. They are NOT the
 *    Polar sandbox prices — sandbox prices must never overwrite marketing prices.
 *    Replace these when authoritative production prices are supplied.
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
  /** Current configured monthly price in USD, or null for custom (Enterprise). */
  priceMonthly: number | null;
  /** Ordering for upgrade/downgrade comparisons (matches backend plan ranks). */
  rank: number;
  popular?: boolean;
  /** Short marketing description. */
  description: string;
  /** Feature copy. Display-only; see the truth table in the PR — the backend does
   *  not yet gate these per plan, so they are indicative, not entitlements. */
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
 * Prices preserved from the existing configured marketing values (Pro $20, Max
 * $49; Starter uses the previously-configured Basic price of $9; Enterprise is
 * custom). Do NOT invent production prices here.
 */
export const PRICING_PLANS: PricingPlan[] = [
  {
    key: 'basic', label: 'Starter', priceMonthly: 9, rank: 10,
    description: 'For getting started with real work',
    features: [
      'Core AI chat',
      'Starter monthly credits',
      'Limited Web Build access',
      'Project saving',
      'Standard response speed',
      'Basic file analysis',
    ],
  },
  {
    key: 'pro', label: 'Pro', priceMonthly: 20, rank: 20, popular: true,
    description: 'For professionals who need more power',
    features: [
      'Everything in Starter',
      'Higher monthly credits',
      'Full Web Build access',
      'Deep Research access',
      'Advanced file analysis',
      'Custom instructions',
      'Priority processing',
    ],
  },
  {
    key: 'ultra', label: 'Max', priceMonthly: 49, rank: 30,
    description: 'For power users and teams',
    features: [
      'Everything in Pro',
      'Highest monthly credits',
      'All available agents',
      'Advanced Web and App Build',
      'Larger working context',
      'Priority model access',
      'Advanced analytics',
      'Priority support',
    ],
  },
  {
    key: 'enterprise', label: 'Enterprise', priceMonthly: null, rank: 40,
    description: 'For organizations at scale',
    features: [
      'Everything in Max',
      'SSO and SAML',
      'Team administration',
      'Audit and compliance controls',
      'API access',
      'Custom AI configuration',
      'Dedicated infrastructure options',
      'SLA and enterprise support',
    ],
  },
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
