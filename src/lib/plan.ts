/**
 * Single source of truth for the user's *billing plan* label.
 *
 * Two independent signals existed and disagreed: the top-right badge hardcoded
 * "Free" while the sidebar account card read `settings.plan` (Pro). This helper
 * resolves ONE plan from the available signals so every surface (top-right
 * badge, account card, credits UI) shows the same thing.
 *
 * Rules (from the product spec):
 *  - A paid signal from ANY reliable source wins — a Pro user must NEVER be
 *    shown "Free" just because another source defaulted to free.
 *  - Owner-session status is SEPARATE from billing and never feeds in here
 *    (an owner on Free is still Free; an owner on Pro is still Pro).
 *  - Unknown / still-loading resolves to `null` — callers should render a
 *    neutral/empty state, never a misleading "Free".
 */
export type PlanKey = 'free' | 'basic' | 'pro' | 'ultra' | 'enterprise';

const PLAN_KEYS: PlanKey[] = ['free', 'basic', 'pro', 'ultra', 'enterprise'];
const PAID = new Set<PlanKey>(['basic', 'pro', 'ultra', 'enterprise']);

const PLAN_LABELS: Record<PlanKey, string> = {
  free: 'Free', basic: 'Basic', pro: 'Pro', ultra: 'Ultra', enterprise: 'Enterprise',
};

function normalize(p?: string | null): PlanKey | null {
  const v = (p || '').toLowerCase().trim() as PlanKey;
  return PLAN_KEYS.includes(v) ? v : null;
}

/**
 * Resolve the effective plan key from the candidate signals (highest-priority
 * first is not required — a paid tier from any source wins over free).
 * Returns null when no signal is known yet.
 */
export function resolvePlanKey(...candidates: Array<string | null | undefined>): PlanKey | null {
  const known = candidates.map(normalize).filter((p): p is PlanKey => p !== null);
  if (known.length === 0) return null;
  // Any paid tier wins over free — never downgrade a paying user to Free.
  const paid = known.find((p) => PAID.has(p));
  return paid ?? known[0];
}

/** Display label ("Pro" / "Free" / …) or null when unknown/loading. */
export function getUserPlanLabel(...candidates: Array<string | null | undefined>): string | null {
  const key = resolvePlanKey(...candidates);
  return key ? PLAN_LABELS[key] : null;
}
