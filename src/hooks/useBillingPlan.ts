/**
 * useBillingPlan — the ONE account-scoped source of plan truth for the UI.
 *
 * Fixes the account-to-account plan leak where every user was shown "Pro":
 * the badges used to read a browser-global `settings.plan` (default 'pro') that
 * was never scoped to the user nor cleared on logout. This hook instead reads
 * the AUTHORITATIVE backend snapshot (GET /v2/billing/me, via getMyBilling) for
 * the CURRENTLY authenticated user and resolves it through `resolveDisplayPlan`.
 *
 * Isolation guarantees:
 *   - Keyed to the authenticated user id: switching accounts refetches, and the
 *     previous snapshot is cleared IMMEDIATELY so no stale plan ever flashes.
 *   - Not persisted anywhere → logout leaves nothing to leak; a guest resolves
 *     to Free.
 *   - Never trusts localStorage / credits / email / owner flag / URL / optimistic
 *     checkout state. `active === true` from the backend is the only paid signal.
 *   - Loading / error / no-subscription NEVER resolve to a paid plan.
 *
 * This is display only — it grants no feature access. Backend authorization
 * remains authoritative and per-user.
 */
import { useEffect, useState } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { getMyBilling } from '@/lib/billingApi';
import {
  resolveDisplayPlan, planLabel, isPaidPlan,
  type PlanKey, type PlanSnapshot,
} from '@/lib/plan';

export interface BillingPlanState {
  /** Resolved plan key, or null while neutral/loading (render nothing). */
  planKey: PlanKey | null;
  /** Display label ("Pro" / "Free" / …) or null when neutral/loading. */
  label: string | null;
  /** Whether the resolved plan is a paid tier. */
  isPaid: boolean;
  /** True while the authoritative fetch for the current user is in flight. */
  loading: boolean;
  /** Re-fetch the snapshot (e.g. after a successful checkout). */
  refetch: () => void;
}

export function useBillingPlan(): BillingPlanState {
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const sessionChecked = useAuthStore((s) => s.sessionChecked);
  const uid = user?.id ?? null;

  const [snapshot, setSnapshot] = useState<PlanSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    // Guest / logged out → no snapshot (resolves to Free/guest). Nothing to leak.
    if (!isAuthenticated || !uid) {
      setSnapshot(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    // Clear the previous account's snapshot IMMEDIATELY so an account switch
    // never flashes the prior user's plan while the new fetch is in flight.
    setSnapshot(null);
    setLoading(true);
    getMyBilling()
      .then((snap) => { if (!cancelled) setSnapshot(snap); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // Re-run when the authenticated identity changes (login / account switch)
    // or an explicit refetch is requested.
  }, [uid, isAuthenticated, nonce]);

  // While the very first session check is still resolving we don't yet know if
  // there's a session — present a neutral state, never claim a plan.
  const authResolving = !sessionChecked && !isAuthenticated;
  const planKey = authResolving
    ? null
    : resolveDisplayPlan({ snapshot, loading, isAuthenticated });

  return {
    planKey,
    label: planKey ? planLabel(planKey) : null,
    isPaid: planKey ? isPaidPlan(planKey) : false,
    loading: loading || authResolving,
    refetch: () => setNonce((n) => n + 1),
  };
}
