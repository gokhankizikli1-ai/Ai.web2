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

// User-facing labels for the final plan structure. Internal keys are STABLE
// (renaming would break stored subscriptions / entitlement mappings); only the
// display label differs: basic → Starter, ultra → Max.
const PLAN_LABELS: Record<PlanKey, string> = {
  free: 'Free', basic: 'Starter', pro: 'Pro', ultra: 'Max', enterprise: 'Enterprise',
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

/** True for any paid tier. */
export function isPaidPlan(key: PlanKey): boolean {
  return PAID.has(key);
}

/** The label for a resolved plan key. */
export function planLabel(key: PlanKey): string {
  return PLAN_LABELS[key];
}

/**
 * The authoritative, backend-scoped account snapshot the plan display consumes.
 * Mirrors the safe subset of GET /v2/billing/me — `active` is the ONLY paid
 * signal, and `plan` is the backend-resolved plan key.
 */
export interface PlanSnapshot {
  plan?: string | null;
  active?: boolean;
}

export interface DisplayPlanInput {
  /** The per-user snapshot from GET /v2/billing/me; null = unknown / failed / guest. */
  snapshot: PlanSnapshot | null;
  /** True while the first authoritative fetch for THIS user is in flight. */
  loading: boolean;
  /** Whether there is an authenticated session at all. */
  isAuthenticated: boolean;
}

/**
 * THE single source of truth for the plan the UI displays. It trusts ONLY the
 * backend snapshot — never localStorage, credits, email, owner flag, a previous
 * account's state, URL params, or optimistic checkout state.
 *
 * Contract:
 *   - not authenticated            → 'free' (guest)
 *   - authenticated, still loading → null   (neutral; NEVER a Pro/Free claim yet)
 *   - snapshot missing (error/none)→ 'free' (fail-safe; NEVER Pro)
 *   - snapshot.active === true     → the backend plan key (paid)
 *   - authenticated, not active    → 'free'
 *
 * Returning null while loading lets callers render a neutral placeholder instead
 * of flashing the wrong plan when switching accounts.
 */
export function resolveDisplayPlan(input: DisplayPlanInput): PlanKey | null {
  if (!input.isAuthenticated) return 'free';
  const snap = input.snapshot;
  if (snap == null) {
    // No snapshot yet: neutral while genuinely loading, else Free-safe.
    return input.loading ? null : 'free';
  }
  if (snap.active === true) {
    // Backend-confirmed paid plan. An unknown label degrades to Free, never Pro.
    return normalize(snap.plan) ?? 'free';
  }
  // Authenticated with a snapshot but no active entitlement → Free.
  return 'free';
}
